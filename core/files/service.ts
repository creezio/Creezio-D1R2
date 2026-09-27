import { DataAccessError, type DataAccess, type DataAction, type DataLease, type DataPlan, type DataPort, type DataRecord, type RuntimeDataCatalog } from '../data/types.ts';
import { plainRecord } from '../vault/crypto.ts';
import { captureFileCategory, FILE_POLICY, FileError, type FileCategory } from './mapping.ts';

export interface FileBucket {
  put(key: string, bytes: Uint8Array, options: { httpMetadata: { contentType: string }; sha256: ArrayBuffer }): Promise<unknown>;
  get(key: string): Promise<{ readonly size: number; readonly body: ReadableStream<Uint8Array> } | null>;
  delete(key: string): Promise<unknown>;
}
export interface StagedFile { readonly fileId: string; readonly intentId: string; readonly generation: string; readonly digest: string }
export interface PrivateFile {
  readonly fileId: string; readonly filename: string; readonly contentType: string; readonly byteSize: number;
  readonly bytes: Uint8Array; readonly headers: Readonly<Record<string, string>>;
}
export interface StageFileInput { readonly ownerId: string; readonly intentId: string; readonly generation: string;
  readonly filename: string; readonly contentType: string; readonly bytes: Uint8Array }
const encoder = new TextEncoder();
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max || !value.isWellFormed()
    || /[\u0000-\u001f\u007f]/.test(value) || encoder.encode(value).length > max) throw new FileError('invalid_input');
  return value;
}
async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), value => value.toString(16).padStart(2, '0')).join('');
}
function captureRef(input: StagedFile): StagedFile {
  if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'digest,fileId,generation,intentId'
    || typeof input.fileId !== 'string' || !/^f1_[0-9a-f]{64}$/.test(input.fileId)
    || typeof input.digest !== 'string' || !/^[0-9a-f]{64}$/.test(input.digest)) throw new FileError('invalid_input');
  return Object.freeze({ fileId: input.fileId, digest: input.digest,
    intentId: string(input.intentId, 128), generation: string(input.generation, 128) });
}
async function objectBytes(bucket: FileBucket, key: string, expectedSize: number, maximum: number): Promise<Uint8Array> {
  let object: Awaited<ReturnType<FileBucket['get']>>;
  try { object = await bucket.get(key); } catch { throw new FileError('unavailable'); }
  if (!object) throw new FileError('not_found');
  if (object.size !== expectedSize || !Number.isSafeInteger(object.size) || object.size < 0 || object.size > maximum) {
    void object.body.cancel().catch(() => {}); throw new FileError('conflict');
  }
  const chunks: Uint8Array[] = [], reader = object.body.getReader(); let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (!(value instanceof Uint8Array) || chunks.length >= FILE_POLICY.maximumChunks
        || value.byteLength > maximum - size || value.byteLength > expectedSize - size) throw new FileError('conflict');
      chunks.push(new Uint8Array(value)); size += value.byteLength;
    }
    if (size !== expectedSize) throw new FileError('conflict');
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof FileError) throw error; throw new FileError('unavailable');
  } finally { reader.releaseLock(); }
}

/** Internal host service. Neither this factory nor its protected data port is a module API. */
export function createFileService(options: { data: DataAccess; catalog: RuntimeDataCatalog; moduleId: string; category: FileCategory; bucket: FileBucket;
  /** Transport-issued owner restriction, additional to module/context permissions. */
  ownerId?: string }) {
  const category = captureFileCategory(options.catalog, options.moduleId, options.category);
  const { data, bucket } = options, moduleId = options.moduleId, m = category.storageFields, modelId = category.metadataModel.id;
  const maximum = Math.min(category.maxBytes, FILE_POLICY.maximumBytes);
  const fields = Object.freeze([category.contextField, category.ownerField, ...Object.values(m)]);
  const policies = options.catalog.modules.find(module => module.moduleId === moduleId)?.permissions ?? [];
  const allowed: Record<DataAction, readonly string[]> = { read: [], create: [], update: [], delete: [] };
  for (const action of ['read', 'create', 'update', 'delete'] as const) allowed[action] = Object.freeze(policies
    .filter(permission => category.permissions.some(ref => ref.id === permission.id)
      && permission.actions.includes(action) && permission.resources.some(ref => ref.moduleId === moduleId && ref.kind === 'file' && ref.id === category.id))
    .map(permission => `${moduleId}:${permission.id}`));
  Object.freeze(allowed);
  function port(lease: DataLease, action: DataAction = 'read'): DataPort {
    if (category.public) throw new FileError('unsupported');
    let permitted = false;
    for (const permission of allowed[action]) {
      try { data.requirePermissions(lease, [permission]); permitted = true; break; }
      catch (error) { if (!(error instanceof DataAccessError) || error.code !== 'forbidden') throw error; }
    }
    if (!permitted) throw new DataAccessError('forbidden');
    return data.internalPort(lease, { moduleId, modelId, fields });
  }
  const key = (ref: StagedFile) => ({ [m.id]: ref.fileId });
  const exact = (ref: StagedFile) => ({ [m.intentId]: ref.intentId, [m.generation]: ref.generation, [m.digest]: ref.digest });
  async function read(lease: DataLease, ref: StagedFile, action: DataAction = 'read'): Promise<DataRecord> {
    const contextId = data.describeLease(lease).contextId;
    const expected = `f1_${await digest(encoder.encode(JSON.stringify([moduleId, category.id, contextId, ref.intentId, ref.generation])))}`;
    if (expected !== ref.fileId) throw new FileError('not_found');
    const row = await port(lease, action).get(modelId, { key: key(ref), where: exact(ref) });
    if (!row || options.ownerId !== undefined && row[category.ownerField] !== options.ownerId) throw new FileError('not_found'); return row;
  }
  function version(row: DataRecord): number {
    const value = row[m.version]; if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) >= Number.MAX_SAFE_INTEGER) throw new FileError('conflict');
    return value as number;
  }
  function snapshot(row: DataRecord): DataRecord {
    return Object.freeze({ [m.state]: row[m.state]!, [m.objectKey]: row[m.objectKey]!, [m.digest]: row[m.digest]!, [m.version]: version(row),
      [m.intentId]: row[m.intentId]!, [m.generation]: row[m.generation]! });
  }
  async function verifiedObject(row: DataRecord): Promise<Uint8Array> {
    const bytes = await objectBytes(bucket, String(row[m.objectKey]), Number(row[m.byteSize]), maximum);
    if (await digest(bytes) !== row[m.digest]) throw new FileError('conflict'); return bytes;
  }
  return Object.freeze({
    async stage(lease: DataLease, input: StageFileInput): Promise<StagedFile> {
      const p = port(lease, 'create');
      if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'bytes,contentType,filename,generation,intentId,ownerId'
        || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength > maximum) throw new FileError('invalid_input');
      const bytes = new Uint8Array(input.bytes), ownerId = string(input.ownerId, 128), intentId = string(input.intentId, 128), generation = string(input.generation, 128);
      if (options.ownerId !== undefined && ownerId !== options.ownerId) throw new FileError('invalid_input');
      const filename = string(input.filename, FILE_POLICY.maximumNameBytes).replace(/[\\/]/g, '_'), contentType = string(input.contentType, 128);
      if (!category.mimeTypes.includes(contentType)) throw new FileError('invalid_input');
      const contextId = data.describeLease(lease).contextId;
      const fileId = `f1_${await digest(encoder.encode(JSON.stringify([moduleId, category.id, contextId, intentId, generation])))}`;
      const checksum = await digest(bytes), objectKey = `creezio/files/v1/${fileId}`;
      const ref = Object.freeze({ fileId, intentId, generation, digest: checksum });
      let row = await p.get(modelId, { key: key(ref) });
      if (!row) {
        try {
          await p.create(modelId, { values: { [m.id]: fileId, [category.ownerField]: ownerId, [m.objectKey]: objectKey,
            [m.digest]: checksum, [m.byteSize]: bytes.length, [m.contentType]: contentType, [m.filename]: filename,
            [m.version]: 1, [m.state]: 'staging', [m.intentId]: intentId, [m.generation]: generation } });
        } catch (error) { row = await p.get(modelId, { key: key(ref) }); if (!row) throw error; }
        row ??= await p.get(modelId, { key: key(ref) });
      }
      if (!row || row[m.digest] !== checksum || row[m.objectKey] !== objectKey || row[category.ownerField] !== ownerId
        || row[m.byteSize] !== bytes.length || row[m.filename] !== filename || row[m.contentType] !== contentType
        || !['staging', 'staged', 'available'].includes(String(row[m.state]))) throw new FileError('conflict');
      // Completed uploads are checked, never overwritten by retries.
      if (row[m.state] !== 'staging') {
        await verifiedObject(row);
        if (!await p.get(modelId, { key: key(ref), where: snapshot(row) })) throw new FileError('conflict');
        return ref;
      }
      try {
        await bucket.put(objectKey, bytes, { httpMetadata: { contentType: 'application/octet-stream' },
          sha256: Uint8Array.from(checksum.match(/../g)!, hex => parseInt(hex, 16)).buffer });
      } catch { throw new FileError('unavailable'); }
      try {
        await p.patch(modelId, { key: key(ref), where: { ...exact(ref), [m.state]: 'staging', [m.objectKey]: objectKey },
          compare: { field: m.version, expected: version(row) }, values: { [m.state]: 'staged' } });
      } catch (error) {
        const current = await read(lease, ref, 'create');
        if (['staged', 'available'].includes(String(current[m.state]))) return ref;
        if (['abandoned', 'deleted'].includes(String(current[m.state]))) {
          // The durable tombstone remains retryable even if compensation fails.
          try { await bucket.delete(objectKey); } catch { /* explicit abandon retries cleanup */ }
        }
        throw error;
      }
      return ref;
    },
    async preparePublication(lease: DataLease, value: StagedFile) {
      const ref = captureRef(value), row = await read(lease, ref, 'update');
      if (!['staged', 'available'].includes(String(row[m.state]))) throw new FileError('conflict');
      await verifiedObject(row);
      // The plan is opaque and executes with the same fresh guard and transaction as business writes.
      const plan = row[m.state] === 'available' ? port(lease, 'update').planGet(modelId, { key: key(ref), where: snapshot(row), required: true })
        : port(lease, 'update').planPatch(modelId, { key: key(ref), where: snapshot(row),
        compare: { field: m.version, expected: version(row) }, values: { [m.state]: 'available' } });
      return Object.freeze({plan,file:Object.freeze({fileId:ref.fileId,filename:String(row[m.filename]),contentType:String(row[m.contentType]),byteSize:Number(row[m.byteSize])})});
    },
    async publicationProof(lease: DataLease, value: StagedFile): Promise<DataPlan> {
      return (await this.preparePublication(lease, value)).plan;
    },
    async readPrivate(lease: DataLease, value: StagedFile): Promise<PrivateFile> {
      const ref = captureRef(value), row = await read(lease, ref);
      if (row[m.state] !== 'available') throw new FileError('not_found');
      const bytes = await verifiedObject(row);
      const fresh = await port(lease).get(modelId, { key: key(ref), where: snapshot(row) });
      if (!fresh) throw new FileError('conflict');
      const filename = String(row[m.filename]);
      return Object.freeze({ fileId: ref.fileId, filename, contentType: String(row[m.contentType]), byteSize: bytes.length, bytes,
        headers: Object.freeze({ 'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
          'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" }) });
    },
    async abandon(lease: DataLease, value: StagedFile): Promise<{ readonly state: 'abandoned'; readonly cleanup: 'delete_confirmed' | 'pending' }> {
      const ref = captureRef(value), row = await read(lease, ref, 'delete'), p = port(lease, 'delete');
      if (!['staging', 'staged', 'abandoned'].includes(String(row[m.state]))) throw new FileError('conflict');
      if (row[m.state] !== 'abandoned') await p.patch(modelId, { key: key(ref), where: snapshot(row),
        compare: { field: m.version, expected: version(row) }, values: { [m.state]: 'abandoned' } });
      // No cross-resource atomicity: repeated calls resume cleanup from the retained tombstone.
      try { await bucket.delete(String(row[m.objectKey])); return Object.freeze({ state: 'abandoned', cleanup: 'delete_confirmed' }); }
      catch { return Object.freeze({ state: 'abandoned', cleanup: 'pending' }); }
    },
  });
}
