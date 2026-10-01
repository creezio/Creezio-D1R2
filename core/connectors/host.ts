import type {AuthorizationActor,AuthorizationAudience} from '../authorization/types.ts';
import {DataAccessError,type DataAccess,type DataCredential,type DataLease,type RuntimeDataCatalog,
  type DataPlan,type DataRecord,type JsonValue} from '../data/types.ts';
import {isVaultReference,VaultError,type VaultKeyring} from '../vault/crypto.ts';
import {createVaultService} from '../vault/service.ts';
import {copyJson} from '../data/input.ts';
import type {ConnectorDescriptor,ConnectorRequest,ConnectorMutationRequest,ConnectorResource,
  ConnectorResult,ConnectorPort} from '../../sdk/connectors/types.ts';

const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const segment=/^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const MAX_BODY=1_048_576;
const MAX_WRITE_BODY=65_536;
const MAX_ATTACHMENT_BODY=14_500_000;
const MAX_BINARY_CHUNKS=16_384;
const MAX_CALLS=1;
const TIMEOUT_MS=10_000;
const queryName=(value:string)=>typeof value==='string'&&value.length<=64
  &&/^[A-Za-z_]/.test(value)&&!/[^A-Za-z0-9_]/.test(value);
const headerName=(value:string)=>typeof value==='string'&&value.length<=64
  &&/^[A-Za-z]/.test(value)&&!/[^A-Za-z0-9-]/.test(value);
const printable=(value:unknown,max:number)=>typeof value==='string'&&value.length>=1
  &&value.length<=max&&!/[^\x20-\x7e]/.test(value);
const forbiddenHeaders=new Set(['authorization','proxy-authorization','host','cookie','set-cookie',
  'origin','referer','accept','accept-encoding','content-length','content-type','connection','upgrade',
  'te','trailer','transfer-encoding','cache-control','range','user-agent','forwarded']);
const forbiddenPrefixes=['proxy-','sec-','if-'];
const forbiddenX=/^x-(?:forwarded|real|original|http|method|override|host|cookie|origin|proxy|cf|amz)(?:-|$)/;
const wireName=/^[A-Za-z][A-Za-z0-9_]*(?:\[(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\])*$/;
const forbiddenHeader=(name:string)=>{const lower=name.toLowerCase();
  return forbiddenHeaders.has(lower)||forbiddenPrefixes.some(prefix=>lower.startsWith(prefix))
    ||forbiddenX.test(lower);};
const error=(code:Extract<ConnectorResult,{kind:'error'}>['code'],status?:number):ConnectorResult=>
  Object.freeze({kind:'error',code,...(status===undefined?{}:{status})});

/** Syntax check only. Network egress policy must separately address DNS rebinding. */
export function connectorOrigin(value:unknown):string|null{
  if(typeof value!=='string'||value.length>2048||!value.isWellFormed())return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'
      ||url.hostname.endsWith('.')
      ||url.hostname==='localhost'||url.hostname.endsWith('.localhost')
      ||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal')
      ||url.hostname.includes(':')||/^\d+(?:\.\d+){3}$/.test(url.hostname)
      ||value!==url.origin&&value!==`${url.origin}/`)return null;
    return url.origin;
  }catch{return null;}
}

function checkedResource(value:ConnectorResource):ConnectorResource{
  if(!value||!identifier.test(value.id)||!['GET','POST','PUT','PATCH','DELETE'].includes(value.method)
    ||typeof value.path!=='string'
    ||!value.path.startsWith('/')||value.path.startsWith('//')||/[?#%\\]/.test(value.path)
    ||!Array.isArray(value.params)||new Set(value.params).size!==value.params.length
    ||value.params.some(item=>!['id','cursor','limit'].includes(item)))throw new VaultError('invalid_input');
  const parts=value.path.slice(1).split('/');
  if(parts.some(item=>item!== '{id}'&&(!segment.test(item)||item==='.'||item==='..'))
    ||parts.filter(item=>item==='{id}').length>1
    ||parts.includes('{id}')!==value.params.includes('id'))throw new VaultError('invalid_input');
  const query=value.query;
  if(query!==undefined){
    if(!query||typeof query!=='object'||Array.isArray(query)
      ||Object.keys(query).some(key=>!['cursor','limit','fixed','fields'].includes(key))
      ||query.cursor!==undefined&&(!value.params.includes('cursor')||!queryName(query.cursor))
      ||query.limit!==undefined&&(!value.params.includes('limit')||!queryName(query.limit))
      ||query.fixed!==undefined&&(!Array.isArray(query.fixed)||query.fixed.length>8
        ||query.fixed.some(item=>!item||!queryName(item.name)||!printable(item.value,256)))
      ||query.fields!==undefined&&(!Array.isArray(query.fields)||query.fields.length>16
        ||query.fields.some(field=>!field||!queryName(field.name)||!queryName(field.wireName)
          ||!['string','integer','boolean'].includes(field.kind)
          ||field.required!==undefined&&typeof field.required!=='boolean'
          ||!Number.isSafeInteger(field.maxBytes)||field.maxBytes<1||field.maxBytes>2048)
        ||new Set(query.fields.map(field=>field.name)).size!==query.fields.length))
      throw new VaultError('invalid_input');
    const dynamic=[...(value.params.includes('cursor')?[query.cursor??'cursor']:[]),
      ...(value.params.includes('limit')?[query.limit??'limit']:[])];
    const names=[...dynamic,...(query.fixed??[]).map(item=>item.name),
      ...(query.fields??[]).map(item=>item.wireName)];
    if(new Set(names).size!==names.length)throw new VaultError('invalid_input');
  }
  const write=value.method!=='GET',body=value.body,success=value.successStatuses;
  const attachments=value.attachments;
  if(attachments!==undefined&&(!write||body?.encoding!=='json'
    ||!wireName.test(attachments.wireName)||body.fields.some(field=>field.wireName===attachments.wireName)
    ||!Number.isSafeInteger(attachments.maxItems)||attachments.maxItems<1||attachments.maxItems>50
    ||!Number.isSafeInteger(attachments.maxBytes)||attachments.maxBytes<1
    ||attachments.maxBytes>10*1024*1024))throw new VaultError('invalid_input');
  if(write&&value.params.some(item=>item!=='id')||!write&&(body!==undefined||value.idempotencyHeader!==undefined)
    ||write&&query!==undefined&&('cursor' in query||'limit' in query)
    ||write&&query?.fields?.length
    ||body!==undefined&&(!write||!['form','json','json-root'].includes(body.encoding)
      ||!Array.isArray(body.fields)||body.fields.length<1||body.fields.length>32
      ||body.encoding==='json-root'&&(body.fields.length!==1||body.fields[0].kind!=='json'
        ||body.fixed!==undefined)
      ||body.fields.some(field=>!field||!queryName(field.name)||!wireName.test(field.wireName)
        ||body.encoding!=='form'&&field.wireName.includes('[')
        ||!['string','integer','boolean','json'].includes(field.kind)
        ||body.encoding==='form'&&field.kind==='json'
        ||field.required!==undefined&&typeof field.required!=='boolean'
        ||!Number.isSafeInteger(field.maxBytes)||field.maxBytes<1||field.maxBytes>MAX_WRITE_BODY)
      ||body.fixed!==undefined&&(!Array.isArray(body.fixed)||body.fixed.length>8
        ||body.fixed.some(item=>!item||!wireName.test(item.name)||!printable(item.value,256)))
      ||new Set(body.fields.map(item=>item.name)).size!==body.fields.length
      ||new Set([...body.fields.map(item=>item.wireName),...(body.fixed??[]).map(item=>item.name)]).size
        !==body.fields.length+(body.fixed?.length??0))
    ||value.idempotencyHeader!==undefined&&(!write||!headerName(value.idempotencyHeader)
      ||forbiddenHeader(value.idempotencyHeader))
    ||success!==undefined&&(!Array.isArray(success)||success.length<1||success.length>4
      ||new Set(success).size!==success.length
      ||success.some(status=>!Number.isSafeInteger(status)||status<200||status>299))
    ||value.responseBody!==undefined&&!['json','none'].includes(value.responseBody))
    throw new VaultError('invalid_input');
  return Object.freeze({id:value.id,method:value.method,path:value.path,params:Object.freeze([...value.params]),
    ...(query===undefined?{}:{query:Object.freeze({
      ...(query.cursor===undefined?{}:{cursor:query.cursor}),...(query.limit===undefined?{}:{limit:query.limit}),
      ...(query.fixed===undefined?{}:{fixed:Object.freeze(query.fixed.map(item=>Object.freeze({...item})))}),
      ...(query.fields===undefined?{}:{fields:Object.freeze(query.fields.map(item=>Object.freeze({...item})))})})}),
    ...(body===undefined?{}:{body:Object.freeze({encoding:body.encoding,
      fields:Object.freeze(body.fields.map(item=>Object.freeze({...item}))),
      ...(body.fixed===undefined?{}:{fixed:Object.freeze(body.fixed.map(item=>Object.freeze({...item})))})})}),
    ...(attachments===undefined?{}:{attachments:Object.freeze({...attachments})}),
    ...(value.idempotencyHeader===undefined?{}:{idempotencyHeader:value.idempotencyHeader}),
    ...(success===undefined?{}:{successStatuses:Object.freeze([...success])}),
    ...(value.responseBody===undefined?{}:{responseBody:value.responseBody})});
}

/** A compiled descriptor is validated before it can influence an outbound request. */
export function captureConnectorDescriptor(value:ConnectorDescriptor):ConnectorDescriptor{
  if(!value||!identifier.test(value.id)||!identifier.test(value.moduleId)
    ||value.config?.moduleId!==value.moduleId||value.vault?.moduleId!==value.moduleId
    ||!identifier.test(value.config.modelId)||!identifier.test(value.vault.modelId)
    ||!Array.isArray(value.resources)||value.resources.length<1||value.resources.length>16)
    throw new VaultError('invalid_input');
  const auth=value.auth;
  if(!auth||auth.kind!=='bearer'&&auth.kind!=='api-key-header')throw new VaultError('invalid_input');
  if(auth.kind==='api-key-header'&&(!/^X-[A-Za-z0-9-]{1,62}$/i.test(auth.name)
    ||/^x-(?:forwarded|real|original|http|method|override|host|cookie|origin|proxy|cf|amz)(?:-|$)/i.test(auth.name)))
    throw new VaultError('invalid_input');
  if(value.fixedOrigin!==undefined&&(!connectorOrigin(value.fixedOrigin)
    ||connectorOrigin(value.fixedOrigin)!==value.fixedOrigin))throw new VaultError('invalid_input');
  if(value.mutationSecretPrefix!==undefined&&(!/^[A-Za-z0-9_-]{1,32}$/.test(value.mutationSecretPrefix)))
    throw new VaultError('invalid_input');
  const webhook=value.webhook;
  if(webhook!==undefined&&(!/^\/api\/webhooks\/[a-z][a-z0-9-]{0,63}$/u.test(webhook.path)
    ||!identifier.test(webhook.operationId)||!['stripe','standard','resend'].includes(webhook.scheme)
    ||!/^module\/[A-Za-z0-9._/-]+\.ts$/u.test(webhook.mapper.path)
    ||webhook.mapper.path.includes('..')||!identifier.test(webhook.mapper.export)
    ||Object.values(webhook.fields).length!==7
    ||Object.values(webhook.fields).some(value=>!identifier.test(value))))
    throw new VaultError('invalid_input');
  const staticHeaders=value.staticHeaders??[];
  if(!Array.isArray(staticHeaders)||staticHeaders.length>8
    ||staticHeaders.some(item=>!item||!headerName(item.name)||forbiddenHeader(item.name)
      ||auth.kind==='api-key-header'&&item.name.toLowerCase()===auth.name.toLowerCase()
      ||!printable(item.value,256))
    ||new Set(staticHeaders.map(item=>item.name.toLowerCase())).size!==staticHeaders.length)
    throw new VaultError('invalid_input');
  const resources=value.resources.map(checkedResource);
  if(new Set(resources.map(item=>item.id)).size!==resources.length
    ||resources.some(item=>item.idempotencyHeader&&staticHeaders.some(header=>
      header.name.toLowerCase()===item.idempotencyHeader!.toLowerCase())))
    throw new VaultError('invalid_input');
  const binaryDownloads=value.binaryDownloads??[];
  if(!Array.isArray(binaryDownloads)||binaryDownloads.length>4
    ||new Set(binaryDownloads.map(item=>item.id)).size!==binaryDownloads.length
    ||binaryDownloads.some(item=>!item||!identifier.test(item.id)||!identifier.test(item.proofOperationId)
      ||!value.config.fields.connectionId||!identifier.test(value.config.fields.connectionId)
      ||typeof item.metadataPath!=='string'||!/^\/(?:[A-Za-z0-9_-]+|\{parentId\}|\{childId\})(?:\/(?:[A-Za-z0-9_-]+|\{parentId\}|\{childId\}))*$/.test(item.metadataPath)
      ||item.metadataPath.split('{parentId}').length!==2||item.metadataPath.split('{childId}').length!==2
      ||typeof item.cdnPath!=='string'||!/^\/(?:[A-Za-z0-9_-]+|\{parentId\}|\{childId\})(?:\/(?:[A-Za-z0-9_-]+|\{parentId\}|\{childId\}))*$/.test(item.cdnPath)
      ||item.cdnPath.split('{parentId}').length!==2||item.cdnPath.split('{childId}').length!==2
      ||!connectorOrigin(item.cdnOrigin)||item.cdnOrigin!==connectorOrigin(item.cdnOrigin)
      ||!Number.isSafeInteger(item.maxBytes)||item.maxBytes<1||item.maxBytes>10*1024*1024
      ||!item.event||Object.values(item.event).some(part=>typeof part!=='string'||!identifier.test(part))))
    throw new VaultError('invalid_input');
  return Object.freeze({id:value.id,moduleId:value.moduleId,config:Object.freeze({...value.config,
    fields:Object.freeze({...value.config.fields})}),vault:Object.freeze({...value.vault,
    fields:Object.freeze({...value.vault.fields})}),auth:Object.freeze({...auth}),resources:Object.freeze(resources),
    ...(value.fixedOrigin===undefined?{}:{fixedOrigin:value.fixedOrigin}),
    ...(value.mutationSecretPrefix===undefined?{}:{mutationSecretPrefix:value.mutationSecretPrefix}),
    ...(webhook===undefined?{}:{webhook:Object.freeze({...webhook,
      mapper:Object.freeze({...webhook.mapper}),fields:Object.freeze({...webhook.fields})})}),
    ...(value.staticHeaders===undefined?{}:{staticHeaders:Object.freeze(staticHeaders.map(item=>Object.freeze({...item})))}),
    ...(value.binaryDownloads===undefined?{}:{binaryDownloads:Object.freeze(binaryDownloads.map(item=>
      Object.freeze({...item,event:Object.freeze({...item.event})})))})});
}

function requestUrl(origin:string,resource:ConnectorResource,input:ConnectorRequest):URL|null{
  if(!input||input.resource!==resource.id)return null;
  const keys=Object.keys(input);
  if(keys.some(key=>!['resource','id','cursor','limit','fields','signal','sourceProof'].includes(key)))return null;
  for(const key of ['id','cursor','limit'] as const)if(input[key]!==undefined&&!resource.params.includes(key))return null;
  if(resource.params.includes('id')&&(!input.id||!identifier.test(input.id))
    ||input.id!==undefined&&!identifier.test(input.id)
    ||input.cursor!==undefined&&(typeof input.cursor!=='string'||!input.cursor.length
      ||input.cursor.length>2048||!input.cursor.isWellFormed()||/[\u0000-\u001f\u007f]/.test(input.cursor))
    ||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100))return null;
  const path=resource.path.replace('{id}',encodeURIComponent(input.id??''));
  const url=new URL(path,origin);
  for(const item of resource.query?.fixed??[])url.searchParams.set(item.name,item.value);
  if(input.cursor!==undefined)url.searchParams.set(resource.query?.cursor??'cursor',input.cursor);
  if(input.limit!==undefined)url.searchParams.set(resource.query?.limit??'limit',String(input.limit));
  let fields:JsonValue;
  try{fields=copyJson(input.fields??{},8192);}catch{return null;}
  if(!fields||typeof fields!=='object'||Array.isArray(fields))return null;
  const fieldValues=fields as Record<string,JsonValue>;
  const declared=resource.query?.fields??[];
  if(Object.keys(fieldValues).some(name=>!declared.some(field=>field.name===name))
    ||declared.some(field=>field.required&&!(field.name in fieldValues)))return null;
  for(const field of declared){
    if(!(field.name in fieldValues))continue;
    const value=fieldValues[field.name];
    if(field.kind==='string'&&typeof value!=='string'
      ||field.kind==='integer'&&(typeof value!=='number'||!Number.isSafeInteger(value))
      ||field.kind==='boolean'&&typeof value!=='boolean')return null;
    const encoded=String(value);
    if(new TextEncoder().encode(encoded).length>field.maxBytes)return null;
    url.searchParams.set(field.wireName,encoded);
  }
  return url.href.length<=8192?url:null;
}

async function boundedJson(response:Response):Promise<{valid:true;body:JsonValue}|{valid:false}>{
  if(!/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))return {valid:false};
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>MAX_BODY)return {valid:false};
  if(!response.body)return {valid:false};
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const item=await reader.read();if(item.done)break;
      size+=item.value.byteLength;if(size>MAX_BODY)return {valid:false};chunks.push(item.value);}
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {valid:true,body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as JsonValue};
  }catch{return {valid:false};}finally{void reader.cancel().catch(()=>{});}
}

export interface ConnectorHostOptions {
  readonly data:DataAccess;
  readonly catalog:RuntimeDataCatalog;
  readonly descriptor:ConnectorDescriptor;
  readonly keyring:VaultKeyring|null;
  readonly fetcher?:typeof fetch;
}
export interface ConnectorOperationScope {
  readonly lease:DataLease;
  readonly credential:DataCredential;
  readonly contextId:string;
  readonly audience:AuthorizationAudience;
  readonly actors:readonly AuthorizationActor[];
  readonly requiredPermissionIds:readonly string[];
  readonly signal:AbortSignal;
  /** Persisted operation claim; the host derives the provider key from this value. */
  readonly executionId?:string;
  /** Delivery-only fence against the configuration captured by the durable intent. */
  readonly expectedConfigRevision?:number;
  /** The operation engine invalidates this lease when the handler completes or times out. */
  readonly ensureActive:()=>void;
  /** Host-only signals used by the operation claim when an external write may have happened. */
  readonly markMutationAttempted?:()=>void;
  readonly markMutationUnknown?:()=>void;
  readonly markMutationSucceeded?:()=>void;
  /** Host-only: command GET proof is asserted in the same D1 batch as its projection. */
  readonly registerCommitGuards?:(plans:readonly DataPlan[])=>void;
}
export interface BinaryDownloadInput {
  readonly remoteId:string;readonly parentId:string;readonly childId:string;
  readonly sourceProof:Readonly<{connectionId:string;configRevision:number}>;
  readonly expected:Readonly<{filename:string;contentType:string;byteSize:number}>;
}

function mutationBody(resource:ConnectorResource,input:ConnectorMutationRequest):string|null{
  const source=copyJson(input.fields,MAX_WRITE_BODY);
  if(!source||typeof source!=='object'||Array.isArray(source))return null;
  const fieldValues=source as Record<string,JsonValue>;
  const body=resource.body;
  if(!body)return Object.keys(fieldValues).length===0?'':null;
  if(Object.keys(fieldValues).some(name=>!body.fields.some(field=>field.name===name))
    ||body.fields.some(field=>field.required&&!(field.name in fieldValues)))return null;
  const values:Record<string,JsonValue>=Object.create(null);
  for(const item of body.fixed??[])values[item.name]=item.value;
  for(const field of body.fields){
    if(!(field.name in fieldValues))continue;
    const value=fieldValues[field.name];
    if(field.kind==='string'&&typeof value!=='string'
      ||field.kind==='integer'&&(!Number.isSafeInteger(value)||typeof value!=='number')
      ||field.kind==='boolean'&&typeof value!=='boolean'
      ||field.kind==='json'&&(value===null||typeof value!=='object'))return null;
    const encoded=field.kind==='json'?JSON.stringify(value):String(value);
    if(new TextEncoder().encode(encoded).length>field.maxBytes)return null;
    values[field.wireName]=value;
  }
  const binary=input.attachments??[];
  if(binary.length){
    const policy=resource.attachments;
    if(!policy||binary.length>policy.maxItems||body.encoding!=='json')return null;
    let total=0;
    const encoded:JsonValue[]=[];
    for(const item of binary){
      if(!item||!(item.bytes instanceof Uint8Array)||!item.bytes.length
        ||!printable(item.filename,255)||!printable(item.contentType,128)
        ||(total+=item.bytes.length)>policy.maxBytes)return null;
      let content='';
      for(let offset=0;offset<item.bytes.length;offset+=6144)
        content+=btoa(String.fromCharCode(...item.bytes.subarray(offset,offset+6144)));
      encoded.push({filename:item.filename,content:content});
    }
    values[policy.wireName]=encoded;
  }
  if(body.encoding==='json-root'){
    const field=body.fields[0];
    if(!(field.name in fieldValues))return null;
    const encoded=JSON.stringify(fieldValues[field.name]);
    return new TextEncoder().encode(encoded).length<=MAX_WRITE_BODY?encoded:null;
  }
  const encoded=body.encoding==='form'
    ?new URLSearchParams(Object.entries(values).map(([key,value])=>[key,String(value)])).toString()
    :JSON.stringify(values);
  return new TextEncoder().encode(encoded).length<=(binary.length?MAX_ATTACHMENT_BODY:MAX_WRITE_BODY)?encoded:null;
}

/** Separate from the OpenAI transport: one declared GET, scoped config and vault, no module credential. */
export function createConnectorHost(options:ConnectorHostOptions){
  const descriptor=captureConnectorDescriptor(options.descriptor),{data,catalog}=options;
  const cf=descriptor.config.fields;
  const configFields=[descriptor.config.contextField,...Object.values(cf).filter((value):value is string=>
    typeof value==='string')];
  const module=catalog.modules.find(item=>item.moduleId===descriptor.moduleId&&item.enabled);
  const configModel=module?.models.find(item=>item.modelId===descriptor.config.modelId)?.model;
  const vaultModel=module?.models.find(item=>item.modelId===descriptor.vault.modelId)?.model;
  if(!configModel||configModel.contextField!==descriptor.config.contextField
    ||configModel.primaryKey.join(',')!==[descriptor.config.contextField,cf.id].join(',')
    ||new Set(configFields).size!==configFields.length
    ||configFields.some(field=>!configModel.fields.some(item=>item.id===field))
    ||!vaultModel||vaultModel.contextField!==descriptor.vault.contextField)
    throw new VaultError('invalid_input');
  const vault=options.keyring?createVaultService({data,catalog,storage:descriptor.vault,keyring:options.keyring}):null;
  const read=(lease:DataLease)=>data.internalPort(lease,{moduleId:descriptor.moduleId,
    modelId:descriptor.config.modelId,fields:configFields}).get(descriptor.config.modelId,{key:{[cf.id]:descriptor.id}});
  const usable=(row:DataRecord|null)=>!!row&&row[cf.id]===descriptor.id&&row[cf.enabled]===true
    &&connectorOrigin(row[cf.origin])!==null&&isVaultReference(row[cf.keyRef])
    &&Number.isSafeInteger(row[cf.secretVersion])&&Number(row[cf.secretVersion])>=1;
  const matchingSecret=async(lease:DataLease,row:DataRecord)=>{
    if(!vault)return false;
    const meta=await vault.metadata(lease,String(row[cf.keyRef]));
    return meta?.state==='active'&&meta.version===row[cf.secretVersion];
  };
  const binaryPolicy=(id:string)=>descriptor.binaryDownloads?.find(item=>item.id===id);
  const binaryId=(id:unknown)=>typeof id==='string'&&identifier.test(id);
  const binaryPath=(template:string,parentId:string,childId:string)=>template
    .replace('{parentId}',encodeURIComponent(parentId)).replace('{childId}',encodeURIComponent(childId));
  async function checkedSource(scope:ConnectorOperationScope,input:Pick<BinaryDownloadInput,'remoteId'|'sourceProof'> &
    Partial<Pick<BinaryDownloadInput,'parentId'|'childId'>>,checkEvent:boolean){
    scope.ensureActive();
    const policy=binaryPolicy(input.remoteId),proof=input.sourceProof;
    if(!policy||!cf.connectionId||checkEvent&&(!binaryId(input.parentId)||!binaryId(input.childId))
      ||!proof||!binaryId(proof.connectionId)||!Number.isSafeInteger(proof.configRevision)
      ||proof.configRevision<1)throw new VaultError('invalid_input');
    const original=data.describeLease(scope.lease);
    const lease=await data.authorize(scope.credential,{contextId:scope.contextId,audience:scope.audience,
      actors:scope.actors,requiredPermissionIds:scope.requiredPermissionIds,purpose:'operation'},
      {moduleId:descriptor.moduleId});
    try{
      const identity=data.describeLease(lease);
      if(identity.contextId!==original.contextId||identity.audience!==original.audience
        ||identity.principalId!==original.principalId||identity.actorPrincipalId!==original.actorPrincipalId)
        throw new VaultError('conflict');
      const row=await read(lease);
      if(!vault||!usable(row)||row![cf.connectionId]!==proof.connectionId
        ||row![cf.revision]!==proof.configRevision
        ||descriptor.fixedOrigin&&connectorOrigin(row![cf.origin])!==descriptor.fixedOrigin
        ||!await matchingSecret(lease,row!))throw new VaultError('conflict');
      if(checkEvent){
        const e=policy.event;
        const eventModel=module!.models.find(item=>item.modelId===e.modelId)?.model;
        const eventIndex=eventModel?.indexes.find(item=>item.id===e.indexId);
        if(!eventModel||!eventIndex)throw new VaultError('invalid_input');
        const events=await data.internalPort(lease,{moduleId:descriptor.moduleId,modelId:e.modelId,
          fields:[...new Set([e.connectionField,e.parentField,e.typeField,
            ...eventIndex.fields,...eventModel.primaryKey])]}).list(e.modelId,{limit:50,
          where:{[e.connectionField]:proof.connectionId,[e.parentField]:input.parentId!},
          order:{indexId:e.indexId,direction:'desc'}});
        if(!events.items.some(item=>item[e.typeField]===e.typeValue))throw new VaultError('conflict');
      }
      scope.ensureActive();
      return {lease,row:row!,policy};
    }catch(error){data.dispose(lease);throw error;}
  }
  function binaryGuard(scope:ConnectorOperationScope,input:Pick<BinaryDownloadInput,'remoteId'|'sourceProof'> &
    Partial<Pick<BinaryDownloadInput,'parentId'>>,row:DataRecord){
    const vf=descriptor.vault.fields,reference=String(row[cf.keyRef]),version=Number(row[cf.secretVersion]);
    const table=(modelId:string)=>{
      const value=module!.models.find(item=>item.modelId===modelId)?.table;
      if(!value||!(/^[A-Za-z_][A-Za-z0-9_]*$/u).test(value))throw new VaultError('invalid_input');
      return `"${value}"`;
    };
    const col=(value:string)=>{
      if(!(/^[a-z][a-z0-9_]*$/u).test(value))throw new VaultError('invalid_input');
      return `"${value}"`;
    };
    const configTable=table(descriptor.config.modelId),vaultTable=table(descriptor.vault.modelId);
    const c=(value:string)=>`c.${col(value)}`,v=(value:string)=>`v.${col(value)}`;
    let condition=`EXISTS(SELECT 1 FROM ${configTable} c JOIN ${vaultTable} v
      ON ${v(descriptor.vault.contextField)}=${c(descriptor.config.contextField)}
      AND ${v(vf.id)}=${c(cf.keyRef)} WHERE ${c(descriptor.config.contextField)}=?
      AND ${c(cf.id)}=? AND ${c(cf.connectionId!)}=? AND ${c(cf.revision)}=?
      AND ${c(cf.enabled)}=1 AND ${c(cf.origin)}=? AND ${c(cf.keyRef)}=?
      AND ${c(cf.secretVersion)}=? AND ${v(vf.version)}=?
      AND ${v(vf.state)}='active' AND ${v(vf.bindingId)}=?)`;
    const bindings:(string|number|null)[]=[scope.contextId,descriptor.id,input.sourceProof.connectionId,
      input.sourceProof.configRevision,String(row[cf.origin]),reference,version,version,descriptor.id];
    if(input.parentId!==undefined){
      const event=binaryPolicy(input.remoteId)!.event,eventTable=table(event.modelId);
      const w=(value:string)=>`w.${col(value)}`;
      condition+=` AND EXISTS(SELECT 1 FROM ${eventTable} w WHERE
        ${w(descriptor.config.contextField)}=? AND ${w(event.connectionField)}=?
        AND ${w(event.parentField)}=? AND ${w(event.typeField)}=?)`;
      bindings.push(scope.contextId,input.sourceProof.connectionId,input.parentId,event.typeValue);
    }
    return Object.freeze({condition,bindings:Object.freeze(bindings)});
  }
  return Object.freeze({
    descriptor,
    async sourceGuard(scope:ConnectorOperationScope,input:Pick<BinaryDownloadInput,'remoteId'|'sourceProof'> &
      Partial<Pick<BinaryDownloadInput,'parentId'|'childId'>>){
      const checked=await checkedSource(scope,input,input.parentId!==undefined);
      try{return binaryGuard(scope,input,checked.row);}finally{data.dispose(checked.lease);}
    },
    async downloadBinary(scope:ConnectorOperationScope,input:BinaryDownloadInput):Promise<Uint8Array>{
      const expected=input.expected;
      if(!expected||typeof expected.filename!=='string'||!expected.filename||expected.filename.length>255
        ||!expected.filename.isWellFormed()||/[\\/\u0000-\u001f\u007f]/u.test(expected.filename)
        ||new TextEncoder().encode(expected.filename).length>255
        ||typeof expected.contentType!=='string'||!expected.contentType||expected.contentType.length>128
        ||!expected.contentType.isWellFormed()||/[\u0000-\u001f\u007f]/u.test(expected.contentType)
        ||!Number.isSafeInteger(expected.byteSize)||expected.byteSize<0
        ||expected.byteSize>(binaryPolicy(input.remoteId)?.maxBytes??0))
        throw new VaultError('invalid_input');
      const first=await checkedSource(scope,input,true),policy=first.policy;
      let metadata:Response;
      try{
        const url=new URL(binaryPath(policy.metadataPath,input.parentId,input.childId),String(first.row[cf.origin]));
        const signal=AbortSignal.any([scope.signal,AbortSignal.timeout(TIMEOUT_MS)]);
        metadata=await vault!.useSecret(first.lease,{reference:String(first.row[cf.keyRef]),bindingId:descriptor.id},
          async secret=>{
            const headers=new Headers({accept:'application/json'});
            if(descriptor.auth.kind==='bearer')headers.set('Authorization',`Bearer ${secret}`);
            else headers.set(descriptor.auth.name,secret);
            return (options.fetcher??fetch)(url,{method:'GET',headers,redirect:'manual',credentials:'omit',
              referrerPolicy:'no-referrer',cache:'no-store',signal});
          });
      }finally{data.dispose(first.lease);}
      if(metadata.status!==200){void metadata.body?.cancel().catch(()=>{});throw new VaultError('unavailable');}
      const body=await boundedJson(metadata);
      if(!body.valid||!body.body||typeof body.body!=='object'||Array.isArray(body.body))
        throw new VaultError('invalid_input');
      const meta=body.body as Record<string,JsonValue>;
      if(meta.id!==input.childId||meta.filename!==expected.filename
        ||meta.content_type!==expected.contentType||meta.size!==expected.byteSize
        ||typeof meta.download_url!=='string'||meta.download_url.length>8192)
        throw new VaultError('conflict');
      let cdn:URL;
      try{cdn=new URL(meta.download_url);}catch{throw new VaultError('invalid_input');}
      if(cdn.origin!==policy.cdnOrigin||cdn.pathname!==binaryPath(policy.cdnPath,input.parentId,input.childId)
        ||cdn.username||cdn.password||cdn.hash||!cdn.search||cdn.href!==meta.download_url)
        throw new VaultError('invalid_input');
      const second=await checkedSource(scope,input,true);data.dispose(second.lease);
      const response=await (options.fetcher??fetch)(cdn,{method:'GET',redirect:'manual',credentials:'omit',
        referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.any([scope.signal,AbortSignal.timeout(TIMEOUT_MS)])});
      if(response.status!==200||!response.body){void response.body?.cancel().catch(()=>{});throw new VaultError('unavailable');}
      const length=response.headers.get('content-length');
      if(length!==null&&Number(length)!==expected.byteSize){void response.body.cancel().catch(()=>{});throw new VaultError('conflict');}
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const item=await reader.read();if(item.done)break;
        if(!(item.value instanceof Uint8Array)||chunks.length>=MAX_BINARY_CHUNKS
          ||item.value.length>expected.byteSize-size
          ||item.value.length>policy.maxBytes-size)throw new VaultError('conflict');
        chunks.push(item.value);size+=item.value.length;
      }}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
      if(size!==expected.byteSize)throw new VaultError('conflict');
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const third=await checkedSource(scope,input,true);data.dispose(third.lease);
      return bytes;
    },
    async availability(lease:DataLease){
      const row=await read(lease);
      if(!row||row[cf.enabled]!==true||!row[cf.keyRef])return 'missing' as const;
      if(!vault)return 'unavailable' as const;
      if(!usable(row)||descriptor.fixedOrigin&&connectorOrigin(row[cf.origin])!==descriptor.fixedOrigin
        ||!await matchingSecret(lease,row))return 'invalid' as const;
      try{await vault.useSecret(lease,{reference:String(row[cf.keyRef]),bindingId:descriptor.id},()=>true);
        return 'ready' as const;}
      catch{return 'invalid' as const;}
    },
    port(scope:ConnectorOperationScope):ConnectorPort{
      let calls=0;
      const original=data.describeLease(scope.lease);
      const authorize=async()=>{
        scope.ensureActive();
        const lease=await data.authorize(scope.credential,{contextId:scope.contextId,audience:scope.audience,
          actors:scope.actors,requiredPermissionIds:scope.requiredPermissionIds,purpose:'operation'},
        {moduleId:descriptor.moduleId});
        try{
          scope.ensureActive();
          const identity=data.describeLease(lease);
          if(identity.contextId!==original.contextId||identity.audience!==original.audience
            ||identity.principalId!==original.principalId||identity.actorPrincipalId!==original.actorPrincipalId)
            throw new DataAccessError('forbidden');
          return lease;
        }catch(caught){data.dispose(lease);throw caught;}
      };
      return Object.freeze({async request(input:ConnectorRequest):Promise<ConnectorResult>{
        try{scope.ensureActive();}catch{return error('unavailable');}
        if(++calls>MAX_CALLS)return error('invalid_request');
        const resource=descriptor.resources.find(item=>item.id===input?.resource);
        if(!resource||resource.method!=='GET')return error('invalid_request');
        let fresh:DataLease|null=null;
        try{
          fresh=await authorize();
          const row=await read(fresh);
          scope.ensureActive();
          if(!vault||!usable(row)||!await matchingSecret(fresh,row!))return error('not_configured');
          if(input.sourceProof&&(!cf.connectionId||!identifier.test(input.sourceProof.connectionId)
            ||!Number.isSafeInteger(input.sourceProof.configRevision)
            ||row![cf.connectionId]!==input.sourceProof.connectionId
            ||row![cf.revision]!==input.sourceProof.configRevision))return error('not_configured');
          scope.ensureActive();
          const origin=connectorOrigin(row![cf.origin]);
          if(descriptor.fixedOrigin&&origin!==descriptor.fixedOrigin)return error('not_configured');
          const url=origin?requestUrl(origin,resource,input):null;
          if(!url)return error('invalid_request');
          const reference=String(row![cf.keyRef]),version=row![cf.secretVersion],revision=row![cf.revision];
          const guard=async()=>{
            scope.ensureActive();
            const current=await read(fresh!);
            if(!current||current[cf.revision]!==revision||current[cf.keyRef]!==reference
              ||current[cf.secretVersion]!==version||current[cf.enabled]!==true
              ||cf.connectionId&&current[cf.connectionId]!==row![cf.connectionId]
              ||current[cf.origin]!==row![cf.origin]
              ||!await matchingSecret(fresh!,current))throw new VaultError('conflict');
            scope.ensureActive();
          };
          const timeout=AbortSignal.timeout(TIMEOUT_MS);
          const signal=AbortSignal.any([scope.signal,timeout,...(input.signal?[input.signal]:[])]);
          const response=await vault.useSecret(fresh,{reference,bindingId:descriptor.id},async secret=>{
            await guard();
            const headers=new Headers({accept:'application/json'});
            if(descriptor.auth.kind==='bearer')headers.set('Authorization',`Bearer ${secret}`);
            else headers.set(descriptor.auth.name,secret);
            for(const item of descriptor.staticHeaders??[])headers.set(item.name,item.value);
            scope.ensureActive();
            return (options.fetcher??fetch)(url,{method:'GET',headers,redirect:'manual',credentials:'omit',
              referrerPolicy:'no-referrer',cache:'no-store',signal});
          });
          await guard();
          const after=await authorize();data.dispose(after);
          scope.ensureActive();
          const registerProof=()=>{
            if(!scope.registerCommitGuards)return;
            const vf=descriptor.vault.fields;
            const configProof=data.internalPort(scope.lease,{moduleId:descriptor.moduleId,
              modelId:descriptor.config.modelId,
              fields:[cf.id,cf.revision,cf.origin,cf.keyRef,cf.secretVersion,cf.enabled]})
              .planGet(descriptor.config.modelId,{key:{[cf.id]:descriptor.id},required:true,
                where:{[cf.revision]:revision,[cf.origin]:row![cf.origin],[cf.keyRef]:reference,
                  [cf.secretVersion]:version,[cf.enabled]:true},fields:[cf.id]});
            const secretProof=data.internalPort(scope.lease,{moduleId:descriptor.moduleId,
              modelId:descriptor.vault.modelId,fields:[vf.id,vf.version,vf.state,vf.bindingId]})
              .planGet(descriptor.vault.modelId,{key:{[vf.id]:reference},required:true,
                where:{[vf.version]:version,[vf.state]:'active',[vf.bindingId]:descriptor.id},fields:[vf.id]});
            scope.registerCommitGuards([configProof,secretProof]);
          };
          if(response.status!==200){void response.body?.cancel().catch(()=>{});
            if(response.status===401||response.status===403)return error('remote_auth',response.status);
            if(response.status===404){registerProof();return error('remote_not_found',404);}
            return error('remote_error',response.status);}
          const body=await boundedJson(response);
          if(!body.valid)return error('invalid_response',200);
          await guard();
          const finalLease=await authorize();data.dispose(finalLease);
          scope.ensureActive();
          registerProof();
          return Object.freeze({kind:'ok',status:200,body:body.body});
        }catch(caught){
          if(caught instanceof VaultError&&caught.code==='conflict')return error('unavailable');
          if(caught&&typeof caught==='object'&&'code' in caught
            &&['forbidden','unauthorized'].includes(String(caught.code)))return error('access_denied');
          return error('unavailable');
        }finally{if(fresh)data.dispose(fresh);}
      },async mutate(input:ConnectorMutationRequest):Promise<ConnectorResult>{
        try{scope.ensureActive();}catch{return error('unavailable');}
        if(++calls>MAX_CALLS||!identifier.test(scope.executionId??'')
          ||scope.expectedConfigRevision!==undefined&&(!Number.isSafeInteger(scope.expectedConfigRevision)
            ||scope.expectedConfigRevision<1)
          ||!scope.registerCommitGuards||!input
          ||Object.keys(input).some(key=>!['resource','id','fields','attachments','signal'].includes(key)))
          return error('invalid_request');
        const resource=descriptor.resources.find(item=>item.id===input.resource);
        if(!resource||resource.method==='GET')return error('invalid_request');
        const urlInput:ConnectorRequest={resource:input.resource,
          ...(input.id===undefined?{}:{id:input.id})};
        let body:string|null;
        try{body=mutationBody(resource,input);}catch{return error('invalid_request');}
        if(body===null)return error('invalid_request');
        let fresh:DataLease|null=null,attempted=false;
        try{
          fresh=await authorize();
          const row=await read(fresh);
          scope.ensureActive();
          if(scope.expectedConfigRevision!==undefined
            &&row?.[cf.revision]!==scope.expectedConfigRevision)return error('unavailable');
          if(!vault||!usable(row)||!await matchingSecret(fresh,row!))return error('not_configured');
          const origin=connectorOrigin(row![cf.origin]);
          if(descriptor.fixedOrigin&&origin!==descriptor.fixedOrigin)return error('not_configured');
          const url=origin?requestUrl(origin,resource,urlInput):null;
          if(!url)return error('invalid_request');
          const reference=String(row![cf.keyRef]),version=row![cf.secretVersion],revision=row![cf.revision];
          const guard=async()=>{
            scope.ensureActive();
            const current=await read(fresh!);
            if(!current||current[cf.revision]!==revision||current[cf.keyRef]!==reference
              ||current[cf.secretVersion]!==version||current[cf.enabled]!==true
              ||current[cf.origin]!==row![cf.origin]
              ||!await matchingSecret(fresh!,current))throw new VaultError('conflict');
            scope.ensureActive();
          };
          const timeout=AbortSignal.timeout(TIMEOUT_MS);
          const signal=AbortSignal.any([scope.signal,timeout,...(input.signal?[input.signal]:[])]);
          const response=await vault.useSecret(fresh,{reference,bindingId:descriptor.id},async secret=>{
            await guard();
            if(descriptor.mutationSecretPrefix&&!secret.startsWith(descriptor.mutationSecretPrefix))
              throw new VaultError('invalid_input');
            const headers=new Headers({accept:'application/json'});
            if(descriptor.auth.kind==='bearer')headers.set('Authorization',`Bearer ${secret}`);
            else headers.set(descriptor.auth.name,secret);
            for(const item of descriptor.staticHeaders??[])headers.set(item.name,item.value);
            if(resource.idempotencyHeader)
              headers.set(resource.idempotencyHeader,`creezio-${scope.executionId}`);
            if(resource.body)headers.set('Content-Type',resource.body.encoding==='form'
              ?'application/x-www-form-urlencoded':'application/json');
            scope.ensureActive();
            attempted=true;
            scope.markMutationAttempted?.();
            return (options.fetcher??fetch)(url,{method:resource.method,headers,
              ...(body?{body}:{}),redirect:'manual',credentials:'omit',
              referrerPolicy:'no-referrer',cache:'no-store',signal});
          });
          await guard();
          const after=await authorize();data.dispose(after);
          scope.ensureActive();
          const accepted=resource.successStatuses??[200,201];
          if(!accepted.includes(response.status)){
            void response.body?.cancel().catch(()=>{});
            if(response.status===401||response.status===403)return error('remote_auth',response.status);
            if(response.status===404)return error('remote_not_found',404);
            if(response.status>=500||[408,409,429].includes(response.status)){
              scope.markMutationUnknown?.();return error('outcome_unknown',response.status);}
            return error('remote_error',response.status);
          }
          const parsed=resource.responseBody==='none'?{valid:true as const,body:null}:await boundedJson(response);
          if(!parsed.valid){scope.markMutationUnknown?.();return error('outcome_unknown',response.status);}
          await guard();
          const finalLease=await authorize();data.dispose(finalLease);
          scope.ensureActive();
          const vf=descriptor.vault.fields;
          const configProof=data.internalPort(scope.lease,{moduleId:descriptor.moduleId,
            modelId:descriptor.config.modelId,
            fields:[cf.id,cf.revision,cf.origin,cf.keyRef,cf.secretVersion,cf.enabled]})
            .planGet(descriptor.config.modelId,{key:{[cf.id]:descriptor.id},required:true,
              where:{[cf.revision]:revision,[cf.origin]:row![cf.origin],[cf.keyRef]:reference,
                [cf.secretVersion]:version,[cf.enabled]:true},fields:[cf.id]});
          const secretProof=data.internalPort(scope.lease,{moduleId:descriptor.moduleId,
            modelId:descriptor.vault.modelId,fields:[vf.id,vf.version,vf.state,vf.bindingId]})
            .planGet(descriptor.vault.modelId,{key:{[vf.id]:reference},required:true,
              where:{[vf.version]:version,[vf.state]:'active',[vf.bindingId]:descriptor.id},fields:[vf.id]});
          scope.registerCommitGuards([configProof,secretProof]);
          scope.markMutationSucceeded?.();
          return Object.freeze({kind:'ok',status:response.status,body:parsed.body});
        }catch(caught){
          if(attempted){scope.markMutationUnknown?.();return error('outcome_unknown');}
          if(caught&&typeof caught==='object'&&'code' in caught
            &&['forbidden','unauthorized'].includes(String(caught.code)))return error('access_denied');
          return error('unavailable');
        }finally{if(fresh)data.dispose(fresh);}
      }});
    }
  });
}
