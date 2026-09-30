import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {eventRecord,eventList,analyticsSnapshot,eventExport,widgetSummary,widgetEvents} from '../../module/service.ts';

const iso=new Date().toISOString();
function harness(rows=[]){
  const calls=[];
  const context={contextId:'space-one',principalId:'user-one',actorPrincipalId:'user-one',audience:'admin',
    data:{list:async(_model,options)=>{calls.push(options);const offset=options.after?
      rows.findIndex(row=>row.id===options.after.id)+1:0;
      const items=rows.slice(offset,offset+options.limit);
      return {items,nextAfter:offset+options.limit<rows.length?
        {created_at:items.at(-1).created_at,id:items.at(-1).id}:null};},
    planCreate:(_model,options)=>({kind:'create',...options})}};
  return {context,calls};
}
const row=(id,overrides={})=>({id,context_id:'space-one',principal_id:'user-one',
  actor_principal_id:'user-one',event_type:'page_view',action_id:null,surface:'workspace',
  path:'/home',error_code:null,duration_ms:null,created_at:iso,...overrides});

test('D1 event data and permissions are context scoped',()=>{
  assert.deepEqual(manifest.contracts.models[0].primaryKey,['context_id','id']);
  assert.deepEqual(manifest.contracts.models[0].indexes[0].fields,['context_id','created_at','id']);
  assert.deepEqual(manifest.contracts.permissions.map(permission=>permission.scopes[0]),
    ['analytics.emit','analytics.read','analytics.purge','analytics.configure']);
  assert.equal(manifest.contracts.models.find(model=>model.id==='event').deletion.mode,'hard');
  assert.ok(manifest.contracts.models.some(model=>model.id==='retention_policy'));
  for(const name of ['collection_policy','transport_refusal'])
    assert.equal(manifest.contracts.models.find(model=>model.id===name)?.scope,'application');
});
test('record fixes principal and time on server and rejects arbitrary content',async()=>{
  const {context}=harness();
  const result=await eventRecord({type:'page_view',surface:'workspace',path:'/home',
    principalId:'attacker',createdAt:'2000-01-01T00:00:00Z'},context);
  assert.equal(result.plans[0].values.principal_id,'user-one');
  assert.equal(result.output.event.source,'reported');
  assert.equal(result.output.event.path,'/home');
  await assert.rejects(eventRecord({type:'click',surface:'workspace',actionId:'<script>'},context),
    {code:'invalid_input'});
  await assert.rejects(eventRecord({type:'page_view',surface:'workspace',path:'//evil'},context),
    {code:'invalid_input'});
  await assert.rejects(eventRecord({type:'error',surface:'workspace',errorCode:'E',
    reportedDurationMs:86_400_001},context),{code:'invalid_input'});
});
test('page cursors keep frozen bounds and filters without lost rows',async()=>{
  const rows=Array.from({length:121},(_,index)=>row(`e-${String(index).padStart(3,'0')}`));
  const {context,calls}=harness(rows);
  const first=await eventList({period:'week',limit:50},context);
  assert.equal(first.output.items.length,50);
  const second=await eventList({period:'week',limit:50,cursor:first.output.nextCursor},context);
  const third=await eventList({period:'week',limit:50,cursor:second.output.nextCursor},context);
  assert.deepEqual([first,second,third].flatMap(page=>page.output.items.map(item=>item.id)),
    rows.map(item=>item.id));
  assert.equal(third.output.nextCursor,null);
  assert.equal(calls.every(call=>call.limit===50),true);
  await assert.rejects(eventList({period:'month',limit:50,cursor:first.output.nextCursor},context),
    {code:'invalid_input'});
  await assert.rejects(eventList({period:'week',limit:50,query:'other',cursor:first.output.nextCursor},context),
    {code:'invalid_input'});
  const exact=await eventList({period:'week',limit:50},harness(rows.slice(0,50)).context);
  assert.equal(exact.output.nextCursor,null,'the exact final page has no phantom cursor');
});
test('500-row scan is explicit, bounded, and escape-safe at maximum content',async()=>{
  const rows=Array.from({length:510},(_,index)=>row(`e-${String(index).padStart(3,'0')}`,
    {path:`/${'x'.repeat(255)}`}));
  const {context,calls}=harness(rows);
  const snapshot=await analyticsSnapshot({period:'week'},context);
  assert.equal(snapshot.output.scanned,500);
  assert.equal(snapshot.output.complete,false);
  assert.equal(snapshot.output.totals.events,500);
  assert.equal(calls.length,10);
  assert.ok(JSON.stringify(snapshot.output).length<20_000);
  const following=await analyticsSnapshot({period:'week',cursor:snapshot.output.nextCursor},context);
  assert.equal(following.output.totals.events,10);
  assert.equal(following.output.complete,true);
  const exported=await eventExport({period:'week',limit:50,format:'csv'},context);
  assert.ok(exported.output.content.length<20_000);
  const listed=await eventList({period:'week',limit:50},context);
  assert.ok(Buffer.byteLength(JSON.stringify(listed.output))<262144);
});
test('filter search scans without pretending a partial period is complete',async()=>{
  const rows=[row('one',{event_type:'click',path:null,action_id:'save'}),
    row('two',{event_type:'error',path:null,error_code:'E_FAIL'})];
  const {context}=harness(rows);
  const found=await eventList({period:'day',limit:5,query:'E_FAIL'},context);
  assert.deepEqual(found.output.items.map(item=>item.id),['two']);
  assert.equal(found.output.complete,true);
});
test('CSV export neutralizes formula-looking legacy identities',async()=>{
  const {context}=harness([row('legacy',{principal_id:'=HYPERLINK("https://example.invalid")'})]);
  const result=await eventExport({period:'week',limit:50,format:'csv'},context);
  assert.match(result.output.content,/"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/u);
});
test('year period spans twelve calendar months and remains cursor-compatible',async()=>{
  const rows=Array.from({length:2},(_,index)=>row(`year-${index}`));
  const {context}=harness(rows);
  const first=await eventList({period:'year',limit:1},context);
  assert.equal(first.output.period.period,'year');
  const from=new Date(first.output.period.from),to=new Date(first.output.period.to);
  const expected=new Date(to);expected.setUTCMonth(expected.getUTCMonth()-12);
  assert.equal(from.toISOString(),expected.toISOString());
  const second=await eventList({period:'year',limit:1,cursor:first.output.nextCursor},context);
  assert.equal(second.output.items.length,1);
  assert.equal(second.output.nextCursor,null);
});

test('widget projections preserve anchored cursor, page-local totals and bounded MCP envelope',async()=>{
  const rows=Array.from({length:510},(_,index)=>row(`w-${String(index).padStart(3,'0')}`,
    {principal_id:'P'.repeat(128),surface:'S'.repeat(64),path:`/${'x'.repeat(255)}` }));
  const {context}=harness(rows);
  const first=await widgetSummary({},context);
  const second=await widgetSummary({cursor:first.output.nextCursor},context);
  assert.equal(first.output.scanned,500);
  assert.equal(first.output.complete,false);
  assert.equal(second.output.scanned,10);
  assert.equal(second.output.complete,true);
  assert.deepEqual(second.output.period,first.output.period,'cursor anchors the seven-day window');
  assert.equal(second.output.totals.events,10,'complete second segment is not cumulative');
  const events=await widgetEvents({period:'week'},context);
  assert.equal(events.output.items.length,5);
  const next=await widgetEvents({period:'week',cursor:events.output.nextCursor},context);
  assert.deepEqual(next.output.period,events.output.period);
  assert.deepEqual([...events.output.items,...next.output.items].map(item=>item.id),
    rows.slice(0,10).map(item=>item.id));
  for(const result of [first,second,events,next]){
    const serialized=JSON.stringify(result.output);
    assert.ok(Buffer.byteLength(serialized,'utf8')<8192);
    const envelope={content:[{type:'text',text:serialized}],structuredContent:{
      kind:'creezio.widget.render.v1',input:result.output}};
    assert.ok(Buffer.byteLength(JSON.stringify(envelope),'utf8')<65536);
  }
  await assert.rejects(widgetEvents({period:'day',cursor:events.output.nextCursor},context),
    {code:'invalid_input'});
  const maximal={...events.output,items:Array.from({length:5},()=>({
    id:'I'.repeat(36),type:'page_view',actionId:'A'.repeat(80),surface:'S'.repeat(64),
    path:`/${'P'.repeat(255)}`,errorCode:'E'.repeat(80),occurredAt:'2026-09-29T12:00:00.000Z'})),
    nextCursor:'C'.repeat(2048),scanned:500};
  const worst=JSON.stringify(maximal);
  assert.ok(Buffer.byteLength(worst,'utf8')<7500,'five complete admissible ASCII fields and a max cursor fit chat');
  assert.ok(Buffer.byteLength(JSON.stringify({content:[{type:'text',text:worst}],
    structuredContent:{kind:'creezio.widget.render.v1',input:maximal}}),'utf8')<65536);
  const unicodeRows=[row('u',{principal_id:'😀'.repeat(128),surface:'S'.repeat(64),
    path:`/${'P'.repeat(255)}`,action_id:'A'.repeat(80),error_code:'E'.repeat(80)})];
  const unicode=await widgetEvents({period:'week'},harness(unicodeRows).context);
  assert.equal(JSON.stringify(unicode.output).includes('😀'),false,
    'the chat projection omits the unbounded identity text');
  await assert.rejects(eventRecord({type:'activity',surface:'😀'},context),{code:'invalid_input'});
  await assert.rejects(eventRecord({type:'page_view',surface:'workspace',path:'/😀'},context),
    {code:'invalid_input'});
  const unicodeQuery=await widgetEvents({period:'week',query:'é'.repeat(120)},context);
  assert.equal(unicodeQuery.output.items.length,0);
  assert.ok(unicodeQuery.output.nextCursor,'valid Unicode filter remains in a scoped cursor');
  const unicodeNext=await widgetEvents({period:'week',query:'é'.repeat(120),
    cursor:unicodeQuery.output.nextCursor},context);
  assert.deepEqual(unicodeNext.output.period,unicodeQuery.output.period);
  const escapedRows=Array.from({length:5},(_,index)=>row(`bad-${index}`,
    {path:'\u0001'.repeat(256)}));
  await assert.rejects(widgetEvents({period:'week'},harness(escapedRows).context),
    {code:'unavailable'},'legacy malformed D1 text is rejected before transport');
});
