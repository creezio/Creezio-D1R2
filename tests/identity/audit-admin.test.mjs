import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createAccountService, provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createAccessAuditService} from '../../core/identity/audit.ts';
import {createD1AccessAuditStore} from '../../core/identity/audit-store.ts';
import {createNativeAuthorizationResolver} from '../../core/authorization/resolver.ts';
import {parseAccessPolicy} from '../../core/authorization/policy.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const models = JSON.parse(readFileSync(join(root, 'extensions/native/access/module/models.json'), 'utf8'));

test('native audit pages expose complete policy changes without internal claim or credential fields', async () => {
  const schema = generateD1Schema('creezio.access', models), table = id => `"${schema.tables[id]}"`;
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: 'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases: {DB: 'audit-test'}, d1Persist: false});
  try {
    const db = await runtime.getD1Database('DB');
    await db.batch(schema.statements.map(sql => db.prepare(sql)));
    const capability = await provisionBootstrapCapability(db);
    const account = createAccountService(db);
    const owner = await account.bootstrap({token: capability.token, loginIdentifier: 'audit@example.invalid',
      displayName: 'Audit owner', password: 'Synthetic audit qualification password'});
    assert.equal(owner.ok, true);
    const login = await account.login({loginIdentifier: 'audit@example.invalid',
      password: 'Synthetic audit qualification password', audience: 'admin'});
    assert.equal(login.ok, true);
    const before = await createAuthorizationService(db, {permissions: []}).readPolicy(login.token);
    assert.equal(before.ok, true);
    const after = structuredClone(before.policy);
    after.roles.push({id: 'reviewer', inherits: [], permissionIds: ['creezio.access:manage'], permissionOverrides: []});
    const when = Date.now();
    await db.batch([
      db.prepare(`INSERT INTO ${table('access_audit')}
        (id,action,principal_id,session_id,claim_nonce,created_at_ms)
        VALUES (?,'authorization-updated',?,?,?,?)`)
        .bind('audit-a', owner.principalId, login.session.id, 'claim-private-a', when),
      db.prepare(`INSERT INTO ${table('access_policy_audit_details')}
        (audit_id,from_epoch,to_epoch,changes_json) VALUES (?,?,?,?)`)
        .bind('audit-a', before.epoch, before.epoch + 1,
          JSON.stringify({version: 1, beforePolicy: before.policy, afterPolicy: after})),
      db.prepare(`INSERT INTO ${table('access_audit')}
        (id,action,principal_id,session_id,claim_nonce,created_at_ms)
        VALUES (?,'authorization-updated',?,?,?,?)`)
        .bind('audit-b', owner.principalId, login.session.id, 'claim-private-b', when),
    ]);
    const service = createAccessAuditService(db, {permissions: []});
    const first = await service.list(login.token, {limit: 1, before: null});
    assert.equal(first.ok, true); assert.equal(first.items[0].id, 'audit-b');
    assert.equal(first.items[0].detailAvailable, false);
    const second = await service.list(login.token, {limit: 1, before: first.nextCursor});
    assert.equal(second.ok, true); assert.equal(second.items[0].id, 'audit-a');
    assert.equal(second.items[0].detailAvailable, true);
    assert.equal(second.nextCursor !== null, true, 'other native audit events remain pageable');
    const firstChange = await service.detail(login.token, {auditId: 'audit-a', limit: 1, afterIndex: null});
    assert.equal(firstChange.ok, true); assert.equal(firstChange.changes.length, 1);
    assert.equal(firstChange.changes[0].kind, 'role-existence');
    const secondChange = await service.detail(login.token, {auditId: 'audit-a', limit: 1,
      afterIndex: firstChange.nextAfterIndex});
    assert.equal(secondChange.ok, true); assert.equal(secondChange.changes[0].kind, 'role-grant');
    assert.equal(secondChange.nextAfterIndex, null);
    assert.equal((await service.detail(login.token, {auditId: 'audit-b', limit: 1, afterIndex: null})).error,
      'not_found', 'historical events without detail are explicit');
    const projection = JSON.stringify([first, second, firstChange, secondChange]);
    assert.doesNotMatch(projection, /claim-private|cz1s_|password|session_id|credential_id/);
    const large = structuredClone(before.policy);
    large.roles.push({id: 'large', inherits: [], permissionIds: Array.from({length: 550}, (_, index) =>
      `creezio.access:p${index}${'x'.repeat(125)}`), permissionOverrides: []});
    assert.ok(parseAccessPolicy(large));
    assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength > 75_000);
    await db.batch([
      db.prepare(`INSERT INTO ${table('access_audit')}
        (id,action,principal_id,session_id,claim_nonce,created_at_ms)
        VALUES (?,'authorization-updated',?,?,?,?)`)
        .bind('audit-large', owner.principalId, login.session.id, 'claim-private-large', when + 1),
      db.prepare(`INSERT INTO ${table('access_policy_audit_details')}
        (audit_id,from_epoch,to_epoch,changes_json) VALUES (?,?,?,?)`)
        .bind('audit-large', before.epoch, before.epoch + 1,
          JSON.stringify({version: 1, beforePolicy: before.policy, afterPolicy: large})),
    ]);
    const pages = [], indexes = new Set();
    let afterIndex = null;
    do {
      const page = await service.detail(login.token, {auditId: 'audit-large', limit: 32, afterIndex});
      assert.equal(page.ok, true);
      assert.ok(page.changes.length > 0 && page.changes.length <= 32);
      for (const change of page.changes) {
        assert.equal(indexes.has(change.index), false, 'change indexes never repeat across detail pages');
        indexes.add(change.index);
      }
      assert.doesNotMatch(JSON.stringify(page), /claim-private|cz1s_|password|session_id|credential_id/);
      pages.push(page); afterIndex = page.nextAfterIndex;
    } while (afterIndex !== null);
    assert.ok(pages.length > 10, 'large immutable snapshot is projected over several bounded pages');
    assert.equal(indexes.size, 551, 'new role and every permission grant are visible');
    const resolved = await createNativeAuthorizationResolver(db, {permissions: []}).resolve(login.token, 'admin');
    assert.ok(resolved, 'a fresh guard exists before revocation');
    const guard = {sessionDigest: resolved.digest, sessionId: resolved.session.id,
      principalId: resolved.session.principalId, epoch: resolved.epoch};
    await db.prepare(`UPDATE ${table('sessions')} SET revoked_at_ms=? WHERE id=?`)
      .bind(Date.now(), login.session.id).run();
    assert.equal(await createD1AccessAuditStore(db).list(guard, {limit: 1, before: null}), null,
      'D1 guard rejects a session revoked after authorization resolution');
    assert.equal((await service.list(login.token, {limit: 1, before: null})).error, 'unauthorized');
  } finally {await runtime.dispose();}
});
