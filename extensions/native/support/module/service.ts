import {OperationError,type OperationContext,type JsonValue} from '@creezio/sdk/operations/handler';

type Row=Record<string,JsonValue>;
type Input=Record<string,unknown>;
const arg=(v:JsonValue):Input=>v&&typeof v==='object'&&!Array.isArray(v)?v as Input:{};
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?
  v as Record<string,unknown>:null;
const fail=(code:'invalid_input'|'not_found'|'conflict'):never=>{throw new OperationError(code);};
const idOk=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const textOk=(v:unknown,max:number,required=false):v is string=>typeof v==='string'&&v.length<=max
  &&v.isWellFormed()&&(!required||v.trim().length>0);
const now=()=>new Date().toISOString();
const key=(c:OperationContext,id:string)=>({id});
const own=(c:OperationContext,row:Row)=>c.audience==='admin'||row.requester_id===c.principalId;
const viewTicket=(c:OperationContext,row:Row)=>({id:row.id,requesterId:row.requester_id,subject:row.subject,
  status:row.status,assignedTo:c.audience==='admin'?row.assigned_to:null,
  contactId:row.contact_id??null,messageBoxId:row.message_box_id??null,messageId:row.message_id??null,
  createdAt:row.created_at,updatedAt:row.updated_at,lastMessageAt:row.last_message_at,
  lastPreview:row.last_preview,messageCount:row.message_count,revision:row.revision});
const viewMessage=(c:OperationContext,row:Row)=>({id:row.id,ticketId:row.ticket_id,origin:row.origin,
  authorId:c.audience==='app'&&row.origin==='support'?'support':row.author_id,
  body:row.body,createdAt:row.created_at});
async function ticket(c:OperationContext,id:unknown){
  if(!idOk(id))return fail('invalid_input');
  const row=await c.data.get('ticket',{key:key(c,id)}) as Row|null;
  if(!row||!own(c,row))return fail('not_found');
  return row;
}
const cursor=(value:unknown,c:OperationContext,kind:string,filter:Record<string,unknown>):Row|null=>{
  if(value===undefined)return null;
  if(typeof value!=='string'||value.length>2048)return fail('invalid_input');
  try{const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
    atob(value.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0))));
    if(!raw||typeof raw!=='object'||raw.v!==1||raw.context!==c.contextId||raw.audience!==c.audience
      ||raw.principal!==c.principalId||raw.kind!==kind||JSON.stringify(raw.filter)!==JSON.stringify(filter)
      ||!raw.after||typeof raw.after!=='object'||Array.isArray(raw.after))fail('invalid_input');
    return raw.after as Row;
  }catch{return fail('invalid_input');}
};
const next=(after:Row|null,c:OperationContext,kind:string,filter:Record<string,unknown>):string|null=>{
  if(!after)return null;
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({v:1,context:c.contextId,
    audience:c.audience,principal:c.principalId,kind,filter,after})))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
};
export async function ticketCreate(value:JsonValue,c:OperationContext){
  const a=arg(value);
  if(!textOk(a.subject,240,true)||a.body!==undefined&&!textOk(a.body,4000))fail('invalid_input');
  const time=now(),body=String(a.body??'').trim(),id=crypto.randomUUID();
  const row:Row={id,requester_id:c.principalId,subject:(a.subject as string).trim(),status:'ouvert',
    assigned_to:null,contact_id:null,message_box_id:null,message_id:null,
    created_at:time,updated_at:time,last_message_at:body?time:null,
    last_preview:body?body.slice(0,240).toWellFormed():null,message_count:body?1:0,revision:1};
  const plans=[c.data.planCreate('ticket',{values:row})];
  if(body)plans.push(c.data.planCreate('message',{values:{ticket_id:id,id:crypto.randomUUID(),
    created_at:time,origin:'client',author_id:c.principalId,body}}));
  return {output:{item:viewTicket(c,row)},plans};
}
export async function ticketList(value:JsonValue,c:OperationContext){
  const a=arg(value),limit=Number(a.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>25||a.query!==undefined&&!textOk(a.query,120,true)
    ||a.status!==undefined&&!['ouvert','repondu','resolu','ferme'].includes(String(a.status)))fail('invalid_input');
  const query=String(a.query??'').trim().toLocaleLowerCase(),status=a.status??null;
  const filter={query,status},where:Row={...(c.audience==='app'?{requester_id:c.principalId}:{}),
    ...(status?{status:status as string}:{})};
  let after=cursor(a.cursor,c,'ticket',filter);
  const items:ReturnType<typeof viewTicket>[]=[];
  for(let read=0;read<10&&items.length<limit;read++){
    const part=await c.data.list('ticket',{limit:50,where,after,order:{indexId:'recent',direction:'desc'}});
    let inspected:Row|null=null;
    for(const row of part.items as Row[]){inspected=row;
      if(!query||`${row.subject} ${row.last_preview??''}`.toLocaleLowerCase().includes(query))items.push(viewTicket(c,row));
      if(items.length===limit)break;}
    after=items.length===limit&&inspected?
      {context_id:inspected.context_id,updated_at:inspected.updated_at,id:inspected.id}:
      part.nextAfter as Row|null;
    if(!after)break;
  }
  return {output:{items,nextCursor:next(after,c,'ticket',filter)}};
}
export async function ticketRead(value:JsonValue,c:OperationContext){
  return {output:{item:viewTicket(c,await ticket(c,arg(value).id))}};
}
async function patchTicket(value:JsonValue,c:OperationContext,mode:'status'|'resolve'|'claim'){
  const a=arg(value),row=await ticket(c,a.id),revision=Number(a.revision);
  if(!Number.isSafeInteger(revision)||revision!==row.revision)fail('conflict');
  const changes:Row={updated_at:now()};
  if(mode==='status'){
    if(!['ouvert','repondu','resolu','ferme'].includes(String(a.status)))fail('invalid_input');
    changes.status=a.status as string;
  }else if(mode==='resolve')changes.status='resolu';
  else{
    if(typeof a.claim!=='boolean')fail('invalid_input');
    if(row.assigned_to!==null&&row.assigned_to!==c.principalId)fail('conflict');
    changes.assigned_to=a.claim?c.principalId:null;
  }
  return {output:{item:viewTicket(c,{...row,...changes,revision:revision+1})},
    plans:[c.data.planPatch('ticket',{key:key(c,String(a.id)),compare:{field:'revision',expected:revision},values:changes})]};
}
export const ticketStatus=(v:JsonValue,c:OperationContext)=>patchTicket(v,c,'status');
export const ticketResolve=(v:JsonValue,c:OperationContext)=>patchTicket(v,c,'resolve');
export const ticketClaim=(v:JsonValue,c:OperationContext)=>patchTicket(v,c,'claim');
export async function messageList(value:JsonValue,c:OperationContext){
  const a=arg(value),t=await ticket(c,a.ticketId),limit=Number(a.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail('invalid_input');
  const filter={ticketId:t.id};
  let after=cursor(a.cursor,c,'message',filter),bytes=64,stopped=false;
  const items:ReturnType<typeof viewMessage>[]=[];
  // Five rows plus the data port's look-ahead row fit its 256 KiB bound
  // even if every character of each 4,000-character body is JSON escaped.
  for(let read=0;read<10&&items.length<limit&&!stopped;read++){
    const previousAfter=after;
    const part=await c.data.list('message',{limit:5,where:{ticket_id:t.id},after,
      order:{indexId:'by-ticket',direction:'desc'}});
    let lastIncluded:Row|null=null,partial=false;
    const rows=part.items as Row[];
    for(let index=0;index<rows.length;index++){
      const row=rows[index];
      const item=viewMessage(c,row);
      const size=new TextEncoder().encode(JSON.stringify(item)).length+2;
      if(items.length&&bytes+size>180_000){stopped=true;partial=true;break;}
      items.push(item);bytes+=size;lastIncluded=row;
      if(items.length===limit){partial=index<rows.length-1;break;}
    }
    after=partial?
      (lastIncluded?{ticket_id:lastIncluded.ticket_id,created_at:lastIncluded.created_at,id:lastIncluded.id}:previousAfter):
      part.nextAfter as Row|null;
    if(!after)break;
  }
  return {output:{items,nextCursor:next(after,c,'message',filter)}};
}
async function addMessage(value:JsonValue,c:OperationContext,origin:'client'|'support'){
  const a=arg(value),row=await ticket(c,a.ticketId),revision=Number(a.revision);
  if(!Number.isSafeInteger(revision)||revision!==row.revision)fail('conflict');
  if(!textOk(a.body,4000,true))fail('invalid_input');
  const time=now(),body=(a.body as string).trim();
  const message:Row={ticket_id:row.id,id:crypto.randomUUID(),created_at:time,origin,
    author_id:c.principalId,body};
  const changes:Row={status:origin==='support'?'repondu':'ouvert',updated_at:time,
    last_message_at:time,last_preview:body.slice(0,240).toWellFormed(),message_count:Number(row.message_count)+1};
  return {output:{item:viewMessage(c,message),ticket:viewTicket(c,{...row,...changes,revision:revision+1})},
    plans:[c.data.planCreate('message',{values:message}),
      c.data.planPatch('ticket',{key:key(c,String(row.id)),compare:{field:'revision',expected:revision},values:changes})]};
}
export const messageCustomer=(v:JsonValue,c:OperationContext)=>addMessage(v,c,'client');
export const messageReply=(v:JsonValue,c:OperationContext)=>addMessage(v,c,'support');
export const transportStatus=()=>({output:{state:'unavailable',externalEmail:false}});

/** Optional public lookups remain read-only and recheck access to the selected ticket first. */
export async function referenceContactSearch(value:JsonValue,c:OperationContext){
  const a=arg(value);await ticket(c,a.ticketId);
  if(!textOk(a.query,120,true)||a.cursor!==undefined&&!textOk(a.cursor,2048,true))fail('invalid_input');
  const output=await c.operations?.query({moduleId:'creezio.crm',operationId:'contact.search',
    input:{limit:10,query:(a.query as string).trim(),...(a.cursor?{cursor:a.cursor as string}:{})}});
  const body=record(output);
  if(!body||!Array.isArray(body.items))
    throw new OperationError('unavailable');
  const items=body.items.map((value:unknown)=>{
    const item=record(value);
    if(!item||!idOk(item.id)||!textOk(item.name,240,true)||
      !(item.email===null||textOk(item.email,320))||
      !(item.companyId===null||idOk(item.companyId)))throw new OperationError('invalid_output');
    return {id:item.id,name:item.name,email:item.email,companyId:item.companyId};
  });
  if(items.length>10||!(body.nextCursor===null||textOk(body.nextCursor,2048,true)))
    throw new OperationError('invalid_output');
  return {output:{items,nextCursor:body.nextCursor}};
}
export async function referenceContactRead(value:JsonValue,c:OperationContext){
  const a=arg(value);await ticket(c,a.ticketId);
  if(!idOk(a.contactId))fail('invalid_input');
  const output=await c.operations?.query({moduleId:'creezio.crm',operationId:'contact.read',input:{id:a.contactId as string}});
  const item=record(record(output)?.item);
  if(!item||item.id!==a.contactId||
    !textOk(item.name,240,true)||!(item.email===null||textOk(item.email,320))||
    !(item.companyId===null||idOk(item.companyId)))throw new OperationError('invalid_output');
  return {output:{item:{id:item.id,name:item.name,email:item.email,companyId:item.companyId}}};
}
export async function referenceMessageRead(value:JsonValue,c:OperationContext){
  const a=arg(value);await ticket(c,a.ticketId);
  if(!idOk(a.boxId)||!idOk(a.messageId))fail('invalid_input');
  const output=await c.operations?.query({moduleId:'creezio.messaging',operationId:'message.read',
    input:{boxId:a.boxId as string,messageId:a.messageId as string}});
  const message=record(record(output)?.message);
  if(!message||message.id!==a.messageId||
    message.boxId!==a.boxId||!textOk(message.subject,240)||!textOk(message.from,320)||
    !textOk(message.text,16000))throw new OperationError('invalid_output');
  return {output:{message:{id:message.id,boxId:message.boxId,subject:message.subject,
    from:message.from,text:message.text}}};
}

async function linkReference(value:JsonValue,c:OperationContext,kind:'contact'|'message',remove:boolean){
  const a=arg(value),row=await ticket(c,a.ticketId),revision=Number(a.revision);
  if(!Number.isSafeInteger(revision)||revision!==row.revision)fail('conflict');
  let changes:Row;
  if(kind==='contact'){
    if(!remove){
      if(!idOk(a.contactId))fail('invalid_input');
      await referenceContactRead({ticketId:row.id,contactId:a.contactId} as JsonValue,c);
    }
    changes={contact_id:remove?null:a.contactId as string,updated_at:now()};
  }else{
    if(!remove){
      if(!idOk(a.boxId)||!idOk(a.messageId))fail('invalid_input');
      await referenceMessageRead({ticketId:row.id,boxId:a.boxId,messageId:a.messageId} as JsonValue,c);
    }
    changes={message_box_id:remove?null:a.boxId as string,
      message_id:remove?null:a.messageId as string,updated_at:now()};
  }
  return {output:{item:viewTicket(c,{...row,...changes,revision:revision+1})},
    plans:[c.data.planPatch('ticket',{key:key(c,String(row.id)),
      compare:{field:'revision',expected:revision},values:changes})]};
}
export const referenceContactLink=(v:JsonValue,c:OperationContext)=>linkReference(v,c,'contact',false);
export const referenceContactUnlink=(v:JsonValue,c:OperationContext)=>linkReference(v,c,'contact',true);
export const referenceMessageLink=(v:JsonValue,c:OperationContext)=>linkReference(v,c,'message',false);
export const referenceMessageUnlink=(v:JsonValue,c:OperationContext)=>linkReference(v,c,'message',true);
