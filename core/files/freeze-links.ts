import type {DataAccess,DataLease,RuntimeDataCatalog} from '../data/types.ts';
import type {SqlStatement} from '../data/authorization.ts';
import type {FileBucket} from './service.ts';
import {createFileService} from './service.ts';
import type {FileCategory} from './mapping.ts';
import {fileOwnerId} from './catalog.ts';
import type {StagedFileReference} from '../../sdk/files/types.ts';
import {FileError} from './mapping.ts';

export interface FreezeLinksInput {
  readonly sourceModel:string;readonly destinationModel:string;
  readonly sourceScope:Readonly<Record<string,string>>;
  readonly destinationScope:Readonly<Record<string,string>>;
  readonly attachments:readonly Readonly<StagedFileReference & {
    filename:string;contentType:string;byteSize:number}>[];
}
export interface BatchPublicationInput extends FreezeLinksInput {}
const name=(value:string)=>/^[a-z][a-z0-9_]*$/u.test(value)?`"${value}"`:(()=>{throw new FileError('invalid_input')})();
const modelName=(value:string)=>/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)?`"${value}"`:(()=>{throw new FileError('invalid_mapping')})();
const guard=(sql:string,bindings:(string|number|null)[]):SqlStatement=>({sql:
  `SELECT CASE WHEN (${sql}) THEN 1 ELSE json('creezio_file_link_conflict') END AS accepted`,bindings});

/** Host-owned bulk link guard. SQL identifiers come only from the compiled catalog. */
export async function prepareFrozenLinks(options:{data:DataAccess;catalog:RuntimeDataCatalog;lease:DataLease;
  moduleId:string;category:FileCategory;bucket:FileBucket;input:FreezeLinksInput;
  publishStaged?:boolean;connectionGuard?:Readonly<{condition:string;
    bindings:readonly (string|number|null)[]}>}):Promise<readonly SqlStatement[]>{
  const {data,catalog,lease,moduleId,category,input}=options;
  const identity=data.describeLease(lease);
  const installed=catalog.modules.find(item=>item.moduleId===moduleId&&item.enabled);
  const source=installed?.models.find(item=>item.modelId===input.sourceModel);
  const destination=installed?.models.find(item=>item.modelId===input.destinationModel);
  const metadata=installed?.models.find(item=>item.modelId===category.metadataModel.id);
  if(!source||!destination||!metadata||source.model.scope!=='context'||destination.model.scope!=='context'
    ||!Array.isArray(input.attachments)||input.attachments.length>50
    ||source.model.contextField!==destination.model.contextField
    ||!source.model.primaryKey.includes('owner_id')||!destination.model.primaryKey.includes('owner_id'))
    throw new FileError('invalid_mapping');
  const contextField=source.model.contextField!;
  const common=[category.storageFields.id,category.storageFields.filename,category.storageFields.contentType,
    category.storageFields.byteSize,category.storageFields.digest,category.storageFields.intentId,
    category.storageFields.generation];
  const required=[contextField,'owner_id','created_at',...common];
  if(source.model.primaryKey.at(-1)!==category.storageFields.id
    ||destination.model.primaryKey.at(-1)!==category.storageFields.id
    ||required.some(field=>!source.model.fields.some(item=>item.id===field)
      ||!destination.model.fields.some(item=>item.id===field)))throw new FileError('invalid_mapping');
  const keys=(model:typeof source,scope:Readonly<Record<string,string>>)=>{
    const expected=model!.model.primaryKey.filter(field=>![contextField,'owner_id',category.storageFields.id].includes(field));
    if(Object.keys(scope).sort().join(',')!==[...expected].sort().join(',')
      ||Object.values(scope).some(value=>typeof value!=='string'||!value.length||value.length>128
        ||!value.isWellFormed()||/[\u0000-\u001f\u007f]/u.test(value)))throw new FileError('invalid_input');
    return expected;
  };
  const sourceKeys=keys(source,input.sourceScope),destinationKeys=keys(destination,input.destinationScope);
  const fileIds=new Set<string>();let total=0;
  const ownerId=await fileOwnerId(identity.principalId,identity.audience,category.ownerScope);
  const service=createFileService({data,catalog,moduleId,category,bucket:options.bucket,ownerId});
  for(const item of input.attachments){
    if(!item||fileIds.has(item.fileId)||typeof item.filename!=='string'
      ||typeof item.contentType!=='string'||!Number.isSafeInteger(item.byteSize)
      ||item.byteSize<0||(total+=item.byteSize)>10*1024*1024)throw new FileError('invalid_input');
    fileIds.add(item.fileId);
    const file=options.publishStaged
      ?await service.verifyStaged(lease,{fileId:item.fileId,intentId:item.intentId,
        generation:item.generation,digest:item.digest})
      :await service.readPrivate(lease,{fileId:item.fileId,intentId:item.intentId,
        generation:item.generation,digest:item.digest});
    if(file.filename!==item.filename||file.contentType!==item.contentType||file.byteSize!==item.byteSize)
      throw new FileError('conflict');
  }
  const refs=JSON.stringify(input.attachments);
  if(new TextEncoder().encode(refs).length>60_000)throw new FileError('invalid_input');
  const sourceTable=modelName(source.table),destinationTable=modelName(destination.table),
    metadataTable=modelName(metadata.table),m=category.storageFields;
  const sourceWhere=[`s.${name(contextField)}=?`,`s.${name('owner_id')}=?`,
    ...sourceKeys.map(field=>`s.${name(field)}=?`)].join(' AND ');
  const sourceBindings=[identity.contextId,identity.principalId,
    ...sourceKeys.map(field=>input.sourceScope[field])];
  const j=(field:string)=>`json_extract(e.value,'$.${field}')`;
  const expectedMatch=[['fileId',m.id],['filename',m.filename],['contentType',m.contentType],
    ['byteSize',m.byteSize],['digest',m.digest],['intentId',m.intentId],
    ['generation',m.generation]].map(([jsonField,column])=>`s.${name(column)}=${j(jsonField)}`).join(' AND ');
  const sourceCondition=`(SELECT COUNT(*) FROM ${sourceTable} s WHERE ${sourceWhere})=json_array_length(?)
    AND NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN ${sourceTable} s ON ${sourceWhere}
      AND ${expectedMatch} WHERE s.${name(m.id)} IS NULL)`;
  const sourceGuardBindings=[...sourceBindings,refs,refs,...sourceBindings];
  const metadataMatch=[`f.${name(category.contextField)}=?`,`f.${name(category.ownerField)}=?`,
    `f.${name(m.id)}=${j('fileId')}`,
    options.publishStaged?`f.${name(m.state)} IN ('staged','available')`:`f.${name(m.state)}='available'`,
    ...[['digest',m.digest],['byteSize',m.byteSize],['filename',m.filename],
      ['contentType',m.contentType],['intentId',m.intentId],['generation',m.generation]]
      .map(([jsonField,column])=>`f.${name(column)}=${j(jsonField)}`)].join(' AND ');
  const metadataCondition=`NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN ${metadataTable} f
    ON ${metadataMatch} WHERE f.${name(m.id)} IS NULL)`;
  const metadataBindings=[refs,identity.contextId,ownerId];
  const sourceExact=guard(options.publishStaged?`(${sourceCondition}) AND (${metadataCondition})
    AND (${options.connectionGuard?.condition??'0'})`
    :sourceCondition,options.publishStaged?[...sourceGuardBindings,...metadataBindings,
      ...(options.connectionGuard?.bindings??[])]:sourceGuardBindings);
  const metadataExact=guard(metadataCondition,metadataBindings);
  const destinationColumns=[contextField,'owner_id',...destinationKeys,...common,'created_at'];
  const selected=destinationColumns.map(field=>field===contextField?'?':field==='owner_id'?'?'
    :destinationKeys.includes(field)?'?':field==='created_at'?"strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    :`s.${name(field)}`);
  const insert:SqlStatement={sql:`INSERT INTO ${destinationTable} (${destinationColumns.map(name).join(',')})
    SELECT ${selected.join(',')} FROM ${sourceTable} s WHERE ${sourceWhere}`,
    bindings:[identity.contextId,identity.principalId,
      ...destinationKeys.map(field=>input.destinationScope[field]),...sourceBindings]};
  if(!options.publishStaged)return Object.freeze([sourceExact,metadataExact,insert]);
  const transition:SqlStatement={sql:`UPDATE ${metadataTable} SET ${name(m.state)}='available',
    ${name(m.version)}=${name(m.version)}+1 WHERE ${name(category.contextField)}=?
    AND ${name(category.ownerField)}=? AND ${name(m.state)}='staged'
    AND ${name(m.id)} IN (SELECT ${j('fileId')} FROM json_each(?) e)`,
    bindings:[identity.contextId,ownerId,refs]};
  return Object.freeze([sourceExact,transition,insert]);
}
