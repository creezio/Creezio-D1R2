import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema,inspectCompositionSchema,inspectManagedSchema}
  from '../../scripts/data/apply-schema.mjs';
import {installComposed} from '../../scripts/data/install-composition.mjs';
import {runLocalSchema} from '../../scripts/local/schema.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {initializeStorageRouteDeny,markStorageSourceAttempted,confirmStorageSource,
  reopenStorageRoute} from '../../core/storage-authority/coordinator.ts';

const json = file => JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const moduleId='creezio.modules-settings';
const installationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const resources=[
  {contextId:'tenant-a',slot:1,status:'active',databaseId:'schema-a',databaseName:'schema-a',bucketName:'schema-a-files'},
  {contextId:'tenant-b',slot:2,status:'active',databaseId:'schema-b',databaseName:'schema-b',bucketName:'schema-b-files'}];
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const credentials={loginIdentifier:'owner@example.invalid',displayName:'Owner',
  password:'Synthetic schema routed password'};
function planFor(includeOutcome){
  const composition=json('../../configuration/composition.json');
  const lock=json('../../configuration/composition.lock.json');
  const access=json('../../extensions/native/access/module/manifest.json');
  const module=JSON.parse(JSON.stringify(access).replaceAll('creezio.access',moduleId));
  const models=json('../../extensions/native/modules-settings/module/models.json');
  module.contracts.models=models.filter(item=>includeOutcome||item.id!=='plan-outcomes')
    .map(item=>({...item,permissions:[]}));
  module.contracts.schemas=[];module.contracts.permissions=[];module.contracts.operations=[];
  module.contracts.api=[];module.contracts.mcp={tools:[],resources:[],prompts:[],skills:[]};
  module.contracts.ui={...module.contracts.ui,views:[],navigation:[],slots:[],styles:[]};
  const selection={...structuredClone(composition.modules[0]),moduleId,origin:module.identity.origin};
  const node={...structuredClone(lock.modules[0]),moduleId,origin:module.identity.origin,
    contractIntegrity:contractIntegrity(module)};
  composition.modules=[composition.modules[0],selection];
  lock.modules=[lock.modules[0],node];
  composition.exposure.admin.moduleIds=['creezio.access'];
  composition.exposure.app.moduleIds=['creezio.access'];
  lock.compositionIntegrity=contractIntegrity(composition);
  return compileCompositionSchema({composition,lock,modules:[access,module]});
}
async function fixture(t){
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{DB:'schema-primary',A:'schema-a',B:'schema-b'},
    d1Persist:false,telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  t.after(async()=>mf.dispose());
  const primary=await mf.getD1Database('DB'),a=await mf.getD1Database('A'),b=await mf.getD1Database('B');
  const before=planFor(false),next=planFor(true);
  assert.equal((await installComposed(primary,before,{credentials,
    expectedPlanDigest:before.planDigest,createSchema:true})).ok,true);
  for(const db of [a,b])assert.equal((await applyCompositionSchema(db,before,
    {expectedPlanDigest:before.planDigest})).ok,true);
  const source=await primary.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
    WHERE id='application'`).first();
  for(const [index,db] of [a,b].entries()){
    const resource=resources[index],input={installationId,contextId:resource.contextId,
      slot:resource.slot,expectedGeneration:1,mutationId:`initial-${resource.contextId}`,
      commandDigest:`sha256-${String(index+1).repeat(64)}`};
    await initializeStorageRouteDeny(primary,db,input,source.epoch);
    await markStorageSourceAttempted(primary,input);
    await confirmStorageSource(primary,input,async()=>true);
    await reopenStorageRoute(primary,db,input,source.epoch);
  }
  const map=new Map([['application',primary],['tenant-a',a],['tenant-b',b]]);
  const calls={opened:[],released:0,approvals:0};
  const config={root:'unused',storageInstallationId:installationId,storageResources:resources,
    bindings:{database:'DB',databaseId:'schema-primary'}};
  const io={interactive:true,write(){},async readLine(){calls.approvals++;return next.planDigest;}};
  const adapter=async(_config,contextId)=>{calls.opened.push(contextId);
    return {db:map.get(contextId),async dispose(){}};};
  const lock=async(_config,purpose)=>({purpose,async release(){calls.released++;}});
  const engine={loadComposedInstallPlan:async()=>next,applyCompositionSchema,
    inspectCompositionSchema,inspectManagedSchema};
  const run=mode=>runLocalSchema({mode,config,io,adapter,lock,engine});
  const states=async()=>Promise.all([a,b].map(db=>db.prepare(`SELECT state,generation FROM ${routes}`).first()));
  return {primary,a,b,before,next,engine,calls,config,run,states};
}

test('routed schema closes both routes before every DDL and preserves records',
  {timeout:60000},async t=>{
  const f=await fixture(t),attempts=[];
  const original=f.engine.applyCompositionSchema;
  f.engine.applyCompositionSchema=async(db,...args)=>{
    const states=await f.states();
    attempts.push({db,states});
    assert.deepEqual(states.map(item=>item.state),['deny','deny']);
    return original(db,...args);
  };
  const preview=await f.run('inspect');
  assert.equal(preview.ok,true,JSON.stringify(preview));
  assert.deepEqual((await f.states()).map(item=>item.state),['active','active']);
  const result=await f.run('apply');
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.code,'schema.applied');
  assert.equal(attempts.length,3);
  assert.deepEqual((await f.states()).map(item=>item.state),['active','active']);
  for(const db of [f.primary,f.a,f.b]){
    assert.equal((await inspectCompositionSchema(db,f.next)).state,'ready');
    assert.equal((await inspectManagedSchema(db)).receipt.planDigest,f.next.planDigest);
  }
  assert.equal((await f.run('apply')).code,'schema.current');
});

for(const [position,name] of ['application','tenant-a','tenant-b'].entries())
  for(const stage of ['before','after'])test(`routed schema resumes ${stage} DDL acknowledgement at ${name}`,
    {timeout:60000},async t=>{
    const f=await fixture(t),dbs=[f.primary,f.a,f.b],original=f.engine.applyCompositionSchema;
    let interrupted=false;
    f.engine.applyCompositionSchema=async(db,...args)=>{
      if(db===dbs[position]&&!interrupted){
        interrupted=true;
        if(stage==='before')throw new Error('DDL interrupted before call');
        await original(db,...args);
        throw new Error('DDL acknowledgement lost');
      }
      return original(db,...args);
    };
    const first=await f.run('apply');
    assert.deepEqual({ok:first.ok,effect:first.effect},{ok:false,effect:'unknown'});
    assert.deepEqual((await f.states()).map(item=>item.state),['deny','deny']);
    assert.equal((await inspectManagedSchema(dbs[position])).receipt.planDigest,
      stage==='after'?f.next.planDigest:f.before.planDigest);
    const resumed=await f.run('apply');
    assert.equal(resumed.ok,true,JSON.stringify(resumed));
    assert.deepEqual((await f.states()).map(item=>item.state),['active','active']);
    for(const db of dbs)assert.equal((await inspectManagedSchema(db)).receipt.planDigest,f.next.planDigest);
  });

test('routed schema leaves every route denied when one target cannot prove the new receipt',
  {timeout:60000},async t=>{
  const f=await fixture(t),original=f.engine.applyCompositionSchema;
  f.engine.applyCompositionSchema=async(db,...args)=>db===f.b
    ?{ok:false,code:'schema.outcome-unknown',effect:'unknown'}:original(db,...args);
  const first=await f.run('apply');
  assert.deepEqual({ok:first.ok,effect:first.effect},{ok:false,effect:'unknown'});
  assert.deepEqual((await f.states()).map(item=>item.state),['deny','deny']);
  assert.equal((await inspectManagedSchema(f.primary)).receipt.planDigest,f.next.planDigest);
  assert.equal((await inspectManagedSchema(f.b)).receipt.planDigest,f.before.planDigest);
  f.engine.inspectCompositionSchema=async(db,...args)=>db===f.b
    ?{state:'blocked',code:'schema.foreign',additions:[],columnAdditions:[]}:inspectCompositionSchema(db,...args);
  const refusal=await f.run('apply');
  assert.equal(refusal.code,'schema_blocked');
  assert.deepEqual((await f.states()).map(item=>item.state),['deny','deny']);
});

test('routed schema cannot resume against a changed physical inventory',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  f.engine.applyCompositionSchema=async()=>{throw new Error('before first DDL');};
  assert.equal((await f.run('apply')).effect,'unknown');
  assert.deepEqual((await f.states()).map(item=>item.state),['deny','deny']);
  f.config.storageResources=resources.map(item=>item.contextId==='tenant-b'
    ?{...item,databaseId:'other-database'}:item);
  const refused=await f.run('apply');
  assert.equal(refused.code,'route_unconfirmed');
  assert.deepEqual((await f.states()).map(item=>item.state),['deny','deny']);
});

test('an already reopened route never permits further DDL if another receipt drifts',
  {timeout:60000},async t=>{
  const f=await fixture(t),prior=await inspectManagedSchema(f.b);
  assert.equal((await f.run('apply')).ok,true);
  const originalManaged=f.engine.inspectManagedSchema;
  const originalSchema=f.engine.inspectCompositionSchema;
  let attempted=0;
  f.engine.inspectManagedSchema=async db=>db===f.b?prior:originalManaged(db);
  f.engine.inspectCompositionSchema=async(db,...args)=>db===f.b
    ?{state:'additive',code:'schema.approval-required',additions:[],columnAdditions:[]}:originalSchema(db,...args);
  f.engine.applyCompositionSchema=async()=>{attempted++;throw new Error('must not apply');};
  const result=await f.run('apply');
  assert.deepEqual({code:result.code,effect:result.effect},
    {code:'schema_provenance',effect:'none'});
  assert.equal(attempted,0);
  assert.deepEqual((await f.states()).map(item=>item.state),['active','active']);
});
