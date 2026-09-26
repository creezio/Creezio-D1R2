import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { generateD1Schema } from '../../scripts/data/d1-schema.mjs';
import { assertWorkerBoundary } from '../../scripts/build/worker-boundary.mjs';
import { createIdentityQualificationState } from './harness/d1-state.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const models = JSON.parse(readFileSync(join(root, 'extensions/native/access/module/models.json'), 'utf8'));
const digest = value => `sha256:${createHash('sha256').update(`synthetic-identity-fixture:${value}`).digest('hex')}`;
const loginIdentifier = 'owner@example.invalid';
const password = 'Synthetic D1 qualification — no user password';

test('native identity store enforces claims and fresh account state in real persistent D1', { timeout: 60000 }, async t => {
  const schema = generateD1Schema('creezio.access', models);
  for (const model of models) assert.equal(schema.tables[model.id],
    `cz_${Buffer.from('creezio.access').toString('hex')}_${Buffer.from(model.id).toString('hex')}`);
  const table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/identity/d1-store.ts', 'core/identity/password.ts'] });
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-accounts-worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundle.metafile.outputs)) assert.deepEqual(output.imports, []);
  const state = createIdentityQualificationState(root);
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-05-15', d1Databases: { DB: 'creezio-t04-identity-synthetic' }, d1Persist: join(state.directory, 'd1') };
  let instance, db, failed = false, principalId, passwordRecord;
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External identity qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function start() {
    instance = new Miniflare(options);
    await bounded(() => instance.ready, 5000);
    db = await instance.getD1Database('DB');
  }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await instance.dispatchFetch('http://internal-identity-qualification/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(result.error?.message ?? `Qualification response ${response.status}`);
      return result.value;
    });
  }
  async function check(name, operation) {
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Identity qualification stopped after: ${name}`);
  }
  const count = async id => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table(id)}`).first()).count;
  const sessionInput = id => ({ sessionDigest: digest(id), audience: 'admin', ttlMs: 60000 });
  const freshSession = async id => call('createSessionAfterPassword', await call('findPasswordAccount', loginIdentifier), sessionInput(id));
  const bootstrapInput = capabilityDigest => ({ capabilityDigest, loginIdentifier, displayName: 'Synthetic owner', passwordRecord });
  async function assertNoBootstrapEffects() {
    for (const id of ['principals', 'human_accounts', 'password_credentials', 'sessions', 'authorization_state', 'access_audit',
      'contexts', 'memberships', 'roles', 'role_parents', 'role_grants', 'role_overrides', 'role_assignments', 'principal_overrides']) {
      assert.equal(await count(id), 0, `${id} must remain empty`);
    }
  }
  try {
    await start();
    await db.batch(schema.statements.map(statement => db.prepare(statement)));
    passwordRecord = await call('hash', password);
    await check('UPDATE affecting zero rows does not roll back an unrelated D1 batch statement', async () => {
      await db.prepare('CREATE TABLE qualification_atomicity (id TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL)').run();
      const result = await db.batch([
        db.prepare('UPDATE qualification_atomicity SET value=1 WHERE id=?').bind('missing'),
        db.prepare('INSERT INTO qualification_atomicity (id,value) VALUES (?,?)').bind('unguarded-effect', 1),
      ]);
      assert.equal(result[0].meta.changes, 0);
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM qualification_atomicity').first()).count, 1);
      await db.prepare('DROP TABLE qualification_atomicity').run();
    });
    await check('bootstrap is closed without provisioning and rejects a different capability without side effects', async () => {
      assert.equal(await call('completeBootstrap', bootstrapInput(digest('bootstrap'))), null);
      await assertNoBootstrapEffects();
      assert.equal(await call('provisionBootstrap', { capabilityDigest: digest('bootstrap'), expiresAtMs: Date.now() + 60000 }), true);
      assert.equal(await call('canCompleteBootstrap', digest('bootstrap')), true);
      assert.equal(await call('completeBootstrap', bootstrapInput(digest('wrong-bootstrap'))), null);
      await assertNoBootstrapEffects();
      const row = await db.prepare(`SELECT claim_nonce,claimed_at_ms,principal_id FROM ${table('bootstrap')}`).first();
      assert.deepEqual(row, { claim_nonce: null, claimed_at_ms: null, principal_id: null });
      await db.prepare(`UPDATE ${table('bootstrap')} SET expires_at_ms=0`).run();
      assert.equal(await call('canCompleteBootstrap', digest('bootstrap')), false);
      assert.equal(await call('completeBootstrap', bootstrapInput(digest('bootstrap'))), null);
      await assertNoBootstrapEffects();
      await db.prepare(`UPDATE ${table('bootstrap')} SET expires_at_ms=?`).bind(Date.now() + 60000).run();
    });
    await check('a late audit constraint rolls back the claim and every earlier bootstrap write', async () => {
      // Test-only failure injection in the database, not a special product error path.
      await db.prepare(`CREATE TRIGGER qualification_late_failure BEFORE INSERT ON ${table('access_audit')}
        BEGIN SELECT RAISE(ABORT, 'synthetic_late_failure'); END`).run();
      await assert.rejects(call('completeBootstrap', bootstrapInput(digest('bootstrap'))), /Identity storage operation failed/);
      await assertNoBootstrapEffects();
      assert.equal((await db.prepare(`SELECT claim_nonce FROM ${table('bootstrap')}`).first()).claim_nonce, null);
      await db.prepare('DROP TRIGGER qualification_late_failure').run();
    });
    await check('two concurrent bootstrap claims produce exactly one account and one audit event', async () => {
      const results = await Promise.all([call('completeBootstrap', bootstrapInput(digest('bootstrap'))),
        call('completeBootstrap', bootstrapInput(digest('bootstrap')))]);
      const completed = results.filter(Boolean);
      assert.equal(completed.length, 1); assert.equal(results.filter(value => value === null).length, 1);
      principalId = completed[0].principalId;
      assert.equal(typeof principalId, 'string');
      for (const id of ['principals', 'human_accounts', 'password_credentials', 'authorization_state', 'access_audit',
        'contexts', 'memberships', 'roles', 'role_grants', 'role_assignments']) assert.equal(await count(id), 1, id);
      for (const id of ['role_parents', 'role_overrides', 'principal_overrides']) assert.equal(await count(id), 0, id);
      assert.deepEqual(await db.prepare(`SELECT * FROM ${table('contexts')}`).first(), { id: 'application', status: 'active' });
      assert.deepEqual(await db.prepare(`SELECT * FROM ${table('roles')}`).first(), { id: 'administrator' });
      assert.deepEqual(await db.prepare(`SELECT * FROM ${table('role_grants')}`).first(), { role_id: 'administrator', permission_id: 'creezio.access:manage' });
      assert.deepEqual(await db.prepare(`SELECT * FROM ${table('memberships')}`).first(),
        { principal_id: principalId, context_id: 'application', audience: 'admin', status: 'active' });
      assert.deepEqual(await db.prepare(`SELECT * FROM ${table('role_assignments')}`).first(),
        { principal_id: principalId, context_id: 'application', audience: 'admin', role_id: 'administrator' });
      assert.equal(await count('sessions'), 0);
      assert.equal((await db.prepare(`SELECT principal_id FROM ${table('bootstrap')}`).first()).principal_id, principalId);
      assert.equal(await call('completeBootstrap', bootstrapInput(digest('bootstrap'))), null);
      assert.equal(await call('provisionBootstrap', { capabilityDigest: digest('replacement'), expiresAtMs: Date.now() + 60000 }), false);
    });
    await check('generated account constraints enforce nullability, minimum version and foreign keys in D1', async () => {
      await assert.rejects(db.prepare(`UPDATE ${table('principals')} SET id=NULL WHERE id=?`).bind(principalId).run(), /NOT NULL|constraint/i);
      await assert.rejects(db.prepare(`UPDATE ${table('principals')} SET auth_version=0 WHERE id=?`).bind(principalId).run(), /CHECK|constraint/i);
      await assert.rejects(db.prepare(`UPDATE ${table('password_credentials')} SET principal_id=? WHERE principal_id=?`).bind('missing-principal', principalId).run(), /FOREIGN KEY|constraint/i);
      assert.equal((await db.prepare(`SELECT auth_version FROM ${table('principals')} WHERE id=?`).bind(principalId).first()).auth_version, 1);
    });
    await check('a real password read and KDF admit only the correct password before session creation', async () => {
      assert.equal(await call('findPasswordAccount', 'missing@example.invalid'), null);
      const account = await call('findPasswordAccount', loginIdentifier);
      assert.equal(account.principalId, principalId);
      assert.equal(await call('verify', `${password}!`, account.passwordRecord), false);
      assert.equal(await count('sessions'), 0);
      assert.equal(await call('verify', password, account.passwordRecord), true);
      const created = await call('createSessionAfterPassword', account, sessionInput('initial-session'));
      assert.equal(created.principalId, principalId);
      assert.equal((await call('getSession', digest('initial-session'), 'admin')).principalId, principalId);
      assert.equal(await call('getSession', digest('initial-session'), 'app'), null);
      assert.equal(await count('sessions'), 1);
    });
    await check('fresh session reads reject revocation, expiry and both principal/account disablement', async () => {
      await freshSession('revoked-session');
      assert.equal(await call('revokeSession', digest('revoked-session'), 'app'), false);
      assert.equal(await call('revokeSession', digest('revoked-session'), 'admin'), true);
      assert.equal(await call('getSession', digest('revoked-session'), 'admin'), null);
      await freshSession('expired-session');
      await db.prepare(`UPDATE ${table('sessions')} SET expires_at_ms=0 WHERE secret_hash=?`).bind(digest('expired-session')).run();
      assert.equal(await call('getSession', digest('expired-session'), 'admin'), null);
      for (const id of ['principals', 'human_accounts']) {
        const key = id === 'principals' ? 'id' : 'principal_id';
        await db.prepare(`UPDATE ${table(id)} SET status='disabled' WHERE ${key}=?`).bind(principalId).run();
        assert.equal(await call('getSession', digest('initial-session'), 'admin'), null, id);
        assert.equal(await call('findPasswordAccount', loginIdentifier), null, id);
        await db.prepare(`UPDATE ${table(id)} SET status='active' WHERE ${key}=?`).bind(principalId).run();
      }
    });
    await check('state changed after password verification cannot create a session or its audit effect', async () => {
      const changes = [
        { id: 'principals', key: 'id', clause: "status='disabled'", restore: "status='active'" },
        { id: 'principals', key: 'id', clause: 'auth_version=auth_version+1' },
        { id: 'human_accounts', key: 'principal_id', clause: 'version=version+1' },
        { id: 'password_credentials', key: 'principal_id', clause: 'version=version+1' },
        { id: 'password_credentials', key: 'principal_id', clause: 'expires_at_ms=0', restore: 'expires_at_ms=NULL' },
      ];
      for (const [index, change] of changes.entries()) {
        const snapshot = await call('findPasswordAccount', loginIdentifier);
        assert.equal(await call('verify', password, snapshot.passwordRecord), true);
        const sessions = await count('sessions'), audits = await count('access_audit');
        await db.prepare(`UPDATE ${table(change.id)} SET ${change.clause} WHERE ${change.key}=?`).bind(principalId).run();
        assert.equal(await call('createSessionAfterPassword', snapshot, sessionInput(`raced-session-${index}`)), null, change.clause);
        assert.equal(await count('sessions'), sessions, change.clause);
        assert.equal(await count('access_audit'), audits, change.clause);
        if (change.restore) await db.prepare(`UPDATE ${table(change.id)} SET ${change.restore} WHERE ${change.key}=?`).bind(principalId).run();
      }
      assert.equal(await call('getSession', digest('initial-session'), 'admin'), null);
    });
    await check('persistent throttle admission remains bounded under concurrent attempts', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => call('consumeThrottle', {
        key: digest('throttle'), limit: 3, windowMs: 60000,
      })));
      assert.equal(results.filter(result => result.allowed).length, 3);
      assert.equal(results.filter(result => !result.allowed).length, 5);
    });
    await check('throttle cleanup deletes at most 32 other expired rows and preserves the current and live windows', async () => {
      const currentKey = digest('prune-current'), liveKey = digest('prune-live');
      const insert = (key, expires) => db.prepare(`INSERT INTO ${table('auth_throttles')}
        (key,window_start_ms,attempts,expires_at_ms) VALUES (?,0,5,?)`).bind(key, expires);
      await db.batch([
        ...Array.from({ length: 40 }, (_, index) => insert(digest(`prune-expired-${index}`), 0)),
        insert(currentKey, 0), insert(liveKey, Date.now() + 60000),
      ]);
      const expired = async () => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table('auth_throttles')}
        WHERE expires_at_ms=0 AND key<>?`).bind(currentKey).first()).count;
      const attempt = () => call('consumeThrottle', { key: currentKey, limit: 3, windowMs: 60000 });
      assert.equal((await attempt()).allowed, true);
      assert.equal(await expired(), 8);
      const current = await db.prepare(`SELECT attempts,expires_at_ms FROM ${table('auth_throttles')} WHERE key=?`).bind(currentKey).first();
      assert.equal(current.attempts, 1); assert.ok(current.expires_at_ms > 0);
      assert.equal((await db.prepare(`SELECT attempts FROM ${table('auth_throttles')} WHERE key=?`).bind(liveKey).first()).attempts, 5);
      assert.equal((await attempt()).allowed, true);
      assert.equal(await expired(), 0);
      assert.equal((await db.prepare(`SELECT attempts FROM ${table('auth_throttles')} WHERE key=?`).bind(currentKey).first()).attempts, 2);
      assert.equal((await db.prepare(`SELECT attempts FROM ${table('auth_throttles')} WHERE key=?`).bind(liveKey).first()).attempts, 5);
    });
    await check('account and fresh session survive disposing and restarting workerd on the same owned D1 state', async () => {
      const session = await freshSession('persistent-session');
      assert.equal(session.principalId, principalId);
      await instance.dispose(); instance = undefined; db = undefined;
      await start();
      assert.equal((await call('findPasswordAccount', loginIdentifier)).principalId, principalId);
      assert.deepEqual(await call('getSession', digest('persistent-session'), 'admin'), session);
      assert.equal(await call('getSession', digest('revoked-session'), 'admin'), null);
      assert.equal(await call('completeBootstrap', bootstrapInput(digest('bootstrap'))), null);
    });
    t.diagnostic('Real local D1 only: generated schema, guarded bootstrap/session batches, explicit initial ACL and persistence qualified. No public HTTP authentication, delivery, role management, account recovery or hosted Sites claim.');
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
  }
});

test('canonical account service uses real D1, KDF, opaque tokens and persistent admission', { timeout: 60000 }, async t => {
  const schema = generateD1Schema('creezio.access', models);
  const table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/identity/accounts.ts'] });
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-accounts-worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundle.metafile.outputs)) assert.deepEqual(output.imports, []);
  const state = createIdentityQualificationState(root);
  const instance = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15',
    d1Databases: { DB: 'creezio-t04-identity-synthetic' }, d1Persist: join(state.directory, 'd1') });
  let db, failed = false, capability, owner, login;
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External account service qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await instance.dispatchFetch('http://internal-account-service-qualification/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(result.error?.message ?? `Qualification response ${response.status}`);
      return result.value;
    });
  }
  async function check(name, operation) {
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Account service qualification stopped after: ${name}`);
  }
  const count = async id => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table(id)}`).first()).count;
  const bootstrapInput = token => ({ token, loginIdentifier, displayName: 'Synthetic owner', password });
  const loginInput = (value = password, identifier = loginIdentifier) => ({ loginIdentifier: identifier, password: value, audience: 'admin' });
  const tokenDigest = (purpose, token) => `sha256:${createHash('sha256').update(`creezio:credential:v1:${purpose}:${token}`).digest('hex')}`;
  try {
    await bounded(() => instance.ready, 5000);
    db = await instance.getD1Database('DB');
    await db.batch(schema.statements.map(statement => db.prepare(statement)));
    await check('new password policy counts Unicode code points and bounds exact UTF-8 bytes', async () => {
      assert.deepEqual(await call('passwordPolicy', 'a'.repeat(14), 'a'.repeat(15), '😀'.repeat(14),
        '😀'.repeat(15), 'é'.repeat(512), 'é'.repeat(513), '\ud800', '', null),
      [false, true, false, true, true, false, false, false, false]);
      for (const value of ['a'.repeat(14), 'é'.repeat(513), '\ud800']) {
        assert.deepEqual(await call('serviceBootstrap', { ...bootstrapInput(null), password: value }), { ok: false, code: 'invalid_input' });
      }
      assert.equal(await count('principals'), 0); assert.equal(await count('auth_throttles'), 0);
    });
    await check('malformed or cross-purpose bootstrap tokens cannot provision an account or consume admission', async () => {
      for (const token of [null, '', 'not-a-token', `cz1s_${'A'.repeat(43)}`]) {
        assert.deepEqual(await call('serviceBootstrap', bootstrapInput(token)), { ok: false, code: 'bootstrap_unavailable' });
      }
      assert.equal(await count('principals'), 0); assert.equal(await count('auth_throttles'), 0);
    });
    await check('explicit provisioning and bootstrap create one real account without a session or exposed password record', async () => {
      capability = await call('serviceProvision');
      assert.match(capability.token, /^cz1b_[A-Za-z0-9_-]{43}$/);
      const stored = await db.prepare(`SELECT capability_digest,expires_at_ms FROM ${table('bootstrap')}`).first();
      assert.equal(stored.capability_digest, tokenDigest('bootstrap', capability.token));
      assert.equal(stored.expires_at_ms, capability.expiresAtMs);
      owner = await call('serviceBootstrap', { ...bootstrapInput(capability.token), loginIdentifier: ' OWNER@EXAMPLE.INVALID ' });
      assert.equal(owner.ok, true); assert.deepEqual(Object.keys(owner).sort(), ['ok', 'principalId']);
      assert.equal(await count('principals'), 1); assert.equal(await count('sessions'), 0);
      assert.equal((await db.prepare(`SELECT login_identifier FROM ${table('human_accounts')}`).first()).login_identifier, loginIdentifier);
      assert.deepEqual(await call('serviceBootstrap', bootstrapInput(capability.token)), { ok: false, code: 'bootstrap_unavailable' });
      assert.equal(await call('serviceProvision'), null);
    });
    await check('wrong password fails; correct login issues a token while D1 retains only its purpose-bound digest', async () => {
      assert.deepEqual(await call('serviceLogin', loginInput(`${password}!`)), { ok: false, code: 'invalid_credentials' });
      assert.equal(await count('sessions'), 0);
      login = await call('serviceLogin', loginInput());
      assert.equal(login.ok, true); assert.match(login.token, /^cz1s_[A-Za-z0-9_-]{43}$/);
      assert.deepEqual(Object.keys(login).sort(), ['ok', 'session', 'token']);
      assert.deepEqual(Object.keys(login.session).sort(), ['audience', 'authVersion', 'createdAtMs', 'displayName', 'expiresAtMs', 'id', 'principalId']);
      assert.equal(login.session.principalId, owner.principalId);
      const stored = await db.prepare(`SELECT secret_hash FROM ${table('sessions')}`).first();
      assert.equal(stored.secret_hash, tokenDigest('session', login.token));
      for (const model of models) {
        const rows = JSON.stringify((await db.prepare(`SELECT * FROM ${table(model.id)}`).all()).results);
        assert.equal(rows.includes(login.token), false, `${model.id}: raw session token must not be persisted`);
        assert.equal(rows.includes(capability.token), false, `${model.id}: raw bootstrap capability must not be persisted`);
      }
      assert.deepEqual(await call('serviceSession', login.token, 'admin'), login.session);
      assert.equal(await call('serviceSession', login.token, 'app'), null);
      assert.equal(await call('serviceSession', capability.token, 'admin'), null);
      assert.equal(await call('serviceSession', 'malformed', 'admin'), null);
    });
    await check('logout rechecks its audience and revocation is visible on the next session lookup', async () => {
      assert.equal(await call('serviceLogout', login.token, 'app'), false);
      assert.deepEqual(await call('serviceSession', login.token, 'admin'), login.session);
      assert.equal(await call('serviceLogout', login.token, 'admin'), true);
      assert.equal(await call('serviceSession', login.token, 'admin'), null);
      assert.equal(await call('serviceLogout', login.token, 'admin'), false);
    });
    await check('invalid login inputs do not enter persistent admission', async () => {
      const before = (await db.prepare(`SELECT * FROM ${table('auth_throttles')} ORDER BY key`).all()).results;
      for (const input of [loginInput('é'.repeat(513)), loginInput('\ud800'), { ...loginInput(), audience: 'public' }]) {
        assert.deepEqual(await call('serviceLogin', input), { ok: false, code: 'invalid_input' });
      }
      assert.deepEqual((await db.prepare(`SELECT * FROM ${table('auth_throttles')} ORDER BY key`).all()).results, before);
    });
    await check('sixth login is rate limited for both existing and absent identities, including a later correct password', async () => {
      // Existing account has exactly two previous attempts (one wrong, one correct).
      for (let attempt = 3; attempt <= 5; attempt++) assert.deepEqual(
        await call('serviceLogin', loginInput(`${password}!`, 'OWNER@EXAMPLE.INVALID')), { ok: false, code: 'invalid_credentials' });
      assert.deepEqual(await call('serviceLogin', loginInput(`${password}!`)), { ok: false, code: 'rate_limited' });
      assert.deepEqual(await call('serviceLogin', loginInput()), { ok: false, code: 'rate_limited' });
      for (let attempt = 1; attempt <= 5; attempt++) assert.deepEqual(
        await call('serviceLogin', loginInput(password, 'absent@example.invalid')), { ok: false, code: 'invalid_credentials' });
      assert.deepEqual(await call('serviceLogin', loginInput(password, 'absent@example.invalid')), { ok: false, code: 'rate_limited' });
      assert.equal(await count('sessions'), 1);
    });
    t.diagnostic('Canonical service and real D1 qualified locally. Invalid input/token cases prove rejection and unchanged admission/account rows; no runtime KDF invocation counter is claimed. Harness is not a public HTTP transport.');
  } finally {
    try { await instance.dispose(); }
    finally { state.cleanup(); }
  }
});
