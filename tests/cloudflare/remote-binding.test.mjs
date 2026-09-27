import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {createRemoteD1Client} from '../../scripts/cloudflare/remote/d1.mjs';
import {createRemoteD1Binding} from '../../scripts/cloudflare/remote/binding.mjs';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema, inspectCompositionSchema} from '../../scripts/data/apply-schema.mjs';

const accountId = 'a'.repeat(32);
const databaseId = '11111111-2222-3333-4444-555555555555';
const token = 'token-operator-only-123456789';

test('remote binding runs the unchanged central schema guard/receipt in one large D1 batch', async () => {
  const plan = await loadCompositionSchema();
  assert.ok(plan.objects.length > 50);
  const mf = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status:404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: ['DB'], d1Persist: false});
  try {
    const local = await mf.getD1Database('DB');
    const batchLengths = [];
    const fetcher = async (url, init) => {
      assert.equal(new URL(url).origin, 'https://api.cloudflare.com');
      assert.equal(init.redirect, 'error');
      if (init.method === 'GET') return Response.json({success: true, result: {uuid: databaseId}});
      const envelope = JSON.parse(init.body);
      batchLengths.push(envelope.batch.length);
      try {
        const statements = envelope.batch.map(item => local.prepare(item.sql).bind(...item.params));
        const result = await local.batch(statements);
        return Response.json({success: true, result});
      } catch { return Response.json({success: false, result: []}, {status: 400}); }
    };
    const client = createRemoteD1Client({accountId, databaseId, token, fetcher});
    const db = createRemoteD1Binding(client);
    assert.equal((await client.metadata()).uuid, databaseId);
    const first = await applyCompositionSchema(db, plan, {expectedPlanDigest: plan.planDigest});
    assert.equal(first.ok, true, first.code);
    assert.equal(first.effect, 'confirmed');
    assert.ok(batchLengths.some(length => length >= plan.objects.length + 4));
    assert.equal((await inspectCompositionSchema(db, plan)).state, 'ready');
    const second = await applyCompositionSchema(db, plan, {expectedPlanDigest: plan.planDigest});
    assert.equal(second.effect, 'none');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM cz_schema_receipts').first('count')), 1);
  } finally { await mf.dispose(); }
});

test('remote D1 binding rejects statements from another binding', async () => {
  const client = {query: async () => ({success: true, results: []}), batch: async () => []};
  const first = createRemoteD1Binding(client), second = createRemoteD1Binding(client);
  await assert.rejects(first.batch([second.prepare('SELECT 1')]), /Foreign remote D1 statement/);
});
