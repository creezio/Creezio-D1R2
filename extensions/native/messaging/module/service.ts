import {OperationError} from '@creezio/sdk/operations/error';
import type {OperationContext,JsonValue} from '../../../../sdk/operations/handler.ts';

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
  subject:r.subject,text:r.text_body,html:r.html_body,updatedAt:r.updated_at,revision:r.revision});
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
    subject:'',text_body:'',html_body:'',created_at:at,updated_at:at,revision:1};
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
    subject:a.subject,text_body:a.text,html_body:safeHtml(a.html),updated_at:now()};
  const updated={...old,...changes,revision:rev+1};
  return {output:{draft:viewDraft(updated)},plans:[c.data.planGet('box',{key:boxKey(c,a.boxId),required:true}),
    c.data.planPatch('draft',{key:draftKey(c,a.boxId,a.draftId),compare:{field:'revision',expected:rev},values:changes})]};
}
export async function draftDelete(value:JsonValue,c:OperationContext){
  const a=input(value),old=await draft(c,a.boxId,a.draftId),rev=Number(a.revision);
  if(!Number.isSafeInteger(rev)||rev!==old.revision)fail('conflict');
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
export const transportStatus=()=>({output:{state:'unavailable',send:false,receive:false}});
/** No transport capability exists on OperationContext. Never claim a send or queue one. */
export const messageSend=()=>fail('unavailable');
