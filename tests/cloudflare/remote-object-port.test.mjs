import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRemoteTransferObjectPort} from '../../scripts/cloudflare/remote/object-port.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const entry = (key, bytes) => ({key, size: bytes.length, sha256: hash(bytes),
  httpMetadata: {}, customMetadata: {}, bodyFile: 'capture-body'});
const checkpoint = () => ({schemaVersion: 1, revision: 1,
  identity: {transferId: 'transfer-1', target: {bucketName: 'target'}},
  manifestDigest: `sha256-${'a'.repeat(64)}`, phase: 'r2-copying',
  tableCursor: null, objectCursor: null, multipart: null,
  targetSchemaReceiptId: null, targetDeploymentId: null});
const stream = async function* (bytes, chunk = 1024 * 1024) {
  for (let offset = 0; offset < bytes.length; offset += chunk) yield bytes.subarray(offset, offset + chunk);
};
const journal = start => {
  let current = start;
  return {load: async () => current, compareAndSave: async (before, after) => {
    assert.deepEqual(before, current);
    assert.equal(after.revision, before.revision + 1);
    current = after;
  }, current: () => current};
};

test('object port streams a small object and resolves a lost response by full target inspection', async () => {
  const data = Buffer.from('safe content');
  const item = entry('creezio/files/v1/a', data), initial = checkpoint();
  let calls = 0, present = false;
  const r2 = {inspectObject: async () => present ? 'matching' : 'absent',
    putObject: async (_entry, bytes) => {calls++; assert.deepEqual(bytes, data); present = true; throw new Error('lost');},
    listPage: async () => ({objects: [], nextContinuationToken: null})};
  const port = createRemoteTransferObjectPort({r2, journal: journal(initial)});
  assert.equal(await port.putObjectIfAbsent(item, stream(data), initial), 'matching');
  assert.equal(calls, 1);
});

test('object port journals multipart receipts, resumes known parts and never replaces a foreign part', async () => {
  const data = Buffer.alloc(33 * 1024 * 1024, 7);
  const item = entry('creezio/files/v1/large', data), initial = checkpoint();
  const saved = journal(initial), remote = new Map();
  let uploaded = 0, present = false;
  const r2 = {
    inspectObject: async () => present ? 'matching' : 'absent',
    createMultipart: async () => ({uploadId: 'upload-1'}),
    listParts: async () => ({parts: [...remote.values()], nextMarker: null}),
    uploadPart: async (_key, _id, number, bytes, sha256) => {
      uploaded++;
      const receipt = {number, size: bytes.length, sha256, etag: `"${md5(bytes)}"`};
      remote.set(number, receipt);
      return receipt;
    },
    completeMultipart: async (_entry, _id, parts) => {
      assert.equal(parts.length, 5);
      present = true;
    },
    listPage: async () => ({objects: [], nextContinuationToken: null})
  };
  const port = createRemoteTransferObjectPort({r2, journal: saved});
  assert.equal(await port.putObjectIfAbsent(item, stream(data), initial), 'created');
  assert.equal(uploaded, 5);
  assert.equal(saved.current().multipart, null);
  assert.equal(saved.current().revision, 13);

  // A saved part can resume without another upload of that part.
  present = false; uploaded = 0;
  for (const number of [3, 4, 5]) remote.delete(number);
  const resumed = {...saved.current(), revision: 9,
    multipart: {key: item.key, uploadId: 'upload-1', completedParts: [
      ...[1, 2].map(number => ({number, etag: remote.get(number).etag, sha256: remote.get(number).sha256}))
    ]}};
  const resumeJournal = journal(resumed);
  const resumePort = createRemoteTransferObjectPort({r2, journal: resumeJournal});
  assert.equal(await resumePort.putObjectIfAbsent(item, stream(data), resumed), 'created');
  assert.equal(uploaded, 3);
  assert.equal(resumeJournal.current().multipart, null);

  // An unjournaled remote part cannot be replaced during a later attempt.
  present = false; uploaded = 0;
  const conflicting = {...resumed, revision: 20, multipart: {...resumed.multipart,
    completedParts: resumed.multipart.completedParts.slice(0, 1)}};
  const conflictPort = createRemoteTransferObjectPort({r2, journal: journal(conflicting)});
  await assert.rejects(conflictPort.putObjectIfAbsent(item, stream(data), conflicting),
    error => error.code === 'conflict');
  assert.equal(uploaded, 0);
});

test('a durable multipart intent adopts a part whose upload ACK was lost', async () => {
  const data = Buffer.alloc(33 * 1024 * 1024, 9);
  const item = entry('creezio/files/v1/lost-part-ack', data), saved = journal(checkpoint());
  const remote = new Map(); let uploads = 0, present = false;
  const r2 = {
    inspectObject: async () => present ? 'matching' : 'absent',
    createMultipart: async () => ({uploadId: 'upload-lost'}),
    listParts: async () => ({parts: [...remote.values()], nextMarker: null}),
    uploadPart: async (_key, _id, number, bytes, sha256) => {
      uploads++;
      const receipt = {number, size: bytes.length, sha256, etag: `"${md5(bytes)}"`};
      remote.set(number, receipt);
      if (number === 1) throw new Error('ACK lost after remote part creation');
      return receipt;
    },
    completeMultipart: async (_entry, _id, parts) => {
      assert.equal(parts.length, 5); present = true;
    },
    listPage: async () => ({objects: [], nextContinuationToken: null})
  };
  const port = createRemoteTransferObjectPort({r2, journal: saved});
  assert.equal(await port.putObjectIfAbsent(item, stream(data), saved.current()), 'unknown');
  assert.equal(uploads, 1);
  assert.deepEqual(saved.current().multipart.pendingPart, {number: 1, size: 8 * 1024 * 1024,
    sha256: hash(data.subarray(0, 8 * 1024 * 1024)), md5: md5(data.subarray(0, 8 * 1024 * 1024))});
  const created=remote.get(1);
  remote.set(1,{...created,etag:`"${'0'.repeat(32)}"`});
  await assert.rejects(port.putObjectIfAbsent(item, stream(data), saved.current()),
    error => error.code === 'conflict');
  assert.equal(uploads, 1);
  remote.set(1,created);
  assert.equal(await port.putObjectIfAbsent(item, stream(data), saved.current()), 'created');
  assert.equal(uploads, 5);
  assert.equal(saved.current().multipart, null);
});

test('object port lists every paginated key and rejects repeated keys', async () => {
  const pages = [
    {objects: [{key: 'a'}, {key: 'b'}], nextContinuationToken: 'next'},
    {objects: [{key: 'c'}], nextContinuationToken: null}
  ];
  const r2 = {inspectObject: async () => 'absent', listPage: async ({continuationToken}) =>
    continuationToken === null ? pages[0] : pages[1]};
  const port = createRemoteTransferObjectPort({r2, journal: journal(checkpoint())});
  assert.deepEqual(await Array.fromAsync(port.listObjectKeys()), ['a', 'b', 'c']);
  pages[1] = {objects: [{key: 'b'}], nextContinuationToken: null};
  await assert.rejects(Array.fromAsync(port.listObjectKeys()), error => error.code === 'invalid_listing');
});
