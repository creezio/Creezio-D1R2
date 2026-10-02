import {createHash} from 'node:crypto';
import {validateCloudflareTarget,cloudflareWorkerConfiguration} from './config.mjs';
import {applyCompositionSchema,inspectCompositionSchema,inspectManagedSchema}
  from '../data/apply-schema.mjs';
import {isCompositionSchemaPlan} from '../data/composition-schema.mjs';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {readStorageMutation,prepareStorageRevocation,fenceStorageRoute,
  initializeStorageRouteDeny,markStorageSourceAttempted,
  confirmStorageSource,reopenStorageRoute,inspectStorageRouteOpen,inspectStorageRevocation}
  from '../../core/storage-authority/coordinator.ts';

const HASH=/^sha256-[a-f0-9]{64}$/;
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const authState=`"${ACCESS_TABLES.authorization_state}"`;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sameArtifact=(a,b)=>a&&b&&['sourceSha','artifactDigest','coreVersion',
  'contractVersion','compositionDigest'].every(field=>a[field]===b[field]);
const pending=phase=>Object.freeze({state:'pending',phase});
const fail=code=>{throw Object.assign(new Error(`Storage cutover ${code}.`),{code});};
const key=resource=>`${resource.contextId}\0${resource.slot}\0${resource.databaseId}\0${resource.bucketName}`;

function checkedBindings(actual,target){
  if(!Array.isArray(actual)||new Set(actual.map(item=>item?.name)).size!==actual.length)return false;
  const expected=cloudflareWorkerConfiguration(target);
  const matches=(type,wanted,field)=>{
    const found=actual.filter(item=>item?.type===type);
    return found.length===wanted.length&&wanted.every(item=>found.some(binding=>
      binding.name===item.binding&&binding[field]===item[type==='d1'?'database_id':'bucket_name']));
  };
  const plain=(name,text)=>actual.some(item=>item.name===name&&item.type==='plain_text'
    &&item.text===text);
  return matches('d1',expected.d1_databases,'id')
    &&matches('r2_bucket',expected.r2_buckets,'bucket_name')
    &&Object.entries(expected.vars).every(([name,text])=>plain(name,text))
    &&actual.some(item=>item.name==='CREEZIO_VAULT_KEYRING'&&item.type==='secret_text');
}

/** Candidate transport. The operator pipeline has not connected or enabled it. */
export function createStorageCompositionCutover({updateJournal,updateId,previousTarget,
  nextTarget,plan,artifact,databaseFor,publication,sourceIdentity,
  schema={apply:applyCompositionSchema,inspect:inspectCompositionSchema,managed:inspectManagedSchema}}){
  const previous=validateCloudflareTarget(previousTarget),next=validateCloudflareTarget(nextTarget);
  if(previous.schemaVersion!==3||next.schemaVersion!==3
    ||previous.storageInstallationId!==next.storageInstallationId
    ||previous.databaseId!==next.databaseId||previous.accountId!==next.accountId
    ||previous.workerName!==next.workerName
    ||typeof updateId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,55}$/.test(updateId)
    ||!HASH.test(plan?.planDigest)||!HASH.test(plan?.compositionDigest)
    ||!HASH.test(plan?.lockDigest)||!HASH.test(plan?.modelDigest)||!HASH.test(plan?.sqlDigest)
    ||artifact?.compositionDigest!==plan.compositionDigest
    ||!HASH.test(artifact?.artifactDigest)
    ||typeof artifact?.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(artifact.sourceSha)
    ||schema.apply===applyCompositionSchema&&!isCompositionSchemaPlan(plan)
    ||typeof databaseFor!=='function'||!updateJournal
    ||typeof sourceIdentity!=='function'
    ||typeof publication?.deliver!=='function'||typeof publication?.inspect!=='function'
    ||typeof publication?.inspectPrevious!=='function')
    fail('invalid_configuration');
  const oldActive=previous.resources.filter(item=>item.status==='active');
  const newActive=next.resources.filter(item=>item.status==='active');
  if(previous.bucketName!==next.bucketName
    ||oldActive.some(old=>newActive.some(item=>item.contextId===old.contextId
      &&key(item)!==key(old))))fail('data_transfer_required');
  if(newActive.some(item=>previous.resources.some(old=>old.contextId===item.contextId
    &&old.status==='revoked')))fail('reactivation_requires_reconciliation');
  const retained=new Set(newActive.map(key));
  const oldKeys=new Set(oldActive.map(key));
  const all=[...oldActive.map(resource=>({resource,kind:retained.has(key(resource))?'retained':'retired'})),
    ...newActive.filter(resource=>!oldKeys.has(key(resource))).map(resource=>({resource,kind:'new'}))];
  const digest=`sha256-${hash(['composition.cutover',updateId,plan.planDigest,previous,next])}`;
  const command=entry=>({installationId:next.storageInstallationId,
    contextId:entry.resource.contextId,slot:entry.resource.slot,
    mutationId:`cutover:${hash([digest,key(entry.resource)]).slice(0,48)}`,
    commandDigest:digest,expectedGeneration:entry.kind==='new'?1:entry.generation});
  const footprint=Object.freeze({schemaVersion:1,previous,next,
    planDigest:plan.planDigest,compositionDigest:plan.compositionDigest,
    lockDigest:plan.lockDigest,
    modelDigest:plan.modelDigest,sqlDigest:plan.sqlDigest,
    artifactDigest:artifact.artifactDigest,digest});
  let sourceDb;
  async function database(databaseId){
    const result=await databaseFor(databaseId);
    if(!result?.db||result.metadata?.uuid!==databaseId)fail('database_changed');
    return result.db;
  }
  async function save(record,changes){
    const nextRecord={...record,cutover:{...record.cutover,...changes},revision:record.revision+1};
    await updateJournal.compareAndSave(record,nextRecord);
    return nextRecord;
  }
  async function load(){
    const record=await updateJournal.load(updateId);
    if(!record||record.updateId!==updateId||!same(record.target,previous)
      ||record.targetPlanDigest!==plan.planDigest
      ||record.targetCompositionDigest!==plan.compositionDigest
      ||typeof record.previousDeploymentId!=='string'||!record.previousDeploymentId
      ||typeof record.previousVersionId!=='string'||!record.previousVersionId
      ||!HASH.test(record.previousArtifact?.artifactDigest)
      ||typeof record.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(record.sourceSha)
      ||typeof record.sourceFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(record.sourceFingerprint))
      fail('update_changed');
    if(record.cutover&&!same(record.cutover.footprint,footprint))fail('cutover_changed');
    assertSource(record);
    return record;
  }
  function assertSource(record){
    const current=sourceIdentity();
    if(current?.dirty||current?.head!==record.sourceSha
      ||current?.sha256!==record.sourceFingerprint)fail('source_changed');
  }
  async function exactPrevious(record){
    const proof=await publication.inspectPrevious(updateId);
    return !!proof&&same(proof.target,previous)
      &&proof.deploymentId===record.previousDeploymentId
      &&proof.versionId===record.previousVersionId
      &&sameArtifact(proof.artifact,record.previousArtifact)
      &&proof.percentage===100&&checkedBindings(proof.bindings,previous);
  }
  async function sourceEpoch(){
    const row=await sourceDb.prepare(`SELECT epoch FROM ${authState}
      WHERE id='application' LIMIT 2`).first();
    if(!Number.isSafeInteger(row?.epoch)||row.epoch<1)fail('source_unavailable');
    return row.epoch;
  }
  async function targetRoute(entry){
    const db=await database(entry.resource.databaseId);
    const row=await db.prepare(`SELECT installation_id AS installationId,slot,generation,state,
      mutation_id AS mutationId FROM ${routes} WHERE id=? LIMIT 2`)
      .bind(entry.resource.contextId).first();
    return {db,row};
  }
  async function fenceOld(){
    for(const entry of all.filter(item=>item.kind!=='new')){
      const {db,row}=await targetRoute(entry);
      if(!row||row.installationId!==next.storageInstallationId||row.slot!==entry.resource.slot
        ||row.generation!==entry.generation&&row.generation!==entry.generation+1)
        fail('route_changed');
      const input=command(entry);
      await prepareStorageRevocation(sourceDb,input);
      await fenceStorageRoute(sourceDb,db,input);
      const observed=(await targetRoute(entry)).row;
      if(observed?.state!=='deny'||observed.generation!==input.expectedGeneration+1
        ||observed.mutationId!==input.mutationId)fail('fence_unconfirmed');
    }
  }
  async function exactReceipt(db){
    const state=await schema.inspect(db,plan),managed=await schema.managed(db);
    const receipt=managed?.receipt;
    if(state?.state!=='ready'||managed?.ok!==true||!HASH.test(managed.receiptId)
      ||receipt?.planDigest!==plan.planDigest
      ||receipt.compositionDigest!==plan.compositionDigest
      ||receipt.lockDigest!==plan.lockDigest
      ||receipt.modelDigest!==plan.modelDigest||receipt.sqlDigest!==plan.sqlDigest)
      return null;
    return managed.receiptId;
  }
  async function installNew(entry,epoch){
    const db=await database(entry.resource.databaseId);
    await initializeStorageRouteDeny(sourceDb,db,command(entry),epoch);
  }
  async function verifySchema(){
    const ids=[next.databaseId,...newActive.map(item=>item.databaseId)],receipts=[];
    for(const databaseId of ids){
      const db=await database(databaseId),receiptId=await exactReceipt(db);
      if(!receiptId)return null;
      receipts.push({databaseId,receiptId});
    }
    return receipts;
  }
  async function applyAllSchema(){
    const ids=[next.databaseId,...newActive.map(item=>item.databaseId)];
    for(const databaseId of ids){
      const db=await database(databaseId);
      if(await exactReceipt(db))continue;
      const before=await schema.inspect(db,plan);
      if(before?.state!=='additive')fail('schema_unavailable');
      try{await schema.apply(db,plan,{expectedPlanDigest:plan.planDigest});}
      catch{/* A lost DDL acknowledgement is resolved only by a fresh managed inspection. */}
      if(!await exactReceipt(db))return null;
    }
    const epoch=await sourceEpoch();
    for(const entry of all.filter(item=>item.kind==='new'))await installNew(entry,epoch);
    return verifySchema();
  }
  async function exactPublication(expected=null){
    const proof=await publication.inspect(updateId);
    if(!proof||proof.target?.schemaVersion!==3||!same(proof.target,next)
      ||!sameArtifact(proof.artifact,artifact)
      ||typeof proof.deploymentId!=='string'||!proof.deploymentId
      ||typeof proof.versionId!=='string'||!proof.versionId
      ||proof.percentage!==100||!checkedBindings(proof.bindings,next))return null;
    const identity={deploymentId:proof.deploymentId,versionId:proof.versionId};
    return expected&&!same(identity,expected)?null:identity;
  }
  async function inspectFences(){
    for(const entry of all){
      const input=command(entry),{row}=await targetRoute(entry);
      if(row?.state!=='deny'||row.mutationId!==input.mutationId
        ||row.generation!==input.expectedGeneration+1)return false;
    }
    return true;
  }
  async function inspectRetiredDeny(){
    for(const entry of all.filter(item=>item.kind==='retired')){
      const input=command(entry),{row}=await targetRoute(entry);
      if(row?.state!=='deny'||row.mutationId!==input.mutationId
        ||row.generation!==input.expectedGeneration+1)return false;
    }
    return true;
  }
  async function inspectFinalRoutes(){
    if(!await inspectRetiredDeny())return false;
    const epoch=await sourceEpoch();
    for(const entry of all.filter(item=>item.kind!=='retired')){
      const db=await database(entry.resource.databaseId);
      if(!await inspectStorageRouteOpen(db,command(entry),epoch))return false;
    }
    return true;
  }
  async function attest(expected,receipts,record){
    assertSource(record);
    if(!await exactPublication(expected)||!same(await verifySchema(),receipts)
      ||!await inspectFences())return false;
    for(const entry of all){
      const input=command(entry),state=await inspectStorageRevocation(sourceDb,input);
      if(state==='fenced')await markStorageSourceAttempted(sourceDb,input);
      const current=await inspectStorageRevocation(sourceDb,input);
      if(current==='source-attempted')await confirmStorageSource(sourceDb,input,async()=>
        Boolean(await exactPublication(expected)
          &&same(await verifySchema(),receipts)&&await inspectFences()));
      else if(!['source-confirmed','open'].includes(current))return false;
    }
    return true;
  }
  async function open(expected,receipts,record){
    assertSource(record);
    if(!await exactPublication(expected)||!same(await verifySchema(),receipts)
      ||!await inspectRetiredDeny())return false;
    const epoch=await sourceEpoch();
    for(const entry of all.filter(item=>item.kind!=='retired')){
      assertSource(record);
      if(!await exactPublication(expected)||!same(await verifySchema(),receipts)
        ||!await inspectRetiredDeny())return false;
      const db=await database(entry.resource.databaseId),input=command(entry);
      await reopenStorageRoute(sourceDb,db,input,epoch);
      if(!await inspectStorageRouteOpen(db,input,epoch))return false;
    }
    return inspectFinalRoutes();
  }
  return Object.freeze({async assertRetryReady(){
    sourceDb=await database(next.databaseId);
    const record=await load();
    if(record.cutover?.phase!=='publishing'||!same(record.nextTarget,next)
      ||!sameArtifact(record.artifact,artifact)
      ||record.cutover.receipts?.length!==1+newActive.length)
      fail('retry_not_ready');
    for(const entry of all.filter(item=>item.kind!=='new')){
      const saved=record.cutover.generations?.find(item=>item.resourceKey===key(entry.resource));
      if(!Number.isSafeInteger(saved?.generation)||saved.generation<1)
        fail('cutover_changed');
      entry.generation=saved.generation;
      const existing=await readStorageMutation(sourceDb,command(entry).mutationId);
      if(existing&&existing.generation!==entry.generation)fail('cutover_changed');
    }
    if(!await exactPrevious(record)||!await inspectFences()
      ||!same(await verifySchema(),record.cutover.receipts))fail('retry_not_ready');
    return true;
  },async advance(){
    // The source journal is always the physically verified primary D1 binding.
    sourceDb=await database(next.databaseId);
    let record=await load();
    if(!record.cutover){
      if(!await exactPrevious(record))return pending('preflight');
      const generations=[];
      for(const entry of all.filter(item=>item.kind!=='new')){
        const {row}=await targetRoute(entry);
        if(row?.state!=='active'||row.installationId!==next.storageInstallationId
          ||row.slot!==entry.resource.slot||!Number.isSafeInteger(row.generation)
          ||row.generation<1)fail('route_changed');
        generations.push({resourceKey:key(entry.resource),generation:row.generation});
      }
      record=await save(record,{footprint,phase:'fencing',receipts:[],publication:null,
        generations});
    }
    for(const entry of all.filter(item=>item.kind!=='new')){
      const saved=record.cutover.generations?.find(item=>item.resourceKey===key(entry.resource));
      if(!Number.isSafeInteger(saved?.generation)||saved.generation<1)fail('cutover_changed');
      entry.generation=saved.generation;
      const existing=await readStorageMutation(sourceDb,command(entry).mutationId);
      if(existing&&existing.generation!==entry.generation)fail('cutover_changed');
    }
    try{
      if(record.cutover.phase==='fencing'){
        await fenceOld();record=await save(record,{phase:'schema-applying'});
      }
      if(record.cutover.phase==='schema-applying'){
        const receipts=await applyAllSchema();
        if(!receipts)return pending('schema-applying');
        record=await save(record,{phase:'schema-ready',receipts});
      }
      if(record.cutover.phase==='schema-ready'){
        if(!await inspectFences()||!await verifySchema())return pending('schema-ready');
        assertSource(record);
        if(!await exactPrevious(record))return pending('schema-ready');
        record=await save(record,{phase:'publishing'});
        try{await publication.deliver({updateId,previousTarget:previous,nextTarget:next,
          planDigest:plan.planDigest,artifact,
          expectedPreviousDeploymentId:record.previousDeploymentId,
          expectedPreviousVersionId:record.previousVersionId});}
        catch{/* Inspect exact deployment; never repeat a possibly completed upload. */}
      }
      if(record.cutover.phase==='publishing'){
        const proof=await exactPublication();
        if(!proof)return pending('publishing');
        record=await save(record,{phase:'attesting',publication:proof});
      }
      if(record.cutover.phase==='attesting'){
        if(!await attest(record.cutover.publication,record.cutover.receipts,record))
          return pending('attesting');
        record=await save(record,{phase:'opening'});
      }
      if(record.cutover.phase==='opening'){
        if(!await open(record.cutover.publication,record.cutover.receipts,record))
          return pending('opening');
        record=await save(record,{phase:'open'});
      }
      if(record.cutover.phase!=='open'
        ||!await exactPublication(record.cutover.publication)
        ||!same(await verifySchema(),record.cutover.receipts)
        ||!await inspectFinalRoutes())
        return pending(record.cutover.phase);
      return Object.freeze({state:'ready',phase:'open',publication:record.cutover.publication,
        receipts:record.cutover.receipts});
    }catch{return pending(record.cutover.phase);}
  }});
}
