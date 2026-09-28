/**
 * T-16 compiled widget boundary.
 * Producer: composition/MCP. Consumers: instance engine, Creezio host, external MCP host.
 * The engine receives entries and validators, never raw manifests or HTML.
 */

export type Audience = 'admin' | 'app';
export type Integrity = `sha256-${string}`;
export type WidgetKey = `${string}\u0000${string}\u0000${string}`;
export type ResourceKey = `${Audience}\u0000${string}`;
export type WidgetMimeType = 'text/html;profile=mcp-app';
export type Fallback = 'unavailable' | 'copy-message' | 'local-untransmitted-context';
export type ContextScope = readonly ['actor', 'conversation', 'surface'];
export type ToolVisibility = readonly ('model' | 'app')[];

export interface WidgetUiMeta {
  readonly csp: Readonly<{
    connectDomains: readonly string[];
    resourceDomains: readonly string[];
    frameDomains: readonly string[];
    baseUriDomains: readonly string[];
  }>;
  readonly permissions: Readonly<{
    camera?: Readonly<Record<never, never>>;
    microphone?: Readonly<Record<never, never>>;
    geolocation?: Readonly<Record<never, never>>;
    clipboardWrite?: Readonly<Record<never, never>>;
  }>;
  readonly prefersBorder?: boolean;
}

export interface CodeRef { readonly path: string; readonly export: string }
export interface ContractRef {
  readonly moduleId: string;
  readonly kind: 'operation';
  readonly id: string;
}
export interface SchemaBinding {
  readonly schemaId: string;
  readonly digest: Integrity;
  /** Canonical, strict-compiled JSON Schema 2020-12; no remote references. */
  readonly schema: Readonly<Record<string, unknown>> | boolean;
}
export interface ContextTarget {
  readonly namespace: 'module-instance';
  readonly fields: readonly string[];
  readonly scope: ContextScope;
  readonly expiresAfterSeconds: number; // 1..604800, per widgets.schema.json
  readonly replace: true;
  readonly removable: true;
  readonly revisionField: string;
}
export interface ActionBase {
  readonly id: string;
  readonly label: string;
  readonly input: SchemaBinding;
  readonly requiredCapabilities: readonly string[];
  readonly requiresModules: readonly string[];
  readonly fallback: Fallback;
}
export type WidgetActionDeclaration =
  | (ActionBase & {
      readonly mode: 'message';
      readonly target: Readonly<{
        template: string; preview: true; voluntarySend: true;
        states: readonly ['proposed', 'transmitted', 'refused', 'unknown'];
      }>;
    })
  | (ActionBase & { readonly mode: 'context'; readonly target: ContextTarget })
  | (ActionBase & {
      readonly mode: 'direct';
      readonly target:
        | Readonly<{kind: 'local'; handler: CodeRef; effect: 'visual-only'}>
        | Readonly<{kind: 'operation'; operation: ContractRef; operationDigest: Integrity;
            operationKind: 'query' | 'command'; idempotencyKeyField?: string}>;
      readonly afterSuccessContext?: ContextTarget;
    });

export interface WidgetCatalogEntry {
  readonly moduleId: string;
  readonly widgetId: string;
  readonly version: string;
  /** Declared renderer versions accepted for a stored native widget instance. */
  readonly compatibility?: string;
  readonly resourceUri: string;
  readonly resourceMimeType: WidgetMimeType;
  readonly resourceDigest: Integrity;
  readonly bundleDigest: Integrity;
  readonly schemas: Readonly<{
    input: SchemaBinding; state: SchemaBinding; result: SchemaBinding;
  }>;
  readonly audiences: readonly Audience[];
  readonly permissions: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly requiresModules: readonly string[];
  readonly actions: readonly WidgetActionDeclaration[];
  /** Existing readonly MCP operations whose successful output initializes this widget. */
  readonly renderTools: readonly Readonly<{
    toolName: string; operationModuleId: string; operationId: string; operationDigest: Integrity;
    audiences: readonly Audience[];
  }>[];
  /** Direct operation tools exposed to this widget; no implicit tool authority. */
  readonly serverTools: readonly Readonly<{
    actionId: string; toolName: string; operationDigest: Integrity;
    operationKind: 'query' | 'command'; idempotencyKeyField: string | null;
    visibility: ToolVisibility;
  }>[];
  readonly transport: Readonly<{
    protocol: 'mcp-apps'; maxPayloadBytes: number; timeoutMs: number;
    uncertainResult: 'reconcile-before-retry';
    fallbackDispatch: 'before-first-dispatch-only';
  }>;
}

export interface CompiledWidgetResource {
  readonly uri: string;
  readonly mimeType: WidgetMimeType;
  readonly digest: Integrity;
  /** Immutable compiled UTF-8 HTML; no source path lookup in the Worker. */
  readonly text: string;
  readonly audiences: readonly Audience[];
  readonly moduleId: string;
  readonly widgetId: string;
  readonly version: string;
  /** Hash of canonical UI metadata, independent of the HTML digest. */
  readonly cspProfileId: Integrity;
  /** Composition normalizes omitted spec fields to empty arrays/permissions. */
  readonly uiMeta: WidgetUiMeta;
}
export interface CompiledWidgetCatalog {
  readonly widgets: readonly WidgetCatalogEntry[];
  readonly resources: readonly CompiledWidgetResource[];
}

/** Tool descriptor metadata. The linked operation determines its effects. */
export interface WidgetRenderToolBinding {
  readonly name: string;
  readonly audience: Audience;
  readonly widgetKey: WidgetKey;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly _meta: Readonly<{ui: Readonly<{
    resourceUri: string; visibility: ToolVisibility;
  }>}>;
  readonly annotations: Readonly<{
    readOnly: boolean; destructive: boolean; idempotent: boolean; openWorld: boolean;
  }>;
}

/** Tool response to the model and UI host; text remains usable without MCP Apps. */
export interface WidgetRenderToolResult {
  readonly content: readonly [Readonly<{type: 'text'; text: string}>];
  readonly structuredContent: Readonly<{
    kind: 'creezio.widget.render.v1';
    invocationRequestId: string; // server-generated, never a ChatGPT conversation id
    instance: Readonly<{
      host: 'external-mcp';
      instanceId: string; // server-generated for this invocation
      instanceRevision: 1;
      moduleId: string;
      widgetId: string;
      widgetVersion: string;
      audience: Audience;
      resourceUri: string;
      resourceDigest: Integrity;
    }>;
    input: unknown; // checked by the canonical input validator before return
  }>;
}

export type ValueValidator = (value: unknown) => boolean;
export interface WidgetValidators {
  readonly input: ValueValidator;
  readonly state: ValueValidator;
  readonly result: ValueValidator;
  readonly actionInputs: ReadonlyMap<string, ValueValidator>;
  readonly contextValues?: ReadonlyMap<string, ValueValidator>;
}
export type WidgetValidatorMap = ReadonlyMap<WidgetKey, WidgetValidators>;
export type WidgetResourceMap = ReadonlyMap<ResourceKey, CompiledWidgetResource>;

/** Invoke before publishing tools/list; the tool must point to its own resource. */
export function validateRenderToolBinding(
  tool: WidgetRenderToolBinding,
  widget: WidgetCatalogEntry,
  resourceMap: WidgetResourceMap,
): void {
  if (tool.widgetKey !== widgetKey(widget) ||
      !widget.audiences.includes(tool.audience) ||
      tool._meta.ui.resourceUri !== widget.resourceUri ||
      !resourceMap.has(resourceKey(tool.audience, widget.resourceUri)) ||
      !tool._meta.ui.visibility.includes('model') ||
      new Set(tool._meta.ui.visibility).size !== tool._meta.ui.visibility.length ||
      tool._meta.ui.visibility.some(v => v !== 'model' && v !== 'app')) {
    throw new Error('P1: invalid render tool/resource binding');
  }
}

/** Invoke before returning tools/call; caller separately checks actor and audience. */
export function validateRenderToolResult(
  value: unknown,
  widget: WidgetCatalogEntry,
  audience: Audience,
  validateInput: ValueValidator,
  byteLengthUtf8: (text: string) => number,
): asserts value is WidgetRenderToolResult {
  const object = (x: unknown): x is Record<string, unknown> =>
    x !== null && typeof x === 'object' && !Array.isArray(x);
  const token = (x: unknown): x is string =>
    typeof x === 'string' && x.length >= 1 && x.length <= 128;
  if (!object(value) || !Array.isArray(value.content) || value.content.length !== 1 ||
      !object(value.content[0]) || value.content[0].type !== 'text' ||
      typeof value.content[0].text !== 'string' ||
      !object(value.structuredContent)) {
    throw new Error('P1: invalid render tool envelope');
  }
  const body = value.structuredContent;
  const instance = body.instance;
  if (body.kind !== 'creezio.widget.render.v1' ||
      !token(body.invocationRequestId) || !object(instance) ||
      instance.host !== 'external-mcp' || !token(instance.instanceId) ||
      instance.instanceRevision !== 1 ||
      instance.moduleId !== widget.moduleId ||
      instance.widgetId !== widget.widgetId ||
      instance.widgetVersion !== widget.version ||
      instance.audience !== audience ||
      instance.resourceUri !== widget.resourceUri ||
      instance.resourceDigest !== widget.resourceDigest ||
      !validateInput(body.input)) {
    throw new Error('P1: render result/widget mismatch');
  }
  let serialized: string;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error('P1: render result is not JSON'); }
  if (!serialized || byteLengthUtf8(serialized) > widget.transport.maxPayloadBytes) {
    throw new Error('P1: render result exceeds declared payload bound');
  }
}

export const widgetKey = (w: Pick<WidgetCatalogEntry, 'moduleId' | 'widgetId' | 'version'>): WidgetKey =>
  `${w.moduleId}\u0000${w.widgetId}\u0000${w.version}`;
export const resourceKey = (audience: Audience, uri: string): ResourceKey =>
  `${audience}\u0000${uri}`;
export const resourceUriFor = (w: Pick<WidgetCatalogEntry, 'moduleId' | 'widgetId' | 'version' | 'resourceDigest'>): string =>
  `ui://creezio/${w.moduleId}/${w.widgetId}/${w.version}/${w.resourceDigest}.html`;

export function findCompiledWidget(
  catalog: CompiledWidgetCatalog, moduleId: string, widgetId: string,
  version: string, audience: Audience,
): WidgetCatalogEntry | undefined {
  return catalog.widgets.find(w => w.moduleId === moduleId && w.widgetId === widgetId &&
    w.version === version && w.audiences.includes(audience));
}

export function findCompiledWidgetResource(
  catalog: CompiledWidgetCatalog, widget: WidgetCatalogEntry, audience: Audience,
): CompiledWidgetResource | undefined {
  if (!widget.audiences.includes(audience)) return undefined;
  return catalog.resources.find(r => r.uri === widget.resourceUri &&
    r.digest === widget.resourceDigest && r.audiences.includes(audience));
}

/**
 * Composition must first validate manifest branches with widgets.schema.json,
 * resolve canonical schemas/operation digests, evaluate module guards and import
 * the bundle. These checks protect the compiled boundary and build the read map.
 * Proposed extra resource bound: 1 MiB UTF-8, equal to the schema's maximum
 * transport.maxPayloadBytes. The schema already caps widgets/actions at 1000.
 */
export function validateCompiledWidgetCatalog(
  catalog: CompiledWidgetCatalog,
  deps: Readonly<{
    digestUtf8: (text: string) => Integrity;
    byteLengthUtf8: (text: string) => number;
    /** Canonical serialization + digest of normalized uiMeta. */
    digestUiMeta: (meta: WidgetUiMeta) => Integrity;
    /** Deployment policy validates exact origins and CSP permission keys. */
    validateUiMeta: (meta: WidgetUiMeta) => boolean;
    validators: WidgetValidatorMap;
  }>,
): WidgetResourceMap {
  const id = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
  const semver = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const digest = /^sha256-[a-f0-9]{64}$/;
  const assert = (ok: unknown, message: string): void => { if (!ok) throw new Error(`P1: ${message}`); };
  const validId = (s: string): boolean => s.length <= 128 && id.test(s);
  const validDigest = (s: string): boolean => digest.test(s);
  const entries = new Map<WidgetKey, WidgetCatalogEntry>();
  const resourceMap = new Map<ResourceKey, CompiledWidgetResource>();
  assert(catalog.widgets.length <= 1000, 'too many widgets');
  for (const w of catalog.widgets) {
    assert(validId(w.moduleId) && validId(w.widgetId), 'invalid widget identity');
    assert(w.version.length <= 128 && semver.test(w.version), 'invalid version');
    assert(w.compatibility === undefined || typeof w.compatibility === 'string' &&
      w.compatibility.length >= 1 && w.compatibility.length <= 256, 'invalid compatibility');
    assert(w.resourceMimeType === 'text/html;profile=mcp-app', 'invalid MIME');
    assert(validDigest(w.resourceDigest) && validDigest(w.bundleDigest), 'invalid digest');
    assert(w.resourceUri === resourceUriFor(w), 'resource URI must bind version and digest');
    assert(w.audiences.length >= 1 && w.audiences.length <= 2 &&
      new Set(w.audiences).size === w.audiences.length &&
      w.audiences.every(a => a === 'admin' || a === 'app'), 'invalid audiences');
    assert(w.transport.protocol === 'mcp-apps' &&
      Number.isInteger(w.transport.maxPayloadBytes) &&
      w.transport.maxPayloadBytes >= 1 && w.transport.maxPayloadBytes <= 1_048_576 &&
      Number.isInteger(w.transport.timeoutMs) &&
      w.transport.timeoutMs >= 1 && w.transport.timeoutMs <= 120_000 &&
      w.transport.uncertainResult === 'reconcile-before-retry' &&
      w.transport.fallbackDispatch === 'before-first-dispatch-only', 'invalid transport');
    assert(w.actions.length >= 1 && w.actions.length <= 1000, 'invalid action count');
    const key = widgetKey(w);
    assert(!entries.has(key), 'duplicate widget version');
    entries.set(key, w);
    const validators = deps.validators.get(key);
    assert(validators, 'missing canonical validators');
    const actionIds = new Set<string>();
    for (const a of w.actions) {
      assert(validId(a.id) && !actionIds.has(a.id), 'invalid or duplicate action');
      actionIds.add(a.id);
      assert(validators!.actionInputs.has(a.id), 'missing action validator');
      if (a.mode === 'direct' && a.target.kind === 'operation') {
        assert(a.target.operation.kind === 'operation' &&
          validDigest(a.target.operationDigest) &&
          (a.target.operationKind === 'query' || a.target.operationKind === 'command') &&
          (a.target.idempotencyKeyField === undefined ||
            validId(a.target.idempotencyKeyField) && a.target.operationKind === 'command'),
          'unresolved operation target');
      }
    }
    assert(w.renderTools.length >= 1, 'widget has no readonly render tool');
    const renderNames = new Set<string>();
    for (const tool of w.renderTools) {
      assert(!renderNames.has(tool.toolName) && validDigest(tool.operationDigest)
        && validId(tool.operationModuleId) && validId(tool.operationId) && tool.audiences.length >= 1
        && tool.audiences.every(a => w.audiences.includes(a)),
      'invalid render tool link');
      renderNames.add(tool.toolName);
    }
    const linkedActions = new Set<string>();
    for (const tool of w.serverTools) {
      const action = w.actions.find(a => a.id === tool.actionId);
      assert(action?.mode === 'direct' && action.target.kind === 'operation',
        'server tool must link one direct operation action');
      if (!action || action.mode !== 'direct' || action.target.kind !== 'operation') {
        throw new Error('P1: server tool target type mismatch');
      }
      assert(!linkedActions.has(tool.actionId) && validDigest(tool.operationDigest),
        'duplicate or invalid server tool link');
      linkedActions.add(tool.actionId);
      assert(tool.operationDigest === action.target.operationDigest &&
        tool.operationKind === action.target.operationKind &&
        tool.idempotencyKeyField === (action.target.idempotencyKeyField ?? null) &&
        tool.visibility.includes('app') &&
        tool.visibility.every(v => v === 'model' || v === 'app') &&
        new Set(tool.visibility).size === tool.visibility.length,
        'server tool digest or app visibility mismatch');
    }
    for (const a of w.actions) {
      if (a.mode === 'direct' && a.target.kind === 'operation') {
        assert(linkedActions.has(a.id), 'direct operation lacks app-callable server tool');
      }
    }
  }
  for (const r of catalog.resources) {
    const key = widgetKey(r);
    const w = entries.get(key);
    assert(w, 'orphan resource');
    assert(r.uri === w!.resourceUri && r.digest === w!.resourceDigest &&
      r.mimeType === w!.resourceMimeType, 'resource does not match widget');
    assert(deps.byteLengthUtf8(r.text) <= 1_048_576, 'resource exceeds proposed 1 MiB bound');
    assert(deps.digestUtf8(r.text) === r.digest, 'resource bytes do not match digest');
    assert(validDigest(r.cspProfileId) &&
      deps.digestUiMeta(r.uiMeta) === r.cspProfileId &&
      deps.validateUiMeta(r.uiMeta), 'invalid CSP profile');
    assert(r.audiences.length === w!.audiences.length &&
      r.audiences.every(a => w!.audiences.includes(a)), 'resource audience mismatch');
    for (const audience of r.audiences) {
      const audienceKey = resourceKey(audience, r.uri);
      assert(!resourceMap.has(audienceKey), 'duplicate audience/resource URI');
      resourceMap.set(audienceKey, r);
    }
  }
  for (const w of catalog.widgets) {
    for (const audience of w.audiences) {
      assert(resourceMap.has(resourceKey(audience, w.resourceUri)), 'missing resource');
    }
  }
  return resourceMap;
}

export interface AuthorizedResourceRequest {
  readonly audience: Audience;
  readonly uri: string;
  readonly actorId: string;
  readonly contextId: string;
  /** Server-verified credential, never populated from widget content. */
  readonly credential: unknown;
}
export type AuthorizeWidgetResource = (
  request: AuthorizedResourceRequest,
  widget: WidgetCatalogEntry,
) => Promise<boolean>;

/** The MCP resources/read handler calls this after authentication. */
export async function loadAuthorizedWidgetResource(
  catalog: CompiledWidgetCatalog,
  map: WidgetResourceMap,
  request: AuthorizedResourceRequest,
  authorize: AuthorizeWidgetResource,
): Promise<Readonly<{
  uri: string; mimeType: WidgetMimeType; text: string;
  _meta: Readonly<{ui: WidgetUiMeta}>;
}> | null> {
  const resource = map.get(resourceKey(request.audience, request.uri));
  if (!resource) return null;
  const widget = catalog.widgets.find(w => widgetKey(w) === widgetKey(resource));
  if (!widget || !await authorize(request, widget)) return null;
  return {
    uri: resource.uri, mimeType: resource.mimeType, text: resource.text,
    _meta: {ui: resource.uiMeta},
  };
}
