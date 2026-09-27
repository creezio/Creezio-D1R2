import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCloudflareDeliveryPipeline} from '../../scripts/cloudflare/pipeline.mjs';
import {createPublicationGate} from '../../core/registry/publication.ts';

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
const originalArtifact={sourceSha:'d'.repeat(40),artifactDigest:`sha256-${'4'.repeat(64)}`,
  compositionDigest:`sha256-${'5'.repeat(64)}`,coreVersion:'1.0.0',contractVersion:'1.0.0'};
const artifact={sourceSha,artifactDigest:`sha256-${'6'.repeat(64)}`,
  compositionDigest,coreVersion:'1.0.1',contractVersion:'1.0.0'};
const bindings=[{name:'DB',type:'d1',id:databaseId},
  {name:'BUCKET',type:'r2_bucket',bucket_name:target.bucketName},
  {name:'CREEZIO_RUNTIME_PROFILE',type:'plain_text',text:'cloudflare'},
  {name:'CREEZIO_APP_ORIGIN',type:'plain_text',text:origin},
  {name:'CREEZIO_WIDGET_SANDBOX_ORIGIN',type:'plain_text',text:target.widgetSandboxOrigin},
  {name:'CREEZIO_VAULT_KEYRING',type:'secret_text'}];
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
function fixture({unknownUpload=false,declarationFailsOnce=false,driftAfterBuild=false,
  lostSchemaReplyOnce=false}={}){
  const events=[],planJournal=journal('transferId'),updateJournal=journal('updateId'),
    gateJournal=publicationJournal();
  const initial={schemaVersion:1,revision:1,transferId:'transfer-one',owner:context.principalId,
    stage:'delivered',accountId,workerName,tokenId,target,artifact:originalArtifact,
    registryProjectId:'project-one',registryInstallationId:'installation-one'};
  planJournal.records.set(initial.transferId,initial);
  gateJournal.records.set(initial.transferId,{state:'synchronized',declaration:{
    deploymentId:'deployment-original',artifact:originalArtifact}});
  const current={deploymentId:'deployment-original',versionId:originalVersion,
    tag:'cz-transfer-one',message:`Creezio ${originalArtifact.artifactDigest} ${originalArtifact.sourceSha}`,
    bindings:structuredClone(bindings)};
  let schemaState='additive',schemaReceiptId=`sha256-${'7'.repeat(64)}`;
  let uploadCount=0,schemaEffects=0,declareCount=0;
  const targetPlan={applicationId:'application',planDigest:`sha256-${'8'.repeat(64)}`,
    compositionDigest,modelDigest:`sha256-${'9'.repeat(64)}`,sqlDigest:`sha256-${'a'.repeat(64)}`,
    objects:[]};
  const projection={targetPlan,sourcePlan:{applicationId:'application',
    modelDigest:`sha256-${'b'.repeat(64)}`},compatibilityDigest:`sha256-${'e'.repeat(64)}`,
    composition:{schemaVersion:'1.0.0',sdk:{coreVersion:'1.0.1'}},lock:{}};
  const receipt={deploymentId:'deployment-updated',url:origin,artifact};
  const client={async preflight(request){events.push('preflight');return {
    preflightId:'preflight-'+events.length,projectId:request.projectId,
    installationId:request.installationId,checkedAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+300_000).toISOString()};},
  async declare(request){events.push('declare');declareCount++;
    if(declarationFailsOnce&&declareCount===1)throw new Error('registry unavailable');
    return {projectId:request.projectId,installationId:request.installationId,
      deploymentId:request.deploymentId,declaredAt:new Date().toISOString(),replayed:false};}};
  const gate=createPublicationGate({client,journal:gateJournal});
  const control={async inspectConnection(){events.push('connection');return {accountId,tokenId,
    workersSubdomain:'example'};},
  async deployments(){return {deployments:[{id:current.deploymentId,
    versions:[{percentage:100,version_id:current.versionId}]}]};},
  async workerSettings(){return {annotations:{'workers/tag':current.tag,
    'workers/message':current.message},bindings:current.bindings};},
  async version(_name,id){return {id};},
  async bucket(){events.push('bucket');return {private:true};}};
  const options={config:{root},planJournal,updateJournal,provisionJournal:journal('transferId'),
    transferJournal:{load:async()=>null},publicationJournal:gateJournal,
    registryClient:client,publicationGate:gate,
    registryIdentity:{projectId:'project-one',installationId:'installation-one'},
    sourceIdentity:()=>({head:sourceSha,tree:'f'.repeat(40),sha256:'1'.repeat(64),dirty:false}),
    project:()=>projection,updateIdFactory:()=> 'update-one',
    controlFactory:()=>control,secretConnections:async()=>[],sourceKeyring:async()=>null,
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
    d1Factory:()=>({metadata:async()=>({uuid:databaseId})}),d1BindingFactory:()=>({}),
    r2Factory(){assert.fail('update must not open R2 object transport');},
    inspectSchema:async()=>({state:schemaState,receiptId:schemaState==='ready'?schemaReceiptId:null}),
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
        current.deploymentId=receipt.deploymentId;current.versionId=updatedVersion;
        current.tag='cz-update-one';
        current.message=`Creezio ${artifact.artifactDigest} ${artifact.sourceSha}`;
        if(unknownUpload)throw new Error('response lost');
        return receipt;},
      async inspect(){events.push('inspect-worker');return receipt;}}),
  };
  const pipeline=createCloudflareDeliveryPipeline(options);
  const configure=()=>pipeline.configure({target:{accountId,workerName},
    credentials:{apiToken:token}},context);
  return {pipeline,configure,events,current,options,updateJournal,gateJournal,
    get uploadCount(){return uploadCount;},get schemaEffects(){return schemaEffects;}};
}

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
  assert.equal((await f.pipeline.startUpdate(input,context)).phase,'delivery-unknown');
  assert.equal(f.gateJournal.records.get('update-one').state,'prepared');
  assert.equal((await f.pipeline.reconcileUpdate(input,context)).phase,'delivered');
  assert.equal(f.uploadCount,1);
  assert.equal(f.events.filter(item=>item==='inspect-worker').length,1);
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
