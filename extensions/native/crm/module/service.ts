import {OperationError, type OperationContext, type JsonValue} from '@creezio/sdk/operations/handler';

type Row = Record<string, JsonValue>;
type Args = Record<string, unknown>;
type Entity = 'company' | 'contact' | 'prospect';
const entities: readonly Entity[] = ['company','contact','prospect'];
const stages = ['a_contacter','contacte','rdv','client','perdu'] as const;
const editable: Record<Entity, readonly string[]> = {
  company:['name','city','website','notes'],
  contact:['name','email','phone','city','notes','companyId'],
  prospect:['name','city','contactName','email','phone','website','notes','stage','position','companyId','contactId']
};
const column: Record<string,string> = {name:'name',city:'city',website:'website',notes:'notes',
  email:'email',phone:'phone',companyId:'company_id',contactId:'contact_id',
  contactName:'contact_name',stage:'stage',position:'position'};
const args = (value:JsonValue):Args => value && typeof value==='object' && !Array.isArray(value) ? value as Args : {};
const bad = ():never => {throw new OperationError('invalid_input');};
const conflict = ():never => {throw new OperationError('conflict');};
const missing = ():never => {throw new OperationError('not_found');};
const idOk = (value:unknown):value is string => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const textOk = (value:unknown,max:number,required=false):value is string => typeof value==='string'
  && value.length<=max && value.isWellFormed() && (!required || value.trim().length>0);
const key = (_context:OperationContext,id:string) => ({id});
const now = () => new Date().toISOString();
const view = (row:Row) => ({id:row.id,name:row.name,city:row.city,website:row.website,
  email:row.email,phone:row.phone,contactName:row.contact_name,notes:row.notes,
  stage:row.stage,position:row.position,companyId:row.company_id,contactId:row.contact_id,
  createdAt:row.created_at,updatedAt:row.updated_at,archivedAt:row.archived_at,revision:row.revision});
const project = (entity:Entity,row:Row) => {
  const fields=entity==='company'?['id','name','city','website','notes','createdAt','updatedAt','archivedAt','revision']:
    entity==='contact'?['id','name','email','phone','city','notes','companyId','createdAt','updatedAt','archivedAt','revision']:
    ['id','name','city','contactName','email','phone','website','notes','stage','position','companyId','contactId','createdAt','updatedAt','archivedAt','revision'];
  const source=view(row) as Record<string,JsonValue>;
  return Object.fromEntries(fields.map(field=>[field,source[field]]));
};
async function record(context:OperationContext,entity:Entity,id:unknown):Promise<Row>{
  if(!idOk(id))return bad();
  const row=await context.data.get(entity,{key:key(context,id)}) as Row|null;
  return row??missing();
}
async function liveRelation(context:OperationContext,entity:'company'|'contact',id:unknown){
  const row=await record(context,entity,id);
  if(row.archived_at!==null)conflict();
  return row;
}
function validChanges(entity:Entity,value:Args,create:boolean):Row{
  const result:Row={};
  for(const name of editable[entity]){
    if(!Object.hasOwn(value,name))continue;
    const part=value[name];
    if(name==='name'){if(!textOk(part,240,true))bad();result.name=(part as string).trim();continue;}
    if(name==='stage'){if(entity!=='prospect'||!stages.includes(part as typeof stages[number]))bad();result.stage=part as string;continue;}
    if(name==='position'){if(!Number.isSafeInteger(part)||Number(part)<0)bad();result.position=part as number;continue;}
    if(name==='companyId'||name==='contactId'){if(part!==null&&!idOk(part))bad();result[column[name]]=part as string|null;continue;}
    const max=name==='notes'?4000: name==='website'?512: name==='email'?320:240;
    if(part!==null&&!textOk(part,max))bad();
    result[column[name]]=part as string|null;
  }
  if(create&&!Object.hasOwn(result,'name'))bad();
  if(!create&&Object.keys(result).length===0)bad();
  return result;
}
async function relations(context:OperationContext,entity:Entity,changes:Row,current:Row|null){
  const guards=[];
  const bumps=[];
  const companyId=changes.company_id===undefined?current?.company_id:changes.company_id;
  const contactId=changes.contact_id===undefined?current?.contact_id:changes.contact_id;
  if(entity!=='company'&&companyId!==null&&companyId!==undefined){
    const company=await liveRelation(context,'company',companyId);
    guards.push(context.data.planGet('company',{key:key(context,String(companyId)),where:{archived_at:null},required:true}));
    bumps.push(context.data.planPatch('company',{key:key(context,String(companyId)),
      compare:{field:'revision',expected:Number(company.revision)},where:{archived_at:null},values:{updated_at:now()}}));
  }
  if(entity==='prospect'&&contactId!==null&&contactId!==undefined){
    const contact=await liveRelation(context,'contact',contactId);
    if(companyId!==null&&companyId!==undefined&&contact.company_id!==null&&contact.company_id!==companyId)conflict();
    guards.push(context.data.planGet('contact',{key:key(context,String(contactId)),where:{archived_at:null},required:true}));
    bumps.push(context.data.planPatch('contact',{key:key(context,String(contactId)),
      compare:{field:'revision',expected:Number(contact.revision)},where:{archived_at:null},values:{updated_at:now()}}));
  }
  return [...guards,...bumps];
}
function cursor(value:unknown,context:OperationContext,entity:Entity,query:string,archived:boolean):Row|null{
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||value.length>2048)return bad();
  try{
    const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
      atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));
    if(decoded.v!==1||decoded.context!==context.contextId||decoded.audience!==context.audience
      ||decoded.entity!==entity||decoded.query!==query||decoded.archived!==archived
      ||!decoded.after||typeof decoded.after!=='object')bad();
    return decoded.after as Row;
  }catch{return bad();}
}
function next(after:Row|null,context:OperationContext,entity:Entity,query:string,archived:boolean):string|null{
  if(!after)return null;
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({v:1,context:context.contextId,
    audience:context.audience,entity,query,archived,after})))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
async function page(value:JsonValue,context:OperationContext,entity:Entity,search:boolean){
  const input=args(value),limit=Number(input.limit),query=search?String(input.query??'').trim().toLocaleLowerCase():'';
  if(!Number.isSafeInteger(limit)||limit<1||limit>25||search&&(!textOk(input.query,120,true)||!query)
    ||input.archived!==undefined&&typeof input.archived!=='boolean')bad();
  const archived=input.archived===true;
  let after=cursor(input.cursor,context,entity,query,archived);
  const items:ReturnType<typeof project>[]=[];
  let outputBytes=64,stopped=false;
  // A bounded scan keeps the data port's context guard on every page; the
  // operation engine checks the credential audience and crm.use separately.
  // The cursor resumes at the last inspected row, never at a client-selected model.
  // Five rows plus the port's look-ahead row fit its 256 KiB bound even when
  // every editable string reaches its maximum and needs JSON escaping.
  for(let read=0;read<100&&items.length<limit&&!stopped;read++){
    const previousAfter=after;
    const part=await context.data.list(entity,{limit:5,after,
      order:{indexId:'recent',direction:'desc'}});
    let lastInspected:Row|null=null,partial=false;
    const rows=part.items as Row[];
    for(let index=0;index<rows.length;index++){
      const row=rows[index];
      if((row.archived_at!==null)!==archived){lastInspected=row;continue;}
      const candidate=project(entity,row);
      if(query&&!Object.values(candidate).some(item=>typeof item==='string'&&item.toLocaleLowerCase().includes(query))){
        lastInspected=row;continue;
      }
      const bytes=new TextEncoder().encode(JSON.stringify(candidate)).length+2;
      if(items.length&&outputBytes+bytes>180_000){stopped=true;partial=true;break;}
      items.push(candidate);
      outputBytes+=bytes;lastInspected=row;
      if(items.length===limit){stopped=true;partial=index<rows.length-1;break;}
    }
    after=partial?(lastInspected?
      {updated_at:lastInspected.updated_at,id:lastInspected.id}:previousAfter):part.nextAfter as Row|null;
    if(!after)break;
  }
  return {output:{items,nextCursor:next(after,context,entity,query,archived)}};
}
async function create(value:JsonValue,context:OperationContext,entity:Entity){
  const input=args(value),changes=validChanges(entity,input,true);
  const guards=await relations(context,entity,changes,null);
  const time=now(),row:Row={id:crypto.randomUUID(),...changes,
    created_at:time,updated_at:time,archived_at:null,revision:1};
  for(const field of editable[entity]){
    const storage=column[field];if(storage&&!Object.hasOwn(row,storage))row[storage]=field==='position'?0:field==='stage'?'a_contacter':null;
  }
  return {output:{item:project(entity,row)},plans:[...guards,context.data.planCreate(entity,{values:row})]};
}
async function read(value:JsonValue,context:OperationContext,entity:Entity){
  const row=await record(context,entity,args(value).id);
  if(row.archived_at!==null)missing();
  return {output:{item:project(entity,row)}};
}
async function update(value:JsonValue,context:OperationContext,entity:Entity){
  const input=args(value),row=await record(context,entity,input.id);
  if(row.archived_at!==null)conflict();
  const revision=Number(input.revision);
  if(!Number.isSafeInteger(revision)||revision!==row.revision)conflict();
  const changes=validChanges(entity,input,false);
  if(entity==='contact'&&changes.company_id!==undefined&&changes.company_id!==row.company_id){
    const dependents=await context.data.list('prospect',{limit:1,
      where:{contact_id:row.id,archived_at:null}});
    if(dependents.items.length)conflict();
    // A new prospect must bump this contact's revision in its atomic link batch.
    // The patch below compares that same revision, so one concurrent writer loses.
  }
  const guards=await relations(context,entity,changes,row);
  const patch={...changes,updated_at:now()};
  return {output:{item:project(entity,{...row,...patch,revision:revision+1})},plans:[...guards,context.data.planPatch(entity,
    {key:key(context,String(input.id)),compare:{field:'revision',expected:revision},where:{archived_at:null},values:patch})]};
}
async function archive(value:JsonValue,context:OperationContext,entity:Entity,restore=false){
  const input=args(value),row=await record(context,entity,input.id),revision=Number(input.revision);
  if(!Number.isSafeInteger(revision)||revision!==row.revision)conflict();
  if(restore?row.archived_at===null:row.archived_at!==null)conflict();
  if(!restore&&entity!=='prospect'){
    const dependents=entity==='company'?['contact','prospect']:['prospect'];
    for(const child of dependents){
      const relation=entity==='company'?'company_id':'contact_id';
      const page=await context.data.list(child,{limit:1,where:{[relation]:row.id,archived_at:null}});
      if(page.items.length)conflict();
    }
  }
  const guards=restore?await relations(context,entity,{},row):[];
  const patch={archived_at:restore?null:now(),updated_at:now()};
  return {output:{item:project(entity,{...row,...patch,revision:revision+1})},plans:[...guards,context.data.planPatch(entity,
    {key:key(context,String(input.id)),compare:{field:'revision',expected:revision},values:patch})]};
}
export const companyCreate=(v:JsonValue,c:OperationContext)=>create(v,c,'company');
export const companyRead=(v:JsonValue,c:OperationContext)=>read(v,c,'company');
export const companyList=(v:JsonValue,c:OperationContext)=>page(v,c,'company',false);
export const companySearch=(v:JsonValue,c:OperationContext)=>page(v,c,'company',true);
export const companyUpdate=(v:JsonValue,c:OperationContext)=>update(v,c,'company');
export const companyArchive=(v:JsonValue,c:OperationContext)=>archive(v,c,'company');
export const companyRestore=(v:JsonValue,c:OperationContext)=>archive(v,c,'company',true);
export const contactCreate=(v:JsonValue,c:OperationContext)=>create(v,c,'contact');
export const contactRead=(v:JsonValue,c:OperationContext)=>read(v,c,'contact');
export const contactList=(v:JsonValue,c:OperationContext)=>page(v,c,'contact',false);
export const contactSearch=(v:JsonValue,c:OperationContext)=>page(v,c,'contact',true);
export const contactUpdate=(v:JsonValue,c:OperationContext)=>update(v,c,'contact');
export const contactArchive=(v:JsonValue,c:OperationContext)=>archive(v,c,'contact');
export const contactRestore=(v:JsonValue,c:OperationContext)=>archive(v,c,'contact',true);
export const prospectCreate=(v:JsonValue,c:OperationContext)=>create(v,c,'prospect');
export const prospectRead=(v:JsonValue,c:OperationContext)=>read(v,c,'prospect');
export const prospectList=(v:JsonValue,c:OperationContext)=>page(v,c,'prospect',false);
export const prospectSearch=(v:JsonValue,c:OperationContext)=>page(v,c,'prospect',true);
export const prospectUpdate=(v:JsonValue,c:OperationContext)=>update(v,c,'prospect');
export const prospectArchive=(v:JsonValue,c:OperationContext)=>archive(v,c,'prospect');
export const prospectRestore=(v:JsonValue,c:OperationContext)=>archive(v,c,'prospect',true);
