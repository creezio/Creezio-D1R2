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
const loginIdentifier = 'lifecycle-owner@example.invalid';
const password = 'Synthetic lifecycle initial password';
const replacement = 'Synthetic lifecycle replacement password';
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const digest = (token, purpose) => `sha256:${createHash('sha256').update(`creezio:credential:v1:${purpose}:${token}`).digest('hex')}`;
const readTarget = { contextId: 'application', audience: 'app', actors: ['user'],
  requiredPermissionIds: ['example.notes:read'], purpose: 'operation' };

test('native account lifecycle uses atomic one-use capabilities and fresh authorization in real D1', { timeout: 90000 }, async t => {
  const schema = generateD1Schema('creezio.access', models), table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/identity/lifecycle.ts', 'core/identity/lifecycle-store.ts'] });
  const bundled = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-lifecycle-worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, []);
  const state = createIdentityQualificationState(root);
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', d1Databases: { DB: 'creezio-t04-lifecycle-synthetic' }, d1Persist: join(state.directory, 'd1') };
  let instance, db, owner, admin, invited, active, resetUsed, failed = false, sequence = 0;
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External lifecycle qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function start() {
    instance = new Miniflare(options); await bounded(() => instance.ready, 5000); db = await instance.getD1Database('DB');
  }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await instance.dispatchFetch('http://internal-lifecycle-qualification/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(result.error?.message ?? `Qualification response ${response.status}`);
      return result.value;
    });
  }
  async function check(name, operation) {
    // Each scenario has independent admission windows; product throttling is qualified separately.
    // This changes only synthetic qualification rows, not the service's limits or clock.
    await db.prepare(`UPDATE ${table('auth_throttles')} SET expires_at_ms=0`).run();
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Lifecycle qualification stopped after: ${name}`);
  }
  const rows = async (id, where = '', values = []) => (await db.prepare(`SELECT * FROM ${table(id)} ${where}`).bind(...values).all()).results;
  const count = async (id, where = '', values = []) => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table(id)} ${where}`).bind(...values).first()).count;
  const capability = async item => db.prepare(`SELECT * FROM ${table('account_capabilities')} WHERE id=?`).bind(item.capabilityId).first();
  const audits = async () => rows('access_audit');
  const epoch = async () => (await db.prepare(`SELECT epoch FROM ${table('authorization_state')} WHERE id='application'`).first()).epoch;
  async function snapshot() {
    const value = {};
    for (const id of Object.keys(schema.tables).filter(id => id !== 'auth_throttles').sort()) {
      value[id] = (await rows(id)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return value;
  }
  async function invite(label) {
    const identifier = `lifecycle-${label}-${++sequence}@example.invalid`;
    const result = await call('issueInvitation', admin.token, { loginIdentifier: identifier, displayName: `Synthetic ${label}` });
    assert.equal(result.ok, true, JSON.stringify(result)); return { ...result, loginIdentifier: identifier };
  }
  async function freshAdmin() { admin = await call('issueSession', loginIdentifier, 'admin'); }
  async function assertNoPrivileges(principalId) {
    for (const id of ['memberships', 'role_assignments', 'principal_overrides'])
      assert.equal(await count(id, 'WHERE principal_id=?', [principalId]), 0, id);
  }
  async function assertAudit(action, item) {
    const matches = await rows('access_audit', 'WHERE action=? AND capability_id=?', [action, item.capabilityId]);
    assert.equal(matches.length, 1); assert.equal(matches[0].target_principal_id, item.principalId);
    assert.equal(JSON.stringify(matches).includes(item.token), false);
    assert.equal(JSON.stringify(matches).includes(digest(item.token, item.purpose)), false);
    return matches[0];
  }
  try {
    await start(); await db.batch(schema.statements.map(statement => db.prepare(statement)));
    owner = await call('bootstrap', { loginIdentifier, displayName: 'Synthetic lifecycle administrator', password });
    assert.equal(owner.ok, true);
    admin = await call('login', { loginIdentifier, password, audience: 'admin' }); assert.equal(admin.ok, true);

    await check('invitation requires administrative authority and persists only a pending credentialless account', async () => {
      const app = await call('issueSession', loginIdentifier, 'app'), before = await snapshot();
      const input = { loginIdentifier: 'unauthorized-invitation@example.invalid', displayName: 'Denied invitation' };
      assert.equal((await call('issueInvitation', 'malformed', input)).error, 'unauthorized');
      assert.equal((await call('issueInvitation', app.token, input)).ok, false);
      assert.deepEqual(await snapshot(), before);
      invited = await invite('first');
      assert.equal(invited.purpose, 'invitation'); assert.match(invited.token, /^cz1i_/);
      const stored = await capability(invited);
      assert.equal(stored.secret_hash, digest(invited.token, 'invitation'));
      assert.equal(stored.credential_version, null); assert.equal(stored.consumed_at_ms, null); assert.equal(stored.revoked_at_ms, null);
      assert.equal((await rows('human_accounts', 'WHERE principal_id=?', [invited.principalId]))[0].status, 'pending');
      assert.equal(await count('password_credentials', 'WHERE principal_id=?', [invited.principalId]), 0);
      assert.equal(await count('sessions', 'WHERE principal_id=?', [invited.principalId]), 0);
      await assertNoPrivileges(invited.principalId); await assertAudit('capability-issued', invited);
      assert.deepEqual(await call('login', { loginIdentifier: invited.loginIdentifier, password, audience: 'app' }), { ok: false, code: 'invalid_credentials' });
    });

    await check('acceptance uses a native password but creates no session or implicit permission', async () => {
      const before = await snapshot();
      assert.deepEqual(await call('redeem', { token: invited.token, purpose: 'activation', password }), { ok: false, error: 'unavailable' });
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await call('redeem', { token: invited.token, purpose: 'invitation', password }), { ok: true, principalId: invited.principalId });
      assert.deepEqual(await call('redeem', { token: invited.token, purpose: 'invitation', password }), { ok: false, error: 'unavailable' });
      assert.equal(await count('sessions', 'WHERE principal_id=?', [invited.principalId]), 0);
      await assertNoPrivileges(invited.principalId); await assertAudit('account-activated', invited);
      active = await call('login', { loginIdentifier: invited.loginIdentifier, password, audience: 'app' }); assert.equal(active.ok, true);
      assert.equal((await call('check', active.token, readTarget)).allowed, false);
      const accountAdmin = await call('issueSession', invited.loginIdentifier, 'admin');
      assert.equal((await call('issueInvitation', accountAdmin.token, { loginIdentifier: 'no-right@example.invalid', displayName: 'Denied' })).error, 'forbidden');
      for (const forbidden of ['password_record', 'secret_hash', 'digest', 'password']) assert.equal(Object.hasOwn(active.session, forbidden), false);
    });

    await check('a separate authorized ACL change grants access without changing the account lifecycle', async () => {
      const before = await call('readPolicy', admin.token), policy = structuredClone(before.policy);
      policy.roles.push({ id: 'notes-reader', inherits: [], permissionIds: ['example.notes:read'], permissionOverrides: [] });
      policy.memberships.push({ principalId: invited.principalId, contextId: 'application', audience: 'app', status: 'active' });
      policy.assignments.push({ principalId: invited.principalId, contextId: 'application', audience: 'app', roleId: 'notes-reader' });
      assert.deepEqual(await call('replacePolicy', admin.token, { expectedEpoch: before.epoch, policy }), { ok: true, epoch: before.epoch + 1 });
      assert.equal((await call('check', active.token, readTarget)).allowed, true);
    });

    await check('activation reissues a pending account and validated redemption inputs stay immutable across awaits', async () => {
      const pending = await invite('activation');
      await db.prepare(`UPDATE ${table('account_capabilities')} SET expires_at_ms=${NOW} WHERE id=?`).bind(pending.capabilityId).run();
      const activation = await call('issueActivation', admin.token, { principalId: pending.principalId });
      assert.equal(activation.ok, true); assert.equal(activation.purpose, 'activation'); assert.equal(activation.principalId, pending.principalId);
      const result = await call('redeemMutableInput', { token: activation.token, purpose: 'activation', password });
      assert.equal(result.mutated, true); assert.deepEqual(result.result, { ok: true, principalId: pending.principalId });
      const login = await call('login', { loginIdentifier: pending.loginIdentifier, password, audience: 'app' }); assert.equal(login.ok, true);
      assert.deepEqual(await call('login', { loginIdentifier: pending.loginIdentifier, password: 'Attacker replacement must not be persisted', audience: 'app' }), { ok: false, code: 'invalid_credentials' });
      assert.equal(await call('readCapability', pending.token, 'invitation'), null); await assertNoPrivileges(pending.principalId);
      assert.equal((await call('issueActivation', admin.token, { principalId: pending.principalId })).ok, false);
    });

    await check('password reset recovers an expired credential, invalidates all sessions and retains only explicit ACL grants', async () => {
      const oldApp = await call('issueSession', invited.loginIdentifier, 'app'), oldAdmin = await call('issueSession', invited.loginIdentifier, 'admin');
      // More than the physical revocation batch: fixture rows use the same current versions as a real session.
      const overflowTokens = Array.from({ length: 35 }, (_, index) => `cz1s_${Buffer.alloc(32, index + 1).toString('base64url')}`);
      await db.batch(overflowTokens.map((token, index) => db.prepare(`INSERT INTO ${table('sessions')}
        (id,secret_hash,principal_id,audience,auth_version,account_version,credential_version,created_at_ms,expires_at_ms,revoked_at_ms,revocation_nonce)
        SELECT ?,?,principal_id,audience,auth_version,account_version,credential_version,created_at_ms,expires_at_ms,NULL,NULL
        FROM ${table('sessions')} WHERE id=?`).bind(`synthetic-overflow-${index}`, digest(token, 'session'), oldApp.session.id)));
      for (const token of overflowTokens) assert.notEqual(await call('session', token, 'app'), null);
      const beforeAccount = (await rows('human_accounts', 'WHERE principal_id=?', [invited.principalId]))[0];
      const beforePrincipal = (await rows('principals', 'WHERE id=?', [invited.principalId]))[0];
      const beforeCredential = (await rows('password_credentials', 'WHERE principal_id=?', [invited.principalId]))[0];
      const beforePolicy = await call('readPolicy', admin.token);
      const historical = await call('issuePasswordReset', admin.token, { principalId: invited.principalId }); assert.equal(historical.ok, true);
      await db.prepare(`UPDATE ${table('account_capabilities')} SET expires_at_ms=${NOW} WHERE id=?`).bind(historical.capabilityId).run();
      await db.prepare(`UPDATE ${table('password_credentials')} SET expires_at_ms=${NOW} WHERE principal_id=?`).bind(invited.principalId).run();
      const reset = await call('issuePasswordReset', admin.token, { principalId: invited.principalId }); assert.equal(reset.ok, true);
      const sibling = await call('issuePasswordReset', admin.token, { principalId: invited.principalId }); assert.equal(sibling.ok, true);
      const sessionCount = await count('sessions', 'WHERE principal_id=?', [invited.principalId]);
      const markedBefore = await count('sessions', 'WHERE principal_id=? AND revoked_at_ms IS NOT NULL', [invited.principalId]);
      resetUsed = sibling;
      assert.deepEqual(await call('redeem', { token: sibling.token, purpose: 'password-reset', password: replacement }), { ok: true, principalId: invited.principalId });
      assert.equal(await count('sessions', 'WHERE principal_id=?', [invited.principalId]), sessionCount);
      for (const old of [active, oldApp, oldAdmin]) assert.equal(await call('session', old.token, old.session.audience), null);
      for (const token of overflowTokens) assert.equal(await call('session', token, 'app'), null);
      assert.equal(await count('sessions', 'WHERE principal_id=? AND revoked_at_ms IS NOT NULL', [invited.principalId]), markedBefore + 32);
      assert.ok(await count('sessions', 'WHERE principal_id=? AND revoked_at_ms IS NULL', [invited.principalId]) > 0);
      assert.equal((await capability(historical)).revoked_at_ms, null);
      assert.equal(await call('readCapability', historical.token, 'password-reset'), null);
      assert.equal(await call('readCapability', reset.token, 'password-reset'), null);
      assert.deepEqual(await call('readPolicy', admin.token), beforePolicy);
      assert.equal((await rows('principals', 'WHERE id=?', [invited.principalId]))[0].auth_version, beforePrincipal.auth_version + 1);
      assert.equal((await rows('human_accounts', 'WHERE principal_id=?', [invited.principalId]))[0].version, beforeAccount.version + 1);
      const afterCredential = (await rows('password_credentials', 'WHERE principal_id=?', [invited.principalId]))[0];
      assert.equal(afterCredential.version, beforeCredential.version + 1); assert.equal(afterCredential.expires_at_ms, null);
      assert.deepEqual(await call('login', { loginIdentifier: invited.loginIdentifier, password, audience: 'app' }), { ok: false, code: 'invalid_credentials' });
      active = await call('login', { loginIdentifier: invited.loginIdentifier, password: replacement, audience: 'app' }); assert.equal(active.ok, true);
      assert.equal((await call('check', active.token, readTarget)).allowed, true); await assertAudit('password-reset', sibling);
    });

    await check('concurrent redemption has one winner and an already acquired audit claim cannot be replayed', async () => {
      const pending = await invite('concurrent'), beforeEpoch = await epoch();
      const results = await Promise.all([1, 2].map(() => call('redeem', { token: pending.token, purpose: 'invitation', password })));
      assert.equal(results.filter(result => result.ok).length, 1); assert.equal(results.filter(result => result.error === 'unavailable').length, 1);
      await assertAudit('account-activated', pending); assert.equal(await epoch(), beforeEpoch);
      const after = await snapshot();
      assert.deepEqual(await call('redeem', { token: pending.token, purpose: 'invitation', password: replacement }), { ok: false, error: 'unavailable' });
      assert.deepEqual(await snapshot(), after); await assertNoPrivileges(pending.principalId);
    });

    await check('expiry, revocation and target state changes after the capability read prevent every completion effect', async () => {
      for (const mutation of ['expired', 'revoked', 'principal', 'account', 'principal-version', 'account-version']) {
        const pending = await invite(`race-${mutation}`), beforeAudits = await audits(), beforeEpoch = await epoch();
        const raced = await call('withRace', 'redeem', [{ token: pending.token, purpose: 'invitation', password }], mutation, pending);
        assert.equal(raced.injected, true, mutation); assert.deepEqual(raced.result, { ok: false, error: 'unavailable' }, mutation);
        assert.equal((await capability(pending)).consumed_at_ms, null, mutation);
        assert.equal((await capability(pending)).claim_nonce, null, mutation);
        assert.equal(await count('password_credentials', 'WHERE principal_id=?', [pending.principalId]), 0, mutation);
        assert.equal(await count('sessions', 'WHERE principal_id=?', [pending.principalId]), 0, mutation);
        await assertNoPrivileges(pending.principalId); assert.deepEqual(await audits(), beforeAudits); assert.equal(await epoch(), beforeEpoch);
      }
      const reset = await call('issuePasswordReset', admin.token, { principalId: invited.principalId }); assert.equal(reset.ok, true);
      const before = (await rows('password_credentials', 'WHERE principal_id=?', [invited.principalId]))[0], beforeAudits = await audits();
      const raced = await call('withRace', 'redeem', [{ token: reset.token, purpose: 'password-reset', password }], 'credential-version', reset);
      assert.equal(raced.injected, true); assert.deepEqual(raced.result, { ok: false, error: 'unavailable' });
      const after = (await rows('password_credentials', 'WHERE principal_id=?', [invited.principalId]))[0];
      assert.equal(after.password_record, before.password_record); assert.equal(after.version, before.version + 1);
      assert.equal((await capability(reset)).consumed_at_ms, null); assert.deepEqual(await audits(), beforeAudits);
    });

    await check('issuance and revocation recheck admin session and authorization epoch at the actual commit', async () => {
      for (const method of ['issueInvitation', 'issuePasswordReset', 'revokeCapability']) {
        for (const mutation of method === 'issuePasswordReset' ? ['epoch', 'issuer-revoked']
          : ['epoch', 'issuer-revoked', 'issuer-expired', 'issuer-membership', 'issuer-credential']) {
          await freshAdmin();
          const pending = method === 'revokeCapability' ? await invite(`guard-${mutation}`) : null;
          const identifier = `guard-${++sequence}@example.invalid`;
          const input = pending ? { capabilityId: pending.capabilityId }
            : method === 'issuePasswordReset' ? { principalId: invited.principalId }
              : { loginIdentifier: identifier, displayName: 'Synthetic race' };
          const beforeAudits = await audits(), beforeEpoch = await epoch();
          const raced = await call('withRace', method, [admin.token, input], mutation);
          assert.equal(raced.injected, true, `${method}/${mutation}`); assert.equal(raced.result.ok, false, `${method}/${mutation}`);
          assert.deepEqual(await audits(), beforeAudits); assert.equal(await epoch(), beforeEpoch + (mutation === 'epoch' ? 1 : 0));
          if (pending) assert.equal((await capability(pending)).revoked_at_ms, null);
          else assert.equal(await count('human_accounts', 'WHERE login_identifier=?', [identifier]), 0);
          if (mutation === 'issuer-membership') await db.prepare(`UPDATE ${table('memberships')} SET status='active' WHERE principal_id=? AND context_id='application' AND audience='admin'`).bind(owner.principalId).run();
        }
      }
      await freshAdmin();
    });

    await check('late SQL failures roll back issuance and redemption claims with their account and audit effects', async () => {
      const pending = await invite('late'), before = await snapshot();
      await db.prepare(`CREATE TRIGGER qualification_lifecycle_late_failure BEFORE INSERT ON ${table('password_credentials')}
        WHEN NEW.principal_id='${pending.principalId}' BEGIN SELECT RAISE(ABORT,'synthetic_lifecycle_late_failure'); END`).run();
      assert.deepEqual(await call('redeem', { token: pending.token, purpose: 'invitation', password }), { ok: false, error: 'storage_error' });
      assert.deepEqual(await snapshot(), before);
      await db.prepare('DROP TRIGGER qualification_lifecycle_late_failure').run();
      assert.deepEqual(await call('redeem', { token: pending.token, purpose: 'invitation', password }), { ok: true, principalId: pending.principalId });
      const beforeIssue = await snapshot();
      await db.prepare(`CREATE TRIGGER qualification_lifecycle_issue_failure BEFORE INSERT ON ${table('account_capabilities')}
        BEGIN SELECT RAISE(ABORT,'synthetic_lifecycle_issue_failure'); END`).run();
      assert.deepEqual(await call('issueInvitation', admin.token, { loginIdentifier: 'rollback-issue@example.invalid', displayName: 'Synthetic rollback' }), { ok: false, error: 'storage_error' });
      assert.deepEqual(await snapshot(), beforeIssue);
      await db.prepare('DROP TRIGGER qualification_lifecycle_issue_failure').run();
      const reset = await call('issuePasswordReset', admin.token, { principalId: invited.principalId }); assert.equal(reset.ok, true);
      const sibling = await call('issuePasswordReset', admin.token, { principalId: invited.principalId }); assert.equal(sibling.ok, true);
      const live = await call('issueSession', invited.loginIdentifier, 'app'), beforeReset = await snapshot();
      // This error is after PHC, account/principal versions, session markers and sibling capabilities changed.
      await db.prepare(`CREATE TRIGGER qualification_lifecycle_reset_failure BEFORE INSERT ON ${table('access_audit')}
        WHEN NEW.action='password-reset' BEGIN SELECT RAISE(ABORT,'synthetic_lifecycle_reset_failure'); END`).run();
      assert.deepEqual(await call('redeem', { token: reset.token, purpose: 'password-reset', password: replacement }), { ok: false, error: 'storage_error' });
      assert.deepEqual(await snapshot(), beforeReset); assert.notEqual(await call('session', live.token, 'app'), null);
      await db.prepare('DROP TRIGGER qualification_lifecycle_reset_failure').run();
      assert.deepEqual(await call('redeem', { token: reset.token, purpose: 'password-reset', password: replacement }), { ok: true, principalId: invited.principalId });
      assert.equal(await call('session', live.token, 'app'), null); assert.equal(await call('readCapability', sibling.token, 'password-reset'), null);
      await assertAudit('password-reset', reset);
    });

    await check('explicit capability revocation is one-use and cannot reuse a prior audit receipt or stale guard', async () => {
      const pending = await invite('revocation');
      assert.deepEqual(await call('revokeCapability', admin.token, { capabilityId: pending.capabilityId }), { ok: true });
      await assertAudit('capability-revoked', pending);
      const after = await snapshot();
      assert.equal(await call('staleRevoke', admin.token, pending.capabilityId), false);
      assert.equal((await call('revokeCapability', admin.token, { capabilityId: pending.capabilityId })).ok, false);
      assert.deepEqual(await call('redeem', { token: pending.token, purpose: 'invitation', password }), { ok: false, error: 'unavailable' });
      assert.deepEqual(await snapshot(), after);
    });

    await check('per-account, global-capability and principal bounds reject writes without orphan rows or audit claims', async () => {
      const pending = await invite('bounded'), issued = [pending];
      for (let index = 0; index < 7; index++) {
        const result = await call('issueActivation', admin.token, { principalId: pending.principalId });
        assert.equal(result.ok, true); issued.push(result);
      }
      let before = await snapshot();
      assert.deepEqual(await call('issueActivation', admin.token, { principalId: pending.principalId }), { ok: false, error: 'conflict' });
      assert.deepEqual(await snapshot(), before);
      // Expired and revoked rows do not permanently consume the eight available slots.
      await db.prepare(`UPDATE ${table('account_capabilities')} SET expires_at_ms=${NOW} WHERE id=?`).bind(issued[0].capabilityId).run();
      assert.equal((await call('issueActivation', admin.token, { principalId: pending.principalId })).ok, true);
      assert.deepEqual(await call('revokeCapability', admin.token, { capabilityId: issued[1].capabilityId }), { ok: true });
      assert.equal((await call('issueActivation', admin.token, { principalId: pending.principalId })).ok, true);
      const available = `WHERE consumed_at_ms IS NULL AND revoked_at_ms IS NULL AND expires_at_ms>${NOW}`;
      assert.equal(await count('account_capabilities', `${available} AND principal_id=?`, [pending.principalId]), 8);

      // Seed current-version synthetic recovery capabilities in one SQL operation; no password derivation or external resource.
      // Invitation targets a new principal, so this exercises the GLOBAL bound independently of a target's quota.
      const bulkCapabilities = Array.from({ length: 512 - await count('account_capabilities', available) }, (_, index) => ({
        id: `synthetic-limit-capability-${index}`, hash: `sha256:${createHash('sha256').update(`synthetic-limit-${index}`).digest('hex')}`,
      }));
      await db.prepare(`INSERT INTO ${table('account_capabilities')}
        (id,secret_hash,purpose,principal_id,auth_version,account_version,credential_version,created_at_ms,expires_at_ms,consumed_at_ms,revoked_at_ms,claim_nonce)
        SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.hash'),'password-reset',p.id,p.auth_version,h.version,c.version,
          ${NOW},${NOW}+60000,NULL,NULL,NULL
        FROM json_each(?) j CROSS JOIN ${table('principals')} p JOIN ${table('human_accounts')} h ON h.principal_id=p.id
          JOIN ${table('password_credentials')} c ON c.principal_id=p.id WHERE p.id=?`).bind(JSON.stringify(bulkCapabilities), owner.principalId).run();
      try {
        assert.equal(await count('account_capabilities', available), 512); before = await snapshot();
        assert.deepEqual(await call('issueInvitation', admin.token, { loginIdentifier: 'global-limit@example.invalid', displayName: 'Denied global quota' }), { ok: false, error: 'conflict' });
        assert.deepEqual(await snapshot(), before);
        await db.prepare(`UPDATE ${table('account_capabilities')} SET consumed_at_ms=${NOW} WHERE id=?`).bind(bulkCapabilities[0].id).run();
        assert.equal((await call('issueInvitation', admin.token, { loginIdentifier: 'global-slot-released@example.invalid', displayName: 'Released global quota' })).ok, true);
      } finally {
        await db.prepare(`DELETE FROM ${table('account_capabilities')} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(bulkCapabilities.map(item => item.id))).run();
      }

      const bulkPrincipals = Array.from({ length: 1024 - await count('principals') }, (_, index) => `synthetic-limit-principal-${index}`);
      await db.prepare(`INSERT INTO ${table('principals')} (id,kind,status,auth_version,display_name,created_at_ms,updated_at_ms)
        SELECT value,'service','active',1,'Synthetic bounded principal',${NOW},${NOW} FROM json_each(?)`).bind(JSON.stringify(bulkPrincipals)).run();
      try {
        assert.equal(await count('principals'), 1024); before = await snapshot();
        assert.deepEqual(await call('issueInvitation', admin.token, { loginIdentifier: 'principal-limit@example.invalid', displayName: 'Denied principal quota' }), { ok: false, error: 'conflict' });
        assert.deepEqual(await snapshot(), before);
      } finally {
        await db.prepare(`DELETE FROM ${table('principals')} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(bulkPrincipals)).run();
      }
    });

    await check('persisted password and consumed capability survive restart without an implicit session or authority grant', async () => {
      const before = await snapshot();
      await instance.dispose(); instance = undefined; db = undefined; await start();
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await call('redeem', { token: resetUsed.token, purpose: 'password-reset', password }), { ok: false, error: 'unavailable' });
      const login = await call('login', { loginIdentifier: invited.loginIdentifier, password: replacement, audience: 'app' });
      assert.equal(login.ok, true); assert.equal((await call('check', login.token, readTarget)).allowed, true);
      assert.equal((await call('readPolicy', login.token)).ok, false);
    });
    t.diagnostic('Real local Worker and D1 qualification only; no product HTTP, email delivery, OAuth, browser or hosted Sites claim. Every fixture instance is disposed before owned state cleanup.');
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
  }
});
