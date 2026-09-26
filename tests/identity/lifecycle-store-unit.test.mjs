import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1AccountLifecycleStore, LifecycleStoreInputError, LifecycleStoreError,
  LIFECYCLE_STORE_LIMITS } from '../../core/identity/lifecycle-store.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const passwordRecord = '$argon2id$v=19$m=19456,t=2,p=1$' + 'A'.repeat(22) + '$' + 'A'.repeat(43);
const guard = () => ({ sessionDigest: digest, sessionId: 'session-1', principalId: 'admin-1', epoch: 1 });
const invitation = () => ({ digest, loginIdentifier: 'recipient@example.invalid', displayName: 'Synthetic recipient', ttlMs: 60000 });
const capability = () => ({ purpose: 'activation', digest, principalId: 'recipient-1', ttlMs: 60000 });
const result = (results = [], changes = 0) => ({ success: true, results, meta: { changes } });
function forbiddenDb() {
  let calls = 0;
  return { db: { prepare() { calls++; throw new Error('Unexpected database access'); }, batch() { calls++; throw new Error('Unexpected database access'); } },
    calls: () => calls };
}

test('malformed administrative guards cannot start lifecycle SQL', async () => {
  const fake = forbiddenDb(), store = createD1AccountLifecycleStore(fake.db);
  const accessor = guard();
  Object.defineProperty(accessor, 'epoch', { enumerable: true, get() { assert.fail('Getter must not run'); } });
  for (const value of [null, [], accessor, { ...guard(), epoch: 0 }, { ...guard(), epoch: 1.5 },
    { ...guard(), principalId: 'admin-1\n' }, { ...guard(), sessionId: 'session-1\u2028' },
    { ...guard(), sessionDigest: 'raw-session-secret' }, { ...guard(), owner: true }]) {
    await assert.rejects(store.issueInvitation(value, invitation()), LifecycleStoreInputError);
    await assert.rejects(store.issueCapability(value, capability()), LifecycleStoreInputError);
    await assert.rejects(store.revokeCapability(value, 'capability-1'), LifecycleStoreInputError);
  }
  assert.equal(fake.calls(), 0);
});

test('invitations reject executable inputs, invalid identities and TTL overflow before SQL', async () => {
  const fake = forbiddenDb(), store = createD1AccountLifecycleStore(fake.db);
  const accessor = invitation();
  Object.defineProperty(accessor, 'displayName', { enumerable: true, get() { assert.fail('Getter must not run'); } });
  for (const value of [null, accessor, { ...invitation(), digest: `${digest}\n` }, { ...invitation(), loginIdentifier: 'Kelvin' },
    { ...invitation(), displayName: '\ud800' }, { ...invitation(), displayName: ' ' },
    { ...invitation(), displayName: 'a'.repeat(121) }, { ...invitation(), displayName: '🙂'.repeat(101) },
    { ...invitation(), ttlMs: 999 }, { ...invitation(), ttlMs: LIFECYCLE_STORE_LIMITS.maximumCapabilityTtlMs + 1 },
    { ...invitation(), ttlMs: Infinity }, { ...invitation(), role: 'administrator' }]) {
    await assert.rejects(store.issueInvitation(guard(), value), LifecycleStoreInputError);
  }
  assert.equal(fake.calls(), 0);
});

test('capability purpose, reset lifetime and approved password profile are strict before persistence', async () => {
  const fake = forbiddenDb(), store = createD1AccountLifecycleStore(fake.db);
  for (const value of [null, { ...capability(), purpose: 'invitation' }, { ...capability(), principalId: 'recipient-1\r' },
    { ...capability(), ttlMs: 0 }, { ...capability(), purpose: 'password-reset', ttlMs: 3600001 }]) {
    await assert.rejects(store.issueCapability(guard(), value), LifecycleStoreInputError);
  }
  const consume = { digest, purpose: 'invitation', passwordRecord };
  const accessor = { ...consume }; Object.defineProperty(accessor, 'passwordRecord', { enumerable: true,
    get() { assert.fail('Getter must not run'); } });
  for (const value of [null, accessor, { ...consume, purpose: 'reset' }, { ...consume, passwordRecord: 'plaintext' },
    { ...consume, passwordRecord: passwordRecord.replace('m=19456', 'm=32') }, { ...consume, role: 'administrator' }]) {
    await assert.rejects(store.consumeCapability(value), LifecycleStoreInputError);
  }
  for (const value of [null, undefined, {}, 'clear-token', `${digest}\n`]) assert.equal(await store.readCapability(value, 'activation'), null);
  assert.equal(await store.readCapability(digest, 'bootstrap'), null);
  await assert.rejects(store.revokeCapability(guard(), 'capability-1\n'), LifecycleStoreInputError);
  assert.equal(fake.calls(), 0);
});

test('capability availability returns a frozen safe projection and refuses ambiguous database results', async () => {
  const row = { capabilityId: 'capability-1', principalId: 'recipient-1', purpose: 'activation', expiresAtMs: 10000,
    secret_hash: 'synthetic-private-digest', password_record: 'synthetic-private-phc' };
  const make = rows => createD1AccountLifecycleStore({ prepare: () => ({ bind: () => ({}) }), batch: async () => [result(rows)] });
  const available = await make([row]).readCapability(digest, 'activation');
  assert.deepEqual(available, { capabilityId: 'capability-1', principalId: 'recipient-1', purpose: 'activation', expiresAtMs: 10000 });
  assert.equal(Object.isFrozen(available), true);
  assert.equal(await make([]).readCapability(digest, 'activation'), null);
  for (const rows of [[row, row], [{ ...row, purpose: 'password-reset' }], [{ ...row, expiresAtMs: Infinity }]]) {
    await assert.rejects(make(rows).readCapability(digest, 'activation'), LifecycleStoreError);
  }
});

test('storage errors never expose a vendor message, SQL values or nested cause', async () => {
  const sensitive = 'synthetic-secret-sql-diagnostic';
  for (const phase of ['prepare', 'bind', 'batch']) {
    const db = { prepare() {
      if (phase === 'prepare') throw new Error(sensitive);
      return { bind() { if (phase === 'bind') throw new Error(sensitive); return {}; } };
    }, batch: async () => { throw new Error(sensitive); } };
    await assert.rejects(createD1AccountLifecycleStore(db).readCapability(digest, 'activation'), error =>
      error instanceof LifecycleStoreError && !String(error).includes(sensitive) && !('cause' in error));
  }
  const db = { prepare: () => ({ bind: () => ({}) }), batch: async () => [{ ...result(), success: false }] };
  await assert.rejects(createD1AccountLifecycleStore(db).readCapability(digest, 'activation'), LifecycleStoreError);
});

test('zero acquisition cannot report a issued or consumed capability, or a successful revocation', async () => {
  const db = { prepare: () => ({ bind: () => ({}) }), batch: async statements => statements.map(() => result()) };
  const store = createD1AccountLifecycleStore(db);
  assert.equal(await store.issueInvitation(guard(), invitation()), null);
  assert.equal(await store.issueCapability(guard(), capability()), null);
  assert.equal(await store.consumeCapability({ digest, purpose: 'invitation', passwordRecord }), null);
  assert.equal(await store.revokeCapability(guard(), 'capability-1'), false);
});

test('captured invitation and guard scalars do not change while the database batch is pending', async () => {
  const input = invitation(), authority = guard(); let finish, statements;
  const db = { prepare: sql => ({ bind: (...values) => ({ sql, values }) }),
    batch: received => { statements = received; return new Promise(resolve => { finish = resolve; }); } };
  const pending = createD1AccountLifecycleStore(db).issueInvitation(authority, input);
  authority.principalId = 'different-admin'; authority.epoch = 99;
  input.loginIdentifier = 'different@example.invalid'; input.displayName = 'Changed recipient'; input.ttlMs = 1;
  const values = statements.flatMap(statement => statement.values);
  assert.ok(values.includes('admin-1')); assert.ok(values.includes('recipient@example.invalid'));
  assert.ok(values.includes('Synthetic recipient')); assert.equal(values.includes('different-admin'), false);
  assert.equal(values.includes('different@example.invalid'), false); assert.equal(values.includes('Changed recipient'), false);
  finish(statements.map(() => result())); assert.equal(await pending, null);
});
