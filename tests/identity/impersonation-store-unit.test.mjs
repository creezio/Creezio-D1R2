import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1ImpersonationStore, ImpersonationStoreInputError, ImpersonationStoreError,
  decodeImpersonationMeta, copyImpersonationPermissions, validImpersonationReason } from '../../core/identity/impersonation-store.ts';
import { createD1AuthorizationStore, AuthorizationStoreError } from '../../core/authorization/d1-store.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const guard = () => ({ sessionDigest: digest, sessionId: 'source-session', principalId: 'source-human', epoch: 4 });
const input = () => ({ digest, subjectPrincipalId: 'subject-human', subjectAuthVersion: 2, subjectAccountVersion: 3,
  subjectCredentialVersion: 4, contextId: 'shop', audience: 'app', permissionIds: ['shop.catalogue:read'], reason: 'Support requested', ttlMs: 10000 });
const result = (results = [], changes = 0) => ({ success: true, results, meta: { changes } });
function fakeDatabase(run) {
  const calls = [];
  return { calls, db: { prepare: sql => ({ bind: (...values) => ({ sql, values }) }), batch: async statements => {
    calls.push(statements); return run(statements, calls.length);
  } } };
}
function forbiddenDatabase() {
  let calls = 0;
  return { db: { prepare() { calls++; throw new Error('Unexpected SQL'); }, batch() { calls++; throw new Error('Unexpected SQL'); } }, calls: () => calls };
}
function meta(id = 'impersonation-1') {
  return { id, actorPrincipalId: 'source-human', subjectPrincipalId: 'subject-human', sourceSessionId: 'source-session',
    contextId: 'shop', audience: 'app', reason: 'Support requested', createdAtMs: 1000, expiresAtMs: 5000 };
}
function issued(statements, mutate = () => {}) {
  const projected = meta(statements[1].values[0]); mutate(projected);
  return [result([], 1), result([], 1), result([], 1), result([], 1), result([projected])];
}
function authorizationRows({ impersonation = false } = {}) {
  const row = { id: 'source-session', principalId: 'source-human', displayName: 'Source', audience: 'admin', authVersion: 1,
    createdAtMs: 0, expiresAtMs: 10000, epoch: 4, nowMs: 1000,
    subjectId: 'subject-human', subjectDisplayName: 'Subject', subjectAuthVersion: 2,
    subjectAccountVersion: 3, subjectCredentialVersion: 4, subjectCredentialExpiresAtMs: null };
  if (impersonation) Object.assign(row, { impersonationId: 'impersonation-1', contextId: 'shop', impersonationAudience: 'app',
    reason: 'Support requested', impersonationCreatedAtMs: 1000, impersonationExpiresAtMs: 5000 });
  const rows = [result([row]),
    result(['source-human', 'subject-human'].map(id => ({ id, kind: 'human', status: 'active', humanStatus: 'active' }))),
    result([{ id: 'application', status: 'active' }, { id: 'shop', status: 'active' }]),
    result([{ id: 'support' }, { id: 'buyer' }]), result(),
    result([{ roleId: 'support', permissionId: 'creezio.access:impersonate' }, { roleId: 'buyer', permissionId: 'shop.catalogue:read' }]), result(),
    result([{ principalId: 'source-human', contextId: 'application', audience: 'admin', status: 'active' },
      { principalId: 'subject-human', contextId: 'shop', audience: 'app', status: 'active' }]),
    result([{ principalId: 'source-human', contextId: 'application', audience: 'admin', roleId: 'support' },
      { principalId: 'subject-human', contextId: 'shop', audience: 'app', roleId: 'buyer' }]), result(),
  ];
  if (impersonation) rows.push(result([{ permissionId: 'shop.catalogue:read' }]));
  return rows;
}

test('impersonation store rejects executable or malformed inputs before database access', async () => {
  const fake = forbiddenDatabase(), store = createD1ImpersonationStore(fake.db);
  const accessor = input(); Object.defineProperty(accessor, 'reason', { enumerable: true, get() { assert.fail('No getter execution'); } });
  const permissions = []; Object.defineProperty(permissions, '0', { enumerable: true, get() { assert.fail('No array getter execution'); } });
  const derived = ['shop.catalogue:read']; Object.setPrototypeOf(derived, Object.create(Array.prototype));
  const sparse = new Array(1);
  for (const value of [null, accessor, { ...input(), digest: 'clear-token' }, { ...input(), subjectPrincipalId: 'subject\n' },
    { ...input(), subjectAuthVersion: 0 }, { ...input(), subjectAccountVersion: Infinity }, { ...input(), subjectCredentialVersion: 1.5 },
    { ...input(), contextId: 'shop\u2028' }, { ...input(), audience: 'public' }, { ...input(), ttlMs: 999 }, { ...input(), ttlMs: 900001 },
    { ...input(), permissionIds: permissions }, { ...input(), permissionIds: derived }, { ...input(), permissionIds: sparse },
    { ...input(), permissionIds: [] }, { ...input(), permissionIds: Array.from({ length: 65 }, (_, n) => `shop.catalogue:read-${n}`) },
    { ...input(), permissionIds: ['shop.catalogue:read', 'shop.catalogue:read'] },
    { ...input(), permissionIds: ['creezio.access:manage'] }, { ...input(), permissionIds: ['creezio.access:impersonate'] },
    { ...input(), permissionIds: ['shop.catalogue:read\n'] }, { ...input(), extra: true }]) {
    await assert.rejects(store.start(guard(), value), ImpersonationStoreInputError);
  }
  for (const value of [null, { ...guard(), epoch: 0 }, { ...guard(), principalId: 'source\r' },
    { ...guard(), sessionDigest: 'secret' }, { ...guard(), sessionId: 'source\u2029' }])
    await assert.rejects(store.start(value, input()), ImpersonationStoreInputError);
  assert.equal(await store.stop('clear-token'), false);
  assert.equal(fake.calls(), 0);
});

test('reason and permissions share exact UTF-8 and closed list bounds with the service', () => {
  for (const reason of ['a'.repeat(500), 'é'.repeat(250), '🙂'.repeat(125)]) assert.equal(validImpersonationReason(reason), true);
  for (const reason of ['', ' a', 'a ', 'é'.repeat(251), '🙂'.repeat(126), 'a\u0000', 'a\n', 'a\u0085', 'a\u2029', '\ud800'])
    assert.equal(validImpersonationReason(reason), false);
  const source = ['shop.catalogue:write', 'shop.catalogue:read'];
  const copied = copyImpersonationPermissions(source); source[0] = 'creezio.access:manage';
  assert.deepEqual(copied, ['shop.catalogue:read', 'shop.catalogue:write']); assert.ok(Object.isFrozen(copied));
});

test('self-impersonation is rejected without I/O and a zero acquired claim has no successful result', async () => {
  const forbidden = forbiddenDatabase();
  assert.equal(await createD1ImpersonationStore(forbidden.db).start(guard(), { ...input(), subjectPrincipalId: 'source-human' }), null);
  assert.equal(forbidden.calls(), 0);
  const empty = fakeDatabase(statements => statements.map(() => result()));
  assert.equal(await createD1ImpersonationStore(empty.db).start(guard(), input()), null);
  assert.equal(await createD1ImpersonationStore(empty.db).stop(digest), false);
});

test('issuance captures scalar and scope inputs before I/O and returns immutable safe metadata', async () => {
  const authority = guard(), source = input(); let finish, statements;
  const fake = fakeDatabase(value => { statements = value; return new Promise(resolve => { finish = resolve; }); });
  const pending = createD1ImpersonationStore(fake.db).start(authority, source);
  authority.epoch = 900; authority.principalId = 'changed'; source.permissionIds[0] = 'creezio.access:manage'; source.reason = 'Changed';
  const values = statements.flatMap(statement => statement.values);
  assert.ok(values.includes('["shop.catalogue:read"]')); assert.ok(values.includes('Support requested'));
  assert.equal(values.includes('changed'), false); assert.equal(values.includes('Changed'), false);
  finish(issued(statements, row => { row.secret_hash = 'synthetic-private'; row.revocation_nonce = 'synthetic-private'; }));
  const projection = await pending;
  assert.deepEqual(projection, { ...meta(statements[1].values[0]), permissionIds: ['shop.catalogue:read'] });
  assert.ok(Object.isFrozen(projection) && Object.isFrozen(projection.permissionIds));
  assert.equal(JSON.stringify(projection).includes('synthetic-private'), false);
});

test('incomplete, inconsistent or malformed issuance results fail closed', async () => {
  const cases = [
    statements => issued(statements).slice(1),
    statements => { const rows = issued(statements); rows[2].meta.changes = 0; return rows; },
    statements => { const rows = issued(statements); rows[3].success = false; return rows; },
    statements => issued(statements, row => { row.subjectPrincipalId = 'other-human'; }),
    statements => issued(statements, row => { row.expiresAtMs = row.createdAtMs; }),
    statements => issued(statements, row => { row.expiresAtMs = row.createdAtMs + 900001; }),
  ];
  for (const run of cases) await assert.rejects(createD1ImpersonationStore(fakeDatabase(run).db).start(guard(), input()), ImpersonationStoreError);
});

test('stop reports one winner only when both ending and its historical audit succeed', async () => {
  for (const changed of [0, 1]) {
    const fake = fakeDatabase(() => [result([], changed), result([], changed)]);
    assert.equal(await createD1ImpersonationStore(fake.db).stop(digest), changed === 1);
    assert.equal(fake.calls.length, 1);
  }
  for (const changes of [[1, 0], [0, 1], [2, 2]]) {
    await assert.rejects(createD1ImpersonationStore(fakeDatabase(() => changes.map(n => result([], n))).db).stop(digest), ImpersonationStoreError);
  }
});

test('vendor storage failures are redacted at preparation, binding and execution', async () => {
  const diagnostic = 'synthetic-secret-vendor-diagnostic';
  for (const phase of ['prepare', 'bind', 'batch']) {
    const db = { prepare() { if (phase === 'prepare') throw new Error(diagnostic);
      return { bind() { if (phase === 'bind') throw new Error(diagnostic); return {}; } }; }, batch() { throw new Error(diagnostic); } };
    for (const invoke of [store => store.start(guard(), input()), store => store.stop(digest)]) {
      await assert.rejects(invoke(createD1ImpersonationStore(db)), error => error instanceof ImpersonationStoreError
        && !String(error).includes(diagnostic) && !('cause' in error));
    }
  }
});

test('source, target and ACLs are read in one bounded batch without synthesizing a target session', async () => {
  for (const impersonation of [false, true]) {
    const stored = authorizationRows({ impersonation }); stored[0].results[0].password_record = 'synthetic-private';
    const fake = fakeDatabase(statements => { assert.equal(statements.length, impersonation ? 11 : 10); return stored; });
    const store = createD1AuthorizationStore(fake.db);
    const state = impersonation ? await store.readImpersonation(digest) : await store.readForImpersonation(digest, 'subject-human', 'shop', 'app');
    assert.equal(fake.calls.length, 1); assert.equal(state.epoch, 4);
    assert.equal(state.session.principalId, 'source-human'); assert.equal(state.session.id, 'source-session');
    assert.deepEqual(state.subject, { id: 'subject-human', displayName: 'Subject', authVersion: 2,
      accountVersion: 3, credentialVersion: 4, credentialExpiresAtMs: null });
    assert.equal('session' in state.subject, false); assert.equal('audience' in state.subject, false);
    assert.equal(JSON.stringify(state).includes('synthetic-private'), false);
    assert.ok(Object.isFrozen(state) && Object.isFrozen(state.subject) && Object.isFrozen(state.session));
    if (impersonation) assert.deepEqual(state.impersonation, { ...meta(), permissionIds: ['shop.catalogue:read'] });
  }
});

test('malformed impersonation reads do not access SQL and missing authority yields no substitute', async () => {
  const fake = forbiddenDatabase(), store = createD1AuthorizationStore(fake.db);
  assert.equal(await store.readForImpersonation('token', 'subject-human', 'shop', 'app'), null);
  assert.equal(await store.readForImpersonation(digest, 'subject\n', 'shop', 'app'), null);
  assert.equal(await store.readForImpersonation(digest, 'subject-human', 'shop\u2028', 'app'), null);
  assert.equal(await store.readForImpersonation(digest, 'subject-human', 'shop', 'public'), null);
  assert.equal(await store.readImpersonation(`${digest}\n`), null); assert.equal(fake.calls(), 0);
  for (const impersonation of [false, true]) {
    const rows = authorizationRows({ impersonation }); rows[0] = result();
    const absent = createD1AuthorizationStore(fakeDatabase(() => rows).db);
    assert.equal(impersonation ? await absent.readImpersonation(digest) : await absent.readForImpersonation(digest, 'subject-human', 'shop', 'app'), null);
  }
});

test('inconsistent target identities, stale deadlines and oversized stored permission ceilings fail closed', async () => {
  const mutations = [
    rows => { rows[0].results[0].subjectId = 'source-human'; },
    rows => { rows[0].results[0].subjectAuthVersion = 0; },
    rows => { rows[0].results[0].subjectCredentialExpiresAtMs = 1000; },
    rows => { rows[0].results[0].audience = 'app'; },
    rows => { rows[1].results[1].kind = 'service'; },
    rows => { rows[1].results[1].humanStatus = 'pending'; },
    rows => { rows[1].results.pop(); },
    rows => { rows[0].results[0].impersonationExpiresAtMs = 1000; },
    rows => { rows[10].results.push({ permissionId: 'shop.catalogue:read' }); },
    rows => { rows[10].results = [{ permissionId: 'creezio.access:manage' }]; },
    rows => { rows[10].results = Array.from({ length: 65 }, (_, n) => ({ permissionId: `shop.catalogue:read-${n}` })); },
  ];
  for (const mutate of mutations) {
    const rows = authorizationRows({ impersonation: true }); mutate(rows);
    await assert.rejects(createD1AuthorizationStore(fakeDatabase(() => rows).db).readImpersonation(digest), AuthorizationStoreError);
  }
  assert.equal(decodeImpersonationMeta({ ...meta(), actorPrincipalId: 'subject-human' }, ['shop.catalogue:read']), null);
});
