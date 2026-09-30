import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {RESEND_CONNECTOR_ID,RESEND_ORIGIN} from './storage.ts';

type Row=Record<string,JsonValue>;
type Input=Record<string,unknown>;
const input=(value:JsonValue):Input=>value&&typeof value==='object'&&!Array.isArray(value)?value as Input:{};
const key=()=>({id:RESEND_CONNECTOR_ID});
const current=async(context:OperationContext)=>await context.data.get('connector_config',{key:key()}) as Row|null;
const revision=(value:unknown,row:Row|null):number=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(row?.revision??0))throw new OperationError('conflict');
  return Number(value);
};
const secret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8&&value.length<=4096
  &&value.isWellFormed()&&!/[\r\n\u0000-\u001f\u007f]/.test(value);
const sender=(value:unknown):value is string=>typeof value==='string'&&value.length>=3&&value.length<=320
  &&value.isWellFormed()&&!/[\r\n\u0000-\u001f\u007f]/.test(value)
  &&/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(value);
const view=(row:Row|null)=>({origin:row?RESEND_ORIGIN:null,
  from:typeof row?.from_address==='string'?row.from_address:null,
  enabled:row?.enabled===true,hasKey:typeof row?.key_ref==='string',
  state:!row||!row.key_ref||!row.from_address?'missing':row.enabled===true?'configured':'disabled',
  revision:typeof row?.revision==='number'?row.revision:0});
const ready=(context:OperationContext):ConnectorPort=>{
  if(!context.connector)throw new OperationError('unavailable');
  return context.connector;
};
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationError('unavailable');
  return value as Record<string,unknown>;
};
const bounded=(value:unknown,max:number):string=>{
  if(typeof value!=='string'||!value.isWellFormed()||value.length<1||value.length>max
    ||new TextEncoder().encode(value).length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw new OperationError('unavailable');
  return value;
};

export async function configRead(_value:JsonValue,context:OperationContext){
  return {output:{config:view(await current(context))}};
}
/** Scoped, non-secret eligibility hint. The host must recheck vault/config before egress. */
export async function deliveryReadiness(_value:JsonValue,context:OperationContext){
  const row=await current(context);
  const ready=row?.enabled===true&&row.origin===RESEND_ORIGIN&&typeof row.key_ref==='string'
    &&typeof row.from_address==='string'&&sender(row.from_address)
    &&Number.isSafeInteger(row.secret_version)&&Number(row.secret_version)>=1;
  return {output:{state:ready?'ready':row?'unavailable':'missing',
    from:ready?row!.from_address:null,configRevision:typeof row?.revision==='number'?row.revision:0}};
}
export async function configSet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!sender(args.from)||typeof args.enabled!=='boolean'||args.enabled&&!prior?.key_ref)
    throw new OperationError('invalid_input');
  const changes={origin:RESEND_ORIGIN,from_address:args.from,enabled:args.enabled,
    updated_at:new Date().toISOString()};
  const plan=prior?context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('connector_config',{values:{id:RESEND_CONNECTOR_ID,...changes,key_ref:null,
      secret_version:null,revision:1}});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[plan]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||!secret(args.apiKey))throw new OperationError('invalid_input');
  const port:ProviderSecretsPort|undefined=context.providerSecrets;
  if(!port)throw new OperationError('unsupported');
  const sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await port.prepareReplace({providerId:RESEND_CONNECTOR_ID,reference:prior.key_ref,
      expectedVersion:Number(prior.secret_version),secret:args.apiKey})
    :await port.preparePut({providerId:RESEND_CONNECTOR_ID,secret:args.apiKey});
  const changes={key_ref:sealed.reference,secret_version:sealed.version,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
export async function configKeyRevoke(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))
    throw new OperationError('invalid_input');
  const port:ProviderSecretsPort|undefined=context.providerSecrets;
  if(!port)throw new OperationError('unsupported');
  const sealed=await port.prepareRevoke({providerId:RESEND_CONNECTOR_ID,reference:prior.key_ref,
    expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,enabled:false,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
/** Provider metadata only. Neither provider message content nor credentials are projected. */
export async function domainList(_value:JsonValue,context:OperationContext){
  const answer=await ready(context).request({resource:'domains',signal:context.signal});
  if(answer.kind!=='ok')throw new OperationError(answer.code==='access_denied'?'forbidden':'unavailable');
  const body=object(answer.body),data=body.data;
  if(!Array.isArray(data)||data.length>100)throw new OperationError('unavailable');
  const domains=data.map(value=>{
    const item=object(value);
    return {id:bounded(item.id,128),name:bounded(item.name,320),status:bounded(item.status,64)};
  });
  return {output:{domains}};
}
