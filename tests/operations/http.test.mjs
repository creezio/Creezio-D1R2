import test from 'node:test';
import assert from 'node:assert/strict';
import { compileHttpBindings, HttpBindingError } from '../../scripts/operations/http-bindings.mjs';
import { createOperationHttpTransport, createDeclaredHttpDispatcher } from '../../core/operations/http.ts';
import { dispatchWorkspaceHttp } from '../../core/workspace/http.ts';
import { issueOpaqueToken } from '../../core/identity/tokens.ts';

const origin = 'https://example.invalid';
const digest = `sha256-${'a'.repeat(64)}`;
const operation = {id: 'read_record', input: {schemaId: 'read-input'}, output: {schemaId: 'read-output'},
  audiences: ['app'], actors: ['user', 'machine'], context: 'required', kind: 'query'};
const descriptor = {identity: {id: 'example.record'}, contracts: {schemas: [{id: 'read-input',
  schema: {type: 'object', properties: {id: {type: 'integer'}}, required: ['id'], additionalProperties: false}}],
  api: [{id: 'read-http', method: 'GET', path: '/api/records/{id}', operation: {moduleId: 'example.record', id: 'read_record'},
    audience: 'app', auth: ['session', 'api-token'], parameters: [{name: 'id', in: 'path', inputField: 'id', required: true}],
    input: {schemaId: 'read-input'}, output: {schemaId: 'read-output'}, rateLimit: {requests: 20, windowSeconds: 60}}]}};
const composition = {modules: [{moduleId: 'example.record', enabled: true}], exposure: {app: {moduleIds: ['example.record']}}};
const catalog = {schemaVersion: 1, modules: [{moduleId: 'example.record', operations: [{operation, active: true, contractDigest: digest}]}]};
const compile = (modules = [descriptor], disabledContributions = []) => compileHttpBindings({composition, modules,
  operationCatalog: catalog, disabledContributions});

test('front projection belongs to the host and is absent in workspace and headless modes', async () => {
  for (const path of ['/api/front','/api/front/projection','/api/{scope}/projection','/api/widgets','/api/widgets/app/catalog']) {
    const changed=structuredClone(descriptor);changed.contracts.api[0].path=path;
    assert.throws(()=>compile([changed]),error=>error instanceof HttpBindingError&&error.code==='path');
  }
  const make=kind=>createDeclaredHttpDispatcher({registry:{},dataCatalog:{},permissions:[],bindings:[],
    workspaceCatalog:{compositionDigest:digest,views:[],navigation:[]},
    frontCatalog:{compositionDigest:digest,front:{kind},views:[],navigation:[],slots:[]}});
  const request=new Request(`${origin}/api/front/projection`),environment={profile:'sites',bindings:{DB:{}}},raw={CREEZIO_APP_ORIGIN:origin};
  for(const kind of ['workspace','headless'])assert.equal(await make(kind).dispatch(request,environment,raw,'front-check'),null);
  const protectedReply=await make('theme').dispatch(request,environment,raw,'front-check');
  assert.equal(protectedReply.status,401);assert.equal(protectedReply.headers.get('cache-control'),'no-store');
});

test('canonical HTTP compiler selects only active exposure, resolves primitive codecs and refuses overlaps', () => {
  const [binding] = compile();
  assert.equal(binding.moduleId, 'example.record');
  assert.equal(binding.parameters[0].codec, 'integer');
  assert.equal(binding.contractDigest, digest);
  assert.deepEqual(compile([descriptor], [{moduleId: 'example.record', path: '/contracts/api/0'}]), []);
  const collision = structuredClone(descriptor);
  collision.contracts.api.push({...collision.contracts.api[0], id: 'other', path: '/api/records/{other}',
    parameters: [{name: 'other', in: 'path', inputField: 'id', required: true}]});
  assert.throws(() => compile([collision]), error => error instanceof HttpBindingError && error.code === 'collision');
  const complex = structuredClone(descriptor);
  complex.contracts.schemas[0].schema.properties.id.type = 'object';
  assert.throws(() => compile([complex]), error => error instanceof HttpBindingError && error.code === 'codec');
  const unmapped = structuredClone(descriptor);
  unmapped.contracts.schemas[0].schema.properties.extra = {type: 'string'};
  unmapped.contracts.schemas[0].schema.required.push('extra');
  assert.throws(() => compile([unmapped]), error => error instanceof HttpBindingError && error.code === 'input-mapping');
  const contributor = {identity: {id: 'example.wrapper'}, contracts: {schemas: [], api: [{...descriptor.contracts.api[0],
    id: 'wrapper-read', path: '/api/wrapped/{id}'}]}};
  const cross = compileHttpBindings({composition: {modules: [{moduleId: 'example.record', enabled: true},
    {moduleId: 'example.wrapper', enabled: true}], exposure: {app: {moduleIds: ['example.wrapper']}}},
    modules: [descriptor, contributor], operationCatalog: catalog});
  assert.equal(cross.length, 1);
  assert.equal(cross[0].contributorModuleId, 'example.wrapper');
  assert.equal(cross[0].moduleId, 'example.record');
  assert.equal(cross[0].parameters[0].codec, 'integer');
});

test('HTTP mappings accept camelCase input fields without admitting prototype keys or changing URL names', () => {
  for (const field of ['principalId', 'beforeCreatedAtMs', 'record_id', 'record-id']) {
    const value = structuredClone(descriptor);
    value.contracts.schemas[0].schema.properties = {[field]: {type: 'integer'}};
    value.contracts.schemas[0].schema.required = [field];
    value.contracts.api[0].parameters[0].inputField = field;
    const [binding] = compile([value]);
    assert.equal(binding.parameters[0].inputField, field);
    assert.equal(binding.parameters[0].name, 'id');
  }
  for (const field of ['__proto__', 'constructor', 'prototype', 'id/name', 'x'.repeat(129)]) {
    const value = structuredClone(descriptor);
    value.contracts.schemas[0].schema.properties = {[field]: {type: 'integer'}};
    value.contracts.schemas[0].schema.required = [field];
    value.contracts.api[0].parameters[0].inputField = field;
    assert.throws(() => compile([value]), error => error instanceof HttpBindingError && error.code === 'parameters');
  }
});

function db() {
  const calls = [];
  return {calls, prepare(sql) {return {bind(...args) {return {sql, args};}};},
    async batch(statements) {calls.push(statements); return statements.map((_, index) => ({success: true, results: index === 1
      ? [{attempts: 1, retryAtMs: Date.now() + 60000}] : []}));}};
}
const execution = {id: 'execution-1', state: 'succeeded', output: {id: 42}, errorCode: null};
function fixture(binding = compile()[0]) {
  const calls = [], database = db();
  const engine = {async invoke(value) {calls.push(['invoke', value]); return {execution, replayed: false};},
    async status(value) {calls.push(['status', value]); return execution;},
    async lookup(value) {calls.push(['lookup', value]); return execution;}};
  return {calls, database, transport: createOperationHttpTransport([binding], engine),
    environment: {profile: 'sites', bindings: {DB: database}}, raw: {CREEZIO_APP_ORIGIN: origin}};
}
const request = (url, options = {}) => new Request(`${origin}${url}`, options);
const cookie = token => `__Host-creezio-app=${token}`;
const keyHeader = value => Buffer.from(value, 'utf8').toString('base64url');

test('approval reference is host metadata, not business input or a lookup capability', async () => {
  const token = (await issueOpaqueToken('session')).token, f = fixture();
  const headers = {cookie: cookie(token), 'x-creezio-context': 'client-a', 'x-creezio-approval-id': 'approval-1'};
  const result = await f.transport.dispatch(request('/api/records/42', {headers}), f.environment, f.raw, 'approval-request');
  assert.equal(result.status, 200);
  assert.equal(f.calls[0][1].approvalId, 'approval-1');
  assert.deepEqual({...f.calls[0][1].input}, {id: 42});
  for (const approvalId of ['', 'id,other', 'x'.repeat(129), 'id/other']) {
    const bad = fixture();
    const reply = await bad.transport.dispatch(request('/api/records/42', {headers: {...headers, 'x-creezio-approval-id': approvalId}}), bad.environment, bad.raw, 'invalid-approval');
    assert.equal(reply.status, 400);
    assert.equal(bad.calls.length, 0);
    assert.equal(bad.database.calls.length, 0);
  }
  for (const path of ['/api/operations/status/example.record/read-http/execution-1', '/api/operations/lookup/example.record/read-http']) {
    const read = fixture();
    const reply = await read.transport.dispatch(request(path, {headers: {...headers, 'x-creezio-request-key': keyHeader('request-1')}}), read.environment, read.raw, 'approval-read');
    assert.equal(reply.status, 400);
    assert.equal(read.calls.length, 0);
  }
});

test('HTTP compiler reserves host security and reconciliation headers', () => {
  for (const name of ['x-creezio-context', 'x-creezio-request', 'x-creezio-request-key', 'x-creezio-approval-id']) {
    const value = structuredClone(descriptor);
    value.contracts.api[0].path = '/api/records';
    value.contracts.api[0].parameters[0] = {name, in: 'header', inputField: 'id', required: true};
    assert.throws(() => compile([value]), error => error instanceof HttpBindingError && error.code === 'parameters');
  }
});

test('HTTP input uses exact binding and context; status rechecks through engine with same binding', async () => {
  const token = (await issueOpaqueToken('session')).token, f = fixture();
  const headers = {cookie: cookie(token), 'x-creezio-context': 'client-a'};
  const result = await f.transport.dispatch(request('/api/records/42', {headers}), f.environment, f.raw, 'request-1');
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {execution: {id: 'execution-1', state: 'succeeded', output: {id: 42},
    errorCode: null, replayed: false}});
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual({...f.calls[0][1].input}, {id: 42});
  assert.equal(f.calls[0][1].contextId, 'client-a');
  const status = await f.transport.dispatch(request('/api/operations/status/example.record/read-http/execution-1', {headers}),
    f.environment, f.raw, 'request-2');
  assert.equal(status.status, 200);
  assert.equal(f.calls[1][0], 'status');
  assert.equal(f.calls[1][1].executionId, 'execution-1');
  assert.equal(f.database.calls.length, 4);
});

test('lookup uses a header key, the status admission bucket, and never invokes', async () => {
  const token = (await issueOpaqueToken('session')).token, f = fixture();
  const headers = {cookie: cookie(token), 'x-creezio-context': 'client-a', 'x-creezio-request-key': keyHeader('request-1')};
  const path = '/api/operations/lookup/example.record/read-http';
  const found = await f.transport.dispatch(request(path, {headers}), f.environment, f.raw, 'request-lookup');
  assert.equal(found.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'lookup');
  assert.equal(f.calls[0][1].requestKey, 'request-1');
  const absent = await f.transport.dispatch(request(path, {headers: {cookie: cookie(token), 'x-creezio-context': 'client-a'}}),
    f.environment, f.raw, 'request-missing-key');
  assert.equal(absent.status, 400);
  const query = await f.transport.dispatch(request(`${path}?key=request-1`, {headers}), f.environment, f.raw, 'request-query');
  assert.equal(query.status, 400);
  const encoded = await f.transport.dispatch(request(path, {headers: {...headers, 'content-encoding': 'gzip'}}),
    f.environment, f.raw, 'request-body');
  assert.equal(encoded.status, 400);
  for (const value of ['  clé \u0000 🧭  ', 'a'.repeat(512)]) {
    const response = await f.transport.dispatch(request(path, {headers: {...headers, 'x-creezio-request-key': keyHeader(value)}}),
      f.environment, f.raw, 'request-unicode');
    assert.equal(response.status, 200);
    assert.equal(f.calls.at(-1)[1].requestKey, value);
  }
  for (const value of ['request-1', keyHeader('a'.repeat(513)), 'YQ=', '/w']) {
    const response = await f.transport.dispatch(request(path, {headers: {...headers, 'x-creezio-request-key': value}}),
      f.environment, f.raw, 'request-invalid-key');
    assert.equal(response.status, 400);
  }
  assert.equal(f.calls.length, 3);
});

test('present Bearer cannot fall back to session; unknown query and noncanonical primitives are refused', async () => {
  const token = (await issueOpaqueToken('session')).token, f = fixture();
  const headers = {cookie: cookie(token), 'x-creezio-context': 'client-a', authorization: 'Bearer bad'};
  const invalidBearer = await f.transport.dispatch(request('/api/records/42', {headers}), f.environment, f.raw, 'request-1');
  assert.equal(invalidBearer.status, 401);
  assert.equal(f.calls.length, 0);
  for (const path of ['/api/records/42?extra=1', '/api/records/01']) {
    const response = await f.transport.dispatch(request(path, {headers: {cookie: cookie(token), 'x-creezio-context': 'client-a'}}),
      f.environment, f.raw, 'request-2');
    assert.equal(response.status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('cookie mutation requires exact origin/CSRF and refuses body/path collisions', async () => {
  const binding = {...compile()[0], kind: 'command', method: 'PATCH'};
  const token = (await issueOpaqueToken('session')).token, f = fixture(binding);
  const base = {cookie: cookie(token), 'x-creezio-context': 'client-a', 'content-type': 'application/json'};
  const noCsrf = await f.transport.dispatch(request('/api/records/42', {method: 'PATCH', headers: base, body: '{}'}),
    f.environment, f.raw, 'request-1');
  assert.equal(noCsrf.status, 403);
  const collision = await f.transport.dispatch(request('/api/records/42', {method: 'PATCH', headers: {...base,
    origin, 'x-creezio-request': '1'}, body: '{"id":42}'}), f.environment, f.raw, 'request-2');
  assert.equal(collision.status, 400);
  assert.equal((await collision.json()).error.code, 'argument_collision');
  assert.equal(f.calls.length, 0);
});

test('HEAD has no body and workspace projection refuses bearer and absent browser session', async () => {
  const f = fixture(), path = '/api/records/42';
  const head = await f.transport.dispatch(request(path, {method: 'HEAD'}), f.environment, f.raw, 'request-head');
  assert.equal(head.status, 405); assert.equal(await head.text(), '');
  assert.equal(head.headers.get('cache-control'), 'no-store');
  const options = {permissions: [], catalog: {compositionDigest: digest, views: [], navigation: []}};
  const token = (await issueOpaqueToken('session')).token;
  const bearer = await dispatchWorkspaceHttp(request('/api/workspace/app/projection', {headers: {
    authorization: 'Bearer invalid', cookie: cookie(token)}}), f.environment, f.raw, 'request-workspace', options);
  assert.equal(bearer.status, 401);
  const missing = await dispatchWorkspaceHttp(request('/api/workspace/app/projection'), f.environment, f.raw,
    'request-workspace-missing', options);
  assert.equal(missing.status, 401);
  const workspaceHead = await dispatchWorkspaceHttp(request('/api/workspace/app/projection', {method: 'HEAD'}),
    f.environment, f.raw, 'request-workspace-head', options);
  assert.equal(workspaceHead.status, 405); assert.equal(await workspaceHead.text(), '');
});

test('OAuth Bearer reaches the engine with its canonical audience resource and cannot fall back to a cookie', async () => {
  const binding = {...compile()[0], auth: ['oauth']}, f = fixture(binding);
  const oauth = (await issueOpaqueToken('oauth-access')).token;
  const headers = {'x-creezio-context': 'client-a', authorization: `Bearer ${oauth}`};
  const response = await f.transport.dispatch(request('/api/records/42', {headers}),
    f.environment, f.raw, 'request-oauth');
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[0][1].credential,
    {kind: 'oauth', token: oauth, resource: `${origin}/mcp/app`});
  const status = await f.transport.dispatch(request('/api/operations/status/example.record/read-http/execution-1', {headers}),
    f.environment, f.raw, 'request-oauth-status');
  assert.equal(status.status, 200);
  assert.deepEqual(f.calls[1][1].credential,
    {kind: 'oauth', token: oauth, resource: `${origin}/mcp/app`});
  const machine = (await issueOpaqueToken('api-token')).token;
  const rejected = await f.transport.dispatch(request('/api/records/42', {headers: {...headers,
    authorization: `Bearer ${machine}`, cookie: cookie(oauth)}}), f.environment, f.raw, 'request-wrong-kind');
  assert.equal(rejected.status, 401);
  const missing = await f.transport.dispatch(request('/api/records/42', {headers: {'x-creezio-context': 'client-a'}}),
    f.environment, f.raw, 'request-missing');
  assert.equal(missing.status, 401);
  assert.equal(f.calls.length, 2);
});
