import {spawn} from 'node:child_process';
import {createReadStream,constants as fsConstants} from 'node:fs';
import {createHash} from 'node:crypto';
import {copyFile,lstat,mkdir,open,readFile,readdir,rename,rmdir,statfs,unlink} from 'node:fs/promises';
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
import {cloudflareBuildPaths} from './artifact-path.mjs';

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
const COPY_MAX_FILES=2000,COPY_MAX_BYTES=512*1024*1024,COPY_MAX_FILE_BYTES=128*1024*1024;
async function fileDigest(file){
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>COPY_MAX_FILE_BYTES)fail('artifact_copy_limit');
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(file)){
    bytes+=chunk.length;if(bytes>COPY_MAX_FILE_BYTES)fail('artifact_copy_limit');digest.update(chunk);
  }
  return {bytes,sha256:digest.digest('hex')};
}
async function copyVerified(source,staging,item){
  const destination=path.join(staging,item.path),parent=path.dirname(item.path);
  await directory(staging,parent);
  const actual=await lstat(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(actual){
    if(JSON.stringify(await fileDigest(destination))!==JSON.stringify({bytes:item.bytes,sha256:item.sha256}))
      fail('artifact_stage_conflict');
    return;
  }
  if(JSON.stringify(await fileDigest(source))!==JSON.stringify({bytes:item.bytes,sha256:item.sha256}))
    fail('artifact_changed');
  const temporary=path.join(staging,'.copy-part');
  const partial=await lstat(temporary).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(partial){
    if(!partial.isFile()||partial.isSymbolicLink())fail('artifact_stage_conflict');
    await unlink(temporary); // Only this intent's incomplete copy may be replaced.
  }
  await copyFile(source,temporary,fsConstants.COPYFILE_EXCL);
  if(JSON.stringify(await fileDigest(temporary))!==JSON.stringify({bytes:item.bytes,sha256:item.sha256}))
    fail('artifact_changed');
  await rename(temporary,destination); // Same volume as the staging directory.
}
async function inspectGeneratedDist(root,artifact){
  const target=path.join(root,'dist'),files=[],directories=[];
  if(measureRuntimeArtifacts(root).digest!==artifact.digest)fail('build_recovery_required');
  async function inspect(relative=''){
    for(const name of await readdir(path.join(target,relative))){
      const child=path.join(relative,name),stat=await lstat(path.join(target,child));
      if(stat.isSymbolicLink()||files.length+directories.length>=COPY_MAX_FILES*4)
        fail('build_recovery_required');
      if(stat.isDirectory()){directories.push(child);await inspect(child);}
      else if(stat.isFile())files.push(child);
      else fail('build_recovery_required');
    }
  }
  await inspect();
  const expected=artifact.files.map(item=>item.path.slice('dist/'.length)).sort();
  if(JSON.stringify(files.map(name=>name.replaceAll('\\','/')).sort())!==JSON.stringify(expected))
    fail('build_recovery_required');
  return {target,files,directories};
}
async function removeGeneratedDist(root,artifact){
  const {target,files,directories}=await inspectGeneratedDist(root,artifact);
  for(const name of files)await unlink(path.join(target,name));
  for(const name of directories.sort((a,b)=>b.split(path.sep).length-a.split(path.sep).length))
    await rmdir(path.join(target,name));
  await rmdir(target);
}
/** Keeps the active local dist and one durable Cloudflare artifact across filesystems. */
export function createCloudflareBuildPort(config,{run=runBuild,
  freeBytes=async root=>{const space=await statfs(root);return space.bavail*space.bsize;},
  move=rename,removeReport=unlink}={}){
  let building=false;
  return async({target,projection,sourceSha,transferId,updateId=null,
    artifactRoot:requestedRoot,beforeBuild})=>{
    if(building)fail('build_busy');
    building=true;
    try{
    if(updateId!==null&&transferId!==updateId)fail('invalid_artifact_identity');
    if(updateId===null&&typeof transferId!=='string')fail('invalid_artifact_identity');
    let paths;
    try{paths=cloudflareBuildPaths(config.root,updateId);}catch{fail('invalid_artifact_identity');}
    if(requestedRoot!==undefined&&requestedRoot!==paths.artifactRoot)
      fail('invalid_artifact_identity');
    if(beforeBuild!==undefined&&(updateId===null||typeof beforeBuild!=='function'))
      fail('invalid_artifact_identity');
    const source=sourceIdentity(config.root);
    if(source.dirty||source.head!==sourceSha)fail('source_changed');
    const build=await directory(config.root,path.relative(config.root,paths.buildSpace));
    const localBuild=paths.localSpace;
    const artifactRoot=paths.artifactRoot,localDist=path.join(config.root,'dist'),
      staging=paths.staging,
      localBackup=path.join(localBuild,'local-dist'),failedDist=path.join(localBuild,'failed-dist');
    if(await optionalDirectory(localBackup)||await optionalDirectory(path.join(build,'local-dist'))
      ||await optionalDirectory(path.join(build,'failed-dist'))
      ||updateId!==null&&await optionalDirectory(path.join(config.root,'.quality/delivery-build/local-dist')))
      fail('build_recovery_required');
    const artifactRecord=path.join(artifactRoot,'receipt.json');
    const selected={...(updateId===null?{transferId}:{updateId}),target,sourceSha,
      sourceFingerprint:source.sha256,
      compositionDigest:projection.targetPlan.compositionDigest};
    const result=()=>({sourceSha,artifactDigest:measureRuntimeArtifacts(artifactRoot).digest,
      compositionDigest:projection.targetPlan.compositionDigest,
      coreVersion:projection.composition.sdk.coreVersion,
      contractVersion:projection.composition.schemaVersion});
    if(await optionalDirectory(artifactRoot)){
      let receipt,report,artifact;
      try{
        receipt=JSON.parse(await readPrivate(artifactRecord));
        report=JSON.parse(await readPrivate(path.join(artifactRoot,'.quality/cloudflare-build.json'),2*1024*1024));
        artifact=result();
      }catch{fail('artifact_exists');}
      if(JSON.stringify(receipt.selected)!==JSON.stringify(selected)
        ||receipt.artifactDigest!==artifact.artifactDigest
        ||report.artifact?.digest!==artifact.artifactDigest
        ||report.compositionDigest!==selected.compositionDigest
        ||!sameSourceIdentity(source,report.source))fail('artifact_exists');
      return artifact;
    }
    await directory(config.root,path.relative(config.root,localBuild));
    if(await freeBytes(config.root)<20*1024**3||await freeBytes(build)<20*1024**3)fail('disk_low');
    const targetPath=path.join(build,'target.json'),compositionPath=path.join(build,'composition.json'),lockPath=path.join(build,'composition.lock.json');
    await writeBuildInput(targetPath,target);await writeBuildInput(compositionPath,projection.composition);await writeBuildInput(lockPath,projection.lock);
    const env={...process.env,CREEZIO_BUILD_PROFILE:'cloudflare',CREEZIO_CLOUDFLARE_TARGET:targetPath,
      CREEZIO_COMPOSITION:path.relative(config.root,compositionPath).replaceAll('\\','/'),
      CREEZIO_COMPOSITION_LOCK:path.relative(config.root,lockPath).replaceAll('\\','/')};
    for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL','CREEZIO_VAULT_KEYRING',
      'OPENAI_API_KEY','CREEZIO_REGISTRY_INSTALLATION_TOKEN','CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL'])delete env[key];
    if(beforeBuild)await beforeBuild();
    const hadLocal=Boolean(await optionalDirectory(localDist));
    if(hadLocal)await move(localDist,localBackup);
    let complete=false,builtArtifact;
    try{
      if(await optionalDirectory(failedDist))await move(failedDist,localDist);
      await run(config.root,env);
      const report=JSON.parse(await readPrivate(path.join(config.root,'.quality/cloudflare-build.json'),2*1024*1024));
      const artifact=measureRuntimeArtifacts(config.root);
      builtArtifact=artifact;
      if(!sameSourceIdentity(source,sourceIdentity(config.root))||!sameSourceIdentity(source,report.source)
        ||report.artifact.digest!==artifact.digest||report.compositionDigest!==selected.compositionDigest)
        fail('artifact_changed');
      if(artifact.files.length>COPY_MAX_FILES||artifact.files.some(item=>item.bytes>COPY_MAX_FILE_BYTES)
        ||artifact.files.reduce((total,item)=>total+item.bytes,0)>COPY_MAX_BYTES)fail('artifact_copy_limit');
      const intent={selected,artifactDigest:artifact.digest};
      if(await optionalDirectory(staging)){
        let existing;
        try{existing=JSON.parse(await readPrivate(path.join(staging,'receipt.json')));}
        catch{fail('artifact_stage_conflict');}
        if(JSON.stringify(existing)!==JSON.stringify(intent))fail('artifact_stage_conflict');
      }else{
        await mkdir(staging,{mode:0o700});
        await writeBuildInput(path.join(staging,'receipt.json'),intent);
      }
      for(const item of artifact.files)
        await copyVerified(path.join(config.root,item.path),staging,item);
      const reportSource=path.join(config.root,'.quality/cloudflare-build.json');
      const reportBytes=await readFile(reportSource);
      if(reportBytes.length>2*1024*1024)fail('artifact_copy_limit');
      await copyVerified(reportSource,staging,{path:'.quality/cloudflare-build.json',
        bytes:reportBytes.length,sha256:createHash('sha256').update(reportBytes).digest('hex')});
      const partial=path.join(staging,'.copy-part');
      const partialStat=await lstat(partial).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(partialStat){
        if(!partialStat.isFile()||partialStat.isSymbolicLink())fail('artifact_stage_conflict');
        await unlink(partial);
      }
      const stagedReport=JSON.parse(await readPrivate(path.join(staging,'.quality/cloudflare-build.json'),2*1024*1024));
      if(measureRuntimeArtifacts(staging).digest!==artifact.digest
        ||stagedReport.artifact?.digest!==artifact.digest
        ||!sameSourceIdentity(source,stagedReport.source))fail('artifact_changed');
      if(JSON.stringify((await readdir(staging)).sort())!==JSON.stringify(['.quality','dist','receipt.json'])
        ||JSON.stringify((await readdir(path.join(staging,'dist'))).sort())!==JSON.stringify(['client','server'])
        ||JSON.stringify(await readdir(path.join(staging,'.quality')))!==JSON.stringify(['cloudflare-build.json']))
        fail('artifact_stage_conflict');
      await inspectGeneratedDist(config.root,artifact);
      if(await optionalDirectory(artifactRoot))fail('artifact_exists');
      await move(staging,artifactRoot); // Atomic publication within the destination volume.
      if(result().artifactDigest!==artifact.digest)fail('artifact_changed');
      complete=true;
      return result();
    }finally{
      // Failed overlay and destination staging are retained for same-intent retry.
      // A process crash leaves local-dist in place for explicit recovery.
      if(complete){
        let cleanupError=null;
        try{
          if(await optionalDirectory(localDist))await removeGeneratedDist(config.root,builtArtifact);
          await removeReport(path.join(config.root,'.quality/cloudflare-build.json'));
        }catch(error){cleanupError=error;}
        let residue;
        try{residue=await optionalDirectory(localDist);}catch{fail('build_recovery_required');}
        if(residue)fail('build_recovery_required'); // Never overwrite a residual build.
        if(hadLocal){
          try{await move(localBackup,localDist);}catch{fail('build_recovery_required');}
        }
        if(cleanupError)fail('artifact_cleanup_failed');
      }else{
        try{
          if(await optionalDirectory(localDist)){
            if(await optionalDirectory(failedDist))fail('build_recovery_required');
            await move(localDist,failedDist);
          }
          if(hadLocal)await move(localBackup,localDist);
        }catch{fail('build_recovery_required');}
      }
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
export function superviseDeliveryOperations(pipeline,supervisor){
  const operations={...pipeline};
  for(const kind of ['start','reconcile','startUpdate','reconcileUpdate']){
    if(typeof pipeline[kind]!=='function')continue;
    operations[kind]=async(...args)=>{
    let recoveryRequired=false;
    try{return await pipeline[kind](...args);}
    catch(error){recoveryRequired=error?.code==='build_recovery_required';throw error;}
    finally{if(!supervisor.closing&&!recoveryRequired)supervisor.start();}
    };
  }
  return operations;
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
  const buildTarget=createCloudflareBuildPort(config);
  const pipeline=createCloudflareDeliveryPipeline({config,
    artifactRoot:path.join(state,'build','artifact'),
    compositionPath:process.env.CREEZIO_COMPOSITION||'configuration/composition.json',
    lockPath:process.env.CREEZIO_COMPOSITION_LOCK||undefined,
    planJournal:createLocalControlJournal(state,'plan'),provisionJournal:createLocalControlJournal(state,'provision'),
    transferJournal:createFileTransferJournal(state),sandboxJournal:createLocalControlJournal(state,'sandbox'),
    updateJournal:createLocalControlJournal(state,'update'),
    registryContext:createLocalRegistryContext(config,publicationJournal),
    stopRuntime:()=>supervisor.stop(),buildTarget,
    buildUpdateTarget:input=>buildTarget({...input,beforeBuild:async()=>{
      try{await supervisor.stop();}
      catch{fail('build_recovery_required');}
    }}),
    targetVault:createTargetVault(config.root),sourceKeyring:()=>localSourceKeyring(config.root),
    secretConnections:context=>{
      if(!Array.isArray(context?.secretConnections))fail('source_unavailable');
      return context.secretConnections;
    },
  });
  return createLocalDeliveryServer({config,port:config.operatorPort,
    operations:superviseDeliveryOperations(pipeline,supervisor)});
}
