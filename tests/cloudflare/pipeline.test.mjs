import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createCloudflareDeliveryPipeline} from '../../scripts/cloudflare/pipeline.mjs';
import {createPublicationGate} from '../../core/registry/publication.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const accountId='a'.repeat(32),token='synthetic-cloudflare-token-value',tokenId='b'.repeat(32),
  databaseId='11111111-1111-4111-8111-111111111111',workerName='creezio-test',
  sourceSha='c'.repeat(40),sourceFingerprint='d'.repeat(64),
  sourcePlanDigest=`sha256-${'1'.repeat(64)}`,targetPlanDigest=`sha256-${'2'.repeat(64)}`,
  targetCompositionDigest=`sha256-${'3'.repeat(64)}`,
  artifactDigest=`sha256-${'4'.repeat(64)}`;
const context={principalId:'principal-one',sessionId:'session-one',epoch:1};
function journal(){
  const records=new Map();
  return {records,async load(id){return structuredClone(records.get(id)??null);},
    async findActive(owner){return [...records.values()].find(item=>item.owner===owner
      &&item.stage!=='delivered')?.transferId??null;},
    async create(next){if(records.has(next.transferId??next.plan.transferId))throw new Error('duplicate');
      records.set(next.transferId??next.plan.transferId,structuredClone(next));},
    async compareAndSave(previous,next){const id=next.transferId??next.plan.transferId;
      assert.deepEqual(records.get(id),previous);assert.equal(next.revision,previous.revision+1);
      records.set(id,structuredClone(next));}};
}
function registryJournal(){
  const records=new Map();
  return {records,async get(key){return records.get(key)??null;},
    async claim(record){const old=records.get(record.requestKey)??null;if(!old)records.set(record.requestKey,record);return old;},
    async saveDelivered(record){assert.equal(records.get(record.requestKey).state,'prepared');
      records.set(record.requestKey,record);},
    async saveSynchronized(record){assert.equal(records.get(record.requestKey).state,'delivered');
      records.set(record.requestKey,record);}};
}
function fixture({unknownPublish=false,failImportOnce=false,provisionUnknownOnce=false}={}){
  const events=[],planJournal=journal(),provisionJournal=journal(),transferJournal={load:async()=>null},
    publicationJournal=registryJournal();
  const origin=`https://${workerName}.example.workers.dev`,sandboxOrigin=
    `https://${workerName}-widgets.example.workers.dev`;
  const sourcePlan={applicationId:'application',planDigest:sourcePlanDigest,
    modelDigest:`sha256-${'5'.repeat(64)}`,sqlDigest:`sha256-${'8'.repeat(64)}`,
    objects:[],compositionDigest:`sha256-${'6'.repeat(64)}`},
    targetPlan={applicationId:'application',planDigest:targetPlanDigest,
      modelDigest:sourcePlan.modelDigest,sqlDigest:sourcePlan.sqlDigest,objects:[],
      compositionDigest:targetCompositionDigest};
  const projection={sourcePlan,targetPlan,compatibilityDigest:`sha256-${'7'.repeat(64)}`};
  const artifact={sourceSha,artifactDigest,compositionDigest:targetCompositionDigest,
    coreVersion:'1.0.0',contractVersion:'1.0.0'};
  const receipt={deploymentId:'deployment-one',url:origin,artifact};
  const client={async preflight(request){events.push('preflight');return {preflightId:`preflight-${events.length}`,
    projectId:request.projectId,installationId:request.installationId,
    checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300_000).toISOString()};},
    async declare(){events.push('declare');return {projectId:'project-one',installationId:'installation-one',
      deploymentId:'deployment-one',declaredAt:new Date().toISOString(),replayed:false};}};
  const gate=createPublicationGate({client,journal:publicationJournal});
  let delivers=0,imports=0;
  const options={config:{root},planJournal,provisionJournal,transferJournal,publicationJournal,
    registryClient:client,publicationGate:gate,
    registryIdentity:{projectId:'project-one',installationId:'installation-one'},
    sourceIdentity:()=>({head:sourceSha,tree:'e'.repeat(40),sha256:sourceFingerprint,dirty:false}),
    project:()=>projection,transferIdFactory:()=> 'transfer-one',
    secretConnections:async()=>[],sourceKeyring:async()=>null,
    controlFactory:({accountId:given,token:givenToken})=>{
      assert.equal(given,accountId);assert.equal(givenToken,token);
      return {accountId,async inspectConnection(){events.push('connection');return {accountId,tokenId,
        workersSubdomain:'example'};},
      async bucket(){events.push('bucket');return {private:true};}};},
    provisionerFactory:()=>({async provision(){events.push('provision');
      if(provisionUnknownOnce&&events.filter(item=>item==='provision').length===1)return {state:'unknown'};
      return {state:'ready',
      target:{accountId,workerName,databaseId,bucketName:`${workerName}-files`,origin}};}}),
    targetVault:{async loadOrCreate(){events.push('vault');return {keyring:{seal(){},open(){}},
      secretsPath:'.wrangler/delivery/vaults/transfer-one-secrets.json'};}},
    stopRuntime:async()=>{events.push('stop');},
    capture:async input=>{events.push('capture');assert.equal(input.target.origin,origin);
      return {manifest:{identity:{planDigest:sourcePlanDigest}},async release(){}};},
    loadCapture:async()=>({identity:{planDigest:sourcePlanDigest}}),
    buildTarget:async()=>{events.push('build');return artifact;},
    d1Factory:()=>({metadata:async()=>({uuid:databaseId})}),d1BindingFactory:()=>({}),
    r2Factory:async input=>{assert.equal(input.accessKeyId,tokenId);
      assert.equal(input.secretAccessKey,createHash('sha256').update(token).digest('hex'));return {};},
    objectPortFactory:()=>({}),
    applySchema:async()=>{events.push('schema');return {ok:true,observedState:'ready'};},
    importTransfer:async()=>{events.push('import');imports++;
      if(failImportOnce&&imports===1)throw new Error('temporary import failure');},
    verifyTransfer:async()=>{events.push('verify');return {ok:true};},
    publishSandbox:async()=>{events.push('sandbox');return {state:'confirmed',receipt:{origin:sandboxOrigin}};},
    publisherFactory:()=>({async deliver(){events.push('publish');delivers++;
      if(unknownPublish)throw new Error('reply lost');return receipt;},
      async inspect(){events.push('inspect-worker');return receipt;}}),
  };
  const create=()=>createCloudflareDeliveryPipeline(options);
  return {create,options,events,planJournal,publicationJournal,get delivers(){return delivers;}};
}

test('prepare is non-disruptive; first SQL follows preflight, then verified transfer precedes upload',async()=>{
  const f=fixture(),pipeline=f.create();
  assert.equal((await pipeline.inspect(context)).target,null);
  const configured=await pipeline.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  assert.equal(configured.configuration,'ready');
  assert.deepEqual(configured.target,{accountId,workerName});
  assert.equal((await pipeline.inspect({...context,principalId:'another-principal'})).target,null);
  const prepared=await pipeline.prepare({secretSelections:[]},context);
  assert.equal(prepared.transferId,'transfer-one');
  assert.equal(prepared.summary.title,'Première livraison Cloudflare');
  assert.equal(f.events.includes('stop'),false);
  assert.equal(f.events.includes('capture'),false);
  await assert.rejects(pipeline.reconcile(
    {transferId:prepared.transferId,planDigest:prepared.planDigest},context),
  error=>error.code==='transfer_not_started');
  assert.equal(f.events.includes('stop'),false);
  const status=await pipeline.start({transferId:prepared.transferId,planDigest:prepared.planDigest},context);
  assert.equal(status.phase,'delivered');assert.equal(status.finalUrl,
    `https://${workerName}.example.workers.dev/`);
  const ordered=f.events.filter(item=>['stop','capture','build','preflight','schema','import','verify',
    'sandbox','publish','declare'].includes(item));
  assert.deepEqual(ordered,['stop','capture','build','preflight','schema','import','verify',
    'sandbox','preflight','publish','declare']);
  assert.equal(f.delivers,1);
  const reread=await pipeline.status('transfer-one',context);
  assert.equal(reread.planDigest,prepared.planDigest);
  await assert.rejects(pipeline.status('transfer-one',{principalId:'other'}),error=>error.code==='forbidden');
});

test('unknown Worker outcome is inspected and confirmed without replaying upload',async()=>{
  const f=fixture({unknownPublish:true}),pipeline=f.create();
  await pipeline.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  const prepared=await pipeline.prepare({secretSelections:[]},context);
  const input={transferId:prepared.transferId,planDigest:prepared.planDigest};
  const uncertain=await pipeline.start(input,context);
  assert.equal(uncertain.phase,'delivery-unknown');assert.equal(f.delivers,1);
  assert.equal(f.publicationJournal.records.get('transfer-one').state,'prepared');
  const resolved=await pipeline.reconcile(input,context);
  assert.equal(resolved.phase,'delivered');assert.equal(f.delivers,1);
  assert.equal(f.events.filter(item=>item==='inspect-worker').length,1);
});

test('explicit reconciliation continues a failed data copy on the same plan',async()=>{
  const f=fixture({failImportOnce:true}),pipeline=f.create();
  await pipeline.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  const prepared=await pipeline.prepare({secretSelections:[]},context);
  const input={transferId:prepared.transferId,planDigest:prepared.planDigest};
  await assert.rejects(pipeline.start(input,context),/temporary import failure/);
  assert.equal(f.publicationJournal.records.size,0);
  const resolved=await pipeline.reconcile(input,context);
  assert.equal(resolved.phase,'delivered');assert.equal(f.delivers,1);
  assert.equal(f.events.filter(item=>item==='capture').length,1);
  assert.equal(f.events.filter(item=>item==='build').length,1);
});

test('registry registration blocks provisioning; reconfigured credentials resume the same prepared target',async()=>{
  const f=fixture(),first=f.create();
  await first.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  f.options.registryContext=async()=>{throw new Error('Missing registration');};
  await assert.rejects(first.prepare({secretSelections:[]},context),
    error=>error.code==='registry_registration_required');
  assert.equal(f.events.includes('provision'),false);
  delete f.options.registryContext;
  const prepared=await first.prepare({secretSelections:[]},context);
  assert.equal((await first.inspect({principalId:'other-owner'})).activeTransferId,null);
  f.planJournal.records.set('transfer-two',{
    ...structuredClone(f.planJournal.records.get('transfer-one')),
    transferId:'transfer-two',owner:'other-owner'});
  assert.equal((await first.inspect({principalId:'other-owner'})).activeTransferId,'transfer-two');
  assert.deepEqual((await first.inspect({principalId:'other-owner'})).target,{accountId,workerName});
  assert.equal((await first.inspect({principalId:'third-owner'})).target,null);
  const goodControl=f.options.controlFactory;
  f.options.controlFactory=()=>({accountId,async inspectConnection(){return {accountId,
    tokenId:'f'.repeat(32),workersSubdomain:'example'};}});
  const wrongToken=f.create();
  await assert.rejects(wrongToken.configure({target:{accountId,workerName},
    credentials:{apiToken:token}},context),error=>error.code==='connection_changed');
  assert.equal((await wrongToken.inspect(context)).configuration,'needed');
  f.options.controlFactory=goodControl;
  const restarted=f.create();
  const recoveredInspection=await restarted.inspect(context);
  assert.equal(recoveredInspection.activeTransferId,'transfer-one');
  assert.equal(recoveredInspection.configuration,'needed');
  assert.deepEqual(recoveredInspection.target,{accountId,workerName});
  assert.deepEqual((await restarted.inspect({principalId:'other-owner'})).target,{accountId,workerName});
  const status=await restarted.status('transfer-one',context);
  assert.equal(status.phase,'prepared');
  const ready=await restarted.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  assert.equal(ready.activeTransferId,'transfer-one');
  assert.equal((await restarted.inspect({principalId:'other-owner'})).configuration,'needed');
  assert.equal(f.events.filter(item=>item==='provision').length,1);
  const finished=await restarted.start({transferId:prepared.transferId,planDigest:prepared.planDigest},context);
  assert.equal(finished.phase,'delivered');
  assert.equal(f.events.filter(item=>item==='provision').length,1);
});

test('a restarted preparation resumes its recorded provisioning intent',async()=>{
  const f=fixture({provisionUnknownOnce:true}),first=f.create();
  await first.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  await assert.rejects(first.prepare({secretSelections:[]},context),
    error=>error.code==='provision_unknown');
  assert.equal(f.planJournal.records.get('transfer-one').stage,'intent');
  const restarted=f.create();
  const inspection=await restarted.inspect(context);
  assert.deepEqual(inspection.target,{accountId,workerName});
  assert.equal(inspection.activeTransferId,null);
  assert.equal(inspection.configuration,'needed');
  await restarted.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  const prepared=await restarted.prepare({secretSelections:[]},context);
  assert.equal(prepared.transferId,'transfer-one');
  assert.equal(f.planJournal.records.size,1);
  assert.equal(f.events.filter(item=>item==='provision').length,2);
  assert.equal(f.events.includes('stop'),false);
});

test('an interrupted intent keeps exact secret choices and refuses a changed retry',async()=>{
  const f=fixture({provisionUnknownOnce:true}),reference=
    'creezio-secret:v1:11111111-1111-4111-8111-111111111111';
  f.options.secretConnections=async()=>[{contextId:'application',reference,bindingId:'binding-one',
    label:'Provider connection'}];
  const selected={contextId:'application',reference,bindingId:'binding-one',mode:'rewrap'};
  const first=f.create();
  await first.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  await assert.rejects(first.prepare({secretSelections:[selected]},context),
    error=>error.code==='provision_unknown');
  const restarted=f.create();
  assert.equal((await restarted.inspect(context)).activeTransferId,null);
  await restarted.configure({target:{accountId,workerName},credentials:{apiToken:token}},context);
  await assert.rejects(restarted.prepare({secretSelections:[{...selected,mode:'disable'}]},context),
    error=>error.code==='transfer_in_progress');
  assert.equal(f.events.filter(item=>item==='provision').length,1);
  const prepared=await restarted.prepare({secretSelections:[selected]},context);
  assert.equal(prepared.transferId,'transfer-one');
  assert.equal(f.planJournal.records.size,1);
  assert.equal(f.events.filter(item=>item==='provision').length,2);
});
