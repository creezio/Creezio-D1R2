import {createHash} from 'node:crypto';
import {canonicalJson, contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {validateCompiledWidgetCatalog, widgetKey} from '../../sdk/widgets/catalog.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export class WidgetCompilationError extends Error {
  constructor(code) { super(`Widget compilation failed (${code}).`); this.name = 'WidgetCompilationError'; this.code = code; }
}
const fail = code => { throw new WidgetCompilationError(code); };
const sha256 = bytes => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const key = (moduleId, id) => `${moduleId}:${id}`;
const isActive = (disabled, moduleId, pointer) => !disabled.some(item => item.moduleId === moduleId
  && (item.path === pointer || pointer.startsWith(`${item.path}/`)));

/** Preserve bundled JavaScript literally: replacement strings interpret $&, $` and $'. */
export function embedWidgetRenderer(html, script) {
  return html.replace(/<\/body>/i, () => `<script>${script}</script></body>`);
}

function uiMeta(resource) {
  const declared = resource.ui ?? {};
  const csp = declared.csp ?? {};
  const meta = {
    csp: {
      connectDomains: [...(csp.connectDomains ?? [])],
      resourceDomains: [...(csp.resourceDomains ?? [])],
      frameDomains: [...(csp.frameDomains ?? [])],
      baseUriDomains: [...(csp.baseUriDomains ?? [])],
    },
    permissions: {...(declared.permissions ?? {})},
    ...(declared.prefersBorder === undefined ? {} : {prefersBorder: declared.prefersBorder}),
  };
  for (const [name, values] of Object.entries(meta.csp)) {
    if (!Array.isArray(values) || values.length > 16 || new Set(values).size !== values.length) fail('csp');
    for (const value of values) {
      if (typeof value !== 'string' || value.length > 2048 || /[\s'";]/.test(value)) fail('csp');
      const candidate = name === 'resourceDomains' ? value.replace('://*.', '://') : value;
      let url;
      try { url = new URL(candidate); } catch { fail('csp'); }
      if (!['https:', ...(name === 'connectDomains' ? ['wss:'] : [])].includes(url.protocol)
        || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || (value.includes('*') && (name !== 'resourceDomains' || !/^https:\/\/\*\.[a-z0-9.-]+$/.test(value)))) fail('csp');
    }
  }
  for (const [name, value] of Object.entries(meta.permissions)) {
    if (!['camera', 'microphone', 'geolocation', 'clipboardWrite'].includes(name)
      || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) fail('permissions');
  }
  return meta;
}

/** Validated composition and confined file reader are supplied by compose-runtime. */
export function compileWidgetCatalog({composition, modules, operationCatalog, disabledContributions = [], readAsset, bundleRenderer}) {
  if (!composition || !Array.isArray(composition.modules) || !Array.isArray(modules)
    || !Array.isArray(operationCatalog?.modules) || typeof readAsset !== 'function'
    || typeof bundleRenderer !== 'function') fail('input');
  const selected = new Map(composition.modules.map(item => [item.moduleId, item]));
  const operations = new Map(operationCatalog.modules.flatMap(module => module.operations.map(entry =>
    [key(module.moduleId, entry.operation.id), entry])));
  const widgets = [], resources = [], seen = new Set(), seenUri = new Set();
  const profiles = new Map();
  for (const module of modules) {
    const moduleId = module.identity.id;
    if (!selected.get(moduleId)?.enabled) continue;
    for (const [index, widget] of module.contracts.widgets.entries()) {
      if (!isActive(disabledContributions, moduleId, `/contracts/widgets/${index}`)) continue;
      const audiences = widget.audiences.filter(audience => composition.exposure[audience]?.moduleIds?.includes(moduleId));
      if (!audiences.length) continue;
      const identity = `${moduleId}\0${widget.id}\0${widget.version}`;
      if (seen.has(identity)) fail('collision');
      seen.add(identity);
      const declaration = module.contracts.mcp.resources.find(resource => resource.id === widget.resource);
      if (!declaration || declaration.source.kind !== 'asset' || declaration.widget?.moduleId !== moduleId
        || declaration.widget?.id !== widget.id || !isActive(disabledContributions, moduleId,
          `/contracts/mcp/resources/${module.contracts.mcp.resources.indexOf(declaration)}`)) fail('resource');
      const schema = reference => {
        const entry = module.contracts.schemas.find(item => item.id === reference.schemaId);
        if (!entry) fail('schema');
        return {schemaId: entry.id, digest: contractIntegrity(entry.schema), schema: entry.schema};
      };
      const actions = widget.actions.flatMap((action, actionIndex) => {
        if (!isActive(disabledContributions, moduleId, `/contracts/widgets/${index}/actions/${actionIndex}`)) return [];
        const compiled = {...action, input: schema(action.input), requiresModules: action.requiresModules ?? []};
        if (action.mode === 'direct' && action.target.kind === 'operation') {
          const ref = action.target.operation, operation = operations.get(key(ref.moduleId, ref.id));
          if (!operation?.active) fail('operation');
          const declaration = operation.operation;
          if (!['query', 'command'].includes(declaration.kind)) fail('operation-kind');
          const idempotencyKeyField = declaration.idempotency.mode === 'required'
            ? declaration.idempotency.keyField : undefined;
          if (declaration.kind === 'query' && idempotencyKeyField !== undefined) fail('query-idempotency');
          compiled.target = {...action.target, operationDigest: operation.contractDigest,
            operationKind: declaration.kind,
            ...(idempotencyKeyField === undefined ? {} : {idempotencyKeyField})};
        }
        return [compiled];
      });
      if (!actions.length) continue;
      const serverTools = actions.filter(action => action.mode === 'direct' && action.target.kind === 'operation')
        .map(action => {
          const tool = module.contracts.mcp.tools.find(candidate => candidate.widget?.moduleId === moduleId
            && candidate.widget.id === widget.id
            && candidate.operation.moduleId === action.target.operation.moduleId
            && candidate.operation.id === action.target.operation.id && candidate.audiences.some(audience => audiences.includes(audience))
            && isActive(disabledContributions, moduleId, `/contracts/mcp/tools/${module.contracts.mcp.tools.indexOf(candidate)}`));
          if (!tool) fail('tool');
          return {actionId: action.id, toolName: tool.name,
            operationDigest: action.target.operationDigest,
            operationKind: action.target.operationKind,
            idempotencyKeyField: action.target.idempotencyKeyField ?? null,
            visibility: ['model', 'app']};
        });
      const renderTools = module.contracts.mcp.tools.flatMap((tool, toolIndex) => {
        if (tool.widget?.moduleId !== moduleId || tool.widget.id !== widget.id
          || !isActive(disabledContributions, moduleId, `/contracts/mcp/tools/${toolIndex}`)) return [];
        const operation = operations.get(key(tool.operation.moduleId, tool.operation.id));
        if (!operation?.active || operation.operation.kind !== 'query' || !tool.annotations.readOnly) return [];
        const toolAudiences = tool.audiences.filter(audience => audiences.includes(audience));
        if (!toolAudiences.length) return [];
        return [{toolName: tool.name, operationModuleId: tool.operation.moduleId, operationId: operation.operation.id,
          operationDigest: operation.contractDigest, audiences: toolAudiences}];
      });
      if (!renderTools.length) fail('render-tool');
      let html = readAsset(moduleId, declaration.source.path);
      if (typeof html !== 'string' || !/^\s*<!doctype html\b/i.test(html) || !/<\/html>\s*$/i.test(html)) fail('html');
      const script = bundleRenderer(moduleId, widget.renderer);
      if (typeof script !== 'string' || !script || script.includes('</script')) fail('renderer');
      html = embedWidgetRenderer(html, script);
      if (Buffer.byteLength(html, 'utf8') > 1_048_576) fail('resource-size');
      const resourceDigest = sha256(Buffer.from(html, 'utf8'));
      const uri = `ui://creezio/${moduleId}/${widget.id}/${widget.version}/${resourceDigest}.html`;
      if (seenUri.has(uri)) fail('collision');
      seenUri.add(uri);
      const metadata = uiMeta(declaration);
      const cspProfileId = sha256(canonicalJson(metadata));
      const previous = profiles.get(cspProfileId);
      if (previous && canonicalJson(previous) !== canonicalJson(metadata)) fail('profile-collision');
      profiles.set(cspProfileId, metadata);
      const entry = {
        moduleId, widgetId: widget.id, version: widget.version, resourceUri: uri,
        resourceMimeType: 'text/html;profile=mcp-app', resourceDigest, bundleDigest: resourceDigest,
        schemas: {input: schema(widget.input), state: schema(widget.state), result: schema(widget.result)},
        audiences, permissions: widget.permissions.map(ref => `${ref.moduleId}:${ref.id}`),
        requiredCapabilities: widget.requiredCapabilities, requiresModules: widget.requiresModules ?? [],
        actions, renderTools, serverTools, transport: widget.transport,
      };
      widgets.push(entry);
      resources.push({uri, mimeType: 'text/html;profile=mcp-app', digest: resourceDigest,
        text: html, audiences, moduleId, widgetId: widget.id, version: widget.version,
        cspProfileId, uiMeta: metadata});
    }
  }
  if (widgets.length > 1000 || resources.length > 1000) fail('limit');
  const catalog = {widgets, resources};
  const ajv = addFormats(new Ajv2020({strict: true, strictRequired: true, ownProperties: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false}));
  const validators = new Map();
  try {
    for (const widget of widgets) {
      validators.set(widgetKey(widget), {
        input: ajv.compile(widget.schemas.input.schema),
        state: ajv.compile(widget.schemas.state.schema),
        result: ajv.compile(widget.schemas.result.schema),
        actionInputs: new Map(widget.actions.map(action => [action.id, ajv.compile(action.input.schema)])),
      });
    }
    validateCompiledWidgetCatalog(catalog, {
      digestUtf8: sha256, byteLengthUtf8: value => Buffer.byteLength(value, 'utf8'),
      digestUiMeta: meta => sha256(canonicalJson(meta)),
      validateUiMeta: meta => { try { uiMeta({ui: meta}); return true; } catch { return false; } },
      validators,
    });
  } catch (error) {
    if (error instanceof WidgetCompilationError) throw error;
    fail('compiled-catalog');
  }
  return catalog;
}

/** Explicit provider aliases distinguish widgets sharing a canonical readonly operation. */
export function projectWidgetProviderTools(mcpCatalog, operationTools) {
  const index = new Map();
  for (const binding of mcpCatalog.tools) {
    if (!binding.ui || !binding.annotations.readOnly) continue;
    const canonical = operationTools.find(item => item.moduleId === binding.moduleId
      && item.operationId === binding.operationId);
    if (!canonical) fail('provider-tool');
    const widget = {moduleId: binding.ui.widget.moduleId, widgetId: binding.ui.widget.widgetId,
      version: binding.ui.widget.version, resourceDigest: binding.ui.widget.resourceDigest,
      toolName: binding.name, operationDigest: binding.contractDigest};
    const key = `${binding.moduleId}\0${binding.operationId}\0${widget.moduleId}\0${widget.widgetId}\0${widget.version}\0${widget.toolName}`;
    const previous = index.get(key);
    if (previous) {
      if (JSON.stringify(previous.widget) !== JSON.stringify(widget)) fail('provider-collision');
      previous.audiences.push(binding.audience);
    } else index.set(key, {...canonical, audiences: [binding.audience], widget});
  }
  return [...index.values(), ...operationTools];
}
