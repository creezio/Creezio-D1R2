import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {HERMES_CONNECTOR_ID} from './storage.ts';

type Row=Record<string,JsonValue>;
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationError('unavailable');
  return value as Record<string,unknown>;
};
const args=(value:JsonValue):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:{};
const clean=(value:unknown,max:number,min=0):string=>{
  if(typeof value!=='string'||!value.isWellFormed()||value.length<min||value.length>max
    ||new TextEncoder().encode(value).length>max||/[\u0000-\u001f\u007f]/u.test(value))throw new OperationError('unavailable');
  return value;
};
const optional=(value:unknown,max:number)=>value==null?null:clean(value,max);
const requestedId=(value:unknown):string=>{
  if(typeof value!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/u.test(value))throw new OperationError('invalid_input');
  return value;
};
const configKey={id:HERMES_CONNECTOR_ID};
const current=async(context:OperationContext)=>await context.data.get('connector_config',{key:configKey}) as Row|null;
const revision=(value:unknown,row:Row|null)=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(row?.revision??0))throw new OperationError('conflict');
  return Number(value);
};
const config=(row:Row|null)=>({origin:typeof row?.origin==='string'?row.origin:null,
  enabled:row?.enabled===true,hasKey:typeof row?.key_ref==='string',
  state:!row||!row.key_ref?'missing':row.enabled===true?'unverified':'configured',
  revision:typeof row?.revision==='number'?row.revision:0,
  generation:typeof row?.generation==='number'?row.generation:0});
export function canonicalOrigin(value:unknown):string{
  if(typeof value!=='string'||value.length<8||value.length>512||!value.isWellFormed())throw new OperationError('invalid_input');
  let url:URL;
  try{url=new URL(value);}catch{throw new OperationError('invalid_input');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'
    ||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')
    ||host.endsWith('.internal')||host.startsWith('[')||/^\d+(?:\.\d+){3}$/u.test(host))
    throw new OperationError('invalid_input');
  return url.origin;
}
const connector=(context:OperationContext):ConnectorPort=>{
  if(!context.connector)throw new OperationError('unavailable');return context.connector;
};
const remote=async(context:OperationContext,resource:string,id?:string):Promise<JsonValue>=>{
  const answer=await connector(context).request({resource,...(id?{id}:{}),signal:context.signal});
  if(answer.kind==='ok')return answer.body;
  throw new OperationError(answer.code==='remote_not_found'?'not_found':
    answer.code==='access_denied'?'forbidden':answer.code==='invalid_request'?'invalid_input':'unavailable');
};
const generation=(row:Row|null)=>typeof row?.generation==='number'?row.generation+1:1;
const stamp=(context:OperationContext,prior:Row|null,next:number)=>prior?
  context.data.planPatch('connection_stamp',{key:configKey,compare:{field:'generation',expected:Number(prior.generation)},
    values:{}}):
  context.data.planCreate('connection_stamp',{values:{id:HERMES_CONNECTOR_ID,generation:next}});
export async function configRead(_value:JsonValue,context:OperationContext){return {output:{config:config(await current(context))}};}
export async function configSet(value:JsonValue,context:OperationContext){
  const a=args(value),prior=await current(context),old=revision(a.revision,prior),origin=canonicalOrigin(a.origin);
  if(typeof a.enabled!=='boolean'||a.enabled&&!prior?.key_ref)throw new OperationError('invalid_input');
  if(typeof prior?.key_ref==='string'&&prior.origin!==origin)throw new OperationError('conflict');
  const changes={origin,enabled:a.enabled,generation:generation(prior),updated_at:new Date().toISOString()};
  const plan=prior?context.data.planPatch('connector_config',{key:configKey,compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('connector_config',{values:{id:HERMES_CONNECTOR_ID,...changes,key_ref:null,secret_version:null,revision:1}});
  return {output:{config:config({...prior,...changes,revision:old+1})},plans:[plan,stamp(context,prior,changes.generation)]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const a=args(value),prior=await current(context),old=revision(a.revision,prior);
  if(!prior||typeof a.apiKey!=='string'||a.apiKey.length<8||a.apiKey.length>4096
    ||/[\u0000-\u001f\u007f]/u.test(a.apiKey))throw new OperationError('invalid_input');
  const vault=context.providerSecrets as ProviderSecretsPort|undefined;
  if(!vault)throw new OperationError('unsupported');
  const sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await vault.prepareReplace({providerId:HERMES_CONNECTOR_ID,reference:prior.key_ref,
      expectedVersion:Number(prior.secret_version),secret:a.apiKey})
    :await vault.preparePut({providerId:HERMES_CONNECTOR_ID,secret:a.apiKey});
  const changes={key_ref:sealed.reference,secret_version:sealed.version,generation:generation(prior),updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:configKey,compare:{field:'revision',expected:old},values:changes});
  return {output:{config:config({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan,
    stamp(context,prior,changes.generation)]};
}
export async function configKeyRevoke(value:JsonValue,context:OperationContext){
  const a=args(value),prior=await current(context),old=revision(a.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))throw new OperationError('invalid_input');
  const vault=context.providerSecrets as ProviderSecretsPort|undefined;
  if(!vault)throw new OperationError('unsupported');
  const sealed=await vault.prepareRevoke({providerId:HERMES_CONNECTOR_ID,reference:prior.key_ref,
    expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,enabled:false,generation:generation(prior),updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('connector_config',{key:configKey,compare:{field:'revision',expected:old},values:changes});
  return {output:{config:config({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan,
    stamp(context,prior,changes.generation)]};
}
const featureNames=['run_submission','run_status','run_events_sse','run_stop'] as const;
const capabilities=(value:unknown)=>{
  const body=object(value);
  if(body.object!=='hermes.api_server.capabilities')throw new OperationError('unavailable');
  const features=object(body.features);
  const available=Object.fromEntries(featureNames.map(name=>[name,features[name]===true]));
  return {model:clean(body.model,128),features:available as Record<(typeof featureNames)[number],boolean>};
};
export async function capabilitiesRead(_value:JsonValue,context:OperationContext){
  return {output:{capabilities:{...capabilities(await remote(context,'capabilities')),
    observedAt:new Date().toISOString()}}};
}
const snapshotId={id:'current'};
const snapshot=async(context:OperationContext)=>await context.data.get('capability_snapshot',{key:snapshotId}) as Row|null;
export async function capabilitiesCapture(_value:JsonValue,context:OperationContext){
  const prior=await snapshot(context),old=typeof prior?.revision==='number'?prior.revision:0;
  const connection=await current(context);
  if(!connection||connection.enabled!==true)throw new OperationError('unavailable');
  const discovered=capabilities(await remote(context,'capabilities'));
  const now=new Date().toISOString(),changes={connection_generation:connection.generation,
    model:discovered.model,...discovered.features,observed_at:now};
  const plan=prior?context.data.planPatch('capability_snapshot',{key:snapshotId,
    compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('capability_snapshot',{values:{id:'current',...changes,revision:1}});
  return {output:{capabilities:{...discovered,observedAt:now},revision:old+1},plans:[plan]};
}
export async function modelsList(_value:JsonValue,context:OperationContext){
  const body=object(await remote(context,'models'));
  if(!Array.isArray(body.data)||body.data.length>100)throw new OperationError('unavailable');
  return {output:{models:body.data.map(value=>{const row=object(value);return {id:clean(row.id,128,1)};})}};
}
const statuses=new Set(['queued','started','running','stopping','waiting_for_approval',
  'completed','failed','cancelled','interrupted']);
export function projectRun(value:unknown){
  const row=object(value),status=clean(row.status,32,1),runId=clean(row.run_id,128,1);
  if(row.object!=='hermes.run'||!statuses.has(status))throw new OperationError('unavailable');
  const output=optional(row.output,64_000);
  return {runId,status,sessionId:optional(row.session_id,128),output,
    model:optional(row.model,128)};
}
const owned=async(context:OperationContext,id:unknown)=>{
  const row=await context.data.get('run',{key:{id:requestedId(id)}}) as Row|null;
  if(!row||row.principal_id!==context.principalId||row.audience!==context.audience)throw new OperationError('not_found');
  const connection=await context.data.get('connection_stamp',{key:configKey}) as Row|null;
  if(!connection||row.connection_generation!==connection.generation)
    throw new OperationError('unavailable');
  return row;
};
export async function runRead(value:JsonValue,context:OperationContext){
  const row=await owned(context,args(value).id);
  if(typeof row.remote_id!=='string')return {output:{run:{id:row.id,remote:null,status:row.status,revision:row.revision}}};
  await fresh(context,'run_status');
  const run=projectRun(await remote(context,'run',row.remote_id));
  if(run.runId!==row.remote_id)throw new OperationError('unavailable');
  return {output:{run:{id:row.id,remote:run,revision:row.revision}}};
}
export async function runRefresh(value:JsonValue,context:OperationContext){
  const a=args(value),row=await owned(context,a.id);
  if(a.revision!==row.revision||typeof row.remote_id!=='string')throw new OperationError('conflict');
  await fresh(context,'run_status');
  const run=projectRun(await remote(context,'run',row.remote_id));
  if(run.runId!==row.remote_id)throw new OperationError('unavailable');
  const plan=context.data.planPatch('run',{key:{id:row.id},compare:{field:'revision',expected:Number(row.revision)},
    values:{status:run.status,result_text:run.output,model:run.model,session_id:run.sessionId,
      updated_at:new Date().toISOString()}});
  return {output:{run:{id:row.id,remote:run,revision:Number(row.revision)+1}},plans:[plan]};
}
const fresh=async(context:OperationContext,feature:'run_submission'|'run_status'|'run_stop')=>{
  const [cap,stamp]=await Promise.all([snapshot(context),context.data.get('connection_stamp',{key:configKey})]);
  const observed=typeof cap?.observed_at==='string'?Date.parse(cap.observed_at):NaN;
  if(!cap||!stamp||cap.connection_generation!==stamp.generation||cap[feature]!==true
    ||!Number.isFinite(observed)||observed>Date.now()||Date.now()-observed>5*60_000)
    throw new OperationError('unavailable');
  return Number(stamp.generation);
};
export async function runPrepare(value:JsonValue,context:OperationContext){
  const a=args(value),prompt=a.input;
  if(typeof prompt!=='string'||prompt.trim().length<1||prompt.length>8192
    ||new TextEncoder().encode(prompt).length>8192)throw new OperationError('invalid_input');
  const connectionGeneration=await fresh(context,'run_submission');
  const now=new Date().toISOString(),id=context.executionId;
  const plan=context.data.planCreate('run',{values:{id,principal_id:context.principalId,audience:context.audience,
    connection_generation:connectionGeneration,remote_id:null,status:'prepared',input:prompt,
    revision:1,created_at:now,updated_at:now}});
  return {output:{id,status:'prepared',revision:1},plans:[plan]};
}
const ownedForAction=async(context:OperationContext,id:unknown,feature:'run_submission'|'run_stop')=>{
  const row=await owned(context,id),generation=await fresh(context,feature);
  if(row.connection_generation!==generation)throw new OperationError('unavailable');
  return row;
};
export async function runSubmit(value:JsonValue,context:OperationContext){
  const a=args(value),id=requestedId(a.id);
  if(a.requestKey!==id)throw new OperationError('invalid_input');
  const row=await ownedForAction(context,id,'run_submission');
  if(row.status!=='prepared'||row.remote_id!==null||typeof row.input!=='string'||a.revision!==row.revision)
    throw new OperationError('conflict');
  const created=typeof row.created_at==='string'?Date.parse(row.created_at):NaN;
  if(!Number.isFinite(created)||created>Date.now()||Date.now()-created>15*60_000)
    throw new OperationError('conflict');
  const answer=await connector(context).mutate({resource:'run-create',fields:{input:row.input},signal:context.signal});
  if(answer.kind!=='ok')throw new OperationError(answer.code==='outcome_unknown'?'unknown':
    answer.code==='access_denied'?'forbidden':'unavailable');
  const result=object(answer.body),remoteId=clean(result.run_id,128,1),status=clean(result.status,32,1);
  if(!/^[-A-Za-z0-9_.:]+$/u.test(remoteId)||!['started','queued','running'].includes(status))
    throw new OperationError('unknown');
  const plan=context.data.planPatch('run',{key:{id},compare:{field:'revision',expected:Number(row.revision)},
    values:{remote_id:remoteId,status,updated_at:new Date().toISOString()}});
  return {output:{id,remoteId,status,revision:Number(row.revision)+1},plans:[plan]};
}
export async function runStop(value:JsonValue,context:OperationContext){
  const a=args(value),id=requestedId(a.id);
  if(a.requestKey!==`${id}:stop`)throw new OperationError('invalid_input');
  const row=await ownedForAction(context,id,'run_stop');
  if(typeof row.remote_id!=='string'||!['started','queued','running','waiting_for_approval'].includes(String(row.status)))
    throw new OperationError('conflict');
  if(a.revision!==row.revision)throw new OperationError('conflict');
  const answer=await connector(context).mutate({resource:'run-stop',id:row.remote_id,fields:{},signal:context.signal});
  if(answer.kind!=='ok')throw new OperationError(answer.code==='outcome_unknown'?'unknown':
    answer.code==='access_denied'?'forbidden':'unavailable');
  if(object(answer.body).status!=='stopping')throw new OperationError('unknown');
  const plan=context.data.planPatch('run',{key:{id},compare:{field:'revision',expected:Number(row.revision)},
    values:{status:'stopping',updated_at:new Date().toISOString()}});
  return {output:{id,status:'stopping',revision:Number(row.revision)+1},plans:[plan]};
}
