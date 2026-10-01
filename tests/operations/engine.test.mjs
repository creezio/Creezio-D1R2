import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationEngine } from '../../core/operations/service.ts';
import { OPERATION_TABLES } from '../../core/operations/models.ts';
import { createOperationFixture, quote } from './fixtures/identity.mjs';
import { createFixtureRegistry, deferred } from './fixtures/handlers.mjs';
import { moduleId, permissions } from './fixtures/operations.mjs';

const count = async (db, model) => (await db.prepare(`SELECT count(*) AS n FROM ${quote(OPERATION_TABLES[model])}`).first()).n;
const succeeded = result => { assert.equal(result.execution.state, 'succeeded', JSON.stringify(result)); return result; };
async function notConfirmed(operation) {
  try { const result = await operation; assert.notEqual(result.execution.state, 'succeeded'); return result; }
  catch (error) { assert.equal(error.code, 'unknown'); return null; }
}

test('canonical operation engine uses real D1 and native authority across internal channel adapters', { timeout: 60000 }, async t => {
  const fixture = await createOperationFixture();
  const create = async (options, db = fixture.db) => {
    const handlers = await createFixtureRegistry(options);
    return { ...handlers, engine: createOperationEngine({ db, catalog: fixture.catalog, registry: handlers.registry, permissions }) };
  };
  const normal = await create();
  const request = (operationId, input, extra = {}) => ({ credential: fixture.credentials.session, moduleId, operationId,
    contextId: 'application', audience: 'admin', input, ...extra });
  try {
    await t.test('strict input rejects extra fields, wrong types, accessors and unknown operations before effects', async () => {
      const before = await count(fixture.db, 'executions');
      for (const input of [{ id: 'x', title: 'x' }, { id: 7, title: 'x', request_id: 'bad-number' },
        { id: 'x', title: 'x', request_id: 'bad-extra', actor: 'administrator' }, { id: 'x', title: 'x'.repeat(201), request_id: 'too-long' }])
        await assert.rejects(normal.engine.invoke(request('create_record', input)), { code: 'invalid_input' });
      let called = false; const accessor = { id: 'x', request_id: 'getter', get title() { called = true; return 'bad'; } };
      await assert.rejects(normal.engine.invoke(request('create_record', accessor)), { code: 'invalid_input' }); assert.equal(called, false);
      await assert.rejects(normal.engine.invoke(request('missing', {})), { code: 'not_found' });
      assert.equal(await count(fixture.db, 'executions'), before); assert.equal(await fixture.countRecords(), 0);
    });
    await t.test('one command is replayed across channel adapters without repeating its handler', async () => {
      const input = { id: 'record-main', title: 'Initial', request_id: 'create-main' };
      // These are internal adapters, not a claim that HTTP or MCP transports are installed.
      const adapters = { api: command => normal.engine.invoke(command), ui: command => normal.engine.invoke(command), mcp: command => normal.engine.invoke(command), widget: command => normal.engine.invoke(command) };
      const first = succeeded(await adapters.api(request('create_record', input))); assert.equal(first.replayed, false);
      for (const adapter of [adapters.ui, adapters.mcp, adapters.widget]) {
        const replay = succeeded(await adapter(request('create_record', { ...input })));
        assert.equal(replay.execution.id, first.execution.id); assert.equal(replay.replayed, true);
      }
      assert.equal(normal.calls.get('create_record'), 1); assert.equal(await fixture.countRecords(), 1);
      await assert.rejects(normal.engine.invoke(request('create_record', { ...input, title: 'Different hash' })), { code: 'conflict' });
      const status = await normal.engine.status({ credential: fixture.credentials.session, moduleId, operationId: 'create_record',
        contextId: 'application', audience: 'admin', executionId: first.execution.id });
      assert.equal(status.state, 'succeeded');
      assert.equal(JSON.stringify(status).includes(fixture.credentials.session.token), false);
      const foreign = await normal.engine.status({ credential: fixture.credentials.machine, moduleId, operationId: 'create_record',
        contextId: 'application', audience: 'admin', executionId: first.execution.id });
      assert.equal(foreign, null);
    });
    await t.test('queries return validated results for all three identities and cannot write', async () => {
      for (const [kind, credential] of Object.entries(fixture.credentials)) {
        const result = succeeded(await normal.engine.invoke(request('read_record', { id: 'record-main' }, { credential })));
        assert.deepEqual({ ...result.execution.output }, { id: 'record-main', title: 'Initial', revision: 0 });
        const context = normal.contexts.at(-1);
        assert.equal(context.principalId, kind === 'machine' ? fixture.machine.principal.id : fixture.subject.principalId);
        assert.equal(context.actorPrincipalId, kind === 'impersonation' ? fixture.owner.principalId : context.principalId);
        for (const method of ['create', 'patch', 'delete', 'commit', 'execute', 'prepare']) assert.equal(context.keys.includes(method), false);
      }
      const before = await fixture.countRecords();
      const write = await normal.engine.invoke(request('query_write_attempt', { id: 'query-bypass' }));
      assert.equal(write.execution.state, 'failed'); assert.equal(await fixture.countRecords(), before);
      const invalid = await normal.engine.invoke(request('invalid_output', { id: 'record-main' }));
      assert.equal(invalid.execution.state, 'failed'); assert.equal(invalid.execution.errorCode, 'invalid_output');
      assert.equal(JSON.stringify(invalid).includes('synthetic invalid response'), false);
      const protectedRead = await create({ overrides: { async read_record(input, context) {
        return { output: await context.data.get('record', { key: { id: input.id }, fields: ['id', 'internal_secret'] }) };
      } } });
      const protectedResult = await protectedRead.engine.invoke(request('read_record', { id: 'record-main' }));
      assert.equal(protectedResult.execution.state, 'failed'); assert.equal(protectedResult.execution.errorCode, 'forbidden');
      assert.equal(JSON.stringify(protectedResult).includes('synthetic protected model value'), false);
      const invalidCommand = await create({ overrides: { create_record(input, context) {
        return { output: { id: input.id, title: 7, revision: 0 }, plans: [context.data.planCreate('record',
          { values: { id: input.id, title: 'must roll back invalid output', revision: 0 } })] };
      } } });
      const badCommand = await invalidCommand.engine.invoke(request('create_record', { id: 'invalid-output-command', title: 'x', request_id: 'invalid-output-command' }));
      assert.equal(badCommand.execution.state, 'failed'); assert.equal(badCommand.execution.errorCode, 'invalid_output');
      assert.equal(await fixture.record('invalid-output-command'), null);
    });
    await t.test('context, audience and human approval remain mandatory independently of channel names', async () => {
      await assert.rejects(normal.engine.invoke(request('read_record', { id: 'record-main' }, { credential: fixture.credentials.machine, contextId: 'other' })));
      await assert.rejects(normal.engine.invoke(request('read_record', { id: 'record-main' }, { credential: fixture.credentials.impersonation, audience: 'app' })));
      for (const credential of Object.values(fixture.credentials)) await assert.rejects(normal.engine.invoke(request('approved_rename',
        { id: 'record-main', title: 'Must not apply', request_id: 'approval', record_version: 0 }, { credential })));
      assert.equal(normal.calls.get('approved_rename') ?? 0, 0); assert.equal((await fixture.record('record-main')).title, 'Initial');
    });
    await t.test('concurrent duplicate commands have one handler and capture inputs before awaiting', async () => {
      const entered = deferred(), released = deferred();
      const controlled = await create({ async before(id) { if (id === 'create_record') { entered.resolve(); await released.promise; } } });
      const input = { id: 'concurrent', title: 'Captured title', request_id: 'concurrent' }, first = controlled.engine.invoke(request('create_record', input));
      await entered.promise; input.title = 'Changed after invocation';
      const duplicate = await controlled.engine.invoke(request('create_record', { id: 'concurrent', title: 'Captured title', request_id: 'concurrent' }));
      assert.equal(duplicate.replayed, true); assert.equal(duplicate.execution.state, 'running');
      released.resolve(); const result = succeeded(await first);
      assert.equal(controlled.calls.get('create_record'), 1); assert.equal((await fixture.record('concurrent')).title, 'Captured title');
      assert.equal(duplicate.execution.id, result.execution.id);
    });
    await t.test('stale versions and late SQL errors never partially commit business plans', async () => {
      const current = succeeded(await normal.engine.invoke(request('rename_record', { id: 'record-main', title: 'Renamed', request_id: 'rename', record_version: 0 })));
      assert.equal(current.execution.output.revision, 1);
      await notConfirmed(normal.engine.invoke(request('rename_record', { id: 'record-main', title: 'Stale', request_id: 'stale', record_version: 0 })));
      assert.equal((await fixture.record('record-main')).title, 'Renamed');
      const broken = await create({ overrides: { create_record(input, context) {
        const values = { id: input.id, title: input.title, revision: 0 };
        return { output: values, plans: [context.data.planCreate('record', { values }), context.data.planCreate('record', { values })] };
      } } });
      await notConfirmed(broken.engine.invoke(request('create_record', { id: 'late-rollback', title: 'Never persist', request_id: 'late' })));
      assert.equal(await fixture.record('late-rollback'), null);
      const repeat = await broken.engine.invoke(request('create_record', { id: 'late-rollback', title: 'Never persist', request_id: 'late' }));
      assert.equal(repeat.replayed, true); assert.notEqual(repeat.execution.state, 'succeeded'); assert.equal(broken.calls.get('create_record'), 1);
    });
    await t.test('provider intent is durable but no provider call or background delivery is invented', async () => {
      const sent = await normal.engine.invoke(request('send_record', { id: 'record-main', request_id: 'provider-intent' }));
      assert.equal(sent.execution.state, 'waiting');
      const stored = await fixture.db.prepare(`SELECT provider,state,payload FROM ${quote(OPERATION_TABLES.outbox)} WHERE execution_id=?`).bind(sent.execution.id).all();
      assert.equal(stored.results.length, 1); assert.equal(stored.results[0].state, 'queued'); assert.equal(stored.results[0].provider, 'synthetic-provider');
      const replay = await normal.engine.invoke(request('send_record', { id: 'record-main', request_id: 'provider-intent' }));
      assert.equal(replay.execution.id, sent.execution.id); assert.equal(normal.calls.get('send_record'), 1);
    });
    await t.test('cancellation and deadline close planner capabilities without pretending to stop JavaScript', async () => {
      const cancelled = new AbortController(); cancelled.abort(); const before = await count(fixture.db, 'executions');
      await assert.rejects(normal.engine.invoke(request('create_record', { id: 'pre-cancel', title: 'No claim', request_id: 'pre-cancel' },
        { signal: cancelled.signal })), { code: 'cancelled' });
      assert.equal(await count(fixture.db, 'executions'), before);
      for (const mode of ['cancelled', 'timeout']) {
        const started = deferred(), release = deferred(), finished = deferred(), controller = new AbortController();
        let lateError, handlerStarted = false;
        const controlled = await create({ overrides: { async create_record(input, context) {
          handlerStarted = true; started.resolve(); await release.promise;
          try { return { output: { id: input.id, title: input.title, revision: 0 }, plans: [context.data.planCreate('record',
            { values: { id: input.id, title: input.title, revision: 0 } })] }; }
          catch (error) { lateError = error.code; throw error; }
          finally { finished.resolve(); }
        } } });
        const id = `late-${mode}`;
        const pending = controlled.engine.invoke(request('create_record', { id, title: 'Late planner', request_id: id },
          { signal: controller.signal })).then(result => ({ result }), error => ({ error }));
        let outcome;
        try {
          await Promise.race([started.promise, pending.then(() => { throw new Error('Operation terminated before reaching its planner.'); })]);
          if (mode === 'cancelled') controller.abort();
          outcome = await pending;
        } finally {
          release.resolve();
          if (handlerStarted) await finished.promise;
        }
        if (outcome.error) assert.equal(outcome.error.code, mode);
        else { assert.equal(outcome.result.execution.state, 'failed'); assert.equal(outcome.result.execution.errorCode, mode); }
        assert.equal(lateError, mode); assert.equal(await fixture.record(id), null);
      }
    });
    await t.test('all manufactured plans count toward the bound even when only one is returned', async () => {
      const controlled = await create({ maxItems: 100, overrides: { create_record(input, context) {
        const plans = Array.from({ length: 17 }, (_, index) => context.data.planCreate('record',
          { values: { id: `${input.id}-${index}`, title: input.title, revision: 0 } }));
        return { output: { id: input.id, title: input.title, revision: 0 }, plans: [plans[0]] };
      } } });
      const before = await fixture.countRecords();
      const result = await controlled.engine.invoke(request('create_record', { id: 'plan-bound', title: 'Never insert', request_id: 'plan-bound' }));
      assert.equal(result.execution.state, 'failed'); assert.equal(result.execution.errorCode, 'invalid_input');
      assert.equal(await fixture.countRecords(), before);
    });
    await t.test('timeout during an engaged commit is unknown; a fresh status later reports its durable result', async () => {
      const entered = deferred(), release = deferred(), finished = deferred(), originals = new WeakMap(), texts = new WeakMap(); let intercepted = false;
      const wrapped = { prepare(sql) {
        function statement(raw) {
          const value = { bind: (...values) => statement(raw.bind(...values)), all: (...args) => raw.all(...args),
            first: (...args) => raw.first(...args), run: (...args) => raw.run(...args) };
          originals.set(value, raw); texts.set(value, sql); return value;
        }
        return statement(fixture.db.prepare(sql));
      }, async batch(statements) {
        const hold = !intercepted && statements.some(value => texts.get(value)?.includes('SET state=?,output=?'));
        if (hold) { intercepted = true; entered.resolve(); await release.promise; }
        try { return await fixture.db.batch(statements.map(value => originals.get(value))); }
        finally { if (hold) finished.resolve(); }
      } };
      const controlled = await create({}, wrapped), command = request('create_record', { id: 'commit-after-timeout', title: 'Durable later', request_id: 'commit-timeout' });
      const pending = controlled.engine.invoke(command).then(result => ({ result }), error => ({ error }));
      try {
        await Promise.race([entered.promise, pending.then(() => { throw new Error('Operation terminated before reaching its commit.'); })]);
        const outcome = await pending;
        assert.equal(outcome.error?.code, 'unknown'); assert.equal(await fixture.record('commit-after-timeout'), null);
        release.resolve(); await finished.promise;
        const executionId = controlled.contexts.at(-1).executionId;
        const observed = await normal.engine.status({ credential: fixture.credentials.session, moduleId, operationId: 'create_record',
          contextId: 'application', audience: 'admin', executionId });
        assert.equal(observed.state, 'succeeded'); assert.equal((await fixture.record('commit-after-timeout')).title, 'Durable later');
        const replay = succeeded(await normal.engine.invoke(command)); assert.equal(replay.execution.id, executionId); assert.equal(replay.replayed, true);
      } finally { release.resolve(); if (intercepted) await finished.promise; }
    });
    await t.test('revocation after planning blocks every credential at the actual commit', async () => {
      for (const [kind, credential] of Object.entries(fixture.credentials)) {
        const controlled = await create({ overrides: { async create_record(input, context) {
          const values = { id: input.id, title: input.title, revision: 0 }, plan = context.data.planCreate('record', { values });
          await fixture.revoke(kind); return { output: values, plans: [plan] };
        } } });
        const id = `revoked-${kind}`;
        let result;
        try { result = await controlled.engine.invoke(request('create_record', { id, title: 'Cannot commit', request_id: id }, { credential })); }
        catch (error) { assert.ok(['unauthorized', 'unavailable', 'unknown', 'forbidden'].includes(error.code)); }
        if (result) assert.notEqual(result.execution.state, 'succeeded');
        assert.equal(await fixture.record(id), null);
      }
    });
  } finally { await fixture.dispose(); }
});
