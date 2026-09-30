import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {canonicalOrigin,configRead,configSet,configKeySet,configKeyRevoke,
  workflowList,workflowRead,executionList,connectionCheck} from '../../module/service.ts';
import {n8nConnectorDescriptor,n8nWebhookDescriptor} from '../../module/storage.ts';

const row={id:'n8n.api.v1',origin:'https://example.n8n.cloud',key_ref:'creezio-secret:v1:00000000-0000-4000-8000-000000000001',
  secret_version:1,enabled:true,revision:4,updated_at:'2026-09-28T00:00:00.000Z'};
function harness(initial=row,response={data:[],nextCursor:null},webhook=null){
  const calls=[],plans=[];
  return {calls,plans,context:{signal:new AbortController().signal,
    data:{async get(name){assert.ok(['connector_config','webhook_config'].includes(name));
      return name==='connector_config'?initial:webhook;},
      planPatch(name,args){calls.push({name,args});const plan={kind:'plan',id:plans.length};plans.push(plan);return plan;},
      planCreate(name,args){calls.push({name,args});const plan={kind:'plan',id:plans.length};plans.push(plan);return plan;}},
    providerSecrets:{async preparePut(args){calls.push({secret:args});return {plan:{kind:'secret-plan'},
      reference:'creezio-secret:v1:00000000-0000-4000-8000-000000000002',version:1};},
      async prepareReplace(args){calls.push({secret:args});return {plan:{kind:'secret-plan'},
        reference:args.reference,version:2};},async prepareRevoke(args){calls.push({revoke:args});
        return {plan:{kind:'secret-plan'},version:2};}},
    connector:{async request(args){calls.push({request:args});return {kind:'ok',status:200,body:response};}}}};
}
test('context models and fixed n8n resources use no arbitrary method or URL',()=>{
  assert.ok(manifest.contracts.models.every(model=>
    JSON.stringify(model.primaryKey)===JSON.stringify(['context_id','id'])));
  assert.deepEqual(n8nConnectorDescriptor.resources.map(resource=>[resource.id,resource.method,resource.path]),[
    ['workflows','GET','/api/v1/workflows'],['workflow','GET','/api/v1/workflows/{id}'],
    ['executions','GET','/api/v1/executions'],['execution','GET','/api/v1/executions/{id}']]);
  assert.deepEqual(n8nConnectorDescriptor.auth,{kind:'api-key-header',name:'X-N8N-API-KEY'});
  assert.deepEqual(manifest.contracts.connectors,[n8nConnectorDescriptor,n8nWebhookDescriptor]);
});
test('config origin is canonical HTTPS and forbids local or credential URLs',()=>{
  assert.equal(canonicalOrigin('https://EXAMPLE.n8n.cloud/'),'https://example.n8n.cloud');
  for(const value of ['http://example.com','https://localhost','https://127.0.0.1',
    'https://[::1]','https://user:pass@example.com','https://example.com/other',
    'https://example.com/?x=1','https://example.com/#fragment'])
    assert.throws(()=>canonicalOrigin(value),{code:'invalid_input'},value);
});
test('configuration and key changes use revision CAS, atomic vault plans, no secret output',async()=>{
  const empty=harness(null);
  const created=await configSet({requestKey:'a',origin:'https://EXAMPLE.n8n.cloud/',enabled:false,revision:0},empty.context);
  assert.equal(empty.calls[0].args.values.origin,'https://example.n8n.cloud');
  assert.equal(created.output.config.revision,1);
  await assert.rejects(configSet({requestKey:'a',origin:row.origin,enabled:true,revision:3},
    harness(row).context),{code:'conflict'});
  await assert.rejects(configSet({requestKey:'a',origin:'https://other.example',enabled:true,revision:4},
    harness(row).context),{code:'conflict'});
  const disabledWithKey={...row,enabled:false};
  const guarded=harness(disabledWithKey);
  await assert.rejects(configSet({requestKey:'different-origin',origin:'https://other.example',
    enabled:false,revision:4},guarded.context),{code:'conflict'});
  assert.equal(guarded.calls.length,0,'a sealed key cannot be redirected by disabling the connection');
  const withoutKey=harness({...disabledWithKey,key_ref:null,secret_version:null});
  const changedOrigin=await configSet({requestKey:'after-revoke',origin:'https://other.example',
    enabled:false,revision:4},withoutKey.context);
  assert.equal(changedOrigin.output.config.origin,'https://other.example');
  const rotated=harness(row),secret='synthetic-secret-only';
  const changed=await configKeySet({requestKey:'k',apiKey:secret,revision:4},rotated.context);
  assert.equal(changed.plans.length,2);
  assert.equal(rotated.calls[0].secret.providerId,'n8n.api.v1');
  assert.equal(rotated.calls[1].args.compare.expected,4);
  assert.doesNotMatch(JSON.stringify(changed),/synthetic-secret-only|creezio-secret/u);
  const revoked=harness(row),after=await configKeyRevoke({requestKey:'r',revision:4},revoked.context);
  assert.equal(after.plans.length,2);assert.equal(after.output.config.enabled,false);
  assert.equal(after.output.config.hasKey,false);
  assert.deepEqual(revoked.calls[0].revoke,{providerId:'n8n.api.v1',reference:row.key_ref,expectedVersion:1});
  assert.equal(revoked.calls[1].args.compare.expected,4);
  assert.doesNotMatch(JSON.stringify(await configRead({},harness(row).context)),/creezio-secret/u);
});
test('disabling or revoking API atomically disarms an enabled webhook by revision CAS',async()=>{
  const hook={id:'n8n.webhook.v1',enabled:true,revision:7};
  const disabled=harness(row,undefined,hook);
  const changed=await configSet({requestKey:'disable',origin:row.origin,enabled:false,revision:4},
    disabled.context);
  assert.equal(changed.plans.length,2);
  assert.deepEqual(disabled.calls.map(call=>call.name),['connector_config','webhook_config']);
  assert.equal(disabled.calls[1].args.compare.expected,7);
  assert.equal(disabled.calls[1].args.values.enabled,false);
  const revoked=harness(row,undefined,hook);
  const result=await configKeyRevoke({requestKey:'revoke',revision:4},revoked.context);
  assert.equal(result.plans.length,3);
  assert.deepEqual(revoked.calls.filter(call=>call.name).map(call=>call.name),
    ['connector_config','webhook_config']);
  assert.equal(revoked.calls.at(-1).args.compare.expected,7);
  assert.equal(revoked.calls.at(-1).args.values.enabled,false);
});
test('workflows and executions project metadata only and preserve opaque cursors without loss',async()=>{
  const full=Array.from({length:521},(_,i)=>({id:String(i+1),name:`Workflow ${i} <script>`,active:i%2===0,
    isArchived:false,createdAt:'2026-09-28T00:00:00.000Z',updatedAt:'2026-09-28T00:00:00.000Z',
    versionId:'v-1',nodes:[{credentials:{password:'never-return'}}],pinData:{secret:'hidden'}}));
  let seen=[],cursor,remoteCalls=0;
  do{
    const start=cursor===undefined?0:Number(cursor),items=full.slice(start,start+25);
    const h=harness(row,{data:items,nextCursor:start+25<full.length?String(start+25):null});
    const result=await workflowList({limit:25,...(cursor?{cursor}:{})},h.context);
    remoteCalls++;seen.push(...result.output.items.map(item=>item.id));
    assert.ok(Buffer.byteLength(JSON.stringify(result.output))<65536);
    assert.doesNotMatch(JSON.stringify(result.output),/never-return|hidden|nodes|pinData/u);
    assert.equal(h.calls.filter(call=>call.request).length,1);
    cursor=result.output.nextCursor??undefined;
  }while(cursor);
  assert.equal(remoteCalls,21);assert.deepEqual(seen,full.map(item=>item.id));
  const one=harness(row,{...full[0],staticData:{token:'do-not-return'}});
  const detail=await workflowRead({id:'1'},one.context);
  assert.equal(detail.output.workflow.id,'1');
  assert.doesNotMatch(JSON.stringify(detail.output),/staticData|do-not-return/u);
  const e=harness(row,{data:[{id:'55',workflowId:'1',status:'success',mode:'trigger',
    startedAt:null,stoppedAt:null,data:{body:'private'},workflowData:{credentials:'private'}}],nextCursor:null});
  const executions=await executionList({limit:1},e.context);
  assert.deepEqual(executions.output.items.map(item=>item.id),['55']);
  assert.doesNotMatch(JSON.stringify(executions.output),/private|workflowData/u);
});
test('remote failures remain expurgated and malformed pages fail without truncation',async()=>{
  const h=harness();h.context.connector.request=async()=>({kind:'error',code:'remote_auth',status:401});
  await assert.rejects(workflowList({limit:1},h.context),{code:'unavailable'});
  const invalid=harness(row,{data:[{id:'1',name:'x',active:true}],nextCursor:'x'.repeat(3000)});
  await assert.rejects(workflowList({limit:1},invalid.context),{code:'unavailable'});
  const tooMany=harness(row,{data:Array.from({length:26},(_,i)=>({id:String(i),name:'n',active:true})),nextCursor:null});
  await assert.rejects(workflowList({limit:25},tooMany.context),{code:'unavailable'});
  const check=harness();assert.deepEqual((await connectionCheck({},check.context)).output,{reachable:true});
  assert.equal(check.calls.filter(call=>call.request).length,1);
});
test('in-flight key revocation and non-progressing pagination reject without leaking stale data',async()=>{
  const h=harness(row,{data:[{id:'1',name:'Private',active:true}],nextCursor:null});
  let connected=row;
  h.context.data.get=async()=>connected;
  h.context.connector.request=async()=>{
    connected={...row,enabled:false,revision:5,key_ref:null,secret_version:null};
    return {kind:'ok',status:200,body:{data:[{id:'1',name:'Private',active:true}],nextCursor:null}};
  };
  await assert.rejects(workflowList({limit:1},h.context),{code:'conflict'});
  const looping=harness(row,{data:[{id:'1',name:'Safe',active:true}],nextCursor:'cursor-a'});
  await assert.rejects(workflowList({limit:1,cursor:'cursor-a'},looping.context),{code:'unavailable'});
  const empty=harness(row,{data:[],nextCursor:'cursor-b'});
  await assert.rejects(workflowList({limit:1},empty.context),{code:'unavailable'});
  const invalid=harness(row);
  await assert.rejects(workflowList({limit:1,cursor:'bad\nheader'},invalid.context),{code:'invalid_input'});
  assert.equal(invalid.calls.length,0);
});
test('maximal escaped metadata fits the engine output budget or fails explicitly',async()=>{
  const name='"\\'.repeat(2048);
  const data=Array.from({length:25},(_,i)=>({id:`wf-${i}`,name,active:true,
    isArchived:false,createdAt:null,updatedAt:null,versionId:null}));
  const h=harness(row,{data,nextCursor:'next'});
  const value=await workflowList({limit:25},h.context);
  assert.equal(value.output.items.length,25);
  assert.ok(Buffer.byteLength(JSON.stringify(value.output))<220_000);
  const invalid=harness(row,{data:[{...data[0],name:'x'.repeat(4097)}],nextCursor:null});
  await assert.rejects(workflowList({limit:1},invalid.context),{code:'unavailable'});
});
