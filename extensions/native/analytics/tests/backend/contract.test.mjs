import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {eventRecord,eventList,analyticsSnapshot,eventExport} from '../../module/service.ts';

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
    ['analytics.emit','analytics.read']);
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
