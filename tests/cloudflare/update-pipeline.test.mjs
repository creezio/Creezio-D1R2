import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCloudflareDeliveryPipeline} from '../../scripts/cloudflare/pipeline.mjs';
import {cloudflareWorkerConfiguration} from '../../scripts/cloudflare/config.mjs';
import {createPublicationGate} from '../../core/registry/publication.ts';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createStorageFixture} from '../data/fixtures/storage.mjs';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const accountId='a'.repeat(32),token='synthetic-cloudflare-token-value',tokenId='b'.repeat(32);
const workerName='creezio-test',databaseId='11111111-1111-4111-8111-111111111111';
const originalVersion='22222222-2222-4222-8222-222222222222';
const updatedVersion='33333333-3333-4333-8333-333333333333';
const context={principalId:'principal-one',sessionId:'session-one',epoch:1};
const sourceSha='c'.repeat(40),compositionDigest=`sha256-${'3'.repeat(64)}`;
const origin=`https://${workerName}.example.workers.dev`;
const target={schemaVersion:1,accountId,workerName,databaseId,databaseName:`${workerName}-db`,
  bucketName:`${workerName}-files`,origin,
  widgetSandboxOrigin:`https://${workerName}-widgets.example.workers.dev`};
const routed={...target,schemaVersion:3,storageInstallationId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  resources:[{contextId:'tenant-a',slot:1,status:'active',
    databaseId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',databaseName:'tenant-a-db',
    bucketName:'tenant-a-files'}]};
const originalArtifact={sourceSha:'d'.repeat(40),artifactDigest:`sha256-${'4'.repeat(64)}`,
  compositionDigest:`sha256-${'5'.repeat(64)}`,coreVersion:'1.0.0',contractVersion:'1.0.0'};
const artifact={sourceSha,artifactDigest:`sha256-${'6'.repeat(64)}`,
  compositionDigest,coreVersion:'1.0.1',contractVersion:'1.0.0'};
function journal(idField){
  const records=new Map();
  return {records,async load(id){return structuredClone(records.get(id)??null);},
    async findActive(owner){return [...records.values()].find(item=>item.owner===owner
      &&item.stage!=='delivered')?.[idField]??null;},
    async create(next){assert.equal(records.has(next[idField]),false);
      records.set(next[idField],structuredClone(next));},
    async createActive(next){assert.equal([...records.values()].some(item=>item.owner===next.owner
      &&item.stage!=='delivered'),false);
      await this.create(next);},
    async compareAndSave(previous,next){assert.deepEqual(records.get(next[idField]),previous);
      assert.equal(next.revision,previous.revision+1);
      records.set(next[idField],structuredClone(next));}};
}
function publicationJournal(){
  const records=new Map();
  return {records,async get(key){return records.get(key)??null;},
    async claim(record){const old=records.get(record.requestKey)??null;
      if(!old)records.set(record.requestKey,record);return old;},
    async saveDelivered(record){assert.equal(records.get(record.requestKey).state,'prepared');
      records.set(record.requestKey,record);},
    async saveSynchronized(record){assert.equal(records.get(record.requestKey).state,'delivered');
      records.set(record.requestKey,record);}};
}
function fixture({unknownUpload=false,failedUploadNoRemote=false,declarationFailsOnce=false,driftAfterBuild=false,
  lostSchemaReplyOnce=false,routedTarget=false,cutoverFactory=null}={}){
  const events=[],planJournal=journal('transferId'),updateJournal=journal('updateId'),
    gateJournal=publicationJournal();
  const initial={schemaVersion:1,revision:1,transferId:'transfer-one',owner:context.principalId,
    stage:'delivered',accountId,workerName,tokenId,target:routedTarget?routed:target,artifact:originalArtifact,
    registryProjectId:'project-one',registryInstallationId:'installation-one'};
  planJournal.records.set(initial.transferId,initial);
  gateJournal.records.set(initial.transferId,{state:'synchronized',declaration:{
    deploymentId:'deployment-original',url:new URL(initial.target.origin).href,
    publishedSha:originalArtifact.sourceSha,artifact:originalArtifact}});
  const deployed=cloudflareWorkerConfiguration(initial.target);
  const installedBindings=[...deployed.d1_databases.map(item=>({name:item.binding,type:'d1',
    id:item.database_id})),...deployed.r2_buckets.map(item=>({name:item.binding,
    type:'r2_bucket',bucket_name:item.bucket_name})),
    ...Object.entries(deployed.vars).map(([name,text])=>({name,type:'plain_text',text})),
    {name:'CREEZIO_VAULT_KEYRING',type:'secret_text'}];
  const current={deploymentId:'deployment-original',versionId:originalVersion,
    tag:'cz-transfer-one',message:`Creezio ${originalArtifact.artifactDigest} ${originalArtifact.sourceSha}`,
    bindings:structuredClone(installedBindings)};
  let schemaState='additive',schemaReceiptId=`sha256-${'7'.repeat(64)}`;
  let uploadCount=0,schemaEffects=0,declareCount=0;
  const targetPlan={applicationId:'application',planDigest:`sha256-${'8'.repeat(64)}`,
    compositionDigest,lockDigest:`sha256-${'2'.repeat(64)}`,
    modelDigest:`sha256-${'9'.repeat(64)}`,sqlDigest:`sha256-${'a'.repeat(64)}`,
    objects:[]};
  const projection={targetPlan,sourcePlan:{applicationId:'application',
    modelDigest:`sha256-${'b'.repeat(64)}`},compatibilityDigest:`sha256-${'e'.repeat(64)}`,
    composition:{schemaVersion:'1.0.0',sdk:{coreVersion:'1.0.1'}},lock:{}};
  const receipt={deploymentId:'deployment-updated',url:origin,
    publishedSha:sourceSha,artifact};
  const client={async preflight(request){events.push('preflight');return {
    preflightId:'preflight-'+events.length,projectId:request.projectId,
    installationId:request.installationId,checkedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+300_000).toISOString()};},
  async declare(request){events.push('declare');declareCount++;
    if(declarationFailsOnce&&declareCount===1)throw new Error('registry unavailable');
    return {projectId:request.projectId,installationId:request.installationId,
      deploymentId:request.deploymentId,declaredAt:new Date().toISOString(),replayed:false};}};
  const gate=createPublicationGate({client,journal:gateJournal});
  const control={accountId,async inspectConnection(){events.push('connection');return {accountId,tokenId,
    workersSubdomain:'example'};},
  async deployments(){return {deployments:[{id:current.deploymentId,
    versions:[{percentage:100,version_id:current.versionId}]}]};},
  async workerSettings(){return {annotations:{'workers/tag':current.tag,
    'workers/message':current.message},bindings:current.bindings};},
  async version(_name,id){return {id};},
  async latestVersion(){events.push('latest-version');return {id:current.versionId};},
  async bucket(){events.push('bucket');return {private:true};}};
  const options={config:{root,...(routedTarget?{
    storageInstallationId:routed.storageInstallationId,
    storageResources:[{contextId:'tenant-a',slot:1,status:'active',
      databaseId:'local-tenant-a',databaseName:'local-tenant-a',
      bucketName:'local-tenant-a'}]}:{})},
    planJournal,updateJournal,provisionJournal:journal('transferId'),
    transferJournal:{load:async()=>null},publicationJournal:gateJournal,
    registryClient:client,publicationGate:gate,
    registryIdentity:{projectId:'project-one',installationId:'installation-one'},
    ...(cutoverFactory?{storageCutoverFactory:cutoverFactory}:{}),
    sourceIdentity:()=>({head:sourceSha,tree:'f'.repeat(40),sha256:'1'.repeat(64),dirty:false}),
    project:()=>projection,updateIdFactory:()=> 'update-one',
    controlFactory:()=>control,secretConnections:async()=>[],sourceKeyring:async()=>null,
    provisionerFactory:()=>({async provision(request){events.push('provision');return {
      state:'ready',target:{accountId,workerName,origin,bucketName:request.bucketName,
        databaseId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}};}}),
    targetVault:{loadOrCreate(){assert.fail('update must not create a vault');}},
    stopRuntime(){assert.fail('update must not stop runtime through transfer');},
    buildTarget(){assert.fail('update must use its own build port');},
    buildUpdateTarget:async input=>{events.push('build');
      assert.equal(input.updateId,'update-one');
      assert.equal(input.artifactRoot,path.join(root,'.wrangler','delivery','updates','update-one','artifact'));
      if(driftAfterBuild)current.versionId='44444444-4444-4444-8444-444444444444';
      return artifact;},
    capture(){assert.fail('update must not capture local data');},
    loadCapture(){assert.fail('update must not load local data');},
    importTransfer(){assert.fail('update must not import local data');},
    verifyTransfer(){assert.fail('update must not verify a local transfer');},
    d1Factory:({databaseId:id})=>({metadata:async()=>({uuid:id})}),d1BindingFactory:()=>({}),
    r2Factory(){assert.fail('update must not open R2 object transport');},
    inspectSchema:async()=>({state:schemaState,receiptId:schemaState==='ready'?schemaReceiptId:null}),
    inspectManagedSchema:async()=>({ok:true,receiptId:schemaReceiptId,
      receipt:{planDigest:targetPlan.planDigest,compositionDigest:targetPlan.compositionDigest}}),
    applySchema:async()=>{events.push('schema');if(schemaState==='additive'){
      schemaState='ready';schemaEffects++;}
      if(lostSchemaReplyOnce&&schemaEffects===1&&events.filter(item=>item==='schema').length===1)
        throw new Error('schema acknowledgement lost');
      return {ok:true,observedState:'ready',receiptId:schemaReceiptId};},
    publishSandbox(){assert.fail('update must not republish sandbox');},
    publisherFactory:({artifactRoot})=>({
      async deliver(input){events.push('publish');uploadCount++;
        assert.equal(artifactRoot,path.join(root,'.wrangler','delivery','updates','update-one','artifact'));
        assert.equal(input.expectedPreviousDeploymentId,'deployment-original');
        assert.equal(input.expectedPreviousVersionId,originalVersion);
        assert.equal(Object.hasOwn(input,'secretsPath'),false);
        if(failedUploadNoRemote)throw new Error('upload failed before remote effect');
        current.deploymentId=receipt.deploymentId;current.versionId=updatedVersion;
        current.tag='cz-update-one';
        current.message=`Creezio ${artifact.artifactDigest} ${artifact.sourceSha}`;
        if(unknownUpload)throw new Error('response lost');
        return receipt;},
      async inspect(){events.push('inspect-worker');return receipt;},
      verifyPreservedUpdate(input){events.push('preserved-artifact');
        assert.equal(input.transferId,'update-one');assert.deepEqual(input.artifact,artifact);},
      async deliverPreservedUpdate(input){events.push('retry-publish');uploadCount++;
        assert.equal(input.expectedPreviousVersionId,originalVersion);
        assert.equal(input.expectedPreviousDeploymentId,'deployment-original');
        current.deploymentId=receipt.deploymentId;current.versionId=updatedVersion;
        current.tag='cz-update-one';
        current.message=`Creezio ${artifact.artifactDigest} ${artifact.sourceSha}`;
        return receipt;},
      async inspectCurrent(){return {deploymentId:current.deploymentId,
        versionId:current.versionId,bindings:current.bindings};}}),
  };
  const pipeline=createCloudflareDeliveryPipeline(options);
  const configure=()=>pipeline.configure({target:{accountId,workerName},
    credentials:{apiToken:token}},context);
  return {pipeline,configure,events,current,control,options,updateJournal,gateJournal,
    get uploadCount(){return uploadCount;},get schemaEffects(){return schemaEffects;}};
}

test('routed update without local inventory stops before build, schema, or upload',async()=>{
  const f=fixture({routedTarget:true});await f.configure();
  f.options.config.storageResources=[];
  await assert.rejects(f.pipeline.prepareUpdate({},context),
    error=>error.code==='storage_inventory_changed');
  assert.equal(f.updateJournal.records.get('update-one').stage,'intent');
  assert.equal(f.schemaEffects,0);assert.equal(f.uploadCount,0);
  assert.equal(f.events.includes('build'),false);
});

test('routed update hands exact previous and next targets to the cutover publication port',async()=>{
  let called=0,f;
  const cutoverFactory=input=>({async advance(){
    called++;
    assert.deepEqual(input.previousTarget,routed);
    assert.deepEqual(input.nextTarget,routed);
    assert.equal(input.plan.planDigest,`sha256-${'8'.repeat(64)}`);
    const previous=await input.publication.inspectPrevious();
    assert.equal(previous.deploymentId,'deployment-original');
    await input.publication.deliver();
    const published=await input.publication.inspect();
    assert.ok(published,JSON.stringify(f.gateJournal.records.get('update-one')));
    assert.equal(published.deploymentId,'deployment-updated');
    assert.equal(published.versionId,updatedVersion);
    assert.deepEqual(published.target,routed);
    return {state:'ready',phase:'open'};
  }});
  f=fixture({routedTarget:true,cutoverFactory});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  assert.equal(prepared.kind,'update');
  assert.deepEqual(f.updateJournal.records.get('update-one').nextTarget,routed);
  const result=await f.pipeline.startUpdate(prepared,context);
  assert.equal(result.phase,'delivered');
  assert.equal(result.registryStatus,'effective');
  assert.equal(called,1);assert.equal(f.uploadCount,1);
  assert.equal(f.schemaEffects,0,'cutover owns additive schema effects');
});

for(const [field,value] of [
  ['url','https://wrong.example/'],['publishedSha','f'.repeat(40)]])
  test(`routed update refuses a divergent previous declaration ${field} before fencing`,async()=>{
    const f=fixture({routedTarget:true});await f.configure();
    const prior=f.gateJournal.records.get('transfer-one');
    f.gateJournal.records.set('transfer-one',{...prior,
      declaration:{...prior.declaration,[field]:value}});
    await assert.rejects(f.pipeline.prepareUpdate({},context),{code:'deployment_changed'});
    assert.equal(f.updateJournal.records.size,0);
    assert.equal(f.events.includes('build'),false);
    assert.equal(f.uploadCount,0);
  });

for(const [field,value] of [
  ['url','https://wrong.example/'],['publishedSha','f'.repeat(40)]])
  test(`routed update never accepts a divergent synchronized declaration ${field}`,async()=>{
    let f;
    const cutoverFactory=input=>({async advance(){
      assert.equal((await input.publication.inspectPrevious()).deploymentId,
        'deployment-original');
      await input.publication.deliver();
      const gate=f.gateJournal.records.get('update-one');
      f.gateJournal.records.set('update-one',{...gate,
        declaration:{...gate.declaration,[field]:value}});
      assert.equal(await input.publication.inspect(),null);
      return {state:'pending',phase:'publishing'};
    }});
    f=fixture({routedTarget:true,cutoverFactory});await f.configure();
    const prepared=await f.pipeline.prepareUpdate({},context);
    const result=await f.pipeline.startUpdate(prepared,context);
    assert.notEqual(result.phase,'delivered');
    assert.equal(f.updateJournal.records.get('update-one').stage,'preflight');
    assert.equal(f.uploadCount,1);
  });

for(const [field,value] of [
  ['url','https://wrong.example/'],['publishedSha','f'.repeat(40)]])
  test(`divergent update declaration ${field} leaves the real target D1 route denied`,
    {timeout:60000},async()=>{
      const f=fixture({routedTarget:true});
      const local=await createStorageFixture();
      const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
        script:'export default {fetch(){return new Response(null,{status:404})}}',
        compatibilityDate:'2026-05-15',d1Databases:{TARGET:'update-declaration-target'},
        d1Persist:false,telemetry:{enabled:false},logRequests:false,
        log:new Log(LogLevel.NONE)});
      try{
        const primary=local.db,targetDb=await runtime.getD1Database('TARGET');
        const ddl=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
        for(const db of [primary,targetDb])
          await db.batch(ddl.statements.map(sql=>db.prepare(sql)));
        const epoch=(await primary.prepare(`SELECT epoch FROM
          "${ACCESS_TABLES.authorization_state}" WHERE id='application'`).first()).epoch;
        const route=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
        await targetDb.prepare(`INSERT INTO ${route}
          (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
          VALUES ('tenant-a',?,1,1,'active',NULL,?,0)`)
          .bind(routed.storageInstallationId,epoch).run();
        f.options.d1Factory=({databaseId:id})=>({databaseId:id,
          metadata:async()=>({uuid:id})});
        f.options.d1BindingFactory=client=>client.databaseId===databaseId
          ?primary:targetDb;
        const plan=f.options.project().targetPlan;
        f.options.storageCutoverSchema={
          async inspect(){return {state:'ready'};},
          async apply(){assert.fail('exact schema receipts need no DDL');},
          async managed(db){return {ok:true,
            receiptId:`sha256-${(db===primary?'1':'2').repeat(64)}`,
            receipt:{...plan}};}};
        const gate=f.options.publicationGate;
        f.options.publicationGate={...gate,
          async publish(...args){const result=await gate.publish(...args);
            const stored=f.gateJournal.records.get('update-one');
            f.gateJournal.records.set('update-one',{...stored,
              declaration:{...stored.declaration,[field]:value}});
            return result;}};
        const pipeline=createCloudflareDeliveryPipeline(f.options);
        await pipeline.configure({target:{accountId,workerName},
          credentials:{apiToken:token}},context);
        const prepared=await pipeline.prepareUpdate({},context);
        const result=await pipeline.startUpdate(prepared,context);
        assert.notEqual(result.phase,'delivered');
        assert.equal((await targetDb.prepare(`SELECT state FROM ${route}`).first()).state,
          'deny');
        assert.equal(f.uploadCount,1);
      }finally{await runtime.dispose();await local.dispose();}
    });

test('routed preparation journals added and retired pairs before any build',async()=>{
  const f=fixture({routedTarget:true,cutoverFactory:()=>({advance:async()=>({state:'pending'})})});
  await f.configure();
  f.options.config.storageResources=[
    {...f.options.config.storageResources[0],status:'revoked'},
    {contextId:'tenant-b',slot:2,status:'active',databaseId:'local-tenant-b',
      databaseName:'local-tenant-b',bucketName:'local-tenant-b'}];
  const prepared=await f.pipeline.prepareUpdate({},context);
  const next=f.updateJournal.records.get(prepared.updateId).nextTarget;
  assert.equal(next.resources[0].status,'revoked');
  assert.equal(next.resources[0].databaseId,routed.resources[0].databaseId);
  assert.deepEqual(next.resources[1],{contextId:'tenant-b',slot:2,status:'active',
    databaseId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    databaseName:'creezio-test-s2-db',bucketName:'creezio-test-s2-files'});
  assert.equal(f.events.filter(item=>item==='provision').length,1);
  assert.equal(f.events.includes('build'),false);
});

test('previous routed publication requires its complete D1/R2 inventory and route manifest',async()=>{
  for(const removed of ['DB_RESOURCE_01','BUCKET_RESOURCE_01','CREEZIO_STORAGE_ROUTES']){
    const f=fixture({routedTarget:true});await f.configure();
    f.current.bindings=f.current.bindings.filter(item=>item.name!==removed);
    await assert.rejects(f.pipeline.prepareUpdate({},context),error=>error.code==='unmanaged_worker');
    assert.equal(f.updateJournal.records.size,0);
  }
  const f=fixture({routedTarget:true});await f.configure();
  f.current.bindings.push({name:'BUCKET_RESOURCE_02',type:'r2_bucket',bucket_name:'unexpected'});
  await assert.rejects(f.pipeline.prepareUpdate({},context),error=>error.code==='unmanaged_worker');
  assert.equal(f.updateJournal.records.size,0);
});

test('a routed update journal without next inventory cannot build or upload',async()=>{
  const f=fixture();await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const stored=f.updateJournal.records.get(prepared.updateId);
  stored.target=structuredClone(routed);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  const unchanged=structuredClone(stored);
  await assert.rejects(f.pipeline.prepareUpdate({},context),
    error=>error.code==='storage_inventory_changed');
  await assert.rejects(f.pipeline.startUpdate(input,context),
    error=>error.code==='storage_inventory_changed');
  await assert.rejects(f.pipeline.reconcileUpdate(input,context),
    error=>error.code==='storage_inventory_changed');
  assert.deepEqual(f.updateJournal.records.get(prepared.updateId),unchanged,
    'cutover refusals must not advance the durable journal stage or revision');
  assert.equal(f.schemaEffects,0);assert.equal(f.uploadCount,0);
  assert.equal(f.events.includes('build'),false);
  for(const stage of ['delivery-unknown','delivered']){
    stored.stage=stage;
    const terminal=structuredClone(stored);
    await assert.rejects(f.pipeline.startUpdate(input,context),
      error=>error.code==='storage_inventory_changed');
    assert.deepEqual(f.updateJournal.records.get(prepared.updateId),terminal);
    assert.equal((await f.pipeline.statusUpdate(prepared.updateId,context)).phase,stage,
      'read-only status remains available for an old routed record');
    assert.equal((await f.pipeline.statusUpdate(prepared.updateId,context)).retryEligible,false);
  }
});

test('compatible update preserves production ports and publishes once after additive schema',async()=>{
  const f=fixture();await f.configure();
  const inspection=await f.pipeline.inspectUpdate(context);
  assert.equal(inspection.currentPublicationId,'transfer-one');
  const prepared=await f.pipeline.prepareUpdate({},context);
  assert.equal(prepared.kind,'update');assert.equal(prepared.updateId,'update-one');
  assert.equal(f.events.includes('build'),false);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  const result=await f.pipeline.startUpdate(input,context);
  assert.equal(result.phase,'delivered');assert.equal(result.registryStatus,'effective');
  assert.equal(f.schemaEffects,1);assert.equal(f.uploadCount,1);
  assert.deepEqual(f.events.filter(item=>['build','preflight','schema','publish','declare'].includes(item)),
    ['build','preflight','schema','preflight','publish','declare']);
  assert.equal((await f.pipeline.statusUpdate('update-one',context)).phase,'delivered');
  assert.equal((await f.pipeline.inspectUpdate(context)).currentPublicationId,'update-one');
});

test('lost upload response is inspected under the same update ID without a second upload',async()=>{
  const f=fixture({unknownUpload:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  const unknown=await f.pipeline.startUpdate(input,context);
  assert.equal(unknown.phase,'delivery-unknown');
  assert.equal(unknown.retryEligible,true);
  assert.deepEqual(unknown.diagnostic,{phase:'unknown',reason:'unavailable',exitCode:null,apiCodes:[]});
  assert.equal(f.gateJournal.records.get('update-one').state,'prepared');
  const delivered=await f.pipeline.reconcileUpdate(input,context);
  assert.equal(delivered.phase,'delivered');
  assert.equal(delivered.retryEligible,false);
  assert.equal(Object.hasOwn(delivered,'diagnostic'),false);
  assert.equal(f.uploadCount,1);
  assert.equal(f.events.filter(item=>item==='inspect-worker').length,1);
});

test('explicit retry preserves the artifact and requires a negative remote version proof',async()=>{
  const f=fixture({failedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  assert.equal((await f.pipeline.startUpdate(input,context)).phase,'delivery-unknown');
  assert.equal(f.gateJournal.records.get('update-one').state,'prepared');
  assert.equal(f.uploadCount,1);
  const delivered=await f.pipeline.retryUpdate(input,context);
  assert.equal(delivered.phase,'delivered');
  assert.equal(f.uploadCount,2);
  assert.equal(f.gateJournal.records.get('update-one').state,'prepared');
  assert.equal(f.gateJournal.records.get('update-one.retry.1').state,'synchronized');
  assert.equal(f.updateJournal.records.get('update-one').publicationAttemptKey,'update-one.retry.1');
  assert.equal(f.schemaEffects,1);
  assert.equal(f.events.filter(item=>item==='build').length,1);
  assert.equal(f.events.filter(item=>item==='schema').length,1);
  assert.equal(f.events.filter(item=>item==='retry-publish').length,1);
});

test('explicit retry refuses newer remote version without an upload',async()=>{
  const f=fixture({failedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  assert.equal((await f.pipeline.startUpdate(input,context)).phase,'delivery-unknown');
  f.control.latestVersion=async()=>({id:updatedVersion});
  await assert.rejects(f.pipeline.retryUpdate(input,context),{code:'delivery_unknown'});
  assert.equal(f.uploadCount,1);
  assert.equal(f.gateJournal.records.has('update-one.retry.1'),false);
});

test('preflight failure leaves a durable retry key that can resume without allocating another',async()=>{
  const f=fixture({failedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  assert.equal((await f.pipeline.startUpdate(input,context)).phase,'delivery-unknown');
  const preflight=f.options.registryClient.preflight;
  let failOnce=true;
  f.options.registryClient.preflight=async request=>{
    if(failOnce){failOnce=false;throw new Error('synthetic registry outage');}
    return preflight(request);
  };
  assert.equal((await f.pipeline.retryUpdate(input,context)).phase,'delivery-unknown');
  assert.equal(f.updateJournal.records.get('update-one').publicationAttemptKey,'update-one.retry.1');
  assert.equal(f.gateJournal.records.has('update-one.retry.1'),false);
  assert.equal(f.uploadCount,1);
  assert.equal((await f.pipeline.retryUpdate(input,context)).phase,'delivered');
  assert.equal(f.updateJournal.records.get('update-one').publicationRetryCount,1);
  assert.equal(f.uploadCount,2);
});

test('changed Worker version blocks update before schema or upload',async()=>{
  const f=fixture({driftAfterBuild:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  await assert.rejects(f.pipeline.startUpdate({updateId:prepared.updateId,
    planDigest:prepared.planDigest},context),error=>error.code==='deployment_changed');
  assert.equal(f.schemaEffects,0);assert.equal(f.uploadCount,0);
  assert.equal(f.gateJournal.records.has('update-one'),false);
});

test('incompatible production schema blocks preparation before any build',async()=>{
  const f=fixture();await f.configure();
  f.options.inspectSchema=async()=>({state:'blocked'});
  const pipeline=createCloudflareDeliveryPipeline(f.options);
  await pipeline.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  await assert.rejects(pipeline.prepareUpdate({},context),error=>error.code==='schema_unavailable');
  assert.equal(f.events.includes('build'),false);
  assert.equal(f.updateJournal.records.size,0);
});

test('registry declaration resumes without republishing code',async()=>{
  const f=fixture({declarationFailsOnce:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  assert.equal((await f.pipeline.startUpdate(input,context)).phase,'delivery-unknown');
  assert.equal(f.gateJournal.records.get('update-one').state,'delivered');
  assert.equal((await f.pipeline.reconcileUpdate(input,context)).phase,'delivered');
  assert.equal(f.uploadCount,1);
  assert.equal(f.events.filter(item=>item==='declare').length,2);
});

test('lost schema acknowledgement resumes from production receipt without a second DDL effect',async()=>{
  const f=fixture({lostSchemaReplyOnce:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  await assert.rejects(f.pipeline.startUpdate(input,context),/schema acknowledgement lost/);
  assert.equal((await f.pipeline.statusUpdate('update-one',context)).phase,'schema-applying');
  assert.equal(f.schemaEffects,1);assert.equal(f.uploadCount,0);
  assert.equal((await f.pipeline.reconcileUpdate(input,context)).phase,'delivered');
  assert.equal(f.schemaEffects,1);assert.equal(f.uploadCount,1);
});

test('a second update uses the currently verified publication as its predecessor',async()=>{
  const f=fixture();await f.configure();
  const first=await f.pipeline.prepareUpdate({},context);
  await f.pipeline.startUpdate({updateId:first.updateId,planDigest:first.planDigest},context);
  f.options.updateIdFactory=()=> 'update-two';
  const secondPipeline=createCloudflareDeliveryPipeline(f.options);
  await secondPipeline.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  const second=await secondPipeline.prepareUpdate({},context);
  assert.equal(second.updateId,'update-two');
  assert.equal(f.updateJournal.records.get('update-two').previousPublicationId,'update-one');
  assert.equal(f.updateJournal.records.get('update-two').previousVersionId,updatedVersion);
});

test('missing production vault binding blocks preparation without local reads',async()=>{
  const f=fixture();await f.configure();
  f.current.bindings=f.current.bindings.filter(item=>item.name!=='CREEZIO_VAULT_KEYRING');
  await assert.rejects(f.pipeline.prepareUpdate({},context),error=>error.code==='unmanaged_worker');
  assert.equal(f.updateJournal.records.size,0);
});
