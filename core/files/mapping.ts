import type { DataModel, RuntimeDataCatalog } from '../data/types.ts';
import { plainRecord } from '../vault/crypto.ts';

export const FILE_STATES = Object.freeze(['staging', 'staged', 'available', 'abandoned', 'deleted'] as const);
export const FILE_POLICY = Object.freeze({ maximumBytes: 10 * 1024 * 1024, maximumNameBytes: 255 });
export class FileError extends Error {
  readonly code: 'invalid_input' | 'invalid_mapping' | 'unsupported' | 'conflict' | 'unavailable' | 'not_found';
  constructor(code: FileError['code']) { super('File operation refused.'); this.name = 'FileError'; this.code = code; }
}
export interface FileStorageFields {
  readonly id: string; readonly objectKey: string; readonly digest: string; readonly byteSize: string;
  readonly contentType: string; readonly filename: string; readonly version: string; readonly state: string;
  readonly intentId: string; readonly generation: string;
}
export interface FileCategory {
  readonly id: string;
  readonly metadataModel: { readonly moduleId: string; readonly kind: 'model'; readonly id: string };
  readonly contextField: string; readonly ownerField: string; readonly storageFields: FileStorageFields;
  readonly mimeTypes: readonly string[]; readonly maxBytes: number; readonly public: boolean;
  readonly permissions: readonly { readonly moduleId: string; readonly kind: 'permission'; readonly id: string }[];
}
const equal = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);
export function ownedModel(catalog: RuntimeDataCatalog, moduleId: string, modelId: string): DataModel {
  const module = catalog.modules.find(item => item.moduleId === moduleId && item.enabled);
  const model = module?.models.find(item => item.modelId === modelId)?.model;
  if (!model || model.public || model.scope !== 'context' || !model.contextField) throw new FileError('invalid_mapping');
  return model;
}
/** Rechecked at the service boundary; a TypeScript cast cannot approve a mapping. */
export function captureFileCategory(catalog: RuntimeDataCatalog, moduleId: string, input: FileCategory): Readonly<FileCategory> {
  if (!plainRecord(input) || !plainRecord(input.metadataModel) || !plainRecord(input.storageFields)
    || input.metadataModel.moduleId !== moduleId || input.metadataModel.kind !== 'model'
    || typeof input.id !== 'string' || input.id.length > 128 || /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.exec(input.id)?.[0] !== input.id
    || typeof input.public !== 'boolean' || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1
    || !Array.isArray(input.permissions) || !input.permissions.length || input.permissions.length > 1000
    || input.permissions.some(ref => !plainRecord(ref) || ref.moduleId !== moduleId || ref.kind !== 'permission' || typeof ref.id !== 'string')
    || !Array.isArray(input.mimeTypes) || !input.mimeTypes.length || input.mimeTypes.length > 1000
    || input.mimeTypes.some(value => typeof value !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(value))) throw new FileError('invalid_mapping');
  const m = Object.freeze({ ...input.storageFields }) as Readonly<FileStorageFields>;
  if (Object.keys(m).sort().join(',') !== 'byteSize,contentType,digest,filename,generation,id,intentId,objectKey,state,version') throw new FileError('invalid_mapping');
  const model = ownedModel(catalog, moduleId, input.metadataModel.id);
  const names = [input.contextField, input.ownerField, ...Object.values(m)];
  if (new Set(names).size !== names.length || model.contextField !== input.contextField || !equal(model.primaryKey, [input.contextField, m.id])) throw new FileError('invalid_mapping');
  const fields = new Map(model.fields.map(field => [field.id, field]));
  for (const name of names) {
    const field = fields.get(name);
    if (!field || !field.protected || field.nullable || field.computed || field.type !== ([m.byteSize, m.version].includes(name) ? 'integer' : 'string')) throw new FileError('invalid_mapping');
  }
  if (!(fields.get(m.byteSize)?.constraints?.minimum! >= 0) || !(fields.get(m.version)?.constraints?.minimum! >= 1)
    || fields.get(m.digest)?.constraints?.minLength !== 64 || fields.get(m.digest)?.constraints?.maxLength !== 64
    || !equal([...(fields.get(m.state)?.constraints?.enum ?? [])].sort(), [...FILE_STATES].sort())) throw new FileError('invalid_mapping');
  for (const columns of [[input.contextField, m.intentId, m.generation], [input.contextField, m.objectKey]])
    if (!model.indexes.some(index => index.unique && equal(index.fields, columns))) throw new FileError('invalid_mapping');
  return Object.freeze({ id: input.id, metadataModel: Object.freeze({ ...input.metadataModel }),
    contextField: input.contextField, ownerField: input.ownerField, storageFields: m,
    mimeTypes: Object.freeze([...input.mimeTypes]), maxBytes: input.maxBytes, public: input.public,
    permissions: Object.freeze(input.permissions.map(ref => Object.freeze({ ...ref }))) });
}
