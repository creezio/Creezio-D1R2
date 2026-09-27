import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {schemaDigest} from '../data/composition-schema.mjs';
import {applyCompositionSchema,inspectCompositionSchema} from '../data/apply-schema.mjs';
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
const UPDATE_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,55}$/;
const SHA=/^sha256-[a-f0-9]{64}$/;
const REF=/^creezio-secret:v1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const stages=['intent','prepared','starting','capturing','captured','built','preflight','schema-ready',
  'verified','sandbox-ready','publishing','delivery-unknown','delivered'];
const rank=stage=>stages.indexOf(stage);
const updateStages=['prepared','building','built','preflight','schema-applying','schema-ready',
  'publishing','delivery-unknown','delivered'];
const updateRank=stage=>updateStages.indexOf(stage);
const fail=(code,status=503)=>{throw Object.assign(new Error(`Delivery pipeline ${code}.`),{code,status});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sameArtifact=(a,b)=>a&&b&&['sourceSha','artifactDigest','coreVersion',
  'contractVersion','compositionDigest'].every(key=>a[key]===b[key]);
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
function updateStatusOf(record){
  return Object.freeze({kind:'update',updateId:record.updateId,planDigest:record.planDigest,
    phase:record.stage,summary:record.stage==='prepared'?record.summary:null,
    finalUrl:record.finalUrl??null,
    registryStatus:record.stage==='delivered'?'effective'
      :record.stage==='delivery-unknown'?'unknown':'pending'});
}
function updateArtifactRoot(root,updateId){
  if(typeof updateId!=='string'||!UPDATE_ID.test(updateId))fail('invalid_update',400);
  return path.join(root,'.wrangler','delivery','updates',updateId,'artifact');
}
function boundToTarget(bindings,target){
  return Array.isArray(bindings)
    &&bindings.some(item=>item.name==='DB'&&item.type==='d1'&&item.id===target.databaseId)
    &&bindings.some(item=>item.name==='BUCKET'&&item.type==='r2_bucket'
      &&item.bucket_name===target.bucketName)
    &&bindings.some(item=>item.name==='CREEZIO_RUNTIME_PROFILE'&&item.type==='plain_text'
      &&item.text==='cloudflare')
    &&bindings.some(item=>item.name==='CREEZIO_APP_ORIGIN'&&item.type==='plain_text'
      &&item.text===target.origin)
    &&bindings.some(item=>item.name==='CREEZIO_WIDGET_SANDBOX_ORIGIN'
      &&item.type==='plain_text'&&item.text===target.widgetSandboxOrigin)
    &&bindings.some(item=>item.name==='CREEZIO_VAULT_KEYRING'&&item.type==='secret_text');
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
  const inspectSchema=options.inspectSchema??inspectCompositionSchema;
  const updateJournal=options.updateJournal??null;
  const buildUpdateTarget=options.buildUpdateTarget??buildTarget;
  const controlFactory=options.controlFactory??(({accountId,token})=>createCloudflareControlPlane({accountId,token}));
  const provisionerFactory=options.provisionerFactory??(({control})=>
    createCloudflareProvisioner({control,journal:provisionJournal}));
  const d1Factory=options.d1Factory??(({accountId,databaseId,token})=>
    createRemoteD1Client({accountId,databaseId,token}));
  const r2Factory=options.r2Factory??(input=>createRemoteR2Client(input));
  const objectPortFactory=options.objectPortFactory??(({r2})=>
    createRemoteTransferObjectPort({r2,journal:transferJournal}));
  const publisherFactory=options.publisherFactory??(({target,token,controlPlane,artifactRoot})=>
    createCloudflarePublisher({root:config.root,
      artifactRoot:artifactRoot??options.artifactRoot??path.join(config.root,'.wrangler','delivery','build','artifact'),
      target,token,controlPlane}));
  const sandboxFactory=options.sandboxFactory??(({target,token,controlPlane})=>
    createCloudflareSandboxPublisher({root:config.root,target,token,controlPlane,
      journal:options.sandboxJournal}));
  const secretConnections=options.secretConnections??(async()=>[]);
  const sourceKeyring=options.sourceKeyring??(async()=>null);
  const transferIdFactory=options.transferIdFactory??randomUUID;
  const updateIdFactory=options.updateIdFactory??randomUUID;
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
  async function activeFor(principalId){
    let active=currentTransferId?await planJournal.load(currentTransferId):null;
    if(active?.owner!==principalId)active=null;
    if(!active&&typeof planJournal.findActive==='function'){
      const found=await planJournal.findActive(principalId);
      if(found)active=await planJournal.load(found);
    }
    return active?.owner===principalId?active:null;
  }
  async function inspect(context){
    const principalId=owner(context);
    const connections=await secretConnections(context);
    if(!Array.isArray(connections)||connections.length>1000)fail('source_unavailable');
    const active=await activeFor(principalId);
    const activeTarget=active?{accountId:active.accountId,workerName:active.workerName}:null;
    const selected=connection?.principalId===principalId
      &&(!activeTarget||connection.accountId===activeTarget.accountId
        &&connection.workerName===activeTarget.workerName)
      &&(!active||connection.tokenId===active.tokenId)?connection:null;
    return Object.freeze({hostProfile:'docker-local',
      target:activeTarget??(selected?{accountId:selected.accountId,workerName:selected.workerName}:null),
      configuration:selected?'ready':'needed',
      preparation:active?.stage==='prepared'?'ready':'needed',
      activeTransferId:active?.stage==='intent'?null:active?.transferId??null,
      secretConnections:structuredClone(connections)});
  }
  async function configure(input,context){
    const selected=validConnection(input),control=controlFactory(selected);
    const observed=await control.inspectConnection('account');
    if(observed.accountId!==selected.accountId||typeof observed.tokenId!=='string'
      ||!/^[a-f0-9]{32}$/.test(observed.tokenId)||typeof observed.workersSubdomain!=='string')
      fail('invalid_connection',403);
    const principalId=owner(context),active=await activeFor(principalId);
    if(active&&(active.accountId!==selected.accountId||active.workerName!==selected.workerName
      ||active.tokenId!==observed.tokenId))fail('connection_changed',409);
    if(updateJournal){
      const updateId=await updateJournal.findActive(principalId);
      const update=updateId?await updateJournal.load(updateId):null;
      if(update&&(update.accountId!==selected.accountId||update.workerName!==selected.workerName
        ||update.tokenId!==observed.tokenId))fail('connection_changed',409);
    }
    connection={...selected,principalId,tokenId:observed.tokenId,
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
  function updateReady(){
    if(!updateJournal||typeof updateJournal.load!=='function'||typeof updateJournal.createActive!=='function'
      ||typeof updateJournal.compareAndSave!=='function'||typeof updateJournal.findActive!=='function')
      fail('update_unavailable',503);
  }
  async function saveUpdate(record,changes){
    const next={...record,...changes,revision:record.revision+1};
    await updateJournal.compareAndSave(record,next);return next;
  }
  async function updateRecordFor(updateId,planDigest,context){
    updateReady();
    if(typeof updateId!=='string'||!UPDATE_ID.test(updateId)||typeof planDigest!=='string'
      ||!SHA.test(planDigest))fail('invalid_input',400);
    const record=await updateJournal.load(updateId);
    if(!record||record.updateId!==updateId||record.owner!==owner(context)
      ||record.planDigest!==planDigest||!updateStages.includes(record.stage))fail('forbidden',403);
    return record;
  }
  async function currentPublication(principalId,selected,registry){
    const deployments=await selected.control.deployments(selected.workerName);
    const active=deployments?.deployments?.[0];
    if(!active||!Array.isArray(active.versions)||active.versions.length!==1
      ||active.versions[0].percentage!==100
      ||typeof active.versions[0].version_id!=='string')fail('deployment_changed',409);
    const versionId=active.versions[0].version_id;
    const settings=await selected.control.workerSettings(selected.workerName);
    const tag=settings?.annotations?.['workers/tag'];
    if(typeof tag!=='string'||!tag.startsWith('cz-')||!ID.test(tag.slice(3)))
      fail('unmanaged_worker',409);
    const publicationId=tag.slice(3);
    const [initial,updated]=await Promise.all([planJournal.load(publicationId),
      updateJournal.load(publicationId)]);
    if(Boolean(initial)===Boolean(updated))fail('unmanaged_worker',409);
    const prior=initial??updated;
    if(prior.owner!==principalId||prior.stage!=='delivered'
      ||prior.accountId!==selected.accountId||prior.workerName!==selected.workerName
      ||prior.tokenId!==selected.tokenId||!prior.target||!prior.artifact
      ||prior.registryProjectId!==registry.registryIdentity.projectId
      ||prior.registryInstallationId!==registry.registryIdentity.installationId
      ||settings.annotations?.['workers/message']!==
        `Creezio ${prior.artifact.artifactDigest} ${prior.artifact.sourceSha}`
      ||!boundToTarget(settings.bindings,prior.target))fail('unmanaged_worker',409);
    const gate=await registry.publicationJournal.get(publicationId);
    if(gate?.state!=='synchronized'||gate.declaration?.deploymentId!==active.id
      ||!sameArtifact(gate.declaration?.artifact,prior.artifact))fail('deployment_changed',409);
    const version=await selected.control.version(selected.workerName,versionId);
    if(version?.id!==versionId)fail('deployment_changed',409);
    return {publicationId,prior,deploymentId:active.id,versionId};
  }
  async function assertPrevious(record,selected,registry){
    const current=await currentPublication(record.owner,selected,registry);
    if(current.publicationId!==record.previousPublicationId
      ||current.deploymentId!==record.previousDeploymentId
      ||current.versionId!==record.previousVersionId
      ||!same(current.prior.target,record.target)
      ||!sameArtifact(current.prior.artifact,record.previousArtifact))fail('deployment_changed',409);
    return current;
  }
  async function updateProjectionFor(record){
    const source=identity(config.root);
    if(source.dirty||source.head!==record.sourceSha||source.sha256!==record.sourceFingerprint)
      fail('source_changed',409);
    const projection=project();
    if(projection?.targetPlan?.planDigest!==record.targetPlanDigest
      ||projection.targetPlan.compositionDigest!==record.targetCompositionDigest
      ||projection.compatibilityDigest!==record.compatibilityDigest)
      fail('plan_changed',409);
    return projection;
  }
  async function updateDatabase(record,selected){
    const client=d1Factory({accountId:record.accountId,databaseId:record.target.databaseId,
      token:selected.token}),db=options.d1BindingFactory?.(client)??createRemoteD1Binding(client);
    const metadata=await client.metadata();
    if(metadata.uuid!==record.target.databaseId)fail('database_changed',409);
    const bucket=await selected.control.bucket(record.target.bucketName,'default');
    if(!bucket?.private)fail('bucket_not_private',409);
    return db;
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
  async function inspectUpdate(context){
    updateReady();
    const principalId=owner(context),activeId=await updateJournal.findActive(principalId);
    const active=activeId?await updateJournal.load(activeId):null;
    const target=active?{accountId:active.accountId,workerName:active.workerName}
      :connection?.principalId===principalId
        ?{accountId:connection.accountId,workerName:connection.workerName}:null;
    if(!connection||connection.principalId!==principalId)
      return {kind:'update',readiness:'needed',currentPublicationId:null,
        activeUpdateId:activeId,target};
    if(active)return {kind:'update',readiness:'ready',
      currentPublicationId:active.previousPublicationId,activeUpdateId:activeId,target};
    const registry=await registryPorts();
    const current=await currentPublication(principalId,connection,registry);
    return {kind:'update',readiness:'ready',currentPublicationId:current.publicationId,
      activeUpdateId:activeId,target};
  }
  async function prepareUpdate(input,context){
    updateReady();
    if(!exact(input,[]))fail('invalid_input',400);
    const principalId=owner(context);
    if(!connection||connection.principalId!==principalId)fail('configuration_needed',409);
    if(await planJournal.findActive(principalId))fail('transfer_in_progress',409);
    const registry=await registryPorts(),activeId=await updateJournal.findActive(principalId);
    if(activeId){
      const active=await updateJournal.load(activeId);
      if(active?.stage!=='prepared')fail('update_in_progress',409);
      await assertPrevious(active,await connected(active),registry);
      await updateProjectionFor(active);
      return {kind:'update',updateId:active.updateId,planDigest:active.planDigest,
        summary:active.summary};
    }
    const selected=connection,current=await currentPublication(principalId,selected,registry);
    const source=identity(config.root);
    if(source.dirty||!/^[a-f0-9]{40}$/.test(source.head))fail('source_not_clean',409);
    const projection=project(),targetPlan=projection?.targetPlan;
    if(!SHA.test(targetPlan?.planDigest??'')||!SHA.test(targetPlan?.compositionDigest??'')
      ||!SHA.test(projection?.compatibilityDigest??''))fail('plan_changed',409);
    const db=await updateDatabase(current.prior,selected),schemaState=await inspectSchema(db,targetPlan);
    if(!['ready','additive'].includes(schemaState?.state))fail('schema_unavailable',409);
    const updateId=updateIdFactory();
    updateArtifactRoot(config.root,updateId);
    if(await planJournal.load(updateId)||await updateJournal.load(updateId))fail('invalid_update',409);
    const planDigest=schemaDigest({updateId,owner:principalId,sourceSha:source.head,
      sourceFingerprint:source.sha256,targetPlanDigest:targetPlan.planDigest,
      targetCompositionDigest:targetPlan.compositionDigest,
      compatibilityDigest:projection.compatibilityDigest,target:current.prior.target,
      previousPublicationId:current.publicationId,
      previousDeploymentId:current.deploymentId,previousVersionId:current.versionId,
      previousArtifact:current.prior.artifact,tokenId:selected.tokenId,
      registryProjectId:registry.registryIdentity.projectId,
      registryInstallationId:registry.registryIdentity.installationId});
    const summary=Object.freeze({title:'Mise à jour Cloudflare conservatrice',
      details:Object.freeze([`Worker ${selected.workerName}`,
        `Schéma ${schemaState.state==='ready'?'déjà compatible':'ajouts compatibles requis'}`]),
      warnings:Object.freeze(['Les données de production sont conservées ; le schéma additif précède le nouveau code.'])});
    const record={schemaVersion:1,revision:1,updateId,owner:principalId,stage:'prepared',
      accountId:selected.accountId,workerName:selected.workerName,tokenId:selected.tokenId,
      target:current.prior.target,previousPublicationId:current.publicationId,
      previousDeploymentId:current.deploymentId,previousVersionId:current.versionId,
      previousArtifact:current.prior.artifact,sourceSha:source.head,
      sourceFingerprint:source.sha256,targetPlanDigest:targetPlan.planDigest,
      targetCompositionDigest:targetPlan.compositionDigest,
      compatibilityDigest:projection.compatibilityDigest,
      registryProjectId:registry.registryIdentity.projectId,
      registryInstallationId:registry.registryIdentity.installationId,
      planDigest,summary,artifact:null,initialPreflight:null,schemaReceiptId:null,finalUrl:null};
    await updateJournal.createActive(record);
    return {kind:'update',updateId,planDigest,summary};
  }
  async function runUpdate(initial){
    let record=initial;
    const registry=await registryPorts();
    if(registry.registryIdentity.projectId!==record.registryProjectId
      ||registry.registryIdentity.installationId!==record.registryInstallationId)
      fail('registry_changed',409);
    const selected=await connected(record),projection=await updateProjectionFor(record);
    const artifactRoot=updateArtifactRoot(config.root,record.updateId);
    if(updateRank(record.stage)<=updateRank('building')){
      await assertPrevious(record,selected,registry);
      const artifact=await buildUpdateTarget({target:record.target,projection,sourceSha:record.sourceSha,
        transferId:record.updateId,updateId:record.updateId,artifactRoot});
      if(!validArtifact(artifact,record))fail('artifact_changed',409);
      record=await saveUpdate(record,{stage:'built',artifact});
    }
    const request={projectId:registry.registryIdentity.projectId,
      installationId:registry.registryIdentity.installationId,target:'cloudflare',artifact:record.artifact};
    if(updateRank(record.stage)<updateRank('preflight')){
      const receipt=await registry.registryClient.preflight(request);
      if(receipt.projectId!==request.projectId||receipt.installationId!==request.installationId
        ||Date.parse(receipt.expiresAt)<=Date.now())fail('registry_preflight',409);
      record=await saveUpdate(record,{stage:'preflight',initialPreflight:receipt.preflightId});
    }
    if(updateRank(record.stage)<updateRank('schema-ready')){
      await assertPrevious(record,selected,registry);
      const db=await updateDatabase(record,selected),observed=await inspectSchema(db,projection.targetPlan);
      if(!['ready','additive'].includes(observed?.state))fail('schema_unavailable',409);
      if(record.stage!=='schema-applying')record=await saveUpdate(record,{stage:'schema-applying'});
      const applied=await schema(db,projection.targetPlan,
        {expectedPlanDigest:projection.targetPlan.planDigest});
      if(applied.ok!==true||applied.observedState!=='ready'||!SHA.test(applied.receiptId??''))
        fail('schema_unavailable',409);
      record=await saveUpdate(record,{stage:'schema-ready',schemaReceiptId:applied.receiptId});
    }
    if(updateRank(record.stage)<=updateRank('schema-ready')){
      await assertPrevious(record,selected,registry);
      const db=await updateDatabase(record,selected),observed=await inspectSchema(db,projection.targetPlan);
      if(observed?.state!=='ready'||observed.receiptId!==record.schemaReceiptId)
        fail('schema_unavailable',409);
      record=await saveUpdate(record,{stage:'publishing'});
    }
    await assertPrevious(record,selected,registry);
    const publisher=publisherFactory({target:record.target,token:selected.token,
      controlPlane:selected.control,artifactRoot});
    const outcome=await registry.publicationGate.publish(request,record.updateId,
      ()=>publisher.deliver({transferId:record.updateId,artifact:record.artifact,
        expectedPreviousVersionId:record.previousVersionId,
        expectedPreviousDeploymentId:record.previousDeploymentId}));
    if(outcome.state==='synchronized')record=await saveUpdate(record,
      {stage:'delivered',finalUrl:outcome.record.declaration.url});
    else if(outcome.state==='blocked'
      &&await registry.publicationJournal.get(record.updateId)===null)
      record=await saveUpdate(record,{stage:'schema-ready'});
    else record=await saveUpdate(record,{stage:'delivery-unknown'});
    return updateStatusOf(record);
  }
  async function startUpdate(input,context){
    let record=await updateRecordFor(input?.updateId,input?.planDigest,context);
    if(record.stage==='delivered'||record.stage==='delivery-unknown')return updateStatusOf(record);
    if(record.stage!=='prepared')fail('update_in_progress',409);
    record=await saveUpdate(record,{stage:'building'});
    return runUpdate(record);
  }
  async function statusUpdate(updateId,context){
    updateReady();
    if(typeof updateId!=='string'||!UPDATE_ID.test(updateId))fail('invalid_input',400);
    const record=await updateJournal.load(updateId);
    if(!record||record.updateId!==updateId||record.owner!==owner(context)
      ||!updateStages.includes(record.stage))fail('forbidden',403);
    return updateStatusOf(record);
  }
  async function reconcileUpdate(input,context){
    let record=await updateRecordFor(input?.updateId,input?.planDigest,context);
    if(record.stage==='prepared')fail('update_not_started',409);
    if(record.stage==='delivered')return updateStatusOf(record);
    const registry=await registryPorts(),gateRecord=await registry.publicationJournal.get(record.updateId);
    if(gateRecord){
      let outcome;
      if(gateRecord.state==='prepared'){
        const selected=await connected(record),publisher=publisherFactory({target:record.target,
          token:selected.token,controlPlane:selected.control,
          artifactRoot:updateArtifactRoot(config.root,record.updateId)});
        let receipt;
        try{receipt=await publisher.inspect({transferId:record.updateId,artifact:record.artifact});}
        catch{return updateStatusOf(record.stage==='delivery-unknown'?record:
          await saveUpdate(record,{stage:'delivery-unknown'}));}
        outcome=await registry.publicationGate.confirmDelivered(record.updateId,receipt);
      }else outcome=await registry.publicationGate.reconcile(record.updateId);
      if(outcome.state==='synchronized')record=await saveUpdate(record,
        {stage:'delivered',finalUrl:outcome.record.declaration.url});
      else if(record.stage!=='delivery-unknown')record=await saveUpdate(record,{stage:'delivery-unknown'});
      return updateStatusOf(record);
    }
    if(record.stage==='delivery-unknown')fail('delivery_unknown',409);
    return runUpdate(record);
  }
  return Object.freeze({inspect,configure,prepare,start,status,reconcile,
    inspectUpdate,prepareUpdate,startUpdate,statusUpdate,reconcileUpdate});
}
