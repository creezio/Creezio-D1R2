import test from 'node:test';
import assert from 'node:assert/strict';
import {n8nConnectorDescriptor,n8nWebhookDescriptor} from '../../module/storage.ts';
import {webhookConfigSet,webhookKeySet,webhookKeyRevoke} from '../../module/webhook.ts';
import {runPrepare,runRead,runTrigger,runRefresh} from '../../module/runs.ts';

const hook={id:'n8n.webhook.v1',origin:'https://n8n.example.invalid',path_id:'production-1',
  workflow_id:'wf-1',key_ref:'webhook-ref',secret_version:1,enabled:true,revision:4,
  updated_at:'2026-09-30T00:00:00.000Z'};
const api={id:'n8n.api.v1',origin:'https://n8n.example.invalid',key_ref:'api-ref',
  secret_version:1,enabled:true,revision:3,updated_at:'2026-09-30T00:00:00.000Z'};
const run={id:'run-1',principal_id:'owner-1',audience:'app',workflow_id:'wf-1',path_id:'production-1',
  webhook_origin:'https://n8n.example.invalid',webhook_revision:4,input:{sample:'synthetic'},
  status:'prepared',remote_execution_id:null,remote_status:null,revision:1,
  created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
const harness=(rows={webhook_config:hook,connector_config:api,run},reply={kind:'ok',status:200,
  body:{intentId:'run-1',executionId:'ex-1'}})=>{
  const calls=[];
  const context={principalId:'owner-1',audience:'app',executionId:'run-2',signal:new AbortController().signal,
    data:{async get(name){return rows[name]??null;},
      planCreate(name,args){calls.push({create:{name,args}});return {kind:'create'};},
      planGet(name,args){calls.push({get:{name,args}});return {kind:'get'};},
      planPatch(name,args){calls.push({patch:{name,args}});return {kind:'patch'};}},
    providerSecrets:{async preparePut(args){calls.push({put:args});return {reference:'webhook-ref',version:1,
      plan:{kind:'vault'}};},async prepareReplace(args){calls.push({replace:args});
      return {reference:args.reference,version:2,plan:{kind:'vault'}};},
      async prepareRevoke(args){calls.push({revoke:args});return {plan:{kind:'vault'}};}},
    connector:{async mutate(args){calls.push({mutate:args});return reply;},
      async request(args){calls.push({request:args});return {kind:'ok',status:200,
        body:{id:'ex-1',workflowId:'wf-1',status:'success',data:{credential:'hidden'}}};}}};
  return {context,calls};
};
test('webhook production descriptor never carries the n8n API credential',()=>{
  assert.equal(n8nConnectorDescriptor.auth.name,'X-N8N-API-KEY');
  assert.equal(n8nWebhookDescriptor.auth.name,'X-Creezio-Webhook-Key');
  assert.equal(n8nWebhookDescriptor.vault.modelId,'webhook_secret');
  assert.deepEqual(n8nWebhookDescriptor.resources.map(item=>[item.method,item.path]),
    [['POST','/webhook/{id}']]);
  assert.ok(!JSON.stringify(n8nWebhookDescriptor).includes('X-N8N-API-KEY'));
  assert.ok(!JSON.stringify(n8nWebhookDescriptor).includes('/webhook-test/'));
});
test('webhook configuration enforces one safe path segment and distinct vault plans',async()=>{
  const h=harness({webhook_config:null});
  const created=await webhookConfigSet({origin:'https://N8N.example.invalid/',pathId:'production-1',
    workflowId:'wf-1',enabled:false,revision:0},h.context);
  assert.equal(created.output.config.origin,'https://n8n.example.invalid');
  for(const pathId of ['bad/path','../admin','a?key=x','']){
    await assert.rejects(webhookConfigSet({origin:hook.origin,pathId,workflowId:'wf-1',
      enabled:false,revision:4},harness().context),{code:'invalid_input'});
  }
  const keyed=harness();
  const result=await webhookKeySet({webhookKey:'synthetic-webhook-key',revision:4},keyed.context);
  assert.equal(keyed.calls[0].replace.providerId,'n8n.webhook.v1');
  assert.equal(keyed.calls[1].patch.name,'webhook_config');
  assert.equal(result.plans.length,2);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-webhook-key|webhook-ref/u);
  const revoked=harness();
  await webhookKeyRevoke({revision:4},revoked.context);
  assert.equal(revoked.calls[0].revoke.providerId,'n8n.webhook.v1');
  assert.equal(revoked.calls[1].patch.args.values.enabled,false);
});
test('intent is immutable, owned, and accepted only by exact correlated response',async()=>{
  const prepared=harness();
  const value=await runPrepare({input:{sample:'synthetic'}},prepared.context);
  assert.equal(value.output.run.id,'run-2');
  assert.equal(prepared.calls[0].create.args.values.webhook_revision,4);
  assert.deepEqual(prepared.calls[0].create.args.values.input,{sample:'synthetic'});
  await assert.rejects(runPrepare({input:{}},harness({webhook_config:hook,
    connector_config:{...api,origin:'https://other.example'},run}).context),{code:'unavailable'});
  const triggered=harness();
  const accepted=await runTrigger({id:'run-1',revision:1,requestKey:'run-1'},triggered.context);
  assert.equal(accepted.output.run.status,'accepted');
  assert.equal(accepted.output.run.remoteExecutionId,'ex-1');
  assert.equal(triggered.calls.filter(item=>item.mutate).length,1);
  assert.deepEqual(triggered.calls[0].mutate.fields,{intentId:'run-1',workflowId:'wf-1',input:run.input});
  assert.deepEqual(triggered.calls[1].get.args.where,{revision:3,origin:api.origin,
    enabled:true,key_ref:api.key_ref,secret_version:api.secret_version});
  assert.equal(triggered.calls[2].patch.args.compare.expected,1);
  await assert.rejects(runTrigger({id:'run-1',revision:1,requestKey:'different'},harness().context),
    {code:'invalid_input'});
  const wrong=harness(undefined,{kind:'ok',status:200,body:{intentId:'other',executionId:'ex-1'}});
  await assert.rejects(runTrigger({id:'run-1',revision:1,requestKey:'run-1'},wrong.context),
    {code:'unknown'});
  assert.equal(wrong.calls.filter(item=>item.mutate).length,1);
  assert.equal(wrong.calls.filter(item=>item.patch).length,0);
  await assert.rejects(runRead({id:'run-1'},harness({...{webhook_config:hook,connector_config:api},
    run:{...run,principal_id:'other'}}).context),{code:'not_found'});
});
test('timeout is unknown with one POST; stale webhook revision and uncorrelated run refuse egress',async()=>{
  const uncertain=harness(undefined,{kind:'error',code:'outcome_unknown'});
  await assert.rejects(runTrigger({id:'run-1',revision:1,requestKey:'run-1'},uncertain.context),
    {code:'unknown'});
  assert.equal(uncertain.calls.filter(item=>item.mutate).length,1);
  assert.equal(uncertain.calls.filter(item=>item.patch).length,0);
  const empty2xx=harness(undefined,{kind:'error',code:'remote_error',status:204});
  await assert.rejects(runTrigger({id:'run-1',revision:1,requestKey:'run-1'},empty2xx.context),
    {code:'unknown'});
  assert.equal(empty2xx.calls.filter(item=>item.mutate).length,1);
  const stale=harness({webhook_config:{...hook,revision:5},connector_config:api,run});
  await assert.rejects(runTrigger({id:'run-1',revision:1,requestKey:'run-1'},stale.context),
    {code:'unavailable'});
  assert.equal(stale.calls.length,0);
  const uncorrelated=harness();
  await assert.rejects(runRefresh({id:'run-1',revision:1},uncorrelated.context),{code:'conflict'});
  assert.equal(uncorrelated.calls.length,0);
});
test('follow-up GET is tied to owned run, API origin and exact workflow ID',async()=>{
  const accepted={...run,status:'accepted',remote_execution_id:'ex-1',revision:2};
  const h=harness({webhook_config:hook,connector_config:api,run:accepted});
  const result=await runRefresh({id:'run-1',revision:2},h.context);
  assert.equal(result.output.run.remoteStatus,'success');
  assert.equal(h.calls[0].request.resource,'execution');
  assert.equal(h.calls[1].patch.name,'run');
  const different=harness({webhook_config:hook,connector_config:{...api,origin:'https://other.example'},run:accepted});
  await assert.rejects(runRefresh({id:'run-1',revision:2},different.context),{code:'unavailable'});
  assert.equal(different.calls.length,0);
  const wrong=harness({webhook_config:hook,connector_config:api,run:accepted});
  wrong.context.connector.request=async()=>({kind:'ok',status:200,
    body:{id:'ex-1',workflowId:'another',status:'success'}});
  await assert.rejects(runRefresh({id:'run-1',revision:2},wrong.context),{code:'unavailable'});
});
