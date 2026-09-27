/** Initial T32 object transfer. The source is a materialized capture, not the live app. */
import {createHash} from 'node:crypto';

const SHA = /^[a-f0-9]{64}$/;
const PART_BYTES = 8 * 1024 * 1024;
const SINGLE_BYTES = 32 * 1024 * 1024;
const MAX_PARTS = 256; // Same explicit bound as the private checkpoint schema.
const matchesMd5 = (etag, md5) => typeof etag === 'string' &&
  (etag.toLowerCase() === md5 || etag.toLowerCase() === `"${md5}"`);

export class RemoteObjectTransferError extends Error {
  constructor(code) { super(`Object transfer ${code}.`); this.name = 'RemoteObjectTransferError'; this.code = code; }
}
const fail = code => { throw new RemoteObjectTransferError(code); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function checked(entry, checkpoint) {
  if (!entry || typeof entry.key !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      !SHA.test(entry.sha256) || !checkpoint || checkpoint.phase !== 'r2-copying' ||
      !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 1 ||
      typeof checkpoint.identity?.transferId !== 'string' ||
      checkpoint.identity.target?.bucketName === undefined) fail('invalid_input');
}

async function collectSmall(source, entry) {
  const pieces = []; let size = 0;
  const hasher = createHash('sha256');
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) fail('invalid_source');
    size += chunk.byteLength;
    if (size > entry.size || size > SINGLE_BYTES) fail('invalid_source');
    hasher.update(chunk); pieces.push(chunk);
  }
  if (size !== entry.size || hasher.digest('hex') !== entry.sha256) fail('invalid_source');
  return Buffer.concat(pieces, size);
}

async function* splitParts(source, tracker) {
  let pieces = [], size = 0;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) fail('invalid_source');
    tracker.size += chunk.byteLength;
    if (tracker.size > tracker.expectedSize) fail('invalid_source');
    tracker.hasher.update(chunk);
    for (let offset = 0; offset < chunk.byteLength;) {
      const count = Math.min(PART_BYTES - size, chunk.byteLength - offset);
      pieces.push(chunk.subarray(offset, offset + count)); size += count; offset += count;
      if (size === PART_BYTES) {
        yield Buffer.concat(pieces, size);
        pieces = []; size = 0;
      }
    }
  }
  if (size) yield Buffer.concat(pieces, size);
}

/** r2 is createRemoteR2Client(); journal is the private TransferJournal. */
export function createRemoteTransferObjectPort({r2, journal}) {
  if (!r2 || !journal || typeof r2.inspectObject !== 'function' ||
      typeof r2.listPage !== 'function' || typeof journal.load !== 'function' ||
      typeof journal.compareAndSave !== 'function') fail('invalid_configuration');

  async function save(current, multipart) {
    const next = {...current, revision: current.revision + 1, multipart};
    await journal.compareAndSave(current, next);
    return next;
  }
  async function loadCurrent(checkpoint) {
    const current = await journal.load(checkpoint.identity.transferId);
    if (!current || !same(current, checkpoint)) fail('stale_checkpoint');
    return current;
  }
  async function remoteParts(key, uploadId) {
    const parts = new Map(); let marker = 0;
    for (let page = 0; page < MAX_PARTS; page++) {
      const result = await r2.listParts(key, uploadId, {marker});
      for (const item of result.parts) {
        if (parts.has(item.number)) fail('conflict');
        parts.set(item.number, item);
      }
      if (result.nextMarker === null) return parts;
      marker = result.nextMarker;
    }
    fail('limit');
  }

  async function putObjectIfAbsent(entry, bytes, checkpoint) {
    checked(entry, checkpoint);
    if (!bytes || typeof bytes[Symbol.asyncIterator] !== 'function') fail('invalid_source');
    let current = await loadCurrent(checkpoint);
    let state = await r2.inspectObject(entry);
    if (state === 'matching') {
      if (current.multipart?.key === entry.key) await save(current, null);
      return 'matching';
    }
    if (state !== 'absent') fail('conflict');
    if (entry.size <= SINGLE_BYTES) {
      if (current.multipart !== null) fail('conflict');
      const data = await collectSmall(bytes, entry);
      try { await r2.putObject(entry, data); return 'created'; }
      catch {
        state = await r2.inspectObject(entry);
        if (state === 'matching') return 'matching';
        if (state === 'conflict') fail('conflict');
        return 'unknown';
      }
    }
    if (Math.ceil(entry.size / PART_BYTES) > MAX_PARTS) fail('limit');
    if (current.multipart !== null && current.multipart.key !== entry.key) fail('conflict');
    if (current.multipart === null) {
      let initiated;
      try { initiated = await r2.createMultipart(entry); }
      catch { return 'unknown'; }
      try { current = await save(current, {key: entry.key, uploadId: initiated.uploadId,
        completedParts: [], pendingPart: null}); }
      catch { return 'unknown'; } // A created upload without a saved ID requires operator inspection.
    }
    const uploadId = current.multipart.uploadId;
    let observed;
    try { observed = await remoteParts(entry.key, uploadId); }
    catch { return 'unknown'; }
    const received = new Map(current.multipart.completedParts.map(item => [item.number, item]));
    const pending = current.multipart.pendingPart ?? null;
    if (pending && pending.number !== received.size + 1) fail('conflict');
    if (observed.size !== received.size + (pending && observed.has(pending.number) ? 1 : 0) ||
        [...received].some(([number, receipt]) => observed.get(number)?.etag !== receipt.etag) ||
        pending && observed.has(pending.number) &&
          (observed.get(pending.number).size !== pending.size ||
            !matchesMd5(observed.get(pending.number).etag, pending.md5))) fail('conflict');
    const tracker = {size: 0, expectedSize: entry.size, hasher: createHash('sha256')};
    const completed = [];
    let number = 0;
    for await (const part of splitParts(bytes, tracker)) {
      number++;
      if (number > MAX_PARTS) fail('limit');
      const sha256 = createHash('sha256').update(part).digest('hex');
      const prior = received.get(number);
      if (prior) {
        if (prior.sha256 !== sha256 || observed.get(number)?.size !== part.byteLength) fail('conflict');
        completed.push({number, size: part.byteLength, sha256, etag: prior.etag});
        continue;
      }
      const md5 = createHash('md5').update(part).digest('hex');
      const intent = current.multipart.pendingPart ?? null;
      if (intent) {
        if (intent.number !== number || intent.size !== part.byteLength ||
            intent.sha256 !== sha256 || intent.md5 !== md5) fail('conflict');
      } else {
        try { current = await save(current, {...current.multipart,
          pendingPart: {number, size: part.byteLength, sha256, md5}}); }
        catch { return 'unknown'; } // No part PUT is issued before its intent is durable.
      }
      let receipt;
      if (observed.has(number)) receipt = observed.get(number);
      else {
        try { receipt = await r2.uploadPart(entry.key, uploadId, number, part, sha256); }
        catch { return 'unknown'; }
      }
      if (!matchesMd5(receipt.etag, md5) || receipt.size !== part.byteLength) fail('conflict');
      const nextParts = [...current.multipart.completedParts, {number, etag: receipt.etag, sha256}];
      try { current = await save(current, {...current.multipart, completedParts: nextParts, pendingPart: null}); }
      catch { return 'unknown'; }
      completed.push({number, size: part.byteLength, sha256, etag: receipt.etag});
    }
    if (number !== current.multipart.completedParts.length || tracker.size !== entry.size ||
        tracker.hasher.digest('hex') !== entry.sha256) fail('invalid_source');
    try { await r2.completeMultipart(entry, uploadId, completed); }
    catch {
      state = await r2.inspectObject(entry);
      if (state === 'conflict') fail('conflict');
      if (state !== 'matching') return 'unknown';
      current = await save(current, null);
      return 'matching';
    }
    await save(current, null);
    return 'created';
  }

  async function* listObjectKeys() {
    let token = null, last = null;
    for (let page = 0; page < 100_000; page++) {
      const result = await r2.listPage({continuationToken: token});
      for (const item of result.objects) {
        if (last !== null && item.key <= last) fail('invalid_listing');
        last = item.key;
        yield item.key;
      }
      if (result.nextContinuationToken === null) return;
      token = result.nextContinuationToken;
    }
    fail('limit');
  }
  return Object.freeze({inspectObject: entry => r2.inspectObject(entry), putObjectIfAbsent, listObjectKeys});
}
