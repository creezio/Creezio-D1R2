import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileService } from '../../core/files/service.ts';
import { captureFileCategory } from '../../core/files/mapping.ts';
import { createStorageFixture, moduleId, catalog, category, table } from './fixtures/storage.mjs';

const bytes = new TextEncoder().encode('Synthetic private document only');
const input = (intentId, extra = {}) => ({ ownerId: 'business-owner', intentId, generation: '1', filename: 'private.pdf', contentType: 'application/pdf', bytes, ...extra });
const count = async (db, model) => (await db.prepare(`SELECT count(*) AS n FROM ${table(model)}`).first()).n;
const row = (db, id) => db.prepare(`SELECT * FROM ${table('file_metadata')} WHERE id=?`).bind(id).first();
function wrapBucket(bucket, hooks = {}) {
  return { async put(...args) { if (hooks.put) await hooks.put(...args); return bucket.put(...args); },
    async get(...args) { const result = await bucket.get(...args); if (hooks.get) await hooks.get(...args); return result; },
    async delete(...args) { if (hooks.delete) await hooks.delete(...args); return bucket.delete(...args); } };
}

test('file mapping preserves canonical identifiers and refuses ambiguous or public metadata', () => {
  assert.equal(captureFileCategory(catalog, moduleId, { ...category, id: 'attachment-v1.local' }).id, 'attachment-v1.local');
  for (const mutation of [c => { c.storageFields.digest = c.storageFields.objectKey; }, c => { c.contextField = 'other'; },
    c => { c.metadataModel.moduleId = 'other.owner'; }, c => { c.id += '\n'; }, c => { c.permissions = []; }]) {
    const clone = structuredClone(category); mutation(clone);
    assert.throws(() => captureFileCategory(catalog, moduleId, clone), { code: 'invalid_mapping' });
  }
  const altered = structuredClone(catalog); altered.modules[0].models.find(m => m.modelId === 'file_metadata').model.public = true;
  assert.throws(() => captureFileCategory(altered, moduleId, category), { code: 'invalid_mapping' });
});

test('file intentions, R2 publication and private reads use real guarded D1 and R2', { timeout: 60000 }, async t => {
  const fixture = await createStorageFixture();
  const { db, data, bucket } = fixture;
  const make = (b = bucket, c = category, cat = catalog) => createFileService({ data, catalog: cat, moduleId, category: c, bucket: b });
  const files = make();
  try {
    await t.test('staged content is hidden, publication and business write roll back together on late error', async () => {
      const lease = await fixture.lease(), ref = await files.stage(lease, input('atomic'));
      assert.equal((await row(db, ref.fileId)).state, 'staged');
      await assert.rejects(files.readPrivate(lease, ref), { code: 'not_found' });
      const business = data.forModule(lease, moduleId);
      const proof = await files.publicationProof(lease, ref);
      await assert.rejects(data.commitBatch(lease, [proof,
        business.planCreate('record', { values: { id: 'rollback', title: 'first' } }),
        business.planCreate('record', { values: { id: 'rollback', title: 'duplicate fails late' } })]), { code: 'storage_error' });
      assert.equal((await row(db, ref.fileId)).state, 'staged'); assert.equal(await count(db, 'record'), 0);
      await data.commitBatch(lease, [await files.publicationProof(lease, ref), business.planCreate('record', { values: { id: 'committed', title: 'document' } })]);
      const read = await files.readPrivate(lease, ref);
      assert.deepEqual(read.bytes, bytes); assert.equal(read.headers['content-type'], 'application/octet-stream');
      assert.equal(Object.hasOwn(read, 'objectKey'), false); assert.equal(read.headers['cache-control'], 'private, no-store');
      await data.commitBatch(lease, [await files.publicationProof(lease, ref), business.planCreate('record', { values: { id: 'repeat-proof', title: 'same file' } })]);
      assert.equal((await row(db, ref.fileId)).state, 'available');
      await assert.rejects(files.abandon(lease, ref), { code: 'conflict' });
    });
    await t.test('retry is immutable, put failure leaves an explicit resumable intention and cleanup remains retryable', async () => {
      const lease = await fixture.lease(); let failPut = true, failDelete = true;
      const flaky = make(wrapBucket(bucket, { put() { if (failPut) throw new Error('synthetic R2 failure'); }, delete() { if (failDelete) throw new Error('synthetic delete failure'); } }));
      await assert.rejects(flaky.stage(lease, input('resume')), { code: 'unavailable' });
      const staged = await db.prepare(`SELECT * FROM ${table('file_metadata')} WHERE intent_id='resume'`).first();
      assert.equal(staged.state, 'staging'); failPut = false;
      const ref = await flaky.stage(lease, input('resume'));
      assert.equal(ref.fileId, staged.id); assert.deepEqual(await flaky.stage(lease, input('resume')), ref);
      await assert.rejects(flaky.stage(lease, input('resume', { bytes: new Uint8Array([1, 2]) })), { code: 'conflict' });
      assert.deepEqual(await flaky.abandon(lease, ref), { state: 'abandoned', cleanup: 'pending' });
      await assert.rejects(flaky.publicationProof(lease, ref), { code: 'conflict' });
      failDelete = false;
      assert.deepEqual(await flaky.abandon(lease, ref), { state: 'abandoned', cleanup: 'delete_confirmed' });
      assert.equal(await bucket.get(staged.object_key), null);
      await assert.rejects(flaky.stage(lease, input('resume')), { code: 'conflict' });
    });
    await t.test('context, category and category-specific permissions cannot be substituted through a shared model', async () => {
      const lease = await fixture.lease(), ref = await files.stage(lease, input('boundary'));
      await data.commitBatch(lease, [await files.publicationProof(lease, ref)]);
      await assert.rejects(files.readPrivate(await fixture.lease('other'), ref), { code: 'not_found' });
      const extended = structuredClone(catalog);
      extended.modules[0].permissions.find(p => p.id === 'files').resources.push({ moduleId, kind: 'file', id: 'second' });
      const second = make(bucket, { ...category, id: 'second' }, extended);
      await assert.rejects(second.readPrivate(lease, ref), { code: 'not_found' });
      const restricted = make(bucket, { ...category, id: 'restricted', permissions: [{ moduleId, kind: 'permission', id: 'restricted' }] });
      await assert.rejects(restricted.stage(lease, input('denied')), { code: 'forbidden' });
      await fixture.changePermissions(['records', 'secrets']);
      await assert.rejects(files.readPrivate(await fixture.lease(), ref), { code: 'forbidden' });
      await fixture.changePermissions(['records', 'files', 'secrets']);
    });
    await t.test('revocation during R2 and changes after proof abort the final read or publication', async () => {
      let lease = await fixture.lease(), ref = await files.stage(lease, input('race'));
      const proof = await files.publicationProof(lease, ref);
      await fixture.bumpEpoch();
      await assert.rejects(data.commitBatch(lease, [proof]), { code: 'storage_error' });
      assert.equal((await row(db, ref.fileId)).state, 'staged');
      lease = await fixture.lease(); await data.commitBatch(lease, [await files.publicationProof(lease, ref)]);
      let once = true;
      const raced = make(wrapBucket(bucket, { async get() { if (once) { once = false; await fixture.bumpEpoch(); } } }));
      await assert.rejects(raced.readPrivate(lease, ref), { code: 'storage_error' });
      lease = await fixture.lease();
      const meta = await row(db, ref.fileId); await bucket.put(meta.object_key, new Uint8Array([1, 2, 3]));
      await assert.rejects(files.readPrivate(lease, ref), { code: 'conflict' });
    });
    await t.test('concurrent identical uploads converge and abandonment racing the put cannot publish', async () => {
      const lease = await fixture.lease();
      const both = await Promise.all([files.stage(lease, input('concurrent')), files.stage(lease, input('concurrent'))]);
      assert.deepEqual(both[0], both[1]);
      let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
      const paused = make(wrapBucket(bucket, { async put() { entered(); await new Promise(resolve => { release = resolve; }); } }));
      const uploading = paused.stage(lease, input('abandon-during-put')); await waiting;
      const metadata = await db.prepare(`SELECT * FROM ${table('file_metadata')} WHERE intent_id='abandon-during-put'`).first();
      const ref = { fileId: metadata.id, intentId: metadata.intent_id, generation: metadata.generation, digest: metadata.digest };
      await files.abandon(lease, ref); release(); await assert.rejects(uploading);
      assert.equal((await row(db, ref.fileId)).state, 'abandoned');
      assert.equal(await bucket.get(metadata.object_key), null);
      await assert.rejects(files.publicationProof(lease, ref), { code: 'conflict' });
    });
  } finally { await fixture.dispose(); }
});
