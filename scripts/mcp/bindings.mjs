/** Build-time projection of reviewed MCP contributions onto canonical operations. */
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
export class McpBindingError extends Error {
  constructor(code) { super(`Invalid MCP binding (${code}).`); this.name = 'McpBindingError'; this.code = code; }
}
const fail = code => { throw new McpBindingError(code); };
const id = value => typeof value === 'string' && value.length <= 128 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
const toolName = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9_.-]+$/.test(value);
// T06 has no anonymous credential or guarded anonymous operation lease yet.
const actorFor = Object.freeze({oauth: 'delegated-user', 'api-token': 'machine'});
const json = value => JSON.stringify(value);

export function compileMcpBindings({composition, modules, operationCatalog, disabledContributions = [], widgetCatalog = {widgets: [], resources: []}}) {
  if (!composition || !Array.isArray(composition.modules) || !composition.exposure
    || !Array.isArray(modules) || operationCatalog?.schemaVersion !== 1 || !Array.isArray(operationCatalog.modules)
    || !Array.isArray(disabledContributions) || !Array.isArray(widgetCatalog.widgets)
    || !Array.isArray(widgetCatalog.resources)) fail('catalog');
  const descriptors = new Map(modules.map(module => [module.identity?.id, module]));
  const selected = new Map(composition.modules.map(item => [item.moduleId, item]));
  const operations = new Map(operationCatalog.modules.flatMap(module => module.operations.map(entry =>
    [`${module.moduleId}:${entry.operation.id}`, entry])));
  const active = (moduleId, pointer) => !disabledContributions.some(item => item.moduleId === moduleId
    && (item.path === pointer || pointer.startsWith(`${item.path}/`)));
  const exposed = (moduleId, audience) => composition.exposure[audience]?.moduleIds?.includes(moduleId) === true;
  const widgetFor = ref => widgetCatalog.widgets.find(item => item.moduleId === ref?.moduleId && item.widgetId === ref?.id);
  const widgetResourceFor = widget => widgetCatalog.resources.find(item => item.uri === widget?.resourceUri);
  const widgetInputAccepts = (widget, outputSchema, descriptor) => {
    if (!widget) return false;
    const outputDigest=contractIntegrity(outputSchema);
    if (outputDigest === widget.schemas.input.digest) return true;
    const input=widget.schemas.input.schema;
    // An aggregate card may render distinct existing tool outputs. Every top-level
    // branch must be exactly one of those output schemas; no general subsumption.
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 1 || !Array.isArray(input.anyOf) ||
      input.anyOf.length < 2 || input.anyOf.length > 8) return false;
    const expected=new Set();
    for (const candidate of descriptor.contracts.mcp.tools) {
      if (candidate.widget?.moduleId !== widget.moduleId || candidate.widget.id !== widget.widgetId) continue;
      const operation=operations.get(`${candidate.operation?.moduleId}:${candidate.operation?.id}`)?.operation;
      const schema=descriptors.get(candidate.operation?.moduleId)?.contracts.schemas
        .find(item=>item.id===operation?.output?.schemaId)?.schema;
      if (!schema || schema.type !== 'object') return false;
      expected.add(contractIntegrity(schema));
    }
    const branches=input.anyOf;
    const actual=branches.map(branch=>branch && typeof branch === 'object' && !Array.isArray(branch) &&
      branch.type === 'object' ? contractIntegrity(branch) : null);
    return actual.length === expected.size && actual.every(digest=>digest && expected.has(digest)) &&
      new Set(actual).size === actual.length && expected.has(outputDigest);
  };
  const tools = [], resources = [], seenTools = new Set(), seenResources = new Set();
  for (const selection of composition.modules) {
    if (!selection.enabled) continue;
    const descriptor = descriptors.get(selection.moduleId);
    if (!descriptor || !descriptor.contracts?.mcp || !Array.isArray(descriptor.contracts.mcp.tools)
      || !Array.isArray(descriptor.contracts.mcp.resources)) fail('module');
    for (const [index, tool] of descriptor.contracts.mcp.tools.entries()) {
      if (!active(selection.moduleId, `/contracts/mcp/tools/${index}`)) continue;
      const owner = tool.operation?.moduleId, entry = operations.get(`${owner}:${tool.operation?.id}`), op = entry?.operation;
      if (!id(tool.id) || !toolName(tool.name) || !op || !entry.active || !selected.get(owner)?.enabled
        || !Array.isArray(tool.audiences) || !tool.audiences.length || !Array.isArray(tool.auth) || !tool.auth.length
        || tool.auth.some(value => !Object.hasOwn(actorFor, value) || !op.actors.includes(actorFor[value]))
        || tool.input?.schemaId !== op.input.schemaId || tool.output?.schemaId !== op.output.schemaId
        || tool.annotations?.readOnly !== (op.kind === 'query') || tool.textFallback !== true) fail('tool');
      const inputSchema = descriptors.get(owner)?.contracts?.schemas?.find(schema => schema.id === op.input.schemaId)?.schema;
      const outputSchema = descriptors.get(owner)?.contracts?.schemas?.find(schema => schema.id === op.output.schemaId)?.schema;
      if (!inputSchema || inputSchema.type !== 'object' || !outputSchema || outputSchema.type !== 'object') fail('schema');
      const widget = tool.widget ? widgetFor(tool.widget) : undefined;
      if (tool.widget && !widgetInputAccepts(widget,outputSchema,descriptor)) fail('widget');
      for (const audience of tool.audiences) {
        if (!['admin', 'app'].includes(audience) || !op.audiences.includes(audience)) fail('audience');
        if (!exposed(selection.moduleId, audience)) continue;
        if (widget && !widget.audiences.includes(audience)) continue;
        const key = `${audience}:${tool.name}`;
        if (seenTools.has(key)) fail('collision');
        seenTools.add(key);
        tools.push(Object.freeze({name: tool.name, contributorModuleId: selection.moduleId,
          moduleId: owner, operationId: op.id, audience, auth: Object.freeze([...tool.auth]),
          actors: Object.freeze(tool.auth.map(value => actorFor[value])),
          inputSchema: structuredClone(inputSchema), outputSchema: structuredClone(outputSchema),
          annotations: structuredClone(tool.annotations), context: op.context,
          permissions: Object.freeze(op.permissions.map(ref => `${ref.moduleId}:${ref.id}`)),
          contractDigest: entry.contractDigest,
          ...(widget ? {ui: {resourceUri: widget.resourceUri, visibility: ['model', 'app'],
            widget: {moduleId: widget.moduleId, widgetId: widget.widgetId, version: widget.version,
              resourceDigest: widget.resourceDigest}}} : {})}));
      }
    }
    for (const [index, resource] of descriptor.contracts.mcp.resources.entries()) {
      if (!active(selection.moduleId, `/contracts/mcp/resources/${index}`)) continue;
      if (!id(resource.id) || typeof resource.uri !== 'string' || !resource.uri || typeof resource.mimeType !== 'string'
        || !Array.isArray(resource.audiences) || !resource.audiences.length || !Array.isArray(resource.permissions)) fail('resource');
      let source;
      if (resource.source?.kind === 'asset') {
        if (typeof resource.source.path !== 'string' || !resource.source.path) fail('resource');
        source = {kind: 'asset', path: resource.source.path};
      } else if (resource.source?.kind === 'operation') {
        const owner = resource.source.operation?.moduleId;
        const entry = operations.get(`${owner}:${resource.source.operation?.id}`);
        if (!entry?.active || !selected.get(owner)?.enabled || entry.operation.kind !== 'query') fail('resource');
        source = {kind: 'operation', moduleId: owner, operationId: entry.operation.id};
      } else fail('resource');
      const widget = resource.widget ? widgetFor(resource.widget) : undefined;
      const compiledResource = widget ? widgetResourceFor(widget) : undefined;
      if (resource.widget && (!widget || !compiledResource || source.kind !== 'asset')) fail('widget');
      for (const audience of resource.audiences) {
        if (!['admin', 'app'].includes(audience)) fail('audience');
        if (!exposed(selection.moduleId, audience)) continue;
        if (widget && !widget.audiences.includes(audience)) continue;
        const uri = compiledResource?.uri ?? resource.uri;
        const key = `${audience}:${uri}`;
        if (seenResources.has(key)) fail('collision');
        seenResources.add(key);
        resources.push(Object.freeze({id: resource.id, uri, mimeType: resource.mimeType,
          contributorModuleId: selection.moduleId, audience,
          permissions: Object.freeze([...new Set(resource.permissions.map(ref => `${ref.moduleId}:${ref.id}`)
            .concat(widget?.permissions ?? []))]),
          actors: Object.freeze(source.kind === 'operation' ? [...operations.get(`${source.moduleId}:${source.operationId}`).operation.actors]
            : ['delegated-user', 'machine']),
          context: source.kind === 'operation' ? operations.get(`${source.moduleId}:${source.operationId}`).operation.context : 'required',
          source: Object.freeze(compiledResource ? {kind: 'compiled-widget',
            digest: compiledResource.digest, cspProfileId: compiledResource.cspProfileId,
            text: compiledResource.text, uiMeta: compiledResource.uiMeta} : source)}));
      }
    }
  }
  // JSON round-trip also excludes functions, accessors and mutable prototype tricks from generated artifacts.
  if (json({tools, resources}) === undefined) fail('catalog');
  return Object.freeze({tools: Object.freeze(tools), resources: Object.freeze(resources)});
}
