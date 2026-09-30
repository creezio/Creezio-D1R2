import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {inspectCompositionSchema,inspectManagedSchema,applyCompositionSchema}
  from '../../scripts/data/apply-schema.mjs';
import {inspectComposedInstallation,installComposed} from '../../scripts/data/install-composition.mjs';
import {runLocalInstallation} from '../../scripts/local/install.mjs';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const plan=await loadCompositionSchema({root,compositionPath:'configuration/composition.widgets-local.json'});
const installationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const resources=[
  {contextId:'tenant-a',slot:1,status:'active',databaseId:'routed-a',databaseName:'routed-a',bucketName:'routed-a-files'},
  {contextId:'tenant-b',slot:2,status:'active',databaseId:'routed-b',databaseName:'routed-b',bucketName:'routed-b-files'}];
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const password='Synthetic routed installation password';

async function fixture(t){
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{DB:'routed-primary',A:'routed-a',B:'routed-b'},
    r2Buckets:{BUCKET:'routed-primary-files',A_FILES:'routed-a-files',B_FILES:'routed-b-files'},
    d1Persist:false,telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  t.after(async()=>mf.dispose());
  const primary=await mf.getD1Database('DB'),a=await mf.getD1Database('A'),b=await mf.getD1Database('B');
  const map=new Map([['application',primary],['tenant-a',a],['tenant-b',b]]);
  const buckets=new Map([['application',await mf.getR2Bucket('BUCKET')],
    ['tenant-a',await mf.getR2Bucket('A_FILES')],['tenant-b',await mf.getR2Bucket('B_FILES')]]);
  const calls={opened:[],disposed:[],locked:[],released:0,reads:0};
  const config={root,storageInstallationId:installationId,storageResources:resources,
    bindings:{database:'DB',databaseId:'routed-primary'}};
  const io={interactive:true,write(){},async readLine(){calls.reads++;return 'owner@example.invalid';},
    async readSecret(){return password;},async confirm(){return true;}};
  const adapter=async(_config,contextId)=>{
    calls.opened.push(contextId);return {db:map.get(contextId),bucket:buckets.get(contextId),
      async dispose(){calls.disposed.push(contextId);}};
  };
  const lock=async(_config,purpose)=>{calls.locked.push(purpose);
    return {async release(){calls.released++;}};};
  const engine={loadComposedInstallPlan:async()=>plan,inspectComposedInstallation,
    installComposed,inspectCompositionSchema,inspectManagedSchema,applyCompositionSchema};
  const run=mode=>runLocalInstallation({mode,config,io,adapter,lock,engine});
  return {primary,a,b,buckets,calls,engine,run};
}

test('routed local install bootstraps only primary, receipts every D1 and opens exact routes',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  const first=await f.run('install');
  assert.equal(first.ok,true,JSON.stringify(first));
  assert.deepEqual(first.receipts.map(item=>item.contextId),['tenant-a','tenant-b']);
  assert.equal((await f.primary.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,1);
  for(const db of [f.a,f.b]){
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,0);
    assert.equal((await inspectCompositionSchema(db,plan)).state,'ready');
    const row=await db.prepare(`SELECT state,generation,installation_id AS installationId
      FROM ${routes}`).first();
    assert.deepEqual({state:row.state,generation:row.generation,installationId:row.installationId},
      {state:'active',generation:2,installationId});
  }
  assert.deepEqual(f.calls.opened,['application','tenant-a','tenant-b']);
  assert.equal(f.calls.disposed.length,3);assert.equal(f.calls.released,1);
  const repeat=await f.run('install');
  assert.equal(repeat.ok,true,JSON.stringify(repeat));
  assert.equal(f.calls.reads,2,'resume never asks for another administrator');
  assert.equal((await f.primary.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,1);
  await f.a.prepare(`INSERT INTO "${STORAGE_AUTHORITY_TABLES.storage_source_receipts}"
    (id,command_digest,kind,target_id,effect,created_at_ms)
    VALUES ('owned-data','sha256-${'a'.repeat(64)}','test','tenant-a','no-op',0)`).run();
  await f.buckets.get('tenant-a').put('owned.txt','preserved');
  assert.equal((await f.run('install')).ok,true,'exact source journal and route permit a data-bearing resume');
  assert.equal(await (await f.buckets.get('tenant-a').get('owned.txt')).text(),'preserved');
  await f.a.prepare(`UPDATE ${routes} SET mutation_id='foreign' WHERE id='tenant-a'`).run();
  assert.deepEqual(await f.run('install'),{ok:false,code:'target_unproven',effect:'none'});
  assert.equal(f.calls.reads,2);
});

test('routed install resumes a lost target DDL acknowledgement without another bootstrap',
  {timeout:60000},async t=>{
  const f=await fixture(t),apply=f.engine.applyCompositionSchema;
  let lost=true;
  f.engine.applyCompositionSchema=async(db,...args)=>{
    const result=await apply(db,...args);
    if(db===f.b&&lost){lost=false;throw new Error('DDL ACK lost');}
    return result;
  };
  const first=await f.run('install');
  assert.deepEqual({ok:first.ok,effect:first.effect},{ok:false,effect:'unknown'});
  assert.equal((await f.b.prepare(`SELECT * FROM ${routes}`).first()),null);
  const resumed=await f.run('install');
  assert.equal(resumed.ok,true,JSON.stringify(resumed));
  assert.equal(f.calls.reads,2);
  assert.equal((await f.primary.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,1);
});

test('populated managed D1 is refused before any primary bootstrap or target change',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  const adopted=await applyCompositionSchema(f.a,plan,{expectedPlanDigest:plan.planDigest});
  assert.equal(adopted.ok,true);
  await f.a.prepare(`INSERT INTO "${STORAGE_AUTHORITY_TABLES.storage_source_receipts}"
    (id,command_digest,kind,target_id,effect,created_at_ms)
    VALUES ('foreign','sha256-${'a'.repeat(64)}','foreign','other','no-op',0)`).run();
  assert.equal((await inspectCompositionSchema(f.a,plan)).state,'ready');
  const result=await f.run('install');
  assert.deepEqual(result,{ok:false,code:'target_unproven',effect:'none'});
  assert.equal(f.calls.reads,0);
  assert.equal((await inspectComposedInstallation(f.primary,plan)).state,'fresh');
  assert.equal((await inspectComposedInstallation(f.b,plan)).state,'fresh');
  assert.equal((await f.a.prepare(`SELECT COUNT(*) AS n FROM ${routes}`).first()).n,0);
});

test('nonempty R2 target is refused before primary bootstrap or D1 DDL',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  await f.buckets.get('tenant-b').put('foreign.txt','preserve');
  const result=await f.run('install');
  assert.deepEqual(result,{ok:false,code:'target_unproven',effect:'none'});
  assert.equal(f.calls.reads,0);
  for(const db of [f.primary,f.a,f.b])assert.equal((await inspectComposedInstallation(db,plan)).state,'fresh');
  assert.equal(await (await f.buckets.get('tenant-b').get('foreign.txt')).text(),'preserve');
});
