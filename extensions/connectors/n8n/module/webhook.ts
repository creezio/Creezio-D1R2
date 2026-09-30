import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import {canonicalOrigin} from './service.ts';
import {N8N_WEBHOOK_CONNECTOR_ID} from './storage.ts';

type Row=Record<string,JsonValue>;
const args=(value:JsonValue):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:{};
export const webhookKey=Object.freeze({id:N8N_WEBHOOK_CONNECTOR_ID});
export const webhookCurrent=async(context:OperationContext)=>
  await context.data.get('webhook_config',{key:webhookKey}) as Row|null;
const revision=(value:unknown,row:Row|null)=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(row?.revision??0))
    throw new OperationError('conflict');
  return Number(value);
};
const safeId=(value:unknown):string=>{
  if(typeof value!=='string'||value.length<1||value.length>128||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))throw new OperationError('invalid_input');
  return value;
};
export const webhookView=(row:Row|null)=>({origin:typeof row?.origin==='string'?row.origin:null,
  pathId:typeof row?.path_id==='string'?row.path_id:null,
  workflowId:typeof row?.workflow_id==='string'?row.workflow_id:null,
  enabled:row?.enabled===true,hasKey:typeof row?.key_ref==='string',
  revision:typeof row?.revision==='number'?row.revision:0});
const secret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8&&value.length<=4096
  &&value.isWellFormed()&&!/[\r\n\u0000-\u001f\u007f]/.test(value);
const secrets=(context:OperationContext):ProviderSecretsPort=>{
  const port=(context as OperationContext & {providerSecrets?:ProviderSecretsPort}).providerSecrets;
  if(!port)throw new OperationError('unsupported');
  return port;
};
export async function webhookConfigRead(_value:JsonValue,context:OperationContext){
  return {output:{config:webhookView(await webhookCurrent(context))}};
}
export async function webhookConfigSet(value:JsonValue,context:OperationContext){
  const a=args(value),prior=await webhookCurrent(context),old=revision(a.revision,prior);
  const origin=canonicalOrigin(a.origin),pathId=safeId(a.pathId),workflowId=safeId(a.workflowId);
  if(typeof a.enabled!=='boolean'||a.enabled&&!prior?.key_ref)throw new OperationError('invalid_input');
  if(typeof prior?.key_ref==='string'&&prior.origin!==origin)throw new OperationError('conflict');
  const changes={origin,path_id:pathId,workflow_id:workflowId,enabled:a.enabled,
    updated_at:new Date().toISOString()};
  const plan=prior?context.data.planPatch('webhook_config',{
    key:webhookKey,compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('webhook_config',{values:{id:N8N_WEBHOOK_CONNECTOR_ID,...changes,
      key_ref:null,secret_version:null,revision:1}});
  return {output:{config:webhookView({...prior,...changes,revision:old+1})},plans:[plan]};
}
export async function webhookKeySet(value:JsonValue,context:OperationContext){
  const a=args(value),prior=await webhookCurrent(context),old=revision(a.revision,prior);
  if(!prior||!secret(a.webhookKey))throw new OperationError('invalid_input');
  const port=secrets(context);
  const sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await port.prepareReplace({providerId:N8N_WEBHOOK_CONNECTOR_ID,reference:prior.key_ref,
      expectedVersion:Number(prior.secret_version),secret:a.webhookKey})
    :await port.preparePut({providerId:N8N_WEBHOOK_CONNECTOR_ID,secret:a.webhookKey});
  const changes={key_ref:sealed.reference,secret_version:sealed.version,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('webhook_config',{
    key:webhookKey,compare:{field:'revision',expected:old},values:changes});
  return {output:{config:webhookView({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
export async function webhookKeyRevoke(value:JsonValue,context:OperationContext){
  const a=args(value),prior=await webhookCurrent(context),old=revision(a.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))
    throw new OperationError('invalid_input');
  const sealed=await secrets(context).prepareRevoke({providerId:N8N_WEBHOOK_CONNECTOR_ID,
    reference:prior.key_ref,expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,enabled:false,updated_at:new Date().toISOString()};
  const plan=context.data.planPatch('webhook_config',{
    key:webhookKey,compare:{field:'revision',expected:old},values:changes});
  return {output:{config:webhookView({...prior,...changes,revision:old+1})},plans:[sealed.plan,plan]};
}
