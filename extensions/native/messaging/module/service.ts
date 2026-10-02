import {OperationError} from '@creezio/sdk/operations/error';
import type {OperationContext,JsonValue} from '@creezio/sdk/operations/handler';
import type {OperationFilesPort} from '@creezio/sdk/files/types';
import {projectDeliveryReceipt} from './delivery.ts';

type Row=Record<string,JsonValue>;
type Input=Record<string,any>;
type Page={items:readonly Row[];nextAfter:Row|null};
const input=(v:JsonValue):Input=>v&&typeof v==='object'&&!Array.isArray(v)?v as Input:{};
const validId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128&&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v);
const validText=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&v.isWellFormed()
  &&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const fail=(code:'invalid_input'|'not_found'|'conflict'|'unavailable'):never=>{throw new OperationError(code);};
const now=()=>new Date().toISOString();
const scope=(c:OperationContext)=>({owner_id:c.principalId});
const boxKey=(c:OperationContext,id:string)=>({...scope(c),id});
const draftKey=(c:OperationContext,boxId:string,id:string)=>({...scope(c),box_id:boxId,id});
const messageKey=(c:OperationContext,boxId:string,id:string)=>({...scope(c),box_id:boxId,id});
const pageLimit=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=1&&Number(v)<=50?Number(v):fail('invalid_input');
const cursor=(v:any,expected:Record<string,unknown>):Row|null=>{
  if(v===undefined)return null;
  if(typeof v!=='string'||v.length>2048)fail('invalid_input');
  try{
    const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
      atob(v.replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0))));
    if(!decoded||typeof decoded!=='object'||Array.isArray(decoded)||decoded.v!==1
      ||Object.entries(expected).some(([name,part])=>decoded[name]!==part)
      ||decoded.after!==null&&(typeof decoded.after!=='object'||Array.isArray(decoded.after)))throw 0;
    return decoded.after as Row|null;
  }catch{return fail('invalid_input');}
};
const nextCursor=(after:Row|null,expected:Record<string,unknown>):string|null=>{
  if(!after)return null;
  const bytes=new TextEncoder().encode(JSON.stringify({v:1,...expected,after}));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
};
const expected=(c:OperationContext,parts:Record<string,unknown>={})=>({context:c.contextId,owner:c.principalId,audience:c.audience,...parts});
const viewBox=(r:Row)=>({id:r.id,name:r.name,address:r.address,kind:r.kind,revision:r.revision});
const viewDraft=(r:Row)=>({id:r.id,boxId:r.box_id,to:r.to_addr,cc:r.cc_addr,bcc:r.bcc_addr,
  subject:r.subject,text:r.text_body,html:r.html_body,updatedAt:r.updated_at,revision:r.revision,
  sendIntentId:typeof r.send_intent_id==='string'?r.send_intent_id:null});
const viewMessage=(r:Row)=>({id:r.id,boxId:r.box_id,direction:r.direction,from:r.from_addr,
  to:r.to_addr,cc:r.cc_addr,subject:r.subject,text:r.text_body,html:r.html_body,state:r.state,
  folder:r.folder,read:r.read_at!==null,threadId:r.thread_id,replyTo:r.reply_to,inReplyTo:r.in_reply_to,
  receivedAt:r.received_at,sentAt:r.sent_at,revision:r.revision});
const viewAttachment=(r:Row)=>({fileId:r.file_id,filename:r.filename,contentType:r.content_type,
  byteSize:r.byte_size,reference:{fileId:r.file_id,intentId:r.intent_id,generation:r.generation,digest:r.digest}});
async function box(c:OperationContext,id:unknown):Promise<Row>{
  if(!validId(id))fail('invalid_input');
  const row=await c.data.get('box',{key:boxKey(c,String(id))}) as Row|null;
  if(!row)throw new OperationError('not_found');
  return row;
}
async function draft(c:OperationContext,boxId:unknown,id:unknown):Promise<Row>{
  await box(c,boxId);
  if(!validId(id))fail('invalid_input');
  const row=await c.data.get('draft',{key:draftKey(c,String(boxId),String(id))}) as Row|null;
  if(!row)throw new OperationError('not_found');
  return row;
}
const address=/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/u;
function recipients(v:any):string{
  if(!validText(v,2048))fail('invalid_input');
  if(!v.trim())return '';
  const parts=v.split(',').map((x:string)=>x.trim());
  if(parts.length>20||parts.some((x:string)=>!address.test(x)))fail('invalid_input');
  return parts.join(', ');
}
/** Encode all content first, then retain a narrow set of attribute-free formatting tags. */
export function safeHtml(v:string):string{
  const html=v.replace(/&(?!(?:amp|lt|gt|quot|#39);)/g,'&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;')
    .replace(/&lt;(\/?)(p|br|strong|em|b|i|ul|ol|li)&gt;/gi,(_full,slash,tag)=>`<${slash}${tag.toLowerCase()}>`)
    .replace(/&lt;a href=&quot;([^<>]*?)&quot;(?: target=&quot;_blank&quot; rel=&quot;noopener noreferrer&quot;)?&gt;/gi,
      (full,href)=>{
        try{
          const url=new URL(href.replaceAll('&amp;','&'));
          return (url.protocol==='http:'||url.protocol==='https:')&&!url.username&&!url.password
            ?`<a href="${href}" target="_blank" rel="noopener noreferrer">`:full;
        }catch{return full;}
      })
    .replaceAll('&lt;/a&gt;','</a>');
  if(html.length>32000)fail('invalid_input');
  return html;
}
async function list(c:OperationContext,model:string,args:Input,where:Row,indexId:string,map:(r:Row)=>unknown){
  const limit=pageLimit(args.limit),marker=expected(c,where),after=cursor(args.cursor,marker);
  const page=await c.data.list(model,{limit,where,after,order:{indexId,direction:'desc'}}) as Page;
  return {output:{items:page.items.map(map),nextCursor:nextCursor(page.nextAfter,marker)}};
}

// Preview operations deliberately expose bounded excerpts. Full text and HTML are
// fetched only by an explicit read in the widget or workspace.
const excerpt=(value:JsonValue)=>{const chars=Array.from(String(value??''));
  return {value:chars.slice(0,48).join(''),hasMore:chars.length>48};};
const boundedPreview=(items:unknown[],after:Row|null,marker:Record<string,unknown>)=>{
  const output={items,nextCursor:nextCursor(after,marker)};
  // turn-bridge accepts at most 8192 bytes including its output wrapper.
  if(new TextEncoder().encode(JSON.stringify({output})).length>7600)fail('unavailable');
  return {output};
};
export async function boxPreviewList(value:JsonValue,c:OperationContext){
  const a=input(value),limit=pageLimit(a.limit);
  if(limit>5)fail('invalid_input');
  const where=scope(c),marker=expected(c,where),after=cursor(a.cursor,marker);
  const page=await c.data.list('box',{limit,where,after,
    fields:['owner_id','updated_at','id','name','address','revision'],
    order:{indexId:'recent-boxes',direction:'desc'}}) as Page;
  return boundedPreview(page.items.map(row=>({id:row.id,
    nameExcerpt:excerpt(row.name).value,nameHasMore:excerpt(row.name).hasMore,
    addressExcerpt:excerpt(row.address).value,addressHasMore:excerpt(row.address).hasMore,
    revision:row.revision})),page.nextAfter,marker);
}
export async function messagePreviewList(value:JsonValue,c:OperationContext){
  const a=input(value),b=await box(c,a.boxId),limit=pageLimit(a.limit);
  if(limit>5||a.folder!==undefined&&!['inbox','sent','outbox','archive','trash'].includes(String(a.folder))
    ||a.unread!==undefined&&typeof a.unread!=='boolean'
    ||a.query!==undefined&&(!validText(a.query,240)||!a.query.trim())
    ||a.threadId!==undefined&&!validId(a.threadId))fail('invalid_input');
  const where:Row={...scope(c),box_id:b.id,
    ...(a.folder===undefined?{}:{folder:a.folder as string}),
    ...(a.threadId===undefined?{}:{thread_id:a.threadId as string}),
    ...(a.unread===true?{read_at:null}:{})};
  const marker=expected(c,{...where,folder:a.folder??null,unread:a.unread??null,
    query:a.query??null,threadId:a.threadId??null});
  const after=cursor(a.cursor,marker);
  const page=await c.data.list('message',{limit,where,after,
    fields:['owner_id','box_id','created_at','id','direction','from_addr','to_addr',
      'subject','text_body','state','folder','read_at','thread_id','received_at','sent_at','revision'],
    order:{indexId:'recent-messages',direction:'desc'}}) as Page;
  const query=String(a.query??'').toLocaleLowerCase();
  const items=page.items.filter(row=>(a.unread===undefined||a.unread===(row.read_at===null))
    &&(!query||`${row.from_addr} ${row.to_addr} ${row.subject} ${row.text_body}`.toLocaleLowerCase().includes(query)))
    .map(row=>{const peer=excerpt(row.direction==='inbound'?row.from_addr:row.to_addr),
      subject=excerpt(row.subject),body=excerpt(row.text_body);
      return {id:row.id,boxId:row.box_id,direction:row.direction,
        peerExcerpt:peer.value,peerHasMore:peer.hasMore,
        subjectExcerpt:subject.value,subjectHasMore:subject.hasMore,
        bodyExcerpt:body.value,bodyHasMore:body.hasMore,
        state:row.state,folder:row.folder,read:row.read_at!==null,threadId:row.thread_id,
        receivedAt:row.received_at,sentAt:row.sent_at,revision:row.revision};});
  return boundedPreview(items,page.nextAfter,marker);
}
export async function draftPreviewList(value:JsonValue,c:OperationContext){
  const a=input(value),b=await box(c,a.boxId),limit=pageLimit(a.limit);
  if(limit>5||a.query!==undefined&&(!validText(a.query,240)||!a.query.trim()))fail('invalid_input');
  const where={...scope(c),box_id:b.id},marker=expected(c,{...where,query:a.query??null});
  const after=cursor(a.cursor,marker);
  const page=await c.data.list('draft',{limit,where,after,
    fields:['owner_id','box_id','updated_at','id','to_addr','subject','text_body','revision'],
    order:{indexId:'recent-drafts',direction:'desc'}}) as Page;
  const query=String(a.query??'').toLocaleLowerCase();
  const items=page.items.filter(row=>!query||`${row.to_addr} ${row.subject} ${row.text_body}`.toLocaleLowerCase().includes(query))
    .map(row=>{const peer=excerpt(row.to_addr),subject=excerpt(row.subject),body=excerpt(row.text_body);
      return {id:row.id,boxId:row.box_id,peerExcerpt:peer.value,peerHasMore:peer.hasMore,
        subjectExcerpt:subject.value,subjectHasMore:subject.hasMore,
        bodyExcerpt:body.value,bodyHasMore:body.hasMore,updatedAt:row.updated_at,revision:row.revision};});
  return boundedPreview(items,page.nextAfter,marker);
}

export async function boxList(value:JsonValue,c:OperationContext){
  return list(c,'box',input(value),scope(c),'recent-boxes',viewBox);
}
export async function boxCreate(value:JsonValue,c:OperationContext){
  const a=input(value);
  if(!validText(a.name,120)||!a.name.trim()||!validText(a.address,320)||a.address&&!address.test(a.address))fail('invalid_input');
  const at=now(),row={...scope(c),id:crypto.randomUUID(),name:a.name.trim(),address:a.address,kind:'local',
    created_at:at,updated_at:at,revision:1};
  return {output:{box:viewBox(row)},plans:[c.data.planCreate('box',{values:row})]};
}
export async function messageList(value:JsonValue,c:OperationContext){
  const a=input(value),b=await box(c,a.boxId);
  if(a.folder!==undefined&&!['inbox','sent','outbox','archive','trash'].includes(String(a.folder))
    ||a.unread!==undefined&&typeof a.unread!=='boolean'
    ||a.query!==undefined&&(!validText(a.query,240)||!a.query.trim())
    ||a.threadId!==undefined&&!validId(a.threadId))fail('invalid_input');
  // Exact folder/thread/unread constraints precede pagination. A busy folder must
  // not hide an older message in another folder behind unrelated pages.
  const where:Row={...scope(c),box_id:b.id,
    ...(a.folder===undefined?{}:{folder:a.folder as string}),
    ...(a.threadId===undefined?{}:{thread_id:a.threadId as string}),
    ...(a.unread===true?{read_at:null}:{})};
  const marker=expected(c,{...where,
    folder:a.folder??null,unread:a.unread??null,query:a.query??null,threadId:a.threadId??null});
  const after=cursor(a.cursor,marker),limit=Math.min(pageLimit(a.limit),1);
  const page=await c.data.list('message',{limit,where,after,order:{indexId:'recent-messages',direction:'desc'}}) as Page;
  const query=String(a.query??'').toLocaleLowerCase();
  const items=page.items.filter(row=>(a.folder===undefined||row.folder===a.folder)
    &&(a.unread===undefined||a.unread===(row.read_at===null))
    &&(a.threadId===undefined||a.threadId===row.thread_id)
    &&(!query||`${row.from_addr} ${row.to_addr} ${row.subject} ${row.text_body}`.toLocaleLowerCase().includes(query)))
    .map(viewMessage);
  return {output:{items,nextCursor:nextCursor(page.nextAfter,marker)}};
}
export async function messageRead(value:JsonValue,c:OperationContext){
  const a=input(value);await box(c,a.boxId);
  if(!validId(a.messageId))fail('invalid_input');
  const row=await c.data.get('message',{key:messageKey(c,a.boxId,a.messageId)}) as Row|null;
  if(!row)throw new OperationError('not_found');
  return {output:{message:viewMessage(row)}};
}
export async function messageDeliveryReconcile(value:JsonValue,c:OperationContext){
  const a=input(value);await box(c,a.boxId);
  if(!validId(a.messageId)||!Number.isSafeInteger(a.revision))fail('invalid_input');
  const operations=c.operations;
  if(!operations)throw new OperationError('unavailable');
  const row=await c.data.get('message',{key:messageKey(c,a.boxId,a.messageId)}) as Row|null;
  if(!row)throw new OperationError('not_found');
  if(row.revision!==a.revision)fail('conflict');
  if(row.direction!=='outbound'||typeof row.provider_message_id!=='string'
    ||!['sent','unknown','delivered','bounced','failed'].includes(String(row.state)))fail('invalid_input');
  const answer=await operations!.query({moduleId:'creezio.resend',operationId:'event.status',
    input:{emailId:row.provider_message_id}});
  if(!answer||typeof answer!=='object'||Array.isArray(answer))fail('unavailable');
  const receipt=answer as Record<string,JsonValue>;
  if(receipt.kind==='none')return {output:{message:viewMessage(row)}};
  if(receipt.kind!=='delivered'&&receipt.kind!=='bounced'&&receipt.kind!=='failed')fail('unavailable');
  const kind=receipt.kind as 'delivered'|'bounced'|'failed';
  const providerMessageId=String(row.provider_message_id);
  if(kind==='failed'){
    // A signed provider failure follows a known accepted message. A local HTTP
    // rejection remains failed/outbox with no provider id and never reaches here.
    if(row.state==='failed'||row.state==='delivered'||row.state==='bounced')
      return {output:{message:viewMessage(row)}};
    const plan=c.data.planPatch('message',{key:messageKey(c,a.boxId,a.messageId),
      compare:{field:'revision',expected:Number(row.revision)},values:{state:'failed',folder:'sent'}});
    return {output:{message:viewMessage({...row,state:'failed',folder:'sent',
      revision:Number(row.revision)+1})},plans:[plan]};
  }
  if(row.state==='failed')return {output:{message:viewMessage(row)}};
  const plans=await projectDeliveryReceipt({boxId:a.boxId,intentId:a.messageId,
    receipt:{kind,providerMessageId}},
  {principalId:c.principalId,data:c.data,receivedAt:now()});
  const next=plans.length?{...row,state:kind,folder:'sent',revision:Number(row.revision)+1}:row;
  return {output:{message:viewMessage(next)},plans};
}
const inboundEmailId=(v:unknown):v is string=>typeof v==='string'
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);
const inboundChildId=(v:unknown):v is string=>typeof v==='string'
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);
const inboundMimes=new Set(['text/plain','application/pdf','image/png','image/jpeg']);
const inboundLimit=10*1024*1024;
type InboundChild={id:string;filename:string;contentType:string;byteSize:number};
const inboundKey=(c:OperationContext,boxId:string,id:string)=>({...scope(c),box_id:boxId,id});
const inboundReceiptKey=(c:OperationContext,boxId:string,id:string,fileId:string)=>
  ({...scope(c),box_id:boxId,snapshot_id:id,file_id:fileId});
const inboundId=async(emailId:string)=>`in-${await digest([emailId])}`;
const inboundView=(row:Row,stagedChildIds:string[],imported:boolean)=>({
  id:row.id,boxId:row.box_id,emailId:row.email_id,from:row.from_addr,to:row.to_addr,
  subject:row.subject,receivedAt:row.received_at,
  attachments:row.attachments,stagedChildIds,imported});
async function inboundSnapshot(c:OperationContext,boxId:string,emailId:string):Promise<Row|null>{
  return await c.data.get('inbound_snapshot',{key:inboundKey(c,boxId,await inboundId(emailId))}) as Row|null;
}
async function inboundReceipts(c:OperationContext,boxId:string,id:string):Promise<Row[]>{
  const page=await c.data.list('inbound_stage_receipt',{limit:50,
    where:{...scope(c),box_id:boxId,snapshot_id:id},
    order:{indexId:'by-snapshot',direction:'asc'}}) as Page;
  if(page.nextAfter)fail('conflict');
  return [...page.items];
}
async function inboundState(c:OperationContext,selected:Row,row:Row){
  if(row.deleted_at!==null&&row.deleted_at!==undefined)fail('not_found');
  if(row.box_address!==selected.address||row.box_revision!==selected.revision)fail('conflict');
  const receipts=await inboundReceipts(c,String(selected.id),String(row.id));
  const children=Array.isArray(row.attachments)?row.attachments as InboundChild[]:fail('conflict');
  const ids=new Set(children.map(child=>child.id));
  if(children.length>50||ids.size!==children.length
    ||receipts.some(receipt=>!ids.has(String(receipt.child_id))))fail('conflict');
  const imported=await c.data.get('message',{key:messageKey(c,String(selected.id),String(row.id))}) as Row|null;
  if(imported&&(imported.direction!=='inbound'||imported.provider_message_id!==row.email_id))
    fail('conflict');
  return {receipts,children,imported,output:inboundView(row,
    receipts.map(receipt=>String(receipt.child_id)),!!imported)};
}
/** A signed received event is read only after the operator selects an authorized box. */
export async function messageInboundPrepare(value:JsonValue,c:OperationContext){
  const a=input(value),selected=await box(c,a.boxId);
  if(!inboundEmailId(a.emailId)||!validText(selected.address,320)
    ||!address.test(String(selected.address)))fail('invalid_input');
  const previous=await inboundSnapshot(c,String(selected.id),a.emailId);
  if(previous){
    const state=await inboundState(c,selected,previous);
    return {output:{snapshot:state.output}};
  }
  const operations=c.operations;
  if(!operations)throw new OperationError('unavailable');
  const answer=await operations.query({moduleId:'creezio.resend',operationId:'received.read',
    input:{emailId:a.emailId}});
  if(!answer||typeof answer!=='object'||Array.isArray(answer))fail('unavailable');
  const mail=answer as Record<string,unknown>,children=mail.attachments;
  if(mail.emailId!==a.emailId||!Array.isArray(mail.to)||mail.to.length<1
    ||mail.to.some(item=>typeof item!=='string'||!address.test(item))
    ||!mail.to.includes(selected.address)||!validText(mail.from,320)
    ||!validText(mail.subject,240)||!validText(mail.text,16000)||!validText(mail.html,32000)
    ||typeof mail.receivedAt!=='string'||!Number.isFinite(Date.parse(mail.receivedAt))
    ||!validId(mail.connectionId)||!Number.isSafeInteger(mail.configRevision)
    ||Number(mail.configRevision)<1||!Array.isArray(children)||children.length>50
    ||mail.attachmentCount!==children.length)fail('unavailable');
  const to=(mail.to as string[]).join(', ');
  if(to.length>2048)fail('unavailable');
  let total=0;
  const exact:InboundChild[]=(children as unknown[]).map((value:unknown)=>{
    if(!value||typeof value!=='object'||Array.isArray(value))fail('unavailable');
    const child=value as Record<string,unknown>;
    if(!inboundChildId(child.id)||!validText(child.filename,255)||!child.filename
      ||typeof child.contentType!=='string'||!inboundMimes.has(child.contentType)
      ||!Number.isSafeInteger(child.byteSize)||Number(child.byteSize)<0
      ||(total+=Number(child.byteSize))>inboundLimit)fail('unavailable');
    return {id:child.id as string,filename:child.filename as string,
      contentType:child.contentType as string,
      byteSize:Number(child.byteSize)};
  }).sort((left:InboundChild,right:InboundChild)=>left.id.localeCompare(right.id));
  if(new Set(exact.map(child=>child.id)).size!==exact.length)fail('unavailable');
  const id=await inboundId(a.emailId),receivedAt=new Date(mail.receivedAt as string).toISOString();
  const html=safeHtml(mail.html as string);
  const snapshotDigest=await digest([id,selected.id,selected.address,selected.revision,
    a.emailId,mail.connectionId,mail.configRevision,mail.from,to,mail.subject,mail.text,html,
    receivedAt,exact]);
  const row:Row={...scope(c),box_id:selected.id,id,email_id:a.emailId,
    box_address:selected.address,box_revision:selected.revision,connection_id:mail.connectionId as string,
    config_revision:mail.configRevision as number,from_addr:mail.from as string,to_addr:to,
    subject:mail.subject as string,text_body:mail.text as string,html_body:html,received_at:receivedAt,attachments:exact,
    snapshot_digest:snapshotDigest,deleted_at:null,created_at:now()};
  return {output:{snapshot:inboundView(row,[],false)},plans:[
    c.data.planGet('box',{key:boxKey(c,String(selected.id)),
      where:{address:selected.address,revision:selected.revision},required:true}),
    c.data.planCreate('inbound_snapshot',{values:row})]};
}
export async function messageInboundStatus(value:JsonValue,c:OperationContext){
  const a=input(value),selected=await box(c,a.boxId);
  if(!inboundEmailId(a.emailId))fail('invalid_input');
  const row=await inboundSnapshot(c,String(selected.id),a.emailId)??fail('not_found');
  return {output:{snapshot:(await inboundState(c,selected,row)).output}};
}
export async function messageInboundAttachmentStage(value:JsonValue,c:OperationContext){
  const a=input(value),selected=await box(c,a.boxId);
  if(!inboundEmailId(a.emailId)||!inboundChildId(a.childId))fail('invalid_input');
  const row=await inboundSnapshot(c,String(selected.id),a.emailId)??fail('not_found');
  const state=await inboundState(c,selected,row);
  if(state.imported)fail('conflict');
  const child=state.children.find(item=>item.id===a.childId)??fail('not_found');
  const old=state.receipts.find(item=>item.child_id===child.id);
  if(old)return {output:{childId:child.id,fileId:old.file_id,staged:true}};
  const files=(c.files as OperationFilesPort|undefined)??fail('unavailable');
  if(!files.stageRemote)fail('unavailable');
  const generation=await digest([child.id]);
  const intentId=`inbound-${await digest([c.principalId,selected.id,row.id,
    row.connection_id,row.config_revision])}`;
  const staged=await files.stageRemote('attachments',{remoteId:'email.received.attachment',
    parentId:a.emailId,childId:child.id,expected:{filename:child.filename,
      contentType:child.contentType,byteSize:child.byteSize},
    sourceProof:{connectionId:String(row.connection_id),configRevision:Number(row.config_revision)},
    intentId,generation});
  if(staged.file.filename!==child.filename||staged.file.contentType!==child.contentType
    ||staged.file.byteSize!==child.byteSize)fail('unavailable');
  const receipt:Row={...scope(c),box_id:selected.id,snapshot_id:row.id,child_id:child.id,
    file_id:staged.ref.fileId,filename:child.filename,content_type:child.contentType,
    byte_size:child.byteSize,digest:staged.ref.digest,intent_id:staged.ref.intentId,
    generation:staged.ref.generation,created_at:now()};
  return {output:{childId:child.id,fileId:staged.ref.fileId,staged:true},plans:[
    c.data.planGet('box',{key:boxKey(c,String(selected.id)),
      where:{address:row.box_address,revision:row.box_revision},required:true}),
    c.data.planGet('inbound_snapshot',{key:inboundKey(c,String(selected.id),String(row.id)),
      where:{snapshot_digest:row.snapshot_digest,deleted_at:null},required:true}),
    c.data.planCreate('inbound_stage_receipt',{values:receipt})]};
}
/** No provider read is allowed here: the immutable snapshot and all staged refs commit together. */
export async function messageInboundImport(value:JsonValue,c:OperationContext){
  const a=input(value),selected=await box(c,a.boxId);
  if(!inboundEmailId(a.emailId))fail('invalid_input');
  const row=await inboundSnapshot(c,String(selected.id),a.emailId)??fail('not_found');
  const state=await inboundState(c,selected,row);
  if(state.imported)return {output:{message:viewMessage(state.imported)}};
  if(state.receipts.length!==state.children.length)fail('conflict');
  const receiptById=new Map(state.receipts.map(receipt=>[String(receipt.child_id),receipt]));
  const attachments=state.children.map(child=>{
    const receipt=receiptById.get(child.id)??fail('conflict');
    if(receipt.filename!==child.filename||receipt.content_type!==child.contentType
      ||receipt.byte_size!==child.byteSize||!validId(receipt.file_id)
      ||typeof receipt.digest!=='string'||!/^[0-9a-f]{64}$/u.test(receipt.digest)
      ||!validId(receipt.intent_id)||!validId(receipt.generation))fail('conflict');
    return {fileId:String(receipt.file_id),intentId:String(receipt.intent_id),
      generation:String(receipt.generation),digest:String(receipt.digest),
      filename:child.filename,contentType:child.contentType,byteSize:child.byteSize};
  });
  const files=(c.files as OperationFilesPort|undefined)??fail('unavailable');
  if(!files.prepareBatchPublication)fail('unavailable');
  await files.prepareBatchPublication('attachments',{remoteId:'email.received.attachment',
    sourceProof:{connectionId:String(row.connection_id),configRevision:Number(row.config_revision)},
    sourceModel:'inbound_stage_receipt',sourceScope:{box_id:String(selected.id),snapshot_id:String(row.id)},
    destinationModel:'message_attachment',
    destinationScope:{box_id:String(selected.id),message_id:String(row.id)},attachments});
  const at=now(),message:Row={...scope(c),box_id:selected.id,id:row.id,direction:'inbound',
    from_addr:row.from_addr,to_addr:row.to_addr,cc_addr:'',subject:row.subject,
    text_body:row.text_body,html_body:row.html_body,state:'received',folder:'inbox',read_at:null,
    thread_id:null,reply_to:null,in_reply_to:null,provider_message_id:row.email_id,
    received_at:row.received_at,sent_at:null,created_at:at,revision:1};
  return {output:{message:viewMessage(message)},plans:[
    c.data.planGet('box',{key:boxKey(c,String(selected.id)),
      where:{address:row.box_address,revision:row.box_revision},required:true}),
    c.data.planGet('inbound_snapshot',{key:inboundKey(c,String(selected.id),String(row.id)),
      where:{snapshot_digest:row.snapshot_digest,deleted_at:null},required:true}),
    c.data.planCreate('message',{values:message})]};
}
export async function messageAttachmentList(value:JsonValue,c:OperationContext){
  const a=input(value);await box(c,a.boxId);
  if(!validId(a.messageId))fail('invalid_input');
  const message=await c.data.get('message',{key:messageKey(c,a.boxId,a.messageId)});
  if(!message)fail('not_found');
  return list(c,'message_attachment',a,{...scope(c),box_id:a.boxId,message_id:a.messageId},
    'by-message',viewAttachment);
}
export async function messageUpdate(value:JsonValue,c:OperationContext){
  const a=input(value);await box(c,a.boxId);
  if(!validId(a.messageId)||a.folder===undefined&&a.read===undefined
    ||a.folder!==undefined&&!['inbox','sent','outbox','archive','trash'].includes(String(a.folder))
    ||a.read!==undefined&&typeof a.read!=='boolean')fail('invalid_input');
  const row=await c.data.get('message',{key:messageKey(c,a.boxId,a.messageId)}) as Row|null;
  if(!row)throw new OperationError('not_found');
  const rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==row.revision)fail('conflict');
  // Classification cannot turn a received item into a purported sent item.
  if(['sent','outbox'].includes(String(a.folder))&&row.direction!=='outbound'
    ||a.folder==='inbox'&&row.direction!=='inbound')
    fail('invalid_input');
  const changes:Row={};
  if(a.folder!==undefined)changes.folder=a.folder as string;
  if(a.read!==undefined)changes.read_at=a.read?now():null;
  return {output:{message:viewMessage({...row,...changes,revision:rev+1})},plans:[
    c.data.planPatch('message',{key:messageKey(c,a.boxId,a.messageId),
      compare:{field:'revision',expected:rev},values:changes})]};
}
/** One bounded step; a confirmed caller may continue with the returned revision. */
export async function messageDelete(value:JsonValue,c:OperationContext){
  const a=input(value);await box(c,a.boxId);
  if(!validId(a.messageId))fail('invalid_input');
  const key=messageKey(c,a.boxId,a.messageId);
  const row=(await c.data.get('message',{key}) as Row|null)??fail('not_found');
  const revision=Number(a.revision);
  if(!Number.isSafeInteger(revision)||revision!==row.revision)fail('conflict');
  if(row.folder!=='trash'||row.direction!=='inbound')fail('conflict');
  // Outbox receipts and their frozen payload are never discarded through this path.
  if(await c.data.get('send_snapshot',{key}))fail('conflict');
  const snapshot=(await c.data.get('inbound_snapshot',{key}) as Row|null)??fail('conflict');
  // A legacy/orphan inbound row has no provenance to tombstone and must stay intact.
  if(snapshot.deleted_at!==null&&snapshot.deleted_at!==undefined
    ||snapshot.email_id!==row.provider_message_id)fail('conflict');
  // Sixteen plans per execution: thirteen link deletes plus the row and tombstone.
  const page=await c.data.list('message_attachment',{limit:13,
    where:{...scope(c),box_id:a.boxId,message_id:a.messageId},
    order:{indexId:'by-message',direction:'asc'}}) as Page;
  const plans=page.items.map(link=>c.data.planDelete('message_attachment',{
    key:{...scope(c),box_id:a.boxId,message_id:a.messageId,file_id:link.file_id}}));
  if(page.nextAfter){
    plans.push(c.data.planPatch('message',{key,compare:{field:'revision',expected:revision},
      values:{folder:'trash'}}));
    return {output:{deleted:false,revision:revision+1,removed:page.items.length},plans};
  }
  plans.push(c.data.planDelete('message',{key,compare:{field:'revision',expected:revision}}));
  plans.push(c.data.planPatch('inbound_snapshot',{key,
    where:{deleted_at:null,snapshot_digest:snapshot.snapshot_digest},
    values:{deleted_at:now(),subject:'',text_body:'',html_body:'',attachments:[]}}));
  return {output:{deleted:true,revision:null,removed:page.items.length},plans};
}
export async function draftList(value:JsonValue,c:OperationContext){
  const a=input(value),b=await box(c,a.boxId);
  if(a.query!==undefined&&(!validText(a.query,240)||!a.query.trim()))fail('invalid_input');
  // A single full-size draft plus lookahead fits the data-port result bound.
  const where={...scope(c),box_id:b.id},marker=expected(c,{...where,query:a.query??null});
  const after=cursor(a.cursor,marker),limit=Math.min(pageLimit(a.limit),1);
  const page=await c.data.list('draft',{limit,where,after,order:{indexId:'recent-drafts',direction:'desc'}}) as Page;
  const query=String(a.query??'').toLocaleLowerCase();
  const items=page.items.filter(row=>!query||`${row.to_addr} ${row.subject} ${row.text_body}`.toLocaleLowerCase().includes(query))
    .map(viewDraft);
  return {output:{items,nextCursor:nextCursor(page.nextAfter,marker)}};
}
export async function draftCreate(value:JsonValue,c:OperationContext){
  const a=input(value),b=await box(c,a.boxId),at=now();
  const row={...scope(c),box_id:b.id,id:crypto.randomUUID(),to_addr:'',cc_addr:'',bcc_addr:'',
    subject:'',text_body:'',html_body:'',send_intent_id:null,created_at:at,updated_at:at,revision:1};
  return {output:{draft:viewDraft(row)},plans:[c.data.planGet('box',{key:boxKey(c,String(b.id)),required:true}),
    c.data.planCreate('draft',{values:row})]};
}
export async function draftRead(value:JsonValue,c:OperationContext){
  const a=input(value),row=await draft(c,a.boxId,a.draftId);
  return {output:{draft:viewDraft(row)}};
}
export async function draftSave(value:JsonValue,c:OperationContext){
  const a=input(value),old=await draft(c,a.boxId,a.draftId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  if(!validText(a.subject,240)||!validText(a.text,16000)||!validText(a.html,32000))fail('invalid_input');
  const changes={to_addr:recipients(a.to),cc_addr:recipients(a.cc),bcc_addr:recipients(a.bcc),
    subject:a.subject,text_body:a.text,html_body:safeHtml(a.html),updated_at:now(),
    send_intent_id:null as string|null};
  if(['to_addr','cc_addr','bcc_addr','subject','text_body','html_body'].every(name=>old[name]===changes[name as keyof typeof changes]))
    changes.send_intent_id=typeof old.send_intent_id==='string'?old.send_intent_id:null;
  const updated={...old,...changes,revision:rev+1};
  return {output:{draft:viewDraft(updated)},plans:[c.data.planGet('box',{key:boxKey(c,a.boxId),required:true}),
    c.data.planPatch('draft',{key:draftKey(c,a.boxId,a.draftId),compare:{field:'revision',expected:rev},values:changes})]};
}
export async function draftDelete(value:JsonValue,c:OperationContext){
  const a=input(value),old=await draft(c,a.boxId,a.draftId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  if(typeof old.send_intent_id==='string')fail('conflict');
  // A draft with private attachments cannot be deleted before explicit unlink/reconciliation.
  const refs=await c.data.list('draft_attachment',{limit:1,where:{...scope(c),box_id:a.boxId,draft_id:a.draftId}}) as Page;
  if(refs.items.length)fail('conflict');
  return {output:{deleted:true},plans:[c.data.planDelete('draft',{key:draftKey(c,a.boxId,a.draftId),
    compare:{field:'revision',expected:rev}})]};
}
export async function attachmentList(value:JsonValue,c:OperationContext){
  const a=input(value);await draft(c,a.boxId,a.draftId);
  return list(c,'draft_attachment',a,{...scope(c),box_id:a.boxId,draft_id:a.draftId},'by-draft',viewAttachment);
}
export async function attachmentLink(value:JsonValue,c:OperationContext){
  const a=input(value),old=await draft(c,a.boxId,a.draftId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  if(!a.staged||typeof a.staged!=='object'||Array.isArray(a.staged))fail('invalid_input');
  const files=c.files;
  if(!files)fail('unavailable');
  const staged=a.staged as {fileId:string;intentId:string;generation:string;digest:string};
  const prepared=await files!.preparePublication('attachments',staged),at=now();
  const row={...scope(c),box_id:a.boxId,draft_id:a.draftId,file_id:staged.fileId,
    filename:prepared.file.filename,content_type:prepared.file.contentType,byte_size:prepared.file.byteSize,
    digest:staged.digest,intent_id:staged.intentId,generation:staged.generation,created_at:at};
  const updated={...old,updated_at:at,revision:rev+1};
  return {output:{attachment:viewAttachment(row),draft:viewDraft(updated)},plans:[prepared.plan,
    c.data.planGet('draft',{key:draftKey(c,a.boxId,a.draftId),required:true}),
    c.data.planCreate('draft_attachment',{values:row}),
    c.data.planPatch('draft',{key:draftKey(c,a.boxId,a.draftId),compare:{field:'revision',expected:rev},values:{updated_at:at}})]};
}
export async function attachmentUnlink(value:JsonValue,c:OperationContext){
  const a=input(value),old=await draft(c,a.boxId,a.draftId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  if(!validId(a.fileId))fail('invalid_input');
  const key={...scope(c),box_id:a.boxId,draft_id:a.draftId,file_id:a.fileId};
  const link=await c.data.get('draft_attachment',{key}) as Row|null;
  if(!link)fail('not_found');
  const at=now();
  return {output:{draft:viewDraft({...old,updated_at:at,revision:rev+1}),removed:true},plans:[
    c.data.planDelete('draft_attachment',{key}),
    c.data.planPatch('draft',{key:draftKey(c,a.boxId,a.draftId),
      compare:{field:'revision',expected:rev},values:{updated_at:at}})]};
}
async function readiness(c:OperationContext):Promise<{state:'ready'|'missing'|'unavailable';from:string|null;configRevision:number}>{
  const unavailable={state:'unavailable' as const,from:null,configRevision:0};
  const port=c.operations;
  if(!port)return unavailable;
  let value:JsonValue;
  try{value=await port.query({moduleId:'creezio.resend',operationId:'delivery.readiness',input:{}});}
  catch(error){if(error instanceof OperationError&&['not_found','forbidden','unsupported','unavailable'].includes(error.code))
    return unavailable;
    throw error;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))fail('unavailable');
  const row=value as Record<string,unknown>;
  if(!['ready','missing','unavailable'].includes(String(row.state))
    ||!(row.from===null||validText(row.from,320))
    ||!Number.isSafeInteger(row.configRevision)||Number(row.configRevision)<0)fail('unavailable');
  return row as {state:'ready'|'missing'|'unavailable';from:string|null;configRevision:number};
}
export async function transportStatus(_value:JsonValue,c:OperationContext){
  const state=await readiness(c);
  return {output:{state:state.state,send:state.state==='ready',receive:false,from:state.from}};
}
const splitRecipients=(value:string)=>value?value.split(',').map(part=>part.trim()):[];
const MAX_SEND_ATTACHMENTS=50,MAX_SEND_ATTACHMENT_BYTES=10*1024*1024;
const frozenAttachment=(row:Row)=>({fileId:String(row.file_id),intentId:String(row.intent_id),
  generation:String(row.generation),digest:String(row.digest),filename:String(row.filename),
  contentType:String(row.content_type),byteSize:Number(row.byte_size)});
const digest=async(parts:readonly unknown[])=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(parts))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
/** Commit the immutable message, private Bcc snapshot and outbox intent in one host transaction. */
export async function messageSend(value:JsonValue,c:OperationContext){
  const a=input(value),old=await draft(c,a.boxId,a.draftId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
  if(typeof old.send_intent_id==='string')fail('conflict');
  const b=await box(c,a.boxId);
  if(!validText(b.address,320)||!address.test(String(b.address)))fail('invalid_input');
  if(c.providerAvailability?.providerId!=='resend.api.v1'||c.providerAvailability.state!=='ready')fail('unavailable');
  const ready=await readiness(c);
  if(ready.state!=='ready'||ready.from!==b.address||ready.configRevision<1)fail('unavailable');
  const refs=await c.data.list('draft_attachment',{limit:MAX_SEND_ATTACHMENTS,
    where:{...scope(c),box_id:a.boxId,draft_id:a.draftId},order:{indexId:'by-draft',direction:'asc'}}) as Page;
  if(refs.items.length>MAX_SEND_ATTACHMENTS||refs.nextAfter)fail('invalid_input');
  const attachments=refs.items.map(frozenAttachment).sort((left,right)=>left.fileId.localeCompare(right.fileId));
  if(attachments.some(item=>!Number.isSafeInteger(item.byteSize)||item.byteSize<=0||item.byteSize>MAX_SEND_ATTACHMENT_BYTES)
    ||attachments.reduce((sum,item)=>sum+item.byteSize,0)>MAX_SEND_ATTACHMENT_BYTES)fail('invalid_input');
  if(attachments.length&&!c.files)fail('unavailable');
  if(attachments.length)await c.files!.freezeLinks('attachments',{
    sourceModel:'draft_attachment',destinationModel:'message_attachment',
    sourceScope:{box_id:String(a.boxId),draft_id:String(a.draftId)},
    destinationScope:{box_id:String(a.boxId),message_id:c.executionId},attachments});
  const to=recipients(old.to_addr),cc=recipients(old.cc_addr),bcc=recipients(old.bcc_addr),
    subject=String(old.subject),text=String(old.text_body),html=safeHtml(String(old.html_body));
  if(!to||!subject.trim()||!text.trim()&&!html.trim())fail('invalid_input');
  const envelope={from:String(b.address),to:splitRecipients(to),cc:splitRecipients(cc),bcc:splitRecipients(bcc),
    subject,text,html,attachments};
  if(new TextEncoder().encode(JSON.stringify(envelope)).length>60_000)fail('invalid_input');
  const at=now(),intentId=c.executionId;
  if(!validId(intentId))fail('unavailable');
  const payloadDigest=await digest([intentId,a.boxId,a.draftId,rev,ready.configRevision,
    envelope.from,to,cc,bcc,subject,text,html,attachments]);
  const snapshot={...scope(c),box_id:a.boxId,id:intentId,draft_id:a.draftId,draft_revision:rev,
    from_addr:envelope.from,to_addr:to,cc_addr:cc,bcc_addr:bcc,subject,text_body:text,html_body:html,
    config_revision:ready.configRevision,payload_digest:payloadDigest,created_at:at};
  const message={...scope(c),box_id:a.boxId,id:intentId,direction:'outbound',from_addr:envelope.from,
    to_addr:to,cc_addr:cc,subject,text_body:text,html_body:html,state:'queued',folder:'outbox',
    read_at:null,thread_id:null,reply_to:null,in_reply_to:null,provider_message_id:null,
    received_at:null,sent_at:null,created_at:at,revision:1};
  const draftAfter={...old,send_intent_id:intentId,updated_at:at,revision:rev+1};
  return {output:{message:viewMessage(message),draft:viewDraft(draftAfter)},plans:[
    c.data.planGet('box',{key:boxKey(c,a.boxId),required:true}),
    c.data.planPatch('draft',{key:draftKey(c,a.boxId,a.draftId),compare:{field:'revision',expected:rev},
      values:{send_intent_id:intentId,updated_at:at}}),
    c.data.planCreate('message',{values:message}),c.data.planCreate('send_snapshot',{values:snapshot})],
  outbox:[{id:intentId,provider:'resend.api.v1',providerIdempotencyKey:intentId,
    payload:{kind:'mail.send.v1',boxId:a.boxId,messageId:intentId,snapshotDigest:payloadDigest,
      configRevision:ready.configRevision}}]};
}
/** Internal read for the host outbox bridge; never exposed as an API or MCP tool. */
export async function messageDeliveryPrepare(value:JsonValue,c:OperationContext){
  const a=input(value);
  if(!validId(a.intentId)||!validId(a.boxId)||typeof a.snapshotDigest!=='string'
    ||!/^[a-f0-9]{64}$/.test(a.snapshotDigest))fail('invalid_input');
  const b=await box(c,a.boxId);
  const key=messageKey(c,a.boxId,a.intentId);
  const message=await c.data.get('message',{key}),snapshot=await c.data.get('send_snapshot',{key});
  if(!message||!snapshot||message.direction!=='outbound'||message.id!==a.intentId
    ||snapshot.id!==a.intentId||snapshot.payload_digest!==a.snapshotDigest
    ||snapshot.from_addr!==b.address||message.from_addr!==snapshot.from_addr
    ||!['queued','sending','unknown'].includes(String(message.state)))fail('unavailable');
  const frozen=snapshot as Row;
  const to=recipients(frozen.to_addr),cc=recipients(frozen.cc_addr),bcc=recipients(frozen.bcc_addr);
  if(!to||!Number.isSafeInteger(frozen.config_revision)||Number(frozen.config_revision)<1)fail('unavailable');
  const rows=await c.data.list('message_attachment',{limit:MAX_SEND_ATTACHMENTS,
    where:{...scope(c),box_id:a.boxId,message_id:a.intentId},order:{indexId:'by-message',direction:'asc'}}) as Page;
  if(rows.items.length>MAX_SEND_ATTACHMENTS||rows.nextAfter)fail('unavailable');
  const attachments=rows.items.map(frozenAttachment).sort((left,right)=>left.fileId.localeCompare(right.fileId));
  if(attachments.some(item=>!Number.isSafeInteger(item.byteSize)||item.byteSize<0||item.byteSize>MAX_SEND_ATTACHMENT_BYTES)
    ||attachments.reduce((sum,item)=>sum+item.byteSize,0)>MAX_SEND_ATTACHMENT_BYTES)fail('unavailable');
  const envelope={from:String(frozen.from_addr),to:splitRecipients(to),cc:splitRecipients(cc),
    bcc:splitRecipients(bcc),subject:String(frozen.subject),text:String(frozen.text_body),
    html:safeHtml(String(frozen.html_body)),attachments};
  if(new TextEncoder().encode(JSON.stringify(envelope)).length>60_000)fail('unavailable');
  const check=await digest([a.intentId,a.boxId,frozen.draft_id,frozen.draft_revision,
    frozen.config_revision,envelope.from,to,cc,bcc,envelope.subject,envelope.text,envelope.html,attachments]);
  if(check!==a.snapshotDigest)fail('unavailable');
  return {output:{intentId:a.intentId,boxId:a.boxId,snapshotDigest:check,
    configRevision:frozen.config_revision,envelope}};
}
