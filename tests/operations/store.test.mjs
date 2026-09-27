import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperationFixture, catalog } from './fixtures/identity.mjs';
import { moduleId, actors, permissions } from './fixtures/operations.mjs';
import { createOperationStore } from '../../core/operations/store.ts';
import { OPERATION_TABLES } from '../../core/operations/models.ts';
import { createDataAccess, createDataTransactionExecutor } from '../../core/data/service.ts';

const quote = value => `"${value.replaceAll('"', '""')}"`;
const sha = digit => `sha256:${digit.repeat(64)}`;
const input = key => ({ operationId: 'create_record', operationVersion: '1.0.0', keyHash: sha(key), inputHash: sha('f'), claimTtlMs: 30_000, retentionMs: 86_400_000 });
const target = { contextId: 'application', audience: 'admin', actors, requiredPermissionIds: [`${moduleId}:edit`], purpose: 'operation' };
const validOutput = Object.freeze({ accepted: true });

test('delivery settlement rejects coercible non-scalar state before reading a claim or the database', async () => {
  const db = { prepare() { assert.fail('No SQL before input validation'); }, batch() { assert.fail('No batch before input validation'); } };
  const store = createOperationStore({ db, data: createDataAccess(db, { catalog, permissions }) });
  for (const state of [['succeeded'], { state: 'succeeded' }, true, 1, null])
    await assert.rejects(store.settleDelivery({ kind: 'data-lease' }, { kind: 'operation-delivery-claim' }, { state }), { code: 'invalid_input' });
});

test('durable host store shares the real credential guard and business transaction', async t => {
  const fixture = await createOperationFixture();
  try {
    const { db, data } = fixture, store = createOperationStore({ db, data });
    const authorize = (credential = fixture.credentials.session, access = data) => access.authorize(credential, target, { moduleId });
    await t.test('scope claim has one winner; same key cannot be reissued after a version update', async () => {
      const lease = await authorize(), results = await Promise.all([store.start(lease, input('1')), store.start(lease, input('1'))]);
      assert.deepEqual(results.map(result => result.kind).sort(), ['acquired', 'existing']);
      const acquired = results.find(result => result.kind === 'acquired');
      const plan = data.forModule(lease, moduleId).planCreate('record', { values: { id: 'first', title: 'First', revision: 0 } });
      const done = await store.commit(lease, acquired.claim, { plans: [plan], output: validOutput });
      assert.equal(done.state, 'succeeded'); assert.equal(await fixture.countRecords(), 1);
      const replay = await store.start(lease, input('1')); assert.equal(replay.kind, 'existing'); assert.equal(replay.execution.output.accepted, true);
      await assert.rejects(store.start(lease, { ...input('1'), inputHash: sha('e') }), { code: 'conflict' });
      await assert.rejects(store.start(lease, { ...input('1'), operationVersion: '2.0.0' }), { code: 'conflict' });
      await assert.rejects(store.commit(lease, acquired.claim, { plans: [], output: validOutput }), { code: 'invalid_claim' });
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${quote(OPERATION_TABLES.attempts)} WHERE execution_id=?`).bind(done.id).first()).n, 1);
    });
    await t.test('late audit failure rolls back business writes, result and outbox together', async () => {
      const lease = await authorize(), started = await store.start(lease, input('2'));
      await db.prepare(`CREATE TRIGGER qualification_fail_operation_audit BEFORE INSERT ON ${quote(OPERATION_TABLES.audit)}
        WHEN NEW.event='committed' BEGIN SELECT RAISE(ABORT,'qualification'); END`).run();
      try {
        const plan = data.forModule(lease, moduleId).planCreate('record', { values: { id: 'rollback', title: 'Never stored', revision: 0 } });
        await assert.rejects(store.commit(lease, started.claim, { plans: [plan], output: validOutput,
          outbox: [{ id: 'notice', provider: 'synthetic-provider', payload: { recordId: 'rollback' }, providerIdempotencyKey: 'provider-key-rollback' }] }), { code: 'unavailable' });
        assert.equal(await fixture.record('rollback'), null);
        assert.equal((await store.read(lease, started.execution.id)).state, 'running');
        assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${quote(OPERATION_TABLES.outbox)} WHERE execution_id=?`).bind(started.execution.id).first()).n, 0);
      } finally { await db.prepare('DROP TRIGGER qualification_fail_operation_audit').run(); }
    });
    await t.test('unknown acknowledgement is reconciled by a guarded read, never by replaying plans', async () => {
      let loseResponse = false;
      const wrapped = { prepare: db.prepare.bind(db), async batch(statements) { const rows = await db.batch(statements);
        if (loseResponse) { loseResponse = false; throw new Error('Simulated lost acknowledgement'); } return rows; } };
      const isolatedData = fixture.createData(wrapped), isolatedStore = createOperationStore({ db: wrapped, data: isolatedData });
      const lease = await authorize(fixture.credentials.session, isolatedData), started = await isolatedStore.start(lease, input('3'));
      const plan = isolatedData.forModule(lease, moduleId).planCreate('record', { values: { id: 'ack-lost', title: 'Committed once', revision: 0 } });
      loseResponse = true;
      await assert.rejects(isolatedStore.commit(lease, started.claim, { plans: [plan], output: validOutput }), { code: 'unavailable' });
      assert.equal((await isolatedStore.read(lease, started.execution.id)).state, 'succeeded');
      await assert.rejects(isolatedStore.commit(lease, started.claim, { plans: [plan], output: validOutput }), { code: 'invalid_claim' });
      assert.equal((await fixture.record('ack-lost')).title, 'Committed once');
      assert.throws(() => createDataTransactionExecutor(isolatedData, db), { code: 'invalid_lease' });
    });
    await t.test('external claim is issued once and uncertainty never requeues a delivery', async () => {
      const lease = await authorize(), started = await store.start(lease, input('4'));
      await store.commit(lease, started.claim, { plans: [], output: validOutput,
        outbox: [{ id: 'notice', provider: 'synthetic-provider', payload: { recordId: 'first' }, providerIdempotencyKey: 'provider-distinct-key' }] });
      const attempt = { executionId: started.execution.id, outboxId: 'notice', claimTtlMs: 1000 };
      const candidates = await Promise.all([store.claimDelivery(lease, attempt), store.claimDelivery(lease, attempt)]);
      assert.equal(candidates.filter(Boolean).length, 1);
      const winner = candidates.find(Boolean); let sent = 0; if (winner) sent++;
      assert.equal(winner.delivery.providerIdempotencyKey, 'provider-distinct-key');
      const unknown = await store.settleDelivery(lease, winner.claim, { state: 'unknown', receipt: { code: 'response-lost' } });
      assert.equal(unknown.state, 'unknown'); assert.equal((await store.read(lease, started.execution.id)).state, 'unknown');
      assert.equal(await store.claimDelivery(lease, attempt), null); assert.equal(sent, 1);
      assert.equal((await store.readDelivery(lease, { executionId: attempt.executionId, outboxId: attempt.outboxId })).payload.recordId, 'first');
    });
    await t.test('expired pure preparation can be resumed explicitly, invalidating the original claim', async () => {
      const lease = await authorize(), started = await store.start(lease, input('5'));
      await db.prepare(`UPDATE ${quote(OPERATION_TABLES.executions)} SET claim_expires_at_ms=0 WHERE id=?`).bind(started.execution.id).run();
      assert.equal((await store.read(lease, started.execution.id)).state, 'unknown');
      const restarted = await store.resume(lease, { executionId: started.execution.id, inputHash: sha('f'), claimTtlMs: 30_000 });
      assert.equal(restarted.kind, 'acquired');
      await assert.rejects(store.commit(lease, started.claim, { plans: [], output: validOutput }), { code: 'unavailable' });
      assert.equal((await store.commit(lease, restarted.claim, { plans: [], output: validOutput })).state, 'succeeded');
      assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${quote(OPERATION_TABLES.attempts)} WHERE execution_id=?`).bind(started.execution.id).first()).n, 2);
    });
    await t.test('an enabled model-free module can receive a lease but never an invented model port', async () => {
      const catalog = structuredClone(fixture.catalog); catalog.modules[0].models = [];
      const noModels = createDataAccess(db, { catalog, permissions }), lease = await authorize(fixture.credentials.session, noModels);
      const noTablesStore = createOperationStore({ db, data: noModels }), started = await noTablesStore.start(lease, input('6'));
      assert.equal((await noTablesStore.commit(lease, started.claim, { plans: [], output: null })).state, 'succeeded');
      assert.throws(() => noModels.forModule(lease, moduleId).planGet('record', { key: { id: 'first' } }), { code: 'forbidden' });
    });
    await t.test('short declared retention does not shorten or silently reissue the execution claim', async () => {
      const lease = await authorize(), started = await store.start(lease, { ...input('a'), retentionMs: 1000 });
      assert.equal(started.kind, 'acquired');
      assert.equal(started.execution.retainedUntilMs - started.execution.createdAtMs, 1000);
      assert.equal(started.execution.claimExpiresAtMs - started.execution.createdAtMs, 30_000);
      await db.prepare(`UPDATE ${quote(OPERATION_TABLES.executions)} SET retained_until_ms=0 WHERE id=?`).bind(started.execution.id).run();
      await assert.rejects(store.start(lease, { ...input('a'), retentionMs: 1000 }), { code: 'conflict' });
      assert.equal((await store.commit(lease, started.claim, { plans: [], output: validOutput })).state, 'succeeded');
    });
    for (const kind of ['session', 'machine', 'impersonation']) await t.test(`fresh ${kind} revocation prevents the durable mutation`, async () => {
      const lease = await authorize(fixture.credentials[kind]), started = await store.start(lease, input(kind === 'session' ? '7' : kind === 'machine' ? '8' : '9'));
      await fixture.revoke(kind);
      await assert.rejects(store.commit(lease, started.claim, { plans: [], output: validOutput }), { code: 'unavailable' });
      assert.equal((await db.prepare(`SELECT state FROM ${quote(OPERATION_TABLES.executions)} WHERE id=?`).bind(started.execution.id).first()).state, 'running');
    });
  } finally { await fixture.dispose(); }
});
