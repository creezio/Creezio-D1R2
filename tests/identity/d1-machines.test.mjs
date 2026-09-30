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
const loginIdentifier = 'machines-owner@example.invalid', password = 'Synthetic machines qualification password';
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const scopes = [{ contextId: 'workspace-a', audience: 'app', permissionIds: ['example.jobs:read'] },
  { contextId: 'workspace-b', audience: 'admin', permissionIds: ['example.jobs:write'] }];
const target = (contextId = 'workspace-a', audience = 'app', permissionIds = ['example.jobs:read'], purpose = 'operation') =>
  ({ contextId, audience, actors: ['machine'], requiredPermissionIds: permissionIds, purpose });
const digest = token => `sha256:${createHash('sha256').update(`creezio:credential:v1:api-token:${token}`).digest('hex')}`;

test('machine credentials intersect exact scopes with fresh D1 rights and rotate atomically', { timeout: 90000 }, async t => {
  const schema = generateD1Schema('creezio.access', models), table = id => `"${schema.tables[id]}"`;
  await assertWorkerBoundary({ root, entryPoints: ['core/identity/machines.ts'] });
  const bundled = await build({ absWorkingDir: root, entryPoints: ['tests/identity/harness/d1-machines-worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, []);
  const state = createIdentityQualificationState(root);
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', d1Databases: { DB: 'creezio-t04-machines-synthetic' }, d1Persist: join(state.directory, 'd1') };
  let instance, db, owner, admin, service, issued, persistentToken, failed = false;
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`External machines qualification deadline (${milliseconds} ms).`)), milliseconds);
    })]); } finally { clearTimeout(timer); }
  }
  async function start() { instance = new Miniflare(options); await bounded(() => instance.ready, 5000); db = await instance.getD1Database('DB'); }
  async function call(method, ...args) {
    return bounded(async () => {
      const response = await instance.dispatchFetch('http://internal-machines-qualification/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }),
      });
      const result = await response.json();
      if (response.status !== 200) throw new Error(result.error?.message ?? `Qualification response ${response.status}`);
      return result.value;
    });
  }
  async function check(name, operation) {
    // Give synthetic scenarios independent admission windows; never change the product's limits or clock.
    await db.prepare(`UPDATE ${table('auth_throttles')} SET expires_at_ms=0`).run();
    await t.test(name, async () => { try { await operation(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Machines qualification stopped after: ${name}`);
  }
  const rows = async (id, where = '', values = []) => (await db.prepare(`SELECT * FROM ${table(id)} ${where}`).bind(...values).all()).results;
  const count = async (id, where = '', values = []) => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table(id)} ${where}`).bind(...values).first()).count;
  const epoch = async () => (await db.prepare(`SELECT epoch FROM ${table('authorization_state')} WHERE id='application'`).first()).epoch;
  const principal = async id => (await rows('principals', 'WHERE id=?', [id]))[0];
  const credential = async id => (await rows('api_credentials', 'WHERE id=?', [id]))[0];
  async function snapshot() {
    const value = {};
    for (const id of Object.keys(schema.tables).filter(id => id !== 'auth_throttles').sort())
      value[id] = (await rows(id)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return value;
  }
  async function freshAdmin() { admin = await call('issueSession', loginIdentifier); }
  const issueInput = (principalId = service.id, label = 'Synthetic machine', requestedScopes = scopes) =>
    ({ principalId, label, ttlMs: 60000, scopes: structuredClone(requestedScopes) });
  async function issue(principalId = service.id, label) {
    const result = await call('issueToken', admin.token, issueInput(principalId, label));
    assert.equal(result.ok, true, JSON.stringify(result)); return result;
  }
  async function policyChange(change) {
    const before = await call('readPolicy', admin.token); assert.equal(before.ok, true);
    const policy = structuredClone(before.policy); change(policy);
    assert.deepEqual(await call('replacePolicy', admin.token, { expectedEpoch: before.epoch, policy }), { ok: true, epoch: before.epoch + 1 });
  }
  async function grantSubject(principalId) {
    await policyChange(policy => {
      for (const id of ['workspace-a', 'workspace-b', 'outside']) if (!policy.contexts.some(context => context.id === id)) policy.contexts.push({ id, status: 'active' });
      if (!policy.roles.some(role => role.id === 'jobs-all')) policy.roles.push({ id: 'jobs-all', inherits: [],
        permissionIds: ['example.jobs:read', 'example.jobs:write', 'example.jobs:human'], permissionOverrides: [] });
      // Deliberately broader than token scopes: ACLs cannot accidentally mask a credential cross-product bug.
      for (const contextId of ['workspace-a', 'workspace-b', 'outside']) for (const audience of ['admin', 'app']) {
        policy.memberships.push({ principalId, contextId, audience, status: 'active' });
        policy.assignments.push({ principalId, contextId, audience, roleId: 'jobs-all' });
      }
    });
  }
  async function assertTokenAudit(action, item) {
    const matches = await rows('access_audit', 'WHERE action=? AND target_credential_id=?', [action, item.credential.id]);
    assert.equal(matches.length, 1); assert.equal(matches[0].target_principal_id, item.credential.principalId);
    assert.equal(matches[0].credential_id,null,'a browser session has no OAuth actor credential');
    assert.equal(JSON.stringify(matches).includes(item.token), false); assert.equal(JSON.stringify(matches).includes(digest(item.token)), false);
  }
  try {
    await start(); await db.batch(schema.statements.map(sql => db.prepare(sql)));
    owner = await call('bootstrap', { loginIdentifier, displayName: 'Synthetic machine administrator', password }); assert.equal(owner.ok, true);
    admin = await call('login', { loginIdentifier, password, audience: 'admin' }); assert.equal(admin.ok, true);

    await check('a service principal has no human account, password, session or implicit ACL assignment', async () => {
      const before = await snapshot();
      assert.equal((await call('createService', 'malformed', { displayName: 'Unauthorized' })).error, 'unauthorized');
      assert.deepEqual(await snapshot(), before);
      const result = await call('createService', admin.token, { displayName: 'Synthetic job runner' }); assert.equal(result.ok, true);
      service = result.principal;
      assert.deepEqual(Object.keys(service).sort(), ['authVersion', 'displayName', 'id', 'status']);
      assert.equal(service.status, 'active'); assert.equal(service.authVersion, 1); assert.equal((await principal(service.id)).kind, 'service');
      for (const id of ['human_accounts', 'password_credentials', 'sessions', 'memberships', 'role_assignments', 'principal_overrides'])
        assert.equal(await count(id, 'WHERE principal_id=?', [service.id]), 0, id);
      assert.equal(await count('api_credentials', 'WHERE principal_id=?', [service.id]), 0);
      await policyChange(policy => { for (const id of ['workspace-a', 'workspace-b', 'outside']) policy.contexts.push({ id, status: 'active' }); });
      const noRights = await call('issueToken', admin.token, issueInput()); assert.equal(noRights.ok, true);
      assert.equal((await call('check', noRights.token, target())).allowed, false);
      assert.equal(await count('memberships', 'WHERE principal_id=?', [service.id]), 0);
      await grantSubject(service.id);
    });

    await check('scopes remain exact context/audience/permission tuples, including authenticated-only operations', async () => {
      issued = await issue(); assert.match(issued.token, /^cz1a_/);
      assert.deepEqual(issued.credential.scopes, scopes);
      assert.deepEqual(Object.keys(issued.credential).sort(), ['createdAtMs', 'expiresAtMs', 'id', 'label', 'principalId', 'scopes']);
      assert.equal((await credential(issued.credential.id)).secret_hash, digest(issued.token));
      assert.equal(await call('session', issued.token, 'app'), null);
      assert.equal((await call('check', admin.token, target())).allowed, false);
      assert.equal((await call('check', issued.token, target())).allowed, true);
      assert.equal((await call('check', issued.token, target('workspace-b', 'admin', ['example.jobs:write']))).allowed, true);
      for (const denied of [target('workspace-a', 'admin'), target('workspace-b', 'app', ['example.jobs:write']),
        target('workspace-a', 'app', ['example.jobs:write']), target('workspace-b', 'admin'),
        target('outside', 'app'), target('workspace-a', 'app', ['example.jobs:read', 'example.jobs:write']),
        target('workspace-a', 'admin', []), target('outside', 'app', []), target('workspace-b', 'app', [])])
        assert.equal((await call('check', issued.token, denied)).allowed, false, JSON.stringify(denied));
      assert.equal((await call('check', issued.token, target('workspace-a', 'app', [], 'human-approval'))).allowed, false);
      assert.equal((await call('check', issued.token, target('application', 'admin', ['creezio.access:manage']))).allowed, false);
      for (const denied of [target('workspace-a', 'app', ['example.jobs:write']), target('workspace-a', 'admin')]) {
        const mutable = await call('checkMutableTarget', issued.token, denied);
        assert.equal(mutable.mutated, true); assert.equal(mutable.decision.allowed, false);
      }
      await assertTokenAudit('api-token-issued', issued);
    });

    await check('unknown, human-only, privileged and excessive scopes are rejected without storing tokens or audit claims', async () => {
      const variants = [
        [{ contextId: 'application', audience: 'admin', permissionIds: ['creezio.access:manage'] }],
        [{ contextId: 'workspace-a', audience: 'app', permissionIds: ['example.jobs:human'] }],
        [{ contextId: 'workspace-a', audience: 'app', permissionIds: ['example.jobs:unknown'] }],
        [{ contextId: 'workspace-a', audience: 'app', permissionIds: ['example.jobs:*'] }],
        [...scopes, scopes[0]],
        Array.from({ length: 65 }, (_, index) => ({ contextId: `scope-${index}`, audience: 'app', permissionIds: ['example.jobs:read'] })),
        [{ contextId: 'workspace-a', audience: 'app', permissionIds: Array.from({ length: 257 }, (_, index) => `example.jobs:p${index}`) }],
      ];
      const before = await snapshot();
      for (const variant of variants) assert.equal((await call('issueToken', admin.token, issueInput(service.id, 'Rejected scope', variant))).ok, false);
      for (const ttlMs of [0, 365 * 86400000 + 1]) assert.equal((await call('issueToken', admin.token, { ...issueInput(), ttlMs })).ok, false);
      assert.deepEqual(await snapshot(), before);
      const result = await call('issueMutableInput', admin.token, issueInput(service.id, 'Captured input'));
      assert.equal(result.mutated, true); assert.equal(result.result.ok, true); assert.equal(result.result.credential.label, 'Captured input');
      assert.deepEqual(result.result.credential.scopes, scopes);
    });

    await check('one coherent D1 batch resolves credentials and fresh rights; overrides, memberships and contexts immediately restrict access', async () => {
      const measured = await call('checkMeasured', issued.token, target());
      assert.equal(measured.batches, 1); assert.equal(measured.decision.allowed, true);
      const before = await call('readPolicy', admin.token);
      const [observed] = await Promise.all([call('readMachine', issued.token, 'workspace-a', 'app'),
        policyChange(policy => policy.overrides.push({ principalId: service.id, contextId: 'workspace-a', audience: 'app', permissionId: 'example.jobs:read', effect: 'deny' }))]);
      const after = await call('readPolicy', admin.token);
      assert.equal(observed.batches, 1); assert.ok([before.epoch, after.epoch].includes(observed.snapshot.epoch));
      assert.deepEqual(observed.snapshot.policy, observed.snapshot.epoch === before.epoch ? before.policy : after.policy);
      assert.deepEqual(observed.snapshot.credential.scope, scopes[0]);
      assert.equal(JSON.stringify(observed.snapshot).includes(issued.token), false);
      assert.equal(JSON.stringify(observed.snapshot).includes(digest(issued.token)), false);
      assert.equal(JSON.stringify(observed.snapshot).includes('$argon2'), false);
      const unmatched = await call('readMachine', issued.token, 'workspace-a', 'admin');
      assert.equal(unmatched.snapshot.credential.scope, null);
      assert.equal((await call('check', issued.token, target())).allowed, false);
      await policyChange(policy => { policy.overrides = policy.overrides.filter(override => override.principalId !== service.id); });
      assert.equal((await call('check', issued.token, target())).allowed, true);
      await policyChange(policy => { policy.memberships.find(member => member.principalId === service.id && member.contextId === 'workspace-a' && member.audience === 'app').status = 'disabled'; });
      assert.equal((await call('check', issued.token, target())).allowed, false);
      await policyChange(policy => { policy.memberships.find(member => member.principalId === service.id && member.contextId === 'workspace-a' && member.audience === 'app').status = 'active'; });
      await policyChange(policy => { policy.contexts.find(context => context.id === 'workspace-a').status = 'disabled'; });
      assert.equal((await call('check', issued.token, target())).allowed, false);
      await policyChange(policy => { policy.contexts.find(context => context.id === 'workspace-a').status = 'active'; });
      assert.equal((await call('check', issued.token, target())).allowed, true);
    });

    await check('concurrent rotation has exactly one successor, preserves scopes and irreversibly revokes the old token', async () => {
      const results = await Promise.all([1, 2].map(() => call('rotateToken', admin.token, { credentialId: issued.credential.id, ttlMs: 60000 })));
      assert.equal(results.filter(result => result.ok).length, 1); assert.equal(results.filter(result => result.error === 'conflict').length, 1);
      const successor = results.find(result => result.ok);
      assert.deepEqual(successor.credential.scopes, scopes); assert.equal(successor.credential.label, issued.credential.label);
      assert.equal((await call('check', issued.token, target())).allowed, false);
      assert.equal((await call('check', successor.token, target())).allowed, true);
      const before = await snapshot();
      assert.equal((await call('rotateToken', admin.token, { credentialId: issued.credential.id, ttlMs: 60000 })).ok, false);
      assert.deepEqual(await snapshot(), before); await assertTokenAudit('api-token-rotated', successor);
      issued = successor;
    });

    await check('a late rotation audit error restores the old credential and removes successor and scope effects', async () => {
      const before = await snapshot();
      await db.prepare(`CREATE TRIGGER qualification_machine_rotation_failure BEFORE UPDATE ON ${table('access_audit')}
        WHEN NEW.action='api-token-rotated' BEGIN SELECT RAISE(ABORT,'synthetic_machine_rotation_failure'); END`).run();
      assert.deepEqual(await call('rotateToken', admin.token, { credentialId: issued.credential.id, ttlMs: 60000 }), { ok: false, error: 'storage_error' });
      assert.deepEqual(await snapshot(), before); assert.equal((await call('check', issued.token, target())).allowed, true);
      await db.prepare('DROP TRIGGER qualification_machine_rotation_failure').run();
      const next = await call('rotateToken', admin.token, { credentialId: issued.credential.id, ttlMs: 60000 }); assert.equal(next.ok, true);
      assert.equal((await call('check', issued.token, target())).allowed, false); issued = next;
    });

    await check('service status is versioned and reactivation never resurrects any prior token', async () => {
      const initial = await principal(service.id), second = await issue();
      const input = { principalId: service.id, expectedAuthVersion: initial.auth_version, status: 'disabled' };
      const results = await Promise.all([1, 2].map(() => call('setServiceStatus', admin.token, input)));
      assert.equal(results.filter(result => result.ok).length, 1); assert.equal(results.filter(result => result.error === 'conflict').length, 1);
      assert.equal((await principal(service.id)).auth_version, initial.auth_version + 1);
      for (const token of [issued.token, second.token]) assert.equal((await call('check', token, target())).allowed, false);
      assert.equal((await call('issueToken', admin.token, issueInput())).ok, false);
      const enabled = await call('setServiceStatus', admin.token, { principalId: service.id, expectedAuthVersion: initial.auth_version + 1, status: 'active' });
      assert.equal(enabled.ok, true); assert.equal(enabled.principal.authVersion, initial.auth_version + 2);
      for (const token of [issued.token, second.token]) assert.equal((await call('check', token, target())).allowed, false);
      issued = await issue(); assert.equal((await call('check', issued.token, target())).allowed, true);
    });

    await check('all administrative mutations recheck session and epoch at their real D1 commit', async () => {
      for (const method of ['createService', 'issueToken', 'rotateToken', 'revokeToken', 'setServiceStatus']) {
        for (const mutation of ['epoch', 'issuer-revoked']) {
          await freshAdmin();
          const current = await principal(service.id);
          const token = ['rotateToken', 'revokeToken'].includes(method) ? await issue() : null;
          const input = method === 'createService' ? { displayName: 'Rejected concurrent service' }
            : method === 'issueToken' ? issueInput()
              : method === 'setServiceStatus' ? { principalId: service.id, expectedAuthVersion: current.auth_version, status: 'disabled' }
                : { credentialId: token.credential.id, ...(method === 'rotateToken' ? { ttlMs: 60000 } : {}) };
          const before = await snapshot(), beforeEpoch = await epoch();
          const raced = await call('withRace', method, [admin.token, input], mutation);
          assert.equal(raced.injected, true, `${method}/${mutation}`); assert.equal(raced.result.ok, false, `${method}/${mutation}`);
          const after = await snapshot();
          assert.deepEqual(after.access_audit, before.access_audit); assert.deepEqual(after.principals, before.principals);
          assert.deepEqual(after.api_credentials, before.api_credentials); assert.deepEqual(after.api_credential_scopes, before.api_credential_scopes);
          assert.equal(await epoch(), beforeEpoch + (mutation === 'epoch' ? 1 : 0));
        }
      }
      await freshAdmin();
    });

    await check('target disable, token revoke and expiry after a read cannot leave a rotated or newly issued credential', async () => {
      const created = await call('createService', admin.token, { displayName: 'Synthetic raced service' }); assert.equal(created.ok, true);
      const subjectId = created.principal.id; await grantSubject(subjectId);
      for (const [method, mutation] of [['issueToken', 'subject-disabled'], ['rotateToken', 'subject-disabled'],
        ['rotateToken', 'credential-revoked'], ['rotateToken', 'credential-expired']]) {
        const old = method === 'rotateToken' ? await issue(subjectId) : null;
        const input = old ? { credentialId: old.credential.id, ttlMs: 60000 } : issueInput(subjectId);
        const before = await snapshot(), beforeEpoch = await epoch();
        const raced = await call('withRace', method, [admin.token, input], mutation, { principalId: subjectId, credentialId: old?.credential.id });
        assert.equal(raced.injected, true); assert.equal(raced.result.ok, false); assert.equal(Object.hasOwn(raced.result, 'token'), false);
        const after = await snapshot(); assert.deepEqual(after.access_audit, before.access_audit);
        assert.equal(after.api_credentials.length, before.api_credentials.length);
        assert.deepEqual(after.api_credential_scopes, before.api_credential_scopes); assert.equal(await epoch(), beforeEpoch);
        if (mutation === 'subject-disabled') {
          const current = await principal(subjectId);
          assert.equal((await call('setServiceStatus', admin.token, { principalId: subjectId, expectedAuthVersion: current.auth_version, status: 'active' })).ok, true);
        }
      }
    });

    await check('revocation and database-time expiry take effect immediately without a browser session', async () => {
      const token = await issue();
      assert.deepEqual(await call('revokeToken', admin.token, { credentialId: token.credential.id }), { ok: true });
      assert.equal((await call('check', token.token, target())).allowed, false);
      await assertTokenAudit('api-token-revoked', token);
      const before = await snapshot();
      assert.equal((await call('revokeToken', admin.token, { credentialId: token.credential.id })).ok, false);
      assert.deepEqual(await snapshot(), before);
      const expired = await issue();
      await db.prepare(`UPDATE ${table('api_credentials')} SET expires_at_ms=${NOW} WHERE id=?`).bind(expired.credential.id).run();
      assert.equal((await call('check', expired.token, target())).allowed, false);
    });

    await check('active quotas exclude invalid history and rotation replaces one token even at the 32 and 1024 limits', async () => {
      const current = await principal(service.id), template = await issue();
      async function seedCredentials(ids, subjectId, version, mode = 'active') {
        const records = ids.map(id => ({ id, hash: `sha256:${createHash('sha256').update(id).digest('hex')}` }));
        await db.prepare(`INSERT INTO ${table('api_credentials')}
          (id,secret_hash,principal_id,auth_version,label,created_at_ms,expires_at_ms,revoked_at_ms,revocation_nonce)
          SELECT json_extract(value,'$.id'),json_extract(value,'$.hash'),?,?,'Synthetic quota token',${NOW},
            ${mode === 'expired' ? NOW : `${NOW}+60000`},${mode === 'revoked' ? NOW : 'NULL'},NULL FROM json_each(?)`)
          .bind(subjectId, version, JSON.stringify(records)).run();
        await db.prepare(`INSERT INTO ${table('api_credential_scopes')} (credential_id,context_id,audience,permission_id)
          SELECT j.value,s.context_id,s.audience,s.permission_id FROM json_each(?) j
          CROSS JOIN ${table('api_credential_scopes')} s WHERE s.credential_id=?`).bind(JSON.stringify(ids), template.credential.id).run();
      }
      async function removeCredentials(ids) {
        await db.batch(['api_credential_scopes', 'api_credentials'].map(id => db.prepare(`DELETE FROM ${table(id)}
          WHERE ${id === 'api_credentials' ? 'id' : 'credential_id'} IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids))));
      }
      const activeWhere = `WHERE principal_id=? AND auth_version=? AND revoked_at_ms IS NULL AND expires_at_ms>${NOW}`;
      const activeCount = () => count('api_credentials', activeWhere, [service.id, current.auth_version]);
      const globalCount = async () => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table('api_credentials')} c
        JOIN ${table('principals')} p ON p.id=c.principal_id WHERE p.kind='service' AND p.status='active'
          AND c.auth_version=p.auth_version AND c.revoked_at_ms IS NULL AND c.expires_at_ms>${NOW}`).first()).count;
      const history = ['expired', 'revoked', 'version'].flatMap(mode => Array.from({ length: 12 }, (_, index) => `synthetic-history-${mode}-${index}`));
      const local = Array.from({ length: 32 - await activeCount() }, (_, index) => `synthetic-local-quota-${index}`);
      try {
        for (const mode of ['expired', 'revoked', 'version']) await seedCredentials(history.filter(id => id.includes(`-${mode}-`)), service.id,
          mode === 'version' ? current.auth_version - 1 : current.auth_version, mode);
        await seedCredentials(local, service.id, current.auth_version);
        assert.equal(await activeCount(), 32); assert.ok(await count('api_credentials', 'WHERE principal_id=?', [service.id]) > 32);
        let before = await snapshot();
        assert.deepEqual(await call('issueToken', admin.token, issueInput()), { ok: false, error: 'conflict' });
        assert.deepEqual(await snapshot(), before);
        const rotated = await call('rotateToken', admin.token, { credentialId: template.credential.id, ttlMs: 60000 });
        assert.equal(rotated.ok, true); assert.equal(await activeCount(), 32);
        assert.equal((await call('check', template.token, target())).allowed, false); assert.equal((await call('check', rotated.token, target())).allowed, true);
        assert.deepEqual(await call('revokeToken', admin.token, { credentialId: local[0] }), { ok: true });
        assert.equal(await activeCount(), 31); assert.equal((await issue()).ok, true); assert.equal(await activeCount(), 32);
      } finally { await removeCredentials([...history, ...local]); }

      const bulk = await call('createService', admin.token, { displayName: 'Synthetic global quota principal' }); assert.equal(bulk.ok, true);
      // SQL setup bypasses per-subject issuance only to isolate the global gate for the normally authorized subject.
      const global = Array.from({ length: 1024 - await globalCount() }, (_, index) => `synthetic-global-quota-${index}`);
      try {
        await seedCredentials(global, bulk.principal.id, bulk.principal.authVersion);
        assert.equal(await globalCount(), 1024); assert.ok(await activeCount() < 32);
        const before = await snapshot();
        assert.deepEqual(await call('issueToken', admin.token, issueInput()), { ok: false, error: 'conflict' });
        assert.deepEqual(await snapshot(), before);
        // Rotation is a replacement, including when the global active count is exactly full.
        const rotated = await call('rotateToken', admin.token, { credentialId: issued.credential.id, ttlMs: 60000 });
        assert.equal(rotated.ok, true); assert.equal(await globalCount(), 1024); issued = rotated;
        await db.prepare(`UPDATE ${table('api_credentials')} SET expires_at_ms=${NOW} WHERE id=?`).bind(global[0]).run();
        assert.equal(await globalCount(), 1023); persistentToken = await issue(); assert.equal(await globalCount(), 1024);
      } finally { await removeCredentials(global); }
    });

    await check('credential digests, exact scopes and explicit authority survive workerd restart', async () => {
      persistentToken = await issue(); const before = await snapshot();
      await instance.dispose(); instance = undefined; db = undefined; await start();
      assert.deepEqual(await snapshot(), before);
      assert.equal((await call('check', persistentToken.token, target())).allowed, true);
      assert.equal((await call('check', persistentToken.token, target('workspace-a', 'admin', []))).allowed, false);
      assert.equal(await call('session', persistentToken.token, 'admin'), null);
    });
    t.diagnostic('Real local D1 and Worker machine services only. No HTTP/MCP product transport, provider, hosted Sites or user data is exercised.');
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
  }
});
