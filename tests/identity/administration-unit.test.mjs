import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1AccountAdministrationStore, AdministrationStoreInputError, AdministrationStoreError,
  ADMINISTRATION_STORE_LIMITS } from '../../core/identity/administration-store.ts';
import { createAccountAdministrationService } from '../../core/identity/administration.ts';
import { issueOpaqueToken } from '../../core/identity/tokens.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const guard = () => ({ sessionDigest: digest, sessionId: 'session-admin', principalId: 'administrator', epoch: 1 });
const principalPage = () => ({ afterId: null, limit: 2, kind: 'all' });
const sessionPage = () => ({ principalId: 'human-1', afterId: null, limit: 2 });
const version = () => ({ principalId: 'human-1', expectedAuthVersion: 1 });
const status = () => ({ ...version(), status: 'disabled' });
const result = (rows = [], changes = 0) => ({ success: true, results: rows, meta: { changes } });
const principal = id => ({ id, kind: 'human', displayName: 'Synthetic human', status: 'active', authVersion: 1,
  humanStatus: 'pending', loginIdentifier: `${id}@example.invalid`, createdAtMs: 1000 });
const session = id => ({ id, audience: 'app', createdAtMs: 1000, expiresAtMs: 5000, revokedAtMs: null, active: 1 });
function fakeDatabase(run) {
  const calls = [];
  return { db: { prepare: sql => ({ bind: (...values) => ({ sql, values }) }), batch: async statements => {
    calls.push(statements); return run(statements, calls.length);
  } }, calls };
}
function forbiddenDatabase() {
  let calls = 0;
  return { db: { prepare() { calls++; throw new Error('Unexpected SQL'); }, batch() { calls++; throw new Error('Unexpected SQL'); } }, calls: () => calls };
}
function authorizationRows({ grant = true } = {}) {
  return [
    result([{ id: 'session-admin', principalId: 'administrator', displayName: 'Synthetic administrator', audience: 'admin',
      authVersion: 1, createdAtMs: 0, expiresAtMs: 10000, epoch: 1, nowMs: 1000 }]),
    result([{ id: 'administrator', kind: 'human', status: 'active', humanStatus: 'active' }]),
    result([{ id: 'application', status: 'active' }]), result([{ id: 'administrator' }]), result([]),
    result(grant ? [{ roleId: 'administrator', permissionId: 'creezio.access:manage' }] : []), result([]),
    result([{ principalId: 'administrator', contextId: 'application', audience: 'admin', status: 'active' }]),
    result([{ principalId: 'administrator', contextId: 'application', audience: 'admin', roleId: 'administrator' }]), result([]),
  ];
}
const throttleRows = attempts => [result(), result([{ attempts, retryAtMs: 100000 }])];

test('administration store rejects malformed guard and input data before database access', async () => {
  const fake = forbiddenDatabase(), store = createD1AccountAdministrationStore(fake.db);
  const getter = guard(); Object.defineProperty(getter, 'epoch', { enumerable: true, get() { assert.fail('Getter must not execute'); } });
  for (const value of [null, [], getter, { ...guard(), epoch: 0 }, { ...guard(), sessionDigest: 'clear-token' },
    { ...guard(), sessionId: 'session\n' }, { ...guard(), principalId: 'administrator\u2028' }, { ...guard(), owner: true }]) {
    await assert.rejects(store.listPrincipals(value, principalPage()), AdministrationStoreInputError);
    await assert.rejects(store.listSessions(value, sessionPage()), AdministrationStoreInputError);
    await assert.rejects(store.setHumanStatus(value, status()), AdministrationStoreInputError);
    await assert.rejects(store.revokeAllHumanSessions(value, version()), AdministrationStoreInputError);
    await assert.rejects(store.revokeSessionById(value, { sessionId: 'session-1' }), AdministrationStoreInputError);
  }
  for (const input of [null, { ...principalPage(), limit: 0 }, { ...principalPage(), limit: 51 },
    { ...principalPage(), limit: 1.5 }, { ...principalPage(), kind: 'owner' }, { ...principalPage(), afterId: 'cursor\n' },
    { ...principalPage(), total: true }]) await assert.rejects(store.listPrincipals(guard(), input), AdministrationStoreInputError);
  for (const input of [null, { ...sessionPage(), principalId: 'human\r' }, { ...sessionPage(), afterId: '' }])
    await assert.rejects(store.listSessions(guard(), input), AdministrationStoreInputError);
  for (const input of [null, { ...version(), expectedAuthVersion: Number.MAX_SAFE_INTEGER }, { ...version(), expectedAuthVersion: Infinity }])
    await assert.rejects(store.revokeAllHumanSessions(guard(), input), AdministrationStoreInputError);
  await assert.rejects(store.setHumanStatus(guard(), { ...status(), status: 'pending' }), AdministrationStoreInputError);
  assert.equal(fake.calls(), 0);
});

test('principal pagination uses a sentinel, returns the last delivered cursor and projects only administrative fields', async () => {
  assert.deepEqual(ADMINISTRATION_STORE_LIMITS, { maximumPageSize: 50, sessionMarkers: 32, capabilityMarkers: 8 });
  const source = ['a', 'b', 'c'].map(id => ({ ...principal(id), secret_hash: 'synthetic-private-hash', password_record: 'synthetic-private-phc' }));
  const fake = fakeDatabase(statements => { assert.equal(statements.length, 2); return [result([{ allowed: 1 }]), result(source)]; });
  const page = await createD1AccountAdministrationStore(fake.db).listPrincipals(guard(), principalPage());
  assert.deepEqual(page, { items: [principal('a'), principal('b')], nextAfterId: 'b' });
  assert.ok(Object.isFrozen(page) && Object.isFrozen(page.items) && Object.isFrozen(page.items[0]));
  assert.equal(JSON.stringify(page).includes('synthetic-private'), false);
  const tail = fakeDatabase(() => [result([{ allowed: 1 }]), result([principal('c')])]);
  assert.deepEqual(await createD1AccountAdministrationStore(tail.db).listPrincipals(guard(), { afterId: 'b', limit: 2, kind: 'human' }),
    { items: [principal('c')], nextAfterId: null });
});

test('principal projections preserve supported human activation states and reject inconsistent service metadata', async () => {
  const make = row => createD1AccountAdministrationStore(fakeDatabase(() => [result([{ allowed: 1 }]), result([row])]).db);
  for (const humanStatus of ['active', 'pending', 'disabled']) {
    const row = { ...principal('a'), humanStatus };
    assert.deepEqual((await make(row).listPrincipals(guard(), principalPage())).items, [row]);
  }
  const service = { ...principal('a'), kind: 'service', humanStatus: null, loginIdentifier: null };
  assert.deepEqual((await make(service).listPrincipals(guard(), principalPage())).items, [service]);
  const coercible = { toString() { assert.fail('No coercion of stored data'); } };
  for (const row of [{ ...principal('a'), humanStatus: null }, { ...principal('a'), humanStatus: coercible },
    { ...principal('a'), loginIdentifier: 'MixedCase@Example.invalid' }, { ...service, humanStatus: 'active' },
    { ...service, loginIdentifier: 'hidden@example.invalid' }]) await assert.rejects(make(row).listPrincipals(guard(), principalPage()), AdministrationStoreError);
});

test('session projections return only metadata and a boolean active state', async () => {
  const rows = [{ ...session('a'), secret_hash: 'private', active: 0 }, { ...session('b'), active: 1 }];
  const store = createD1AccountAdministrationStore(fakeDatabase(() => [result([{ allowed: 1 }]), result(rows)]).db);
  assert.deepEqual(await store.listSessions(guard(), sessionPage()), { items: [
    { ...session('a'), active: false }, { ...session('b'), active: true },
  ], nextAfterId: null });
  const malformed = createD1AccountAdministrationStore(fakeDatabase(() => [result([{ allowed: 1 }]), result([{ ...session('a'), active: 'true' }])]).db);
  await assert.rejects(malformed.listSessions(guard(), sessionPage()), AdministrationStoreError);
});

test('missing authority returns no page and malformed, out-of-order or oversized pages fail closed', async () => {
  const absent = createD1AccountAdministrationStore(fakeDatabase(() => [result(), result([principal('a')])]).db);
  assert.equal(await absent.listPrincipals(guard(), principalPage()), null);
  for (const rows of [[], [result([{ allowed: 1 }, { allowed: 1 }]), result()],
    [result([{ allowed: 0 }]), result()], [result([{ allowed: 1 }]), result([principal('b'), principal('a')])],
    [result([{ allowed: 1 }]), result([principal('a'), principal('a')])],
    [result([{ allowed: 1 }]), result(['a', 'b', 'c', 'd'].map(principal))]]) {
    await assert.rejects(createD1AccountAdministrationStore(fakeDatabase(() => rows).db).listPrincipals(guard(), principalPage()), AdministrationStoreError);
  }
  const staleCursor = createD1AccountAdministrationStore(fakeDatabase(() => [result([{ allowed: 1 }]), result([principal('a')])]).db);
  await assert.rejects(staleCursor.listPrincipals(guard(), { ...principalPage(), afterId: 'b' }), AdministrationStoreError);
});

test('self-disable is refused without SQL and a zero claim never reports a mutation', async () => {
  const forbidden = forbiddenDatabase(), store = createD1AccountAdministrationStore(forbidden.db);
  assert.equal(await store.setHumanStatus(guard(), { principalId: 'administrator', expectedAuthVersion: 1, status: 'disabled' }), null);
  assert.equal(forbidden.calls(), 0);
  const empty = createD1AccountAdministrationStore(fakeDatabase(statements => statements.map(() => result())).db);
  assert.equal(await empty.setHumanStatus(guard(), status()), null);
  assert.equal(await empty.revokeAllHumanSessions(guard(), version()), null);
  assert.equal(await empty.revokeSessionById(guard(), { sessionId: 'session-1' }), false);
  const mismatch = createD1AccountAdministrationStore(fakeDatabase(statements => statements.map((_, i) => result([], i === 0 ? 1 : 0))).db);
  await assert.rejects(mismatch.revokeSessionById(guard(), { sessionId: 'session-1' }), AdministrationStoreError);
});

test('guard and pagination scalars are captured before asynchronous database work', async () => {
  const authority = guard(), input = principalPage(); let finish, received;
  const fake = fakeDatabase(statements => { received = statements; return new Promise(resolve => { finish = resolve; }); });
  const pending = createD1AccountAdministrationStore(fake.db).listPrincipals(authority, input);
  authority.principalId = 'different-admin'; authority.epoch = 55; input.afterId = 'later'; input.limit = 50; input.kind = 'service';
  const values = received.flatMap(statement => statement.values);
  assert.ok(values.includes('administrator')); assert.ok(values.includes(3));
  assert.equal(values.includes('different-admin'), false); assert.equal(values.includes('later'), false);
  finish([result([{ allowed: 1 }]), result([principal('a')])]);
  assert.deepEqual(await pending, { items: [principal('a')], nextAfterId: null });
});

test('administration storage errors are redacted regardless of SQL failure phase', async () => {
  const diagnostic = 'synthetic-private-vendor-diagnostic';
  for (const phase of ['prepare', 'bind', 'batch']) {
    const db = { prepare() { if (phase === 'prepare') throw new Error(diagnostic);
      return { bind() { if (phase === 'bind') throw new Error(diagnostic); return {}; } }; }, batch() { throw new Error(diagnostic); } };
    await assert.rejects(createD1AccountAdministrationStore(db).listPrincipals(guard(), principalPage()), error =>
      error instanceof AdministrationStoreError && !String(error).includes(diagnostic) && !('cause' in error));
  }
});

test('the service has exactly the five agreed operations and rejects malformed input without I/O', async () => {
  const fake = forbiddenDatabase(), service = createAccountAdministrationService(fake.db, { permissions: [] });
  assert.deepEqual(Object.keys(service).sort(), ['listPrincipals', 'listSessions', 'revokeAllHumanSessions', 'revokeSessionById', 'setHumanStatus'].sort());
  const getter = principalPage(); Object.defineProperty(getter, 'kind', { enumerable: true, get() { assert.fail('Getter must not execute'); } });
  for (const [method, value] of [['listPrincipals', getter], ['listPrincipals', { ...principalPage(), limit: 51 }],
    ['listPrincipals', { ...principalPage(), kind: 'owner' }], ['listSessions', { ...sessionPage(), principalId: 'a\n' }],
    ['setHumanStatus', { ...status(), expectedAuthVersion: Number.MAX_SAFE_INTEGER }],
    ['revokeAllHumanSessions', { ...version(), expectedAuthVersion: 0 }], ['revokeSessionById', { sessionId: 'a\r' }]]) {
    assert.deepEqual(await service[method]('irrelevant', value), { ok: false, error: 'invalid_input' });
    assert.deepEqual(await service[method]('irrelevant', null), { ok: false, error: 'invalid_input' });
  }
  assert.equal(fake.calls(), 0);
});

test('service admission requires native permission and stops immediately at the first exhausted quota', async () => {
  const token = (await issueOpaqueToken('session')).token;
  for (const mode of ['forbidden', 'global', 'actor']) {
    const fake = fakeDatabase((_, call) => {
      if (call === 1) return authorizationRows({ grant: mode !== 'forbidden' });
      if (call === 2) return throttleRows(mode === 'global' ? 61 : 1);
      if (call === 3 && mode === 'actor') return throttleRows(21);
      assert.fail('No page or mutation may follow failed admission');
    });
    assert.deepEqual(await createAccountAdministrationService(fake.db, { permissions: [] }).listPrincipals(token, principalPage()),
      { ok: false, error: mode === 'forbidden' ? 'forbidden' : 'rate_limited' });
    assert.equal(fake.calls.length, mode === 'forbidden' ? 1 : mode === 'global' ? 2 : 3);
  }
  const unauthorized = fakeDatabase(() => { const rows = authorizationRows(); rows[0] = result(); return rows; });
  assert.deepEqual(await createAccountAdministrationService(unauthorized.db, { permissions: [] }).listPrincipals(token, principalPage()),
    { ok: false, error: 'unauthorized' });
  assert.equal(unauthorized.calls.length, 1);
});

test('the service returns a flat safe page and cannot change its captured query during authorization', async () => {
  const token = (await issueOpaqueToken('session')).token, input = principalPage(); let projected;
  const fake = fakeDatabase((statements, call) => {
    if (call === 1) { input.limit = 50; input.afterId = 'changed'; input.kind = 'service'; return authorizationRows(); }
    if (call === 2 || call === 3) return throttleRows(1);
    projected = statements;
    return [result([{ allowed: 1 }]), result([principal('a'), principal('b'), principal('c')])];
  });
  const page = await createAccountAdministrationService(fake.db, { permissions: [] }).listPrincipals(token, input);
  assert.deepEqual(page, { ok: true, items: [principal('a'), principal('b')], nextAfterId: 'b' });
  assert.equal('page' in page, false);
  const values = projected.flatMap(statement => statement.values);
  assert.equal(values.includes('changed'), false); assert.equal(values.includes('service'), false); assert.ok(values.includes(3));
});

test('service storage failures return the uniform safe error rather than database details', async () => {
  const fake = fakeDatabase(() => { throw new Error('synthetic-private-diagnostic'); });
  assert.deepEqual(await createAccountAdministrationService(fake.db, { permissions: [] })
    .listPrincipals((await issueOpaqueToken('session')).token, principalPage()), { ok: false, error: 'storage_error' });
});
