import test from 'node:test';
import assert from 'node:assert/strict';
import {indexRebuildStart,indexSyncStart,indexPrepare,indexEmit,indexReconcile,indexRead,indexAbandon,indexSearch}
  from '../../module/indexing.ts';

const uid='cz_0123456789abcdef0123456789abcdef0123456789abcdef';
const sourceId='creezio.catalog:catalog-products';
const config={id:'meili.api.v1',origin:'https://meili.example.invalid',
  key_ref:'creezio-secret:v1:test',secret_version:1,enabled:true,revision:4};
const records=Array.from({length:29},(_,index)=>({id:`p${index}`,revision:1,deleted:false,
  fields:{id:`p${index}`,name:`Product ${index}`,status:'published',revision:1}}));
function harness(source=records){
  const rows=new Map([['connector_config:meili.api.v1',config]]),requests=[];
  const context={executionId:'00000000-0000-4000-8000-000000000001',contextId:'application',
    signal:new AbortController().signal,
    search:{sources(){return [sourceId];},facets(){return ['category_id'];},
      async indexUid(){return uid;},async page({cursor,limit}){
      const start=cursor?Number(cursor.slice(1)):0,items=source.slice(start,start+limit);
      return {items,afterEach:items.map((_,i)=>`c${start+i+1}`),
        nextCursor:start+limit<source.length?`c${start+limit}`:null};}},
    connector:{async mutate(input){requests.push(input);return {kind:'ok',status:202,
      body:{taskUid:7,indexUid:uid,status:'enqueued',type:'documentAdditionOrUpdate'}};},
    async request(input){requests.push(input);return {kind:'ok',status:200,
      body:{uid:7,indexUid:uid,status:'succeeded',type:'documentAdditionOrUpdate',
        error:{message:'must never escape'}}};}},
    data:{async get(model,{key}){return rows.get(`${model}:${key.id}`)??null;},
      planCreate(model,{values}){return {kind:'create',model,values};},
      planPatch(model,{key,compare,values}){return {kind:'patch',model,key,compare,values};}}};
  function apply(result){for(const plan of result.plans??[]){const key=`${plan.model}:${plan.kind==='create'?plan.values.id:plan.key.id}`;
      if(plan.kind==='create')rows.set(key,{...plan.values});
      else{const prior=rows.get(key);assert.equal(prior.revision,plan.compare.expected);
        rows.set(key,{...prior,...plan.values,revision:prior.revision+1});}}return result.output.index;}
  return {context,requests,rows,apply};
}
test('rebuild emits 13 changed documents per declared task and reconciles before advancing',async()=>{
  const h=harness();
  let state=h.apply(await indexRebuildStart({requestKey:'start',revision:0},h.context));
  assert.equal(state.state,'building');assert.equal(state.building,uid);
  state=h.apply(await indexPrepare({requestKey:'prepare',revision:state.revision},h.context));
  assert.equal(state.state,'prepared');assert.equal(state.preparedCount,13);
  assert.equal(h.requests.length,0,'prepare has no external side effect');
  const emitKey=state.emitKey;
  await assert.rejects(indexEmit({requestKey:'different-key',revision:state.revision},h.context),{code:'conflict'});
  state=h.apply(await indexEmit({requestKey:emitKey,revision:state.revision},h.context));
  assert.equal(state.state,'waiting');assert.equal(state.taskUid,7);
  assert.equal(h.requests[0].resource,'document-upsert');
  assert.equal(h.requests[0].fields.documents.length,13);
  assert.equal(h.rows.get(`index_job:${sourceId}`).cursor,null,'cursor is frozen until task success');
  state=h.apply(await indexReconcile({requestKey:'confirm',revision:state.revision},h.context));
  assert.equal(state.state,'building');
  assert.equal(h.rows.get(`index_job:${sourceId}`).cursor,'c13');
  assert.equal(h.rows.get('index_projection:00000000-0000-4000-8000-000000000001:p0').source_revision,1);
  assert.doesNotMatch(JSON.stringify(state),/must never escape/u);
  assert.equal(h.requests[1].resource,'task');
});
test('unknown emission keeps the durable prepared key and forbids a new key',async()=>{
  const h=harness(records.slice(0,1));
  let state=h.apply(await indexRebuildStart({requestKey:'start',revision:0},h.context));
  state=h.apply(await indexPrepare({requestKey:'prepare',revision:state.revision},h.context));
  const key=state.emitKey;
  h.context.connector.mutate=async input=>{h.requests.push(input);
    return {kind:'error',code:'outcome_unknown'};};
  await assert.rejects(indexEmit({requestKey:key,revision:state.revision},h.context),{code:'unknown'});
  assert.equal(h.rows.get(`index_job:${sourceId}`).state,'prepared');
  assert.equal(h.rows.get(`index_job:${sourceId}`).emit_key,key);
  await assert.rejects(indexEmit({requestKey:'new-key',revision:state.revision},h.context),{code:'conflict'});
  await assert.rejects(indexRebuildStart({requestKey:'restart',revision:state.revision},h.context),{code:'conflict'});
  assert.equal(h.requests.length,1);
  await assert.rejects(indexAbandon({requestKey:'abandon',revision:state.revision},h.context),{code:'conflict'});
  const abandoned=h.apply(await indexAbandon({requestKey:'abandon',revision:state.revision,
    acknowledgeUnknown:true},h.context));
  assert.equal(abandoned.state,'failed');assert.equal(abandoned.active,null);
  assert.equal(abandoned.abandoned,uid);
  assert.equal(h.requests.length,1,'abandon does not send or delete a provider request');
});
test('synchronized revisions are skipped during a later scan without provider mutation',async()=>{
  const h=harness(records.slice(0,2));
  let state=h.apply(await indexRebuildStart({requestKey:'start',revision:0},h.context));
  state=h.apply(await indexPrepare({requestKey:'prepare',revision:state.revision},h.context));
  state=h.apply(await indexEmit({requestKey:state.emitKey,revision:state.revision},h.context));
  state=h.apply(await indexReconcile({requestKey:'confirm',revision:state.revision},h.context));
  state=h.apply(await indexPrepare({requestKey:'finish',revision:state.revision},h.context));
  assert.equal(state.state,'ready');assert.equal(state.active,uid);
  const before=h.requests.length;
  state=h.apply(await indexSyncStart({requestKey:'sync',revision:state.revision},h.context));
  state=h.apply(await indexPrepare({requestKey:'unchanged',revision:state.revision},h.context));
  assert.equal(state.state,'ready');assert.equal(h.requests.length,before);
  assert.equal((await indexRead({},h.context)).output.index.state,'ready');
});
test('search discards provider aggregates and facets before returning owner-authorized rows',async()=>{
  const h=harness();
  h.rows.set(`index_job:${sourceId}`,{id:sourceId,state:'ready',revision:4,
    config_revision:4,active_uid:uid,active_epoch:h.context.executionId});
  h.context.connector.request=async input=>{h.requests.push(input);return {kind:'ok',status:200,
    body:{hits:[{id:'p0',secret:'never'},{id:'p1',secret:'hidden'}],offset:0,limit:2,
      estimatedTotalHits:991,facetDistribution:{private:{value:991}}}};};
  h.context.search.reauthorize=async({ids})=>[{id:ids[0],revision:1,deleted:false,
    fields:{id:ids[0],name:'Allowed',description:'',category_id:'visible',price_minor:100,
      currency:'EUR',status:'published',revision:1,updated_at:'2026-09-30T00:00:00.000Z'}}];
  const result=(await indexSearch({q:'product',limit:2,offset:0},h.context)).output;
  assert.equal(result.pageCount,1);
  assert.deepEqual(result.facets,[{field:'category_id',values:[{value:'visible',count:1}]}]);
  assert.equal(result.source,sourceId);
  assert.equal(result.nextOffset,2);
  assert.doesNotMatch(JSON.stringify(result),/991|private|hidden|never/u);
  assert.deepEqual(h.requests[0].fields,{q:'product'});
});
test('two declared sources have separate durable jobs and require an explicit choice',async()=>{
  const h=harness(records.slice(0,1)),other='vendor.inventory:products';
  h.context.search.sources=()=>[sourceId,other];
  h.context.search.indexUid=async({source})=>source===sourceId?uid:
    'cz_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.deepEqual((await indexRead({},h.context)).output.sources,[sourceId,other]);
  await assert.rejects(indexRebuildStart({requestKey:'ambiguous',revision:0},h.context),
    {code:'invalid_input'});
  h.apply(await indexRebuildStart({requestKey:'first',revision:0,source:sourceId},h.context));
  h.apply(await indexRebuildStart({requestKey:'second',revision:0,source:other},h.context));
  assert.equal(h.rows.get(`index_job:${sourceId}`).building_uid,uid);
  assert.equal(h.rows.get(`index_job:${other}`).building_uid,
    'cz_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await assert.rejects(indexRebuildStart({requestKey:'foreign',revision:0,
    source:'vendor.unknown:products'},h.context),{code:'invalid_input'});
});
