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
  &&/^\/[A-Za-z0-9/._:{}-]*$/u.test(value)&&!value.includes('//');
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
/** Seven-day, page-local projection of the existing snapshot. */
export async function widgetSummary(value:JsonValue,c:OperationContext){
  const input=args(value);
  const calculated=await analyticsSnapshot({period:'week',...(input.cursor===undefined?{}:{cursor:input.cursor})} as JsonValue,c);
  const {period,source,complete,scanned,nextCursor,totals,activePrincipals,timeline}=calculated.output;
  const output={period,source,complete,scanned,nextCursor,totals,activePrincipals,timeline};
  if(new TextEncoder().encode(JSON.stringify(output)).length>7500)throw new OperationError('unavailable');
  return {output};
}
/** Existing event cursor, fixed to five rows before serialization. */
export async function widgetEvents(value:JsonValue,c:OperationContext){
  const listed=await eventList({...args(value),limit:5} as JsonValue,c);
  const {period,nextCursor,complete,scanned}=listed.output;
  const items=listed.output.items.map(({id,type,actionId,surface,path,errorCode,occurredAt})=>
    ({id,type,actionId,surface,path,errorCode,occurredAt}));
  const output={period,items,nextCursor,complete,scanned};
  if(new TextEncoder().encode(JSON.stringify(output)).length>7500)throw new OperationError('unavailable');
  return {output};
}
const csv=(cells:readonly unknown[])=>cells.map(value=>{
  const text=String(value??'');
  // Spreadsheet software may evaluate even a quoted CSV cell as a formula.
  const safe=/^[\s\uFEFF]*[=+\-@]/u.test(text)?`'${text}`:text;
  return `"${safe.replaceAll('"','""')}"`;
}).join(',');
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
export async function diagnosticsExecutions(value:JsonValue,c:OperationContext){
  if(!c.diagnostics)throw new OperationError('unavailable');
  const input=args(value);
  return {output:await c.diagnostics.listExecutions({period:period(input.period),limit:Number(input.limit),
    ...(input.cursor===undefined?{}:{cursor:String(input.cursor)})})};
}
export async function diagnosticsEndpoints(value:JsonValue,c:OperationContext){
  if(!c.diagnostics)throw new OperationError('unavailable');
  const input=args(value);
  return {output:await c.diagnostics.listEndpoints({limit:Number(input.limit),
    ...(input.cursor===undefined?{}:{cursor:String(input.cursor)})})};
}

const installationAdmin=(c:OperationContext)=>{
  if(c.audience!=='admin'||c.contextId!=='application')throw new OperationError('forbidden');
};
const collectionRow=(c:OperationContext)=>c.data.get('collection_policy',{key:{id:'application'}}) as Promise<Row|null>;
const collectionView=(row:Row|null)=>({configured:!!row,revision:Number(row?.revision??0),
  navigation:row?.navigation_enabled===true,clicks:row?.clicks_enabled===true,
  refusals:row?.refusals_enabled===true,refusalRetentionDays:Number(row?.refusal_retention_days??7),manualOnly:true});
const collectionDays=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=1&&Number(value)<=365
  ?Number(value):invalid();
const refusalCutoff=(days:number)=>Date.now()-days*86_400_000;
const refusalPageItem=(row:Row)=>({id:String(row.id),transport:row.transport,method:row.method,
  routeTemplate:row.route_template,status:Number(row.status),errorCode:row.error_code,
  occurredAt:new Date(Number(row.created_at_ms)).toISOString(),durationMs:Number(row.duration_ms)});
const refusalCursor=(value:unknown)=>{
  if(value===undefined)return null;
  if(typeof value!=='string'||value.length>2048||!(/^[A-Za-z0-9_-]+$/u.test(value)))invalid();
  try{const encoded=String(value),parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(
    atob(encoded.replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0))));
    if(!parsed||parsed.v!==1||parsed.kind!=='refusals'||parsed.context!=='application'
      ||!Number.isSafeInteger(parsed.after?.created_at_ms)||parsed.after.created_at_ms<0
      ||!identifier(parsed.after?.id,36))invalid();
    return {created_at_ms:parsed.after.created_at_ms,id:parsed.after.id};
  }catch{return invalid();}
};
const encodeRefusalCursor=(after:Row|null)=>after?btoa(String.fromCharCode(...new TextEncoder().encode(
  JSON.stringify({v:1,kind:'refusals',context:'application',after:{created_at_ms:after.created_at_ms,id:after.id}}))))
  .replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,''):null;
export async function collectionPolicy(_value:JsonValue,c:OperationContext){
  installationAdmin(c);return {output:collectionView(await collectionRow(c))};
}
export async function collectionEffective(_value:JsonValue,c:OperationContext){
  if(!c.diagnostics)throw new OperationError('unavailable');
  return {output:await c.diagnostics.collectionFlags()};
}
export async function collectionConfigure(value:JsonValue,c:OperationContext){
  installationAdmin(c);const input=args(value),expected=revision(input.expectedRevision),
    days=collectionDays(input.refusalRetentionDays);
  if(typeof input.navigation!=='boolean'||typeof input.clicks!=='boolean'||typeof input.refusals!=='boolean')invalid();
  const existing=await collectionRow(c);
  if(Number(existing?.revision??0)!==expected)throw new OperationError('conflict');
  const next=expected+1,values={revision:next,navigation_enabled:Boolean(input.navigation),
    clicks_enabled:Boolean(input.clicks),refusals_enabled:Boolean(input.refusals),
    refusal_retention_days:days,updated_at:now()};
  const plan=existing?c.data.planPatch('collection_policy',{key:{id:'application'},
    compare:{field:'revision',expected},values:{navigation_enabled:values.navigation_enabled,
      clicks_enabled:values.clicks_enabled,refusals_enabled:values.refusals_enabled,
      refusal_retention_days:values.refusal_retention_days,updated_at:values.updated_at}})
    :c.data.planCreate('collection_policy',{values:{id:'application',...values}});
  return {output:{configured:true,revision:next,navigation:input.navigation,clicks:input.clicks,
    refusals:input.refusals,refusalRetentionDays:days,manualOnly:true},plans:[plan]};
}
export async function refusalsList(value:JsonValue,c:OperationContext){
  installationAdmin(c);const input=args(value),limit=Number(input.limit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)invalid();
  const result=await c.data.list('transport_refusal',{limit,after:refusalCursor(input.cursor),
    order:{indexId:'by-time',direction:'desc'}}) as Page;
  return {output:{items:result.items.map(refusalPageItem),
    nextCursor:encodeRefusalCursor(result.nextAfter),complete:!result.nextAfter}};
}
async function eligibleRefusals(c:OperationContext,cutoff:number){
  const page=await c.data.list('transport_refusal',{limit:11,order:{indexId:'by-time',direction:'asc'},
    fields:['id','created_at_ms']}) as Page;
  const old=page.items.filter(row=>Number(row.created_at_ms)<cutoff);
  return {items:old.slice(0,10).map(row=>({id:String(row.id),occurredAt:new Date(Number(row.created_at_ms)).toISOString()})),
    hasMore:old.length>10};
}
export async function refusalsPreview(_value:JsonValue,c:OperationContext){
  installationAdmin(c);const policy=collectionView(await collectionRow(c));
  const cutoff=refusalCutoff(policy.refusalRetentionDays),selected=await eligibleRefusals(c,cutoff);
  return {output:{revision:policy.revision,cutoff:new Date(cutoff).toISOString(),...selected,manualOnly:true}};
}
export async function refusalsPurge(value:JsonValue,c:OperationContext){
  installationAdmin(c);const input=args(value),expected=revision(input.revision);
  if(!isoDate(input.cutoff)||!Array.isArray(input.items)||input.items.length<1||input.items.length>10)invalid();
  const policy=collectionView(await collectionRow(c));
  if(!policy.configured||policy.revision!==expected)throw new OperationError('conflict');
  const cutoff=Date.parse(String(input.cutoff));
  if(cutoff>refusalCutoff(policy.refusalRetentionDays))invalid();
  const selected=await eligibleRefusals(c,cutoff);
  if(JSON.stringify(selected.items)!==JSON.stringify(input.items))throw new OperationError('conflict');
  const plans=[c.data.planGet('collection_policy',{key:{id:'application'},where:{revision:expected},
    fields:['id'],required:true}),...selected.items.map(item=>c.data.planDelete('transport_refusal',
    {key:{id:item.id},where:{created_at_ms:Date.parse(item.occurredAt)}}))];
  return {output:{deleted:selected.items.length,hasMore:selected.hasMore,cutoff:String(input.cutoff),revision:expected},plans};
}

const policyId='retention';
const purgeLimit=10;
const isoDate=(value:unknown):value is string=>typeof value==='string'
  &&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const retentionDays=(value:unknown):number=>Number.isSafeInteger(value)&&Number(value)>=1&&Number(value)<=3650
  ?Number(value):invalid();
const revision=(value:unknown):number=>Number.isSafeInteger(value)&&Number(value)>=0
  &&Number(value)<Number.MAX_SAFE_INTEGER?Number(value):invalid();
const cutoffFor=(days:number,atMs=Date.now())=>new Date(atMs-days*86_400_000).toISOString();
const policyView=(row:Row|null)=>({configured:!!row,retentionDays:row?Number(row.retention_days):null,
  revision:row?Number(row.revision):0,manualOnly:true});
const readPolicy=(c:OperationContext)=>c.data.get('retention_policy',{key:{id:policyId}}) as Promise<Row|null>;

/** Configuration never schedules a purge. The first write is explicit and CAS-protected. */
export async function retentionPolicy(_value:JsonValue,c:OperationContext){
  return {output:policyView(await readPolicy(c))};
}
export async function retentionConfigure(value:JsonValue,c:OperationContext){
  const input=args(value),days=retentionDays(input.retentionDays),expected=revision(input.expectedRevision);
  const current=await readPolicy(c);
  if(Number(current?.revision??0)!==expected)throw new OperationError('conflict');
  const updatedAt=now(),next=expected+1;
  const plan=current
    ?c.data.planPatch('retention_policy',{key:{id:policyId},compare:{field:'revision',expected},
      values:{retention_days:days,updated_at:updatedAt}})
    :c.data.planCreate('retention_policy',{values:{id:policyId,retention_days:days,
      revision:next,updated_at:updatedAt}});
  return {output:{configured:true,retentionDays:days,revision:next,manualOnly:true},plans:[plan]};
}

type PurgeItem={id:string;occurredAt:string};
async function eligible(c:OperationContext,cutoff:string):Promise<{items:PurgeItem[];hasMore:boolean}>{
  const page=await c.data.list('event',{limit:purgeLimit+1,
    order:{indexId:'by-time',direction:'asc'},fields:['id','created_at']}) as Page;
  const rows=page.items.filter(row=>String(row.created_at)<cutoff);
  return {items:rows.slice(0,purgeLimit).map(row=>({id:String(row.id),occurredAt:String(row.created_at)})),
    hasMore:rows.length>purgeLimit};
}
export async function retentionPreview(_value:JsonValue,c:OperationContext){
  const policy=await readPolicy(c),view=policyView(policy);
  if(!policy)return {output:{...view,cutoff:null,items:[],hasMore:false}};
  const cutoff=cutoffFor(retentionDays(policy.retention_days));
  const selected=await eligible(c,cutoff);
  return {output:{...view,cutoff,...selected}};
}

/** Delete exactly the previewed oldest batch; policy and each event are rechecked in the commit. */
export async function retentionPurge(value:JsonValue,c:OperationContext){
  const input=args(value),expected=revision(input.revision),cutoff=input.cutoff;
  if(!isoDate(cutoff))throw new OperationError('invalid_input');
  if(Date.parse(cutoff)>Date.now()||!Array.isArray(input.items)
    ||input.items.length<1||input.items.length>purgeLimit)invalid();
  const policy=await readPolicy(c);
  if(!policy||Number(policy.revision)!==expected)throw new OperationError('conflict');
  if(Date.parse(cutoff)>Date.parse(cutoffFor(retentionDays(policy.retention_days))))invalid();
  const selected=await eligible(c,cutoff);
  if(JSON.stringify(selected.items)!==JSON.stringify(input.items))throw new OperationError('conflict');
  const plans=[c.data.planGet('retention_policy',{key:{id:policyId},where:{revision:expected},
    fields:['id'],required:true}),...selected.items.map(item=>c.data.planDelete('event',
    {key:{id:item.id},where:{created_at:item.occurredAt}}))];
  return {output:{deleted:selected.items.length,hasMore:selected.hasMore,cutoff,revision:expected},plans};
}
