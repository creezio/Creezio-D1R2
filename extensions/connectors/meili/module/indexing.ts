import {OperationError,type OperationContext,type JsonValue} from '@creezio/sdk/operations/handler';
import type {ConnectorPort} from '@creezio/sdk/connectors/types';
import type {SearchProjectionItem,SearchProjectionPort} from '@creezio/sdk/search/types';
import {parseEnqueuedTask,parseMeiliTask} from './task.ts';
import {MEILI_CONNECTOR_ID} from './storage.ts';

type Row=Record<string,JsonValue>;
type PendingRecord={id:string;revision:number;deleted:boolean};
const PAGE=50,MAX_BATCH=13,MAX_BODY=64_000;
const input=(value:JsonValue):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const now=()=>new Date().toISOString();
const config=async(context:OperationContext)=>await context.data.get('connector_config',
  {key:{id:MEILI_CONNECTOR_ID}}) as Row|null;
const job=async(context:OperationContext,source:string)=>await context.data.get('index_job',
  {key:{id:source}}) as Row|null;
const search=(context:OperationContext):SearchProjectionPort=>{
  if(!context.search)throw new OperationError('unsupported');
  return context.search;
};
const sourceFor=(args:Row,context:OperationContext):string=>{
  const available=search(context).sources();
  const source=args.source??(available.length===1?available[0]:null);
  if(typeof source!=='string'||!available.includes(source))throw new OperationError('invalid_input');
  return source;
};
const connector=(context:OperationContext):ConnectorPort=>{
  if(!context.connector)throw new OperationError('unavailable');
  return context.connector;
};
const readyConfig=async(context:OperationContext)=>{
  const row=await config(context);
  if(!row||row.enabled!==true||typeof row.key_ref!=='string'
    ||!Number.isSafeInteger(row.secret_version)||!Number.isSafeInteger(row.revision))
    throw new OperationError('unavailable');
  return row;
};
const expected=(args:Row,row:Row|null)=>{
  if(!Number.isSafeInteger(args.revision)||Number(args.revision)<0
    ||args.revision!==(row?.revision??0))throw new OperationError('conflict');
  return Number(args.revision);
};
const requireJob=(row:Row|null,source:string):Row=>{
  if(!row||typeof row.id!=='string'||row.id!==source||!Number.isSafeInteger(row.revision))
    throw new OperationError('unavailable');
  return row;
};
const output=(row:Row)=>({state:row.state,revision:row.revision,
  active:row.active_uid??null,building:row.building_uid??null,abandoned:row.abandoned_uid??null,
  preparedCount:Array.isArray(row.pending_records)?row.pending_records.length:0,
  emitKey:row.state==='prepared'?row.emit_key??null:null,
  taskUid:row.state==='waiting'?row.pending_task_uid??null:null});
const patch=(context:OperationContext,row:Row,changes:Row)=>{
  const revised={...row,...changes,revision:Number(row.revision)+1,updated_at:now()};
  const plan=context.data.planPatch('index_job',{key:{id:row.id},
    compare:{field:'revision',expected:Number(row.revision)},values:{...changes,updated_at:revised.updated_at}});
  return {row:revised,plan};
};
const projectionKey=(epoch:string,id:string)=>{
  // An epoch is a globally unique execution ID; sync retains that source's original epoch.
  const value=`${epoch}:${id}`;
  if(value.length>256)throw new OperationError('unavailable');
  return value;
};
const cleanPending={pending_cursor:null,pending_records:null,pending_payload:null,pending_kind:null,
  emit_key:null,pending_task_uid:null};
const compatible=(configuration:Row,row:Row)=>{
  if(row.config_revision!==configuration.revision)throw new OperationError('conflict');
};

export async function indexRead(value:JsonValue,context:OperationContext){
  const args=input(value),sources=[...search(context).sources()];
  const source=args.source===undefined&&sources.length!==1?null:sourceFor(args,context);
  const row=source?await job(context,source):null;
  return {output:{sources,index:row?output(row):{state:'missing',revision:0,active:null,building:null,
    abandoned:null,preparedCount:0,emitKey:null,taskUid:null}}};
}

export async function indexRebuildStart(value:JsonValue,context:OperationContext){
  const args=input(value),source=sourceFor(args,context),prior=await job(context,source),
    old=expected(args,prior),configuration=await readyConfig(context);
  if(prior&&!['ready','failed'].includes(String(prior.state)))throw new OperationError('conflict');
  const epoch=context.executionId;
  if(typeof epoch!=='string'||epoch.length>64)throw new OperationError('unavailable');
  const uid=await search(context).indexUid({source,epoch});
  const changes:Row={active_uid:prior?.active_uid??null,active_epoch:prior?.active_epoch??null,
    abandoned_uid:prior?.abandoned_uid??null,
    building_uid:uid,building_epoch:epoch,mode:'rebuild',building_count:0,cursor:null,
    ...cleanPending,state:'building',config_revision:Number(configuration.revision),updated_at:now()};
  const next={id:source,...changes,revision:old+1};
  const plan=prior?context.data.planPatch('index_job',{key:{id:source},
    compare:{field:'revision',expected:old},values:changes}):
    context.data.planCreate('index_job',{values:next});
  return {output:{index:output(next)},plans:[plan]};
}

export async function indexSyncStart(value:JsonValue,context:OperationContext){
  const args=input(value),source=sourceFor(args,context),prior=requireJob(await job(context,source),source),
    old=expected(args,prior);
  compatible(await readyConfig(context),prior);
  if(prior.state!=='ready'||typeof prior.active_uid!=='string'||typeof prior.active_epoch!=='string')
    throw new OperationError('conflict');
  const next=patch(context,prior,{building_uid:prior.active_uid,building_epoch:prior.active_epoch,
    mode:'sync',building_count:0,cursor:null,...cleanPending,state:'building'});
  return {output:{index:output(next.row)},plans:[next.plan]};
}

export async function indexPrepare(value:JsonValue,context:OperationContext){
  const args=input(value),source=sourceFor(args,context),prior=requireJob(await job(context,source),source);
  expected(args,prior);
  compatible(await readyConfig(context),prior);
  if(prior.state!=='building'||typeof prior.building_epoch!=='string'||typeof prior.building_uid!=='string')
    throw new OperationError('conflict');
  const page=await search(context).page({source,
    ...(typeof prior.cursor==='string'?{cursor:prior.cursor}:{}),limit:PAGE});
  if(page.items.length!==page.afterEach.length)throw new OperationError('unavailable');
  const batch:PendingRecord[]=[],payload:JsonValue[]=[],kind={value:null as 'upsert'|'delete'|null};
  let consumed=0;
  for(let index=0;index<page.items.length;index++){
    const item=page.items[index] as SearchProjectionItem;
    const key=projectionKey(prior.building_epoch,item.id);
    const previous=await context.data.get('index_projection',{key:{id:key}}) as Row|null;
    const changed=item.deleted?!!previous&&previous.deleted!==true:
      !previous||previous.source_revision!==item.revision||previous.deleted===true;
    if(!changed){consumed=index+1;continue;}
    const candidateKind=item.deleted?'delete':'upsert';
    if(kind.value&&kind.value!==candidateKind)break;
    const document=item.deleted?item.id:{...item.fields,id:item.id};
    const candidate=[...payload,document];
    if(new TextEncoder().encode(JSON.stringify(candidate)).length>MAX_BODY){
      if(!batch.length)throw new OperationError('unavailable');
      break;
    }
    kind.value=candidateKind;payload.push(document);
    batch.push({id:item.id,revision:item.revision,deleted:item.deleted});
    consumed=index+1;
    if(batch.length>=MAX_BATCH)break;
  }
  if(consumed===0&&page.items.length>0)throw new OperationError('unavailable');
  const cursor=consumed?page.afterEach[consumed-1]:prior.cursor;
  if(!batch.length){
    const done=page.nextCursor===null&&consumed===page.items.length;
    const changes:Row=done?{state:'ready',cursor:null,active_uid:prior.mode==='rebuild'
      ?Number(prior.building_count)>0?prior.building_uid:null:prior.active_uid,
      active_epoch:prior.building_epoch,building_uid:null,building_epoch:null,building_count:0,
      ...cleanPending}:{cursor:cursor as string};
    const next=patch(context,prior,changes);
    return {output:{index:output(next.row)},plans:[next.plan]};
  }
  const emitKey=crypto.randomUUID();
  const next=patch(context,prior,{state:'prepared',pending_cursor:cursor as string,
    pending_records:batch as unknown as JsonValue,pending_payload:payload,
    pending_kind:kind.value,emit_key:emitKey,pending_task_uid:null});
  return {output:{index:output(next.row)},plans:[next.plan]};
}

export async function indexEmit(value:JsonValue,context:OperationContext){
  const args=input(value),source=sourceFor(args,context),prior=requireJob(await job(context,source),source);
  expected(args,prior);
  compatible(await readyConfig(context),prior);
  if(prior.state!=='prepared'||args.requestKey!==prior.emit_key
    ||typeof prior.building_uid!=='string'||!Array.isArray(prior.pending_payload)
    ||!['upsert','delete'].includes(String(prior.pending_kind)))throw new OperationError('conflict');
  const answer=await connector(context).mutate({resource:prior.pending_kind==='delete'
    ?'document-delete':'document-upsert',id:prior.building_uid,
    fields:prior.pending_kind==='delete'?{ids:prior.pending_payload}:{documents:prior.pending_payload},
    signal:context.signal});
  if(answer.kind==='error')throw new OperationError(answer.code==='outcome_unknown'?'unknown':
    answer.code==='access_denied'?'forbidden':'unavailable');
  if(answer.status!==202)throw new OperationError('unavailable');
  const task=parseEnqueuedTask(answer.body,prior.building_uid,prior.pending_kind==='delete'
    ?'documentDeletion':'documentAdditionOrUpdate');
  const next=patch(context,prior,{state:'waiting',pending_task_uid:task.taskUid,emit_key:null});
  return {output:{index:output(next.row)},plans:[next.plan]};
}

export async function indexReconcile(value:JsonValue,context:OperationContext){
  const args=input(value),source=sourceFor(args,context),prior=requireJob(await job(context,source),source);
  expected(args,prior);
  compatible(await readyConfig(context),prior);
  if(prior.state!=='waiting'||typeof prior.building_uid!=='string'
    ||typeof prior.building_epoch!=='string'||!Number.isSafeInteger(prior.pending_task_uid)
    ||!Array.isArray(prior.pending_records)||prior.pending_records.length<1
    ||prior.pending_records.length>MAX_BATCH||typeof prior.pending_cursor!=='string')
    throw new OperationError('conflict');
  const answer=await connector(context).request({resource:'task',id:String(prior.pending_task_uid),signal:context.signal});
  if(answer.kind==='error')throw new OperationError(answer.code==='access_denied'?'forbidden':'unavailable');
  const proof=parseMeiliTask(answer.body,{taskUid:Number(prior.pending_task_uid),indexUid:prior.building_uid});
  if(proof.type!==(prior.pending_kind==='delete'?'documentDeletion':'documentAdditionOrUpdate'))
    throw new OperationError('unavailable');
  if(proof.status==='enqueued'||proof.status==='processing'){
    const next=patch(context,prior,{});
    return {output:{index:output(next.row)},plans:[next.plan]};
  }
  if(proof.status==='failed'||proof.status==='canceled'){
    const next=patch(context,prior,{state:'failed',...cleanPending});
    return {output:{index:output(next.row)},plans:[next.plan]};
  }
  const plans=[];
  for(const entry of prior.pending_records){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new OperationError('unavailable');
    const item=entry as Record<string,JsonValue>;
    if(typeof item.id!=='string'||!Number.isSafeInteger(item.revision)||typeof item.deleted!=='boolean')
      throw new OperationError('unavailable');
    const id=projectionKey(prior.building_epoch,item.id);
    const existing=await context.data.get('index_projection',{key:{id}}) as Row|null;
    const changes={source_id:source,epoch:prior.building_epoch,record_id:item.id,
      source_revision:Number(item.revision),deleted:item.deleted,updated_at:now()};
    plans.push(existing?context.data.planPatch('index_projection',{key:{id},
      compare:{field:'revision',expected:Number(existing.revision)},values:changes}):
      context.data.planCreate('index_projection',{values:{id,...changes,revision:1}}));
  }
  const added=prior.mode==='rebuild'?prior.pending_records.filter(item=>
    item&&typeof item==='object'&&!Array.isArray(item)&&item.deleted===false).length:0;
  const next=patch(context,prior,{state:'building',cursor:prior.pending_cursor,
    building_count:Number(prior.building_count)+added,...cleanPending});
  plans.push(next.plan);
  return {output:{index:output(next.row)},plans};
}

/** Explicitly quarantine an uncertain prepared generation; never replay or delete it. */
export async function indexAbandon(value:JsonValue,context:OperationContext){
  const args=input(value),source=sourceFor(args,context),prior=requireJob(await job(context,source),source);
  expected(args,prior);
  if(args.acknowledgeUnknown!==true||prior.state!=='prepared'||typeof prior.building_uid!=='string')
    throw new OperationError('conflict');
  const abandoned=prior.building_uid===prior.active_uid?prior.abandoned_uid:prior.building_uid;
  const next=patch(context,prior,{state:'failed',abandoned_uid:abandoned??null,
    building_uid:null,building_epoch:null,cursor:null,building_count:0,...cleanPending});
  return {output:{index:output(next.row)},plans:[next.plan]};
}

/** Search is restricted to the active context generation; only owner-model rows leave the handler. */
export async function indexSearch(value:JsonValue,context:OperationContext){
  const args=input(value),source=sourceFor(args,context),q=args.q,limit=args.limit,offset=args.offset;
  if(typeof q!=='string'||q.length>256||!q.isWellFormed()
    ||/[\u0000-\u001f\u007f]/u.test(q)||!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>20
    ||!Number.isSafeInteger(offset)||Number(offset)<0||Number(offset)>1000)
    throw new OperationError('invalid_input');
  const prior=requireJob(await job(context,source),source);
  compatible(await readyConfig(context),prior);
  if(typeof prior.active_uid!=='string'||typeof prior.active_epoch!=='string'){
    if(prior.state==='ready')return {output:{source,items:[],facets:[],pageCount:0,
      nextOffset:null,stale:false}};
    throw new OperationError('unavailable');
  }
  if(await search(context).indexUid({source,epoch:prior.active_epoch})!==prior.active_uid)
    throw new OperationError('unavailable');
  const answer=await connector(context).request({resource:'search',id:prior.active_uid,
    cursor:String(offset),limit:Number(limit),fields:{q},signal:context.signal});
  if(answer.kind==='error')throw new OperationError(answer.code==='access_denied'?'forbidden':'unavailable');
  if(!answer.body||typeof answer.body!=='object'||Array.isArray(answer.body))
    throw new OperationError('unavailable');
  const body=answer.body as Record<string,JsonValue>;
  if(!Array.isArray(body.hits)||body.hits.length>Number(limit)
    ||body.offset!==offset||body.limit!==limit)throw new OperationError('unavailable');
  const ids=body.hits.map(hit=>{
    if(!hit||typeof hit!=='object'||Array.isArray(hit))throw new OperationError('unavailable');
    const id=(hit as Record<string,JsonValue>).id;
    if(typeof id!=='string'||id.length<1||id.length>128||!id.isWellFormed())
      throw new OperationError('unavailable');
    return id;
  });
  if(new Set(ids).size!==ids.length)throw new OperationError('unavailable');
  const rows=await search(context).reauthorize({source,ids});
  const items=rows.map(row=>({id:row.id,fields:row.fields}));
  const facets=search(context).facets(source).map((field:string)=>{
    const counts=new Map<string,number>();
    for(const item of items){const value=item.fields?.[field];
      if(typeof value==='string')counts.set(value,(counts.get(value)??0)+1);}
    return {field,values:[...counts].sort(([left],[right])=>left.localeCompare(right))
      .map(([value,count])=>({value,count}))};
  });
  const nextOffset=body.hits.length===limit&&Number(offset)+body.hits.length<=1000
    ?Number(offset)+body.hits.length:null;
  return {output:{source,items,facets,pageCount:items.length,nextOffset,
    stale:prior.state!=='ready'}};
}
