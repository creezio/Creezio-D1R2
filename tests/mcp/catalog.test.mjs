import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMcpBindings, McpBindingError} from '../../scripts/mcp/bindings.mjs';
import {createMcpCatalog} from '../../core/mcp/catalog.ts';

const digest = `sha256-${'a'.repeat(64)}`;
const operation = {id: 'read', kind: 'query', context: 'application', audiences: ['admin', 'app'],
  actors: ['delegated-user'], permissions: [{moduleId: 'example.one', id: 'read'}],
  input: {schemaId: 'input'}, output: {schemaId: 'output'}};
const tool = {id: 'read', name: 'example_read', operation: {moduleId: 'example.one', id: 'read'},
  audiences: ['admin', 'app'], auth: ['oauth'], input: {schemaId: 'input'}, output: {schemaId: 'output'},
  annotations: {readOnly: true, destructive: false, idempotent: true, openWorld: false}, textFallback: true};
const descriptor = {identity: {id: 'example.one'}, contracts: {schemas: [
  {id: 'input', schema: {type: 'object', properties: {}, additionalProperties: false}},
  {id: 'output', schema: {type: 'object', properties: {ok: {type: 'boolean'}}, additionalProperties: false}}],
  mcp: {tools: [tool], resources: []}}};
const composition = {modules: [{moduleId: 'example.one', enabled: true}], exposure: {
  admin: {moduleIds: ['example.one']}, app: {moduleIds: ['example.one']}}};
const operationCatalog = {schemaVersion: 1, modules: [{moduleId: 'example.one', operations: [
  {operation, active: true, contractDigest: digest}]}]};
const compile = (module = descriptor, disabledContributions = []) => compileMcpBindings({composition,
  modules: [module], operationCatalog, disabledContributions});
const registry = {resolve(moduleId, operationId) {
  assert.equal(moduleId, 'example.one'); assert.equal(operationId, 'read');
  return {declaration: operation, contractDigest: digest};
}};

test('MCP projection has distinct admin and app indexes with canonical operation metadata', () => {
  const compiled = compile(), runtime = createMcpCatalog(compiled, registry);
  assert.equal(compiled.tools.length, 2);
  assert.equal(runtime.tools('admin')[0].name, 'example_read');
  assert.equal(runtime.tools('app')[0].audience, 'app');
  assert.deepEqual(runtime.tools('admin')[0].permissions, ['example.one:read']);
  assert.equal(runtime.tool('app', 'example_read')?.contractDigest, digest);
  assert.equal(runtime.tool('admin', 'missing'), undefined);
});

test('MCP projection excludes disabled, unexposed and inactive contributions', () => {
  assert.deepEqual(compile(descriptor, [{moduleId: 'example.one', path: '/contracts/mcp/tools/0'}]).tools, []);
  const appOnly = structuredClone(composition); appOnly.exposure.admin.moduleIds = [];
  assert.deepEqual(compileMcpBindings({composition: appOnly, modules: [descriptor], operationCatalog}).tools.map(t => t.audience), ['app']);
  const inactive = structuredClone(operationCatalog); inactive.modules[0].operations[0].active = false;
  assert.throws(() => compileMcpBindings({composition, modules: [descriptor], operationCatalog: inactive}),
    error => error instanceof McpBindingError && error.code === 'tool');
});

test('MCP projection refuses colliding names and nondelegated Access style declarations', () => {
  const duplicate = structuredClone(descriptor); duplicate.contracts.mcp.tools.push({...tool, id: 'read2'});
  assert.throws(() => compile(duplicate), error => error instanceof McpBindingError && error.code === 'collision');
  const session = structuredClone(descriptor); session.contracts.mcp.tools[0].auth = ['session'];
  assert.throws(() => compile(session), error => error instanceof McpBindingError && error.code === 'tool');
  const forged = structuredClone(compile()); forged.tools[0].contractDigest = `sha256-${'b'.repeat(64)}`;
  assert.throws(() => createMcpCatalog(forged, registry), TypeError);
});

function widgetResources(count,htmlBytes){
  const shell='<!doctype html><html><body></body></html>';
  const text=shell+'x'.repeat(htmlBytes-shell.length);
  return Array.from({length:count},(_,index)=>{
    const hash=`sha256-${index.toString(16).padStart(64,'0')}`;
    const uri=`ui://creezio/example.one/widget-${index}/1.0.0/${hash}.html`;
    return ['admin','app'].map(audience=>({id:`widget-${index}`,uri,
      mimeType:'text/html;profile=mcp-app',contributorModuleId:'example.one',audience,
      permissions:['example.one:read'],actors:['delegated-user'],context:'required',
      source:{kind:'compiled-widget',digest:hash,cspProfileId:hash,text,
        uiMeta:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},
          permissions:{},prefersBorder:true}}}));
  }).flat();
}

test('MCP catalog admits six self-contained widgets in two audiences within its aggregate bound',()=>{
  const catalog={...compile(),resources:widgetResources(6,608000)};
  const bytes=Buffer.byteLength(JSON.stringify(catalog));
  assert.ok(bytes>4*1024*1024&&bytes<16*1024*1024,bytes);
  const runtime=createMcpCatalog(catalog,registry);
  assert.equal(runtime.resources('admin').length,6);
  assert.equal(runtime.resources('app').length,6);
});

test('MCP catalog refuses aggregates above 16 MiB without relaxing the per-resource HTML bound',()=>{
  const oversized={...compile(),resources:widgetResources(14,608000)};
  assert.ok(Buffer.byteLength(JSON.stringify(oversized))>16*1024*1024);
  assert.throws(()=>createMcpCatalog(oversized,registry),TypeError);
  const oneLarge={...compile(),resources:widgetResources(1,1_048_577)};
  assert.ok(Buffer.byteLength(JSON.stringify(oneLarge))<16*1024*1024);
  assert.throws(()=>createMcpCatalog(oneLarge,registry),TypeError);
});
