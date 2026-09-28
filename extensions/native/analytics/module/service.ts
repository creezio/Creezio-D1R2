import {OperationError,type OperationContext,type JsonValue} from '@creezio/sdk/operations/handler';

type Row=Record<string,JsonValue>;
type Args=Record<string,unknown>;
type Page={items:readonly Row[];nextAfter:Row|null};
type Period='day'|'week'|'month'|'year';
type EventType='page_view'|'click'|'activity'|'error';
const periods:Record<Exclude<Period,'year'>,number>={day:1,week:7,month:30};
const types:readonly EventType[]=['page_view','click','activity','error'];
const invalid=():never=>{throw new OperationError('invalid_input');};
const args=(value:JsonValue):Args=>value&&typeof value==='object'&&!Array.isArray(value)?value as Args:{};
const identifier=(value:unknown,max=128):value is string=>typeof value==='string'&&value.length<=max
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
const path=(value:unknown):value is string=>typeof value==='string'&&value.length<=256
  &&/^\/[A-Za-z0-9/_-]*$/u.test(value)&&!value.includes('//');
const eventView=(row:Row)=>({id:row.id,principalId:row.principal_id,actorPrincipalId:row.actor_principal_id,
  type:row.event_type,actionId:row.action_id,surface:row.surface,path:row.path,errorCode:row.error_code,
  reportedDurationMs:row.duration_ms,occurredAt:row.created_at,source:'reported'});
const now=()=>new Date().toISOString();
const period=(value:unknown):Period=>value==='day'||value==='week'||value==='month'||value==='year'
  ?value:invalid();
const dateBounds=(value:unknown,rawCursor?:unknown)=>{const chosen=period(value);
  let to=now();
  if(rawCursor!==undefined&&rawCursor!==null){
    if(typeof rawCursor!=='string'||rawCursor.length>2048)invalid();
    try{const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
      atob((rawCursor as string).replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0))));
      if(decoded.period!==chosen||typeof decoded.to!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(decoded.to)
        ||!Number.isFinite(Date.parse(decoded.to))||Date.parse(decoded.to)>Date.now())invalid();
      to=decoded.to;
    }catch{return invalid();}
  }
  const start=new Date(to);
  if(chosen==='year')start.setUTCMonth(start.getUTCMonth()-12);
  else start.setTime(start.getTime()-periods[chosen]*86_400_000);
  const from=start.toISOString();
  return {period:chosen,from,to};};
function cursor(value:unknown,scope:Record<string,unknown>):Row|null{
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||value.length>2048)invalid();
  try{
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
      atob((value as string).replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0))));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.v!==1
      ||Object.entries(scope).some(([key,part])=>parsed[key]!==part)
      ||!parsed.after||typeof parsed.after!=='object'||Array.isArray(parsed.after)
      ||!identifier(parsed.after.id)||typeof parsed.after.created_at!=='string')throw 0;
    return {created_at:parsed.after.created_at,id:parsed.after.id};
  }catch{return invalid();}
}
function encode(after:Row|null,scope:Record<string,unknown>):string|null{
  if(!after)return null;
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({v:1,...scope,after}))))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
}
const scope=(c:OperationContext,bounds:{period:Period;from:string;to:string},filters:Record<string,unknown>)=>({
  context:c.contextId,audience:c.audience,period:bounds.period,from:bounds.from,to:bounds.to,...filters});
const queryFilter=(input:Args)=>{
  const query=input.query===undefined?'':typeof input.query==='string'?input.query.trim().toLocaleLowerCase():invalid();
  if(query.length>120||query&&!/^[\p{L}\p{N} ._:/-]+$/u.test(query))invalid();
  const type=input.type===undefined?null:types.includes(input.type as EventType)?input.type as EventType:invalid();
  const principalId=input.principalId===undefined?null:identifier(input.principalId)?input.principalId:invalid();
  return {query,type,principalId};
};
function matches(row:Row,filters:ReturnType<typeof queryFilter>):boolean{
  if(filters.type&&row.event_type!==filters.type||filters.principalId&&row.principal_id!==filters.principalId)return false;
  return !filters.query||[row.event_type,row.action_id,row.surface,row.path,row.error_code,row.principal_id]
    .some(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(filters.query));
}
async function scan(c:OperationContext,bounds:ReturnType<typeof dateBounds>,after:Row|null,
  maximum:number,filter:ReturnType<typeof queryFilter>):Promise<{rows:Row[];after:Row|null;complete:boolean;scanned:number}>{
  const rows:Row[]=[];let scanned=0,complete=false;
  for(let page=0;page<10&&scanned<500&&rows.length<maximum;page++){
    const part=await c.data.list('event',{limit:50,after,order:{indexId:'by-time',direction:'desc'}}) as Page;
    let last:Row|null=null;
    for(const row of part.items){
      if(String(row.created_at)<bounds.from){complete=true;break;}
      last=row;scanned++;
      if(String(row.created_at)<=bounds.to&&matches(row,filter))rows.push(row);
      if(rows.length===maximum)break;
    }
    if(complete){after=null;break;}
    const exhausted=last===part.items.at(-1)&&!part.nextAfter;
    after=rows.length===maximum&&last&&!exhausted?{created_at:last.created_at,id:last.id}:part.nextAfter;
    if(!after){complete=true;break;}
    if(rows.length===maximum)break;
  }
  return {rows,after,complete,scanned};
}
export async function eventRecord(value:JsonValue,c:OperationContext){
  const input=args(value);
  if(!types.includes(input.type as EventType)||!identifier(input.surface,64)
    ||input.actionId!==undefined&&input.actionId!==null&&!identifier(input.actionId,80)
    ||input.path!==undefined&&input.path!==null&&!path(input.path)
    ||input.errorCode!==undefined&&input.errorCode!==null&&!identifier(input.errorCode,80)
    ||input.reportedDurationMs!==undefined&&input.reportedDurationMs!==null
      &&(!Number.isSafeInteger(input.reportedDurationMs)||Number(input.reportedDurationMs)>86_400_000
        ||Number(input.reportedDurationMs)<0))invalid();
  if(input.type==='page_view'&&!path(input.path)||input.type==='click'&&!identifier(input.actionId,80)
    ||input.type==='error'&&!identifier(input.errorCode,80))invalid();
  const row:Row={id:crypto.randomUUID(),principal_id:c.principalId,actor_principal_id:c.actorPrincipalId,
    event_type:input.type as string,action_id:input.actionId as string??null,surface:input.surface as string,
    path:input.path as string??null,error_code:input.errorCode as string??null,
    duration_ms:input.reportedDurationMs as number??null,
    created_at:now()};
  return {output:{event:eventView(row)},plans:[c.data.planCreate('event',{values:row})]};
}
export async function eventList(value:JsonValue,c:OperationContext){
  const input=args(value),bounds=dateBounds(input.period,input.cursor),limit=Number(input.limit),filters=queryFilter(input);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)invalid();
  const binding=scope(c,bounds,filters),result=await scan(c,bounds,cursor(input.cursor,binding),limit,filters);
  return {output:{period:bounds,items:result.rows.map(eventView),nextCursor:encode(result.after,binding),
    complete:result.complete,scanned:result.scanned}};
}
const bucket=(time:string,period:Period)=>period==='year'?time.slice(0,7):period==='day'?time.slice(0,13):time.slice(0,10);
const ranked=(map:Map<string,number>,limit=20)=>[...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
  .slice(0,limit).map(([name,count])=>({name,count}));
export async function analyticsSnapshot(value:JsonValue,c:OperationContext){
  const input=args(value),bounds=dateBounds(input.period,input.cursor),filters=queryFilter(input);
  if(filters.query||filters.type)invalid();
  const binding=scope(c,bounds,filters),result=await scan(c,bounds,cursor(input.cursor,binding),500,filters);
  const totals={events:0,pageViews:0,clicks:0,errors:0,reportedDurationMs:0};
  const byHour=new Map<string,number>(),timeline=new Map<string,number>(),pages=new Map<string,number>(),
    clicks=new Map<string,number>(),users=new Map<string,number>();
  for(const row of result.rows){
    totals.events++;
    if(row.event_type==='page_view')totals.pageViews++;
    if(row.event_type==='click')totals.clicks++;
    if(row.event_type==='error')totals.errors++;
    totals.reportedDurationMs+=Number(row.duration_ms??0);
    const hour=String(row.created_at).slice(11,13),timeBucket=bucket(String(row.created_at),bounds.period);
    byHour.set(hour,(byHour.get(hour)??0)+1);timeline.set(timeBucket,(timeline.get(timeBucket)??0)+1);
    const principal=String(row.principal_id);users.set(principal,(users.get(principal)??0)+1);
    if(row.event_type==='page_view'&&row.path)pages.set(String(row.path),(pages.get(String(row.path))??0)+1);
    if(row.event_type==='click'&&row.action_id)clicks.set(String(row.action_id),(clicks.get(String(row.action_id))??0)+1);
  }
  return {output:{period:bounds,source:'reported',complete:result.complete,scanned:result.scanned,
    nextCursor:encode(result.after,binding),totals,activePrincipals:users.size,
    timeline:ranked(timeline,366).sort((a,b)=>a.name.localeCompare(b.name)),
    hours:ranked(byHour,24).sort((a,b)=>a.name.localeCompare(b.name)),
    pages:ranked(pages),clicks:ranked(clicks),users:ranked(users)}};
}
const csv=(cells:readonly unknown[])=>cells.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',');
export async function eventExport(value:JsonValue,c:OperationContext){
  const input=args(value),format=input.format;
  if(format!=='csv'&&format!=='json')invalid();
  const listed=await eventList({...input,limit:Math.min(Number(input.limit),50)} as JsonValue,c);
  const data=listed.output;
  const rows=data.items;
  const content=format==='json'?JSON.stringify(rows):[
    csv(['id','principalId','type','actionId','surface','path','errorCode','reportedDurationMs','occurredAt']),
    ...rows.map(row=>csv([row.id,row.principalId,row.type,row.actionId,row.surface,row.path,row.errorCode,
      row.reportedDurationMs,row.occurredAt]))].join('\n');
  if(new TextEncoder().encode(content).length>180_000)throw new OperationError('unavailable');
  return {output:{format,content,nextCursor:data.nextCursor,complete:data.complete,period:data.period}};
}
