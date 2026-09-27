import type { DataAccess, DataLease, DataRecord, RuntimeDataCatalog } from '../data/types.ts';
import { ownedModel } from '../files/mapping.ts';
import { createVaultReference, isVaultReference, plainRecord, VaultError, type VaultKeyring } from './crypto.ts';

export interface VaultStorage {
  readonly moduleId: string; readonly modelId: string; readonly contextField: string;
  readonly fields: { readonly id: string; readonly bindingId: string; readonly ciphertext: string; readonly keyId: string; readonly version: string; readonly state: string };
}
export interface VaultMetadata { readonly reference: string; readonly version: number; readonly state: 'active' | 'revoked' }
function reference(value: unknown): string { if (!isVaultReference(value)) throw new VaultError('invalid_input'); return value; }
function binding(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 128 || !value.isWellFormed()
    || /[\u0000-\u001f\u007f]/.test(value) || new TextEncoder().encode(value).length > 128) throw new VaultError('invalid_input');
  return value;
}
function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) >= Number.MAX_SAFE_INTEGER) throw new VaultError('invalid_input');
  return value as number;
}
function capture(storage: VaultStorage, catalog: RuntimeDataCatalog): VaultStorage {
  if (!plainRecord(storage) || !plainRecord(storage.fields)
    || Object.keys(storage).sort().join(',') !== 'contextField,fields,modelId,moduleId'
    || Object.keys(storage.fields).sort().join(',') !== 'bindingId,ciphertext,id,keyId,state,version') throw new VaultError('invalid_input');
  const m = Object.freeze({ ...storage.fields }) as VaultStorage['fields'];
  let model;
  try { model = ownedModel(catalog, storage.moduleId, storage.modelId); } catch { throw new VaultError('invalid_input'); }
  const names = [storage.contextField, ...Object.values(m)];
  if (new Set(names).size !== names.length || model.contextField !== storage.contextField
    || model.primaryKey.join(',') !== [storage.contextField, m.id].join(',')) throw new VaultError('invalid_input');
  for (const name of names) {
    const field = model.fields.find(item => item.id === name);
    if (!field || field.computed || field.nullable || !field.protected || field.type !== (name === m.version ? 'integer' : 'string')) throw new VaultError('invalid_input');
  }
  if (!(model.fields.find(item => item.id === m.version)?.constraints?.minimum! >= 1)
    || [...(model.fields.find(item => item.id === m.state)?.constraints?.enum ?? [])].sort().join(',') !== 'active,revoked') throw new VaultError('invalid_input');
  return Object.freeze({ moduleId: storage.moduleId, modelId: storage.modelId, contextField: storage.contextField, fields: m });
}

/** This protected factory is injected only into trusted server connectors, never UI or module data ports. */
export function createVaultService(options: { data: DataAccess; catalog: RuntimeDataCatalog; storage: VaultStorage; keyring: VaultKeyring }) {
  const storage = capture(options.storage, options.catalog), { data, keyring } = options, m = storage.fields;
  const fields = Object.freeze([storage.contextField, ...Object.values(m)]);
  const port = (lease: DataLease) => data.internalPort(lease, { moduleId: storage.moduleId, modelId: storage.modelId, fields });
  const key = (ref: string) => ({ [m.id]: ref });
  function context(lease: DataLease, ref: string, bindingId: string, version: number) {
    return { moduleId: storage.moduleId, contextId: data.describeLease(lease).contextId, bindingId, reference: ref, version };
  }
  function metadata(row: DataRecord): VaultMetadata {
    const ref = reference(row[m.id]), version = expectedVersion(row[m.version]), state = row[m.state];
    if (state !== 'active' && state !== 'revoked') throw new VaultError('unreadable');
    return Object.freeze({ reference: ref, version, state });
  }
  function where(row: DataRecord): DataRecord {
    return Object.freeze({ [m.version]: expectedVersion(row[m.version]), [m.state]: 'active',
      [m.bindingId]: row[m.bindingId]!, [m.keyId]: row[m.keyId]!, [m.ciphertext]: row[m.ciphertext]! });
  }
  async function active(lease: DataLease, ref: string, bindingId: string): Promise<DataRecord> {
    const row = await port(lease).get(storage.modelId, { key: key(ref) });
    if (!row || row[m.state] !== 'active' || row[m.bindingId] !== bindingId || typeof row[m.ciphertext] !== 'string'
      || (row[m.ciphertext] as string).split('.')[1] !== row[m.keyId]) throw new VaultError('unreadable');
    metadata(row); return row;
  }
  async function fresh(lease: DataLease, ref: string, row: DataRecord): Promise<void> {
    if (!await port(lease).get(storage.modelId, { key: key(ref), where: where(row), fields: [m.id] })) throw new VaultError('conflict');
  }
  return Object.freeze({
    async put(lease: DataLease, input: { readonly secret: string; readonly bindingId: string }): Promise<VaultMetadata> {
      port(lease);
      if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'bindingId,secret') throw new VaultError('invalid_input');
      const secret = input.secret, ref = createVaultReference(), bindingId = binding(input.bindingId);
      const ciphertext = await keyring.seal(context(lease, ref, bindingId, 1), secret);
      await port(lease).create(storage.modelId, { values: { [m.id]: ref, [m.version]: 1, [m.state]: 'active',
        [m.bindingId]: bindingId, [m.ciphertext]: ciphertext, [m.keyId]: keyring.activeKeyId } });
      return Object.freeze({ reference: ref, version: 1, state: 'active' });
    },
    async metadata(lease: DataLease, value: string): Promise<VaultMetadata | null> {
      const ref = reference(value);
      const row = await port(lease).get(storage.modelId, { key: key(ref), fields: [m.id, m.version, m.state] });
      return row ? metadata(row) : null;
    },
    async replace(lease: DataLease, input: { readonly reference: string; readonly bindingId: string; readonly expectedVersion: number; readonly secret: string }): Promise<VaultMetadata> {
      if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'bindingId,expectedVersion,reference,secret') throw new VaultError('invalid_input');
      const ref = reference(input.reference), version = expectedVersion(input.expectedVersion), secret = input.secret, bindingId = binding(input.bindingId);
      const row = await active(lease, ref, bindingId); if (row[m.version] !== version) throw new VaultError('conflict');
      const ciphertext = await keyring.seal(context(lease, ref, bindingId, version + 1), secret);
      await port(lease).patch(storage.modelId, { key: key(ref), where: where(row), compare: { field: m.version, expected: version },
        values: { [m.ciphertext]: ciphertext, [m.keyId]: keyring.activeKeyId } });
      return Object.freeze({ reference: ref, version: version + 1, state: 'active' });
    },
    async rewrap(lease: DataLease, input: { readonly reference: string; readonly bindingId: string; readonly expectedVersion: number }): Promise<VaultMetadata> {
      if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'bindingId,expectedVersion,reference') throw new VaultError('invalid_input');
      const ref = reference(input.reference), version = expectedVersion(input.expectedVersion), bindingId = binding(input.bindingId), row = await active(lease, ref, bindingId);
      if (row[m.version] !== version) throw new VaultError('conflict');
      const clear = await keyring.open(context(lease, ref, bindingId, version), String(row[m.ciphertext]));
      const ciphertext = await keyring.seal(context(lease, ref, bindingId, version + 1), clear);
      await port(lease).patch(storage.modelId, { key: key(ref), where: where(row), compare: { field: m.version, expected: version },
        values: { [m.ciphertext]: ciphertext, [m.keyId]: keyring.activeKeyId } });
      return Object.freeze({ reference: ref, version: version + 1, state: 'active' });
    },
    async revoke(lease: DataLease, input: { readonly reference: string; readonly bindingId: string; readonly expectedVersion: number }): Promise<VaultMetadata> {
      if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'bindingId,expectedVersion,reference') throw new VaultError('invalid_input');
      const ref = reference(input.reference), version = expectedVersion(input.expectedVersion), bindingId = binding(input.bindingId), row = await active(lease, ref, bindingId);
      if (row[m.version] !== version) throw new VaultError('conflict');
      await port(lease).patch(storage.modelId, { key: key(ref), where: where(row), compare: { field: m.version, expected: version }, values: { [m.state]: 'revoked' } });
      return Object.freeze({ reference: ref, version: version + 1, state: 'revoked' });
    },
    async useSecret<T>(lease: DataLease, input: { readonly reference: string; readonly bindingId: string }, consumer: (secret: string) => T | Promise<T>): Promise<T> {
      if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'bindingId,reference') throw new VaultError('invalid_input');
      const ref = reference(input.reference), bindingId = binding(input.bindingId); if (typeof consumer !== 'function') throw new VaultError('invalid_input');
      const row = await active(lease, ref, bindingId);
      const clear = await keyring.open(context(lease, ref, bindingId, expectedVersion(row[m.version])), String(row[m.ciphertext]));
      // Crypto may yield. Recheck both current authorization and the exact record before invoking trusted code.
      await fresh(lease, ref, row);
      return consumer(clear);
    },
  });
}
