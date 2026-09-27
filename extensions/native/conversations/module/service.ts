import {OperationError, type OperationContext, type JsonValue} from '../../../../sdk/operations/handler.ts';

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
const message = (row: Row) => ({id:row.id,conversationId:row.conversation_id,role:row.role,
  body:row.body,createdAt:row.created_at,revision:row.revision});
const turnView = (row: Row) => ({id:row.id,conversationId:row.conversation_id,state:row.state,
  providerId:row.provider_id,updatedAt:row.updated_at,lastSequence:row.last_sequence,errorCode:row.error_code});
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
    created_at:now,updated_at:now,archived_at:null,revision:1};
  const plan=context.data.planCreate('conversation',{values:row});
  return {output:{conversation:summary(row)},plans:[plan]};
}
export async function conversationRead(value: JsonValue, context: OperationContext) {
  const row=await conversation(context,input(value).conversationId);
  return {output:{conversation:summary(row),provider:'no_provider'}};
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
  return {output:{items:page.items.map(message),nextCursor:encodeCursor(page.nextAfter,expected)}};
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
  return {output:{message:message(row)},plans:[guard,created,updated]};
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
export async function eventList(value:JsonValue,context:OperationContext) {
  const args=input(value), limit=Number(args.limit), afterSequence=Number(args.afterSequence??0);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(afterSequence)||afterSequence<0)
    throw new OperationError('invalid_input');
  if(!await turn(context,args.conversationId,args.turnId))missing();
  const where={...scope(context),conversation_id:String(args.conversationId),turn_id:String(args.turnId)};
  const after=afterSequence?{...where,sequence:afterSequence}:null;
  const page=await context.data.list('event',{limit,where,after}) as Page;
  return {output:{items:page.items.map(eventView),nextSequence:page.nextAfter?.sequence??null}};
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
