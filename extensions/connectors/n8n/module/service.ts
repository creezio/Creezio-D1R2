import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {N8N_CONNECTOR_ID} from './storage.ts';

type Row=Record<string,JsonValue>;
type Input=Record<string,unknown>;
const input=(value:JsonValue):Input=>value&&typeof value==='object'&&!Array.isArray(value)?value as Input:{};
const key=()=>({id:N8N_CONNECTOR_ID});
const current=async(context:OperationContext)=>await context.data.get('connector_config',{key:key()}) as Row|null;
const revision=(value:unknown,row:Row|null):number=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(row?.revision??0))throw new OperationError('conflict');
  return Number(value);
};
const secret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8&&value.length<=4096
  &&value.isWellFormed()&&!/[\r\n\u0000-\u001f\u007f]/.test(value);
/** The host repeats URL validation before egress; this check prevents unusable configuration. */
export function canonicalOrigin(value:unknown):string{
  if(typeof value!=='string'||value.length<8||value.length>512||!value.isWellFormed())
    throw new OperationError('invalid_input');
  let url:URL;
  try{url=new URL(value);}catch{throw new OperationError('invalid_input');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'
    ||!host||host==='localhost'||host==='localhost.'||host.endsWith('.localhost')||host.endsWith('.localhost.')
    ||host.endsWith('.local')||host.endsWith('.local.')||host.endsWith('.internal')||host.endsWith('.internal.')
    ||host.startsWith('[')||/^\d+(?:\.\d+){3}$/.test(host)||url.origin.length>512)
    throw new OperationError('invalid_input');
  return url.origin;
}
const view=(row:Row|null)=>({origin:typeof row?.origin==='string'?row.origin:null,
  enabled:row?.enabled===true,hasKey:typeof row?.key_ref==='string',
  state:!row||!row.key_ref?'missing':row.enabled===true?'unverified':'configured',
  revision:typeof row?.revision==='number'?row.revision:0});
const ready=(context:OperationContext):ConnectorPort=>{
  const port=(context as OperationContext & {connector?:ConnectorPort}).connector;
  if(!port)throw new OperationError('unavailable');
  return port;
};
const remote=async(context:OperationContext,request:Parameters<ConnectorPort['request']>[0]):Promise<JsonValue>=>{
  const answer=await ready(context).request({...request,signal:context.signal});
  if(answer.kind==='ok')return answer.body;
  throw new OperationError(answer.code==='remote_not_found'?'not_found':
    answer.code==='access_denied'?'forbidden':answer.code==='invalid_request'?'invalid_input':'unavailable');
};
const record=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationError('unavailable');
  return value as Record<string,unknown>;
};
const bounded=(value:unknown,max:number,min=0):string=>{
  if(typeof value!=='string'||!value.isWellFormed()||value.length<min||value.length>max
    ||new TextEncoder().encode(value).length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw new OperationError('unavailable');
  return value;
};
const optional=(value:unknown,max:number):string|null=>value===null||value===undefined?null:bounded(value,max);
const remoteId=(value:unknown):string=>{
  const id=bounded(value,128,1);
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id))throw new OperationError('unavailable');
  return id;
};
const requestedId=(value:unknown):string=>{
  if(typeof value!=='string'||value.length<1||value.length>128||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
    throw new OperationError('invalid_input');
  return value;
};
const workflow=(value:unknown)=>{
  const row=record(value);
  if(typeof row.active!=='boolean')throw new OperationError('unavailable');
  return {id:remoteId(row.id),name:bounded(row.name,4096),active:row.active,
    isArchived:row.isArchived===true,createdAt:optional(row.createdAt,64),
    updatedAt:optional(row.updatedAt,64),versionId:optional(row.versionId,128)};
};
const execution=(value:unknown)=>{
  const row=record(value);
  return {id:remoteId(row.id),workflowId:optional(row.workflowId,128),
    status:bounded(row.status,64,1),mode:optional(row.mode,64),
    startedAt:optional(row.startedAt,64),stoppedAt:optional(row.stoppedAt,64)};
};
const pageInput=(value:JsonValue)=>{
  const args=input(value);
  if(!Number.isSafeInteger(args.limit)||Number(args.limit)<1||Number(args.limit)>25
    ||args.cursor!==undefined&&(typeof args.cursor!=='string'||args.cursor.length<1||args.cursor.length>2048))
    throw new OperationError('invalid_input');
  return {limit:Number(args.limit),...(args.cursor===undefined?{}:{cursor:String(args.cursor)})};
};
const page=<T>(body:JsonValue,limit:number,project:(item:unknown)=>T)=>{
  const row=record(body),items=row.data;
  if(!Array.isArray(items)||items.length>limit||row.nextCursor!==undefined&&row.nextCursor!==null
    &&(typeof row.nextCursor!=='string'||row.nextCursor.length<1||row.nextCursor.length>2048))
    throw new OperationError('unavailable');
  const output={items:items.map(project),nextCursor:row.nextCursor??null};
  if(new TextEncoder().encode(JSON.stringify(output)).length>220_000)throw new OperationError('unavailable');
  return output;
};

export async function configRead(_value:JsonValue,context:OperationContext){
  return {output:{config:view(await current(context))}};
}
export async function configSet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior),origin=canonicalOrigin(args.origin);
  if(typeof args.enabled!=='boolean'||args.enabled&&!prior?.key_ref)throw new OperationError('invalid_input');
  if(prior?.enabled===true&&prior.origin!==origin&&args.enabled)throw new OperationError('conflict');
  const now=new Date().toISOString();
  const changes={origin,enabled:args.enabled,updated_at:now};
  const plan=prior?context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('connector_config',{values:{id:N8N_CONNECTOR_ID,...changes,key_ref:null,
      secret_version:null,revision:1}});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[plan]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||!secret(args.apiKey))throw new OperationError('invalid_input');
  const port=(context as OperationContext & {providerSecrets?:ProviderSecretsPort}).providerSecrets;
  if(!port)throw new OperationError('unsupported');
  const sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await port.prepareReplace({providerId:N8N_CONNECTOR_ID,reference:prior.key_ref,
      expectedVersion:Number(prior.secret_version),secret:args.apiKey})
    :await port.preparePut({providerId:N8N_CONNECTOR_ID,secret:args.apiKey});
  const changes={key_ref:sealed.reference,secret_version:sealed.version,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
export async function configKeyRevoke(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))
    throw new OperationError('invalid_input');
  const port=(context as OperationContext & {providerSecrets?:ProviderSecretsPort}).providerSecrets;
  if(!port)throw new OperationError('unsupported');
  const sealed=await port.prepareRevoke({providerId:N8N_CONNECTOR_ID,reference:prior.key_ref,
    expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,enabled:false,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
export async function connectionCheck(_value:JsonValue,context:OperationContext){
  await remote(context,{resource:'workflows',limit:1});
  return {output:{reachable:true}};
}
export async function workflowList(value:JsonValue,context:OperationContext){
  const args=pageInput(value),body=await remote(context,{resource:'workflows',...args});
  return {output:page(body,args.limit,workflow)};
}
export async function workflowRead(value:JsonValue,context:OperationContext){
  const id=requestedId(input(value).id),body=await remote(context,{resource:'workflow',id});
  return {output:{workflow:workflow(body)}};
}
export async function executionList(value:JsonValue,context:OperationContext){
  const args=pageInput(value),body=await remote(context,{resource:'executions',...args});
  return {output:page(body,args.limit,execution)};
}
export async function executionRead(value:JsonValue,context:OperationContext){
  const id=requestedId(input(value).id),body=await remote(context,{resource:'execution',id});
  return {output:{execution:execution(body)}};
}
