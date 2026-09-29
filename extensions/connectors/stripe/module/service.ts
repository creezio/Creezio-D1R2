import {OperationError,type OperationContext,type JsonValue,type ProviderSecretsPort} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import {STRIPE_CONNECTOR_ID,STRIPE_ORIGIN} from './storage.ts';
import {projectStripePage,type Collection} from './projection.ts';

type Row=Record<string,JsonValue>;
const args=(value:JsonValue):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:{};
const configKey=()=>({id:STRIPE_CONNECTOR_ID});
const config=async(context:OperationContext)=>await context.data.get('connector_config',{key:configKey()}) as Row|null;
const connectionId=(row:Row|null):string|null=>typeof row?.connection_id==='string'?row.connection_id:null;
const run=async(context:OperationContext,collection:Collection)=>await context.data.get('sync_state',
  {key:{id:collection}}) as Row|null;
const rev=(value:unknown,current:Row|null):number=>{
  if(!Number.isSafeInteger(value)||Number(value)<0||value!==(current?.revision??0))
    throw new OperationError('conflict');
  return Number(value);
};
const collection=(value:unknown):Collection=>{
  if(value!=='customers'&&value!=='subscriptions'&&value!=='invoices')throw new OperationError('invalid_input');
  return value;
};
const identifier=(value:unknown,max=128):string=>{
  if(typeof value!=='string'||!value||value.length>max||!value.isWellFormed()
    ||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value))throw new OperationError('invalid_input');
  return value;
};
const cursor=(value:unknown):string|null=>value===null?null:identifier(value);
const keySecret=(value:unknown):value is string=>typeof value==='string'&&value.length>=8
  &&value.length<=4096&&value.isWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(value);
const now=()=>new Date().toISOString();
const configView=(row:Row|null)=>({origin:STRIPE_ORIGIN,enabled:row?.enabled===true,
  hasKey:typeof row?.key_ref==='string',revision:typeof row?.revision==='number'?row.revision:0,
  state:!row||!row.key_ref?'missing':row.enabled===true?'unverified':'configured'});
const runView=(row:Row|null,id:Collection)=>({collection:id,runId:typeof row?.run_id==='string'?row.run_id:null,
  cursor:typeof row?.cursor==='string'?row.cursor:null,
  status:row?.status==='pages_exhausted'?'pages_exhausted':'partial',
  revision:typeof row?.revision==='number'?row.revision:0,
  updatedAt:typeof row?.updated_at==='string'?row.updated_at:null});
const secrets=(context:OperationContext):ProviderSecretsPort=>{
  if(!context.providerSecrets)throw new OperationError('unsupported');
  return context.providerSecrets;
};
const remote=async(context:OperationContext,request:Parameters<ConnectorPort['request']>[0]):Promise<JsonValue>=>{
  if(!context.connector)throw new OperationError('unavailable');
  const answer=await context.connector.request({...request,signal:context.signal});
  if(answer.kind==='ok')return answer.body;
  throw new OperationError(answer.code==='access_denied'?'forbidden':
    answer.code==='invalid_request'?'invalid_input':answer.code==='remote_not_found'?'not_found':'unavailable');
};

export async function configRead(_value:JsonValue,context:OperationContext){
  return {output:{config:configView(await config(context))}};
}
export async function configSet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(typeof input.enabled!=='boolean'||input.enabled&&typeof prior?.key_ref!=='string')
    throw new OperationError('invalid_input');
  const changes={origin:STRIPE_ORIGIN,enabled:input.enabled,updated_at:now()};
  const plan=prior?context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes}):
    context.data.planCreate('connector_config',{values:{id:STRIPE_CONNECTOR_ID,...changes,
      key_ref:null,secret_version:null,connection_id:null,revision:1}});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},plans:[plan]};
}
export async function configKeySet(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||!keySecret(input.apiKey))throw new OperationError('invalid_input');
  const vault=secrets(context),sealed=typeof prior.key_ref==='string'&&Number.isSafeInteger(prior.secret_version)
    ?await vault.prepareReplace({providerId:STRIPE_CONNECTOR_ID,reference:prior.key_ref,
      expectedVersion:Number(prior.secret_version),secret:input.apiKey})
    :await vault.preparePut({providerId:STRIPE_CONNECTOR_ID,secret:input.apiKey});
  // A new credential invalidates every previous cursor and visible projection.
  const changes={key_ref:sealed.reference,secret_version:sealed.version,
    connection_id:crypto.randomUUID(),enabled:false,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},plans:[sealed.plan,plan]};
}
export async function configKeyRevoke(value:JsonValue,context:OperationContext){
  const input=args(value),prior=await config(context),revision=rev(input.revision,prior);
  if(!prior||typeof prior.key_ref!=='string'||!Number.isSafeInteger(prior.secret_version))
    throw new OperationError('invalid_input');
  const sealed=await secrets(context).prepareRevoke({providerId:STRIPE_CONNECTOR_ID,
    reference:prior.key_ref,expectedVersion:Number(prior.secret_version)});
  const changes={key_ref:null,secret_version:null,connection_id:null,enabled:false,updated_at:now()};
  const plan=context.data.planPatch('connector_config',{key:configKey(),
    compare:{field:'revision',expected:revision},values:changes});
  return {output:{config:configView({...prior,...changes,revision:revision+1})},plans:[sealed.plan,plan]};
}
export async function connectionCheck(_value:JsonValue,context:OperationContext){
  const body=await remote(context,{resource:'customers',limit:1});
  projectStripePage(body,'customers',1);
  return {output:{reachable:true}};
}
export async function syncState(_value:JsonValue,context:OperationContext){
  const ids:Collection[]=['customers','subscriptions','invoices'];
  const [configuration,...rows]=await Promise.all([config(context),...ids.map(id=>run(context,id))]);
  const generation=connectionId(configuration);
  return {output:{states:ids.map((id,index)=>{
    const row=rows[index]??null;
    return runView(generation&&row?.connection_id===generation?row:
      row?{revision:row.revision}:null,id);
  })}};
}
export async function syncStart(value:JsonValue,context:OperationContext){
  const input=args(value),id=collection(input.collection),runId=identifier(input.runId);
  const prior=await run(context,id),revision=rev(input.revision,prior);
  const connection=await config(context);
  const generation=connectionId(connection);
  if(connection?.enabled!==true||typeof connection.key_ref!=='string'||!generation)
    throw new OperationError('unavailable');
  const changes={run_id:runId,connection_id:generation,cursor:null,status:'partial',updated_at:now()};
  const connectionGuard=context.data.planGet('connector_config',{key:configKey(),
    where:{connection_id:generation,enabled:true},required:true});
  const plan=prior?context.data.planPatch('sync_state',{key:{id},compare:{field:'revision',expected:revision},
    values:changes}):context.data.planCreate('sync_state',{values:{id,...changes,revision:1}});
  return {output:{state:runView({...prior,...changes,revision:revision+1},id)},plans:[connectionGuard,plan]};
}
export async function syncPage(value:JsonValue,context:OperationContext){
  const input=args(value),id=collection(input.collection),runId=identifier(input.runId),
    expectedCursor=cursor(input.cursor),limit=input.limit,prior=await run(context,id),
    revision=rev(input.expectedRevision,prior);
  const generation=connectionId(await config(context));
  if(!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>8||!prior
    ||!generation||prior.connection_id!==generation||prior.run_id!==runId||
    prior.cursor!==expectedCursor||prior.status!=='partial')
    throw new OperationError('conflict');
  const body=await remote(context,{resource:id,cursor:expectedCursor??undefined,limit:Number(limit)});
  const page=projectStripePage(body,id,Number(limit));
  const model=id==='customers'?'stripe_customer':id==='subscriptions'?'stripe_subscription':'stripe_invoice';
  const plans=[context.data.planGet('connector_config',{key:configKey(),
    where:{connection_id:generation,enabled:true},required:true})];
  for(const item of page.rows){
    const old=await context.data.get(model,{key:{id:item.id},fields:['id','revision']}) as Row|null;
    plans.push(old?context.data.planPatch(model,{key:{id:item.id},
      compare:{field:'revision',expected:Number(old.revision)},
      values:{...item.values,connection_id:generation,updated_at:now()}}):
      context.data.planCreate(model,{values:{id:item.id,...item.values,connection_id:generation,
        revision:1,updated_at:now()}}));
  }
  const changes={cursor:page.nextCursor,status:page.status,updated_at:now()};
  plans.push(context.data.planPatch('sync_state',{key:{id},compare:{field:'revision',expected:revision},
    values:changes}));
  const state=runView({...prior,...changes,revision:revision+1},id);
  return {output:{state,processed:page.rows.length},plans};
}

const listInput=(value:JsonValue)=>{
  const input=args(value);
  if(!Number.isSafeInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>25)
    throw new OperationError('invalid_input');
  return {limit:Number(input.limit),cursor:input.cursor===undefined?null:identifier(input.cursor)};
};
const localPage=async(context:OperationContext,model:string,value:JsonValue,fields:readonly string[])=>{
  const input=listInput(value),generation=connectionId(await config(context));
  if(!generation)return {output:{items:[],nextCursor:null}};
  const result=await context.data.list(model,{limit:input.limit,where:{connection_id:generation},
    ...(input.cursor?{after:{id:input.cursor}}:{}),fields});
  if(connectionId(await config(context))!==generation)throw new OperationError('conflict');
  const items=result.items.map(row=>({id:row.id,...Object.fromEntries(Object.entries(row)
    .filter(([name])=>name!=='id'&&name!=='revision').map(([name,val])=>[name,val]))}));
  const output={items,nextCursor:typeof result.nextAfter?.id==='string'?result.nextAfter.id:null};
  if(new TextEncoder().encode(JSON.stringify(output)).length>220_000)throw new OperationError('unavailable');
  return {output};
};
export async function customerList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_customer',value,['id','name','livemode','updated_at']);
}
export async function subscriptionList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_subscription',value,
    ['id','customer_id','status','currency','price_id','unit_amount_minor','interval',
      'interval_count','quantity','period_end_at','livemode','updated_at']);
}
export async function invoiceList(value:JsonValue,context:OperationContext){
  return localPage(context,'stripe_invoice',value,
    ['id','customer_id','status','currency','amount_due_minor','period_start_at','period_end_at',
      'livemode','updated_at']);
}
