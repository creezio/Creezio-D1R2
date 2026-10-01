import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema,inspectManagedSchema,inspectCompositionSchema}
  from '../../scripts/data/apply-schema.mjs';
import {installComposed,inspectComposedInstallation}
  from '../../scripts/data/install-composition.mjs';
import {runLocalInstallation} from '../../scripts/local/install.mjs';
import {runLocalSchema} from '../../scripts/local/schema.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createAccountService} from '../../core/identity/accounts.ts';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {createStorageMutationPort} from '../../core/storage-authority/native-mutation.ts';
import {createRoutedNativeSessionLogout} from '../../core/storage-authority/native-session.ts';
import {prepareStorageRevocation,fenceStorageRoute,markStorageSourceAttempted}
  from '../../core/storage-authority/coordinator.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const loaded=loadRuntimeComposition({root,compositionPath:'configuration/composition.widgets-local.json'});
const before=compileCompositionSchema({composition:loaded.composition,lock:loaded.lock,
  modules:loaded.located.map(item=>item.descriptor)});
const composition=structuredClone(loaded.composition),lock=structuredClone(loaded.lock);
composition.application.version='0.0.2';
lock.compositionIntegrity=contractIntegrity(composition);
const after=compileCompositionSchema({composition,lock,
  modules:loaded.located.map(item=>item.descriptor)});
const laterComposition=structuredClone(loaded.composition),laterLock=structuredClone(loaded.lock);
laterComposition.application.version='0.0.3';
laterLock.compositionIntegrity=contractIntegrity(laterComposition);
const later=compileCompositionSchema({composition:laterComposition,lock:laterLock,
  modules:loaded.located.map(item=>item.descriptor)});
assert.notEqual(before.planDigest,after.planDigest);
assert.equal(before.sqlDigest,after.sqlDigest,'fixture is a true zero-DDL adoption');
assert.equal(after.sqlDigest,later.sqlDigest);
const installationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const resources=[
  {contextId:'tenant-a',slot:1,status:'active',databaseId:'routed-a',databaseName:'routed-a',bucketName:'routed-a-files'},
  {contextId:'tenant-b',slot:2,status:'active',databaseId:'routed-b',databaseName:'routed-b',bucketName:'routed-b-files'}];
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const mutations=`"${STORAGE_AUTHORITY_TABLES.storage_mutations}"`;
const credentials={loginIdentifier:'owner@example.invalid',displayName:'Owner',password:'Synthetic routed installation password'};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

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
  const config={root,storageInstallationId:installationId,storageResources:resources,
    bindings:{database:'DB',databaseId:'routed-primary'}};
  const io={interactive:true,write(){},async readLine(){return credentials.loginIdentifier;},
    async readSecret(){return credentials.password;},async confirm(){return true;}};
  const adapter=async(_config,contextId)=>({db:map.get(contextId),bucket:buckets.get(contextId),async dispose(){}});
  const lock=async()=>({async release(){}});
  let selected=before;
  const engine={loadComposedInstallPlan:async()=>selected,installComposed,inspectComposedInstallation,
    applyCompositionSchema,inspectCompositionSchema,inspectManagedSchema};
  const install=mode=>runLocalInstallation({mode,config,io,adapter,lock,engine});
  const schema=mode=>runLocalSchema({mode,config,io:{...io,readLine:async()=>after.planDigest},adapter,lock,engine});
  return {primary,a,b,buckets,config,engine,install,schema,
    selectAfter(){selected=after;},selectLater(){selected=later;},
    retargetContext(contextId,db){map.set(contextId,db);}};
}

test('official zero-DDL adoption preserves owner, files and installed route provenance',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.install('install')).ok,true);
  await f.buckets.get('tenant-a').put('owned.txt','preserved');
  const ownerCount=async()=> (await f.primary.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n;
  assert.equal(await ownerCount(),1);
  f.selectAfter();
  const adopted=await f.schema('apply');
  assert.equal(adopted.ok,true,JSON.stringify(adopted));
  for(const db of [f.primary,f.a,f.b])
    assert.equal((await inspectCompositionSchema(db,after)).state,'ready');
  const inspected=await f.install('inspect');
  assert.equal(inspected.ok,true,JSON.stringify(inspected));
  assert.deepEqual(inspected.targets.map(item=>item.provenance),['installed','installed']);
  const resumed=await f.install('install');
  assert.equal(resumed.ok,true,JSON.stringify(resumed));
  assert.equal(await ownerCount(),1,'no second bootstrap');
  assert.equal(await (await f.buckets.get('tenant-a').get('owned.txt')).text(),'preserved');
  for(const db of [f.a,f.b])assert.equal((await db.prepare(`SELECT generation FROM ${routes}`).first()).generation,3);
});

test('official access epoch changes preserve the full routed installation and schema lineage',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.install('install')).ok,true);
  f.selectAfter();
  assert.equal((await f.schema('apply')).ok,true);
  const targets=resources.map((resource,index)=>({identity:{installationId,
    contextId:resource.contextId,slot:resource.slot},db:index===0?f.a:f.b}));
  const port=createStorageMutationPort(f.primary,targets);
  const stateTable=`"${ACCESS_TABLES.authorization_state}"`;
  for(const [index,kind] of ['grant','revoke'].entries()){
    const initial=(await f.primary.prepare(`SELECT epoch FROM ${stateTable}
      WHERE id='application'`).first()).epoch;
    const next=initial+1;
    const read=async()=> (await f.primary.prepare(`SELECT epoch FROM ${stateTable}
      WHERE id='application'`).first()).epoch;
    const outcome=await port.commit({kind:'policy.apply-delta',commandKey:`test-${kind}-${index}`,
      sourceCommit:async()=>{
        const changed=await f.primary.prepare(`UPDATE ${stateTable} SET epoch=?
          WHERE id='application' AND epoch=?`).bind(next,initial).run();
        assert.equal(changed.meta.changes,1);
        return {epoch:next};
      },committed:value=>value?.epoch===next,
      inspectSource:async()=>await read()===next,
      recoverValue:async()=>({epoch:await read()})});
    assert.equal(outcome.state,'confirmed',JSON.stringify(outcome));
    assert.equal((await f.install('inspect')).ok,true,kind);
    assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),
      ['installed','installed']);
    assert.equal((await f.schema('inspect')).ok,true,kind);
  }
  const current=await f.a.prepare(`SELECT mutation_id AS id FROM ${routes}`).first();
  assert.match(current.id,/^authority:/);
  const original=await f.primary.prepare(`SELECT command_digest AS digest FROM ${mutations}
    WHERE id=?`).bind(current.id).first();
  assert.match(original.digest,/^sha256-[a-f0-9]{64}$/);
  await f.primary.prepare(`UPDATE ${mutations} SET command_digest=? WHERE id=?`)
    .bind(`sha256-${'0'.repeat(64)}`,current.id).run();
  assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),
    ['unproven','installed']);
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
  assert.equal((await f.schema('inspect')).ok,false);
  await f.primary.prepare(`UPDATE ${mutations} SET command_digest=? WHERE id=?`)
    .bind(original.digest,current.id).run();
  assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),
    ['installed','installed']);
  f.retargetContext('tenant-b',f.a);
  assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),
    ['installed','unproven']);
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
});

test('official routed logout preserves A/B provenance after zero-DDL adoption and rejects tampering',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.install('install')).ok,true);
  f.selectAfter();
  assert.equal((await f.schema('apply')).ok,true);
  const accounts=createAccountService(f.primary);
  const signed=await accounts.login({loginIdentifier:credentials.loginIdentifier,
    password:credentials.password,audience:'admin'});
  assert.equal(signed.ok,true);
  const targets=resources.map((resource,index)=>({identity:{installationId,
    contextId:resource.contextId,slot:resource.slot},db:index===0?f.a:f.b}));
  const logout=createRoutedNativeSessionLogout(f.primary,targets);
  assert.deepEqual(await logout.logout(signed.token,'admin'),{state:'revoked'});
  assert.equal(await accounts.session(signed.token,'admin'),null);
  const inspected=await f.install('inspect');
  assert.equal(inspected.ok,true,JSON.stringify(inspected));
  assert.deepEqual(inspected.targets.map(item=>item.provenance),['installed','installed']);
  assert.equal((await f.schema('inspect')).ok,true);
  const current=await f.a.prepare(`SELECT mutation_id AS id FROM ${routes}`).first();
  assert.match(current.id,/^logout:/);
  const original=await f.primary.prepare(`SELECT command_digest AS digest FROM ${mutations}
    WHERE id=?`).bind(current.id).first();
  assert.match(original.digest,/^sha256-[a-f0-9]{64}$/);
  await f.primary.prepare(`UPDATE ${mutations} SET command_digest=? WHERE id=?`)
    .bind(`sha256-${'0'.repeat(64)}`,current.id).run();
  assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),
    ['unproven','installed']);
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
  await f.primary.prepare(`UPDATE ${mutations} SET command_digest=? WHERE id=?`)
    .bind(original.digest,current.id).run();
  assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),
    ['installed','installed']);
  f.retargetContext('tenant-b',f.a);
  assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),
    ['installed','unproven']);
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
});

test('foreign, broken or retargeted adoption journal never authorizes install',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.install('install')).ok,true);
  f.selectAfter();
  assert.equal((await f.schema('apply')).ok,true);
  const current=await f.a.prepare(`SELECT mutation_id AS id FROM ${routes}`).first();
  await f.primary.prepare(`UPDATE ${mutations} SET command_digest=? WHERE id=?`)
    .bind(`sha256-${'0'.repeat(64)}`,current.id).run();
  assert.deepEqual((await f.install('inspect')).targets.map(item=>item.provenance),['unproven','installed']);
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
  const exact=`sha256-${digest(['local.schema.apply',installationId,after.planDigest,
    resources.map(item=>[item.contextId,item.slot,item.status,item.databaseId,item.bucketName])])}`;
  await f.primary.prepare(`UPDATE ${mutations} SET command_digest=? WHERE id=?`).bind(exact,current.id).run();
  f.config.storageResources=resources.map(item=>item.contextId==='tenant-a'
    ?{...item,databaseId:'foreign-a'}:item);
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
  f.config.storageResources=resources;
  await f.primary.prepare(`DELETE FROM ${mutations} WHERE installation_id=? AND context_id=? AND generation=1`)
    .bind(installationId,'tenant-a').run();
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
});

test('a fenced schema cutover is left to the native schema resumer without install effects',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.install('install')).ok,true);
  f.selectAfter();
  const commandDigest=`sha256-${digest(['local.schema.apply',installationId,after.planDigest,
    resources.map(item=>[item.contextId,item.slot,item.status,item.databaseId,item.bucketName])])}`;
  for(const [index,resource] of resources.entries()){
    const input={installationId,contextId:resource.contextId,slot:resource.slot,
      expectedGeneration:2,commandDigest,
      mutationId:`local-schema:${digest([commandDigest,resource.contextId,resource.slot,
        resource.databaseId,resource.bucketName]).slice(0,48)}`};
    await prepareStorageRevocation(f.primary,input);
    await fenceStorageRoute(f.primary,index===0?f.a:f.b,input);
    await markStorageSourceAttempted(f.primary,input);
  }
  for(const db of [f.primary,f.a,f.b])assert.equal((await applyCompositionSchema(db,after,
    {expectedPlanDigest:after.planDigest})).ok,true);
  const inspected=await f.install('inspect');
  assert.equal(inspected.ok,false);
  assert.deepEqual(inspected.targets.map(item=>item.provenance),['installed','installed']);
  assert.deepEqual(await f.install('install'),
    {ok:false,code:'schema_cutover_pending',effect:'none'});
  for(const db of [f.a,f.b]){
    const row=await db.prepare(`SELECT generation,state FROM ${routes}`).first();
    assert.deepEqual(row,{generation:3,state:'deny'});
  }
  assert.equal((await f.primary.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n,1);
});

test('journal verification paginates past 64 generations and refuses a missing link',
  {timeout:60000},async t=>{
  const f=await fixture(t);
  assert.equal((await f.install('install')).ok,true);
  f.selectAfter();
  assert.equal((await f.schema('apply')).ok,true);
  f.selectLater();
  for(const db of [f.primary,f.a,f.b])assert.equal((await applyCompositionSchema(db,later,
    {expectedPlanDigest:later.planDigest})).ok,true);
  const resource=resources[0];
  const currentDigest=`sha256-${digest(['local.schema.apply',installationId,later.planDigest,
    resources.map(item=>[item.contextId,item.slot,item.status,item.databaseId,item.bucketName])])}`;
  let lastId;
  for(let generation=3;generation<=65;generation++){
    const commandDigest=generation===65?currentDigest:`sha256-${digest(['synthetic-page',generation])}`;
    lastId=`local-schema:${digest([commandDigest,resource.contextId,resource.slot,
      resource.databaseId,resource.bucketName]).slice(0,48)}`;
    await f.primary.prepare(`INSERT INTO ${mutations}
      (id,installation_id,context_id,generation,command_digest,state,created_at_ms,updated_at_ms)
      VALUES (?,?,?,?,?,'open',0,0)`)
      .bind(lastId,installationId,resource.contextId,generation,commandDigest).run();
  }
  await f.a.prepare(`UPDATE ${routes} SET generation=66,mutation_id=? WHERE id=?`)
    .bind(lastId,resource.contextId).run();
  const other=resources[1];
  const otherId=`local-schema:${digest([currentDigest,other.contextId,other.slot,
    other.databaseId,other.bucketName]).slice(0,48)}`;
  await f.primary.prepare(`INSERT INTO ${mutations}
    (id,installation_id,context_id,generation,command_digest,state,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,'open',0,0)`)
    .bind(otherId,installationId,other.contextId,3,currentDigest).run();
  await f.b.prepare(`UPDATE ${routes} SET generation=4,mutation_id=? WHERE id=?`)
    .bind(otherId,other.contextId).run();
  const inspected=await f.install('inspect');
  assert.equal(inspected.ok,true,JSON.stringify(inspected));
  assert.equal((await f.install('install')).ok,true);
  const duplicateDigest=`sha256-${digest(['synthetic-duplicate',64])}`;
  const duplicateId=`local-schema:${digest([duplicateDigest,resource.contextId,resource.slot,
    resource.databaseId,resource.bucketName]).slice(0,48)}`;
  await f.primary.prepare(`INSERT INTO ${mutations}
    (id,installation_id,context_id,generation,command_digest,state,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?,?,'open',0,0)`)
    .bind(duplicateId,installationId,resource.contextId,64,duplicateDigest).run();
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
  await f.primary.prepare(`DELETE FROM ${mutations} WHERE id=?`).bind(duplicateId).run();
  await f.primary.prepare(`DELETE FROM ${mutations} WHERE installation_id=? AND context_id=? AND generation=40`)
    .bind(installationId,resource.contextId).run();
  assert.deepEqual(await f.install('install'),{ok:false,code:'target_unproven',effect:'none'});
});
