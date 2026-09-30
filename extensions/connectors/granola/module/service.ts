import {OperationError,type OperationContext,type JsonValue} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {GRANOLA_CONNECTOR_ID,GRANOLA_ORIGIN} from './storage.ts';
import {folderId,noteId,projectFolderList,projectNoteDetail,projectNoteList,projectTranscript,remoteCursor} from './projection.ts';

type Row=Record<string,JsonValue>;
const args=(value:JsonValue):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:{};
const configKey=()=>({id:GRANOLA_CONNECTOR_ID});
const config=async(context:OperationContext)=>await context.data.get('connector_config',{key:configKey()}) as Row|null;
const generation=(row:Row|null):string|null=>typeof row?.connection_id==='string'?row.connection_id:null;
const now=()=>new Date().toISOString();
const revision=(value:unknown,row:Row|null):number=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(row?.revision??0))
    throw new OperationError('conflict');
  return Number(value);
};
const keySecret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8
  &&value.length<=4096&&value.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(value);
const configView=(row:Row|null)=>({origin:GRANOLA_ORIGIN,enabled:row?.enabled===true,
  hasKey:typeof row?.key_ref==='string',hasWebhookSecret:typeof row?.webhook_key_ref==='string',
  hasWebhookService:typeof row?.webhook_service_token_ref==='string',
  revision:typeof row?.revision==='number'?row.revision:0,
  state:!row||!row.key_ref?'missing':row.enabled===true?'unverified':'configured'});
const webhookRefs=(row:Row)=>[
  [row.webhook_key_ref,row.webhook_secret_version],
  [row.webhook_previous_key_ref,row.webhook_previous_secret_version],
  [row.webhook_service_token_ref,row.webhook_service_token_version]
].filter((item):item is [string,number]=>typeof item[0]==='string'&&Number.isSafeInteger(item[1]));
const revokeWebhookSecrets=async(context:OperationContext,row:Row)=>{
  if(!context.providerSecrets)throw new OperationError('unsupported');
  return Promise.all(webhookRefs(row).map(async([reference,expectedVersion])=>
    (await context.providerSecrets!.prepareRevoke({providerId:GRANOLA_CONNECTOR_ID,
      reference,expectedVersion})).plan));
};
const guarded=(context:OperationContext,id:string)=>context.data.planGet('connector_config',{
  key:configKey(),where:{connection_id:id,enabled:true},required:true});
const ready=async(context:OperationContext)=>{
  const row=await config(context),id=generation(row);
  if(row?.enabled!==true||typeof row.key_ref!=='string'||!id)throw new OperationError('unavailable');
  return id;
};
const remote=async(context:OperationContext,request:Parameters<ConnectorPort['request']>[0])=>{
  if(!context.connector)throw new OperationError('unavailable');
  const answer=await context.connector.request({...request,signal:context.signal});
  if(answer.kind==='ok')return answer.body;
  throw new OperationError(answer.code==='remote_not_found'?'not_found':
    answer.code==='access_denied'?'forbidden':answer.code==='invalid_request'?'invalid_input':'unavailable');
};
const run=async(context:OperationContext,collection:string)=>await context.data.get('sync_state',
  {key:{id:collection}}) as Row|null;
const runView=(row:Row|null,collection:string)=>({collection,
  runId:typeof row?.run_id==='string'?row.run_id:null,
  cursor:typeof row?.cursor==='string'?row.cursor:null,
  status:row?.status==='pages_exhausted'?'pages_exhausted':'partial',
  revision:typeof row?.revision==='number'?row.revision:0,
  updatedAt:typeof row?.updated_at==='string'?row.updated_at:null});
const collection=(value:unknown):'notes'|'folders'=>{
  if(value!=='notes'&&value!=='folders')throw new OperationError('invalid_input');return value;
};
const runId=(value:unknown):string=>{
  if(typeof value!=='string'||value.length<1||value.length>128||!value.isWellFormed()
    ||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value))throw new OperationError('invalid_input');
  return value;
};

export async function configRead(_value:JsonValue,context:OperationContext){
  return {output:{config:configView(await config(context))}};
}
export async function configSet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),old=revision(input.revision,prior);
  if(typeof input.enabled!=='boolean'||input.enabled&&typeof prior?.key_ref!=='string')
    throw new OperationError('invalid_input');
  const changes={origin:GRANOLA_ORIGIN,enabled:input.enabled,updated_at:now()};
  const plan=prior?context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('connector_config',{values:{id:GRANOLA_CONNECTOR_ID,...changes,
      key_ref:null,secret_version:null,connection_id:null,webhook_key_ref:null,
      webhook_secret_version:null,webhook_previous_key_ref:null,webhook_previous_secret_version:null,
      webhook_service_token_ref:null,webhook_service_token_version:null,revision:1}});
  return {output:{config:configView({...prior,...changes,revision:old+1})},plans:[plan]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),old=revision(input.revision,prior);
  if(!prior||!keySecret(input.apiKey))throw new OperationError('invalid_input');
  if(!context.providerSecrets)throw new OperationError('unsupported');
  const sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await context.providerSecrets.prepareReplace({providerId:GRANOLA_CONNECTOR_ID,
      reference:prior.key_ref,expectedVersion:Number(prior.secret_version),secret:input.apiKey})
    :await context.providerSecrets.preparePut({providerId:GRANOLA_CONNECTOR_ID,secret:input.apiKey});
  // Every key rotation invalidates the visible generation and all checkpoints.
  const changes={key_ref:sealed.reference,secret_version:sealed.version,
    connection_id:crypto.randomUUID(),enabled:false,webhook_key_ref:null,
    webhook_secret_version:null,webhook_previous_key_ref:null,webhook_previous_secret_version:null,
    webhook_service_token_ref:null,webhook_service_token_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:old},values:changes});
  return {output:{config:configView({...prior,...changes,revision:old+1})},
    plans:[sealed.plan,...await revokeWebhookSecrets(context,prior),plan]};
}
export async function configKeyRevoke(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),old=revision(input.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))
    throw new OperationError('invalid_input');
  if(!context.providerSecrets)throw new OperationError('unsupported');
  const sealed=await context.providerSecrets.prepareRevoke({providerId:GRANOLA_CONNECTOR_ID,
    reference:prior.key_ref,expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,connection_id:null,enabled:false,webhook_key_ref:null,
    webhook_secret_version:null,webhook_previous_key_ref:null,webhook_previous_secret_version:null,
    webhook_service_token_ref:null,webhook_service_token_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:old},values:changes});
  return {output:{config:configView({...prior,...changes,revision:old+1})},
    plans:[sealed.plan,...await revokeWebhookSecrets(context,prior),plan]};
}
export async function configWebhookSet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),old=revision(input.revision,prior);
  if(!prior||prior.enabled!==true||!generation(prior)||typeof input.webhookSecret!=='string'
    ||!/^whsec_[A-Za-z0-9_+\-/=]{16,512}$/u.test(input.webhookSecret))throw new OperationError('invalid_input');
  if(!context.providerSecrets)throw new OperationError('unsupported');
  const sealed=await context.providerSecrets.preparePut({providerId:GRANOLA_CONNECTOR_ID,
    secret:input.webhookSecret});
  const revoked=typeof prior.webhook_previous_key_ref==='string'
    &&Number.isSafeInteger(prior.webhook_previous_secret_version)
    ?[(await context.providerSecrets.prepareRevoke({providerId:GRANOLA_CONNECTOR_ID,
      reference:prior.webhook_previous_key_ref,
      expectedVersion:Number(prior.webhook_previous_secret_version)})).plan]:[];
  const changes={webhook_key_ref:sealed.reference,webhook_secret_version:sealed.version,
    webhook_previous_key_ref:typeof prior.webhook_key_ref==='string'?prior.webhook_key_ref:null,
    webhook_previous_secret_version:Number.isSafeInteger(prior.webhook_secret_version)
      ?Number(prior.webhook_secret_version):null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:old},values:changes});
  return {output:{config:configView({...prior,...changes,revision:old+1})},plans:[sealed.plan,...revoked,plan]};
}
export async function configWebhookRevoke(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),old=revision(input.revision,prior);
  if(!prior||typeof prior.webhook_key_ref!=='string')throw new OperationError('invalid_input');
  const changes={webhook_key_ref:null,webhook_secret_version:null,webhook_previous_key_ref:null,
    webhook_previous_secret_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:old},values:changes});
  const refs=webhookRefs(prior).filter(([reference])=>reference!==prior.webhook_service_token_ref);
  if(!context.providerSecrets)throw new OperationError('unsupported');
  const revoked=await Promise.all(refs.map(async([reference,expectedVersion])=>
    (await context.providerSecrets!.prepareRevoke({providerId:GRANOLA_CONNECTOR_ID,
      reference,expectedVersion})).plan));
  return {output:{config:configView({...prior,...changes,revision:old+1})},plans:[...revoked,plan]};
}
export async function configWebhookServiceSet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),old=revision(input.revision,prior);
  if(!prior||prior.enabled!==true||!generation(prior)||typeof input.serviceToken!=='string'
    ||!/^cz1a_[A-Za-z0-9_-]{43}$/u.test(input.serviceToken))throw new OperationError('invalid_input');
  if(!context.providerSecrets)throw new OperationError('unsupported');
  const sealed=await context.providerSecrets.preparePut({providerId:GRANOLA_CONNECTOR_ID,
    secret:input.serviceToken});
  const revoked=typeof prior.webhook_service_token_ref==='string'
    &&Number.isSafeInteger(prior.webhook_service_token_version)
    ?[(await context.providerSecrets.prepareRevoke({providerId:GRANOLA_CONNECTOR_ID,
      reference:prior.webhook_service_token_ref,
      expectedVersion:Number(prior.webhook_service_token_version)})).plan]:[];
  const changes={webhook_service_token_ref:sealed.reference,webhook_service_token_version:sealed.version,
    updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:old},values:changes});
  return {output:{config:configView({...prior,...changes,revision:old+1})},plans:[sealed.plan,...revoked,plan]};
}
export async function configWebhookServiceRevoke(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),old=revision(input.revision,prior);
  if(!prior||typeof prior.webhook_service_token_ref!=='string'
    ||!Number.isSafeInteger(prior.webhook_service_token_version))throw new OperationError('invalid_input');
  if(!context.providerSecrets)throw new OperationError('unsupported');
  const sealed=await context.providerSecrets.prepareRevoke({providerId:GRANOLA_CONNECTOR_ID,
    reference:prior.webhook_service_token_ref,
    expectedVersion:Number(prior.webhook_service_token_version)});
  const changes={webhook_service_token_ref:null,webhook_service_token_version:null,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:old},values:changes});
  return {output:{config:configView({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
export async function eventReceive(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),eventId=input.eventId;
  if(typeof eventId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(eventId)
    ||input.requestKey!==eventId||typeof input.bodyDigest!=='string'
    ||!/^[a-f0-9]{64}$/u.test(input.bodyDigest)
    ||typeof input.eventType!=='string'
    ||!['note.generated','note.edited','note.access_granted'].includes(input.eventType)
    ||typeof input.noteId!=='string'||!/^not_[A-Za-z0-9]{1,60}$/u.test(input.noteId)
    ||typeof input.occurredAt!=='string'||!Number.isFinite(Date.parse(input.occurredAt))
    ||!prior||prior.enabled!==true||!generation(prior)||typeof prior.webhook_key_ref!=='string')
    throw new OperationError('invalid_input');
  const existing=await context.data.get('webhook_event',{key:{id:eventId}}) as Row|null;
  if(existing){
    if(existing.body_digest!==input.bodyDigest||existing.connection_id!==prior.connection_id)
      throw new OperationError('conflict');
    return {output:{eventId,recorded:true}};
  }
  return {output:{eventId,recorded:true},plans:[
    context.data.planGet('connector_config',{key:configKey(),required:true,
      where:{connection_id:prior.connection_id,enabled:true,revision:prior.revision,
        webhook_key_ref:prior.webhook_key_ref}}),
    context.data.planCreate('webhook_event',{values:{id:eventId,connection_id:prior.connection_id,
      event_type:input.eventType,note_id:input.noteId,
      occurred_at:new Date(input.occurredAt).toISOString(),
      body_digest:input.bodyDigest,revision:1,received_at:now()}})]};
}
export async function connectionCheck(_value:JsonValue,context:OperationContext){
  await ready(context);
  projectNoteList(await remote(context,{resource:'notes',limit:1}),1);
  return {output:{reachable:true}};
}
export async function syncState(_value:JsonValue,context:OperationContext){
  const [configuration,notes,folders]=await Promise.all([config(context),run(context,'notes'),run(context,'folders')]);
  const id=generation(configuration);
  return {output:{states:[['notes',notes],['folders',folders]].map(([kind,row])=>
    runView(id&&(row as Row|null)?.connection_id===id?row as Row:null,String(kind)))}};
}
export async function syncStart(value:JsonValue,context:OperationContext){
  const input=args(value),kind=collection(input.collection),rid=runId(input.runId);
  const prior=await run(context,kind),old=revision(input.revision,prior),id=await ready(context);
  const changes={run_id:rid,connection_id:id,cursor:null,status:'partial',updated_at:now()};
  const plan=prior?context.data.planPatch('sync_state',{key:{id:kind},
    compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('sync_state',{values:{id:kind,...changes,revision:1}});
  return {output:{state:runView({...prior,...changes,revision:old+1},kind)},plans:[guarded(context,id),plan]};
}
export async function syncPage(value:JsonValue,context:OperationContext){
  const input=args(value),kind=collection(input.collection),rid=runId(input.runId),
    cursor=input.cursor===null?null:remoteCursor(input.cursor),prior=await run(context,kind),
    old=revision(input.expectedRevision,prior),id=await ready(context),limit=input.limit;
  if(!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>8||!prior||
    prior.connection_id!==id||prior.run_id!==rid||prior.cursor!==cursor||prior.status!=='partial')
    throw new OperationError('conflict');
  const body=await remote(context,{resource:kind,cursor:cursor??undefined,limit:Number(limit)});
  const page=kind==='notes'?projectNoteList(body,Number(limit)):projectFolderList(body,Number(limit));
  const model=kind==='notes'?'note':'folder',plans=[guarded(context,id)];
  for(const item of page.rows){
    const oldRow=await context.data.get(model,{key:{id:item.id},fields:['id','revision']}) as Row|null;
    const {id:itemId,...projected}=item;
    const values={...projected,connection_id:id,synced_at:now(),
      ...(kind==='notes'&&!oldRow?{folder_id:null,summary_text:null,web_url:null}:{})};
    plans.push(oldRow?context.data.planPatch(model,{key:{id:item.id},
      compare:{field:'revision',expected:Number(oldRow.revision)},values}):
      context.data.planCreate(model,{values:{id:itemId,...values,revision:1}}));
  }
  const changes={cursor:page.nextCursor,status:page.nextCursor?'partial':'pages_exhausted',updated_at:now()};
  plans.push(context.data.planPatch('sync_state',{key:{id:kind},compare:{field:'revision',expected:old},values:changes}));
  return {output:{state:runView({...prior,...changes,revision:old+1},kind),processed:page.rows.length},plans};
}
const listInput=(value:JsonValue)=>{
  const input=args(value);
  if(!Number.isSafeInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>25)
    throw new OperationError('invalid_input');
  return {limit:Number(input.limit),cursor:input.cursor===undefined?null:runId(input.cursor)};
};
async function localPage(context:OperationContext,model:'note'|'folder',value:JsonValue,fields:readonly string[]){
  const input=listInput(value),id=generation(await config(context));
  if(!id)return {output:{items:[],nextCursor:null}};
  const result=await context.data.list(model,{limit:input.limit,where:{connection_id:id},
    ...(input.cursor?{after:{id:input.cursor}}:{}),fields});
  if(generation(await config(context))!==id)throw new OperationError('conflict');
  return {output:{items:result.items,nextCursor:typeof result.nextAfter?.id==='string'?result.nextAfter.id:null}};
}
export async function noteList(value:JsonValue,context:OperationContext){
  return localPage(context,'note',value,['id','title','owner','note_created_at','note_updated_at','folder_id','summary_text','synced_at']);
}
export async function folderList(value:JsonValue,context:OperationContext){
  return localPage(context,'folder',value,['id','name','parent_folder_id','synced_at']);
}
export async function noteDetail(value:JsonValue,context:OperationContext){
  const id=noteId(args(value).id),connection=generation(await config(context));
  if(!connection)throw new OperationError('not_found');
  const row=await context.data.get('note',{key:{id},fields:['id','connection_id','title','owner','note_created_at',
    'note_updated_at','summary_text','web_url','synced_at']}) as Row|null;
  if(!row||row.connection_id!==connection)throw new OperationError('not_found');
  const {connection_id:_connection,...note}=row;
  return {output:{note}};
}
export async function noteRefresh(value:JsonValue,context:OperationContext){
  const id=noteId(args(value).id),connection=await ready(context);
  const old=await context.data.get('note',{key:{id},fields:['id','revision','connection_id']}) as Row|null;
  if(!context.connector)throw new OperationError('unavailable');
  const answer=await context.connector.request({resource:'note',id,signal:context.signal});
  if(answer.kind!=='ok'){
    if(answer.code!=='remote_not_found')throw new OperationError(answer.code==='access_denied'?'forbidden':
      answer.code==='invalid_request'?'invalid_input':'unavailable');
    if(!old||old.connection_id!==connection)throw new OperationError('not_found');
    return {output:{note:null,removed:true},plans:[guarded(context,connection),
      context.data.planPatch('note',{key:{id},compare:{field:'revision',expected:Number(old.revision)},
        where:{connection_id:connection},values:{connection_id:`missing:${connection}`,synced_at:now()}})]};
  }
  const item=projectNoteDetail(answer.body,id);
  const {id:itemId,...projected}=item;
  const values={...projected,connection_id:connection,synced_at:now()};
  const plan=old?context.data.planPatch('note',{key:{id},
    compare:{field:'revision',expected:Number(old.revision)},values}):
    context.data.planCreate('note',{values:{id:itemId,...values,revision:1}});
  return {output:{note:{...item,synced_at:values.synced_at},removed:false},plans:[guarded(context,connection),plan]};
}
export async function transcriptPage(value:JsonValue,context:OperationContext){
  const input=args(value),id=noteId(input.id),cursor=input.cursor===null||input.cursor===undefined
    ?null:remoteCursor(input.cursor),
    limit=input.limit,connection=generation(await config(context));
  if(!connection)throw new OperationError('not_found');
  if(!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>25)
    throw new OperationError('invalid_input');
  const selected=await context.data.get('note',{key:{id},fields:['id','connection_id']}) as Row|null;
  if(!selected||selected.connection_id!==connection)throw new OperationError('not_found');
  const page=projectTranscript(await remote(context,{resource:'transcript',id,
    cursor:cursor??undefined,limit:Number(limit)}),id,Number(limit),cursor);
  return {output:{note_id:id,segments:page.rows,nextCursor:page.nextCursor}};
}
