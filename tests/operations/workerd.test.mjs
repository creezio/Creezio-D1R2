import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compileOperationSchemas } from '../../scripts/operations/schemas.mjs';
import { createOperationFixture, catalog } from './fixtures/identity.mjs';
import { moduleId, permissions, operationComposition } from './fixtures/operations.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('the actual operation engine, static AJV validators and D1 guards run together in workerd', { timeout: 30000 }, async t => {
  const compiled = compileOperationSchemas(operationComposition());
  const bundled = await build({ absWorkingDir: root, entryPoints: ['tests/operations/fixtures/worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], logLevel: 'silent', plugins: [{ name: 'qualification-inputs', setup(builder) {
      builder.onResolve({ filter: /^qualification:/ }, args => ({ path: args.path, namespace: 'qualification' }));
      builder.onLoad({ filter: /.*/, namespace: 'qualification' }, args => ({ loader: 'js', contents: args.path === 'qualification:validators'
        ? compiled.validatorsCode : `export const moduleId=${JSON.stringify(moduleId)}; export const permissions=${JSON.stringify(permissions)};
          export const dataCatalog=${JSON.stringify(catalog)}; export const operationCatalog=${JSON.stringify(compiled.catalog)};` }));
    } }] });
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, []);
  assert.ok(Object.keys(bundled.metafile.inputs).some(path => path.endsWith('core/operations/service.ts')));
  assert.ok(Object.keys(bundled.metafile.inputs).includes('qualification:qualification:validators'));
  const fixture = await createOperationFixture({ script: bundled.outputFiles[0].text });
  async function request(operationId, input, kind = 'session', extra = {}, method = 'invoke') {
    let timer;
    try {
      return await Promise.race([(async () => {
        const response = await fixture.runtime.dispatchFetch('http://operation-qualification/qualification', { method: 'POST',
          body: JSON.stringify({ method, invocation: { credential: fixture.credentials[kind], moduleId, operationId,
            contextId: 'application', audience: 'admin', input, ...extra } }) });
        assert.equal(response.status, 200); return response.json();
      })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('External Worker test deadline exceeded.')), 5000); })]);
    } finally { clearTimeout(timer); }
  }
  try {
    await t.test('three native identities commit, query and replay without repeating handlers', async () => {
      for (const kind of ['session', 'machine', 'impersonation']) {
        const id = `worker-${kind}`, input = { id, title: `Worker ${kind}`, request_id: id };
        const created = await request('create_record', input, kind);
        assert.equal(created.ok, true, JSON.stringify(created)); assert.equal(created.result.execution.state, 'succeeded');
        assert.equal(created.result.replayed, false);
        const principal = kind === 'machine' ? fixture.machine.principal.id : fixture.subject.principalId;
        assert.equal(created.context.principalId, principal);
        assert.equal(created.context.actorPrincipalId, kind === 'impersonation' ? fixture.owner.principalId : principal);
        const replay = await request('create_record', input, kind);
        assert.equal(replay.result.replayed, true); assert.equal(replay.result.execution.id, created.result.execution.id);
        assert.equal(replay.calls.create_record, created.calls.create_record);
        const read = await request('read_record', { id }, kind);
        assert.equal(read.ok, true); assert.equal(read.result.execution.state, 'succeeded');
        assert.deepEqual(read.result.execution.output, { id, title: input.title, revision: 0 });
        assert.equal(JSON.stringify(read).includes('synthetic protected model value'), false);
        assert.equal((await fixture.record(id)).title, input.title);
      }
      assert.equal(await fixture.countRecords(), 3);
    });
    await t.test('generated validation and operation authority reject malformed, write-from-query and cross-scope requests', async () => {
      const invalid = await request('create_record', { id: 'wrong-input', title: 9, request_id: 'wrong-input' });
      assert.equal(invalid.ok, false); assert.equal(invalid.error, 'invalid_input');
      assert.equal(invalid.calls.create_record, 3);
      const output = await request('invalid_output', { id: 'worker-session' });
      assert.equal(output.ok, true); assert.equal(output.result.execution.state, 'failed');
      assert.equal(output.result.execution.errorCode, 'invalid_output');
      const queryWrite = await request('query_write_attempt', { id: 'forbidden-query-write' });
      assert.equal(queryWrite.ok, true); assert.equal(queryWrite.result.execution.state, 'failed');
      assert.equal(queryWrite.result.execution.errorCode, 'forbidden');
      const approval = await request('approved_rename', { id: 'worker-session', title: 'No approval', request_id: 'approval', record_version: 0 });
      assert.equal(approval.ok, false); assert.equal(approval.error, 'unsupported');
      const wrongScope = await request('create_record', { id: 'wrong-scope', title: 'No cross product', request_id: 'wrong-scope' }, 'machine',
        { contextId: 'other', audience: 'admin' });
      assert.equal(wrongScope.ok, false); assert.equal(wrongScope.error, 'unauthorized');
      assert.equal(await fixture.countRecords(), 3);
    });
    await t.test('fresh D1 authority rejects all three credentials after real revocation', async () => {
      for (const kind of ['session', 'machine', 'impersonation']) {
        await fixture.revoke(kind);
        const result = await request('create_record', { id: `revoked-${kind}`, title: 'Refused', request_id: `revoked-${kind}` }, kind);
        assert.equal(result.ok, false); assert.ok(['unauthorized', 'forbidden'].includes(result.error), JSON.stringify(result));
      }
      assert.equal(await fixture.countRecords(), 3);
    });
  } finally { await fixture.dispose(); }
});
