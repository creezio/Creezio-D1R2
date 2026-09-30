import {OperationError,type OperationContext,type JsonValue} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {N8N_CONNECTOR_ID} from './storage.ts';
import {webhookCurrent} from './webhook.ts';

type Row=Record<string,JsonValue>;
const args=(value:JsonValue):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:{};
const safeId=(value:unknown,code:'invalid_input'|'unknown'='invalid_input'):string=>{
  if(typeof value!=='string'||value.length<1||value.length>128||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))throw new OperationError(code);
  return value;
};
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationError('unknown');
  return value as Record<string,unknown>;
};
const currentApi=async(context:OperationContext)=>await context.data.get('connector_config',
  {key:{id:N8N_CONNECTOR_ID}}) as Row|null;
const owned=async(context:OperationContext,id:unknown):Promise<Row>=>{
  const row=await context.data.get('run',{key:{id:safeId(id)}}) as Row|null;
  if(!row||row.principal_id!==context.principalId||row.audience!==context.audience)
    throw new OperationError('not_found');
  return row;
};
const view=(row:Row)=>({id:row.id,workflowId:row.workflow_id,status:row.status,
  remoteExecutionId:row.remote_execution_id,remoteStatus:row.remote_status,
  revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at});
const connector=(context:OperationContext):ConnectorPort=>{
  const port=(context as OperationContext & {connector?:ConnectorPort}).connector;
  if(!port)throw new OperationError('unavailable');
  return port;
};
const matchingWebhook=async(context:OperationContext,row:Row)=>{
  const config=await webhookCurrent(context);
  if(!config||config.enabled!==true||typeof config.key_ref!=='string'||
    config.revision!==row.webhook_revision||config.origin!==row.webhook_origin||
    config.path_id!==row.path_id||config.workflow_id!==row.workflow_id)
    throw new OperationError('unavailable');
  return config;
};
const matchingApi=async(context:OperationContext,row:Row)=>{
  const api=await currentApi(context);
  if(!api||api.enabled!==true||typeof api.key_ref!=='string'||
    !Number.isSafeInteger(api.secret_version)||api.origin!==row.webhook_origin)
    throw new OperationError('unavailable');
  return api;
};
const boundedInput=(value:unknown):JsonValue=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new OperationError('invalid_input');
  let encoded:string;
  try{encoded=JSON.stringify(value);}catch{throw new OperationError('invalid_input');}
  if(!encoded||new TextEncoder().encode(encoded).length>8192)throw new OperationError('invalid_input');
  return JSON.parse(encoded) as JsonValue;
};
export async function runPrepare(value:JsonValue,context:OperationContext){
  const a=args(value),[config,api]=await Promise.all([webhookCurrent(context),currentApi(context)]);
  if(!config||config.enabled!==true||typeof config.key_ref!=='string'||
    typeof config.origin!=='string'||typeof config.path_id!=='string'||
    typeof config.workflow_id!=='string'||!Number.isSafeInteger(config.revision)||
    !api||api.enabled!==true||typeof api.key_ref!=='string'||
    !Number.isSafeInteger(api.secret_version)||api.origin!==config.origin)
    throw new OperationError('unavailable');
  const input=boundedInput(a.input),now=new Date().toISOString(),id=context.executionId;
  const plan=context.data.planCreate('run',{values:{id,principal_id:context.principalId,
    audience:context.audience,workflow_id:config.workflow_id,path_id:config.path_id,
    webhook_origin:config.origin,webhook_revision:config.revision,input,
    status:'prepared',remote_execution_id:null,remote_status:null,revision:1,
    created_at:now,updated_at:now}});
  return {output:{run:{id,workflowId:config.workflow_id,status:'prepared',remoteExecutionId:null,
    remoteStatus:null,revision:1,createdAt:now,updatedAt:now}},plans:[plan]};
}
export async function runRead(value:JsonValue,context:OperationContext){
  return {output:{run:view(await owned(context,args(value).id))}};
}
export async function runTrigger(value:JsonValue,context:OperationContext){
  const a=args(value),id=safeId(a.id);
  if(a.requestKey!==id)throw new OperationError('invalid_input');
  const row=await owned(context,id);
  if(row.status!=='prepared'||row.remote_execution_id!==null||row.revision!==a.revision)
    throw new OperationError('conflict');
  const created=typeof row.created_at==='string'?Date.parse(row.created_at):NaN;
  if(!Number.isFinite(created)||created>Date.now()||Date.now()-created>15*60_000)
    throw new OperationError('conflict');
  await matchingWebhook(context,row);
  const api=await matchingApi(context,row);
  const answer=await connector(context).mutate({resource:'trigger',id:safeId(row.path_id),
    fields:{intentId:id,workflowId:safeId(row.workflow_id),input:row.input},signal:context.signal});
  if(answer.kind!=='ok')throw new OperationError(answer.code==='outcome_unknown'||
    answer.status!==undefined&&answer.status>=200&&answer.status<=299?'unknown':
    answer.code==='access_denied'?'forbidden':'unavailable');
  const response=object(answer.body),executionId=safeId(response.executionId,'unknown');
  if(response.intentId!==id)throw new OperationError('unknown');
  const config=await webhookCurrent(context);
  if(!config||config.revision!==row.webhook_revision||config.origin!==row.webhook_origin||
    config.path_id!==row.path_id||config.workflow_id!==row.workflow_id||config.enabled!==true)
    throw new OperationError('unknown');
  const afterApi=await currentApi(context);
  if(!afterApi||afterApi.revision!==api.revision||afterApi.origin!==api.origin||
    afterApi.enabled!==api.enabled||afterApi.key_ref!==api.key_ref||
    afterApi.secret_version!==api.secret_version)throw new OperationError('unknown');
  const apiGuard=context.data.planGet('connector_config',{
    key:{id:N8N_CONNECTOR_ID},required:true,
    where:{revision:api.revision,origin:api.origin,enabled:true,
      key_ref:api.key_ref,secret_version:api.secret_version}});
  const now=new Date().toISOString(),plan=context.data.planPatch('run',{
    key:{id},compare:{field:'revision',expected:Number(row.revision)},
    values:{status:'accepted',remote_execution_id:executionId,updated_at:now}});
  return {output:{run:view({...row,status:'accepted',remote_execution_id:executionId,
    revision:Number(row.revision)+1,updated_at:now})},plans:[apiGuard,plan]};
}
export async function runRefresh(value:JsonValue,context:OperationContext){
  const a=args(value),row=await owned(context,a.id);
  if(row.revision!==a.revision||typeof row.remote_execution_id!=='string')
    throw new OperationError('conflict');
  const api=await currentApi(context);
  if(!api||api.enabled!==true||typeof api.key_ref!=='string'||api.origin!==row.webhook_origin)
    throw new OperationError('unavailable');
  const answer=await connector(context).request({resource:'execution',
    id:safeId(row.remote_execution_id),signal:context.signal});
  if(answer.kind!=='ok')throw new OperationError(answer.code==='remote_not_found'?'not_found':'unavailable');
  const body=object(answer.body);
  if(safeId(body.id,'unknown')!==row.remote_execution_id||
    safeId(body.workflowId,'unknown')!==row.workflow_id||
    typeof body.status!=='string'||body.status.length<1||body.status.length>64||
    !/^[a-z][a-z0-9_-]*$/i.test(body.status))throw new OperationError('unavailable');
  const after=await currentApi(context);
  if(!after||after.revision!==api.revision||after.origin!==api.origin||
    after.enabled!==api.enabled||after.key_ref!==api.key_ref)throw new OperationError('conflict');
  const now=new Date().toISOString(),plan=context.data.planPatch('run',{
    key:{id:row.id},compare:{field:'revision',expected:Number(row.revision)},
    values:{remote_status:body.status,updated_at:now}});
  return {output:{run:view({...row,remote_status:body.status,
    revision:Number(row.revision)+1,updated_at:now})},plans:[plan]};
}
