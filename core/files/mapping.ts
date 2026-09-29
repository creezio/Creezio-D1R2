import type { ContractReference, DataModel, RuntimeDataCatalog } from '../data/types.ts';
import { plainRecord } from '../vault/crypto.ts';

export const FILE_STATES = Object.freeze(['staging', 'staged', 'available', 'abandoned', 'deleted'] as const);
export const FILE_POLICY = Object.freeze({ maximumBytes: 10 * 1024 * 1024, maximumNameBytes: 255, maximumChunks: 16384 });
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
  readonly ownerScope?: 'principal' | 'principal-audience';
  readonly mimeTypes: readonly string[]; readonly maxBytes: number; readonly public: boolean;
  readonly permissions: readonly { readonly moduleId: string; readonly kind: 'permission'; readonly id: string }[];
  readonly linkedRead?: Readonly<{readonly audiences: readonly ('admin' | 'app')[];
    readonly permission: ContractReference; readonly linkModel: ContractReference;
    readonly parentRelation: string; readonly referenceFields: Readonly<{fileId:string;intentId:string;generation:string;digest:string}>;
    readonly when: Readonly<{field:string;equals:string}>}>;
}
const equal = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const fieldId = (value: unknown): value is string => typeof value === 'string'
  && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value) && value.length <= 128;
export function ownedModel(catalog: RuntimeDataCatalog, moduleId: string, modelId: string): DataModel {
  const module = catalog.modules.find(item => item.moduleId === moduleId && item.enabled);
  const model = module?.models.find(item => item.modelId === modelId)?.model;
  if (!model || model.public || model.scope !== 'context' || !model.contextField) throw new FileError('invalid_mapping');
  return model;
}
function captureLinkedRead(catalog: RuntimeDataCatalog, moduleId: string, category: FileCategory): FileCategory['linkedRead'] {
  const input=category.linkedRead;
  if (input===undefined) return undefined;
  if (!plainRecord(input) || Object.keys(input).sort().join(',')!==
    'audiences,linkModel,parentRelation,permission,referenceFields,when'
    || !Array.isArray(input.audiences) || !input.audiences.length || input.audiences.length>2
    || new Set(input.audiences).size!==input.audiences.length
    || input.audiences.some(audience=>!['admin','app'].includes(audience))
    || !plainRecord(input.permission) || input.permission.moduleId!==moduleId
    || input.permission.kind!=='permission' || !fieldId(input.permission.id)
    || !plainRecord(input.linkModel) || input.linkModel.moduleId!==moduleId
    || input.linkModel.kind!=='model' || !fieldId(input.linkModel.id)
    || !fieldId(input.parentRelation) || !plainRecord(input.referenceFields)
    || Object.keys(input.referenceFields).sort().join(',')!=='digest,fileId,generation,intentId'
    || Object.values(input.referenceFields).some(value=>!fieldId(value))
    || new Set(Object.values(input.referenceFields)).size!==4
    || !plainRecord(input.when) || Object.keys(input.when).sort().join(',')!=='equals,field'
    || !fieldId(input.when.field) || typeof input.when.equals!=='string'
    || !input.when.equals || input.when.equals.length>128 || category.public) throw new FileError('invalid_mapping');
  const module=catalog.modules.find(item=>item.moduleId===moduleId&&item.enabled);
  const metadata=ownedModel(catalog,moduleId,category.metadataModel.id);
  const link=ownedModel(catalog,moduleId,input.linkModel.id);
  const relation=link.relations.find(item=>item.id===input.parentRelation);
  if (!relation || relation.target.moduleId!==moduleId || relation.target.kind!=='model') throw new FileError('invalid_mapping');
  const parent=ownedModel(catalog,moduleId,relation.target.id);
  const context=link.contextField, parentContext=parent.contextField, fileField=input.referenceFields.fileId;
  const names=[context,relation.fields[1],...Object.values(input.referenceFields)];
  if (!metadata.fields.every(field=>field.protected) || !context || !parentContext
    || relation.fields.length!==2 || relation.targetFields.length!==2
    || relation.fields[0]!==context || relation.targetFields[0]!==parentContext
    || !equal(relation.targetFields,parent.primaryKey) || !equal(link.primaryKey,[context,relation.fields[1],fileField])
    || !fieldId(relation.fields[1]) || new Set(names).size!==names.length
    || [fileField,input.referenceFields.intentId,input.referenceFields.generation,input.referenceFields.digest]
      .some(name=>{const field=link.fields.find(item=>item.id===name);return !field||field.type!=='string'||field.nullable||field.computed;})
    || !link.fields.some(field=>field.id===relation.fields[1]&&field.type==='string'&&!field.nullable&&!field.computed)
    || !parent.fields.some(field=>field.id===relation.targetFields[1]&&field.type==='string'&&!field.nullable&&!field.computed)
    || !parent.fields.some(field=>field.id===input.when.field&&field.type==='string'&&!field.nullable
      &&!field.computed&&field.constraints?.enum?.includes(input.when.equals))) throw new FileError('invalid_mapping');
  const permission=module?.permissions.find(item=>item.id===input.permission.id);
  const models=[category.metadataModel.id,link.id,parent.id];
  const has=(refs:readonly ContractReference[],kind:string,id:string)=>refs.some(ref=>
    ref.moduleId===moduleId&&ref.kind===kind&&ref.id===id);
  if (!permission || !permission.actions.includes('read')
    || input.audiences.some(audience=>!permission.audiences.includes(audience))
    || !models.every(id=>has(permission.resources,'model',id))
    || !has(permission.resources,'file',category.id)
    || !models.every(id=>ownedModel(catalog,moduleId,id).permissions.some(ref=>
      ref.moduleId===moduleId&&ref.kind==='permission'&&ref.id===permission.id))) throw new FileError('invalid_mapping');
  return Object.freeze({audiences:Object.freeze([...input.audiences]),permission:Object.freeze({...input.permission}),
    linkModel:Object.freeze({...input.linkModel}),parentRelation:input.parentRelation,
    referenceFields:Object.freeze({...input.referenceFields}),when:Object.freeze({...input.when})});
}
/** Rechecked at the service boundary; a TypeScript cast cannot approve a mapping. */
export function captureFileCategory(catalog: RuntimeDataCatalog, moduleId: string, input: FileCategory): Readonly<FileCategory> {
  if (!plainRecord(input) || !plainRecord(input.metadataModel) || !plainRecord(input.storageFields)
    || input.metadataModel.moduleId !== moduleId || input.metadataModel.kind !== 'model'
    || typeof input.id !== 'string' || input.id.length > 128 || /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.exec(input.id)?.[0] !== input.id
    || typeof input.public !== 'boolean' || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1
    || (input.ownerScope !== undefined && input.ownerScope !== 'principal' && input.ownerScope !== 'principal-audience')
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
    ...(input.ownerScope === undefined ? {} : {ownerScope: input.ownerScope}),
    mimeTypes: Object.freeze([...input.mimeTypes]), maxBytes: input.maxBytes, public: input.public,
    permissions: Object.freeze(input.permissions.map(ref => Object.freeze({ ...ref }))),
    ...(input.linkedRead===undefined?{}:{linkedRead:captureLinkedRead(catalog,moduleId,input)}) });
}
