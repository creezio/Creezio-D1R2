import {OperationError} from '@creezio/sdk/operations/error';
import type {OperationContext, JsonValue} from '../../../../sdk/operations/handler.ts';

type Input = Record<string, unknown>;
type Row = Record<string, JsonValue>;
type Page = {items: readonly Row[]; nextAfter: Row | null};
const conflict = (): never => {throw new OperationError('conflict');};
const missing = (): never => {throw new OperationError('not_found');};
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum && value.isWellFormed();
const input = (value: JsonValue): Input => value && typeof value === 'object' && !Array.isArray(value) ? value as Input : {};
const at = () => new Date().toISOString();
const scope = (context: OperationContext) => ({owner_id:context.principalId,audience:context.audience});
const key = (context: OperationContext, id: string) => ({...scope(context),id});
const childKey = (context: OperationContext, conversationId: string, id: string) =>
  ({...scope(context),conversation_id:conversationId,id});
const ordered = (limit: number, where: Row, after: Row | null, indexId: string, direction: 'asc' | 'desc'): Parameters<OperationContext['data']['list']>[1] =>
  ({limit,where,after,order:{indexId,direction}} as Parameters<OperationContext['data']['list']>[1]);
const summary = (row: Row) => ({id:row.id,title:row.title,mode:row.mode,updatedAt:row.updated_at,
  archivedAt:row.archived_at,revision:row.revision});
const message = (row: Row,context?:OperationContext) => {
  const content=row.content===null?null:context?.widgets?.projectSnapshot(row.content)??null;
  return {id:row.id,conversationId:row.conversation_id,role:row.role,
    body:row.content!==null&&content===null?'Widget indisponible':row.body,
    content,createdAt:row.created_at,revision:row.revision};
};
const turnView = (row: Row) => ({id:row.id,conversationId:row.conversation_id,state:row.state,
  providerId:row.provider_id,updatedAt:row.updated_at,revision:row.revision,
  lastSequence:row.last_sequence,errorCode:row.error_code});
const eventView = (row: Row) => ({turnId:row.turn_id,sequence:row.sequence,kind:row.kind,
  payload:row.payload,createdAt:row.created_at});
const attachmentView = (row: Row) => ({fileId:row.file_id,conversationId:row.conversation_id,
  filename:row.filename,contentType:row.content_type,byteSize:row.byte_size,createdAt:row.created_at,
  reference:{fileId:row.file_id,intentId:row.intent_id,generation:row.generation,digest:row.digest}});
// The data service includes one lookahead row under its 256 KiB result budget.
// Two fully escaped 16k message bodies fit; larger pages cannot guarantee that bound.
const safeMessageLimit = (requested:number) => Math.min(requested,1);

async function conversation(context: OperationContext, id: unknown): Promise<Row> {
  if(!validId(id)) throw new OperationError('invalid_input');
  const row=await context.data.get('conversation',{key:key(context,id)}) as Row | null;
  return row ?? missing();
}
async function activeConversation(context: OperationContext,id: unknown): Promise<Row> {
  const row=await conversation(context,id);
  if(row.archived_at!==null) conflict();
  return row;
}
function decodeCursor(value: unknown, expected: Record<string, unknown>): Row | null {
  if(value===null || value===undefined) return null;
  if(typeof value!=='string'||value.length>2048) throw new OperationError('invalid_input');
  try {
    const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
      atob(value.replaceAll('-','+').replaceAll('_','/')), character=>character.charCodeAt(0))));
    if(!decoded || typeof decoded!=='object' || Array.isArray(decoded) || decoded.v!==1
      || Object.entries(expected).some(([name,part])=>decoded[name]!==part)
      || decoded.after!==null&&(typeof decoded.after!=='object'||Array.isArray(decoded.after))) throw 0;
    return decoded.after as Row|null;
  } catch {throw new OperationError('invalid_input');}
}
function encodeCursor(after: Row | null, expected: Record<string, unknown>): string | null {
  if(!after)return null;
  const bytes=new TextEncoder().encode(JSON.stringify({v:1,...expected,after}));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function encodeState(after:Row|null,expected:Record<string,unknown>):string {
  const bytes=new TextEncoder().encode(JSON.stringify({v:1,...expected,after}));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
function pageArgs(value: Input): {limit:number;cursor:unknown;archived:boolean} {
  const limit=value.limit, archived=value.archived===true;
  if(!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>50||value.archived!==undefined&&typeof value.archived!=='boolean')
    throw new OperationError('invalid_input');
  return {limit:Number(limit),cursor:value.cursor,archived};
}
async function conversationPage(value: JsonValue, context: OperationContext) {
  const args=input(value), {limit,cursor,archived}=pageArgs(args);
  const expected={owner:context.principalId,audience:context.audience,context:context.contextId,archived};
  const after=decodeCursor(cursor,expected);
  const page=await context.data.list('conversation',ordered(limit,scope(context),after,'recent','desc')) as Page;
  const items=page.items.filter(row=>archived ? row.archived_at!==null : row.archived_at===null)
    .map(summary);
  return {output:{items,nextCursor:encodeCursor(page.nextAfter,expected)}};
}
export const conversationList = (value: JsonValue, context: OperationContext) => conversationPage(value,context);
/** A bounded two-phase search. An empty filtered page may still have a cursor. */
export async function conversationSearch(value:JsonValue,context:OperationContext) {
  const args=input(value), {limit,cursor,archived}=pageArgs(args), query=String(args.query??'').trim().toLocaleLowerCase();
  if(!query||query.length>240)throw new OperationError('invalid_input');
  const base={owner:context.principalId,audience:context.audience,context:context.contextId,query,archived};
  let phase:'conversation'|'message'='conversation', after:Row|null=null;
  if(cursor){
    try{after=decodeCursor(cursor,{...base,phase:'conversation'});}
    catch{after=decodeCursor(cursor,{...base,phase:'message'});phase='message';}
  }
  if(phase==='conversation'){
    const page=await context.data.list('conversation',ordered(limit,scope(context),after,'recent','desc')) as Page;
    const items=page.items.filter(row=>archived?row.archived_at!==null:row.archived_at===null)
      .filter(row=>String(row.title).toLocaleLowerCase().includes(query)).map(summary);
    return {output:{items,nextCursor:page.nextAfter?encodeState(page.nextAfter,{...base,phase}):
      encodeState(null,{...base,phase:'message'})}};
  }
  const page=await context.data.list('message',ordered(safeMessageLimit(limit),scope(context),after,
    'search-chronology','desc')) as Page;
  const seen=new Set<string>(),items=[];
  for(const row of page.items){
    if(!String(row.body).toLocaleLowerCase().includes(query)||seen.has(String(row.conversation_id)))continue;
    seen.add(String(row.conversation_id));
    const parent=await context.data.get('conversation',{key:key(context,String(row.conversation_id))}) as Row|null;
    if(parent&&(archived?parent.archived_at!==null:parent.archived_at===null))items.push(summary(parent));
  }
  return {output:{items,nextCursor:encodeCursor(page.nextAfter,{...base,phase})}};
}

export async function conversationCreate(value: JsonValue, context: OperationContext) {
  const args=input(value), now=at();
  const title=typeof args.title==='string'&&args.title.trim()?args.title.trim():'Nouvelle conversation';
  if(!text(title,240)||!['chat','work'].includes(String(args.mode)))throw new OperationError('invalid_input');
  const row={...scope(context),id:crypto.randomUUID(),title,mode:args.mode as string,
    created_at:now,updated_at:now,archived_at:null,active_turn_id:null,revision:1};
  const plan=context.data.planCreate('conversation',{values:row});
  return {output:{conversation:summary(row)},plans:[plan]};
}
export async function conversationRead(value: JsonValue, context: OperationContext) {
  const row=await conversation(context,input(value).conversationId);
  const available=(context as OperationContext & {providerAvailability?:{
    providerId:string;state:string;modelIds:readonly string[]}}).providerAvailability;
  return {output:{conversation:summary(row),provider:available?.providerId==='openai.responses.v1'
    &&available.state==='ready'&&available.modelIds.length>0?'configured':'no_provider'}};
}
async function changeConversation(value: JsonValue,context: OperationContext, action:'rename'|'archive'|'restore') {
  const args=input(value), row=await conversation(context,args.conversationId), revision=Number(args.revision);
  if(!Number.isSafeInteger(revision)||revision!==row.revision)conflict();
  if(action==='archive'&&row.archived_at!==null || action==='restore'&&row.archived_at===null)conflict();
  const now=at(), changes:Row={updated_at:now,revision:revision+1};
  if(action==='rename') {
    if(!text(args.title,240)||!String(args.title).trim())throw new OperationError('invalid_input');
    changes.title=String(args.title).trim();
  } else changes.archived_at=action==='archive'?now:null;
  const {revision:_nextRevision,...plannedChanges}=changes;
  const plan=context.data.planPatch('conversation',{key:key(context,String(args.conversationId)),
    where:scope(context),compare:{field:'revision',expected:revision},values:plannedChanges});
  return {output:{conversation:summary({...row,...changes})},plans:[plan]};
}
export const conversationRename=(value:JsonValue,context:OperationContext)=>changeConversation(value,context,'rename');
export const conversationArchive=(value:JsonValue,context:OperationContext)=>changeConversation(value,context,'archive');
export const conversationRestore=(value:JsonValue,context:OperationContext)=>changeConversation(value,context,'restore');

export async function messageList(value: JsonValue, context: OperationContext) {
  const args=input(value), {limit,cursor}=pageArgs(args), conversationId=args.conversationId;
  await conversation(context,conversationId);
  const expected={owner:context.principalId,audience:context.audience,context:context.contextId,conversationId};
  const after=decodeCursor(cursor,expected);
  const page=await context.data.list('message',ordered(safeMessageLimit(limit),{...scope(context),conversation_id:String(conversationId)},after,
    'chronology','desc')) as Page;
  return {output:{items:page.items.map(row=>message(row,context)),nextCursor:encodeCursor(page.nextAfter,expected)}};
}
/** A native host creates immutable, catalog-checked widget instances in a message. */
export async function widgetMessageCreate(value:JsonValue,context:OperationContext) {
  const args=input(value),conversationId=args.conversationId,parent=await activeConversation(context,conversationId);
  const revision=Number(args.revision);
  const widgets=context.widgets;
  if(!Number.isSafeInteger(revision)||revision!==parent.revision||!Array.isArray(args.instances))conflict();
  if(!widgets)throw new OperationError('unsupported');
  let content:JsonValue;
  try{content=widgets.createSnapshot(args.instances as Parameters<typeof widgets.createSnapshot>[0]) as unknown as JsonValue;}
  catch{throw new OperationError('invalid_input');}
  const now=at(),row:Row={...scope(context),conversation_id:String(conversationId),id:crypto.randomUUID(),
    role:'tool',body:'Widget interactif',content,created_at:now,revision:1};
  const guard=context.data.planGet('conversation',{key:key(context,String(conversationId)),where:{archived_at:null},required:true});
  const created=context.data.planCreate('message',{values:row});
  const updated=context.data.planPatch('conversation',{key:key(context,String(conversationId)),
    compare:{field:'revision',expected:revision},where:scope(context),values:{updated_at:now}});
  return {output:{message:message(row,context)},plans:[guard,created,updated]};
}
async function changeWidgetContext(value:JsonValue,context:OperationContext,remove:boolean) {
  const args=input(value),conversationId=args.conversationId,messageId=args.messageId;
  await activeConversation(context,conversationId);
  if(!validId(messageId)||!validId(args.instanceId)||!validId(args.actionId)||!context.widgets
    ||!Number.isSafeInteger(args.instanceRevision)||!Number.isSafeInteger(args.expectedRevision)
    ||Number(args.expectedRevision)<0)throw new OperationError('invalid_input');
  const source=await context.data.get('message',{key:childKey(context,String(conversationId),messageId)}) as Row|null;
  const content=source?.content===null?null:context.widgets.projectSnapshot(source?.content);
  if(!source||source.role!=='tool'||!content)throw new OperationError('not_found');
  const instance=content.instances.find(item=>item.instanceId===args.instanceId
    &&item.instanceRevision===args.instanceRevision);
  if(!instance)throw new OperationError('conflict');
  let target:ReturnType<NonNullable<OperationContext['widgets']>['contextAction']>;
  try{target=context.widgets.contextAction(instance,String(args.actionId),args.input);}
  catch{throw new OperationError('forbidden');}
  const k={...scope(context),conversation_id:String(conversationId),actor_principal_id:context.actorPrincipalId,
    instance_id:instance.instanceId,namespace:target.namespace};
  const prior=await context.data.get('widget_context',{key:k}) as Row|null;
  const expected=Number(args.expectedRevision);
  if((prior?Number(prior.revision):0)!==expected||remove&&!prior)throw new OperationError('conflict');
  const now=at(),expiresAt=new Date(Date.now()+target.expiresAfterSeconds*1000).toISOString();
  const contextValue=remove?null:target.value;
  const guard=context.data.planGet('message',{key:childKey(context,String(conversationId),messageId),required:true});
  const parentGuard=context.data.planGet('conversation',{key:key(context,String(conversationId)),where:{archived_at:null},required:true});
  const plan=prior?context.data.planPatch('widget_context',{key:k,compare:{field:'revision',expected},
    values:{value:contextValue,removed_at:remove?now:null,expires_at:expiresAt,updated_at:now,
      widget_module_id:instance.moduleId,widget_id:instance.widgetId,widget_version:instance.widgetVersion,
      message_id:messageId,action_id:String(args.actionId)}}):context.data.planCreate('widget_context',{values:{...k,
    widget_module_id:instance.moduleId,widget_id:instance.widgetId,widget_version:instance.widgetVersion,
    message_id:messageId,action_id:String(args.actionId),value:contextValue,revision:1,
    expires_at:expiresAt,removed_at:null,updated_at:now}});
  return {output:{context:{instanceId:instance.instanceId,namespace:target.namespace,revision:expected+1,
    value:contextValue,expiresAt,removed:remove}},plans:[guard,parentGuard,plan]};
}
export const widgetContextReplace=(value:JsonValue,context:OperationContext)=>changeWidgetContext(value,context,false);
export const widgetContextRemove=(value:JsonValue,context:OperationContext)=>changeWidgetContext(value,context,true);
export async function widgetContextRead(value:JsonValue,context:OperationContext) {
  const args=input(value),conversationId=args.conversationId,messageId=args.messageId;
  await conversation(context,conversationId);
  if(!validId(messageId)||!validId(args.instanceId)||!validId(args.actionId)||!context.widgets
    ||!Number.isSafeInteger(args.instanceRevision))throw new OperationError('invalid_input');
  const source=await context.data.get('message',{key:childKey(context,String(conversationId),messageId)}) as Row|null;
  const content=source?.content===null?null:context.widgets.projectSnapshot(source?.content);
  const instance=content?.instances.find(item=>item.instanceId===args.instanceId
    &&item.instanceRevision===args.instanceRevision);
  if(!instance)throw new OperationError('not_found');
  const k={...scope(context),conversation_id:String(conversationId),actor_principal_id:context.actorPrincipalId,
    instance_id:instance.instanceId,namespace:'module-instance'};
  const row=await context.data.get('widget_context',{key:k}) as Row|null;
  if(!row||row.action_id!==args.actionId||row.message_id!==messageId)return {output:{context:null}};
  return {output:{context:{instanceId:instance.instanceId,namespace:'module-instance',revision:row.revision,
    value:row.value,expiresAt:row.expires_at,removed:row.removed_at!==null||String(row.expires_at)<=at()}}};
}
export async function messageAdd(value:JsonValue,context:OperationContext) {
  const args=input(value), parent=await activeConversation(context,args.conversationId), revision=Number(args.revision);
  if(!validId(args.id)||!text(args.body,16000)||!String(args.body).trim()||revision!==parent.revision)conflict();
  const now=at(), row={...scope(context),conversation_id:String(args.conversationId),id:String(args.id),
    role:'user',body:String(args.body),content:null,created_at:now,revision:1};
  const guard=context.data.planGet('conversation',{key:key(context,String(args.conversationId)),where:{archived_at:null},required:true});
  const created=context.data.planCreate('message',{values:row});
  const updated=context.data.planPatch('conversation',{key:key(context,String(args.conversationId)),
    compare:{field:'revision',expected:revision},where:scope(context),values:{updated_at:now}});
  return {output:{message:message(row,context)},plans:[guard,created,updated]};
}
export async function draftRead(value:JsonValue,context:OperationContext) {
  const id=input(value).conversationId;
  await conversation(context,id);
  const row=await context.data.get('draft',{key:{...scope(context),conversation_id:String(id)}}) as Row | null;
  return {output:{conversationId:id,text:row?.text??'',updatedAt:row?.updated_at??null,revision:row?.revision??0}};
}
export async function draftSave(value:JsonValue,context:OperationContext) {
  const args=input(value), id=args.conversationId, expected=Number(args.revision);
  if(!text(args.text,16000)||!Number.isSafeInteger(expected)||expected<0)throw new OperationError('invalid_input');
  await activeConversation(context,id);
  const k={...scope(context),conversation_id:String(id)};
  const existing=await context.data.get('draft',{key:k}) as Row | null;
  if((existing?.revision??0)!==expected)conflict();
  const now=at(), revision=expected+1;
  const guard=context.data.planGet('conversation',{key:key(context,String(id)),where:{archived_at:null},required:true});
  const plan=existing?context.data.planPatch('draft',{key:k,compare:{field:'revision',expected},
    values:{text:String(args.text),updated_at:now}}):context.data.planCreate('draft',{
    values:{...k,text:String(args.text),updated_at:now,revision}});
  return {output:{conversationId:id,text:args.text,updatedAt:now,revision},plans:[guard,plan]};
}
async function turn(context:OperationContext,conversationId:unknown,turnId:unknown):Promise<Row|null> {
  await conversation(context,conversationId);
  if(!validId(turnId))throw new OperationError('invalid_input');
  return await context.data.get('turn',{key:childKey(context,String(conversationId),turnId)}) as Row | null;
}
export async function turnRead(value:JsonValue,context:OperationContext) {
  const args=input(value), row=await turn(context,args.conversationId,args.turnId);
  return {output:{turn:row?turnView(row):null}};
}
async function captureWidgetContexts(context:OperationContext,conversationId:string):Promise<JsonValue> {
  if(!context.widgets)return [];
  let after:Row|null=null;
  const captured:JsonValue[]=[];
  for(let pageNumber=0;pageNumber<8;pageNumber++){
    const page=await context.data.list('widget_context',ordered(4,{...scope(context),conversation_id:conversationId,
      actor_principal_id:context.actorPrincipalId},after,'by-conversation','desc')) as Page;
    for(const row of page.items){
      if(row.removed_at!==null||typeof row.expires_at!=='string'||row.expires_at<=at())continue;
      const source=await context.data.get('message',{key:childKey(context,conversationId,String(row.message_id))}) as Row|null;
      const content=source?.content===null?null:context.widgets.projectSnapshot(source?.content);
      const instance=content?.instances.find(item=>item.instanceId===row.instance_id
        &&item.moduleId===row.widget_module_id&&item.widgetId===row.widget_id
        &&item.widgetVersion===row.widget_version);
      if(!instance)continue;
      captured.push({moduleId:instance.moduleId,widgetId:instance.widgetId,widgetVersion:instance.widgetVersion,
        messageId:row.message_id,instanceId:instance.instanceId,revision:row.revision,
        value:row.value,expiresAt:row.expires_at});
      if(captured.length>4||new TextEncoder().encode(JSON.stringify(captured)).length>4096)
        throw new OperationError('invalid_input');
    }
    after=page.nextAfter;if(!after)break;
  }
  if(after)throw new OperationError('invalid_input');
  return captured;
}
export async function turnStart(value:JsonValue,context:OperationContext) {
  const args=input(value), conversationId=args.conversationId, parent=await activeConversation(context,conversationId);
  const revision=Number(args.revision), draftRevision=Number(args.draftRevision);
  if(!validId(args.messageId)||!validId(args.modelId)||!text(args.body,16000)||!String(args.body).trim()
    ||!Number.isSafeInteger(revision)||revision!==parent.revision
    ||!Number.isSafeInteger(draftRevision)||draftRevision<0||parent.active_turn_id!==null)conflict();
  const candidate=(context as OperationContext & {providerAvailability?:{
    providerId:string;state:string;modelIds:readonly string[]}}).providerAvailability;
  const available=candidate?.providerId==='openai.responses.v1'?candidate:undefined;
  if(!available||available.state!=='ready'||!available.modelIds.includes(String(args.modelId)))
    throw new OperationError('unavailable');
  const k={...scope(context),conversation_id:String(conversationId)};
  const priorDraft=await context.data.get('draft',{key:k}) as Row|null;
  if((priorDraft?.revision??0)!==draftRevision)conflict();
  const widgetContextSnapshot=await captureWidgetContexts(context,String(conversationId));
  const now=at(),turnId=crypto.randomUUID();
  const userMessage={...k,id:String(args.messageId),role:'user',body:String(args.body),content:null,
    created_at:now,revision:1};
  const turnRow={...k,id:turnId,state:'queued',provider_id:'openai.responses.v1',created_at:now,
    updated_at:now,revision:1,last_sequence:1,error_code:null,widget_context_snapshot:widgetContextSnapshot};
  const guard=context.data.planGet('conversation',{key:key(context,String(conversationId)),
    where:{archived_at:null,active_turn_id:null},required:true});
  const created=context.data.planCreate('message',{values:userMessage});
  const cleared=priorDraft?context.data.planPatch('draft',{key:k,compare:{field:'revision',expected:draftRevision},
    values:{text:'',updated_at:now}}):context.data.planCreate('draft',{
    values:{...k,text:'',updated_at:now,revision:1}});
  const begun=context.data.planCreate('turn',{values:turnRow});
  const event=context.data.planCreate('event',{values:{...k,turn_id:turnId,sequence:1,kind:'queued',
    payload:{modelId:String(args.modelId)},created_at:now}});
  const changed=context.data.planPatch('conversation',{key:key(context,String(conversationId)),
    where:{archived_at:null,active_turn_id:null},compare:{field:'revision',expected:revision},
    values:{updated_at:now,active_turn_id:turnId}});
  return {output:{message:message(userMessage,context),turn:turnView(turnRow)},
    plans:[guard,created,cleared,begun,event,changed],
    outbox:[{id:turnId,provider:'openai.responses.v1',providerIdempotencyKey:turnId,
      payload:{conversationId,turnId,messageId:args.messageId,modelId:args.modelId,step:0}}]};
}
export async function eventList(value:JsonValue,context:OperationContext) {
  const args=input(value), limit=Number(args.limit), afterSequence=Number(args.afterSequence??0);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(afterSequence)||afterSequence<0)
    throw new OperationError('invalid_input');
  if(!await turn(context,args.conversationId,args.turnId))missing();
  const where={...scope(context),conversation_id:String(args.conversationId),turn_id:String(args.turnId)};
  let after:Row|null=afterSequence?{...where,sequence:afterSequence}:null;
  const items:ReturnType<typeof eventView>[]=[],encoder=new TextEncoder();
  // Each data page includes a lookahead row. Read one event at a time; when two
  // escaped payloads exceed the D1 result guard, page over keys and fetch one.
  let bytes=encoder.encode('{"items":[],"nextSequence":null}').length;
  let nextSequence:number|null=null,remaining=50;
  for(let index=0;index<limit;index++){
    if(remaining<1)break;
    let page:Page,row:Row|undefined;
    try {
      remaining--;
      page=await context.data.list('event',{limit:1,where,after}) as Page;
      row=page.items[0];
    } catch(error) {
      if(!(error instanceof Error) || error.name!=='DataAccessError'
        || (error as Error & {code?:string}).code!=='storage_error')throw error;
      if(remaining<2){if(items.length)break;throw error;}
      remaining-=2;
      page=await context.data.list('event',{limit:1,where,after,
        fields:['owner_id','audience','conversation_id','turn_id','sequence']}) as Page;
      const keyRow=page.items[0];
      row=keyRow?await context.data.get('event',{key:{...where,sequence:keyRow.sequence}}) as Row|undefined:undefined;
    }
    if(!row){nextSequence=null;break;}
    const item=eventView(row),size=encoder.encode(JSON.stringify(item)).length+(items.length?1:0);
    // Never split an event. An oversized single event cannot be represented by
    // this bounded page contract and must be rejected instead of skipped.
    if(bytes+size+128>128*1024){
      if(!items.length)throw new OperationError('invalid_output');
      break;
    }
    items.push(item);bytes+=size;
    if(!page.nextAfter){nextSequence=null;break;}
    nextSequence=Number(row.sequence);
    after={...where,sequence:nextSequence};
  }
  return {output:{items,nextSequence}};
}
export async function turnCancel(value:JsonValue,context:OperationContext) {
  const args=input(value), row=(await turn(context,args.conversationId,args.turnId))??missing(), revision=Number(args.revision);
  if(revision!==row.revision||!['queued','running','unknown'].includes(String(row.state)))conflict();
  const now=at(), sequence=Number(row.last_sequence)+1;
  const changes={state:'cancel_requested',updated_at:now,revision:revision+1,last_sequence:sequence};
  const updated=context.data.planPatch('turn',{key:childKey(context,String(args.conversationId),String(args.turnId)),
    compare:{field:'revision',expected:revision},where:scope(context),values:{state:changes.state,
      updated_at:changes.updated_at,last_sequence:changes.last_sequence}});
  const event=context.data.planCreate('event',{values:{...scope(context),conversation_id:String(args.conversationId),
    turn_id:String(args.turnId),sequence,kind:'cancel_requested',payload:{},created_at:now}});
  return {output:{turn:turnView({...row,...changes})},plans:[updated,event]};
}

export async function attachmentLink(value:JsonValue,context:OperationContext) {
  const args=input(value), parent=await activeConversation(context,args.conversationId), revision=Number(args.revision);
  if(revision!==parent.revision||!args.staged||typeof args.staged!=='object'||Array.isArray(args.staged))conflict();
  const staged=args.staged as {fileId:string;intentId:string;generation:string;digest:string};
  const hostFiles=context.files;
  if(!hostFiles)throw new OperationError('unsupported');
  const prepared=await hostFiles.preparePublication('attachments',staged);
  const guard=context.data.planGet('conversation',{key:key(context,String(args.conversationId)),where:{archived_at:null},required:true});
  const link=context.data.planCreate('conversation_attachment',{values:{...scope(context),conversation_id:String(args.conversationId),
    file_id:staged.fileId,filename:prepared.file.filename,content_type:prepared.file.contentType,byte_size:prepared.file.byteSize,
    digest:staged.digest,intent_id:staged.intentId,generation:staged.generation,created_at:at()}});
  const updated=context.data.planPatch('conversation',{key:key(context,String(args.conversationId)),
    compare:{field:'revision',expected:revision},values:{updated_at:at()}});
  return {output:{fileId:staged.fileId,conversationId:args.conversationId},plans:[prepared.plan,guard,link,updated]};
}
export async function attachmentList(value:JsonValue,context:OperationContext) {
  const args=input(value), {limit,cursor}=pageArgs(args), conversationId=args.conversationId;
  await conversation(context,conversationId);
  const expected={owner:context.principalId,audience:context.audience,context:context.contextId,conversationId};
  const after=decodeCursor(cursor,expected);
  const page=await context.data.list('conversation_attachment',ordered(limit,
    {...scope(context),conversation_id:String(conversationId)},after,'by-conversation','asc')) as Page;
  return {output:{items:page.items.map(attachmentView),nextCursor:encodeCursor(page.nextAfter,expected)}};
}
