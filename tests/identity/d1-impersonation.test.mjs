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
const ownerLogin = 'impersonation-owner@example.invalid', subjectLogin = 'impersonation-subject@example.invalid';
const password = 'Synthetic impersonation qualification password';
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const READ = 'example.work:read', WRITE = 'example.work:write', LATER = 'example.work:later';
const IMPERSONATE = 'creezio.access:impersonate';
const digest = token => `sha256:${createHash('sha256').update(`creezio:credential:v1:impersonation:${token}`).digest('hex')}`;
const target = (contextId = 'workspace-a', audience = 'app', permissions = [READ]) => ({ contextId, audience,
  actors: ['impersonated-user'], requiredPermissionIds: permissions, purpose: 'operation' });

test('impersonation keeps exact scopes, fresh source and subject authority, and atomic auditable termination in real D1', { timeout: 90000 }, async t => {
  const schema = generateD1Schema('creezio.access', models), table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/identity/impersonation.ts', 'core/identity/impersonation-store.ts'] });
  const bundled = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-impersonation-worker.mjs'], bundle: true,
    write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, []);
  const state = createIdentityQualificationState(root);
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', d1Databases: { DB: 'creezio-t04-impersonation-synthetic' }, d1Persist: join(state.directory, 'd1') };
  let instance, db, owner, subject, admin, subjectSession, machine, pending, failed = false;
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External impersonation qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function startWorker() { instance = new Miniflare(options); await bounded(() => instance.ready, 5000); db = await instance.getD1Database('DB'); }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await instance.dispatchFetch('http://internal-impersonation-qualification/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(result.error?.message ?? `Qualification response ${response.status}`);
      return result.value;
    });
  }
  async function check(name, operation) {
    // Independent synthetic admission windows. No product clock, threshold or permission is bypassed.
    await db.prepare(`UPDATE ${table('auth_throttles')} SET expires_at_ms=0`).run();
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Impersonation qualification stopped after: ${name}`);
  }
  const rows = async (id, where = '', values = []) => (await db.prepare(`SELECT * FROM ${table(id)} ${where}`).bind(...values).all()).results;
  const count = async (id, where = '', values = []) => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table(id)} ${where}`).bind(...values).first()).count;
  async function snapshot() {
    const value = {};
    for (const id of Object.keys(schema.tables).filter(id => id !== 'auth_throttles').sort())
      value[id] = (await rows(id)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return value;
  }
  const input = (extra = {}) => ({ subjectPrincipalId: subject.principalId, contextId: 'workspace-a', audience: 'app',
    permissionIds: [READ], reason: 'Synthetic support investigation', ttlMs: 60000, ...extra });
  async function issue(extra = {}, token = admin.token) {
    const value = await call('start', token, input(extra)); assert.equal(value.ok, true); return value;
  }
  async function freshAdmin() { admin = await call('issueSession', ownerLogin, 'admin'); }
  async function changePolicy(change) {
    const current = await call('readPolicy', admin.token); assert.equal(current.ok, true);
    const policy = structuredClone(current.policy); change(policy);
    const result = await call('replacePolicy', admin.token, { expectedEpoch: current.epoch, policy }); assert.equal(result.ok, true);
  }
  async function restoreRow(id, record, keys) {
    const columns = Object.keys(record).filter(column => !keys.includes(column));
    await db.prepare(`UPDATE ${table(id)} SET ${columns.map(column => `"${column}"=?`).join(',')}
      WHERE ${keys.map(column => `"${column}"=?`).join(' AND ')}`).bind(...columns.map(column => record[column]), ...keys.map(column => record[column])).run();
  }
  async function principalState() {
    return { principals: await rows('principals'), human_accounts: await rows('human_accounts'), password_credentials: await rows('password_credentials'),
      contexts: await rows('contexts'), memberships: await rows('memberships') };
  }
  async function restorePrincipalState(value) {
    for (const [id, records] of Object.entries(value)) for (const record of records)
      await restoreRow(id, record, id === 'memberships' ? ['principal_id', 'context_id', 'audience'] : id === 'human_accounts' || id === 'password_credentials' ? ['principal_id'] : ['id']);
  }
  async function assertAudit(action, issued, source = admin) {
    const audit = await rows('access_audit', 'WHERE action=? AND impersonation_id=?', [action, issued.impersonation.id]);
    assert.equal(audit.length, 1); assert.equal(audit[0].principal_id, owner.principalId);
    assert.equal(audit[0].session_id, source.session.id); assert.equal(audit[0].target_principal_id, subject.principalId);
    assert.equal(audit[0].context_id, issued.impersonation.contextId); assert.equal(audit[0].audience, issued.impersonation.audience);
    assert.equal(JSON.stringify(audit).includes(issued.token), false); assert.equal(JSON.stringify(audit).includes(digest(issued.token)), false);
  }
  try {
    await startWorker(); await db.batch(schema.statements.map(sql => db.prepare(sql)));
    owner = await call('bootstrap', { loginIdentifier: ownerLogin, displayName: 'Synthetic support administrator', password }); assert.equal(owner.ok, true);
    admin = await call('login', { loginIdentifier: ownerLogin, password, audience: 'admin' }); assert.equal(admin.ok, true);
    const invitation = await call('issueInvitation', admin.token, { loginIdentifier: subjectLogin, displayName: 'Synthetic supported user' }); assert.equal(invitation.ok, true);
    subject = await call('redeem', { token: invitation.token, purpose: 'invitation', password }); assert.equal(subject.ok, true);
    subjectSession = await call('login', { loginIdentifier: subjectLogin, password, audience: 'app' }); assert.equal(subjectSession.ok, true);
    machine = await call('createService', admin.token, { displayName: 'Synthetic service target' }); assert.equal(machine.ok, true);
    pending = await call('issueInvitation', admin.token, { loginIdentifier: 'impersonation-pending@example.invalid', displayName: 'Synthetic pending target' }); assert.equal(pending.ok, true);

    await check('bootstrap does not imply impersonation and only explicit dedicated authority enables issuance', async () => {
      assert.equal(await count('role_grants', 'WHERE permission_id=?', [IMPERSONATE]), 0);
      await changePolicy(policy => {
        policy.contexts.push({ id: 'workspace-a', status: 'active' }, { id: 'workspace-b', status: 'active' });
        policy.roles.push({ id: 'business-reader', inherits: [], permissionIds: [READ], permissionOverrides: [] },
          { id: 'business', inherits: ['business-reader'], permissionIds: [WRITE, 'example.work:human'], permissionOverrides: [] });
        for (const contextId of ['workspace-a', 'workspace-b']) for (const audience of ['app', 'admin']) {
          policy.memberships.push({ principalId: subject.principalId, contextId, audience, status: 'active' });
          policy.assignments.push({ principalId: subject.principalId, contextId, audience, roleId: 'business' });
        }
      });
      const before = await snapshot(); assert.deepEqual(await call('start', admin.token, input()), { ok: false, error: 'forbidden' });
      assert.deepEqual(await snapshot(), before);
      await changePolicy(policy => {
        policy.roles.push({ id: 'support', inherits: [], permissionIds: [IMPERSONATE], permissionOverrides: [] });
        policy.assignments.push({ principalId: owner.principalId, contextId: 'application', audience: 'admin', roleId: 'support' });
      });
      const measured = await call('measured', 'start', [admin.token, input()]); assert.equal(measured.result.ok, true);
      assert.equal(measured.batches.filter(batch => batch.reads).length, 1, 'Source, subject and ACL are read together.');
      const created = measured.result, projection = created.impersonation;
      assert.deepEqual(Object.keys(projection).sort(), ['actorPrincipalId', 'audience', 'contextId', 'createdAtMs', 'expiresAtMs', 'id', 'permissionIds', 'reason', 'sourceSessionId', 'subjectPrincipalId']);
      assert.equal(projection.actorPrincipalId, owner.principalId); assert.equal(projection.subjectPrincipalId, subject.principalId);
      assert.equal(projection.sourceSessionId, admin.session.id); assert.match(created.token, /^cz1p_[A-Za-z0-9_-]{43}$/);
      const stored = (await rows('impersonations', 'WHERE id=?', [projection.id]))[0]; assert.equal(stored.secret_hash, digest(created.token));
      assert.equal(JSON.stringify(await snapshot()).includes(created.token), false);
      assert.deepEqual((await snapshot()).sessions, before.sessions, 'No subject or administrator session is minted by impersonation.');
      assert.equal(await call('session', created.token, 'app'), null);
      await assertAudit('impersonation-started', created); assert.deepEqual(await call('stop', created.token), { ok: true });
    });

    await check('two audiences and contexts remain exact scopes, including authenticated operations without permissions', async () => {
      const app = await issue(), workspace = await issue({ contextId: 'workspace-b', audience: 'admin', permissionIds: [WRITE] });
      for (const [created, contextId, audience, permission] of [[app, 'workspace-a', 'app', READ], [workspace, 'workspace-b', 'admin', WRITE]]) {
        const measured = await call('measured', 'check', [created.token, target(contextId, audience, [permission])]);
        assert.equal(measured.result.allowed, true); assert.equal(measured.batches.length, 1); assert.equal(measured.batches[0].reads, true);
        assert.equal((await call('check', created.token, target(contextId, audience, []))).allowed, true);
        for (const [otherContext, otherAudience] of [['workspace-a', 'app'], ['workspace-a', 'admin'], ['workspace-b', 'app'], ['workspace-b', 'admin']]) {
          if (otherContext === contextId && otherAudience === audience) continue;
          assert.equal((await call('check', created.token, target(otherContext, otherAudience, []))).allowed, false);
        }
        assert.equal((await call('check', created.token, target(contextId, audience, [permission === READ ? WRITE : READ]))).allowed, false);
        assert.equal((await call('check', created.token, { ...target(contextId, audience, [permission]), actors: ['user'] })).allowed, false);
      }
      for (const created of [app, workspace]) assert.deepEqual(await call('stop', created.token), { ok: true });
    });

    await check('ordinary sessions, services, self, chains, reserved administration and human approval cannot cross the credential boundary', async () => {
      const appSource = await call('issueSession', ownerLogin, 'app'), wrongPurpose = await call('opaqueToken', 'api-token');
      const created = await issue();
      for (const source of [appSource.token, wrongPurpose, created.token, 'malformed']) {
        const before = await snapshot(); assert.equal((await call('start', source, input())).ok, false); assert.deepEqual(await snapshot(), before);
      }
      for (const subjectPrincipalId of [owner.principalId, machine.principal.id, pending.principalId]) {
        const before = await snapshot(); assert.equal((await call('start', admin.token, input({ subjectPrincipalId }))).ok, false); assert.deepEqual(await snapshot(), before);
      }
      for (const permissionIds of [['creezio.access:manage'], [IMPERSONATE], ['example.work:human'], [LATER], []])
        assert.equal((await call('start', admin.token, input({ permissionIds }))).ok, false);
      for (const request of [{ ...target(), purpose: 'human-approval' }, target('workspace-a', 'app', ['creezio.access:manage']), target('workspace-a', 'app', [IMPERSONATE])])
        assert.equal((await call('check', created.token, request)).allowed, false);
      assert.equal((await call('nativeCheck', created.token, { ...target(), actors: ['user'] })).allowed, false);
      assert.equal((await call('listPrincipals', created.token, { limit: 1, afterId: null, kind: 'all' })).ok, false);
      assert.equal((await call('check', admin.token, target())).allowed, false);
      assert.deepEqual(await call('stop', created.token), { ok: true });
    });

    await check('request ceilings and target policies are copied before asynchronous reads and later grants cannot enlarge a credential', async () => {
      const mutated = await call('mutableInput', 'start', [admin.token, input()]); assert.equal(mutated.mutated, true); assert.equal(mutated.result.ok, true);
      const created = mutated.result;
      assert.deepEqual(created.impersonation.permissionIds, [READ]); assert.equal(created.impersonation.contextId, 'workspace-a');
      assert.equal(created.impersonation.audience, 'app'); assert.equal(created.impersonation.reason, input().reason);
      const checked = await call('mutableInput', 'check', [created.token, target('workspace-a', 'app', [WRITE])]);
      assert.equal(checked.mutated, true); assert.equal(checked.result.allowed, false);
      await changePolicy(policy => { policy.roles.find(role => role.id === 'business').permissionIds.push(LATER); });
      assert.equal((await call('check', created.token, target('workspace-a', 'app', [LATER]))).allowed, false);
      await changePolicy(policy => { policy.overrides.push({ principalId: subject.principalId, contextId: 'workspace-a', audience: 'app', permissionId: READ, effect: 'deny' }); });
      assert.equal((await call('check', created.token, target())).allowed, false);
      await changePolicy(policy => { policy.overrides = []; });
      assert.equal((await call('check', created.token, target())).allowed, true);
      assert.deepEqual(await call('stop', created.token), { ok: true });
    });

    await check('TTL is capped by source session and both password expiries, without modifying either account or personal sessions', async () => {
      for (const ttlMs of [0, 900001]) assert.equal((await call('start', admin.token, input({ ttlMs }))).ok, false);
      for (const bound of ['session', 'source-password', 'subject-password']) {
        await freshAdmin(); const saved = await principalState();
        const expiry = (await db.prepare(`SELECT ${NOW}+30000 AS value`).first()).value;
        const id = bound === 'session' ? 'sessions' : 'password_credentials';
        const key = bound === 'session' ? 'id' : 'principal_id';
        const value = bound === 'subject-password' ? subject.principalId : bound === 'session' ? admin.session.id : owner.principalId;
        await db.prepare(`UPDATE ${table(id)} SET expires_at_ms=? WHERE ${key}=?`).bind(expiry, value).run();
        const before = await principalState(), sessions = await rows('sessions');
        const created = await issue({ ttlMs: 900000 }); assert.equal(created.impersonation.expiresAtMs, expiry);
        assert.deepEqual(await principalState(), before); assert.deepEqual(await rows('sessions'), sessions);
        assert.deepEqual(await call('stop', created.token), { ok: true }); await restorePrincipalState(saved);
      }
      await freshAdmin();
    });

    await check('fresh source, subject, membership and password state revoke decisions while possession still permits explicit stop', async () => {
      const changes = [
        ['sessions', 'id', () => admin.session.id, `revoked_at_ms=${NOW}`],
        ['sessions', 'id', () => admin.session.id, `expires_at_ms=${NOW}`],
        ['principals', 'id', () => owner.principalId, 'auth_version=auth_version+1'],
        ['human_accounts', 'principal_id', () => owner.principalId, 'version=version+1'],
        ['password_credentials', 'principal_id', () => owner.principalId, 'version=version+1'],
        ['password_credentials', 'principal_id', () => owner.principalId, `expires_at_ms=${NOW}`],
        ['principals', 'id', () => subject.principalId, "status='disabled'"],
        ['principals', 'id', () => subject.principalId, 'auth_version=auth_version+1'],
        ['human_accounts', 'principal_id', () => subject.principalId, 'version=version+1'],
        ['password_credentials', 'principal_id', () => subject.principalId, 'version=version+1'],
        ['password_credentials', 'principal_id', () => subject.principalId, `expires_at_ms=${NOW}`],
        ['contexts', 'id', () => 'workspace-a', "status='disabled'"],
      ];
      for (const [id, key, identify, update] of changes) {
        await freshAdmin(); const saved = await principalState(), created = await issue();
        await db.prepare(`UPDATE ${table(id)} SET ${update} WHERE ${key}=?`).bind(identify()).run();
        assert.equal((await call('check', created.token, target())).allowed, false, `${id}/${update}`);
        const before = await principalState(), sessions = await rows('sessions');
        assert.deepEqual(await call('stop', created.token), { ok: true });
        assert.deepEqual(await principalState(), before); assert.deepEqual(await rows('sessions'), sessions);
        await assertAudit('impersonation-stopped', created); await restorePrincipalState(saved);
      }
      await freshAdmin();
      for (const [principalId, contextId, audience] of [[owner.principalId, 'application', 'admin'], [subject.principalId, 'workspace-a', 'app']]) {
        const created = await issue();
        if (principalId === owner.principalId) {
          // Simulate another administrator's committed change without bypassing the editor's self-lockout rule.
          await db.batch([db.prepare(`UPDATE ${table('memberships')} SET status='disabled' WHERE principal_id=? AND context_id=? AND audience=?`).bind(principalId, contextId, audience),
            db.prepare(`UPDATE ${table('authorization_state')} SET epoch=epoch+1 WHERE id='application'`)]);
        } else await changePolicy(policy => { policy.memberships.find(m => m.principalId === principalId && m.contextId === contextId && m.audience === audience).status = 'disabled'; });
        assert.equal((await call('check', created.token, target())).allowed, false);
        assert.deepEqual(await call('stop', created.token), { ok: true });
        // Synthetic restoration: the administrative editor correctly refuses to disable its own only admin membership.
        await db.prepare(`UPDATE ${table('memberships')} SET status='active' WHERE principal_id=? AND context_id=? AND audience=?`).bind(principalId, contextId, audience).run();
      }
      const created = await issue();
      await changePolicy(policy => { policy.assignments = policy.assignments.filter(a => a.roleId !== 'support'); });
      assert.equal((await call('check', created.token, target())).allowed, false); assert.deepEqual(await call('stop', created.token), { ok: true });
      await changePolicy(policy => { policy.assignments.push({ principalId: owner.principalId, contextId: 'application', audience: 'admin', roleId: 'support' }); });
    });

    await check('post-read races cannot commit an impersonation with stale authority or subject versions', async () => {
      for (const mutation of ['epoch', 'source-revoked', 'source-expired', 'source-version', 'source-account-version', 'source-password-version', 'source-password-expired', 'source-membership',
        'subject-disabled', 'subject-version', 'subject-account-version', 'subject-password-version', 'subject-password-expired', 'subject-membership', 'context-disabled']) {
        await freshAdmin(); const saved = await principalState(), before = await snapshot();
        const raced = await call('withRace', [admin.token, input()], mutation);
        assert.equal(raced.injected, true, mutation); assert.equal(raced.result.ok, false, mutation); assert.equal(Object.hasOwn(raced.result, 'token'), false);
        const after = await snapshot();
        for (const id of ['impersonations', 'impersonation_permissions', 'access_audit']) assert.deepEqual(after[id], before[id], `${mutation}/${id}`);
        await restorePrincipalState(saved);
      }
      await freshAdmin();
    });

    await check('late audit errors roll back credential creation and termination, then a historical claim cannot be reused', async () => {
      const created = await issue();
      for (const [method, action, args] of [['start', 'impersonation-started', [admin.token, input()]], ['stop', 'impersonation-stopped', [created.token]]]) {
        await db.prepare(`CREATE TRIGGER qualification_impersonation_late BEFORE ${method === 'start' ? 'UPDATE' : 'INSERT'} ON ${table('access_audit')}
          WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'Synthetic late impersonation audit failure'); END`).run();
        const before = await snapshot();
        try { assert.deepEqual(await call(method, ...args), { ok: false, error: 'storage_error' }); assert.deepEqual(await snapshot(), before); }
        finally { await db.prepare('DROP TRIGGER qualification_impersonation_late').run(); }
      }
      assert.equal((await call('check', created.token, target())).allowed, true);
      const outcomes = await Promise.all([call('stop', created.token), call('stop', created.token)]);
      assert.equal(outcomes.filter(outcome => outcome.ok).length, 1); assert.equal(outcomes.filter(outcome => outcome.error === 'conflict').length, 1);
      await assertAudit('impersonation-stopped', created);
      const before = await snapshot(); assert.equal((await call('stop', created.token)).ok, false); assert.deepEqual(await snapshot(), before);
      assert.equal((await call('check', created.token, target())).allowed, false);
    });

    await check('expiry and explicit termination preserve the target session and never restore administrator powers implicitly', async () => {
      const created = await issue();
      await db.prepare(`UPDATE ${table('impersonations')} SET expires_at_ms=${NOW} WHERE id=?`).bind(created.impersonation.id).run();
      assert.equal((await call('check', created.token, target())).allowed, false); assert.deepEqual(await call('stop', created.token), { ok: true });
      assert.equal((await call('check', created.token, target())).allowed, false);
      assert.equal((await call('nativeCheck', created.token, { contextId: 'application', audience: 'admin', actors: ['user'], requiredPermissionIds: ['creezio.access:manage'], purpose: 'operation' })).allowed, false);
      assert.notEqual(await call('session', subjectSession.token, 'app'), null);
    });

    await check('concurrent issuance obeys the eight-per-source limit and the global 512 limit without orphan claims', async () => {
      await freshAdmin(); const template = await issue();
      const row = (await rows('impersonations', 'WHERE id=?', [template.impersonation.id]))[0];
      const activeWhere = `WHERE ended_at_ms IS NULL AND expires_at_ms>${NOW}`;
      const globalCount = () => count('impersonations', activeWhere);
      const sourceCount = () => count('impersonations', `${activeWhere} AND source_session_id=?`, [admin.session.id]);
      async function seed(ids, sourceSessionId, mode = 'active') {
        const records = ids.map(id => ({ ...row, id, secret_hash: `sha256:${createHash('sha256').update(id).digest('hex')}`,
          source_session_id: sourceSessionId, ended_at_ms: mode === 'ended' ? row.created_at_ms : null,
          expires_at_ms: mode === 'expired' ? row.created_at_ms : row.expires_at_ms, revocation_nonce: null }));
        const columns = Object.keys(row);
        await db.prepare(`INSERT INTO ${table('impersonations')} (${columns.map(column => `"${column}"`).join(',')})
          SELECT ${columns.map(column => `json_extract(value,'$.${column}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(records)).run();
        await db.prepare(`INSERT INTO ${table('impersonation_permissions')} (impersonation_id,permission_id)
          SELECT value,? FROM json_each(?)`).bind(READ, JSON.stringify(ids)).run();
      }
      async function remove(ids) {
        if (!ids.length) return;
        await db.batch(['impersonation_permissions', 'impersonations'].map(id => db.prepare(`DELETE FROM ${table(id)}
          WHERE ${id === 'impersonations' ? 'id' : 'impersonation_id'} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids))));
      }
      const local = Array.from({ length: 6 }, (_, index) => `synthetic-impersonation-local-${index}`);
      const history = ['synthetic-impersonation-ended', 'synthetic-impersonation-expired'];
      try {
        await seed(local, admin.session.id); await seed([history[0]], admin.session.id, 'ended'); await seed([history[1]], admin.session.id, 'expired');
        assert.equal(await sourceCount(), 7);
        const beforeAudits = await count('access_audit', "WHERE action='impersonation-started'");
        const outcomes = await Promise.all([call('start', admin.token, input()), call('start', admin.token, input())]);
        const winner = outcomes.find(result => result.ok);
        assert.equal(outcomes.filter(result => result.ok).length, 1); assert.equal(outcomes.filter(result => result.error === 'conflict').length, 1);
        assert.equal(await sourceCount(), 8); assert.equal(await count('access_audit', "WHERE action='impersonation-started'"), beforeAudits + 1);
        const before = await snapshot(); assert.deepEqual(await call('start', admin.token, input()), { ok: false, error: 'conflict' }); assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await call('stop', winner.token), { ok: true }); assert.equal(await sourceCount(), 7);
        const replacement = await issue(); assert.equal(await sourceCount(), 8); assert.deepEqual(await call('stop', replacement.token), { ok: true });
      } finally { await remove([...local, ...history]); }
      assert.deepEqual(await call('stop', template.token), { ok: true });

      const source = await call('issueSession', ownerLogin, 'admin');
      const global = Array.from({ length: 512 - await globalCount() }, (_, index) => `synthetic-impersonation-global-${index}`);
      try {
        // Synthetic setup intentionally bypasses the per-source gate to isolate the independent global limit.
        await seed(global, source.session.id); assert.equal(await globalCount(), 512); assert.equal(await sourceCount(), 0);
        let before = await snapshot(); assert.deepEqual(await call('start', admin.token, input()), { ok: false, error: 'conflict' }); assert.deepEqual(await snapshot(), before);
        await db.prepare(`UPDATE ${table('impersonations')} SET expires_at_ms=${NOW} WHERE id=?`).bind(global[0]).run();
        assert.equal(await globalCount(), 511); const replacement = await issue(); assert.equal(await globalCount(), 512);
        assert.deepEqual(await call('stop', replacement.token), { ok: true }); assert.equal(await globalCount(), 511);
      } finally { await remove(global); }
    });

    await check('bounded credentials, audit and revocation persist through workerd restart with no session fallback', async () => {
      await freshAdmin(); const live = await issue(), stopped = await issue();
      assert.deepEqual(await call('stop', stopped.token), { ok: true }); const before = await snapshot();
      await instance.dispose(); instance = undefined; db = undefined; await startWorker();
      assert.deepEqual(await snapshot(), before);
      assert.equal((await call('check', live.token, target())).allowed, true);
      assert.equal((await call('check', live.token, target('workspace-a', 'admin', []))).allowed, false);
      assert.equal((await call('check', stopped.token, target())).allowed, false);
      assert.equal(await call('session', live.token, 'app'), null);
      assert.deepEqual(await call('stop', live.token), { ok: true });
      assert.notEqual(await call('session', subjectSession.token, 'app'), null);
    });

    t.diagnostic('Real local D1 and Worker impersonation services only. No HTTP/cookie/UI, hosted Site, business mutation or user data is qualified here.');
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
  }
});
