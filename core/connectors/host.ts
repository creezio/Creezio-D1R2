import type {AuthorizationActor,AuthorizationAudience} from '../authorization/types.ts';
import {DataAccessError,type DataAccess,type DataCredential,type DataLease,type RuntimeDataCatalog,
  type DataRecord,type JsonValue} from '../data/types.ts';
import {isVaultReference,VaultError,type VaultKeyring} from '../vault/crypto.ts';
import {createVaultService} from '../vault/service.ts';
import type {ConnectorDescriptor,ConnectorRequest,ConnectorResource,ConnectorResult,ConnectorPort} from '../../sdk/connectors/types.ts';

const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const segment=/^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const MAX_BODY=1_048_576;
const MAX_CALLS=1;
const TIMEOUT_MS=10_000;
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
  if(!value||!identifier.test(value.id)||value.method!=='GET'||typeof value.path!=='string'
    ||!value.path.startsWith('/')||value.path.startsWith('//')||/[?#%\\]/.test(value.path)
    ||!Array.isArray(value.params)||new Set(value.params).size!==value.params.length
    ||value.params.some(item=>!['id','cursor','limit'].includes(item)))throw new VaultError('invalid_input');
  const parts=value.path.slice(1).split('/');
  if(parts.some(item=>item!== '{id}'&&(!segment.test(item)||item==='.'||item==='..'))
    ||parts.filter(item=>item==='{id}').length>1
    ||parts.includes('{id}')!==value.params.includes('id'))throw new VaultError('invalid_input');
  return Object.freeze({id:value.id,method:'GET',path:value.path,params:Object.freeze([...value.params])});
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
  const resources=value.resources.map(checkedResource);
  if(new Set(resources.map(item=>item.id)).size!==resources.length)throw new VaultError('invalid_input');
  return Object.freeze({id:value.id,moduleId:value.moduleId,config:Object.freeze({...value.config,
    fields:Object.freeze({...value.config.fields})}),vault:Object.freeze({...value.vault,
    fields:Object.freeze({...value.vault.fields})}),auth:Object.freeze({...auth}),resources:Object.freeze(resources)});
}

function requestUrl(origin:string,resource:ConnectorResource,input:ConnectorRequest):URL|null{
  if(!input||input.resource!==resource.id)return null;
  const keys=Object.keys(input);
  if(keys.some(key=>!['resource','id','cursor','limit','signal'].includes(key)))return null;
  for(const key of ['id','cursor','limit'] as const)if(input[key]!==undefined&&!resource.params.includes(key))return null;
  if(resource.params.includes('id')&&(!input.id||!identifier.test(input.id))
    ||input.id!==undefined&&!identifier.test(input.id)
    ||input.cursor!==undefined&&(typeof input.cursor!=='string'||!input.cursor.length
      ||input.cursor.length>2048||!input.cursor.isWellFormed()||/[\u0000-\u001f\u007f]/.test(input.cursor))
    ||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100))return null;
  const path=resource.path.replace('{id}',encodeURIComponent(input.id??''));
  const url=new URL(path,origin);
  if(input.cursor!==undefined)url.searchParams.set('cursor',input.cursor);
  if(input.limit!==undefined)url.searchParams.set('limit',String(input.limit));
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
  /** The operation engine invalidates this lease when the handler completes or times out. */
  readonly ensureActive:()=>void;
}

/** Separate from the OpenAI transport: one declared GET, scoped config and vault, no module credential. */
export function createConnectorHost(options:ConnectorHostOptions){
  const descriptor=captureConnectorDescriptor(options.descriptor),{data,catalog}=options;
  const cf=descriptor.config.fields;
  const configFields=[descriptor.config.contextField,...Object.values(cf)];
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
  return Object.freeze({
    descriptor,
    async availability(lease:DataLease){
      const row=await read(lease);
      if(!row||row[cf.enabled]!==true||!row[cf.keyRef])return 'missing' as const;
      if(!vault)return 'unavailable' as const;
      if(!usable(row)||!await matchingSecret(lease,row))return 'invalid' as const;
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
        if(!resource)return error('invalid_request');
        let fresh:DataLease|null=null;
        try{
          fresh=await authorize();
          const row=await read(fresh);
          scope.ensureActive();
          if(!vault||!usable(row)||!await matchingSecret(fresh,row!))return error('not_configured');
          scope.ensureActive();
          const origin=connectorOrigin(row![cf.origin]);
          const url=origin?requestUrl(origin,resource,input):null;
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
            const headers=new Headers({accept:'application/json'});
            if(descriptor.auth.kind==='bearer')headers.set('Authorization',`Bearer ${secret}`);
            else headers.set(descriptor.auth.name,secret);
            scope.ensureActive();
            return (options.fetcher??fetch)(url,{method:'GET',headers,redirect:'manual',credentials:'omit',
              referrerPolicy:'no-referrer',cache:'no-store',signal});
          });
          await guard();
          const after=await authorize();data.dispose(after);
          scope.ensureActive();
          if(response.status!==200){void response.body?.cancel().catch(()=>{});
            if(response.status===401||response.status===403)return error('remote_auth',response.status);
            if(response.status===404)return error('remote_not_found',404);
            return error('remote_error',response.status);}
          const body=await boundedJson(response);
          if(!body.valid)return error('invalid_response',200);
          await guard();
          const finalLease=await authorize();data.dispose(finalLease);
          scope.ensureActive();
          return Object.freeze({kind:'ok',status:200,body:body.body});
        }catch(caught){
          if(caught instanceof VaultError&&caught.code==='conflict')return error('unavailable');
          if(caught&&typeof caught==='object'&&'code' in caught
            &&['forbidden','unauthorized'].includes(String(caught.code)))return error('access_denied');
          return error('unavailable');
        }finally{if(fresh)data.dispose(fresh);}
      }});
    }
  });
}
