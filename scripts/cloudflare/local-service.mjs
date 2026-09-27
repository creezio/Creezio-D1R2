import {spawn} from 'node:child_process';
import {lstat,mkdir,open,readFile,rename,statfs} from 'node:fs/promises';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {createRegistryClient} from '../../core/registry/client.ts';
import {createPublicationGate} from '../../core/registry/publication.ts';
import {createFilePublicationJournal} from '../../core/registry/file-journal.ts';
import {readProviderKeyring} from '../../core/providers/host.ts';
import {createCloudflareDeliveryPipeline} from './pipeline.mjs';
import {createLocalControlJournal} from './local-journal.mjs';
import {createTargetVault} from './target-vault.mjs';
import {createFileTransferJournal} from './transfer/journal.ts';
import {createLocalDeliveryServer} from './operator-http.mjs';
import {sourceIdentity,sameSourceIdentity} from '../quality/evidence.mjs';
import {measureRuntimeArtifacts} from '../quality/runtime.mjs';

const fail=code=>{throw Object.assign(new Error(`Local delivery ${code}.`),{code});};
async function directory(root,suffix){
  const destination=path.resolve(root,suffix);
  if(!destination.startsWith(path.resolve(root)+path.sep))fail('invalid_path');
  let current=path.resolve(root);
  for(const part of path.relative(root,destination).split(path.sep)){
    const stat=await lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())fail('invalid_path');
    current=path.join(current,part);
    try{await mkdir(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  for(let ancestor=destination;;ancestor=path.dirname(ancestor)){
    const stat=await lstat(ancestor);if(stat.isSymbolicLink()||!stat.isDirectory())fail('invalid_path');
    if(ancestor===path.dirname(ancestor))break;
  }
  return destination;
}
async function readPrivate(file,max=16384){
  for(let current=file;;current=path.dirname(current)){
    if((await lstat(current)).isSymbolicLink())fail('invalid_path');
    if(current===path.dirname(current))break;
  }
  const stat=await lstat(file);if(!stat.isFile()||stat.size>max)fail('invalid_configuration');
  const value=await readFile(file,'utf8');if(Buffer.byteLength(value)>max)fail('invalid_configuration');return value;
}
async function writeBuildInput(file,value){
  const existing=await lstat(file).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
  if(existing&&(!existing.isFile()||existing.isSymbolicLink()))fail('invalid_path');
  const handle=await open(file,'w',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
}
function runBuild(root,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(root,'scripts/cloudflare/build.mjs')],
      {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let failed=false,bytes=0;
    const consume=chunk=>{bytes=Math.min(bytes+chunk.length,4*1024*1024+1);if(bytes>4*1024*1024)failed=true;};
    child.stdout.on('data',consume);child.stderr.on('data',consume);
    const timer=setTimeout(()=>{failed=true;child.kill('SIGTERM');},15*60*1000);
    child.once('error',()=>{clearTimeout(timer);reject(Object.assign(new Error('Build failed.'),{code:'build_failed'}));});
    child.once('close',code=>{clearTimeout(timer);if(code===0&&!failed)resolve();
      else reject(Object.assign(new Error('Build failed.'),{code:'build_failed'}));});
  });
}
async function optionalDirectory(location){
  const stat=await lstat(location).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))fail('invalid_path');
  return stat;
}
/** Keeps the active local dist and one durable Cloudflare artifact without copying either tree. */
export function createCloudflareBuildPort(config,{run=runBuild,
  freeBytes=async root=>{const space=await statfs(root);return space.bavail*space.bsize;}}={}){
  let building=false;
  return async({target,projection,sourceSha,transferId})=>{
    if(building)fail('build_busy');
    building=true;
    try{
    const source=sourceIdentity(config.root);
    if(source.dirty||source.head!==sourceSha)fail('source_changed');
    const build=await directory(config.root,'.wrangler/delivery/build');
    const artifactRoot=path.join(build,'artifact'),localDist=path.join(config.root,'dist'),
      localBackup=path.join(build,'local-dist'),failedDist=path.join(build,'failed-dist');
    if(await optionalDirectory(localBackup))fail('build_recovery_required');
    const artifactRecord=path.join(artifactRoot,'receipt.json');
    const selected={transferId,target,sourceSha,sourceFingerprint:source.sha256,
      compositionDigest:projection.targetPlan.compositionDigest};
    const result=()=>({sourceSha,artifactDigest:measureRuntimeArtifacts(artifactRoot).digest,
      compositionDigest:projection.targetPlan.compositionDigest,
      coreVersion:projection.composition.sdk.coreVersion,
      contractVersion:projection.composition.schemaVersion});
    if(await optionalDirectory(artifactRoot)){
      const receipt=JSON.parse(await readPrivate(artifactRecord));
      const report=JSON.parse(await readPrivate(path.join(artifactRoot,'.quality/cloudflare-build.json'),2*1024*1024));
      const artifact=result();
      if(JSON.stringify(receipt.selected)!==JSON.stringify(selected)
        ||receipt.artifactDigest!==artifact.artifactDigest
        ||report.artifact?.digest!==artifact.artifactDigest
        ||report.compositionDigest!==selected.compositionDigest
        ||!sameSourceIdentity(source,report.source))fail('artifact_exists');
      return artifact;
    }
    if(await freeBytes(config.root)<20*1024**3)fail('disk_low');
    const targetPath=path.join(build,'target.json'),compositionPath=path.join(build,'composition.json'),lockPath=path.join(build,'composition.lock.json');
    await writeBuildInput(targetPath,target);await writeBuildInput(compositionPath,projection.composition);await writeBuildInput(lockPath,projection.lock);
    const env={...process.env,CREEZIO_BUILD_PROFILE:'cloudflare',CREEZIO_CLOUDFLARE_TARGET:targetPath,
      CREEZIO_COMPOSITION:path.relative(config.root,compositionPath).replaceAll('\\','/'),
      CREEZIO_COMPOSITION_LOCK:path.relative(config.root,lockPath).replaceAll('\\','/')};
    for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL','CREEZIO_VAULT_KEYRING',
      'OPENAI_API_KEY','CREEZIO_REGISTRY_INSTALLATION_TOKEN','CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL'])delete env[key];
    const hadLocal=Boolean(await optionalDirectory(localDist));
    if(hadLocal)await rename(localDist,localBackup);
    let complete=false;
    try{
      if(await optionalDirectory(failedDist))await rename(failedDist,localDist);
      await run(config.root,env);
      const report=JSON.parse(await readPrivate(path.join(config.root,'.quality/cloudflare-build.json'),2*1024*1024));
      const artifact=measureRuntimeArtifacts(config.root);
      if(!sameSourceIdentity(source,sourceIdentity(config.root))||!sameSourceIdentity(source,report.source)
        ||report.artifact.digest!==artifact.digest||report.compositionDigest!==selected.compositionDigest)
        fail('artifact_changed');
      await mkdir(artifactRoot,{mode:0o700});
      await mkdir(path.join(artifactRoot,'.quality'),{mode:0o700});
      await rename(localDist,path.join(artifactRoot,'dist'));
      await rename(path.join(config.root,'.quality/cloudflare-build.json'),
        path.join(artifactRoot,'.quality/cloudflare-build.json'));
      await writeBuildInput(artifactRecord,{selected,artifactDigest:artifact.digest});
      complete=true;
      return result();
    }finally{
      // A failed build's sole staging directory is reused by the next build.
      // A process crash leaves local-dist in place for explicit recovery.
      if(!complete&&await optionalDirectory(localDist)){
        if(await optionalDirectory(failedDist))fail('build_recovery_required');
        await rename(localDist,failedDist);
      }
      if(hadLocal)await rename(localBackup,localDist);
    }
    }finally{building=false;}
  };
}

/** Registration is read only when publishing. Local development stays available offline. */
export function createLocalRegistryContext(config,journal){
  return async()=>{
    let value;
    try{value=JSON.parse(await readPrivate(path.join(config.root,'.wrangler/delivery/registry.json')));}
    catch{fail('registry_registration_required');}
    if(!value||Object.keys(value).sort().join(',')!=='installationId,installationToken,origin,projectId')fail('registry_registration_required');
    const registryClient=createRegistryClient({origin:value.origin,installationToken:value.installationToken});
    return {registryIdentity:{projectId:value.projectId,installationId:value.installationId},registryClient,
      publicationJournal:journal,publicationGate:createPublicationGate({client:registryClient,journal})};
  };
}
async function localSourceKeyring(root){
  let environment={CREEZIO_VAULT_KEYRING:process.env.CREEZIO_VAULT_KEYRING};
  const devFile=path.join(root,'.dev.vars');
  try{const vars=parseEnv(await readPrivate(devFile,65536));
    if(Object.hasOwn(vars,'CREEZIO_VAULT_KEYRING'))environment=vars;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return readProviderKeyring(environment);
}
export async function createLocalDeliveryService({config,supervisor}){
  const state=await directory(config.root,'.wrangler/delivery');
  const publicationJournal=createFilePublicationJournal(state);
  const pipeline=createCloudflareDeliveryPipeline({config,
    artifactRoot:path.join(state,'build','artifact'),
    compositionPath:process.env.CREEZIO_COMPOSITION||'configuration/composition.json',
    lockPath:process.env.CREEZIO_COMPOSITION_LOCK||undefined,
    planJournal:createLocalControlJournal(state,'plan'),provisionJournal:createLocalControlJournal(state,'provision'),
    transferJournal:createFileTransferJournal(state),sandboxJournal:createLocalControlJournal(state,'sandbox'),
    registryContext:createLocalRegistryContext(config,publicationJournal),
    stopRuntime:()=>supervisor.stop(),buildTarget:createCloudflareBuildPort(config),
    targetVault:createTargetVault(config.root),sourceKeyring:()=>localSourceKeyring(config.root),
    secretConnections:context=>{
      if(!Array.isArray(context?.secretConnections))fail('source_unavailable');
      return context.secretConnections;
    },
  });
  const operations={...pipeline};
  for(const kind of ['start','reconcile'])operations[kind]=async(...args)=>{
    try{return await pipeline[kind](...args);}finally{if(!supervisor.closing)supervisor.start();}
  };
  return createLocalDeliveryServer({config,port:config.operatorPort,operations});
}
