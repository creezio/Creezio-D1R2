import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {RESEND_CONNECTOR_ID,RESEND_ORIGIN} from './storage.ts';

type Row=Record<string,JsonValue>;
type Input=Record<string,unknown>;
const input=(value:JsonValue):Input=>value&&typeof value==='object'&&!Array.isArray(value)?value as Input:{};
const key=()=>({id:RESEND_CONNECTOR_ID});
const current=async(context:OperationContext)=>await context.data.get('connector_config',{key:key()}) as Row|null;
const webhookRefs=(row:Row)=>[
  [row.webhook_key_ref,row.webhook_secret_version],
  [row.webhook_previous_key_ref,row.webhook_previous_secret_version],
  [row.webhook_service_token_ref,row.webhook_service_token_version]]
  .filter(([reference,version])=>typeof reference==='string'&&Number.isSafeInteger(version)) as [string,number][];
const revokeWebhookRefs=async(context:OperationContext,row:Row)=>{
  if(!context.providerSecrets)throw new OperationError('unsupported');
  return Promise.all(webhookRefs(row).map(async([reference,expectedVersion])=>
    (await context.providerSecrets!.prepareRevoke({providerId:RESEND_CONNECTOR_ID,
      reference,expectedVersion})).plan));
};
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
  hasWebhookSecret:typeof row?.webhook_key_ref==='string',
  hasWebhookService:typeof row?.webhook_service_token_ref==='string',
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
const boundedBody=(value:unknown,max:number):string=>{
  if(typeof value!=='string'||!value.isWellFormed()||value.length>max
    ||new TextEncoder().encode(value).length>max
    ||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
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
      secret_version:null,connection_id:null,webhook_key_ref:null,webhook_secret_version:null,
      webhook_previous_key_ref:null,webhook_previous_secret_version:null,
      webhook_service_token_ref:null,webhook_service_token_version:null,revision:1}});
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
  const changes={key_ref:sealed.reference,secret_version:sealed.version,connection_id:crypto.randomUUID(),
    webhook_key_ref:null,webhook_secret_version:null,webhook_previous_key_ref:null,
    webhook_previous_secret_version:null,webhook_service_token_ref:null,
    webhook_service_token_version:null,enabled:false,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},
    plans:[sealed.plan,...await revokeWebhookRefs(context,prior),plan]};
}
export async function configKeyRevoke(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))
    throw new OperationError('invalid_input');
  const port:ProviderSecretsPort|undefined=context.providerSecrets;
  if(!port)throw new OperationError('unsupported');
  const sealed=await port.prepareRevoke({providerId:RESEND_CONNECTOR_ID,reference:prior.key_ref,
    expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,connection_id:null,enabled:false,
    webhook_key_ref:null,webhook_secret_version:null,webhook_previous_key_ref:null,
    webhook_previous_secret_version:null,webhook_service_token_ref:null,
    webhook_service_token_version:null,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},
    plans:[sealed.plan,...await revokeWebhookRefs(context,prior),plan]};
}
const webhookReady=(row:Row|null):row is Row=>!!row&&row.enabled===true&&typeof row.key_ref==='string'
  &&typeof row.connection_id==='string';
export async function configWebhookSet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!webhookReady(prior)||typeof args.webhookSecret!=='string'
    ||!/^whsec_[A-Za-z0-9_+\-/=]{16,512}$/u.test(args.webhookSecret)
    ||!context.providerSecrets)throw new OperationError('invalid_input');
  const sealed=await context.providerSecrets.preparePut({providerId:RESEND_CONNECTOR_ID,
    secret:args.webhookSecret});
  const previous=typeof prior.webhook_previous_key_ref==='string'
    &&Number.isSafeInteger(prior.webhook_previous_secret_version)
    ?[(await context.providerSecrets.prepareRevoke({providerId:RESEND_CONNECTOR_ID,
      reference:prior.webhook_previous_key_ref,
      expectedVersion:Number(prior.webhook_previous_secret_version)})).plan]:[];
  const changes={webhook_key_ref:sealed.reference,webhook_secret_version:sealed.version,
    webhook_previous_key_ref:typeof prior.webhook_key_ref==='string'?prior.webhook_key_ref:null,
    webhook_previous_secret_version:Number.isSafeInteger(prior.webhook_secret_version)
      ?Number(prior.webhook_secret_version):null,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[sealed.plan,...previous,plan]};
}
export async function configWebhookRevoke(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||typeof prior.webhook_key_ref!=='string'||!context.providerSecrets)
    throw new OperationError('invalid_input');
  const refs=webhookRefs(prior).filter(([reference])=>reference!==prior.webhook_service_token_ref);
  const revoked=await Promise.all(refs.map(async([reference,expectedVersion])=>
    (await context.providerSecrets!.prepareRevoke({providerId:RESEND_CONNECTOR_ID,
      reference,expectedVersion})).plan));
  const changes={webhook_key_ref:null,webhook_secret_version:null,webhook_previous_key_ref:null,
    webhook_previous_secret_version:null,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[...revoked,plan]};
}
export async function configWebhookServiceSet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!webhookReady(prior)||typeof args.serviceToken!=='string'
    ||!/^cz1a_[A-Za-z0-9_-]{43}$/u.test(args.serviceToken)
    ||!context.providerSecrets)throw new OperationError('invalid_input');
  const sealed=await context.providerSecrets.preparePut({providerId:RESEND_CONNECTOR_ID,
    secret:args.serviceToken});
  const previous=typeof prior.webhook_service_token_ref==='string'
    &&Number.isSafeInteger(prior.webhook_service_token_version)
    ?[(await context.providerSecrets.prepareRevoke({providerId:RESEND_CONNECTOR_ID,
      reference:prior.webhook_service_token_ref,
      expectedVersion:Number(prior.webhook_service_token_version)})).plan]:[];
  const changes={webhook_service_token_ref:sealed.reference,webhook_service_token_version:sealed.version,
    updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[sealed.plan,...previous,plan]};
}
export async function configWebhookServiceRevoke(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),old=revision(args.revision,prior);
  if(!prior||typeof prior.webhook_service_token_ref!=='string'
    ||!Number.isSafeInteger(prior.webhook_service_token_version)||!context.providerSecrets)
    throw new OperationError('invalid_input');
  const revoked=await context.providerSecrets.prepareRevoke({providerId:RESEND_CONNECTOR_ID,
    reference:prior.webhook_service_token_ref,
    expectedVersion:Number(prior.webhook_service_token_version)});
  const changes={webhook_service_token_ref:null,webhook_service_token_version:null,
    updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:key(),compare:{field:'revision',expected:old},values:changes});
  return {output:{config:view({...prior,...changes,revision:old+1})},plans:[revoked.plan,plan]};
}
export async function eventReceive(value:JsonValue,context:OperationContext){
  const args=input(value),row=await current(context);
  if(!webhookReady(row)||typeof row.webhook_key_ref!=='string'
    ||typeof row.webhook_service_token_ref!=='string'
    ||typeof args.eventId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/u.test(args.eventId)
    ||args.requestKey!==args.eventId||typeof args.bodyDigest!=='string'
    ||!/^[a-f0-9]{64}$/u.test(args.bodyDigest)
    ||!['email.sent','email.delivered','email.bounced','email.failed','email.received'].includes(String(args.eventType))
    ||typeof args.emailId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(args.emailId)
    ||typeof args.occurredAt!=='string'||!Number.isFinite(Date.parse(args.occurredAt)))
    throw new OperationError('invalid_input');
  return {output:{eventId:args.eventId,recorded:true},plans:[
    context.data.planGet('connector_config',{key:key(),where:{connection_id:row.connection_id,
      enabled:true,webhook_key_ref:row.webhook_key_ref,
      webhook_service_token_ref:row.webhook_service_token_ref},required:true}),
    context.data.planCreate('webhook_event',{values:{id:String(args.eventId),connection_id:row.connection_id,
      event_type:String(args.eventType),email_id:String(args.emailId),body_digest:String(args.bodyDigest),
      occurred_at:new Date(args.occurredAt).toISOString(),received_at:new Date().toISOString()}})]};
}
export async function eventStatus(value:JsonValue,context:OperationContext){
  const args=input(value),row=await current(context);
  if(typeof args.emailId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(args.emailId))
    throw new OperationError('invalid_input');
  if(!webhookReady(row))throw new OperationError('unavailable');
  const events=await context.data.list('webhook_event',{limit:50,
    where:{connection_id:row.connection_id,email_id:args.emailId},
    order:{indexId:'by-email',direction:'desc'}});
  if(events.nextAfter)throw new OperationError('unavailable');
  // by-email is ordered by provider occurred_at, then event id. Ignore nonterminal
  // events without letting their later arrival hide the latest signed outcome.
  const receipt=events.items.find(item=>item.event_type==='email.delivered'
    ||item.event_type==='email.bounced'||item.event_type==='email.failed');
  return {output:receipt?{kind:receipt.event_type==='email.delivered'?'delivered'
    :receipt.event_type==='email.bounced'?'bounced':'failed',
    eventId:String(receipt.id),occurredAt:String(receipt.occurred_at)}:
    {kind:'none',eventId:null,occurredAt:null}};
}
/** Fetch an explicitly selected received email only after a signed event for this connection. */
export async function receivedRead(value:JsonValue,context:OperationContext){
  const args=input(value),row=await current(context);
  if(typeof args.emailId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(args.emailId))
    throw new OperationError('invalid_input');
  if(!webhookReady(row))throw new OperationError('unavailable');
  const events=await context.data.list('webhook_event',{limit:50,
    where:{connection_id:row.connection_id,email_id:args.emailId},
    order:{indexId:'by-email',direction:'desc'}});
  if(!events.items.some(item=>item.event_type==='email.received'))
    throw new OperationError(events.nextAfter?'unavailable':'not_found');
  if(typeof row?.connection_id!=='string'||!row.connection_id||!Number.isSafeInteger(row.revision))
    throw new OperationError('unavailable');
  const sourceProof={connectionId:row.connection_id,configRevision:Number(row.revision)};
  const answer=await ready(context).request({resource:'email.received',id:args.emailId,
    sourceProof,signal:context.signal});
  if(answer.kind!=='ok')throw new OperationError(answer.code==='remote_not_found'?'not_found':'unavailable');
  const body=object(answer.body);
  if(body.id!==args.emailId||!Array.isArray(body.to)||body.to.length<1||body.to.length>20
    ||body.to.some(item=>typeof item!=='string')||!Array.isArray(body.attachments)
    ||body.attachments.length>50)throw new OperationError('unavailable');
  const to=body.to.map(item=>bounded(item,320));
  const from=bounded(body.from,320);
  const subject=body.subject===null||body.subject===undefined?'':boundedBody(body.subject,240);
  const text=body.text===null||body.text===undefined?'':boundedBody(body.text,16000);
  const html=body.html===null||body.html===undefined?'':boundedBody(body.html,32000);
  const receivedAt=bounded(body.created_at,40);
  if(!Number.isFinite(Date.parse(receivedAt)))throw new OperationError('unavailable');
  const attachments=body.attachments.map(value=>{
    const item=object(value);
    const id=bounded(item.id,128),filename=bounded(item.filename,255),contentType=bounded(item.content_type,128);
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id))throw new OperationError('unavailable');
    if(/[\\/]/u.test(filename))throw new OperationError('unavailable');
    if(!Number.isSafeInteger(item.size)||Number(item.size)<0||Number(item.size)>10*1024*1024)
      throw new OperationError('unavailable');
    return {id,filename,contentType,byteSize:Number(item.size)};
  });
  if(new Set(attachments.map(item=>item.id)).size!==attachments.length)
    throw new OperationError('unavailable');
  return {output:{emailId:args.emailId,to,from,subject,text,html,receivedAt,
    ...sourceProof,attachments,attachmentCount:attachments.length}};
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
