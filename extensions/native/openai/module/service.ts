import {OperationError,type OperationContext,type JsonValue} from '../../../../sdk/operations/handler.ts';
import type {ProviderSecretsPort} from '../../../../sdk/providers/types.ts';
import {OPENAI_PROVIDER_ID} from './storage.ts';

type Row=Record<string,JsonValue>;
type Input=Record<string,unknown>;
type Availability={providerId:string;state:'ready'|'missing'|'invalid'|'unavailable';modelIds:readonly string[]};
const input=(value:JsonValue):Input=>value&&typeof value==='object'&&!Array.isArray(value)?value as Input:{};
const availability=(context:OperationContext):Availability|undefined=>{
  const value=(context as OperationContext & {providerAvailability?:Availability}).providerAvailability;
  return value?.providerId===OPENAI_PROVIDER_ID?value:undefined;
};
const key=()=>({id:OPENAI_PROVIDER_ID});
const model=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const secret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8&&value.length<=4096
  &&value.isWellFormed()&&!/[\r\n\u0000-\u001f\u007f]/.test(value);
const configView=(row:Row|null,available:Availability|undefined)=>({providerId:OPENAI_PROVIDER_ID,
  enabled:row?.enabled===true,modelId:typeof row?.model_id==='string'?row.model_id:null,
  state:!row||!row.api_key_ref||!row.model_id?'missing':available?.state??'unverified',
  revision:typeof row?.revision==='number'?row.revision:0});
const current=async(context:OperationContext)=>await context.data.get('provider_config',{key:key()}) as Row|null;
const expected=(value:unknown,row:Row|null):number=>{
  const revision=Number(value);
  if(!Number.isSafeInteger(revision)||revision<0||revision!==(row?.revision??0))throw new OperationError('conflict');
  return revision;
};

export async function configRead(_value:JsonValue,context:OperationContext){
  return {output:{config:configView(await current(context),availability(context))}};
}
export async function modelsList(value:JsonValue,context:OperationContext){
  const args=input(value),limit=Number(args.limit),cursor=args.cursor;
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||cursor!==undefined&&!model(cursor))
    throw new OperationError('invalid_input');
  const available=availability(context),models=available?.state==='ready'?
    [...new Set(available.modelIds.filter(model))].sort():[];
  const start=cursor===undefined?0:models.findIndex(item=>item===cursor)+1;
  if(cursor!==undefined&&start===0)throw new OperationError('invalid_input');
  const page=models.slice(start,start+limit);
  return {output:{items:page.map(id=>({id})),nextCursor:start+limit<models.length?page.at(-1)??null:null}};
}
export async function configSet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),revision=expected(args.revision,prior);
  if(!model(args.modelId)||typeof args.enabled!=='boolean')throw new OperationError('invalid_input');
  if(args.enabled&&!prior?.api_key_ref)throw new OperationError('invalid_input');
  const now=new Date().toISOString();
  const changes={model_id:args.modelId,enabled:args.enabled,updated_at:now};
  const plan=prior?context.data.planPatch('provider_config',{key:key(),compare:{field:'revision',expected:revision},
    values:changes}):context.data.planCreate('provider_config',{values:{id:OPENAI_PROVIDER_ID,...changes,
      api_key_ref:null,secret_version:null,revision:1}});
  const next={...(prior??{}),...changes,revision:revision+1};
  return {output:{config:configView(next,availability(context))},plans:[plan]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const args=input(value),prior=await current(context),revision=expected(args.revision,prior);
  if(!secret(args.apiKey)||!model(args.modelId)||typeof args.enabled!=='boolean')
    throw new OperationError('invalid_input');
  const port=(context as OperationContext & {providerSecrets?:ProviderSecretsPort}).providerSecrets;
  if(!port)throw new OperationError('unsupported');
  const sealed=prior?.api_key_ref&&typeof prior.api_key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await port.prepareReplace({providerId:OPENAI_PROVIDER_ID,reference:prior.api_key_ref,
      expectedVersion:Number(prior.secret_version),secret:args.apiKey})
    :await port.preparePut({providerId:OPENAI_PROVIDER_ID,secret:args.apiKey});
  const now=new Date().toISOString();
  const changes={model_id:args.modelId,api_key_ref:sealed.reference,secret_version:sealed.version,
    enabled:args.enabled,updated_at:now};
  const plan=prior?context.data.planPatch('provider_config',{key:key(),compare:{field:'revision',expected:revision},
    values:changes}):context.data.planCreate('provider_config',{values:{id:OPENAI_PROVIDER_ID,...changes,revision:1}});
  const next={...(prior??{}),...changes,revision:revision+1};
  return {output:{config:configView(next,undefined)},plans:[sealed.plan,plan]};
}
