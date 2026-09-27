import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const file = fileURLToPath(new URL('./manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(file, 'utf8'));
const moduleId = 'example.widgets-witness';
const ref = (kind, id) => ({moduleId, kind, id});
const schema = schemaId => ({schemaId});
const permissions = [ref('permission', 'read')];
if (!manifest.contracts.schemas.some(item => item.id === 'widget-state'))
  manifest.contracts.schemas.push({id: 'widget-state', schema: {
    type: 'object', properties: {}, required: [], additionalProperties: false,
  }});
manifest.identity.id = moduleId;
manifest.identity.title = 'Widgets MCP Apps witness';
manifest.identity.source.revision = 't16-widgets-witness-v1';
manifest.validation.suites.widgets = {mode: 'required', script: 'ci/widgets.mjs', tests: ['tests/widgets/contract.test.mjs']};
manifest.packaging.validationBinding.moduleId = moduleId;
manifest.packaging.validationBinding.sourceRevision = 't16-widgets-witness-v1';
manifest.packaging.validation.files = [...new Set([...manifest.packaging.validation.files,
  'module/generate-manifest.mjs'])];
manifest.packaging.runtime.files = [...new Set([...manifest.packaging.runtime.files,
  'ui/widgets/card.html', 'ui/widgets/picker.html', 'ui/widgets/card.ts', 'ui/widgets/picker.ts',
  'ui/widgets/runtime.ts', 'ui/widgets/message.txt'])];
for (const p of manifest.contracts.permissions) p.actors = [...new Set([...p.actors, 'delegated-user'])];
for (const op of manifest.contracts.operations) op.actors = [...new Set([...op.actors, 'delegated-user'])];
const mcpTool = (id, name, operationId, inputId, outputId, widgetId, readOnly) => ({
  id, name, operation: ref('operation', operationId), audiences: ['admin', 'app'], auth: ['oauth'],
  input: schema(inputId), output: schema(outputId),
  annotations: {readOnly, destructive: !readOnly, idempotent: true, openWorld: false},
  widget: ref('widget', widgetId), textFallback: true,
});
manifest.contracts.mcp.tools = [
  mcpTool('card.read', 'witness_card_read', 'read_record', 'read-input', 'record-output', 'record-card', true),
  mcpTool('card.rename', 'witness_card_rename', 'rename_record', 'rename-input', 'record-output', 'record-card', false),
  mcpTool('picker.read', 'witness_picker_read', 'read_record', 'read-input', 'record-output', 'record-picker', true),
];
const resource = (id, widgetId, path) => ({
  id, uri: `ui://example.widgets-witness/${widgetId}`, mimeType: 'text/html;profile=mcp-app',
  audiences: ['admin', 'app'], permissions,
  source: {kind: 'asset', path}, widget: ref('widget', widgetId),
  ui: {csp: {connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: []},
    permissions: {}, prefersBorder: true},
});
manifest.contracts.mcp.resources = [
  resource('record-card-ui', 'record-card', 'ui/widgets/card.html'),
  resource('record-picker-ui', 'record-picker', 'ui/widgets/picker.html'),
];
const instance = {identity: 'host-generated', revision: 'monotonic',
  correlation: 'request-instance-conversation', objectVersion: 'distinct', lateResponse: 'reject-stale'};
const transport = {protocol: 'mcp-apps', maxPayloadBytes: 65536, timeoutMs: 15000,
  uncertainResult: 'reconcile-before-retry', fallbackDispatch: 'before-first-dispatch-only'};
const contextTarget = {namespace: 'module-instance', fields: ['id', 'title', 'revision'],
  scope: ['actor', 'conversation', 'surface'], expiresAfterSeconds: 3600,
  replace: true, removable: true, revisionField: 'revision'};
const message = id => ({id: `${id}.message`, label: 'Partager la fiche', input: schema('record-output'),
  requiredCapabilities: [], fallback: 'copy-message', mode: 'message',
  target: {template: 'ui/widgets/message.txt', preview: true, voluntarySend: true,
    states: ['proposed', 'transmitted', 'refused', 'unknown']}});
const context = id => ({id: `${id}.context`, label: 'Ajouter au contexte', input: schema('record-output'),
  requiredCapabilities: [], fallback: 'local-untransmitted-context', mode: 'context', target: contextTarget});
const direct = (id, operationId, inputId) => ({id: `${id}.${operationId}`, label: operationId,
  input: schema(inputId), requiredCapabilities: [], fallback: 'unavailable', mode: 'direct',
  target: {kind: 'operation', operation: ref('operation', operationId)}});
const widget = (id, resourceId, rendererPath, actions) => ({
  id, version: '1.0.0', compatibility: '^1.0.0', resource: resourceId,
  renderer: {path: rendererPath, export: 'startWidget'},
  input: schema('record-output'), state: schema('widget-state'), result: schema('record-output'),
  audiences: ['admin', 'app'], permissions, requiredCapabilities: [], assets: [],
  actions, instance, transport,
});
manifest.contracts.widgets = [
  widget('record-card', 'record-card-ui', 'ui/widgets/card.ts', [
    message('card'), context('card'), direct('card', 'read_record', 'read-input'),
    direct('card', 'rename_record', 'rename-input')]),
  widget('record-picker', 'record-picker-ui', 'ui/widgets/picker.ts', [
    message('picker'), context('picker'), direct('picker', 'read_record', 'read-input')]),
];
manifest.lifecycle.absent = Object.fromEntries(Object.entries(manifest.lifecycle.absent)
  .filter(([name]) => name !== 'widgets'));
const text = JSON.stringify(manifest).replaceAll('example.widgets-witness', moduleId)
  .replaceAll('t16-widgets-witness-v1', 't16-widgets-witness-v1');
writeFileSync(file, JSON.stringify(JSON.parse(text), null, 2) + '\n');
