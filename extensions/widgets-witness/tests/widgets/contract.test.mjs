import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {compileWidgetCatalog, projectWidgetProviderTools} from '../../../../scripts/widgets/compile.mjs';
import {compileMcpBindings} from '../../../../scripts/mcp/bindings.mjs';
import {contractIntegrity} from '../../../../sdk/contracts/validate.mjs';
import {callWitnessRead, witnessRecordFromTool, witnessRenameOutcome} from '../../ui/widgets/runtime.ts';
import {widgetModelContextPayload} from '../../../../sdk/widgets/model-context.ts';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('module/manifest.json', root), 'utf8'));
const moduleId = manifest.identity.id;
const composition = {modules: [{moduleId, enabled: true}],
  exposure: {admin: {moduleIds: [moduleId]}, app: {moduleIds: [moduleId]}}};
const operationCatalog = {schemaVersion: 1, modules: [{moduleId,
  operations: manifest.contracts.operations.map(operation => ({operation, active: true,
    contractDigest: contractIntegrity({moduleVersion: manifest.identity.version, operation,
      schemas: [...manifest.contracts.schemas].sort((a, b) => a.id.localeCompare(b.id))})}))}]};
const readAsset = (_id, relative) => readFileSync(new URL(relative, root), 'utf8');
const bundleRenderer = (_id, reference) => {
  const source = fileURLToPath(new URL(reference.path, root));
  const result = buildSync({entryPoints: [source], bundle: true, write: false, platform: 'browser',
    format: 'iife', globalName: '__creezioWidget', target: 'es2022', minify: true, logLevel: 'silent',
    footer: {js: `__creezioWidget.${reference.export}();`}});
  return result.outputFiles[0].text;
};

test('two real MCP Apps resources compile with action targets, digests and tool links', () => {
  const widgets = compileWidgetCatalog({composition, modules: [manifest], operationCatalog,
    readAsset, bundleRenderer});
  assert.equal(widgets.widgets.length, 2);
  assert.equal(widgets.resources.length, 2);
  assert.deepEqual(widgets.widgets.map(widget => widget.actions.map(action => action.mode)),
    [['message', 'context', 'direct', 'direct'], ['message', 'context', 'direct']]);
  const card = widgets.widgets.find(widget => widget.widgetId === 'record-card');
  const read = card.actions.find(action => action.id === 'card.read_record');
  const rename = card.actions.find(action => action.id === 'card.rename_record');
  assert.equal(read.target.operationKind, 'query');
  assert.equal(Object.hasOwn(read.target, 'idempotencyKeyField'), false);
  assert.equal(rename.target.operationKind, 'command');
  assert.equal(rename.target.idempotencyKeyField, 'request_key');
  assert.deepEqual(card.serverTools.map(tool => [tool.actionId, tool.operationKind,
    tool.idempotencyKeyField]), [
    ['card.read_record', 'query', null],
    ['card.rename_record', 'command', 'request_key'],
  ]);
  const picker = widgets.widgets.find(widget => widget.widgetId === 'record-picker');
  assert.deepEqual(picker.serverTools.map(tool => [tool.actionId, tool.toolName]),
    [['picker.read_record', 'witness_picker_read']]);
  assert.ok(widgets.resources.every(resource => resource.text.includes('ui/initialize')
    && resource.uri.endsWith(`/${resource.digest}.html`)
    && resource.cspProfileId === widgets.resources[0].cspProfileId));
  const mcp = compileMcpBindings({composition, modules: [manifest], operationCatalog, widgetCatalog: widgets});
  assert.equal(mcp.tools.length, 6);
  assert.equal(mcp.resources.length, 4);
  assert.ok(mcp.tools.every(tool => tool.ui?.resourceUri.startsWith('ui://creezio/')));
  assert.ok(mcp.resources.every(resource => resource.source.kind === 'compiled-widget'));
  assert.ok(mcp.tools.filter(tool => tool.operationId === 'rename_record')
    .every(tool => tool.annotations.readOnly === false));
  const canonical = manifest.contracts.operations.map(operation => ({moduleId, operationId: operation.id,
    inputSchema: manifest.contracts.schemas.find(item => item.id === operation.input.schemaId).schema,
    schemaDigest: contractIntegrity(operation.input), audiences: operation.audiences}));
  const projected = projectWidgetProviderTools(mcp, canonical);
  assert.deepEqual(projected.slice(0, 2).map(tool => [tool.widget.widgetId, tool.operationId]),
    [['record-card', 'read_record'], ['record-picker', 'read_record']]);
  assert.ok(projected.slice(0, 2).every(tool => tool.widget.operationDigest.startsWith('sha256-')));
  assert.equal(projected[1].widget.toolName, picker.serverTools[0].toolName);
  assert.ok(projected.slice(2).every(tool => !tool.widget));
});

test('picker calls its own read tool and card accepts native and MCP direct results', async () => {
  const record = {id: 'alpha', title: 'Renommée', revision: 2};
  const calls = [];
  const client = {async callServerTool(request) {
    calls.push(request);
    return {isError: false, structuredContent: {kind: 'creezio.widget.action.v1',
      state: 'succeeded', code: 'succeeded', output: record}};
  }};
  assert.deepEqual(await callWitnessRead(client, 'picker', 'alpha'), {isError: false, output: record});
  assert.deepEqual(calls, [{name: 'witness_picker_read', arguments: {id: 'alpha'}}]);
  assert.deepEqual(witnessRecordFromTool({kind: 'creezio.widget.render.v1', input: record}), record);
  assert.deepEqual(witnessRecordFromTool({kind: 'creezio.widget.action.v1',
    state: 'succeeded', output: record}), record);
  assert.equal(witnessRecordFromTool({kind: 'creezio.widget.action.v1',
    state: 'transmitted', output: record}), null);
});

test('card rename distinguishes uncertain native actions from refused commands', () => {
  const action = state => ({isError: true,
    structuredContent: {kind: 'creezio.widget.action.v1', state, code: state}});
  assert.equal(witnessRenameOutcome(action('unknown')), 'uncertain');
  assert.equal(witnessRenameOutcome(action('transmitted')), 'uncertain');
  assert.equal(witnessRenameOutcome(action('running')), 'uncertain');
  assert.equal(witnessRenameOutcome(action('rejected')), 'rejected');
  assert.equal(witnessRenameOutcome({isError: true}), 'rejected');
  assert.equal(witnessRenameOutcome({isError: false,
    structuredContent: {kind: 'creezio.widget.action.v1', state: 'succeeded'}}), 'succeeded');
});

test('a disabled widget contribution does not publish its HTML', () => {
  const widgetCatalog = compileWidgetCatalog({composition, modules: [manifest], operationCatalog,
    readAsset, bundleRenderer, disabledContributions: [{moduleId, path: '/contracts/widgets/1'}]});
  assert.deepEqual(widgetCatalog.widgets.map(widget => widget.widgetId), ['record-card']);
});

test('context replacement and removal use the host-specific MCP Apps payload', () => {
  const record={id:'alpha',title:'Alpha',revision:1};
  assert.deepEqual(widgetModelContextPayload('Creezio','card.context',record),
    {structuredContent:{creezioWidgetAction:{actionId:'card.context',input:record}}});
  assert.deepEqual(widgetModelContextPayload('Creezio','card.context',record,true),
    {structuredContent:{creezioWidgetAction:{actionId:'card.context',input:record,remove:true}}});
  assert.deepEqual(widgetModelContextPayload('ChatGPT','card.context',record),
    {structuredContent:record});
  assert.deepEqual(widgetModelContextPayload('ChatGPT','card.context',record,true),
    {structuredContent:{}});
  assert.deepEqual(widgetModelContextPayload(undefined,'picker.context',record,true),
    {structuredContent:{}});
  for(const resource of ['card.html','picker.html'])
    assert.match(readFileSync(new URL(`ui/widgets/${resource}`,root),'utf8'),/id="remove-context"/);
});
