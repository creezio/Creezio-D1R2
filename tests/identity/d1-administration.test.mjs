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
const models = JSON.parse(readFileSync(join(root, 'extensions/native/access/module/models.json'), 'utf8'));
const ownerLogin = 'administration-owner@example.invalid', userLogin = 'administration-user@example.invalid';
const password = 'Synthetic account administration password';
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const digest = token => `sha256:${createHash('sha256').update(`creezio:credential:v1:session:${token}`).digest('hex')}`;

test('human account administration uses bounded safe pages and atomic fresh-authority changes in real D1', { timeout: 90000 }, async t => {
  const schema = generateD1Schema('creezio.access', models), table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/identity/administration.ts', 'core/identity/administration-store.ts'] });
  const bundled = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-administration-worker.mjs'], bundle: true,
    write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, []);
  const state = createIdentityQualificationState(root);
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', d1Databases: { DB: 'creezio-t04-administration-synthetic' }, d1Persist: join(state.directory, 'd1') };
  let instance, db, owner, admin, user, pending, machine, userSession, sessionTokens, failed = false;
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External administration qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function start() { instance = new Miniflare(options); await bounded(() => instance.ready, 5000); db = await instance.getD1Database('DB'); }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await instance.dispatchFetch('http://internal-administration-qualification/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(result.error?.message ?? `Qualification response ${response.status}`);
      return result.value;
    });
  }
  async function check(name, operation) {
    // Independent synthetic admission windows; product limits and clocks remain unchanged.
    await db.prepare(`UPDATE ${table('auth_throttles')} SET expires_at_ms=0`).run();
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Administration qualification stopped after: ${name}`);
  }
  const rows = async (id, where = '', values = []) => (await db.prepare(`SELECT * FROM ${table(id)} ${where}`).bind(...values).all()).results;
  const count = async (id, where = '', values = []) => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table(id)} ${where}`).bind(...values).first()).count;
  const principal = async id => (await rows('principals', 'WHERE id=?', [id]))[0];
  const epoch = async () => (await db.prepare(`SELECT epoch FROM ${table('authorization_state')} WHERE id='application'`).first()).epoch;
  async function snapshot() {
    const value = {};
    for (const id of Object.keys(schema.tables).filter(id => id !== 'auth_throttles').sort())
      value[id] = (await rows(id)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return value;
  }
  async function freshAdmin() { admin = await call('issueSession', ownerLogin, 'admin'); }
  async function seedSessions(source, prefix, amount) {
    const tokens = Array.from({ length: amount }, (_, index) => `cz1s_${createHash('sha256').update(`${prefix}-${index}`).digest('base64url')}`);
    await db.batch(tokens.map((token, index) => db.prepare(`INSERT INTO ${table('sessions')}
      (id,secret_hash,principal_id,audience,auth_version,account_version,credential_version,created_at_ms,expires_at_ms,revoked_at_ms,revocation_nonce)
      SELECT ?,?,principal_id,audience,auth_version,account_version,credential_version,created_at_ms,expires_at_ms,NULL,NULL
      FROM ${table('sessions')} WHERE id=?`).bind(`${prefix}-${index}`, digest(token), source.session.id)));
    return tokens;
  }
  async function assertAudit(action, source, targetId, targetSessionId = null) {
    const matches = await rows('access_audit', 'WHERE action=? AND session_id=? AND target_principal_id=?', [action, source.session.id, targetId]);
    assert.equal(matches.length, 1); assert.equal(matches[0].principal_id, owner.principalId);
    assert.equal(matches[0].target_session_id, targetSessionId);
    assert.equal(JSON.stringify(matches).includes(source.token), false); assert.equal(JSON.stringify(matches).includes(digest(source.token)), false);
  }
  try {
    await start(); await db.batch(schema.statements.map(sql => db.prepare(sql)));
    owner = await call('bootstrap', { loginIdentifier: ownerLogin, displayName: 'Synthetic account administrator', password }); assert.equal(owner.ok, true);
    admin = await call('login', { loginIdentifier: ownerLogin, password, audience: 'admin' }); assert.equal(admin.ok, true);
    const invitation = await call('issueInvitation', admin.token, { loginIdentifier: userLogin, displayName: 'Synthetic active user' }); assert.equal(invitation.ok, true);
    user = await call('redeem', { token: invitation.token, purpose: 'invitation', password }); assert.equal(user.ok, true);
    userSession = await call('login', { loginIdentifier: userLogin, password, audience: 'app' }); assert.equal(userSession.ok, true);
    pending = await call('issueInvitation', admin.token, { loginIdentifier: 'administration-pending@example.invalid', displayName: 'Synthetic pending user' }); assert.equal(pending.ok, true);
    machine = await call('createService', admin.token, { displayName: 'Synthetic service identity' }); assert.equal(machine.ok, true);

    await check('principal pages exactly traverse all/human/service filters and expose only safe projected metadata', async () => {
      for (const kind of ['all', 'human', 'service']) {
        const expected = (await rows('principals', kind === 'all' ? 'ORDER BY id' : 'WHERE kind=? ORDER BY id', kind === 'all' ? [] : [kind])).map(row => row.id);
        const found = []; let afterId = null, pages = 0;
        do {
          const page = await call('listPrincipals', admin.token, { limit: 2, afterId, kind }); assert.equal(page.ok, true);
          assert.ok(page.items.length <= 2); assert.deepEqual(Object.keys(page).sort(), ['items', 'nextAfterId', 'ok']);
          for (const item of page.items) {
            assert.deepEqual(Object.keys(item).sort(), ['authVersion', 'createdAtMs', 'displayName', 'humanStatus', 'id', 'kind', 'loginIdentifier', 'status']);
            assert.ok(!afterId || item.id > afterId); if (kind !== 'all') assert.equal(item.kind, kind);
            if (item.kind === 'service') { assert.equal(item.humanStatus, null); assert.equal(item.loginIdentifier, null); }
            if (item.id === pending.principalId) assert.equal(item.humanStatus, 'pending');
            found.push(item.id);
          }
          if (page.nextAfterId !== null) assert.equal(page.nextAfterId, page.items.at(-1).id);
          afterId = page.nextAfterId; assert.ok(++pages <= 5);
        } while (afterId !== null);
        assert.deepEqual(found, expected); assert.equal(new Set(found).size, found.length);
        const exhausted = await call('listPrincipals', admin.token, { limit: 2, afterId: expected.at(-1), kind });
        assert.deepEqual(exhausted, { ok: true, items: [], nextAfterId: null });
      }
      assert.deepEqual(await call('listSessions', admin.token, { principalId: pending.principalId, limit: 2, afterId: null }),
        { ok: true, items: [], nextAfterId: null });
      const before = await snapshot();
      for (const limit of [0, 51]) assert.equal((await call('listPrincipals', admin.token, { limit, afterId: null, kind: 'all' })).ok, false);
      assert.deepEqual(await snapshot(), before);
      const mutable = await call('mutableInput', 'listPrincipals', [admin.token, { limit: 1, afterId: null, kind: 'human' }], { limit: 50, kind: 'all' });
      assert.equal(mutable.mutated, true); assert.equal(mutable.result.ok, true); assert.equal(mutable.result.items.length, 1);
      assert.equal(mutable.result.items[0].kind, 'human');
    });

    await check('session pages stay bounded and distinguish usable sessions from expired, revoked and stale-version metadata', async () => {
      sessionTokens = await seedSessions(userSession, 'synthetic-user-session', 53);
      await db.prepare(`UPDATE ${table('sessions')} SET expires_at_ms=${NOW} WHERE id='synthetic-user-session-0'`).run();
      await db.prepare(`UPDATE ${table('sessions')} SET revoked_at_ms=${NOW} WHERE id='synthetic-user-session-1'`).run();
      await db.prepare(`UPDATE ${table('sessions')} SET auth_version=auth_version-1 WHERE id='synthetic-user-session-2'`).run();
      await db.prepare(`UPDATE ${table('sessions')} SET account_version=account_version-1 WHERE id='synthetic-user-session-3'`).run();
      await db.prepare(`UPDATE ${table('sessions')} SET credential_version=credential_version+1 WHERE id='synthetic-user-session-4'`).run();
      const expected = await rows('sessions', 'WHERE principal_id=? ORDER BY id', [user.principalId]);
      const found = []; let afterId = null, pages = 0;
      do {
        const page = await call('listSessions', admin.token, { principalId: user.principalId, limit: 17, afterId }); assert.equal(page.ok, true);
        assert.ok(page.items.length <= 17);
        for (const item of page.items) {
          assert.deepEqual(Object.keys(item).sort(), ['active', 'audience', 'createdAtMs', 'expiresAtMs', 'id', 'revokedAtMs']);
          const persisted = expected.find(row => row.id === item.id); assert.equal(item.audience, persisted.audience);
          const index = Number(item.id.replace('synthetic-user-session-', ''));
          const token = item.id.startsWith('synthetic-user-session-') ? sessionTokens[index] : userSession.token;
          assert.equal(item.active, (await call('session', token, item.audience)) !== null);
          found.push(item.id);
        }
        if (page.nextAfterId !== null) assert.equal(page.nextAfterId, page.items.at(-1).id);
        afterId = page.nextAfterId; assert.ok(++pages <= 5);
      } while (afterId !== null);
      assert.deepEqual(found, expected.map(row => row.id));
      const measured = await call('measured', 'listSessions', [admin.token, { principalId: user.principalId, limit: 50, afterId: null }]);
      assert.equal(measured.result.ok, true); assert.equal(measured.result.items.length, 50); assert.equal(measured.batches.at(-1), 2);
    });

    await check('page permissions and the source session/epoch are rechecked in the coherent guarded page batch', async () => {
      const ordinaryAdmin = await call('issueSession', userLogin, 'admin');
      const appOnly = await call('issueSession', ownerLogin, 'app');
      for (const [method, input] of [['listPrincipals', { limit: 2, afterId: null, kind: 'all' }], ['listSessions', { principalId: user.principalId, limit: 2, afterId: null }]]) {
        assert.equal((await call(method, ordinaryAdmin.token, input)).error, 'forbidden');
        assert.equal((await call(method, 'malformed', input)).error, 'unauthorized');
        assert.equal((await call(method, appOnly.token, input)).error, 'unauthorized');
        for (const mutation of ['epoch', 'issuer-revoked', 'issuer-membership']) {
          await freshAdmin(); const beforeAudit = await rows('access_audit');
          const raced = await call('withRace', method, [admin.token, input], mutation);
          assert.equal(raced.injected, true, `${method}/${mutation}`); assert.equal(raced.result.ok, false);
          assert.equal(Object.hasOwn(raced.result, 'items'), false); assert.deepEqual(await rows('access_audit'), beforeAudit);
          if (mutation === 'issuer-membership') await db.prepare(`UPDATE ${table('memberships')} SET status='active' WHERE principal_id=?`).bind(owner.principalId).run();
        }
      }
      await freshAdmin();
    });

    await check('pending enrollment survives disable/enable without password creation or resurrection of its activation link', async () => {
      const before = await principal(pending.principalId);
      const disabled = await call('setHumanStatus', admin.token, { principalId: pending.principalId, expectedAuthVersion: before.auth_version, status: 'disabled' });
      assert.equal(disabled.ok, true); assert.equal(disabled.principal.humanStatus, 'pending'); assert.equal(disabled.principal.status, 'disabled');
      const enabled = await call('setHumanStatus', admin.token, { principalId: pending.principalId, expectedAuthVersion: before.auth_version + 1, status: 'active' });
      assert.equal(enabled.ok, true); assert.equal(enabled.principal.authVersion, before.auth_version + 2); assert.equal(enabled.principal.humanStatus, 'pending');
      assert.equal(await count('password_credentials', 'WHERE principal_id=?', [pending.principalId]), 0);
      assert.equal(await count('memberships', 'WHERE principal_id=?', [pending.principalId]), 0);
      assert.deepEqual(await call('redeem', { token: pending.token, purpose: 'invitation', password }), { ok: false, error: 'unavailable' });
      assert.equal((await call('issueActivation', admin.token, { principalId: pending.principalId })).ok, true);
      const prior = await snapshot(), own = await principal(owner.principalId);
      assert.equal((await call('setHumanStatus', admin.token, { principalId: owner.principalId, expectedAuthVersion: own.auth_version, status: 'disabled' })).ok, false);
      for (const method of ['setHumanStatus', 'revokeAllHumanSessions']) {
        const input = { principalId: machine.principal.id, expectedAuthVersion: machine.principal.authVersion,
          ...(method === 'setHumanStatus' ? { status: 'disabled' } : {}) };
        assert.equal((await call(method, admin.token, input)).ok, false);
      }
      assert.deepEqual(await snapshot(), prior);
    });

    await check('active-account status invalidates every old session and recovery link while touching only bounded current-version markers', async () => {
      const reset = await call('issuePasswordReset', admin.token, { principalId: user.principalId }); assert.equal(reset.ok, true);
      const before = await principal(user.principalId), originalHuman = (await rows('human_accounts', 'WHERE principal_id=?', [user.principalId]))[0];
      const beforeMarked = await count('sessions', 'WHERE principal_id=? AND revoked_at_ms IS NOT NULL', [user.principalId]);
      assert.equal((await call('setHumanStatus', admin.token, { principalId: user.principalId, expectedAuthVersion: before.auth_version, status: 'disabled' })).ok, true);
      assert.equal(await count('sessions', 'WHERE principal_id=? AND revoked_at_ms IS NOT NULL', [user.principalId]), beforeMarked + 32);
      assert.equal((await rows('sessions', "WHERE id='synthetic-user-session-2'"))[0].revoked_at_ms, null);
      assert.deepEqual((await rows('human_accounts', 'WHERE principal_id=?', [user.principalId]))[0], originalHuman);
      const disabledSessions = await call('listSessions', admin.token, { principalId: user.principalId, afterId: null, limit: 50 });
      assert.equal(disabledSessions.ok, true); assert.ok(disabledSessions.items.every(item => item.active === false));
      const enabled = await call('setHumanStatus', admin.token, { principalId: user.principalId, expectedAuthVersion: before.auth_version + 1, status: 'active' }); assert.equal(enabled.ok, true);
      for (const token of [...sessionTokens, userSession.token]) assert.equal(await call('session', token, 'app'), null);
      assert.deepEqual(await call('redeem', { token: reset.token, purpose: 'password-reset', password }), { ok: false, error: 'unavailable' });
      userSession = await call('login', { loginIdentifier: userLogin, password, audience: 'app' }); assert.equal(userSession.ok, true);
    });

    await check('targeted session revocation records the distinct source and target, including revoking its own source session', async () => {
      await freshAdmin(); const source = admin;
      assert.deepEqual(await call('revokeSessionById', source.token, { sessionId: userSession.session.id }), { ok: true });
      await assertAudit('human-session-revoked', source, user.principalId, userSession.session.id);
      assert.notEqual(await call('session', source.token, 'admin'), null); assert.equal(await call('session', userSession.token, 'app'), null);
      const before = await snapshot();
      assert.equal((await call('revokeSessionById', source.token, { sessionId: userSession.session.id })).ok, false); assert.deepEqual(await snapshot(), before);
      await freshAdmin(); const self = admin;
      assert.deepEqual(await call('revokeSessionById', self.token, { sessionId: self.session.id }), { ok: true });
      await assertAudit('human-session-revoked', self, owner.principalId, self.session.id);
      assert.equal(await call('session', self.token, 'admin'), null); await freshAdmin();
    });

    await check('concurrent revoke-all uses one version claim and cannot replay an earlier audit receipt', async () => {
      userSession = await call('issueSession', userLogin, 'app'); const current = await principal(user.principalId);
      const reset = await call('issuePasswordReset', admin.token, { principalId: user.principalId }); assert.equal(reset.ok, true);
      const input = { principalId: user.principalId, expectedAuthVersion: current.auth_version };
      const results = await Promise.all([1, 2].map(() => call('revokeAllHumanSessions', admin.token, input)));
      assert.equal(results.filter(result => result.ok).length, 1); assert.equal(results.filter(result => result.error === 'conflict').length, 1);
      assert.deepEqual(results.find(result => result.ok), { ok: true, principalId: user.principalId, authVersion: current.auth_version + 1 });
      assert.equal(await call('session', userSession.token, 'app'), null); await assertAudit('human-sessions-revoked', admin, user.principalId);
      assert.deepEqual(await call('redeem', { token: reset.token, purpose: 'password-reset', password }), { ok: false, error: 'unavailable' });
      const before = await snapshot(); assert.equal((await call('revokeAllHumanSessions', admin.token, input)).ok, false); assert.deepEqual(await snapshot(), before);
    });

    await check('late audit failures roll back status, versions, revocations and the claim in each mutation family', async () => {
      for (const [method, action] of [['setHumanStatus', 'human-status-updated'], ['revokeAllHumanSessions', 'human-sessions-revoked'], ['revokeSessionById', 'human-session-revoked']]) {
        const targetSession = await call('issueSession', userLogin, 'app'), current = await principal(user.principalId);
        const input = method === 'revokeSessionById' ? { sessionId: targetSession.session.id }
          : { principalId: user.principalId, expectedAuthVersion: current.auth_version, ...(method === 'setHumanStatus' ? { status: 'disabled' } : {}) };
        const before = await snapshot();
        await db.prepare(`CREATE TRIGGER qualification_administration_late_failure BEFORE UPDATE ON ${table('access_audit')}
          WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'synthetic_administration_late_failure'); END`).run();
        assert.deepEqual(await call(method, admin.token, input), { ok: false, error: 'storage_error' }, method);
        assert.deepEqual(await snapshot(), before, method); assert.notEqual(await call('session', targetSession.token, 'app'), null);
        await db.prepare('DROP TRIGGER qualification_administration_late_failure').run();
      }
    });

    await check('fresh source authority and target versions prevent writes after a conflicting server read', async () => {
      for (const method of ['setHumanStatus', 'revokeAllHumanSessions', 'revokeSessionById']) {
        for (const mutation of ['epoch', 'issuer-revoked', 'issuer-expired', 'issuer-membership', 'issuer-credential-expired',
          method === 'revokeSessionById' ? 'target-revoked' : 'target-version']) {
          await freshAdmin(); const targetSession = method === 'revokeSessionById' ? await call('issueSession', userLogin, 'app') : null;
          const current = await principal(user.principalId), beforeEpoch = await epoch(), beforeAudit = await rows('access_audit');
          const input = targetSession ? { sessionId: targetSession.session.id }
            : { principalId: user.principalId, expectedAuthVersion: current.auth_version, ...(method === 'setHumanStatus' ? { status: 'disabled' } : {}) };
          const raced = await call('withRace', method, [admin.token, input], mutation, { principalId: user.principalId, sessionId: targetSession?.session.id });
          assert.equal(raced.injected, true, `${method}/${mutation}`); assert.equal(raced.result.ok, false, `${method}/${mutation}`);
          assert.deepEqual(await rows('access_audit'), beforeAudit); assert.equal((await principal(user.principalId)).status, 'active');
          assert.equal((await principal(user.principalId)).auth_version, current.auth_version + (mutation === 'target-version' ? 1 : 0));
          assert.equal(await epoch(), beforeEpoch + (mutation === 'epoch' ? 1 : 0));
          if (mutation === 'issuer-membership') await db.prepare(`UPDATE ${table('memberships')} SET status='active' WHERE principal_id=?`).bind(owner.principalId).run();
          if (mutation === 'issuer-credential-expired') await db.prepare(`UPDATE ${table('password_credentials')} SET expires_at_ms=NULL WHERE principal_id=?`).bind(owner.principalId).run();
        }
      }
      await freshAdmin();
    });

    await check('self revoke-all completes the entire claimed batch after invalidating its own source and remains revoked after restart', async () => {
      const source = admin, current = await principal(owner.principalId), tokens = await seedSessions(source, 'synthetic-owner-session', 35);
      const reset = await call('issuePasswordReset', source.token, { principalId: owner.principalId }); assert.equal(reset.ok, true);
      const beforeMarked = await count('sessions', 'WHERE principal_id=? AND revoked_at_ms IS NOT NULL', [owner.principalId]);
      assert.deepEqual(await call('revokeAllHumanSessions', source.token, { principalId: owner.principalId, expectedAuthVersion: current.auth_version }),
        { ok: true, principalId: owner.principalId, authVersion: current.auth_version + 1 });
      await assertAudit('human-sessions-revoked', source, owner.principalId);
      assert.equal(await count('sessions', 'WHERE principal_id=? AND revoked_at_ms IS NOT NULL', [owner.principalId]), beforeMarked + 32);
      for (const token of [...tokens, source.token]) assert.equal(await call('session', token, 'admin'), null);
      assert.deepEqual(await call('redeem', { token: reset.token, purpose: 'password-reset', password }), { ok: false, error: 'unavailable' });
      const before = await snapshot();
      await instance.dispose(); instance = undefined; db = undefined; await start();
      assert.deepEqual(await snapshot(), before); assert.equal(await call('session', source.token, 'admin'), null);
      assert.equal((await call('listPrincipals', source.token, { limit: 2, afterId: null, kind: 'all' })).ok, false);
      admin = await call('login', { loginIdentifier: ownerLogin, password, audience: 'admin' }); assert.equal(admin.ok, true);
      assert.equal((await call('listPrincipals', admin.token, { limit: 2, afterId: null, kind: 'all' })).ok, true);
    });
    t.diagnostic('Real local D1/Worker administration only: no impersonation, public transport, browser interface or hosted account flow.');
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
  }
});
