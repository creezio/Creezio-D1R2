import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1AuthorizationStore, AuthorizationStoreError, AuthorizationStoreInputError } from '../../core/authorization/d1-store.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const policy = () => ({
  contexts: [{ id: 'application', status: 'active' }],
  roles: [{ id: 'administrator', inherits: [], permissionIds: ['creezio.access:manage'], permissionOverrides: [] }],
  memberships: [{ principalId: 'principal-1', contextId: 'application', audience: 'admin', status: 'active' }],
  assignments: [{ principalId: 'principal-1', contextId: 'application', audience: 'admin', roleId: 'administrator' }],
  overrides: [],
});
const commitInput = () => ({ sessionDigest: digest, sessionId: 'session-1', principalId: 'principal-1', epoch: 1,
  policy: policy(), beforePolicy: policy() });
const result = (rows, changes = 0) => ({ success: true, results: rows, meta: { changes } });
const rows = () => [
  result([{ id: 'session-1', principalId: 'principal-1', displayName: 'Synthetic user', audience: 'admin',
    authVersion: 1, createdAtMs: 0, expiresAtMs: 10000, epoch: 1, nowMs: 1000 }]),
  result([{ id: 'principal-1', kind: 'human', status: 'active', humanStatus: 'active' }]),
  result(policy().contexts), result([{ id: 'administrator' }]), result([]),
  result([{ roleId: 'administrator', permissionId: 'creezio.access:manage' }]), result([]),
  result(policy().memberships), result(policy().assignments), result([]),
];
function fakeDatabase(batchImpl) {
  let prepareCalls = 0, batchCalls = 0;
  return {
    db: { prepare(sql) { prepareCalls++; return { bind(...parameters) { return { sql, parameters }; } }; },
      async batch(statements) { batchCalls++; return batchImpl(statements); } },
    prepareCalls: () => prepareCalls, batchCalls: () => batchCalls,
  };
}

test('authorization store rejects malformed credentials and executable commit inputs before SQL', async () => {
  const fake = fakeDatabase(() => { throw new Error('Unexpected I/O'); }), store = createD1AuthorizationStore(fake.db);
  for (const value of [null, undefined, {}, 'raw-token', `${digest}\n`, `sha256:${'A'.repeat(64)}`]) {
    assert.equal(await store.read(value, 'admin'), null);
  }
  assert.equal(await store.read(digest, 'owner'), null);
  const accessor = commitInput();
  Object.defineProperty(accessor, 'sessionId', { get() { throw new Error('Getter must not run'); }, enumerable: true });
  for (const input of [null, [], accessor, { ...commitInput(), sessionId: 'session-1\n' },
    { ...commitInput(), principalId: 'principal-1\u2028' }, { ...commitInput(), epoch: 0 },
    { ...commitInput(), epoch: Number.MAX_SAFE_INTEGER }, { ...commitInput(), extra: 'admin' },
    { ...commitInput(), policy: null }, { ...commitInput(), beforePolicy: null },
    { ...commitInput(), beforePolicy: undefined },
    Object.fromEntries(Object.entries(commitInput()).filter(([key])=>key!=='beforePolicy'))]) {
    await assert.rejects(store.commitPolicy(input), AuthorizationStoreInputError);
  }
  assert.equal(fake.prepareCalls(), 0);
  assert.equal(fake.batchCalls(), 0);
});

test('authorization state is assembled from exactly one bounded batch and omits secret session data', async () => {
  const stored = rows();
  stored[0].results[0].secret_hash = 'synthetic-sensitive-value';
  const fake = fakeDatabase(statements => { assert.equal(statements.length, 10); return stored; });
  const state = await createD1AuthorizationStore(fake.db).read(digest, 'admin');
  assert.equal(fake.batchCalls(), 1);
  assert.deepEqual(state.policy, policy());
  assert.equal(state.epoch, 1);
  assert.equal(state.nowMs, 1000);
  assert.equal('secret_hash' in state.session, false);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.session), true);
  assert.equal(Object.isFrozen(state.principals), true);
  assert.equal(Object.isFrozen(state.principals[0]), true);
  assert.equal(Object.isFrozen(state.policy.roles[0]), true);
});

test('a missing live session yields no state or inferred administrator', async () => {
  const stored = rows(); stored[0] = result([]);
  const fake = fakeDatabase(() => stored);
  assert.equal(await createD1AuthorizationStore(fake.db).read(digest, 'admin'), null);
});

test('overflow, orphaned roles, inconsistent principals and expired projections fail closed', async () => {
  const changes = [
    stored => { stored[1] = result(Array.from({ length: 1025 }, (_, n) => ({ id: `principal-${n}`, kind: 'human', status: 'active', humanStatus: 'active' }))); },
    stored => { stored[4] = result([{ roleId: 'absent-role', parentRoleId: 'administrator' }]); },
    stored => { stored[1].results[0].id = 'different-principal'; },
    stored => { stored[0].results[0].expiresAtMs = 1000; },
    stored => { stored[1].results[0].status = 'unknown'; },
    stored => { stored[6] = result([{ roleId: 'administrator', permissionId: 'creezio.access:manage', effect: 'unknown' }]); },
  ];
  for (const change of changes) {
    const stored = rows(); change(stored);
    const fake = fakeDatabase(() => stored);
    await assert.rejects(createD1AuthorizationStore(fake.db).read(digest, 'admin'), AuthorizationStoreError);
  }
});

test('unsuccessful, incomplete and vendor-failed batches never become a successful authorization state', async () => {
  const sensitive = 'synthetic-sensitive-vendor-diagnostic';
  const failures = [() => { throw new Error(sensitive); }, () => rows().slice(1), () => {
    const stored = rows(); stored[4].success = false; return stored;
  }];
  for (const failure of failures) {
    const fake = fakeDatabase(failure);
    await assert.rejects(createD1AuthorizationStore(fake.db).read(digest, 'admin'), error =>
      error instanceof AuthorizationStoreError && !String(error).includes(sensitive) && !('cause' in error));
  }
});

test('commit result depends on both claim acquisition and matching epoch write, never an UPDATE-zero assumption', async () => {
  for (const acquired of [0, 1]) {
    const fake = fakeDatabase(statements => statements.map((_, index) => result([],
      index === 0 || index >= statements.length - 2 ? acquired : 0)));
    assert.equal(await createD1AuthorizationStore(fake.db).commitPolicy(commitInput()), acquired === 1);
    assert.equal(fake.batchCalls(), 1);
    assert.ok(fake.prepareCalls() < 50);
  }
  const fake = fakeDatabase(statements => statements.map((_, index) => result([], index === 0 ? 1 : 0)));
  await assert.rejects(createD1AuthorizationStore(fake.db).commitPolicy(commitInput()), AuthorizationStoreError);
});
