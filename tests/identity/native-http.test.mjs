import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntime, RuntimeConfigurationError} from '../../core/runtime/dispatch.ts';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';

const origin = 'https://creezio.example';
const digest = 'sha256-' + '1'.repeat(64);
const noStorage = () => assert.fail('Request must be refused before storage');
const native = {id: 'creezio.access', version: '0.0.0', operations: []};
const environment = (db = {prepare: noStorage, batch: noStorage}) => ({CREEZIO_RUNTIME_PROFILE: 'local',
  CREEZIO_APP_ORIGIN: origin, DB: db, BUCKET: {get: noStorage, head: noStorage, put: noStorage, delete: noStorage}});
const runtime = (options = {}) => createRuntime({compositionDigest: digest, modules: [native], nativeAccess: {admin: true, app: true}, ...options});
const request = (route, options = {}) => new Request(origin + route, options);
const post = (route, body, headers = {}) => request(route, {method: 'POST', headers: {'content-type': 'application/json',
  origin, 'x-creezio-request': '1', ...headers}, body: JSON.stringify(body)});

test('native authentication is unavailable without its selected module and audience, with immutable host configuration', async () => {
  for (const app of [runtime({modules: [], nativeAccess: undefined}), runtime({nativeAccess: undefined}),
    runtime({nativeAccess: {admin: false, app: false}})])
    assert.equal((await app.fetch(request('/api/access/admin/session'), environment())).status, 404);
  for (const nativeAccess of [{admin: true, app: true}, {admin: 1, app: false}, {admin: true}, {admin: false, app: false, extra: true}])
    assert.throws(() => runtime({modules: [], nativeAccess}), error => error instanceof RuntimeConfigurationError);
  const flags = {admin: true, app: false}, app = runtime({nativeAccess: flags});
  flags.app = true;
  assert.equal((await app.fetch(request('/api/access/app/session'), environment())).status, 404);
  assert.equal((await app.fetch(request('/api/access/admin/session'), environment())).status, 401);
});

test('native namespace cannot be occupied by literal or parameterized module routes even while access is disabled', () => {
  for (const path of ['/api/access', '/api/access/', '/api/access/admin/login', '/api/{area}', '/api/{area}/{action}', '/api/{area}/admin/login'])
    assert.throws(() => runtime({modules: [{id: 'example.module', version: '1.0.0', operations: [{id: 'read',
      ownerModuleId: 'example.module', method: 'GET', path, access: 'public-read', maxDurationMs: 1000, handler: noStorage}]}],
      nativeAccess: undefined}), error => error.code === 'route.reserved');
});

test('only the six native endpoints exist and aliases, methods and unconfigured origins fail before storage', async () => {
  const app = runtime();
  for (const route of ['/api/access', '/api/access/bootstrap', '/api/access/admin/bootstrap', '/api/access/admin/provision',
    '/api/access/admin/reset', '/api/access/admin/impersonation', '/api/access/owner/session'])
    assert.equal((await app.fetch(request(route), environment())).status, 404);
  for (const [route, method] of [['/api/access/admin/login', 'GET'], ['/api/access/app/session', 'POST'],
    ['/api/access/admin/session', 'HEAD'], ['/api/access/admin/logout', 'OPTIONS']]) {
    const response = await app.fetch(request(route, {method}), environment());
    assert.equal(response.status, 405);
    if (method === 'HEAD') assert.equal(await response.text(), '');
  }
  for (const route of ['/api/access/admin/session/', '/%61pi/access/admin/session', '/api/access/admin/session?x=1'])
    assert.equal((await app.fetch(request(route), environment())).status, 400);
  const env = environment(); delete env.CREEZIO_APP_ORIGIN;
  assert.equal((await app.fetch(request('/api/access/admin/session'), env)).status, 503);
});

test('native transport rejects forged authority and never interprets a cookie as access to a protected module', async () => {
  const issued = await issueOpaqueToken('session');
  const app = runtime({modules: [native, {id: 'example.module', version: '1.0.0', operations: [{id: 'protected',
    ownerModuleId: 'example.module', method: 'GET', path: '/api/modules/example.module/protected', access: 'protected',
    maxDurationMs: 1000, handler: noStorage}]}]});
  for (const headers of [{authorization: `Bearer ${issued.token}`}, {'oai-authenticated-user-id': 'owner'},
    {cookie: `__Host-creezio-app=${issued.token}`}, {cookie: '__Host-creezio-admin=invalid'}])
    assert.equal((await app.fetch(request('/api/access/admin/session', {headers}), environment())).status, 401);
  const response = await app.fetch(request('/api/modules/example.module/protected', {headers: {cookie: `__Host-creezio-admin=${issued.token}`}}), environment());
  assert.equal(response.status, 401);
});

test('malformed login and logout bodies never enter account admission and server request IDs cannot be chosen by clients', async () => {
  const app = runtime();
  for (const body of [null, [], {}, {loginIdentifier: 'alice', password: 'Synthetic passphrase', audience: 'admin'},
    {loginIdentifier: 'alice', password: 42}])
    assert.equal((await app.fetch(post('/api/access/admin/login', body), environment())).status, 400);
  assert.equal((await app.fetch(post('/api/access/admin/logout', {token: 'provided-in-body'}), environment())).status, 400);
  const response = await app.fetch(post('/api/access/admin/logout', {}, {'x-creezio-request-id': 'chosen',
    cookie: '__Host-creezio-admin=malformed'}), environment());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), {ok: true});
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.notEqual(response.headers.get('x-creezio-request-id'), 'chosen');
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(response.headers.has('access-control-allow-origin'), false);
});

test('storage errors are redacted and cannot acknowledge logout or emit a login cookie', async () => {
  const token = (await issueOpaqueToken('session')).token;
  const broken = {prepare() {throw new Error('Synthetic database diagnostic, SQL and credentials must not escape');}, batch: noStorage};
  const app = runtime(), env = environment(broken);
  for (const input of [post('/api/access/admin/login', {loginIdentifier: 'alice', password: 'Synthetic passphrase'}),
    request('/api/access/admin/session', {headers: {cookie: `__Host-creezio-admin=${token}`}}),
    post('/api/access/admin/logout', {}, {cookie: `__Host-creezio-admin=${token}`})]) {
    const response = await app.fetch(input, env);
    assert.equal(response.status, 503); assert.equal(response.headers.has('set-cookie'), false);
    assert.doesNotMatch(await response.text(), /diagnostic|SQL|credentials/);
  }
});

test('aborted account requests refuse before admission and discard a storage result arriving after cancellation', {timeout: 2000}, async () => {
  const app = runtime(), controller = new AbortController(); controller.abort();
  const cancelled = request('/api/access/admin/login', {method: 'POST', signal: controller.signal,
    headers: {origin, 'content-type': 'application/json', 'x-creezio-request': '1'},
    body: JSON.stringify({loginIdentifier: 'alice', password: 'Synthetic passphrase'})});
  assert.equal((await app.fetch(cancelled, environment())).status, 499);
  let finish, entered;
  const reached = new Promise(resolve => {entered = resolve;});
  const db = {prepare(sql) {return {bind(...args) {return {sql, args,
    first() {entered(); return new Promise(resolve => {finish = resolve;});}};}};}, batch: noStorage};
  const token = (await issueOpaqueToken('session')).token, late = new AbortController();
  const pending = app.fetch(request('/api/access/admin/session', {signal: late.signal,
    headers: {cookie: `__Host-creezio-admin=${token}`}}), environment(db));
  await reached; late.abort();
  const response = await pending; assert.equal(response.status, 499); assert.equal(response.headers.has('set-cookie'), false);
  finish(null);
  await new Promise(resolve => setTimeout(resolve, 0));
});
