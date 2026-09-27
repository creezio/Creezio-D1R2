import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {schemaDigest} from '../data/composition-schema.mjs';
import {applyCompositionSchema} from '../data/apply-schema.mjs';
import {projectCloudflareComposition} from './composition.mjs';
import {validateCloudflareTarget} from './config.mjs';
import {createCloudflareControlPlane} from './control-plane.mjs';
import {createCloudflareProvisioner} from './provisioning.mjs';
import {createRemoteD1Client} from './remote/d1.mjs';
import {createRemoteD1Binding} from './remote/binding.mjs';
import {createRemoteR2Client} from './remote/r2.mjs';
import {createRemoteTransferObjectPort} from './remote/object-port.mjs';
import {createCloudflarePublisher} from './publisher.mjs';
import {createCloudflareSandboxPublisher} from './sandbox.mjs';
import {captureLocalTransfer,loadCapturedTransfer} from './transfer/source.ts';
import {importCapturedTransfer,verifyCapturedTransfer} from './transfer/destination.ts';

const ACCOUNT=/^[a-f0-9]{32}$/;
const NAME=/^[a-z][a-z0-9-]{1,53}[a-z0-9]$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA=/^sha256-[a-f0-9]{64}$/;
const REF=/^creezio-secret:v1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const stages=['intent','prepared','starting','capturing','captured','built','preflight','schema-ready',
  'verified','sandbox-ready','publishing','delivery-unknown','delivered'];
const rank=stage=>stages.indexOf(stage);
const fail=(code,status=503)=>{throw Object.assign(new Error(`Delivery pipeline ${code}.`),{code,status});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=value=>createHash('sha256').update(value).digest('hex');
const owner=context=>typeof context?.principalId==='string'&&ID.test(context.principalId)
  ?context.principalId:fail('forbidden',403);
function compatibleProjection(projection){
  const source=projection?.sourcePlan,target=projection?.targetPlan;
  if(!source||!target||source.applicationId!==target.applicationId
    ||source.modelDigest!==target.modelDigest||source.sqlDigest!==target.sqlDigest
    ||schemaDigest(source.objects)!==schemaDigest(target.objects))fail('plan_changed',409);
  return projection;
}
function validSelections(input){
  const chosen=input?.secretSelections;
  if(!exact(input,['secretSelections'])||!Array.isArray(chosen)||chosen.length>1000
    ||chosen.some(item=>!exact(item,['contextId','reference','bindingId','mode'])
      ||typeof item.contextId!=='string'||!ID.test(item.contextId)
      ||typeof item.bindingId!=='string'||!ID.test(item.bindingId)
      ||typeof item.reference!=='string'||!REF.test(item.reference)
      ||!['rewrap','disable'].includes(item.mode))
    ||new Set(chosen.map(item=>`${item.contextId}\0${item.reference}`)).size!==chosen.length)fail('invalid_input',400);
  return structuredClone(chosen);
}
function validConnection(input){
  if(!exact(input,['target','credentials'])||!exact(input.target,['accountId','workerName'])
    ||!exact(input.credentials,['apiToken'])||!ACCOUNT.test(input.target.accountId)
    ||typeof input.target.workerName!=='string'||!NAME.test(input.target.workerName)
    ||typeof input.credentials.apiToken!=='string'||input.credentials.apiToken.length<20
    ||input.credentials.apiToken.length>4096||/\s/.test(input.credentials.apiToken))fail('invalid_input',400);
  return {accountId:input.target.accountId,workerName:input.target.workerName,
    token:input.credentials.apiToken};
}
function provisionPlan(connection,transferId){
  const {accountId,workerName}=connection;
  return {accountId,workerName,transferId,databaseName:`${workerName}-db`,
    bucketName:`${workerName}-files`,jurisdiction:'default',tokenScope:'account'};
}
function targetFromProvision(plan,ready,subdomain){
  if(ready.state!=='ready'||!ready.target||ready.target.accountId!==plan.accountId
    ||ready.target.workerName!==plan.workerName||ready.target.bucketName!==plan.bucketName
    ||typeof ready.target.databaseId!=='string'||ready.target.origin!==
      `https://${plan.workerName}.${subdomain}.workers.dev`)fail('provision_conflict',409);
  return validateCloudflareTarget({schemaVersion:1,accountId:plan.accountId,workerName:plan.workerName,
    databaseId:ready.target.databaseId,databaseName:plan.databaseName,bucketName:plan.bucketName,
    origin:ready.target.origin,
    widgetSandboxOrigin:`https://${plan.workerName}-widgets.${subdomain}.workers.dev`});
}
function validArtifact(value,record){
  return value&&/^[a-f0-9]{40}$/.test(value.sourceSha)
    &&value.sourceSha===record.sourceSha&&SHA.test(value.artifactDigest)
    &&value.compositionDigest===record.targetCompositionDigest
    &&typeof value.coreVersion==='string'&&value.coreVersion.length>0
    &&typeof value.contractVersion==='string'&&value.contractVersion.length>0;
}
function summary(record){return Object.freeze({title:'Première livraison Cloudflare',
  details:Object.freeze([`Worker ${record.target.workerName}`,`Base ${record.target.databaseName}`,
    `Bucket ${record.target.bucketName}`]),
  warnings:Object.freeze(['Le service local sera arrêté pour capturer ses données avant la livraison.'])});}
function statusOf(record,checkpoint=null){
  const phase=record.stage==='prepared'?'prepared':record.stage==='starting'?'starting'
    :record.stage==='capturing'?'capturing'
    :record.stage==='delivery-unknown'?'delivery-unknown'
    :record.stage==='delivered'?'delivered'
    :checkpoint?.phase==='d1-copying'?'d1-copying'
    :checkpoint?.phase==='r2-copying'?'r2-copying'
    :record.stage==='schema-ready'?'schema-ready'
    :rank(record.stage)>=rank('verified')?'verified':'captured';
  return Object.freeze({transferId:record.transferId,planDigest:record.planDigest,phase,
    summary:phase==='prepared'?record.summary:null,finalUrl:record.finalUrl??null,
    registryStatus:record.stage==='delivered'?'effective'
      :record.stage==='delivery-unknown'?'unknown':'pending'});
}

/** Durable first-publication state machine. All external effects are supplied by reviewed ports. */
export function createCloudflareDeliveryPipeline(options){
  const {config,planJournal,provisionJournal,transferJournal,stopRuntime,buildTarget,targetVault}=options??{};
  const staticRegistry={publicationJournal:options?.publicationJournal,
    registryClient:options?.registryClient,publicationGate:options?.publicationGate,
    registryIdentity:options?.registryIdentity};
  if(!config||typeof config.root!=='string'||!planJournal||!provisionJournal||!transferJournal
    ||typeof options.registryContext!=='function'&&Object.values(staticRegistry).some(value=>!value)
    ||typeof stopRuntime!=='function'||typeof buildTarget!=='function'
    ||typeof targetVault?.loadOrCreate!=='function'
    ||typeof options.publishSandbox!=='function'&&!options.sandboxJournal)
    fail('invalid_configuration',500);
  const identity=options.sourceIdentity??sourceIdentity;
  const project=options.project??(()=>projectCloudflareComposition({root:config.root,
    compositionPath:options.compositionPath,lockPath:options.lockPath}));
  const capture=options.capture??captureLocalTransfer;
  const loadCapture=options.loadCapture??loadCapturedTransfer;
  const importer=options.importTransfer??importCapturedTransfer;
  const verifier=options.verifyTransfer??verifyCapturedTransfer;
  const schema=options.applySchema??applyCompositionSchema;
  const controlFactory=options.controlFactory??(({accountId,token})=>createCloudflareControlPlane({accountId,token}));
  const provisionerFactory=options.provisionerFactory??(({control})=>
    createCloudflareProvisioner({control,journal:provisionJournal}));
  const d1Factory=options.d1Factory??(({accountId,databaseId,token})=>
    createRemoteD1Client({accountId,databaseId,token}));
  const r2Factory=options.r2Factory??(input=>createRemoteR2Client(input));
  const objectPortFactory=options.objectPortFactory??(({r2})=>
    createRemoteTransferObjectPort({r2,journal:transferJournal}));
  const publisherFactory=options.publisherFactory??(({target,token,controlPlane})=>
    createCloudflarePublisher({root:config.root,
      artifactRoot:options.artifactRoot??path.join(config.root,'.wrangler','delivery','build','artifact'),
      target,token,controlPlane}));
  const sandboxFactory=options.sandboxFactory??(({target,token,controlPlane})=>
    createCloudflareSandboxPublisher({root:config.root,target,token,controlPlane,
      journal:options.sandboxJournal}));
  const secretConnections=options.secretConnections??(async()=>[]);
  const sourceKeyring=options.sourceKeyring??(async()=>null);
  const transferIdFactory=options.transferIdFactory??randomUUID;
  let connection=null,currentTransferId=null;
  async function registryPorts(){
    let value;
    try{value=typeof options.registryContext==='function'
      ?await options.registryContext():staticRegistry;}
    catch{fail('registry_registration_required',409);}
    if(!value||typeof value.registryClient?.preflight!=='function'
      ||typeof value.publicationGate?.publish!=='function'
      ||typeof value.publicationJournal?.get!=='function'
      ||typeof value.registryIdentity?.projectId!=='string'
      ||!ID.test(value.registryIdentity.projectId)
      ||typeof value.registryIdentity?.installationId!=='string'
      ||!ID.test(value.registryIdentity.installationId))fail('registry_registration_required',409);
    return value;
  }
  async function save(record,changes){
    const next={...record,...changes,revision:record.revision+1};
    await planJournal.compareAndSave(record,next);return next;
  }
  async function recordFor(transferId,planDigest,context){
    if(typeof transferId!=='string'||!ID.test(transferId)||typeof planDigest!=='string'
      ||!SHA.test(planDigest))fail('invalid_input',400);
    const record=await planJournal.load(transferId);
    if(!record||record.planDigest!==planDigest||record.owner!==owner(context)
      ||!stages.includes(record.stage))fail('forbidden',403);
    return record;
  }
  async function status(transferId,context){
    if(typeof transferId!=='string'||!ID.test(transferId))fail('invalid_input',400);
    const record=await planJournal.load(transferId);
    if(!record||record.owner!==owner(context)||!SHA.test(record.planDigest))fail('forbidden',403);
    currentTransferId=transferId;
    const checkpoint=await transferJournal.load(transferId);
    return statusOf(record,checkpoint);
  }
  async function inspect(context){
    const principalId=owner(context);
    const connections=await secretConnections(context);
    if(!Array.isArray(connections)||connections.length>1000)fail('source_unavailable');
    let active=null;
    if(currentTransferId)active=await planJournal.load(currentTransferId);
    if(!active&&typeof planJournal.findActive==='function'){
      const found=await planJournal.findActive(principalId);
      if(found)active=await planJournal.load(found);
    }
    if(active?.owner!==principalId)active=null;
    const activeTarget=active?{accountId:active.accountId,workerName:active.workerName}:null;
    const selected=connection?.principalId===principalId
      &&(!activeTarget||connection.accountId===activeTarget.accountId
        &&connection.workerName===activeTarget.workerName)?connection:null;
    return Object.freeze({hostProfile:'docker-local',
      target:activeTarget??(selected?{accountId:selected.accountId,workerName:selected.workerName}:null),
      configuration:selected?'ready':'needed',
      preparation:active?.stage==='prepared'?'ready':'needed',
      activeTransferId:active?.transferId??null,secretConnections:structuredClone(connections)});
  }
  async function configure(input,context){
    const selected=validConnection(input),control=controlFactory(selected);
    const observed=await control.inspectConnection('account');
    if(observed.accountId!==selected.accountId||typeof observed.tokenId!=='string'
      ||!/^[a-f0-9]{32}$/.test(observed.tokenId)||typeof observed.workersSubdomain!=='string')
      fail('invalid_connection',403);
    connection={...selected,principalId:owner(context),tokenId:observed.tokenId,
      subdomain:observed.workersSubdomain,control};
    return inspect(context);
  }
  async function finishPreparation(record,source){
    if(!connection||connection.principalId!==record.owner||connection.accountId!==record.accountId
      ||connection.workerName!==record.workerName||connection.tokenId!==record.tokenId)
      fail('connection_changed',409);
    const p=provisionPlan(connection,record.transferId);
    const ready=await provisionerFactory({control:connection.control}).provision(p);
    if(ready.state!=='ready')fail('provision_unknown',409);
    const target=targetFromProvision(p,ready,connection.subdomain),now=identity(config.root);
    if(now.dirty||!sameSourceIdentity(source,now))fail('source_changed',409);
    const planDigest=schemaDigest({transferId:record.transferId,owner:record.owner,
      sourceSha:record.sourceSha,sourceFingerprint:record.sourceFingerprint,
      sourcePlanDigest:record.sourcePlanDigest,targetPlanDigest:record.targetPlanDigest,
      compatibilityDigest:record.compatibilityDigest,target,secretSelections:record.secretSelections,
      tokenId:record.tokenId,registryProjectId:record.registryProjectId,
      registryInstallationId:record.registryInstallationId});
    record=await save(record,{stage:'prepared',target,planDigest,
      summary:summary({...record,target})});
    return {transferId:record.transferId,planDigest,summary:record.summary};
  }
  async function prepare(input,context){
    const principalId=owner(context),chosen=validSelections(input);
    if(!connection||connection.principalId!==principalId)fail('configuration_needed',409);
    const registry=await registryPorts(); // Missing registration blocks provisioning.
    if(currentTransferId&&(await planJournal.load(currentTransferId))?.owner!==principalId)
      currentTransferId=null;
    if(!currentTransferId&&typeof planJournal.findActive==='function')
      currentTransferId=await planJournal.findActive(principalId);
    if(currentTransferId){
      const old=await planJournal.load(currentTransferId);
      if(old?.owner===principalId&&old?.stage==='prepared'&&same(old.secretSelections,chosen))
        return {transferId:old.transferId,planDigest:old.planDigest,summary:old.summary};
      if(old?.owner===principalId&&old?.stage==='intent'&&same(old.secretSelections,chosen)){
        const source=identity(config.root),projection=compatibleProjection(project());
        if(source.dirty||source.head!==old.sourceSha||source.sha256!==old.sourceFingerprint
          ||projection.sourcePlan.planDigest!==old.sourcePlanDigest
          ||projection.targetPlan.planDigest!==old.targetPlanDigest
          ||projection.compatibilityDigest!==old.compatibilityDigest
          ||old.registryProjectId!==registry.registryIdentity.projectId
          ||old.registryInstallationId!==registry.registryIdentity.installationId)fail('plan_changed',409);
        return finishPreparation(old,source);
      }
      fail('transfer_in_progress',409);
    }
    const known=await secretConnections(context),available=new Set(known.map(item=>
      `${item.contextId}\0${item.reference}\0${item.bindingId}`));
    if(chosen.some(item=>!available.has(`${item.contextId}\0${item.reference}\0${item.bindingId}`)))
      fail('invalid_selection',400);
    const source=identity(config.root);
    if(source.dirty||!/^[a-f0-9]{40}$/.test(source.head))fail('source_not_clean',409);
    const projection=compatibleProjection(project()),transferId=transferIdFactory();
    if(typeof transferId!=='string'||!ID.test(transferId)||transferId.length>55)fail('invalid_transfer',500);
    const p=provisionPlan(connection,transferId);
    let record={schemaVersion:1,revision:1,transferId,owner:principalId,stage:'intent',
      sourceSha:source.head,sourceFingerprint:source.sha256,
      sourcePlanDigest:projection.sourcePlan.planDigest,
      targetPlanDigest:projection.targetPlan.planDigest,
      targetCompositionDigest:projection.targetPlan.compositionDigest,
      compatibilityDigest:projection.compatibilityDigest,
      accountId:p.accountId,workerName:p.workerName,tokenId:connection.tokenId,
      registryProjectId:registry.registryIdentity.projectId,
      registryInstallationId:registry.registryIdentity.installationId,
      secretSelections:chosen,target:null,planDigest:null,summary:null,artifact:null,
      initialPreflight:null,finalUrl:null};
    await planJournal.create(record);currentTransferId=transferId;
    return finishPreparation(record,source);
  }
  async function connected(record){
    if(!connection||connection.principalId!==record.owner||connection.accountId!==record.accountId
      ||connection.workerName!==record.workerName
      ||connection.tokenId!==record.tokenId)fail('configuration_needed',409);
    const observed=await connection.control.inspectConnection('account');
    if(observed.tokenId!==record.tokenId||observed.workersSubdomain!==new URL(record.target.origin)
      .hostname.split('.').slice(1,-2).join('.'))fail('connection_changed',409);
    return connection;
  }
  async function projectionFor(record){
    const source=identity(config.root);
    if(source.dirty||source.head!==record.sourceSha||source.sha256!==record.sourceFingerprint)
      fail('source_changed',409);
    const projection=compatibleProjection(project());
    if(projection.sourcePlan.planDigest!==record.sourcePlanDigest
      ||projection.targetPlan.planDigest!==record.targetPlanDigest
      ||projection.compatibilityDigest!==record.compatibilityDigest)
      fail('plan_changed',409);
    return projection;
  }
  async function runtimePorts(record,connected){
    const d1Client=d1Factory({accountId:record.accountId,databaseId:record.target.databaseId,
      token:connected.token}),db=options.d1BindingFactory?.(d1Client)??createRemoteD1Binding(d1Client);
    const metadata=await d1Client.metadata();
    if(metadata.uuid!==record.target.databaseId)fail('database_changed',409);
    const bucket=await connected.control.bucket(record.target.bucketName,'default');
    if(!bucket?.private)fail('bucket_not_private',409);
    const r2=await r2Factory({accountId:record.accountId,bucketName:record.target.bucketName,
      accessKeyId:connected.tokenId,secretAccessKey:digest(connected.token),jurisdiction:'default'});
    return {db,objects:objectPortFactory({r2,transferJournal})};
  }
  async function runTransfer(initial,{publish}){
    let record=initial;
    const registry=await registryPorts();
    if(registry.registryIdentity.projectId!==record.registryProjectId
      ||registry.registryIdentity.installationId!==record.registryInstallationId)
      fail('registry_changed',409);
    const selected=await connected(record),projection=await projectionFor(record);
    const directory=path.join(config.root,'.wrangler','transfers',record.transferId);
    const vault=await targetVault.loadOrCreate(record.transferId);
    if(!vault||typeof vault.secretsPath!=='string'||!vault.keyring)
      fail('vault_unavailable');
    if(rank(record.stage)<=rank('starting')){
      await stopRuntime({transferId:record.transferId,planDigest:record.planDigest});
      record=await save(record,{stage:'capturing'});
    }
    if(rank(record.stage)<=rank('capturing')){
      const captureResult=await capture({config,plan:projection.sourcePlan,
        transferId:record.transferId,sourceSha:record.sourceSha,
        target:{accountId:record.accountId,workerName:record.target.workerName,
          databaseId:record.target.databaseId,bucketName:record.target.bucketName,
          origin:record.target.origin},directory,secretSelections:record.secretSelections,
        sourceKeyring:await sourceKeyring(),targetKeyring:vault.keyring});
      await captureResult.release();
      if(captureResult.manifest.identity.planDigest!==record.sourcePlanDigest)
        fail('capture_changed',409);
      record=await save(record,{stage:'captured'});
    }else await loadCapture({config,directory,transferId:record.transferId});
    if(rank(record.stage)<rank('built')){
      const artifact=await buildTarget({target:record.target,projection,sourceSha:record.sourceSha,
        transferId:record.transferId});
      if(!validArtifact(artifact,record))fail('artifact_changed',409);
      record=await save(record,{stage:'built',artifact});
    }
    const request={projectId:registry.registryIdentity.projectId,
      installationId:registry.registryIdentity.installationId,
      target:'cloudflare',artifact:record.artifact};
    if(rank(record.stage)<rank('preflight')){
      const receipt=await registry.registryClient.preflight(request);
      if(receipt.projectId!==request.projectId||receipt.installationId!==request.installationId
        ||Date.parse(receipt.expiresAt)<=Date.now())fail('registry_preflight',409);
      record=await save(record,{stage:'preflight',initialPreflight:receipt.preflightId});
    }
    const {db,objects}=await runtimePorts(record,selected);
    if(rank(record.stage)<rank('schema-ready')){
      const applied=await schema(db,projection.targetPlan,
        {expectedPlanDigest:projection.targetPlan.planDigest});
      if(applied.ok!==true||applied.observedState!=='ready')fail('schema_unavailable',409);
      record=await save(record,{stage:'schema-ready'});
    }
    const transferArgs={config,directory,manifest:await loadCapture({config,directory,
      transferId:record.transferId}),targetPlan:projection.targetPlan,db,objects,
      journal:transferJournal};
    await importer(transferArgs);
    await verifier(transferArgs);
    if(rank(record.stage)<rank('verified'))record=await save(record,{stage:'verified'});
    if(rank(record.stage)<rank('sandbox-ready')){
      const sandbox=options.publishSandbox
        ?await options.publishSandbox({transferId:record.transferId,target:record.target,
          token:selected.token,controlPlane:selected.control})
        :await sandboxFactory({target:record.target,token:selected.token,
          controlPlane:selected.control}).publishSandbox({transferId:record.transferId});
      if(!sandbox||sandbox.state!=='confirmed'
        ||sandbox.receipt?.origin!==record.target.widgetSandboxOrigin)
        fail('sandbox_unknown',409);
      record=await save(record,{stage:'sandbox-ready'});
    }
    if(!publish)return statusOf(record,await transferJournal.load(record.transferId));
    record=await save(record,{stage:'publishing'});
    const publisher=publisherFactory({target:record.target,token:selected.token,
      controlPlane:selected.control});
    const outcome=await registry.publicationGate.publish(request,record.transferId,
      ()=>publisher.deliver({transferId:record.transferId,artifact:record.artifact,
        secretsPath:vault.secretsPath}));
    if(outcome.state==='synchronized'){
      record=await save(record,{stage:'delivered',finalUrl:outcome.record.declaration.url});
    }else if(outcome.state==='blocked'
      &&await registry.publicationJournal.get(record.transferId)===null){
      record=await save(record,{stage:'sandbox-ready'});
    }else record=await save(record,{stage:'delivery-unknown'});
    return statusOf(record,await transferJournal.load(record.transferId));
  }
  async function start(input,context){
    let record=await recordFor(input?.transferId,input?.planDigest,context);
    if(record.stage==='delivered'||record.stage==='delivery-unknown')return statusOf(record);
    if(record.stage!=='prepared')fail('transfer_in_progress',409);
    record=await save(record,{stage:'starting'});
    return runTransfer(record,{publish:true});
  }
  async function reconcile(input,context){
    let record=await recordFor(input?.transferId,input?.planDigest,context);
    if(record.stage==='prepared'||record.stage==='intent')fail('transfer_not_started',409);
    if(record.stage==='delivered')return statusOf(record);
    const registry=await registryPorts(),gateRecord=await registry.publicationJournal.get(record.transferId);
    if(gateRecord){
      let outcome;
      if(gateRecord.state==='prepared'){
        const selected=await connected(record),publisher=publisherFactory({target:record.target,
          token:selected.token,controlPlane:selected.control});
        let receipt;
        try{receipt=await publisher.inspect({transferId:record.transferId,artifact:record.artifact});}
        catch{return statusOf(record.stage==='delivery-unknown'?record:
          await save(record,{stage:'delivery-unknown'}));}
        outcome=await registry.publicationGate.confirmDelivered(record.transferId,receipt);
      }else outcome=await registry.publicationGate.reconcile(record.transferId);
      if(outcome.state==='synchronized')record=await save(record,
        {stage:'delivered',finalUrl:outcome.record.declaration.url});
      else if(record.stage!=='delivery-unknown')record=await save(record,{stage:'delivery-unknown'});
      return statusOf(record);
    }
    // The original START has already authorized this exact transfer. Explicit
    // reconcile may finish its pre-gate phases and then publish once; after a
    // gate claim, only read-only Worker inspection can confirm an unknown upload.
    return runTransfer(record,{publish:true});
  }
  return Object.freeze({inspect,configure,prepare,start,status,reconcile});
}
