import test from 'node:test';
import assert from 'node:assert/strict';
import { compileHttpBindings, HttpBindingError } from '../../scripts/operations/http-bindings.mjs';
import { createOperationHttpTransport } from '../../core/operations/http.ts';
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

test('declared but unqualified transport auth reports unavailable without invoking the engine', async () => {
  const binding = {...compile()[0], auth: ['oauth']}, f = fixture(binding);
  const response = await f.transport.dispatch(request('/api/records/42', {headers: {'x-creezio-context': 'client-a'}}),
    f.environment, f.raw, 'request-unsupported');
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error.code, 'capability_unavailable');
  assert.equal(f.calls.length, 0);
});
