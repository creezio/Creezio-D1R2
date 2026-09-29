import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {MEILI_CONNECTOR_ID} from './storage.ts';

type Row=Record<string,JsonValue>;
type Input=Record<string,unknown>;
const input=(value:JsonValue):Input=>value&&typeof value==='object'&&!Array.isArray(value)?value as Input:{};
const key=()=>({id:MEILI_CONNECTOR_ID});
const current=async(context:OperationContext)=>await context.data.get('connector_config',{key:key()}) as Row|null;
const revision=(value:unknown,row:Row|null):number=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(row?.revision??0))throw new OperationError('conflict');
  return Number(value);
};
const secret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8&&value.length<=4096
  &&value.isWellFormed()&&!/[\r\n\u0000-\u001f\u007f]/.test(value);
/** The connector host repeats origin validation before egress. */
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
export async function configRead(_value:JsonValue,context:OperationContext){
  return {output:{config:view(await current(context))}};
}
export async function configSet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior),origin=canonicalOrigin(args.origin);
  if(typeof args.enabled!=='boolean'||args.enabled&&!prior?.key_ref)throw new OperationError('invalid_input');
  // A manager who may rotate the origin must not send an existing sealed key to that new host.
  if(typeof prior?.key_ref==='string'&&prior.origin!==origin)throw new OperationError('conflict');
  const now=new Date().toISOString();
  const changes={origin,enabled:args.enabled,updated_at:now};
  const plan=prior?context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('connector_config',{values:{id:MEILI_CONNECTOR_ID,...changes,key_ref:null,
      secret_version:null,revision:1}});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[plan]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||!secret(args.apiKey))throw new OperationError('invalid_input');
  const port=(context as OperationContext & {providerSecrets?:ProviderSecretsPort}).providerSecrets;
  if(!port)throw new OperationError('unsupported');
  const sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await port.prepareReplace({providerId:MEILI_CONNECTOR_ID,reference:prior.key_ref,
      expectedVersion:Number(prior.secret_version),secret:args.apiKey})
    :await port.preparePut({providerId:MEILI_CONNECTOR_ID,secret:args.apiKey});
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
  const sealed=await port.prepareRevoke({providerId:MEILI_CONNECTOR_ID,reference:prior.key_ref,
    expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,enabled:false,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
/** Do not project any index name, count, document, or provider error body. */
export async function connectionCheck(_value:JsonValue,context:OperationContext){
  const answer=await ready(context).request({resource:'indexes',signal:context.signal});
  if(answer.kind==='error'){
    if(answer.code==='remote_auth')return {output:{authenticated:false,status:'key_rejected'}};
    throw new OperationError(answer.code==='access_denied'?'forbidden':'unavailable');
  }
  const body=answer.body;
  if(!body||typeof body!=='object'||Array.isArray(body))throw new OperationError('unavailable');
  const page=body as Record<string,JsonValue>;
  if(!Array.isArray(page.results)||page.results.length>1||page.limit!==1
    ||!Number.isSafeInteger(page.offset)||Number(page.offset)<0
    ||!Number.isSafeInteger(page.total)||Number(page.total)<0)
    throw new OperationError('unavailable');
  return {output:{authenticated:true,status:'connected'}};
}
