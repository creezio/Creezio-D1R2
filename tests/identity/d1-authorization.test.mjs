import test from 'node:test';
import assert from 'node:assert/strict';
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
const loginIdentifier = 'acl-owner@example.invalid';
const password = 'Synthetic authorization qualification only';
const target = (contextId, permissionId, audience = 'app') => ({ contextId, audience,
  actors: ['user'], requiredPermissionIds: [permissionId], purpose: 'operation' });
const addRole = (policy, id) => ({ ...structuredClone(policy),
  roles: [...structuredClone(policy.roles), { id, inherits: [], permissionIds: [], permissionOverrides: [] }] });

test('persistent authorization in real D1 enforces roles, fresh claims and atomic policy changes', { timeout: 60000 }, async t => {
  const schema = generateD1Schema('creezio.access', models);
  const table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/authorization/service.ts', 'core/authorization/d1-store.ts'] });
  const bundled = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-authorization-worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, []);
  // Identity files run serially in the official aggregate; this owned state is cleaned after each file.
  const state = createIdentityQualificationState(root);
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', d1Databases: { DB: 'creezio-t04-authorization-synthetic' }, d1Persist: join(state.directory, 'd1') };
  let instance, db, owner, admin, app, failed = false;
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External authorization qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function start() {
    instance = new Miniflare(options); await bounded(() => instance.ready, 5000); db = await instance.getD1Database('DB');
  }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await instance.dispatchFetch('http://internal-authorization-qualification/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(result.error?.message ?? `Qualification response ${response.status}`);
      return result.value;
    });
  }
  async function check(name, operation) {
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Authorization qualification stopped after: ${name}`);
  }
  const aclAudits = async () => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table('access_audit')} WHERE action='authorization-updated'`).first()).count;
  async function read(token = admin.token) {
    const result = await call('readPolicy', token); assert.equal(result.ok, true); return result;
  }
  async function replace(policy, token = admin.token) {
    const before = await read(token);
    const result = await call('replacePolicy', token, { expectedEpoch: before.epoch, policy });
    assert.deepEqual(result, { ok: true, epoch: before.epoch + 1 }); return read(token);
  }
  try {
    await start(); await db.batch(schema.statements.map(statement => db.prepare(statement)));
    owner = await call('bootstrap', { loginIdentifier, displayName: 'Synthetic ACL owner', password });
    assert.equal(owner.ok, true);
    admin = await call('login', { loginIdentifier, password, audience: 'admin' }); assert.equal(admin.ok, true);
    app = await call('login', { loginIdentifier, password, audience: 'app' }); assert.equal(app.ok, true);

    await check('bootstrap seeds explicit administrative grants and one read batch returns a bounded safe snapshot', async () => {
      const stored = await call('readStore', admin.token, 'admin');
      assert.equal(stored.batches, 1); assert.equal(stored.snapshot.session.principalId, owner.principalId);
      assert.ok(Number.isSafeInteger(stored.snapshot.epoch) && stored.snapshot.epoch > 0);
      assert.ok(Math.abs(Date.now() - stored.snapshot.nowMs) < 3000);
      assert.deepEqual(Object.keys(stored.snapshot).sort(), ['epoch', 'nowMs', 'policy', 'principals', 'session']);
      assert.equal(JSON.stringify(stored.snapshot).includes('$argon2'), false);
      assert.equal(JSON.stringify(stored.snapshot).includes(admin.token), false);
      const initial = await read();
      assert.deepEqual(initial.policy.contexts, [{ id: 'application', status: 'active' }]);
      assert.ok(initial.policy.roles.some(role => role.id === 'administrator' && role.permissionIds.includes('creezio.access:manage')));
      assert.ok(initial.policy.memberships.some(member => member.principalId === owner.principalId
        && member.contextId === 'application' && member.audience === 'admin' && member.status === 'active'));
      assert.equal((await call('check', admin.token, target('application', 'creezio.access:manage', 'admin'))).allowed, true);
      assert.equal((await call('check', app.token, target('application', 'creezio.access:manage', 'admin'))).allowed, false);
      assert.equal((await call('readPolicy', app.token)).ok, false);
    });

    await check('persisted role inheritance, role denial and account override preserve context and session audience', async () => {
      const next = (await read()).policy;
      next.contexts.push({ id: 'workspace-a', status: 'active' }, { id: 'workspace-b', status: 'active' });
      next.roles.push(
        { id: 'reader', inherits: [], permissionIds: ['example.notes:read'], permissionOverrides: [] },
        { id: 'editor', inherits: ['reader'], permissionIds: ['example.notes:write'], permissionOverrides: [] },
        { id: 'restricted', inherits: ['editor'], permissionIds: [], permissionOverrides: [{ permissionId: 'example.notes:read', effect: 'deny' }] },
      );
      for (const contextId of ['workspace-a', 'workspace-b']) next.memberships.push({ principalId: owner.principalId, contextId, audience: 'app', status: 'active' });
      next.assignments.push({ principalId: owner.principalId, contextId: 'workspace-a', audience: 'app', roleId: 'restricted' });
      next.overrides.push({ principalId: owner.principalId, contextId: 'workspace-a', audience: 'app', permissionId: 'example.notes:read', effect: 'allow' });
      await replace(next);
      assert.equal((await call('check', app.token, target('workspace-a', 'example.notes:read'))).allowed, true);
      assert.equal((await call('check', app.token, target('workspace-a', 'example.notes:write'))).allowed, true);
      assert.equal((await call('check', app.token, target('workspace-b', 'example.notes:read'))).allowed, false);
      assert.equal((await call('check', admin.token, target('workspace-a', 'example.notes:read'))).allowed, false);
      next.overrides[0].effect = 'deny'; await replace(next);
      assert.equal((await call('check', app.token, target('workspace-a', 'example.notes:read'))).allowed, false);
      next.overrides = []; await replace(next);
      assert.equal((await call('check', app.token, target('workspace-a', 'example.notes:read'))).allowed, false);
      next.roles.find(role => role.id === 'restricted').permissionOverrides[0].effect = 'allow'; await replace(next);
      assert.equal((await call('check', app.token, target('workspace-a', 'example.notes:read'))).allowed, true);
    });

    await check('invalid references, removed contexts, cycles and self-lockout refuse the policy without persistent effects', async () => {
      const before = await read(), audits = await aclAudits();
      const removedContext = structuredClone(before.policy);
      removedContext.contexts = removedContext.contexts.filter(item => item.id !== 'workspace-b');
      removedContext.memberships = removedContext.memberships.filter(item => item.contextId !== 'workspace-b');
      removedContext.assignments = removedContext.assignments.filter(item => item.contextId !== 'workspace-b');
      removedContext.overrides = removedContext.overrides.filter(item => item.contextId !== 'workspace-b');
      const unknownPrincipal = structuredClone(before.policy);
      unknownPrincipal.memberships.push({ principalId: 'missing-principal', contextId: 'workspace-b', audience: 'app', status: 'active' });
      const unknownPermission = structuredClone(before.policy);
      unknownPermission.roles.find(role => role.id === 'reader').permissionIds.push('example.notes:unknown');
      for (const [label, policy] of [['existing context removed', removedContext], ['unknown principal', unknownPrincipal], ['unknown permission', unknownPermission]]) {
        assert.deepEqual(await call('replacePolicy', admin.token, { expectedEpoch: before.epoch, policy }), { ok: false, error: 'invalid_input' }, label);
        assert.deepEqual(await read(), before, label); assert.equal(await aclAudits(), audits, label);
      }
      const cycle = structuredClone(before.policy);
      cycle.roles.find(role => role.id === 'reader').inherits = ['restricted'];
      assert.equal((await call('replacePolicy', admin.token, { expectedEpoch: before.epoch, policy: cycle })).ok, false);
      const lockout = structuredClone(before.policy);
      lockout.assignments = lockout.assignments.filter(item => item.roleId !== 'administrator');
      assert.equal((await call('replacePolicy', admin.token, { expectedEpoch: before.epoch, policy: lockout })).ok, false);
      assert.deepEqual(await read(), before); assert.equal(await aclAudits(), audits);
    });

    await check('removing the explicit administrator assignment disables authority despite the installation marker', async () => {
      await db.prepare(`DELETE FROM ${table('role_assignments')} WHERE principal_id=? AND context_id='application' AND audience='admin' AND role_id='administrator'`).bind(owner.principalId).run();
      assert.deepEqual(await call('readPolicy', admin.token), { ok: false, error: 'forbidden' });
      assert.equal((await call('check', admin.token, target('application', 'creezio.access:manage', 'admin'))).allowed, false);
      await db.prepare(`INSERT INTO ${table('role_assignments')} (principal_id,context_id,audience,role_id) VALUES (?,'application','admin','administrator')`).bind(owner.principalId).run();
      assert.equal((await read()).ok, true);
    });

    await check('a concurrent read observes one complete policy epoch, never mixed before/after grants', async () => {
      const before = await read(), next = addRole(before.policy, 'coherent-read');
      const [observed, changed] = await Promise.all([
        call('readStore', admin.token, 'admin'),
        call('replacePolicy', admin.token, { expectedEpoch: before.epoch, policy: next }),
      ]);
      assert.deepEqual(changed, { ok: true, epoch: before.epoch + 1 });
      assert.equal(observed.batches, 1);
      assert.ok([before.epoch, before.epoch + 1].includes(observed.snapshot.epoch));
      assert.equal(observed.snapshot.policy.roles.some(role => role.id === 'coherent-read'), observed.snapshot.epoch === before.epoch + 1);
      const after = await read();
      assert.deepEqual(observed.snapshot.policy, observed.snapshot.epoch === before.epoch ? before.policy : after.policy);
    });

    await check('more than 128 persisted roles fails closed instead of authorizing a truncated policy', async () => {
      const before = await read(), audits = await aclAudits();
      const ids = Array.from({ length: 129 }, (_, index) => `overflow-${index}`);
      await db.prepare(`INSERT INTO ${table('roles')} (id) SELECT value FROM json_each(?)`).bind(JSON.stringify(ids)).run();
      try {
        assert.deepEqual(await call('readPolicy', admin.token), { ok: false, error: 'storage_error' });
        assert.equal((await call('check', admin.token, target('application', 'creezio.access:manage', 'admin'))).allowed, false);
        assert.equal(await aclAudits(), audits);
      } finally {
        await db.prepare(`DELETE FROM ${table('roles')} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).run();
      }
      assert.deepEqual(await read(), before);
    });

    await check('concurrent replacements have one winner and a stale internal claim cannot reuse an old audit receipt', async () => {
      const before = await read(), audits = await aclAudits();
      const candidates = ['winner-a', 'winner-b'].map(id => addRole(before.policy, id));
      const results = await Promise.all(candidates.map(policy => call('replacePolicy', admin.token, { expectedEpoch: before.epoch, policy })));
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal(results.filter(result => result.error === 'conflict').length, 1);
      const winner = results.findIndex(result => result.ok), after = await read();
      assert.equal(after.epoch, before.epoch + 1);
      assert.ok(after.policy.roles.some(role => role.id === `winner-${winner === 0 ? 'a' : 'b'}`));
      assert.equal(after.policy.roles.some(role => role.id === `winner-${winner === 0 ? 'b' : 'a'}`), false);
      assert.equal(await aclAudits(), audits + 1);
      assert.equal(await call('commitStore', admin.token, { epoch: before.epoch,
        beforePolicy: after.policy, policy: addRole(after.policy, 'stale-replay') }), false);
      assert.deepEqual(await read(), after); assert.equal(await aclAudits(), audits + 1);
    });

    await check('a late graph insertion constraint rolls back the acquired audit claim, deletions and epoch together', async () => {
      const before = await read(), audits = await aclAudits();
      await db.prepare(`CREATE TRIGGER qualification_acl_late_failure BEFORE INSERT ON ${table('roles')}
        WHEN NEW.id='reject-qualification' BEGIN SELECT RAISE(ABORT,'synthetic_acl_late_failure'); END`).run();
      const input = { expectedEpoch: before.epoch, policy: addRole(before.policy, 'reject-qualification') };
      assert.deepEqual(await call('replacePolicy', admin.token, input), { ok: false, error: 'storage_error' });
      assert.deepEqual(await read(), before); assert.equal(await aclAudits(), audits);
      await db.prepare('DROP TRIGGER qualification_acl_late_failure').run();
      assert.deepEqual(await call('replacePolicy', admin.token, input), { ok: true, epoch: before.epoch + 1 });
      assert.equal(await aclAudits(), audits + 1);
    });

    await check('revocation and state changes after the server read prevent policy writes and audit acquisition', async () => {
      for (const mutation of ['epoch', 'revoked', 'session-expired', 'principal', 'principal-version',
        'account', 'account-version', 'credential', 'credential-expired', 'context', 'membership']) {
        admin = await call('issueSession', loginIdentifier, 'admin');
        const before = await read(), audits = await aclAudits();
        const candidate = addRole(before.policy, `race-${mutation}`);
        const raced = await call('replaceWithRace', admin.token, { expectedEpoch: before.epoch, policy: candidate }, mutation);
        assert.equal(raced.injected, true, mutation); assert.ok(raced.batches >= 2, mutation);
        assert.equal(raced.result.ok, false, mutation); assert.equal(await aclAudits(), audits, mutation);
        assert.equal(await db.prepare(`SELECT id FROM ${table('roles')} WHERE id=?`).bind(`race-${mutation}`).first(), null, mutation);
        assert.equal((await db.prepare(`SELECT epoch FROM ${table('authorization_state')} WHERE id='application'`).first()).epoch,
          before.epoch + (mutation === 'epoch' ? 1 : 0), mutation);
        if (mutation === 'principal') await db.prepare(`UPDATE ${table('principals')} SET status='active' WHERE id=?`).bind(owner.principalId).run();
        if (mutation === 'account') await db.prepare(`UPDATE ${table('human_accounts')} SET status='active' WHERE principal_id=?`).bind(owner.principalId).run();
        if (mutation === 'credential-expired') await db.prepare(`UPDATE ${table('password_credentials')} SET expires_at_ms=NULL WHERE principal_id=?`).bind(owner.principalId).run();
        if (mutation === 'context') await db.prepare(`UPDATE ${table('contexts')} SET status='active' WHERE id='application'`).run();
        if (mutation === 'membership') await db.prepare(`UPDATE ${table('memberships')} SET status='active' WHERE principal_id=? AND context_id='application' AND audience='admin'`).bind(owner.principalId).run();
      }
    });

    await check('policy and authority survive workerd restart while prior revoked sessions stay unusable', async () => {
      const revokedToken = admin.token;
      // The last race disabled membership; permanently revoke this fixture's prior session as well.
      await db.prepare(`UPDATE ${table('sessions')} SET revoked_at_ms=0 WHERE id=?`).bind(admin.session.id).run();
      admin = await call('issueSession', loginIdentifier, 'admin');
      app = await call('issueSession', loginIdentifier, 'app');
      const before = await read(), audits = await aclAudits();
      await instance.dispose(); instance = undefined; db = undefined; await start();
      assert.deepEqual(await read(), before); assert.equal(await aclAudits(), audits);
      assert.equal((await call('readPolicy', revokedToken)).ok, false);
      assert.equal((await call('check', app.token, target('workspace-a', 'example.notes:write'))).allowed, true);
    });
    t.diagnostic('Real local D1 and Worker authorization only: no public transport, cached authority, scheduler, external token/OAuth or hosted Sites claim.');
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
  }
});
