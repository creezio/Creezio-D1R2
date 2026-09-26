import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { generateD1Schema } from '../../scripts/data/d1-schema.mjs';
import { assertWorkerBoundary } from '../../scripts/build/worker-boundary.mjs';
import { createIdentityQualificationState } from './harness/d1-state.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://creezio.example', loginIdentifier = 'native-http@example.invalid';
const password = 'Synthetic native HTTP qualification password';
const models = JSON.parse(readFileSync(join(root, 'extensions/native/access/module/models.json'), 'utf8'));
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const path = (operation, audience = 'admin') => `/api/access/${audience}/${operation}`;
const postHeaders = { origin, 'x-creezio-request': '1', 'content-type': 'application/json' };
const key = (domain, value = '') => `sha256:${createHash('sha256').update(`creezio:identity-admission:v1:${domain}:${value}`).digest('hex')}`;
const digest = token => `sha256:${createHash('sha256').update(`creezio:credential:v1:session:${token}`).digest('hex')}`;
const json = response => JSON.parse(response.body);

test('native HTTP uses the real dispatcher, bounded requests, audience cookies and current D1 sessions', { timeout: 90000 }, async t => {
  const schema = generateD1Schema('creezio.access', models), table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/runtime/dispatch.ts', 'core/identity/http.ts'] });
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-native-http-worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundle.metafile.outputs)) assert.deepEqual(output.imports, []);
  const state = createIdentityQualificationState(root);
  const worker = { modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15',
    d1Databases: { DB: 'creezio-native-http-synthetic' }, r2Buckets: { BUCKET: 'creezio-native-http-synthetic-files' } };
  const options = { host: '127.0.0.1', port: 0, cf: false, d1Persist: join(state.directory, 'd1'), r2Persist: false,
    workers: [{ ...worker, name: 'native-http', bindings: { CREEZIO_RUNTIME_PROFILE: 'local', CREEZIO_APP_ORIGIN: origin } },
      { ...worker, name: 'control', bindings: { CREEZIO_RUNTIME_PROFILE: 'local', CREEZIO_APP_ORIGIN: origin, QUALIFICATION_ROLE: 'control' } }] };
  let instance, db, control, failed = false, owner, adminCookie, appCookie;
  async function bounded(operation, milliseconds = 5000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External native HTTP qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function start() {
    instance = new Miniflare(options); await bounded(() => instance.ready);
    db = await instance.getD1Database('DB', 'native-http'); control = await instance.getWorker('control');
  }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await control.fetch('http://internal-native-http-fixture/', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) });
      const result = await response.json(); if (response.status !== 200) throw new Error(result.error?.message ?? 'Internal qualification failed.');
      return result.value;
    }, method === 'invoke' && args[0].stream === 'timeout' ? 12500 : 5000);
  }
  async function request(urlPath, { method = 'GET', headers = {}, body } = {}) {
    return bounded(async () => {
      const response = await instance.dispatchFetch(`${origin}${urlPath}`, { method, headers, body });
      return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
    });
  }
  const invoke = specification => call('invoke', { url: `${origin}${path('login')}`, method: 'POST', headers: postHeaders,
    body: JSON.stringify({ loginIdentifier, password }), ...specification });
  const login = (audience = 'admin', headers = {}) => request(path('login', audience), { method: 'POST', headers: { ...postHeaders, ...headers }, body: JSON.stringify({ loginIdentifier, password }) });
  const session = (cookie, audience = 'admin', headers = {}) => request(path('session', audience), { headers: { cookie, ...headers } });
  const logout = (cookie, audience = 'admin') => request(path('logout', audience), { method: 'POST', headers: { ...postHeaders, cookie }, body: '{}' });
  const rows = async (id, where = '', values = []) => (await db.prepare(`SELECT * FROM ${table(id)} ${where}`).bind(...values).all()).results;
  async function snapshot() {
    const result = {};
    for (const id of Object.keys(schema.tables).filter(id => id !== 'auth_throttles').sort())
      result[id] = (await rows(id)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return result;
  }
  async function check(name, operation) {
    await db.prepare(`UPDATE ${table('auth_throttles')} SET expires_at_ms=0`).run();
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Native HTTP qualification stopped after: ${name}`);
  }
  function safeResponse(response, status) {
    assert.equal(response.status, status); assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff'); assert.match(response.headers['content-type'], /^application\/json/);
    assert.match(response.headers['x-creezio-request-id'], /^[a-f0-9-]{36}$/);
    assert.equal(response.headers['access-control-allow-origin'], undefined); assert.equal(response.headers['access-control-allow-credentials'], undefined);
    if (response.body) {
      const value = json(response);
      if (value.requestId) assert.equal(value.requestId, response.headers['x-creezio-request-id']);
      for (const forbidden of [password, '$argon2id$', 'secret_hash', 'Synthetic private']) assert.equal(response.body.includes(forbidden), false);
    }
  }
  function cookie(response, audience, local = false) {
    safeResponse(response, 200);
    const value = response.headers['set-cookie']; assert.ok(value);
    assert.match(value, new RegExp(`^${local ? 'creezio-local' : '__Host-creezio'}-${audience}=cz1s_[A-Za-z0-9_-]{43};`));
    for (const attribute of ['Path=/', 'HttpOnly', 'SameSite=Strict']) assert.ok(value.includes(attribute));
    assert.equal(/(?:^|;)\s*Domain=/i.test(value), false); assert.equal(/(?:^|;)\s*Secure(?:;|$)/i.test(value), !local);
    const expires = Date.parse(/Expires=([^;]+)/i.exec(value)?.[1]);
    assert.equal(expires, Math.floor(json(response).session.expiresAtMs / 1000) * 1000);
    assert.ok(expires > json(response).session.createdAtMs && expires - json(response).session.createdAtMs <= 28800000);
    const pair = value.split(';', 1)[0], token = pair.slice(pair.indexOf('=') + 1);
    assert.equal(response.body.includes(token), false);
    assert.deepEqual(Object.keys(json(response).session).sort(), ['audience', 'createdAtMs', 'displayName', 'expiresAtMs', 'id', 'principalId']);
    assert.equal(json(response).session.audience, audience); return pair;
  }
  async function seedThrottle(domain, value, attempts) {
    await db.prepare(`INSERT INTO ${table('auth_throttles')} (key,window_start_ms,attempts,expires_at_ms) VALUES (?,${NOW},?,${NOW}+60000)
      ON CONFLICT(key) DO UPDATE SET window_start_ms=excluded.window_start_ms,attempts=excluded.attempts,expires_at_ms=excluded.expires_at_ms`)
      .bind(key(domain, value), attempts).run();
  }
  async function restoreRow(id, record, primaryKey) {
    const columns = Object.keys(record).filter(column => column !== primaryKey);
    await db.prepare(`UPDATE ${table(id)} SET ${columns.map(column => `"${column}"=?`).join(',')} WHERE "${primaryKey}"=?`)
      .bind(...columns.map(column => record[column]), record[primaryKey]).run();
  }
  try {
    await start(); await db.batch(schema.statements.map(sql => db.prepare(sql)));
    owner = await call('bootstrap', { loginIdentifier, displayName: 'Synthetic HTTP account', password }); assert.equal(owner.ok, true);

    await check('only the six selected native routes exist; methods, aliases, queries and configuration fail before storage', async () => {
      const cases = [
        { url: `${origin}/api/access/admin/bootstrap`, status: 404 }, { url: `${origin}/api/access/bootstrap`, status: 404 },
        { url: `${origin}/api/access/admin/impersonation`, status: 404 },
        ...['GET', 'HEAD', 'OPTIONS'].map(method => ({ method, body: undefined, status: 405 })),
        { url: `${origin}${path('session')}`, method: 'POST', status: 405 },
        { url: `${origin}${path('login')}?audience=app`, status: 400 }, { url: `${origin}${path('login')}/`, status: 400 },
        { url: `${origin}/api/%61ccess/admin/login`, status: 400 },
        { mode: 'absent', status: 404 }, { mode: 'admin-only', url: `${origin}${path('login', 'app')}`, status: 404 },
        { environment: { CREEZIO_APP_ORIGIN: '' }, status: 503 },
        { environment: { CREEZIO_APP_ORIGIN: 'https://creezio.example/path' }, status: 503 },
      ];
      for (const item of cases) {
        const { status, ...specification } = item, result = await invoke(specification);
        safeResponse(result, status); assert.equal(result.stats.prepares, 0); assert.equal(result.headers['set-cookie'], undefined);
      }
      assert.equal((await rows('sessions')).length, 0);
      safeResponse(await request('/api/modules/example.protected/status'), 401);
    });

    await check('real login commits only digests, emits distinct secure cookies and projects no credential or version', async () => {
      adminCookie = cookie(await login(), 'admin'); appCookie = cookie(await login('app'), 'app');
      assert.notEqual(adminCookie.split('=')[1], appCookie.split('=')[1]);
      for (const [pair, audience] of [[adminCookie, 'admin'], [appCookie, 'app']]) {
        const response = await session(`${adminCookie}; ${appCookie}`, audience); safeResponse(response, 200);
        assert.equal(json(response).session.principalId, owner.principalId); assert.equal(response.headers['set-cookie'], undefined);
        assert.deepEqual(Object.keys(json(response).session).sort(), ['audience', 'createdAtMs', 'displayName', 'expiresAtMs', 'id', 'principalId']);
        const token = pair.slice(pair.indexOf('=') + 1), persisted = await rows('sessions', 'WHERE secret_hash=?', [digest(token)]);
        assert.equal(persisted.length, 1); assert.equal(persisted[0].audience, audience);
        assert.equal(JSON.stringify(await snapshot()).includes(token), false);
      }
      safeResponse(await request('/api/modules/example.protected/status', { headers: { cookie: adminCookie } }), 401);
    });

    await check('a delayed session refusal cannot overwrite the cookie from a more recent login', async () => {
      const oldToken = await call('opaqueToken', 'session');
      const oldResponse = await session(`__Host-creezio-admin=${oldToken}`);
      safeResponse(oldResponse, 401);
      const loginResponse = await login(), freshCookie = cookie(loginResponse, 'admin');
      // Synthetic delivery order, not a browser qualification: apply the login
      // first and the older GET last, as the browser would apply Set-Cookie.
      let deliveredCookie = '';
      for (const response of [loginResponse, oldResponse]) {
        const update = response.headers['set-cookie'];
        if (update) deliveredCookie = update.split(';', 1)[0];
      }
      assert.equal(oldResponse.headers['set-cookie'], undefined);
      assert.equal(deliveredCookie, freshCookie);
      const current = await session(deliveredCookie);
      safeResponse(current, 200);
      assert.equal(json(current).session.id, json(loginResponse).session.id);
      assert.equal(current.headers['set-cookie'], undefined);
    });

    await check('canonical origin, CSRF and request metadata reject forged hosts and cross-site requests before D1', async () => {
      const bad = [
        { headers: { 'x-creezio-request': '1', 'content-type': 'application/json' } },
        ...['null', 'https://evil.example', `${origin}, ${origin}`].map(value => ({ headers: { ...postHeaders, origin: value } })),
        { headers: { origin, 'content-type': 'application/json' } },
        { headers: { ...postHeaders, 'x-creezio-request': '0' } },
        { headers: { ...postHeaders, 'sec-fetch-site': 'cross-site' } },
        { url: 'https://evil.example/api/access/admin/login', headers: { ...postHeaders, host: 'creezio.example', forwarded: 'host=creezio.example;proto=https' } },
        { url: `${origin}${path('session')}`, method: 'GET', body: undefined, headers: { cookie: adminCookie, origin: 'https://evil.example' } },
        { url: `${origin}${path('session')}`, method: 'GET', body: undefined, headers: { cookie: adminCookie, 'sec-fetch-site': 'cross-site' } },
      ];
      for (const specification of bad) {
        const result = await invoke(specification); safeResponse(result, 403); assert.equal(result.stats.prepares, 0); assert.equal(result.headers['set-cookie'], undefined);
      }
      const forged = { 'oai-authenticated-user-id': owner.principalId, 'oai-authenticated-user-email': loginIdentifier,
        'oai-authenticated-user-full-name': 'Administrator', 'x-user-role': 'owner', authorization: `Bearer ${adminCookie.split('=')[1]}`,
        'x-creezio-request-id': 'forged', forwarded: 'for=127.0.0.1;proto=https', 'x-forwarded-for': '127.0.0.1', 'cf-connecting-ip': '127.0.0.1' };
      const result = await request(path('session'), { headers: forged }); safeResponse(result, 401); assert.notEqual(result.headers['x-creezio-request-id'], 'forged');
      safeResponse(await session(adminCookie, 'admin', forged), 200);
    });

    await check('malformed and oversized JSON, encodings and bounded headers never reach identity storage', async () => {
      const cases = [
        { body: '{', status: 400 }, { body: '[]', status: 400 }, { body: 'null', status: 400 },
        { body: JSON.stringify({ loginIdentifier, password, audience: 'app' }), status: 400 },
        { headers: { ...postHeaders, 'content-type': 'text/plain' }, status: 415 },
        { headers: { ...postHeaders, 'content-encoding': 'gzip' }, status: 415 },
        { url: `${origin}${path('logout')}`, body: '{"all":true}', status: 400 },
        { stream: 'invalid-utf8', body: undefined, status: 400 }, { stream: 'errored', body: undefined, status: 400 },
        { stream: 'oversize', body: undefined, status: 413 },
        { stream: 'misleading-length', body: undefined, headers: { ...postHeaders, 'content-length': '2' }, status: 413 },
        { headers: { ...postHeaders, 'content-length': '20000' }, body: '{}', status: 413 },
        { headers: { ...postHeaders, cookie: `unrelated=${'x'.repeat(8192)}` }, status: 431 },
      ];
      for (const item of cases) {
        const { status, ...specification } = item, result = await invoke(specification);
        safeResponse(result, status); assert.equal(result.stats.prepares, 0); assert.equal(result.headers['set-cookie'], undefined);
      }
      for (const stream of ['pre-aborted', 'aborted', 'timeout']) {
        const result = await invoke({ stream, body: undefined }); safeResponse(result, stream === 'timeout' ? 408 : 499);
        assert.equal(result.stats.prepares, 0); assert.equal(result.headers['set-cookie'], undefined);
        if (stream !== 'pre-aborted') assert.equal(result.stats.cancelled, true);
      }
    });

    await check('cookie ambiguity, cross-audience tokens and wrong purposes never fall back to another credential', async () => {
      const api = await call('opaqueToken', 'api-token'), impersonation = await call('opaqueToken', 'impersonation');
      for (const value of ['', `${adminCookie}; ${adminCookie}`, `${adminCookie}; __Host-creezio-admin=malformed`,
        '__Host-creezio-admin=malformed', `__Host-creezio-admin=${appCookie.split('=')[1]}`,
        `__Host-creezio-admin=${api}`, `__Host-creezio-admin=${impersonation}`, appCookie]) {
        const result = await session(value); safeResponse(result, 401);
        assert.equal(result.headers['set-cookie'], undefined);
      }
      safeResponse(await session(adminCookie, 'app'), 401);
      safeResponse(await session(`${adminCookie}; ${appCookie}`, 'app'), 200);
      safeResponse(await session(`${adminCookie}; ${appCookie}`, 'admin'), 200);
    });

    await check('each HTTP session read sees database expiry, revocation and all current identity versions', async () => {
      const records = { principals: (await rows('principals', 'WHERE id=?', [owner.principalId]))[0],
        human_accounts: (await rows('human_accounts', 'WHERE principal_id=?', [owner.principalId]))[0],
        password_credentials: (await rows('password_credentials', 'WHERE principal_id=?', [owner.principalId]))[0] };
      for (const [id, update] of [['principals', 'auth_version=auth_version+1'], ['principals', "status='disabled'"],
        ['human_accounts', 'version=version+1'], ['human_accounts', "status='disabled'"],
        ['password_credentials', 'version=version+1'], ['password_credentials', `expires_at_ms=${NOW}`]]) {
        const primaryKey = id === 'principals' ? 'id' : 'principal_id';
        await db.prepare(`UPDATE ${table(id)} SET ${update} WHERE ${primaryKey}=?`).bind(owner.principalId).run();
        safeResponse(await session(adminCookie), 401); await restoreRow(id, records[id], primaryKey);
      }
      for (const update of [`expires_at_ms=${NOW}`, `revoked_at_ms=${NOW}`]) {
        const issued = await call('issueSession', loginIdentifier, 'admin');
        await db.prepare(`UPDATE ${table('sessions')} SET ${update} WHERE id=?`).bind(issued.session.id).run();
        safeResponse(await session(`__Host-creezio-admin=${issued.token}`), 401);
      }
      safeResponse(await session(adminCookie), 200);
    });

    await check('a changed principal or credential after password verification cannot receive a cookie or session commit', async () => {
      for (const race of ['principal-version', 'account-version', 'credential-version', 'disabled']) {
        const before = await snapshot(), result = await invoke({ race });
        safeResponse(result, 401); assert.equal(result.stats.injected, true); assert.equal(result.headers['set-cookie'], undefined);
        const after = await snapshot(); assert.deepEqual(after.sessions, before.sessions); assert.deepEqual(after.access_audit, before.access_audit);
        for (const id of ['principals', 'human_accounts', 'password_credentials'])
          for (const record of before[id]) await restoreRow(id, record, id === 'principals' ? 'id' : 'principal_id');
      }
    });

    await check('concurrent admission shares pseudonymous account/global keys despite spoofed network headers', async () => {
      const spoof = index => ({ 'x-forwarded-for': `198.51.100.${index}`, forwarded: `for=198.51.100.${index}`, 'cf-connecting-ip': `203.0.113.${index}`,
        'x-real-ip': `203.0.113.${index}`, 'true-client-ip': `198.51.100.${index}`, 'oai-authenticated-user-id': `different-${index}` });
      await seedThrottle('login-account', loginIdentifier, 4);
      const outcomes = await Promise.all([login('admin', spoof(1)), login('admin', spoof(2))]);
      assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 429]);
      assert.equal((await rows('auth_throttles', 'WHERE key=?', [key('login-account', loginIdentifier)]))[0].attempts, 6);
      safeResponse(outcomes.find(result => result.status === 429), 429);
      assert.equal(outcomes.find(result => result.status === 429).headers['set-cookie'], undefined);
      const active = await rows('auth_throttles', `WHERE expires_at_ms>${NOW}`);
      assert.deepEqual(active.map(row => row.key).sort(), [key('login-global'), key('login-account', loginIdentifier)].sort());
      const missing = 'absent-http@example.invalid'; await seedThrottle('login-account', missing, 4);
      const absent = await Promise.all([1, 2].map(index => request(path('login'), { method: 'POST', headers: { ...postHeaders, ...spoof(index + 3) },
        body: JSON.stringify({ loginIdentifier: missing, password }) })));
      assert.deepEqual(absent.map(result => result.status).sort(), [401, 429]);
      const wrong = await request(path('login'), { method: 'POST', headers: postHeaders, body: JSON.stringify({ loginIdentifier: 'other-absent@example.invalid', password }) });
      assert.equal(json(wrong).error.code, json(absent.find(result => result.status === 401)).error.code);
      await seedThrottle('login-global', '', 59);
      const global = await Promise.all(['global-one@example.invalid', 'global-two@example.invalid'].map((identifier, index) =>
        request(path('login'), { method: 'POST', headers: { ...postHeaders, ...spoof(index + 5) }, body: JSON.stringify({ loginIdentifier: identifier, password }) })));
      assert.deepEqual(global.map(result => result.status).sort(), [401, 429]);
      assert.equal((await rows('auth_throttles', 'WHERE key=?', [key('login-global')]))[0].attempts, 61);
    });

    await check('storage failures and late audit constraints are redacted and cannot report successful login or logout', async () => {
      for (const operation of ['login', 'session', 'logout']) {
        const result = await invoke({ storageFailure: true, url: `${origin}${path(operation)}`, method: operation === 'session' ? 'GET' : 'POST',
          headers: { ...postHeaders, cookie: adminCookie }, body: operation === 'session' ? undefined : operation === 'logout' ? '{}' : JSON.stringify({ loginIdentifier, password }) });
        safeResponse(result, 503); assert.equal(result.headers['set-cookie'], undefined); assert.ok(result.stats.prepares > 0);
      }
      for (const [operation, action] of [['login', 'session-created'], ['logout', 'session-revoked']]) {
        await db.prepare(`CREATE TRIGGER qualification_http_audit BEFORE INSERT ON ${table('access_audit')}
          WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'Synthetic private audit detail'); END`).run();
        const before = await snapshot();
        try {
          const result = operation === 'login' ? await login() : await logout(adminCookie);
          safeResponse(result, 503); assert.equal(result.headers['set-cookie'], undefined); assert.deepEqual(await snapshot(), before);
        } finally { await db.prepare('DROP TRIGGER qualification_http_audit').run(); }
      }
      safeResponse(await session(adminCookie), 200);
    });

    await check('logout revokes only its selected audience and uniform replay never duplicates an audit', async () => {
      const result = await logout(`${adminCookie}; ${appCookie}`); safeResponse(result, 200); assert.deepEqual(json(result), { ok: true });
      assert.match(result.headers['set-cookie'], /^__Host-creezio-admin=;/); assert.match(result.headers['set-cookie'], /Max-Age=0/);
      safeResponse(await session(adminCookie), 401); safeResponse(await session(appCookie, 'app'), 200);
      const before = await snapshot();
      for (const value of [adminCookie, '', '__Host-creezio-admin=malformed']) {
        const replay = await logout(value); safeResponse(replay, 200); assert.deepEqual(json(replay), { ok: true });
      }
      assert.deepEqual(await snapshot(), before);
      safeResponse(await logout(appCookie, 'app'), 200); safeResponse(await session(appCookie, 'app'), 401);
    });

    await check('HTTP loopback cookies require explicit local configuration and cannot become HTTPS cookies by proxy headers', async () => {
      const localOrigin = 'http://127.0.0.1:8787';
      const result = await invoke({ url: `${localOrigin}${path('login')}`, environment: { CREEZIO_APP_ORIGIN: localOrigin },
        headers: { ...postHeaders, origin: localOrigin, 'x-forwarded-proto': 'https', forwarded: 'proto=https;host=creezio.example' } });
      const localCookie = cookie(result, 'admin', true);
      safeResponse(await session(localCookie), 401);
      for (const profile of ['sites', 'cloudflare']) {
        const denied = await invoke({ url: `${localOrigin}${path('login')}`, environment: { CREEZIO_APP_ORIGIN: localOrigin, CREEZIO_RUNTIME_PROFILE: profile },
          headers: { ...postHeaders, origin: localOrigin } });
        safeResponse(denied, 503); assert.equal(denied.stats.prepares, 0);
      }
      const remote = await invoke({ url: 'http://evil.example/api/access/admin/login', environment: { CREEZIO_APP_ORIGIN: 'http://evil.example' }, headers: { ...postHeaders, origin: 'http://evil.example' } });
      safeResponse(remote, 503); assert.equal(remote.stats.prepares, 0);
    });

    await check('HTTP sessions and revocation remain effective after workerd restart without a bootstrap endpoint', async () => {
      const persistedCookie = cookie(await login(), 'admin'), before = await snapshot();
      await instance.dispose(); instance = undefined; db = undefined; control = undefined; await start();
      assert.deepEqual(await snapshot(), before); safeResponse(await session(persistedCookie), 200); safeResponse(await session(adminCookie), 401);
      safeResponse(await request('/api/access/admin/bootstrap', { method: 'POST', headers: postHeaders, body: '{}' }), 404);
      safeResponse(await logout(persistedCookie), 200);
    });
    t.diagnostic('Real dispatcher/workerd/D1 HTTP responses only. Cookie flags are inspected, not a browser cookie jar or hosted Sites behavior. Fixture provisioning is on a separate internal Worker.');
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
  }
});
