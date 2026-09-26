import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountLifecycleService } from '../../core/identity/lifecycle.ts';
import { createNativeAuthorizationResolver, ACCESS_MANAGEMENT } from '../../core/authorization/resolver.ts';
import { ACCESS_TABLES } from '../../core/identity/d1-store.ts';
import { issueOpaqueToken } from '../../core/identity/tokens.ts';
import { verifyPassword } from '../../core/identity/password.ts';

const result = (rows = [], changes = 0) => ({ success: true, results: rows, meta: { changes } });
const authority = (allowed = true) => [
  result([{ id: 'admin-session', principalId: 'admin-person', displayName: 'Synthetic admin', audience: 'admin',
    authVersion: 1, createdAtMs: 0, expiresAtMs: 10000, epoch: 1, nowMs: 1000 }]),
  result([{ id: 'admin-person', kind: 'human', status: 'active', humanStatus: 'active' }]),
  result([{ id: 'application', status: 'active' }]), result([{ id: 'administrator' }]), result([]),
  result([{ roleId: 'administrator', permissionId: 'creezio.access:manage' }]), result([]),
  result([{ principalId: 'admin-person', contextId: 'application', audience: 'admin', status: 'active' }]),
  result(allowed ? [{ principalId: 'admin-person', contextId: 'application', audience: 'admin', roleId: 'administrator' }] : []), result([]),
];
const throttle = attempts => [result(), result([{ attempts, retryAtMs: Date.now() + 60000 }], 1)];
const isThrottle = statements => statements.some(s => s.sql.includes(`INSERT INTO "${ACCESS_TABLES.auth_throttles}"`));
function database(handler) {
  const calls = [];
  return { calls, db: { prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch(statements) { calls.push(statements); return handler(statements, calls.length); } } };
}
const service = db => createAccountLifecycleService(db, { permissions: [] });

test('lifecycle boundaries reject malformed or executable inputs before database admission', async () => {
  const fake = database(() => assert.fail('Invalid input must not reach storage')), api = service(fake.db);
  let getterCalls = 0;
  const getter = Object.defineProperty({}, 'password', { enumerable: true, get() { getterCalls++; throw new Error('Do not call getters'); } });
  for (const input of [null, undefined, [], 'text', 42, false, new Date(), {}, getter,
    new Proxy({}, { ownKeys() { throw new Error('Rejected proxy'); } })]) {
    for (const name of ['issueInvitation', 'issueActivation', 'issuePasswordReset', 'revokeCapability'])
      assert.deepEqual(await api[name]('invalid-session', input), { ok: false, error: 'invalid_input' });
    assert.deepEqual(await api.redeem(input), { ok: false, error: 'invalid_input' });
  }
  for (const principalId of ['', 'account\n', '../escape', 'x'.repeat(129), null])
    assert.deepEqual(await api.issuePasswordReset('invalid-session', { principalId }), { ok: false, error: 'invalid_input' });
  assert.deepEqual(await api.issueInvitation('invalid-session', { loginIdentifier: 'alice', displayName: 'Alice', role: 'administrator' }), { ok: false, error: 'invalid_input' });
  assert.deepEqual(await api.redeem({ token: 'bad', purpose: 'session', password: 'Synthetic valid password' }), { ok: false, error: 'invalid_input' });
  assert.equal(getterCalls, 0); assert.equal(fake.calls.length, 0);
});

test('capability purposes cannot substitute for a native administrative session or one another', async () => {
  const fake = database(() => assert.fail('Cross-purpose tokens must not reach D1')), api = service(fake.db);
  const invitation = await issueOpaqueToken('invitation'), session = await issueOpaqueToken('session');
  assert.deepEqual(await api.issueInvitation(invitation.token, { loginIdentifier: 'alice', displayName: 'Alice' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await api.redeem({ token: invitation.token, purpose: 'password-reset', password: 'Synthetic valid password' }), { ok: false, error: 'unavailable' });
  assert.deepEqual(await api.redeem({ token: session.token, purpose: 'activation', password: 'Synthetic valid password' }), { ok: false, error: 'unavailable' });
  assert.equal(fake.calls.length, 0);
});

test('server permission catalogue is detached and immutable and cannot replace the native administrative right', () => {
  const fake = database(() => assert.fail('Catalogue construction must not query D1'));
  const external = [{ id: 'example.notes:read', audiences: ['app'], actors: ['user'] }];
  const resolver = createNativeAuthorizationResolver(fake.db, { permissions: external });
  external[0].id = 'example.notes:write'; external[0].audiences.push('admin'); external.push({ id: 'example.other:read', audiences: ['app'], actors: ['user'] });
  assert.deepEqual(resolver.permissions.map(permission => permission.id).sort(),
    ['creezio.access:impersonate', 'creezio.access:manage', 'example.notes:read']);
  assert.deepEqual(resolver.permissions.find(permission => permission.id === 'example.notes:read').audiences, ['app']);
  assert.throws(() => resolver.permissions.push(external[0]), TypeError);
  assert.throws(() => resolver.permissions[0].actors.push('machine'), TypeError);
  assert.throws(() => { resolver.permissions[0].id = 'example.other:write'; }, TypeError);
  assert.throws(() => ACCESS_MANAGEMENT.requiredPermissionIds.splice(0), TypeError);
  for (const id of ['creezio.access:manage', 'creezio.access:manage\n', 'creezio.access:impersonate', 'creezio.access:impersonate\n'])
    assert.throws(() => serviceWith([{ id, actors: ['machine'], audiences: ['app'] }]), /Invalid server permission catalog/);
  function serviceWith(permissions) { return createAccountLifecycleService(fake.db, { permissions }); }
});

test('an authenticated account without current manage permission cannot issue, reset or revoke', async () => {
  const fake = database(statements => { assert.equal(statements.length, 10); return authority(false); });
  const api = service(fake.db), token = (await issueOpaqueToken('session')).token;
  for (const [method, input] of [['issueInvitation', { loginIdentifier: 'alice', displayName: 'Alice' }],
    ['issueActivation', { principalId: 'alice' }], ['issuePasswordReset', { principalId: 'alice' }],
    ['revokeCapability', { capabilityId: 'capability' }]])
    assert.deepEqual(await api[method](token, input), { ok: false, error: 'forbidden' });
  assert.equal(fake.calls.length, 4);
});

test('invitation captures normalized target fields before asynchronous authority and never releases a rejected secret', async () => {
  const input = { loginIdentifier: '  ALICE  ', displayName: ' Alice ' };
  let invitationValues;
  const fake = database(statements => {
    if (statements.length === 10) { input.loginIdentifier = 'different'; input.displayName = 'Different'; return authority(); }
    if (isThrottle(statements)) return throttle(1);
    invitationValues = statements;
    return statements.map(() => result()); // Fresh claim rejected: no capability may be released.
  });
  const response = await service(fake.db).issueInvitation((await issueOpaqueToken('session')).token, input);
  assert.deepEqual(response, { ok: false, error: 'conflict' });
  const principal = invitationValues.find(s => s.sql.startsWith(`INSERT INTO "${ACCESS_TABLES.principals}"`));
  const account = invitationValues.find(s => s.sql.startsWith(`INSERT INTO "${ACCESS_TABLES.human_accounts}"`));
  assert.equal(principal.values[1], 'Alice'); assert.equal(account.values[1], 'alice');
  assert.equal(JSON.stringify(invitationValues).includes('different'), false);
});

test('account and capability identifiers are captured before awaiting the administrative snapshot', async () => {
  for (const [method, key] of [['issueActivation', 'principalId'], ['issuePasswordReset', 'principalId'], ['revokeCapability', 'capabilityId']]) {
    const input = { [key]: 'target-before-await' }; let written;
    const fake = database(statements => {
      if (statements.length === 10) { input[key] = 'target-after-await'; return authority(); }
      if (isThrottle(statements)) return throttle(1);
      written = statements; return statements.map(() => result());
    });
    assert.deepEqual(await service(fake.db)[method]((await issueOpaqueToken('session')).token, input), { ok: false, error: 'conflict' });
    assert.ok(written.some(s => s.values.includes('target-before-await')));
    assert.equal(written.some(s => s.values.includes('target-after-await')), false);
  }
});

test('redemption freezes purpose, token and password before admission and returns no session or rights', async () => {
  const issued = await issueOpaqueToken('activation'), password = 'Synthetic password before admission';
  const input = { token: issued.token, purpose: 'activation', password }; let record;
  const fake = database(statements => {
    if (isThrottle(statements)) {
      input.token = 'changed'; input.purpose = 'password-reset'; input.password = 'Synthetic different password'; return throttle(1);
    }
    if (statements.length === 1) {
      assert.deepEqual(statements[0].values, [issued.digest, 'activation']);
      return [result([{ capabilityId: 'capability', principalId: 'person', purpose: 'activation', expiresAtMs: 10000 }])];
    }
    const credential = statements.find(s => s.sql.startsWith(`INSERT INTO "${ACCESS_TABLES.password_credentials}"`));
    assert.ok(credential); record = credential.values[0];
    return statements.map((_, index) => index === statements.length - 1 ? result([{ principalId: 'person' }]) : result([], 1));
  });
  assert.deepEqual(await service(fake.db).redeem(input), { ok: true, principalId: 'person' });
  assert.equal(verifyPassword(password, record), true); assert.equal(verifyPassword(input.password, record), false);
});

test('rate limiting stops before capability access and storage diagnostics never escape', async () => {
  const activation = await issueOpaqueToken('activation'), session = await issueOpaqueToken('session');
  const limited = database(statements => {
    if (statements.length === 10) return authority();
    assert.ok(isThrottle(statements)); return throttle(1000);
  });
  const limitedApi = service(limited.db);
  assert.deepEqual(await limitedApi.redeem({ token: activation.token, purpose: 'activation', password: 'Synthetic valid password' }), { ok: false, error: 'rate_limited' });
  assert.deepEqual(await limitedApi.issueActivation(session.token, { principalId: 'person' }), { ok: false, error: 'rate_limited' });
  const broken = database(() => { throw new Error('Synthetic SQL diagnostic with private binding content'); });
  assert.deepEqual(await service(broken.db).issueActivation(session.token, { principalId: 'person' }), { ok: false, error: 'storage_error' });
  assert.deepEqual(await service(broken.db).redeem({ token: activation.token, purpose: 'activation', password: 'Synthetic valid password' }), { ok: false, error: 'storage_error' });
});
