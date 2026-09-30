import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {canonicalOrigin,configRead,configSet,configKeySet,configKeyRevoke,
  capabilitiesRead,capabilitiesCapture,modelsList,runRead,runPrepare,runSubmit,runStop} from '../../module/service.ts';
import {hermesConnectorDescriptor} from '../../module/storage.ts';

const config={id:'hermes.api.v1',origin:'https://hermes.example.org',key_ref:'sealed:reference',secret_version:1,
  enabled:true,revision:4,generation:7,updated_at:'2026-09-30T00:00:00.000Z'};
const run={id:'local-1',principal_id:'owner-1',audience:'app',connection_generation:7,
  remote_id:'run_1',status:'running',revision:2,created_at:new Date().toISOString()};
const capabilities={object:'hermes.api_server.capabilities',model:'hermes-agent',
  features:{run_submission:true,run_status:true,run_events_sse:false,run_stop:true}};
const snapshot={id:'current',connection_generation:7,model:'hermes-agent',run_submission:true,run_status:true,
  run_events_sse:false,run_stop:true,observed_at:new Date().toISOString(),revision:1};
function harness(rows={},response=capabilities){
  const calls=[];
  const data={async get(model){calls.push({get:model});return rows[model]??null;},
    planPatch(model,value){calls.push({patch:model,value});return {kind:'data-plan'};},
    planCreate(model,value){calls.push({create:model,value});return {kind:'data-plan'};}};
  const context={principalId:'owner-1',audience:'app',contextId:'application',executionId:'execution-1',
    signal:new AbortController().signal,data,
    connector:{async request(request){calls.push({request});return {kind:'ok',status:200,body:response};}},
    providerSecrets:{async preparePut(){return {plan:{kind:'data-plan'},reference:'sealed:new',version:1};},
      async prepareReplace(){return {plan:{kind:'data-plan'},reference:'sealed:next',version:2};},
      async prepareRevoke(){return {plan:{kind:'data-plan'},version:2};}}};
  return {calls,context};
}
test('descriptor contains exact bearer GET and idempotent POST resources; models stay private',()=>{
  assert.deepEqual(hermesConnectorDescriptor.auth,{kind:'bearer'});
  assert.deepEqual(hermesConnectorDescriptor.resources.map(x=>[x.method,x.path]),[
    ['GET','/v1/capabilities'],['GET','/v1/models'],['GET','/api/model/options'],['GET','/v1/runs/{id}'],
    ['POST','/v1/runs'],['POST','/v1/runs/{id}/stop']]);
  assert.ok(hermesConnectorDescriptor.resources.filter(x=>x.method==='POST')
    .every(x=>x.idempotencyHeader==='Idempotency-Key'));
  assert.deepEqual(manifest.contracts.connectors,[hermesConnectorDescriptor]);
  assert.ok(manifest.contracts.models.every(x=>x.public===false));
  assert.deepEqual(manifest.contracts.models.find(x=>x.id==='connection_stamp').fields.map(x=>x.id),
    ['context_id','id','generation']);
  assert.ok(!manifest.contracts.permissions.find(x=>x.id==='use').resources.some(x=>x.id==='connector_config'));
  const connect=manifest.contracts.permissions.find(x=>x.id==='connect');
  assert.deepEqual(connect.actions,['read','execute']);
  assert.deepEqual(connect.resources.map(x=>x.id),['connector_config','connector_secret']);
  assert.ok(manifest.contracts.models.find(x=>x.id==='connector_secret').fields.every(x=>x.protected));
});
test('configuration is HTTPS only and rotation bumps separate generation stamp in same plans',async()=>{
  assert.equal(canonicalOrigin('https://HERMES.example.org/'),'https://hermes.example.org');
  for(const bad of ['http://hermes.example.org','https://localhost','https://127.0.0.1',
    'https://user:pass@hermes.example.org','https://hermes.example.org/path'])
    assert.throws(()=>canonicalOrigin(bad),{code:'invalid_input'});
  const created=harness();
  const first=await configSet({origin:config.origin,enabled:false,revision:0},created.context);
  assert.equal(first.output.config.generation,1);
  assert.deepEqual(created.calls.filter(x=>x.create).map(x=>x.create),['connector_config','connection_stamp']);
  const changed=harness({connector_config:config});
  const key=await configKeySet({apiKey:'synthetic-key',revision:4},changed.context);
  assert.equal(key.output.config.generation,8);assert.equal(key.plans.length,3);
  assert.deepEqual(changed.calls.filter(x=>x.patch).map(x=>x.patch),['connector_config','connection_stamp']);
  assert.doesNotMatch(JSON.stringify(key),/synthetic-key|sealed:/);
  const revoked=harness({connector_config:config});
  const result=await configKeyRevoke({revision:4},revoked.context);
  assert.equal(result.output.config.enabled,false);assert.equal(result.output.config.generation,8);
  assert.deepEqual(revoked.calls.filter(x=>x.patch).map(x=>x.patch),['connector_config','connection_stamp']);
  assert.doesNotMatch(JSON.stringify(await configRead({},harness({connector_config:config}).context)),/sealed:/);
});
test('GET capabilities and models project only bounded fields',async()=>{
  const c=harness({},capabilities);
  const result=await capabilitiesRead({},c.context);
  assert.equal(result.output.capabilities.features.run_submission,true);
  assert.equal(result.output.capabilities.features.run_events_sse,false);
  assert.equal(c.calls.at(-1).request.resource,'capabilities');
  const m=harness({},{object:'list',data:[{id:'hermes-agent',secret:'hidden'}]});
  const models=await modelsList({},m.context);
  assert.deepEqual(models.output.models,[{id:'hermes-agent'}]);
  assert.doesNotMatch(JSON.stringify(models),/hidden/);
  await assert.rejects(modelsList({},harness({},{data:new Array(101).fill({id:'x'})}).context),{code:'unavailable'});
  const capture=harness({connector_config:config},capabilities);
  const saved=await capabilitiesCapture({requestKey:'cap-1'},capture.context);
  assert.equal(saved.output.capabilities.features.run_submission,true);
  assert.deepEqual(capture.calls.filter(x=>x.create).map(x=>x.create),['capability_snapshot']);
});
test('run read requires local ownership and current generation before remote GET',async()=>{
  const good=harness({run,connection_stamp:{generation:7},capability_snapshot:snapshot},
    {object:'hermes.run',run_id:'run_1',status:'completed',output:'Done',session_id:'session-1',model:'hermes-agent'});
  const result=await runRead({id:'local-1'},good.context);
  assert.equal(result.output.run.remote.status,'completed');
  assert.equal(good.calls.at(-1).request.id,'run_1');
  for(const rows of [{run:{...run,principal_id:'another'},connection_stamp:{generation:7}},
    {run,connection_stamp:{generation:8}},
    {run,connection_stamp:{generation:7},capability_snapshot:{...snapshot,run_status:false}}]){
    const h=harness(rows);
    await assert.rejects(runRead({id:'local-1'},h.context));
    assert.equal(h.calls.some(x=>x.request),false);
  }
  const wrong=harness({run,connection_stamp:{generation:7},capability_snapshot:snapshot},
    {object:'hermes.run',run_id:'run_other',status:'running'});
  await assert.rejects(runRead({id:'local-1'},wrong.context),{code:'unavailable'});
});
test('prepare binds principal, audience, generation and frozen input before any POST',async()=>{
  const h=harness({connection_stamp:{generation:7},capability_snapshot:snapshot});
  const result=await runPrepare({requestKey:'prepare-1',input:'Summarize a document'},h.context);
  assert.deepEqual(result.output,{id:'execution-1',status:'prepared',revision:1});
  const values=h.calls.find(x=>x.create==='run').value.values;
  assert.equal(values.principal_id,'owner-1');assert.equal(values.audience,'app');
  assert.equal(values.connection_generation,7);assert.equal(values.input,'Summarize a document');
  assert.equal(h.calls.some(x=>x.request),false);
  const stale=harness({connection_stamp:{generation:8},capability_snapshot:snapshot});
  await assert.rejects(runPrepare({requestKey:'p',input:'x'},stale.context),{code:'unavailable'});
});
test('submit sends frozen input once, keys by local id and preserves unknown without a plan',async()=>{
  const prepared={...run,status:'prepared',remote_id:null,input:'Frozen prompt',revision:1};
  const h=harness({run:prepared,connection_stamp:{generation:7},capability_snapshot:snapshot});
  h.context.connector.mutate=async request=>{h.calls.push({mutation:request});
    return {kind:'ok',status:202,body:{run_id:'run_1',status:'started'}};};
  const result=await runSubmit({id:'local-1',requestKey:'local-1',revision:1},h.context);
  assert.deepEqual(result.output,{id:'local-1',remoteId:'run_1',status:'started',revision:2});
  assert.deepEqual(h.calls.find(x=>x.mutation).mutation.fields,{input:'Frozen prompt'});
  assert.equal(h.calls.find(x=>x.patch).value.compare.expected,1);
  const lost=harness({run:prepared,connection_stamp:{generation:7},capability_snapshot:snapshot});
  lost.context.connector.mutate=async()=>({kind:'error',code:'outcome_unknown'});
  await assert.rejects(runSubmit({id:'local-1',requestKey:'local-1',revision:1},lost.context),{code:'unknown'});
  assert.equal(lost.calls.some(x=>x.patch),false);
  const collision=harness({run:prepared,connection_stamp:{generation:7},capability_snapshot:snapshot});
  await assert.rejects(runSubmit({id:'local-1',requestKey:'different',revision:1},collision.context),{code:'invalid_input'});
  assert.equal(collision.calls.some(x=>x.mutation),false);
});
test('stop records stopping, never terminal; foreign and stale runs cannot call provider',async()=>{
  const h=harness({run,connection_stamp:{generation:7},capability_snapshot:snapshot});
  h.context.connector.mutate=async request=>{h.calls.push({mutation:request});
    return {kind:'ok',status:202,body:{status:'stopping'}};};
  const result=await runStop({id:'local-1',requestKey:'local-1:stop',revision:2},h.context);
  assert.equal(result.output.status,'stopping');
  assert.equal(h.calls.find(x=>x.mutation).mutation.id,'run_1');
  const foreign=harness({run:{...run,principal_id:'other'},connection_stamp:{generation:7},capability_snapshot:snapshot});
  await assert.rejects(runStop({id:'local-1',requestKey:'local-1:stop',revision:2},foreign.context),{code:'not_found'});
  assert.equal(foreign.calls.some(x=>x.mutation),false);
  const disabled=harness({run,connection_stamp:{generation:7},capability_snapshot:{...snapshot,run_stop:false}});
  await assert.rejects(runStop({id:'local-1',requestKey:'local-1:stop',revision:2},disabled.context),{code:'unavailable'});
  assert.equal(disabled.calls.some(x=>x.mutation),false);
});
