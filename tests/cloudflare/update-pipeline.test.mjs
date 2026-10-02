import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCloudflareDeliveryPipeline} from '../../scripts/cloudflare/pipeline.mjs';
import {CloudflarePublicationError} from '../../scripts/cloudflare/publisher.mjs';
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
      &&!['delivered','rejected'].includes(item.stage))?.[idField]??null;},
    async create(next){assert.equal(records.has(next[idField]),false);
      records.set(next[idField],structuredClone(next));},
    async createActive(next){assert.equal([...records.values()].some(item=>item.owner===next.owner
      &&!['delivered','rejected'].includes(item.stage)),false);
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
function fixture({unknownUpload=false,failedUploadNoRemote=false,rejectedUploadNoRemote=false,
  declarationFailsOnce=false,driftAfterBuild=false,
  lostSchemaReplyOnce=false,routedTarget=false,cutoverFactory=null}={}){
  const events=[],planJournal=journal('transferId'),updateJournal=journal('updateId'),
    gateJournal=publicationJournal(),sandboxJournal=journal('transferId');
  const initial={schemaVersion:1,revision:1,transferId:'transfer-one',owner:context.principalId,
    stage:'delivered',accountId,workerName,tokenId,target:routedTarget?routed:target,artifact:originalArtifact,
    registryProjectId:'project-one',registryInstallationId:'installation-one'};
  planJournal.records.set(initial.transferId,initial);
  const initialSandbox={transferId:initial.transferId,workerName:`${workerName}-widgets`,
    origin:initial.target.widgetSandboxOrigin,appOrigin:initial.target.origin,
    sourceSha:originalArtifact.sourceSha,artifactDigest:`sha256-${'1'.repeat(64)}`,
    artifactBytes:512,deploymentId:'sandbox-original',versionId:'sandbox-version-original'};
  sandboxJournal.records.set(initial.transferId,{schemaVersion:1,revision:1,
    stage:'confirmed',...initialSandbox});
  let remoteSandbox=initialSandbox,sandboxUploads=0,pauseSandboxPrepared=false,
    loseSandboxReply=false;
  const sandboxReceipt=transferId=>({transferId,workerName:`${workerName}-widgets`,
    origin:initial.target.widgetSandboxOrigin,appOrigin:initial.target.origin,
    sourceSha,artifactDigest:`sha256-${(transferId==='update-two'?'2':'3').repeat(64)}`,
    artifactBytes:513,deploymentId:`sandbox-${transferId}`,
    versionId:`sandbox-version-${transferId}`});
  const sandboxFactory=({target:requestedTarget})=>{
    assert.equal(requestedTarget.widgetSandboxOrigin,initial.target.widgetSandboxOrigin);
    return {
      async inspectSandbox({transferId}){
        events.push(`sandbox-inspect:${transferId}`);
        const saved=await sandboxJournal.load(transferId);
        const {schemaVersion,revision,stage,...expected}=saved??{};
        return saved&&schemaVersion===1&&revision>=1
          &&['prepared','upload-intent','confirmed'].includes(stage)
          &&remoteSandbox?.transferId===transferId
          &&JSON.stringify(remoteSandbox)===JSON.stringify(expected)
          ?{state:'confirmed',receipt:structuredClone(remoteSandbox)}:{state:'unknown'};
      },
      async publishSandbox({transferId,previousReceipt}){
        events.push(`sandbox-publish:${transferId}`);
        assert.deepEqual(previousReceipt,remoteSandbox,
          'the exact confirmed remote predecessor guards sandbox replacement');
        let saved=await sandboxJournal.load(transferId);
        if(!saved){
          saved={schemaVersion:1,revision:1,stage:'prepared',...sandboxReceipt(transferId)};
          await sandboxJournal.create(saved);
        }
        assert.equal(saved.stage,'prepared','an upload intent may only be inspected');
        if(pauseSandboxPrepared){pauseSandboxPrepared=false;
          throw new Error('sandbox stopped after prepared journal');}
        const intent={...saved,revision:saved.revision+1,stage:'upload-intent'};
        await sandboxJournal.compareAndSave(saved,intent);
        sandboxUploads++;events.push(`sandbox-upload:${transferId}`);
        remoteSandbox=sandboxReceipt(transferId);
        if(loseSandboxReply){loseSandboxReply=false;return {state:'unknown'};}
        const confirmed={...intent,revision:intent.revision+1,stage:'confirmed'};
        await sandboxJournal.compareAndSave(intent,confirmed);
        return {state:'confirmed',receipt:structuredClone(remoteSandbox)};
      }
    };
  };
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
  let uploadCount=0,schemaEffects=0,declareCount=0,updateIds=0;
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
    sandboxJournal,sandboxFactory,
    transferJournal:{load:async()=>null},publicationJournal:gateJournal,
    registryClient:client,publicationGate:gate,
    registryIdentity:{projectId:'project-one',installationId:'installation-one'},
    ...(cutoverFactory?{storageCutoverFactory:cutoverFactory}:{}),
    sourceIdentity:()=>({head:sourceSha,tree:'f'.repeat(40),sha256:'1'.repeat(64),dirty:false}),
    project:()=>projection,updateIdFactory:()=> `update-${++updateIds===1?'one':'two'}`,
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
    publishSandbox(){assert.fail('updates use the existing journalled sandbox publisher');},
    publisherFactory:({artifactRoot})=>({
      async deliver(input){events.push('publish');uploadCount++;
        assert.equal(artifactRoot,path.join(root,'.wrangler','delivery','updates','update-one','artifact'));
        assert.equal(input.expectedPreviousDeploymentId,'deployment-original');
        assert.equal(input.expectedPreviousVersionId,originalVersion);
        assert.equal(Object.hasOwn(input,'secretsPath'),false);
        if(rejectedUploadNoRemote)throw new CloudflarePublicationError('outcome_unknown',
          {phase:'wrangler',reason:'exit_nonzero',exitCode:1,apiCodes:[10021]});
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
    sandboxJournal,initialSandbox,
    setPauseSandboxPrepared(){pauseSandboxPrepared=true;},
    setLoseSandboxReply(){loseSandboxReply=true;},
    setRemoteSandbox(value){remoteSandbox=value;},
    get remoteSandbox(){return remoteSandbox;},
    get sandboxUploads(){return sandboxUploads;},
    get uploadCount(){return uploadCount;},get schemaEffects(){return schemaEffects;}};
}

async function legacyUnknownWorkerFixture(){
  const f=fixture();await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const old=f.updateJournal.records.get('update-one');
  f.updateJournal.records.set('update-one',{...old,revision:old.revision+1,
    stage:'delivery-unknown',artifact,schemaReceiptId:`sha256-${'7'.repeat(64)}`,
    publicationFailure:{phase:'unknown',reason:'unavailable',exitCode:null,apiCodes:[]}});
  const request={projectId:'project-one',installationId:'installation-one',
    target:'cloudflare',artifact};
  f.gateJournal.records.set('update-one',{state:'prepared',requestKey:'update-one',request,
    preflight:await f.options.registryClient.preflight(request)});
  return {f,prepared};
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
    assert.equal(f.sandboxUploads,1,'sandbox must be confirmed before routed cutover');
    assert.deepEqual(f.updateJournal.records.get('update-one').sandboxReceipt,
      f.remoteSandbox);
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
  assert.ok(f.events.indexOf('sandbox-upload:update-one')<f.events.indexOf('publish'));
  assert.equal(f.schemaEffects,0,'cutover owns additive schema effects');
});

test('routed sandbox ACK loss cannot fence routes or publish Worker before reconciliation',async()=>{
  let cutoverCalls=0;
  const f=fixture({routedTarget:true,cutoverFactory:input=>({async advance(){
    cutoverCalls++;
    await input.publication.deliver();
    assert.ok(await input.publication.inspect());
    return {state:'ready',phase:'open'};
  }})});
  await f.configure();f.setLoseSandboxReply();
  const prepared=await f.pipeline.prepareUpdate({},context);
  assert.equal((await f.pipeline.startUpdate(prepared,context)).phase,'delivery-unknown');
  assert.equal(f.updateJournal.records.get('update-one').stage,'sandbox-publishing');
  assert.equal(cutoverCalls,0);assert.equal(f.uploadCount,0);
  assert.equal(f.sandboxUploads,1);
  assert.equal((await f.pipeline.reconcileUpdate(prepared,context)).phase,'delivered');
  assert.equal(cutoverCalls,1);assert.equal(f.sandboxUploads,1);
});

async function routedUnknownFixture({rejected=false}={}){
  let f,proofReady=true;
  const cutoverFactory=input=>({
    async assertRetryReady(){
      assert.equal(input.nextTarget.schemaVersion,3);
      if(!proofReady)throw Object.assign(new Error('fences changed'),{code:'retry_not_ready'});
      return true;
    },
    async advance(){
      const old=await input.updateJournal.load('update-one');
      if(!old.cutover){
        await input.updateJournal.compareAndSave(old,{...old,revision:old.revision+1,
          cutover:{phase:'publishing',receipts:[
            {databaseId:routed.databaseId,receiptId:`sha256-${'1'.repeat(64)}`},
            {databaseId:routed.resources[0].databaseId,receiptId:`sha256-${'2'.repeat(64)}`} ]}});
        await input.publication.deliver();
      }
      if(f.current.deploymentId==='deployment-updated'
        &&await input.publication.inspect())return {state:'ready',phase:'open'};
      return {state:'pending',phase:'publishing'};
    }});
  f=fixture({routedTarget:true,cutoverFactory,
    ...(rejected?{rejectedUploadNoRemote:true}:{failedUploadNoRemote:true})});
  await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const unknown=await f.pipeline.startUpdate(prepared,context);
  assert.equal(unknown.phase,'delivery-unknown');
  assert.equal(f.uploadCount,1);
  assert.equal(f.gateJournal.records.get('update-one').state,'prepared');
  return {f,prepared,unknown,setProofReady:value=>{proofReady=value;}};
}

test('routed upload diagnostic reaches status and explicit retry opens the same cutover',async()=>{
  const {f,prepared,unknown}=await routedUnknownFixture();
  assert.equal(unknown.retryEligible,true);
  assert.deepEqual(unknown.diagnostic,{phase:'unknown',reason:'unavailable',
    exitCode:null,apiCodes:[]});
  assert.equal((await f.pipeline.statusUpdate(prepared.updateId,context)).retryEligible,true);
  const inspected=await f.pipeline.reconcileUpdate(prepared,context);
  assert.equal(inspected.phase,'delivery-unknown');
  assert.deepEqual(inspected.diagnostic,unknown.diagnostic);
  assert.equal(f.uploadCount,1,'reconcile only inspects the uncertain routed upload');
  const delivered=await f.pipeline.retryUpdate(prepared,context);
  assert.equal(delivered.phase,'delivered');
  assert.equal(delivered.retryEligible,false);
  assert.equal(f.uploadCount,2);
  assert.equal(f.events.filter(item=>item==='build').length,1);
  assert.equal(f.schemaEffects,0);
  assert.equal(f.updateJournal.records.get('update-one').publicationAttemptKey,'update-one.retry.1');
  assert.equal(f.gateJournal.records.get('update-one.retry.1').state,'synchronized');
});

test('routed retry refuses changed remote head or fenced-route proof before upload',async()=>{
  for(const drift of ['latest','fences']){
    const {f,prepared,setProofReady}=await routedUnknownFixture();
    if(drift==='latest')f.control.latestVersion=async()=>({id:updatedVersion});
    else setProofReady(false);
    await assert.rejects(f.pipeline.retryUpdate(prepared,context),
      {code:drift==='latest'?'delivery_unknown':'retry_not_ready'});
    assert.equal(f.uploadCount,1);
    assert.equal(f.gateJournal.records.has('update-one.retry.1'),false);
  }
});

test('routed validation refusal keeps diagnostic and disables retry',async()=>{
  const {f,prepared,unknown}=await routedUnknownFixture({rejected:true});
  assert.deepEqual(unknown.diagnostic,{phase:'wrangler',reason:'exit_nonzero',exitCode:1,
    apiCodes:[10021],validationIssue:'unknown_validation'});
  assert.equal(unknown.retryEligible,false);
  await assert.rejects(f.pipeline.retryUpdate(prepared,context),{code:'update_not_ready'});
  assert.equal(f.uploadCount,1);
});

test('routed preflight outage retains the last upload diagnostic and retry key',async()=>{
  const {f,prepared,unknown}=await routedUnknownFixture();
  const preflight=f.options.registryClient.preflight;
  let unavailable=true;
  f.options.registryClient.preflight=async request=>{
    if(unavailable){unavailable=false;throw new Error('registry unavailable');}
    return preflight(request);
  };
  const pending=await f.pipeline.retryUpdate(prepared,context);
  assert.equal(pending.phase,'delivery-unknown');
  assert.deepEqual(pending.diagnostic,unknown.diagnostic);
  assert.equal(f.updateJournal.records.get('update-one').publicationAttemptKey,'update-one.retry.1');
  assert.equal(f.gateJournal.records.has('update-one.retry.1'),false);
  assert.equal(f.uploadCount,1);
  assert.equal((await f.pipeline.retryUpdate(prepared,context)).phase,'delivered');
  assert.equal(f.updateJournal.records.get('update-one').publicationRetryCount,1);
  assert.equal(f.uploadCount,2);
});

test('routed sandbox drift inside the retry gate cannot erase the last upload diagnostic',async()=>{
  const {f,prepared,unknown}=await routedUnknownFixture();
  const preflight=f.options.registryClient.preflight;
  f.options.registryClient.preflight=async request=>{
    const result=await preflight(request);
    f.setRemoteSandbox({...f.remoteSandbox,versionId:'foreign-sandbox-version'});
    return result;
  };
  const pending=await f.pipeline.retryUpdate(prepared,context);
  assert.equal(pending.phase,'delivery-unknown');
  assert.deepEqual(pending.diagnostic,unknown.diagnostic);
  assert.equal(f.uploadCount,1);
  assert.equal(f.gateJournal.records.get('update-one.retry.1').state,'prepared');
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
    assert.equal(f.updateJournal.records.get('update-one').stage,'sandbox-ready');
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
  assert.equal(f.sandboxUploads,1);
  assert.deepEqual(f.updateJournal.records.get('update-one').sandboxPreviousReceipt,
    f.initialSandbox);
  assert.deepEqual(f.updateJournal.records.get('update-one').sandboxReceipt,f.remoteSandbox);
  assert.equal(f.updateJournal.records.get('update-one').sandboxReceipt.sourceSha,sourceSha);
  assert.ok(f.events.indexOf('sandbox-upload:update-one')<f.events.indexOf('publish'));
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

test('retry refuses a changed sandbox head before a second Worker upload',async()=>{
  const f=fixture({failedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  assert.equal((await f.pipeline.startUpdate(prepared,context)).phase,'delivery-unknown');
  assert.equal(f.sandboxUploads,1);assert.equal(f.uploadCount,1);
  f.setRemoteSandbox({...f.remoteSandbox,versionId:'foreign-sandbox-version'});
  await assert.rejects(f.pipeline.retryUpdate(prepared,context),
    error=>['sandbox_unknown','sandbox_lineage_changed'].includes(error.code));
  assert.equal(f.uploadCount,1);
  assert.equal(f.events.filter(item=>item==='retry-publish').length,0);
  assert.equal(f.gateJournal.records.has('update-one.retry.1'),false);
});

test('Worker 10021 cannot become a retry after sandbox drift',async()=>{
  const f=fixture({rejectedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  assert.equal((await f.pipeline.startUpdate(prepared,context)).phase,'delivery-unknown');
  assert.equal(f.updateJournal.records.get('update-one').publicationFailure.apiCodes[0],10021);
  f.setRemoteSandbox({...f.remoteSandbox,versionId:'foreign-sandbox-version'});
  await assert.rejects(f.pipeline.retryUpdate(prepared,context),{code:'update_not_ready'});
  assert.equal(f.sandboxUploads,1);assert.equal(f.uploadCount,1);
  assert.equal(f.gateJournal.records.has('update-one.retry.1'),false);
});

test('retry of a legacy unknown Worker delivery publishes its missing sandbox before Worker',async()=>{
  const {f,prepared}=await legacyUnknownWorkerFixture();
  assert.equal(f.sandboxJournal.records.has('update-one'),false);
  assert.equal(f.sandboxUploads,0);
  const result=await f.pipeline.retryUpdate(prepared,context);
  assert.equal(result.phase,'delivered');
  assert.equal(f.sandboxUploads,1);assert.equal(f.uploadCount,1);
  assert.deepEqual(f.updateJournal.records.get('update-one').sandboxPreviousReceipt,
    f.initialSandbox);
  assert.deepEqual(f.updateJournal.records.get('update-one').sandboxReceipt,f.remoteSandbox);
  assert.ok(f.events.indexOf('sandbox-upload:update-one')<
    f.events.indexOf('retry-publish'));
});

for(const guard of ['gate','artifact','limit'])
  test(`legacy retry refuses ${guard} before any sandbox upload`,async()=>{
    const {f,prepared}=await legacyUnknownWorkerFixture();
    let pipeline=f.pipeline;
    if(guard==='gate'){
      const saved=f.gateJournal.records.get('update-one');
      f.gateJournal.records.set('update-one',{...saved,state:'delivered'});
    }
    if(guard==='limit'){
      const saved=f.updateJournal.records.get('update-one');
      f.updateJournal.records.set('update-one',{...saved,publicationRetryCount:3});
    }
    if(guard==='artifact'){
      const original=f.options.publisherFactory;
      f.options.publisherFactory=input=>({...original(input),verifyPreservedUpdate(){
        throw Object.assign(new Error('preserved artifact changed'),{code:'artifact_changed'});
      }});
      pipeline=createCloudflareDeliveryPipeline(f.options);
      await pipeline.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
    }
    await assert.rejects(pipeline.retryUpdate(prepared,context),
      {code:guard==='gate'?'update_not_ready':guard==='limit'?'retry_limit':'artifact_changed'});
    assert.equal(f.sandboxUploads,0);assert.equal(f.uploadCount,0);
    assert.equal(f.sandboxJournal.records.has('update-one'),false);
    assert.equal(f.gateJournal.records.has('update-one.retry.1'),false);
  });

test('changed main Worker head just before sandbox upload refuses without a sandbox effect',async()=>{
  const f=fixture();await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const load=f.sandboxJournal.load;
  f.sandboxJournal.load=async id=>{
    const record=await load(id);
    if(id==='update-one')f.current.versionId='44444444-4444-4444-8444-444444444444';
    return record;
  };
  await assert.rejects(f.pipeline.startUpdate(prepared,context),{code:'deployment_changed'});
  assert.equal(f.schemaEffects,1);
  assert.equal(f.sandboxUploads,0);assert.equal(f.uploadCount,0);
  assert.equal(f.sandboxJournal.records.has('update-one'),false);
});

test('explicit rejection requires Cloudflare 10021 and preserves the old Worker and additive schema',async()=>{
  const f=fixture({rejectedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  const unknown=await f.pipeline.startUpdate(input,context);
  assert.equal(unknown.phase,'delivery-unknown');
  assert.equal(unknown.retryEligible,false);
  assert.deepEqual(unknown.diagnostic,{phase:'wrangler',reason:'exit_nonzero',exitCode:1,
    apiCodes:[10021],validationIssue:'unknown_validation'});
  await assert.rejects(f.pipeline.retryUpdate(input,context),{code:'update_not_ready'});
  assert.equal(f.uploadCount,1);
  const rejected=await f.pipeline.rejectUpdate(input,context);
  assert.equal(rejected.phase,'rejected');
  assert.equal(rejected.registryStatus,'pending');
  assert.equal(rejected.retryEligible,false);
  assert.equal(f.updateJournal.records.get('update-one').rejectionProof.previousVersionId,originalVersion);
  assert.equal(f.gateJournal.records.get('update-one').state,'prepared');
  assert.equal(f.current.deploymentId,'deployment-original');
  assert.equal(f.uploadCount,1);
  assert.equal(f.schemaEffects,1);
  assert.equal((await f.pipeline.reconcileUpdate(input,context)).phase,'rejected');
  assert.equal((await f.pipeline.rejectUpdate(input,context)).phase,'rejected');
  await assert.rejects(f.pipeline.startUpdate(input,context),{code:'update_in_progress'});
  await assert.rejects(f.pipeline.retryUpdate(input,context),{code:'update_not_ready'});
  assert.equal((await f.pipeline.inspectUpdate(context)).activeUpdateId,null);
  const next=await f.pipeline.prepareUpdate({},context);
  assert.equal(next.updateId,'update-two');
  assert.equal(f.uploadCount,1);
  assert.equal(f.schemaEffects,1);
});

test('rejection fails closed on changed remote head, gate artifact, owner, or journal CAS',async()=>{
  for(const changed of ['head','deployment','gate','artifact','owner','cas']){
    const f=fixture({rejectedUploadNoRemote:true});await f.configure();
    const prepared=await f.pipeline.prepareUpdate({},context);
    const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
    assert.equal((await f.pipeline.startUpdate(input,context)).phase,'delivery-unknown');
    if(changed==='head')f.control.latestVersion=async()=>({id:updatedVersion});
    if(changed==='deployment')f.current.deploymentId='deployment-foreign';
    if(changed==='gate')f.gateJournal.records.set('update-one',
      {...f.gateJournal.records.get('update-one'),state:'delivered'});
    if(changed==='artifact'){
      const gate=f.gateJournal.records.get('update-one');
      f.gateJournal.records.set('update-one',{...gate,request:{...gate.request,
        artifact:{...gate.request.artifact,artifactDigest:`sha256-${'f'.repeat(64)}`}}});
    }
    if(changed==='cas')f.updateJournal.compareAndSave=async()=>{throw new Error('conflict');};
    await assert.rejects(f.pipeline.rejectUpdate(input,changed==='owner'
      ?{...context,principalId:'other'}:context));
    assert.equal(f.updateJournal.records.get('update-one').stage,'delivery-unknown');
    assert.equal(f.uploadCount,1);
    assert.equal(f.schemaEffects,1);
  }
});

test('an ambiguous upload without a 10021 refusal cannot be rejected',async()=>{
  const f=fixture({failedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  assert.equal((await f.pipeline.startUpdate(input,context)).phase,'delivery-unknown');
  await assert.rejects(f.pipeline.rejectUpdate(input,context),{code:'update_not_ready'});
  assert.equal((await f.pipeline.inspectUpdate(context)).activeUpdateId,'update-one');
  assert.equal(f.uploadCount,1);
});

test('preflight failure leaves a durable retry key that can resume without allocating another',async()=>{
  const f=fixture({failedUploadNoRemote:true});await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const input={updateId:prepared.updateId,planDigest:prepared.planDigest};
  const unknown=await f.pipeline.startUpdate(input,context);
  assert.equal(unknown.phase,'delivery-unknown');
  const preflight=f.options.registryClient.preflight;
  let failOnce=true;
  f.options.registryClient.preflight=async request=>{
    if(failOnce){failOnce=false;throw new Error('synthetic registry outage');}
    return preflight(request);
  };
  const pending=await f.pipeline.retryUpdate(input,context);
  assert.equal(pending.phase,'delivery-unknown');
  assert.deepEqual(pending.diagnostic,unknown.diagnostic);
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

test('a legacy update finds the initial sandbox receipt and a later update follows the new receipt',async()=>{
  const f=fixture();await f.configure();
  const first=await f.pipeline.prepareUpdate({},context);
  await f.pipeline.startUpdate(first,context);
  const firstReceipt=f.updateJournal.records.get('update-one').sandboxReceipt;
  assert.deepEqual(f.updateJournal.records.get('update-one').sandboxPreviousReceipt,
    f.initialSandbox);
  f.options.updateIdFactory=()=> 'update-two';
  const originalBuild=f.options.buildUpdateTarget;
  f.options.buildUpdateTarget=async input=>input.updateId==='update-two'
    ?(f.events.push('build-two'),artifact):originalBuild(input);
  const originalPublisher=f.options.publisherFactory;
  f.options.publisherFactory=input=>input.artifactRoot.includes(`${path.sep}update-two${path.sep}`)
    ?{async deliver(request){
      f.events.push('publish-two');
      assert.equal(request.expectedPreviousDeploymentId,'deployment-updated');
      assert.equal(request.expectedPreviousVersionId,updatedVersion);
      f.current.deploymentId='deployment-second';
      f.current.versionId='44444444-4444-4444-8444-444444444444';
      f.current.tag='cz-update-two';
      return {deploymentId:'deployment-second',url:origin,publishedSha:sourceSha,artifact};
    },async inspect(){return {deploymentId:'deployment-second',url:origin,
      publishedSha:sourceSha,artifact};},
    async inspectCurrent(){return {deploymentId:f.current.deploymentId,
      versionId:f.current.versionId,bindings:f.current.bindings};}}:originalPublisher(input);
  const next=createCloudflareDeliveryPipeline(f.options);
  await next.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  const second=await next.prepareUpdate({},context);
  assert.equal((await next.startUpdate(second,context)).phase,'delivered');
  const record=f.updateJournal.records.get('update-two');
  assert.equal(record.previousPublicationId,'update-one');
  assert.deepEqual(record.sandboxPreviousReceipt,firstReceipt);
  assert.deepEqual(record.sandboxReceipt,f.remoteSandbox);
  assert.equal(f.sandboxUploads,2);
  assert.ok(f.events.indexOf('sandbox-upload:update-two')<f.events.indexOf('publish-two'));
});

test('legacy delivered updates without sandbox receipts trace back to the initial publication',async()=>{
  const f=fixture();await f.configure();
  for(const [id,prior,priorArtifact] of [
    ['update-legacy-one','transfer-one',originalArtifact],
    ['update-legacy-two','update-legacy-one',artifact]
  ]){
    f.updateJournal.records.set(id,{schemaVersion:1,revision:7,
      updateId:id,owner:context.principalId,stage:'delivered',
      accountId,workerName,tokenId,target,artifact,
      previousPublicationId:prior,previousArtifact:priorArtifact,
      registryProjectId:'project-one',registryInstallationId:'installation-one'});
    f.gateJournal.records.set(id,{state:'synchronized',declaration:{
      deploymentId:`deployment-${id}`,url:new URL(origin).href,publishedSha:sourceSha,
      artifact}});
  }
  f.current.deploymentId='deployment-update-legacy-two';
  f.current.versionId='44444444-4444-4444-8444-444444444444';
  f.current.tag='cz-update-legacy-two';
  f.current.message=`Creezio ${artifact.artifactDigest} ${artifact.sourceSha}`;
  const prepared=await f.pipeline.prepareUpdate({},context);
  assert.equal(f.updateJournal.records.get('update-one').previousPublicationId,
    'update-legacy-two');
  const originalPublisher=f.options.publisherFactory;
  f.options.publisherFactory=input=>({
    ...originalPublisher(input),
    async deliver(request){
      f.events.push('publish-legacy-successor');
      assert.equal(request.expectedPreviousDeploymentId,'deployment-update-legacy-two');
      assert.equal(request.expectedPreviousVersionId,
        '44444444-4444-4444-8444-444444444444');
      f.current.deploymentId='deployment-updated';f.current.versionId=updatedVersion;
      f.current.tag='cz-update-one';
      f.current.message=`Creezio ${artifact.artifactDigest} ${artifact.sourceSha}`;
      return {deploymentId:'deployment-updated',url:origin,publishedSha:sourceSha,artifact};
    }
  });
  const successor=createCloudflareDeliveryPipeline(f.options);
  await successor.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  assert.equal((await successor.startUpdate(prepared,context)).phase,'delivered');
  assert.deepEqual(f.updateJournal.records.get('update-one').sandboxPreviousReceipt,
    f.initialSandbox);
  assert.equal(f.sandboxUploads,1);
  assert.ok(f.events.indexOf('sandbox-upload:update-one')<
    f.events.indexOf('publish-legacy-successor'));
});

test('sandbox upload ACK loss reconciles without a second upload or early Worker publication',async()=>{
  const f=fixture();await f.configure();f.setLoseSandboxReply();
  const prepared=await f.pipeline.prepareUpdate({},context);
  const first=await f.pipeline.startUpdate(prepared,context);
  assert.equal(first.phase,'delivery-unknown');
  assert.equal(f.updateJournal.records.get('update-one').stage,'sandbox-publishing');
  assert.equal(f.sandboxJournal.records.get('update-one').stage,'upload-intent');
  assert.equal(f.sandboxUploads,1);assert.equal(f.uploadCount,0);
  assert.equal(f.events.includes('publish'),false);
  const resumed=await f.pipeline.reconcileUpdate(prepared,context);
  assert.equal(resumed.phase,'delivered');
  assert.equal(f.sandboxUploads,1);assert.equal(f.uploadCount,1);
  assert.deepEqual(f.updateJournal.records.get('update-one').sandboxReceipt,f.remoteSandbox);
});

test('a prepared sandbox journal resumes through publishSandbox before upload intent',async()=>{
  const f=fixture();await f.configure();f.setPauseSandboxPrepared();
  const prepared=await f.pipeline.prepareUpdate({},context);
  await assert.rejects(f.pipeline.startUpdate(prepared,context),
    /sandbox stopped after prepared journal/);
  assert.equal(f.updateJournal.records.get('update-one').stage,'sandbox-publishing');
  assert.equal(f.sandboxJournal.records.get('update-one').stage,'prepared');
  assert.equal(f.sandboxUploads,0);assert.equal(f.uploadCount,0);
  assert.equal((await f.pipeline.statusUpdate('update-one',context)).phase,'delivery-unknown');
  assert.equal((await f.pipeline.reconcileUpdate(prepared,context)).phase,'delivered');
  assert.equal(f.sandboxUploads,1);assert.equal(f.uploadCount,1);
});

test('a divergent remote sandbox blocks Worker upload and keeps the update unresolved',async()=>{
  const f=fixture();await f.configure();
  const prepared=await f.pipeline.prepareUpdate({},context);
  f.setRemoteSandbox({...f.initialSandbox,versionId:'foreign-version'});
  await assert.rejects(f.pipeline.startUpdate(prepared,context),
    error=>['sandbox_unknown','sandbox_lineage_changed'].includes(error.code));
  assert.equal(f.sandboxUploads,0);assert.equal(f.uploadCount,0);
  assert.equal(f.events.includes('publish'),false);
});

test('a sandbox receipt with a different source SHA never authorizes Worker publication',async()=>{
  const f=fixture();
  const original=f.options.sandboxFactory;
  f.options.sandboxFactory=input=>{
    const port=original(input);
    return {...port,async publishSandbox(args){
      const result=await port.publishSandbox(args);
      return {...result,receipt:{...result.receipt,sourceSha:'f'.repeat(40)}};
    }};
  };
  const pipeline=createCloudflareDeliveryPipeline(f.options);
  await pipeline.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  const prepared=await pipeline.prepareUpdate({},context);
  await assert.rejects(pipeline.startUpdate(prepared,context),{code:'sandbox_unknown'});
  assert.equal(f.sandboxUploads,1);assert.equal(f.uploadCount,0);
  assert.equal(f.updateJournal.records.get('update-one').sandboxReceipt,undefined);
});

test('missing production vault binding blocks preparation without local reads',async()=>{
  const f=fixture();await f.configure();
  f.current.bindings=f.current.bindings.filter(item=>item.name!=='CREEZIO_VAULT_KEYRING');
  await assert.rejects(f.pipeline.prepareUpdate({},context),error=>error.code==='unmanaged_worker');
  assert.equal(f.updateJournal.records.size,0);
});
