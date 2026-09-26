import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1MachineStore, MachineStoreInputError, MachineStoreError, MACHINE_STORE_LIMITS } from '../../core/identity/machine-store.ts';
import { createD1AuthorizationStore, AuthorizationStoreError } from '../../core/authorization/d1-store.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const guard = () => ({ sessionDigest: digest, sessionId: 'session-1', principalId: 'administrator-1', epoch: 1 });
const scopes = () => [
  { contextId: 'context-a', audience: 'app', permissionIds: ['example.tasks:read'] },
  { contextId: 'context-b', audience: 'admin', permissionIds: ['example.tasks:write'] },
];
const issue = () => ({ principalId: 'machine-1', label: 'Automation', digest, ttlMs: 60000, scopes: scopes() });
const rotation = () => ({ credentialId: 'credential-1', digest, ttlMs: 60000 });
const result = (rows = [], changes = 0) => ({ success: true, results: rows, meta: { changes } });
function fakeDatabase(run) {
  let calls = 0;
  return { db: { prepare: sql => ({ bind: (...values) => ({ sql, values }) }), batch: async statements => {
    calls++; return run(statements);
  } }, calls: () => calls };
}
function forbiddenDatabase() {
  let calls = 0;
  return { db: { prepare() { calls++; throw new Error('Unexpected I/O'); }, batch() { calls++; throw new Error('Unexpected I/O'); } }, calls: () => calls };
}
const credential = () => ({ id: 'credential-1', principalId: 'machine-1', label: 'Automation',
  authVersion: 1, createdAtMs: 1000, expiresAtMs: 61000, revokedAtMs: null });
const scopeRows = () => scopes().flatMap(scope => scope.permissionIds.map(permissionId => ({
  contextId: scope.contextId, audience: scope.audience, permissionId,
})));
const aclRows = () => [
  result([{ id: 'machine-1', kind: 'service', status: 'active', humanStatus: null }]),
  result([{ id: 'context-a', status: 'active' }, { id: 'context-b', status: 'active' }]),
  result([]), result([]), result([]), result([]), result([]), result([]), result([]),
];
const machineReadRows = () => [
  result([{ id: 'credential-1', principalId: 'machine-1', displayName: 'Automation', authVersion: 1,
    expiresAtMs: 61000, nowMs: 1000, epoch: 3 }]), ...aclRows(), result(scopeRows()),
];

test('machine mutations reject malformed authority and executable input before database access', async () => {
  const fake = forbiddenDatabase(), store = createD1MachineStore(fake.db);
  const accessor = guard(); Object.defineProperty(accessor, 'epoch', { get() { assert.fail('Getter must not run'); }, enumerable: true });
  for (const authority of [null, [], accessor, { ...guard(), sessionDigest: 'clear-token' }, { ...guard(), epoch: 0 },
    { ...guard(), principalId: 'admin\n' }, { ...guard(), sessionId: 'session-1\u2028' }, { ...guard(), role: 'owner' }]) {
    await assert.rejects(store.createService(authority, { displayName: 'Service' }), MachineStoreInputError);
    await assert.rejects(store.issueToken(authority, issue()), MachineStoreInputError);
    await assert.rejects(store.rotateToken(authority, rotation()), MachineStoreInputError);
    await assert.rejects(store.revokeToken(authority, 'credential-1'), MachineStoreInputError);
  }
  const input = issue(); Object.defineProperty(input, 'scopes', { get() { assert.fail('Getter must not run'); }, enumerable: true });
  for (const value of [null, input, { ...issue(), ttlMs: 999 }, { ...issue(), ttlMs: MACHINE_STORE_LIMITS.maximumTokenTtlMs + 1 },
    { ...issue(), ttlMs: Infinity }, { ...issue(), digest: `${digest}\n` }, { ...issue(), label: '\ud800' },
    { ...issue(), label: ' ' }, { ...issue(), scopes: [] }, { ...issue(), scopes: [{ ...scopes()[0], permissionIds: ['*'] }] }]) {
    await assert.rejects(store.issueToken(guard(), value), MachineStoreInputError);
  }
  for (const value of [null, { ...rotation(), scopes: scopes() }, { ...rotation(), credentialId: 'credential-1\r' }])
    await assert.rejects(store.rotateToken(guard(), value), MachineStoreInputError);
  for (const value of [null, { principalId: 'machine-1', expectedAuthVersion: Number.MAX_SAFE_INTEGER, status: 'disabled' },
    { principalId: 'machine-1', expectedAuthVersion: 1, status: 'owner' }])
    await assert.rejects(store.setServiceStatus(guard(), value), MachineStoreInputError);
  assert.equal(fake.calls(), 0);
});

test('zero claim cannot report a created principal, changed status, issued credential or revocation', async () => {
  const fake = fakeDatabase(statements => statements.map(() => result())), store = createD1MachineStore(fake.db);
  assert.equal(await store.createService(guard(), { displayName: 'Service' }), null);
  assert.equal(await store.setServiceStatus(guard(), { principalId: 'machine-1', expectedAuthVersion: 1, status: 'disabled' }), null);
  assert.equal(await store.issueToken(guard(), issue()), null);
  assert.equal(await store.rotateToken(guard(), rotation()), null);
  assert.equal(await store.revokeToken(guard(), 'credential-1'), false);
});

test('server token metadata is frozen and excludes hashes, extra data and caller supplied scopes', async () => {
  const privateRow = { ...credential(), secret_hash: 'synthetic-private-hash' };
  const fake = fakeDatabase(statements => { assert.equal(statements.length, 2); return [result([privateRow]), result(scopeRows())]; });
  const read = await createD1MachineStore(fake.db).readToken('credential-1');
  assert.deepEqual(read, { ...credential(), scopes: scopes() });
  assert.equal(Object.isFrozen(read), true); assert.equal(Object.isFrozen(read.scopes[0].permissionIds), true);
  const issueDb = fakeDatabase(statements => statements.map((_, index) => index === 0 ? result([], 1)
    : index === statements.length - 2 ? result([privateRow]) : index === statements.length - 1 ? result(scopeRows()) : result([], 1)));
  const issued = await createD1MachineStore(issueDb.db).issueToken(guard(), issue());
  assert.deepEqual(issued, { id: 'credential-1', principalId: 'machine-1', label: 'Automation',
    createdAtMs: 1000, expiresAtMs: 61000, scopes: scopes() });
  assert.equal('authVersion' in issued, false); assert.equal('secret_hash' in issued, false);
});

test('token projections reject malformed database values, duplicate scopes and bounded overflow', async () => {
  const cases = [
    [result([credential(), credential()]), result(scopeRows())],
    [result([{ ...credential(), expiresAtMs: 1000 }]), result(scopeRows())],
    [result([credential()]), result([scopeRows()[0], scopeRows()[0]])],
    [result([credential()]), result([])],
    [result([credential()]), result(Array.from({ length: 257 }, (_, i) => ({
      contextId: 'context-a', audience: 'app', permissionId: `example.tasks:permission-${i}` })))],
  ];
  for (const rows of cases) await assert.rejects(createD1MachineStore(fakeDatabase(() => rows).db).readToken('credential-1'), MachineStoreError);
  assert.equal(await createD1MachineStore(fakeDatabase(() => [result(), result()]).db).readToken('credential-1'), null);
});

test('captured scopes and authority cannot be changed while issuance is pending', async () => {
  const authority = guard(), input = issue(); let finish, received;
  const fake = fakeDatabase(statements => { received = statements; return new Promise(resolve => { finish = resolve; }); });
  const pending = createD1MachineStore(fake.db).issueToken(authority, input);
  authority.epoch = 55; authority.principalId = 'other-admin'; input.label = 'Changed'; input.ttlMs = 1;
  input.scopes[0].permissionIds.push('creezio.access:manage'); input.scopes[0].contextId = 'application';
  const values = received.flatMap(statement => statement.values);
  assert.ok(values.includes('administrator-1')); assert.ok(values.includes('Automation'));
  assert.equal(values.includes('other-admin'), false); assert.equal(values.includes('Changed'), false);
  assert.equal(values.some(value => typeof value === 'string' && value.includes('creezio.access:manage')), false);
  finish(received.map(() => result())); assert.equal(await pending, null);
});

test('vendor SQL errors are redacted in prepare, binding and batch phases', async () => {
  const diagnostic = 'synthetic-private-database-diagnostic';
  for (const phase of ['prepare', 'bind', 'batch']) {
    const db = { prepare() { if (phase === 'prepare') throw new Error(diagnostic);
      return { bind() { if (phase === 'bind') throw new Error(diagnostic); return {}; } }; },
    batch() { throw new Error(diagnostic); } };
    await assert.rejects(createD1MachineStore(db).readToken('credential-1'), error => error instanceof MachineStoreError
      && !String(error).includes(diagnostic) && !('cause' in error));
  }
});

test('coherent machine read selects one scope tuple and never constructs a human session', async () => {
  const fake = fakeDatabase(statements => { assert.equal(statements.length, 11); return machineReadRows(); });
  const store = createD1AuthorizationStore(fake.db);
  const state = await store.readMachine(digest, 'context-a', 'app');
  assert.equal(fake.calls(), 1); assert.equal(state.epoch, 3);
  assert.deepEqual(state.credential.scope, scopes()[0]);
  assert.equal('session' in state, false); assert.equal('secret_hash' in state.credential, false);
  assert.equal(Object.isFrozen(state.credential.scope.permissionIds), true);
  assert.equal((await store.readMachine(digest, 'context-a', 'admin')).credential.scope, null);
  assert.equal((await store.readMachine(digest, 'context-b', 'app')).credential.scope, null);
  assert.deepEqual((await store.readMachine(digest, 'context-b', 'admin')).credential.scope, scopes()[1]);
});

test('machine reads fail closed on absent credentials, invalid input or malformed ACL and scope results', async () => {
  const fake = forbiddenDatabase(), store = createD1AuthorizationStore(fake.db);
  for (const args of [['clear-token', 'context-a', 'app'], [digest, 'context-a\n', 'app'], [digest, 'context-a', 'owner']])
    assert.equal(await store.readMachine(...args), null);
  assert.equal(fake.calls(), 0);
  const missing = machineReadRows(); missing[0] = result();
  assert.equal(await createD1AuthorizationStore(fakeDatabase(() => missing).db).readMachine(digest, 'context-a', 'app'), null);
  for (const mutate of [rows => { rows[0].results[0].expiresAtMs = 1000; },
    rows => { rows[10] = result([scopeRows()[0], scopeRows()[0]]); },
    rows => { rows[3] = result(Array.from({ length: 129 }, (_, i) => ({ id: `role-${i}` }))); },
    rows => { rows[1].results[0].id = 'other-principal'; }, rows => { rows[10].success = false; }]) {
    const rows = machineReadRows(); mutate(rows);
    await assert.rejects(createD1AuthorizationStore(fakeDatabase(() => rows).db).readMachine(digest, 'context-a', 'app'), AuthorizationStoreError);
  }
});
