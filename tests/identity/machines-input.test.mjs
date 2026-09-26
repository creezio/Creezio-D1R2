import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachineAccountService } from '../../core/identity/machines.ts';
import { ACCESS_TABLES } from '../../core/identity/d1-store.ts';
import { issueOpaqueToken } from '../../core/identity/tokens.ts';

const READ = 'example.notes:read', WRITE = 'example.notes:write';
const catalog = () => [READ, WRITE].map(id => ({ id, actors: ['user', 'machine'], audiences: ['app'] }));
const result = (results = [], changes = 0) => ({ success: true, results, meta: { changes } });
const scope = (contextId = 'a', permissionIds = [READ]) => ({ contextId, audience: 'app', permissionIds });
const target = (contextId = 'a', requiredPermissionIds = [READ]) => ({ contextId, audience: 'app',
  actors: ['machine'], requiredPermissionIds, purpose: 'operation' });
function authority(allowed = true) {
  return [result([{ id: 'admin-session', principalId: 'admin', displayName: 'Synthetic administrator', audience: 'admin',
    authVersion: 1, createdAtMs: 0, expiresAtMs: 10000, epoch: 1, nowMs: 1000 }]),
  result([{ id: 'admin', kind: 'human', status: 'active', humanStatus: 'active' }]),
  result(['application', 'a', 'b'].map(id => ({ id, status: 'active' }))), result([{ id: 'administrator' }]), result([]),
  result([{ roleId: 'administrator', permissionId: 'creezio.access:manage' }]), result([]),
  result([{ principalId: 'admin', contextId: 'application', audience: 'admin', status: 'active' }]),
  result(allowed ? [{ principalId: 'admin', contextId: 'application', audience: 'admin', roleId: 'administrator' }] : []), result([])];
}
function machineRows() {
  return [result([{ id: 'api-key', principalId: 'machine', displayName: 'Synthetic service',
    authVersion: 1, expiresAtMs: 10000, epoch: 1, nowMs: 1000 }]),
  result([{ id: 'machine', kind: 'service', status: 'active', humanStatus: null }]),
  result(['a', 'b'].map(id => ({ id, status: 'active' }))), result([{ id: 'editor' }]), result([]),
  result([READ, WRITE].map(permissionId => ({ roleId: 'editor', permissionId }))), result([]),
  result(['a', 'b'].map(contextId => ({ principalId: 'machine', contextId, audience: 'app', status: 'active' }))),
  result(['a', 'b'].map(contextId => ({ principalId: 'machine', contextId, audience: 'app', roleId: 'editor' }))), result([]),
  result([{ contextId: 'a', audience: 'app', permissionId: READ }, { contextId: 'b', audience: 'app', permissionId: WRITE }])];
}
function database(handler) {
  const calls = [];
  return { calls, db: { prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch(statements) { calls.push(statements); return handler(statements, calls.length); } } };
}
const service = (db, permissions = catalog()) => createMachineAccountService(db, { permissions });
const isThrottle = statements => statements.some(s => s.sql.includes(`INSERT INTO "${ACCESS_TABLES.auth_throttles}"`));
const admitted = () => [result(), result([{ attempts: 1, retryAtMs: Date.now() + 60000 }], 1)];

test('machine command boundaries reject foreign shapes, getters, wildcards and unsupported TTL before D1', async () => {
  const fake = database(() => assert.fail('Invalid requests must not reach D1')), api = service(fake.db);
  let accessed = 0;
  const getter = Object.defineProperty({}, 'displayName', { enumerable: true, get() { accessed++; throw new Error('Accessor'); } });
  for (const bad of [null, undefined, [], new Date(), {}, 1, 'text', getter,
    new Proxy({}, { ownKeys() { throw new Error('Reflection failure'); } })])
    for (const method of ['createService', 'setServiceStatus', 'issueToken', 'rotateToken', 'revokeToken'])
      assert.deepEqual(await api[method]('invalid', bad), { ok: false, error: 'invalid_input' });
  const input = { principalId: 'machine', label: 'Test', ttlMs: 1000, scopes: [scope()] };
  for (const ttlMs of [0, 999, 365 * 86400000 + 1, Infinity, NaN, 1.5])
    assert.deepEqual(await api.issueToken('invalid', { ...input, ttlMs }), { ok: false, error: 'invalid_input' });
  assert.deepEqual(await api.issueToken('invalid', { ...input, scopes: [scope('a', ['*'])] }), { ok: false, error: 'invalid_input' });
  assert.deepEqual(await api.rotateToken('invalid', { credentialId: 'key', ttlMs: 1000, scopes: [scope()] }), { ok: false, error: 'invalid_input' });
  assert.deepEqual(await api.setServiceStatus('invalid', { principalId: 'machine', expectedAuthVersion: 1, status: 'owner' }), { ok: false, error: 'invalid_input' });
  assert.equal(accessed, 0); assert.equal(fake.calls.length, 0);
});

test('scope requests obey the immutable catalogue, machine actor and audience before authentication', async () => {
  const fake = database(() => assert.fail('Invalid scopes must not reach storage'));
  const permissions = [...catalog(), { id: 'example.private:read', actors: ['user'], audiences: ['app'] },
    { id: 'example.control:read', actors: ['machine'], audiences: ['admin'] }];
  const api = service(fake.db, permissions);
  permissions[0].actors.length = 0; permissions[2].actors.push('machine');
  const input = { principalId: 'machine', label: 'Test', ttlMs: 1000, scopes: [scope()] };
  for (const permission of ['unknown.module:read', 'example.private:read', 'example.control:read', 'creezio.access:manage'])
    assert.deepEqual(await api.issueToken('invalid', { ...input, scopes: [scope('a', [permission])] }), { ok: false, error: 'invalid_input' });
  assert.deepEqual(await api.issueToken('invalid', input), { ok: false, error: 'unauthorized' }, 'caller catalogue mutation cannot remove a valid declaration');
  assert.equal(fake.calls.length, 0);
});

test('API credentials never substitute for administrative sessions and browser credentials never authenticate machines', async () => {
  const fake = database(() => assert.fail('Wrong credential purpose must stop before D1')), api = service(fake.db);
  const machine = await issueOpaqueToken('api-token'), human = await issueOpaqueToken('session');
  assert.deepEqual(await api.createService(machine.token, { displayName: 'Service' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(await api.check(human.token, target()), { allowed: false, reason: 'credential_disabled' });
  assert.deepEqual(await api.check(machine.token, { ...target(), requiredPermissionIds: ['*'] }), { allowed: false, reason: 'invalid_target' });
  assert.equal(fake.calls.length, 0);
});

test('an administrative session still needs current manage permission for every machine mutation', async () => {
  const fake = database(statements => { assert.equal(statements.length, 10); return authority(false); });
  const api = service(fake.db), token = (await issueOpaqueToken('session')).token;
  for (const [method, input] of [['createService', { displayName: 'Service' }],
    ['setServiceStatus', { principalId: 'machine', expectedAuthVersion: 1, status: 'disabled' }],
    ['issueToken', { principalId: 'machine', label: 'Test', ttlMs: 1000, scopes: [scope()] }],
    ['rotateToken', { credentialId: 'key', ttlMs: 1000 }], ['revokeToken', { credentialId: 'key' }]])
    assert.deepEqual(await api[method](token, input), { ok: false, error: 'forbidden' });
  assert.equal(fake.calls.length, 5);
});

test('issuance captures nested scopes, label and target before awaiting authority and withholds rejected secrets', async () => {
  const input = { principalId: 'machine-before', label: ' Original ', ttlMs: 1000, scopes: [scope()] };
  let written;
  const fake = database(statements => {
    if (statements.length === 10) {
      input.principalId = 'machine-after'; input.label = 'Changed'; input.ttlMs = 999999;
      input.scopes[0].contextId = 'b'; input.scopes[0].permissionIds.push(WRITE); return authority();
    }
    if (isThrottle(statements)) return admitted();
    written = statements; return statements.map(() => result());
  });
  assert.deepEqual(await service(fake.db).issueToken((await issueOpaqueToken('session')).token, input), { ok: false, error: 'conflict' });
  const values = written.flatMap(s => s.values);
  assert.ok(values.includes('machine-before')); assert.ok(values.includes('Original')); assert.ok(values.includes(1000));
  assert.ok(values.includes(JSON.stringify([scope()])));
  assert.equal(values.includes('machine-after'), false); assert.equal(values.includes('Changed'), false);
});

test('status update captures its optimistic version and target before awaiting authority', async () => {
  const input = { principalId: 'machine-before', expectedAuthVersion: 1, status: 'disabled' }; let written;
  const fake = database(statements => {
    if (statements.length === 10) { input.principalId = 'machine-after'; input.expectedAuthVersion = 99; input.status = 'active'; return authority(); }
    if (isThrottle(statements)) return admitted();
    written = statements; return statements.map(() => result());
  });
  assert.deepEqual(await service(fake.db).setServiceStatus((await issueOpaqueToken('session')).token, input), { ok: false, error: 'conflict' });
  const values = written.flatMap(s => s.values);
  assert.ok(values.includes('machine-before')); assert.ok(values.includes('disabled')); assert.equal(values.includes('machine-after'), false);
  assert.equal(values.includes(99), false);
});

test('machine authorization intersects current grants with a single exact scope pair and never approves as a human', async () => {
  const fake = database(statements => { assert.equal(statements.length, 11); return machineRows(); });
  const api = service(fake.db), token = (await issueOpaqueToken('api-token')).token;
  assert.deepEqual(await api.check(token, target('a', [READ])), { allowed: true, reason: 'allowed' });
  assert.deepEqual(await api.check(token, target('b', [WRITE])), { allowed: true, reason: 'allowed' });
  assert.deepEqual(await api.check(token, target('a', [WRITE])), { allowed: false, reason: 'scope_denied' });
  assert.deepEqual(await api.check(token, target('b', [READ])), { allowed: false, reason: 'scope_denied' });
  assert.equal((await api.check(token, { ...target(), purpose: 'human-approval' })).allowed, false);
});

test('changing an operation target during machine resolution cannot remove its required permission', async () => {
  const input = target('a', [WRITE]);
  const fake = database(() => { input.contextId = 'b'; input.requiredPermissionIds.length = 0; return machineRows(); });
  assert.deepEqual(await service(fake.db).check((await issueOpaqueToken('api-token')).token, input), { allowed: false, reason: 'scope_denied' });
});

test('inactive contexts stop issuance and database diagnostics are redacted for commands and decisions', async () => {
  const fake = database(statements => {
    if (statements.length === 10) { const rows = authority(); rows[2].results.find(c => c.id === 'a').status = 'disabled'; return rows; }
    assert.ok(isThrottle(statements)); return admitted();
  });
  const human = (await issueOpaqueToken('session')).token, apiToken = (await issueOpaqueToken('api-token')).token;
  assert.deepEqual(await service(fake.db).issueToken(human, { principalId: 'machine', label: 'Test', ttlMs: 1000, scopes: [scope()] }), { ok: false, error: 'invalid_input' });
  const broken = database(() => { throw new Error('Synthetic secret SQL provider diagnostic'); });
  assert.deepEqual(await service(broken.db).createService(human, { displayName: 'Service' }), { ok: false, error: 'storage_error' });
  assert.deepEqual(await service(broken.db).check(apiToken, target()), { allowed: false, reason: 'invalid_snapshot' });
});
