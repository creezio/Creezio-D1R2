import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {createCloudflareDeliveryPipeline} from '../../scripts/cloudflare/pipeline.mjs';
import {cloudflareWorkerConfiguration} from '../../scripts/cloudflare/config.mjs';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createStorageFixture} from '../data/fixtures/storage.mjs';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const digest=letter=>`sha256-${letter.repeat(64)}`;
const accountId='a'.repeat(32),tokenId='b'.repeat(32),sourceSha='c'.repeat(40),
  sourceFingerprint='d'.repeat(64),installationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ids=['11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'];
const workerName='creezio-routed-test',origin=`https://${workerName}.example.workers.dev`;
const context={principalId:'principal-one'};
const plan={applicationId:'application',planDigest:digest('1'),compositionDigest:digest('2'),
  lockDigest:digest('3'),modelDigest:digest('4'),sqlDigest:digest('5'),objects:[]};
const targetPlan={...plan,compositionDigest:digest('6'),planDigest:digest('7')};
const artifact={sourceSha,artifactDigest:digest('8'),compositionDigest:targetPlan.compositionDigest,
  coreVersion:'1',contractVersion:'1'};
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;

function journal(key){
  const records=new Map();
  return {records,async load(id){return structuredClone(records.get(id)??null);},
    async findActive(){return null;},
    async create(value){records.set(value[key]??value.plan.transferId,structuredClone(value));},
    async compareAndSave(old,next){const id=next[key]??next.plan.transferId;
      assert.deepEqual(records.get(id),old);records.set(id,structuredClone(next));}};
}

async function fixture({wrongBindings=false,wrongDeclarationUrl=false,
  wrongDeclarationSha=false}={}){
  const source=await createStorageFixture();
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{A:'routed-first-pair'},d1Persist:false,
    telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  try{
    const primary=source.db,target=await runtime.getD1Database('A');
    const ddl=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
    await primary.batch(ddl.statements.map(sql=>primary.prepare(sql)));
    await target.batch(ddl.statements.map(sql=>target.prepare(sql)));
    const epoch=(await primary.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
      WHERE id='application'`).first()).epoch;
    const input={installationId,contextId:'tenant-a',slot:1,
      mutationId:'transfer:tenant-a',commandDigest:digest('9'),expectedGeneration:3};
    await target.prepare(`INSERT INTO ${routes}
      (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
      VALUES (?,?,?,4,'deny',?,?,0)`)
      .bind('tenant-a',installationId,1,input.mutationId,epoch).run();
    const config={root,storageInstallationId:installationId,storageResources:[{
      contextId:'tenant-a',slot:1,status:'active',databaseId:'local-tenant-a',
      databaseName:'local-tenant-a',bucketName:'local-tenant-a'}]};
    const planJournal=journal('transferId'),provisionJournal=journal('transferId');
    const transferJournal={async load(){return null;}};
    const manifests=new Map();let targetManifest,gateRecord=null,publishes=0,stopCount=0;
    const control={accountId,async inspectConnection(){return {accountId,tokenId,
      workersSubdomain:'example'};},async bucket(){return {private:true};},
      async workerSettings(){const expected=cloudflareWorkerConfiguration(targetManifest);
        const bindings=[...expected.d1_databases.map(item=>({name:item.binding,type:'d1',
          id:item.database_id})),...expected.r2_buckets.map(item=>({name:item.binding,
          type:'r2_bucket',bucket_name:item.bucket_name})),
          ...Object.entries(expected.vars).map(([name,text])=>({name,type:'plain_text',text})),
          {name:'CREEZIO_VAULT_KEYRING',type:'secret_text'}];
        return {bindings:wrongBindings?bindings.filter(item=>item.name!=='BUCKET_RESOURCE_01'):
          bindings};}};
    const proof={deploymentId:'deployment-one',url:origin,publishedSha:sourceSha,artifact};
    const options={config,planJournal,provisionJournal,transferJournal,
      publicationJournal:{async get(){return gateRecord;}},
      publicationGate:{async publish(_request,id,deliver){
        publishes++;await deliver();gateRecord={state:'synchronized',declaration:{
          deploymentId:'deployment-one',
          url:wrongDeclarationUrl?'https://wrong.example/':new URL(origin).href,
          publishedSha:wrongDeclarationSha?'f'.repeat(40):sourceSha,artifact}};
        return {state:'synchronized',record:gateRecord};}},
      registryClient:{async preflight(request){return {projectId:request.projectId,
        installationId:request.installationId,preflightId:'preflight-one',
        expiresAt:new Date(Date.now()+60_000).toISOString()};}},
      registryIdentity:{projectId:'project-one',installationId:'installation-one'},
      sourceIdentity:()=>({head:sourceSha,tree:'e'.repeat(40),
        sha256:sourceFingerprint,dirty:false}),
      project:()=>({sourcePlan:plan,targetPlan,compatibilityDigest:digest('a')}),
      transferIdFactory:()=> 'transfer-one',secretConnections:async()=>[],
      sourceKeyring:async()=>null,controlFactory:()=>control,
      provisionerFactory:()=>({async provision(request){return {state:'ready',target:{
        accountId,workerName,databaseId:request.transferId==='transfer-one'?ids[0]:ids[1],
        bucketName:request.bucketName,origin}};}}),
      targetVault:{async loadOrCreate(){return {keyring:{},secretsPath:'synthetic'};}},
      stopRuntime:async()=>{stopCount++;},
      capture:async request=>{const manifest={identity:{transferId:request.transferId,
        planDigest:plan.planDigest,target:request.target,
        ...(request.sourceContextId?{sourceContextId:request.sourceContextId,routeFence:input}:{})}};
        manifests.set(request.transferId,manifest);
        return {manifest,async release(){}};},
      loadCapture:async request=>manifests.get(request.transferId),
      buildTarget:async request=>{targetManifest=request.target;return artifact;},
      d1Factory:({databaseId})=>({metadata:async()=>({uuid:databaseId}),databaseId}),
      d1BindingFactory:client=>client.databaseId===ids[0]?primary:target,
      r2Factory:async()=>({}),objectPortFactory:()=>({}),
      applySchema:async()=>({ok:true,observedState:'ready'}),
      inspectSchema:async()=>({state:'ready'}),
      inspectManagedSchema:async()=>({ok:true,receipt:{...targetPlan}}),
      importTransfer:async()=>{},verifyTransfer:async()=>{},
      publishSandbox:async()=>({state:'confirmed',receipt:{origin:
        `https://${workerName}-widgets.example.workers.dev`}}),
      publisherFactory:()=>({async deliver(){return proof;},async inspect(){return proof;}})};
    return {primary,target,input,options,planJournal,
      get publishes(){return publishes;},get stopCount(){return stopCount;},
      pipeline:()=>createCloudflareDeliveryPipeline(options),
      async dispose(){await runtime.dispose();await source.dispose();}};
  }catch(error){await runtime.dispose();await source.dispose();throw error;}
}

test('first routed publication opens only after exact Worker and registry proof',
  {timeout:60000},async()=>{
    const f=await fixture();
    try{
      const pipeline=f.pipeline();
      await pipeline.configure({target:{accountId,workerName},
        credentials:{apiToken:'synthetic-cloudflare-token-value'}},context);
      const prepared=await pipeline.prepare({secretSelections:[]},context);
      const result=await pipeline.start(prepared,context);
      assert.equal(result.phase,'delivered');assert.equal(f.publishes,1);
      assert.equal(f.stopCount,1);
      const route=await f.target.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.deepEqual(route,{state:'active',generation:4});
      assert.equal((await f.primary.prepare(`SELECT state FROM
        "${STORAGE_AUTHORITY_TABLES.storage_mutations}" WHERE id=?`)
        .bind(f.input.mutationId).first()).state,'open');
    }finally{await f.dispose();}
  });

test('a missing routed bucket binding leaves imported data denied',
  {timeout:60000},async()=>{
    const f=await fixture({wrongBindings:true});
    try{
      const pipeline=f.pipeline();
      await pipeline.configure({target:{accountId,workerName},
        credentials:{apiToken:'synthetic-cloudflare-token-value'}},context);
      const prepared=await pipeline.prepare({secretSelections:[]},context);
      await assert.rejects(pipeline.start(prepared,context),{code:'delivery_unknown'});
      assert.equal((await f.target.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
      assert.equal(f.planJournal.records.get('transfer-one').stage,'opening');
    }finally{await f.dispose();}
  });

for(const [field,settings] of [
  ['URL',{wrongDeclarationUrl:true}],['SHA',{wrongDeclarationSha:true}]])
  test(`a synchronized declaration with divergent ${field} leaves first-publication routes denied`,
    {timeout:60000},async()=>{
      const f=await fixture(settings);
      try{
        const pipeline=f.pipeline();
        await pipeline.configure({target:{accountId,workerName},
          credentials:{apiToken:'synthetic-cloudflare-token-value'}},context);
        const prepared=await pipeline.prepare({secretSelections:[]},context);
        await assert.rejects(pipeline.start(prepared,context),{code:'delivery_unknown'});
        assert.equal((await f.target.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
        assert.equal(f.planJournal.records.get('transfer-one').stage,'opening');
      }finally{await f.dispose();}
    });
