#!/usr/bin/env node
/** Apply one accepted module plan to this checkout. This is deliberately not a runtime operation. */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmdirSync,statSync,
  unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import semver from 'semver';
import {loadModuleHostInventory,loadRuntimeComposition} from '../build/compose-runtime.mjs';
import {readVerifiedCandidatePackageArchives} from './package-receipt.mjs';
import {deterministicModuleArchive} from './archives.mjs';
import {modulePlanDigest,solveModulePlan} from '../../sdk/modules/solver.mjs';
import {contractIntegrity,validateComposition} from '../../sdk/contracts/validate.mjs';

const usage='Usage: node scripts/modules/apply.mjs --plan HANDOFF.json --composition configuration/composition.json [--sync-profile configuration/composition.NAME.json]... [--write]\n';
const DIGEST=/^sha256-[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PACKAGE=/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const within=(base,target)=>target===base||target.startsWith(`${base}${path.sep}`);
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const npmIntegrity=bytes=>`sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const serial=value=>`${JSON.stringify(value,null,2)}\n`;

function flags(argv){
  if(argv.length===1&&argv[0]==='--help')return null;
  const result={syncProfiles:[]};
  for(let index=0;index<argv.length;index++){
    const key=argv[index];
    if(key==='--write'){if(result.write)fail('arguments',usage.trim());result.write=true;continue;}
    if(key==='--sync-profile'){
      const value=argv[++index];
      if(!value||value.startsWith('--')||result.syncProfiles.includes(value)
        ||result.syncProfiles.length>=32)fail('arguments',usage.trim());
      result.syncProfiles.push(value);continue;
    }
    if(!['--plan','--composition'].includes(key)||result[key]||!argv[index+1]
      ||argv[index+1].startsWith('--'))fail('arguments',usage.trim());
    result[key]=argv[++index];
  }
  if(!result['--plan']||!result['--composition'])fail('arguments',usage.trim());
  return result;
}
function checked(root,target,{missing=false,directory=false}={}){
  const base=path.resolve(root),absolute=path.resolve(base,target);
  if(!within(base,absolute))fail('path_escape',`Path escapes checkout: ${target}`);
  let cursor=base;
  if(!existsSync(cursor)||lstatSync(cursor).isSymbolicLink())fail('path_link','Checkout root is linked or missing.');
  for(const part of path.relative(base,absolute).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())fail('path_link',`Linked path: ${cursor}`);
  }
  if(!missing&&!existsSync(absolute))fail('path_missing',`Missing path: ${target}`);
  if(existsSync(absolute)){
    const stat=lstatSync(absolute);
    if(directory?!stat.isDirectory():!stat.isFile())fail('path_type',`Unexpected path type: ${target}`);
  }
  return absolute;
}
function json(root,relative,max=4*1024*1024){
  const file=checked(root,relative);
  if(statSync(file).size>max)fail('file_size',`Input exceeds byte bound: ${relative}`);
  return JSON.parse(readFileSync(file,'utf8'));
}
function exactObject(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function handoff(value){
  const keys=['schemaVersion','status','planId','revision','planDigest','inventoryDigest',
    'baseCompositionDigest','baseLockDigest','targetCompositionDigest','targetLockDigest',
    'choices','summary','summaryDigest'];
  if(!exactObject(value,keys)||value.schemaVersion!==1||value.status!=='accepted_pending_publication'
    ||!ID.test(value.planId)||!Number.isSafeInteger(value.revision)||value.revision<1
    ||keys.filter(key=>key.endsWith('Digest')).some(key=>!DIGEST.test(value[key]))
    ||!value.choices||typeof value.choices!=='object')fail('handoff','Expected an exact pending plans.read handoff.');
  return value;
}
function preflight(root,flagsValue){
  const plan=handoff(json(root,flagsValue['--plan'],64*1024));
  const loaded=loadRuntimeComposition({root,compositionPath:flagsValue['--composition']});
  const {composition,lock,located}=loaded;
  const host=loadModuleHostInventory({root,composition,lock,located,
    writeCache:false,allowUncached:true});
  const choices=plan.choices;
  if(plan.revision!==choices?.base?.revision+1
    ||plan.baseCompositionDigest!==modulePlanDigest(composition)
    ||plan.baseLockDigest!==modulePlanDigest(lock)
    ||plan.inventoryDigest!==host.inventory.digest
    ||choices.base.inventoryDigest!==host.inventory.digest)
    fail('stale','The accepted plan does not match this checkout and its live inventory.');
  const solved=solveModulePlan({revision:choices.base.revision,composition,lock,
    descriptors:located.map(item=>item.descriptor)},choices,host.inventory);
  if(!solved.next||solved.diagnostics.length
    ||solved.nextCompositionDigest!==plan.targetCompositionDigest
    ||solved.nextLockDigest!==plan.targetLockDigest
    ||solved.summaryDigest!==plan.summaryDigest
    ||modulePlanDigest(solved.summary)!==modulePlanDigest(plan.summary)
    ||modulePlanDigest({base:solved.base,inventoryDigest:solved.inventoryDigest,
      choicesDigest:solved.choicesDigest,summaryDigest:solved.summaryDigest,
      targetCompositionDigest:solved.nextCompositionDigest,
      targetLockDigest:solved.nextLockDigest})!==plan.planDigest)
    fail('plan_mismatch','The accepted plan cannot be reproduced from the current checkout.');
  return {plan,loaded,host,solved};
}
function packagePath(name){
  if(!PACKAGE.test(name))fail('package_name','Package name is invalid.');
  return `node_modules/${name}`;
}
function packageChanges({loaded,host,solved}){
  const old=new Map(loaded.composition.modules.map(item=>[item.moduleId,item]));
  const next=new Map(solved.next.composition.modules.map(item=>[item.moduleId,item]));
  const changes=[];
  for(const [moduleId,selection] of next){
    if(selection.source.kind!=='package')continue;
    const previous=old.get(moduleId);
    const target=solved.next.lock.modules.find(item=>item.moduleId===moduleId);
    const current=loaded.lock.modules.find(item=>item.moduleId===moduleId);
    if(previous?.source?.kind==='package'&&previous.source.name===selection.source.name
      &&current?.version===target.version&&current?.origin===target.origin
      &&current?.contractIntegrity===target.contractIntegrity
      &&current?.runtime.integrity===target.runtime.integrity
      &&current?.validation.integrity===target.validation.integrity)continue;
    const candidate=host.inventory.candidates.find(item=>item.moduleId===moduleId
      &&item.version===target.version&&item.origin===target.origin
      &&item.lockNode.contractIntegrity===target.contractIntegrity
      &&item.lockNode.runtime.integrity===target.runtime.integrity
      &&item.lockNode.validation.integrity===target.validation.integrity
      &&modulePlanDigest(item.source)===modulePlanDigest(selection.source));
    if(!candidate)fail('candidate','Target package candidate disappeared.');
    changes.push({kind:'install',moduleId,name:selection.source.name,candidate});
  }
  for(const [moduleId,selection] of old){
    if(selection.source.kind==='package'&&(!next.has(moduleId)
      ||next.get(moduleId).source.kind!=='package'
      ||next.get(moduleId).source.name!==selection.source.name))
      changes.push({kind:'remove',moduleId,name:selection.source.name});
  }
  if(new Set(changes.map(item=>item.name)).size!==changes.length)
    fail('package_collision','Multiple module changes affect one npm package.');
  return changes;
}
function companionProfiles(root,currentFile,changes,syncProfiles,solved){
  if(!Array.isArray(syncProfiles)||syncProfiles.length>32
    ||syncProfiles.some(item=>typeof item!=='string'))fail('profile_arguments','Invalid sync profiles.');
  if(!changes.length){if(syncProfiles.length)fail('profile_unused','No package change to synchronize.');
    return [];}
  const names=new Set(changes.map(item=>item.name)), requested=new Set();
  for(const profile of syncProfiles){
    const relative=profile.replaceAll('\\','/');
    if(!/^configuration\/composition(?:\.[a-z0-9._-]+)?\.json$/.test(relative)
      ||relative.endsWith('.lock.json')||requested.has(relative)
      ||checked(root,relative)===currentFile)fail('profile_arguments',`Invalid sync profile: ${profile}`);
    requested.add(relative);
  }
  const configuration=checked(root,'configuration',{directory:true});
  const companions=[];
  for(const entry of readdirSync(configuration,{withFileTypes:true})){
    if(!/^composition(?:\.[a-z0-9._-]+)?\.json$/.test(entry.name)
      ||entry.name.endsWith('.lock.json'))continue;
    if(entry.isSymbolicLink())fail('profile_link',`Linked composition profile: ${entry.name}`);
    if(!entry.isFile())fail('profile_type',`Unexpected composition profile: ${entry.name}`);
    const relative=`configuration/${entry.name}`;
    if(checked(root,relative)===currentFile)continue;
    const profile=json(root,relative);
    if(!Array.isArray(profile.modules))fail('profile_invalid',`Invalid composition profile: ${relative}`);
    const affected=profile.modules.filter(selection=>selection.source?.kind==='package'
      &&names.has(selection.source.name));
    if(!affected.length){if(requested.has(relative))fail('profile_unused',`Profile does not use a changed package: ${relative}`);
      continue;}
    if(!requested.has(relative))fail('shared_package',`Another composition profile uses a changed package: ${relative}`);
    const loaded=loadRuntimeComposition({root,compositionPath:relative});
    const nextComposition=structuredClone(loaded.composition);
    const nextLock=structuredClone(loaded.lock);
    const descriptors=new Map(loaded.located.map(item=>[item.descriptor.identity.id,item.descriptor]));
    const affectedIds=new Set(affected.map(item=>item.moduleId));
    for(const selection of nextComposition.modules.filter(item=>item.source?.kind==='package'
      &&names.has(item.source.name))){
      const change=changes.find(item=>item.name===selection.source.name);
      if(!change||selection.moduleId!==change.moduleId)fail('profile_identity',`Package owner differs: ${relative}`);
      const oldNode=nextLock.modules.find(item=>item.moduleId===selection.moduleId);
      const target=solved.next.composition.modules.find(item=>item.moduleId===selection.moduleId);
      if(!oldNode||!descriptors.has(selection.moduleId)
        ||descriptors.get(selection.moduleId).identity.origin!==oldNode.origin)
        fail('profile_identity',`Package identity differs: ${relative}`);
      if(change.kind==='remove'){
        if(target)fail('profile_identity',`Package source switch requires a separate plan: ${relative}`);
        nextComposition.modules=nextComposition.modules.filter(item=>item.moduleId!==selection.moduleId);
        nextLock.modules=nextLock.modules.filter(item=>item.moduleId!==selection.moduleId);
        for(const audience of ['admin','app'])nextComposition.exposure[audience].moduleIds=
          nextComposition.exposure[audience].moduleIds.filter(id=>id!==selection.moduleId);
        descriptors.delete(selection.moduleId);
      }else{
        if(!target||target.source.kind!=='package'||target.source.name!==selection.source.name
          ||oldNode.origin!==change.candidate.origin||selection.source.kind!=='package')
          fail('profile_identity',`Target identity differs: ${relative}`);
        if(semver.gt(oldNode.version,change.candidate.version))
          fail('profile_downgrade',`Companion profile would downgrade: ${relative}`);
        selection.versionRange=target.versionRange;
        const targetNode=structuredClone(change.candidate.lockNode);
        nextLock.modules.splice(nextLock.modules.findIndex(item=>item.moduleId===selection.moduleId),1,targetNode);
        descriptors.set(selection.moduleId,change.candidate.descriptor);
      }
    }
    const versions=new Map(nextLock.modules.map(item=>[item.moduleId,item.version]));
    for(const node of nextLock.modules){
      if(!affectedIds.has(node.moduleId)
        &&!node.dependencies.some(edge=>affectedIds.has(edge.moduleId)))continue;
      const descriptor=descriptors.get(node.moduleId);
      node.dependencies=descriptor.dependencies.filter(dep=>versions.has(dep.moduleId))
        .map(dep=>({moduleId:dep.moduleId,version:versions.get(dep.moduleId)}));
    }
    nextLock.compositionIntegrity=contractIntegrity(nextComposition);
    const validation=validateComposition(nextComposition,{lock:nextLock,modules:[...descriptors.values()]});
    if(validation.errors.length)fail('profile_incompatible',
      `Companion profile ${relative} is incompatible: ${validation.errors[0].code}`);
    companions.push({relative,lockRelative:path.relative(root,loaded.lockFile).replaceAll('\\','/'),
      appId:loaded.composition.application.id,composition:nextComposition,lock:nextLock,
      baseCompositionDigest:modulePlanDigest(loaded.composition),baseLockDigest:modulePlanDigest(loaded.lock),
      targetCompositionDigest:modulePlanDigest(nextComposition),targetLockDigest:modulePlanDigest(nextLock),
      baseCompositionBytes:sha(readFileSync(loaded.compositionFile)),
      baseLockBytes:sha(readFileSync(loaded.lockFile))});
  }
  if(companions.length!==requested.size)fail('profile_arguments','A sync profile was not found.');
  return companions;
}
function assertCompanionBases(root,companions){
  for(const profile of companions){
    if(sha(readFileSync(checked(root,profile.relative)))!==profile.baseCompositionBytes
      ||sha(readFileSync(checked(root,profile.lockRelative)))!==profile.baseLockBytes)
      fail('profile_stale',`Companion profile changed during apply: ${profile.relative}`);
  }
}
function verifyPackageBytes(root,change,config){
  const declaration=config.externalPackages?.find(item=>item.moduleId===change.moduleId
    &&item.packageName===change.name&&item.version===change.candidate.version);
  if(!declaration)fail('candidate_archive',`No local external archive declaration for ${change.moduleId}.`);
  const read=(part,max)=>{
    const relative=declaration[part]?.path;
    if(typeof relative!=='string'||!relative.startsWith('.creezio/packages/'))
      fail('candidate_archive','Archive path must be under .creezio/packages.');
    const file=checked(root,relative);
    if(statSync(file).size>max)fail('candidate_archive','Archive exceeds its byte bound.');
    return readFileSync(file);
  };
  const runtimeBytes=read('runtime',64*1024*1024),validationBytes=read('validation',64*1024*1024);
  const receiptBytes=read('receipt',64*1024);
  const currentNode=config._currentLock.modules.find(item=>item.moduleId===change.moduleId);
  const archive=readVerifiedCandidatePackageArchives({currentNode,expectedModuleId:change.moduleId,
    expectedOrigin:declaration.origin??currentNode?.origin,packageName:change.name,
    version:change.candidate.version,allowedOrigins:config.allowedOrigins,
    runtimeBytes,validationBytes,receiptBytes,
    expected:{runtime:declaration.runtime.integrity,validation:declaration.validation.integrity,
      receipt:declaration.receipt.integrity}});
  if(archive.candidate.candidateKey!==change.candidate.candidateKey)
    fail('candidate_archive','Archive and approved candidate identity differ.');
  const manifest=JSON.parse(archive.runtimeFiles.find(item=>item.path==='package.json').bytes.toString('utf8'));
  return {...archive,manifest,declaration,runtimeBytes,validationBytes,receiptBytes};
}
function emptyDirectory(root,relative){
  const target=checked(root,relative,{missing:true,directory:true});
  if(!existsSync(target))mkdirSync(target,{recursive:true});
  return target;
}
function writeExclusive(root,relative,bytes){
  const file=checked(root,relative,{missing:true});
  mkdirSync(path.dirname(file),{recursive:true});
  writeFileSync(file,bytes,{flag:'wx'});
  return file;
}
function cleanupTree(root,target){
  const directory=checked(root,target,{directory:true});
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const child=path.join(directory,entry.name);
    if(entry.isSymbolicLink())fail('cleanup_link',`Refusing linked cleanup path: ${child}`);
    if(entry.isDirectory())cleanupTree(root,child);
    else if(entry.isFile())unlinkSync(checked(root,child));
    else fail('cleanup_type',`Unexpected cleanup path: ${child}`);
  }
  rmdirSync(directory);
}
function assertUnlinkedTree(root,target){
  const directory=checked(root,target,{directory:true});
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const child=path.join(directory,entry.name);
    if(entry.isSymbolicLink())fail('package_link',`Installed package contains a link: ${child}`);
    if(entry.isDirectory())assertUnlinkedTree(root,child);
    else if(!entry.isFile())fail('package_type',`Unexpected installed package entry: ${child}`);
  }
}
export function resolveOfflineNpmLock(root,stage,packageJson,currentLock,changedNames=[]){
  const mini=checked(root,path.join(stage,'npm-root'),
    {missing:true,directory:true});
  emptyDirectory(root,mini);
  const staged=structuredClone(packageJson);
  for(const [name,spec] of Object.entries(staged.dependencies??{})){
    if(typeof spec!=='string'||!spec.startsWith('file:'))continue;
    const relative=spec.slice(5);
    if(!relative.startsWith('.creezio/packages/'))
      fail('npm_file_dependency',`Unqualified local dependency: ${name}`);
    staged.dependencies[name]=`file:${path.relative(mini,checked(root,relative)).replaceAll('\\','/')}`;
  }
  for(const workspace of staged.workspaces??[]){
    if(workspace!=='sdk')fail('npm_workspace',`Unqualified workspace: ${workspace}`);
    writeExclusive(root,path.join(mini,'sdk','package.json'),
      readFileSync(checked(root,'sdk/package.json')));
  }
  writeExclusive(root,path.join(mini,'package.json'),serial(staged));
  writeExclusive(root,path.join(mini,'package-lock.json'),serial(currentLock));
  const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  const command=existsSync(npmCli)?process.execPath:'npm';
  const commandArgs=existsSync(npmCli)?[npmCli]:[];
  const result=spawnSync(command,[...commandArgs,'install','--package-lock-only','--offline','--ignore-scripts',
    '--legacy-peer-deps',
    '--no-audit','--no-fund','--workspaces=false','--package-lock=true'],
    {cwd:mini,encoding:'utf8',timeout:120000,maxBuffer:1024*1024,
      env:{...process.env,npm_config_cache:checked(root,path.join(stage,'npm-cache'),{missing:true,directory:true}),
        npm_config_update_notifier:'false',npm_config_progress:'false'}});
  if(result.error||result.status!==0)fail('npm_lock',`Offline npm lock generation failed: ${(result.stderr||result.error?.message||'').slice(0,2000)}`);
  const lock=JSON.parse(readFileSync(path.join(mini,'package-lock.json'),'utf8'));
  if(lock.lockfileVersion!==3||!lock.packages?.[''])fail('npm_lock','npm did not produce a v3 lock.');
  for(const [name,spec] of Object.entries(packageJson.dependencies??{})){
    if(typeof spec==='string'&&spec.startsWith('file:')){
      const entry=lock.packages[packagePath(name)];
      if(!entry||entry.integrity!==npmIntegrity(readFileSync(checked(root,spec.slice(5)))))
        fail('npm_lock',`Local package lock integrity differs: ${name}`);
      entry.resolved=spec;
    }
  }
  lock.packages[''].dependencies=structuredClone(packageJson.dependencies);
  const changed=new Set(changedNames.map(packagePath));
  for(const key of Object.keys(lock.packages)){
    if(key!==''&&!changed.has(key)&&!Object.hasOwn(currentLock.packages,key))
      fail('npm_lock',`npm introduced an unapproved lock node: ${key}`);
  }
  if(modulePlanDigest(lock.packages[''].dependencies)!==modulePlanDigest(packageJson.dependencies))
    fail('npm_lock','npm root dependencies differ from the requested manifest.');
  // npm may refresh unrelated registry metadata even with --package-lock-only.
  // Keep the original nodes and transplant only npm's verified local package entries.
  const finalLock=structuredClone(currentLock);
  finalLock.packages[''].dependencies=structuredClone(packageJson.dependencies);
  for(const name of changedNames){
    const key=packagePath(name);
    if(Object.hasOwn(packageJson.dependencies,name)){
      if(!lock.packages[key])fail('npm_lock',`npm omitted local package ${name}.`);
      finalLock.packages[key]=lock.packages[key];
    }else delete finalLock.packages[key];
  }
  return finalLock;
}
function updates(root,context,changes,stage){
  const config=json(root,'configuration/module-inventory.json');
  const packageJson=json(root,'package.json');
  const priorNpmLock=json(root,'package-lock.json',16*1024*1024);
  if(priorNpmLock.lockfileVersion!==3||!priorNpmLock.packages?.['']
    ||modulePlanDigest(priorNpmLock.packages[''].dependencies)!==modulePlanDigest(packageJson.dependencies))
    fail('npm_lock','Root package and npm lock dependencies differ.');
  if(!Array.isArray(config.externalPackages??[]))fail('inventory','External package inventory is malformed.');
  config._currentLock=context.loaded.lock;
  const replacements=[];
  const oldPackages=new Map(context.loaded.composition.modules.filter(item=>item.source.kind==='package')
    .map(item=>[item.source.name,item.moduleId]));
  const newPackages=new Map(context.solved.next.composition.modules.filter(item=>item.source.kind==='package')
    .map(item=>[item.source.name,item.moduleId]));
  const nextModules=new Map(context.solved.next.composition.modules.map(item=>[item.moduleId,item]));
  for(const change of changes){
    if(change.kind==='install'&&!oldPackages.has(change.name)
      &&(Object.hasOwn(packageJson.dependencies,change.name)
        ||Object.hasOwn(packageJson.devDependencies??{},change.name)
        ||Object.hasOwn(packageJson.optionalDependencies??{},change.name)
        ||Object.hasOwn(packageJson.peerDependencies??{},change.name)
        ||Object.hasOwn(priorNpmLock.packages,packagePath(change.name))))
      fail('package_collision',`npm package ${change.name} is already owned outside this module plan.`);
  }
  for(const change of changes){
    if(change.kind==='remove')continue;
    const verified=verifyPackageBytes(root,change,config);
    change.verified=verified;
    const runtime=deterministicModuleArchive(verified.runtimeFiles);
    if(sha(runtime)!==change.candidate.lockNode.runtime.integrity)
      fail('candidate_archive','Canonical runtime archive differs from target lock.');
    change.artifacts=[{relative:change.candidate.lockNode.runtime.location.path,bytes:runtime},
      {relative:change.candidate.lockNode.validation.location.path,bytes:verified.validationBytes}];
    for(const field of ['dependencies','optionalDependencies','peerDependencies']){
      for(const [dependency,range] of Object.entries(verified.manifest[field]??{})){
        const entry=priorNpmLock.packages[packagePath(dependency)];
        const version=entry?.link?priorNpmLock.packages[entry.resolved]?.version:entry?.version;
        if(typeof range!=='string'||!semver.validRange(range)||!semver.valid(version)
          ||!semver.satisfies(version,range))
          fail('package_dependency',`Existing npm lock does not satisfy ${change.name} -> ${dependency}@${range}.`);
      }
    }
    if((verified.manifest.bundleDependencies??verified.manifest.bundledDependencies??[]).length)
      fail('package_dependency',`Bundled dependencies need separate qualification: ${change.name}.`);
    packageJson.dependencies[change.name]=`file:${verified.declaration.runtime.path}`;
    config.validationReceipts??={};
    config.validationReceipts[change.moduleId]=verified.declaration.receipt.path;
    config.externalPackages=config.externalPackages.filter(item=>item.moduleId!==change.moduleId
      ||!semver.valid(item.version)||semver.gt(item.version,change.candidate.version));
  }
  for(const change of changes.filter(item=>item.kind==='remove')){
    if(newPackages.has(change.name))continue;
    if(oldPackages.get(change.name)!==change.moduleId)fail('package_collision','Package ownership changed.');
    delete packageJson.dependencies[change.name];
    if(config.validationReceipts&&nextModules.get(change.moduleId)?.source?.kind!=='package')
      delete config.validationReceipts[change.moduleId];
  }
  delete config._currentLock;
  if(config.validationReceipts&&Object.keys(config.validationReceipts).length===0)
    delete config.validationReceipts;
  if(config.externalPackages&&config.externalPackages.length===0)delete config.externalPackages;
  const npmLock=changes.length?resolveOfflineNpmLock(root,stage,packageJson,priorNpmLock,
    changes.map(item=>item.name)):priorNpmLock;
  for(const change of changes.filter(item=>item.kind==='install')){
    if(npmLock.packages[packagePath(change.name)]?.version!==change.candidate.version)
      fail('npm_lock',`npm package version differs for ${change.name}.`);
  }
  const jsonTargets=[
    [path.relative(root,context.loaded.compositionFile),context.solved.next.composition],
    [path.relative(root,context.loaded.lockFile),context.solved.next.lock],
    ...context.companions.flatMap(profile=>[[profile.relative,profile.composition],
      [profile.lockRelative,profile.lock]]),
  ];
  if(changes.length)jsonTargets.push(['package.json',packageJson],['package-lock.json',npmLock],
    ['configuration/module-inventory.json',config]);
  for(const [relative,value] of jsonTargets)replacements.push({relative,bytes:Buffer.from(serial(value))});
  return replacements;
}
function stageOperations(root,context,changes,stage,replacements){
  const operations=[];
  for(const [index,item] of replacements.entries()){
    const staged=path.join(stage,'new',`json-${index}`);
    writeExclusive(root,staged,item.bytes);
    operations.push({relative:item.relative,staged,backup:path.join(stage,'old',`json-${index}`),type:'file'});
  }
  for(const [index,change] of changes.entries()){
    const dest=packagePath(change.name);
    if(existsSync(checked(root,dest,{missing:true,directory:true})))assertUnlinkedTree(root,dest);
    if(change.kind==='install'){
      const base=path.join(stage,'new',`package-${index}`);
      emptyDirectory(root,base);
      for(const item of change.verified.runtimeFiles)
        writeExclusive(root,path.join(base,item.path),item.bytes);
      operations.push({relative:dest,staged:base,backup:path.join(stage,'old',`package-${index}`),type:'directory'});
      for(const [artifactIndex,artifact] of change.artifacts.entries()){
        const existing=checked(root,artifact.relative,{missing:true});
        if(existsSync(existing)){
          if(sha(readFileSync(existing))!==sha(artifact.bytes))fail('artifact_conflict','Existing artifact bytes differ.');
          continue;
        }
        const file=path.join(stage,'new',`artifact-${index}-${artifactIndex}`);
        writeExclusive(root,file,artifact.bytes);
        operations.push({relative:artifact.relative,staged:file,backup:null,type:'file'});
      }
    }else if(!changes.some(other=>other.kind==='install'&&other.name===change.name))
      operations.push({relative:dest,staged:null,backup:path.join(stage,'old',`package-${index}`),type:'directory'});
  }
  // Artifacts and packages precede the composition switch; JSON snapshots complete the transaction.
  const compositionRelative=path.relative(root,context.loaded.compositionFile);
  const lockRelative=path.relative(root,context.loaded.lockFile);
  const compositionPaths=new Set([compositionRelative,...context.companions.map(item=>item.relative)]);
  const lockPaths=new Set([lockRelative,...context.companions.map(item=>item.lockRelative)]);
  return [...operations.filter(item=>item.relative.startsWith('.creezio/module-artifacts/')),
    ...operations.filter(item=>item.relative.startsWith('node_modules/')),
    ...operations.filter(item=>!item.relative.startsWith('.creezio/module-artifacts/')
      &&!item.relative.startsWith('node_modules/')
      &&!compositionPaths.has(item.relative)&&!lockPaths.has(item.relative)),
    ...operations.filter(item=>lockPaths.has(item.relative)),
    ...operations.filter(item=>compositionPaths.has(item.relative))];
}
function commit(root,context,operations,stage){
  const journal={schemaVersion:1,status:'applying',planId:context.plan.planId,
    planDigest:context.plan.planDigest,operations:operations.map(item=>({relative:item.relative,
      backup:item.backup,staged:item.staged,type:item.type}))};
  const journalPath=checked(root,path.join(stage,'journal.json'),{missing:true});
  writeExclusive(root,journalPath,serial(journal));
  const applied=[];
  try{
    for(const item of operations){
      const dest=checked(root,item.relative,{missing:true,directory:item.type==='directory'});
      mkdirSync(path.dirname(dest),{recursive:true});
      if(existsSync(dest)){
        if(!item.backup)fail('destination_conflict',`Destination appeared: ${item.relative}`);
        const backup=checked(root,item.backup,{missing:true,directory:item.type==='directory'});
        mkdirSync(path.dirname(backup),{recursive:true});
        renameSync(dest,backup);
      }
      applied.push(item);
      if(item.staged)renameSync(checked(root,item.staged,{directory:item.type==='directory'}),dest);
    }
    const loaded=loadRuntimeComposition({root,compositionPath:path.relative(root,context.loaded.compositionFile)});
    const host=loadModuleHostInventory({root,composition:loaded.composition,lock:loaded.lock,
      located:loaded.located,writeCache:false,allowUncached:true});
    if(modulePlanDigest(loaded.composition)!==context.plan.targetCompositionDigest
      ||modulePlanDigest(loaded.lock)!==context.plan.targetLockDigest||!host.inventory)
      fail('postvalidation','Applied checkout does not match the accepted target.');
    for(const profile of context.companions){
      const current=loadRuntimeComposition({root,compositionPath:profile.relative});
      if(modulePlanDigest(current.composition)!==profile.targetCompositionDigest
        ||modulePlanDigest(current.lock)!==profile.targetLockDigest)
        fail('postvalidation',`Applied companion differs from target: ${profile.relative}`);
    }
    journal.status='validated';
    writeFileSync(journalPath,serial(journal));
  }catch(error){
    let rollbackError=null;
    for(const item of applied.reverse())try{
      const dest=checked(root,item.relative,{missing:true,directory:item.type==='directory'});
      if(existsSync(dest)){
        if(item.type==='directory')cleanupTree(root,dest);else unlinkSync(dest);
      }
      if(item.backup&&existsSync(checked(root,item.backup,{missing:true,directory:item.type==='directory'})))
        renameSync(checked(root,item.backup,{directory:item.type==='directory'}),dest);
    }catch(cause){rollbackError??=cause;}
    if(!rollbackError)try{
      const restored=loadRuntimeComposition({root,compositionPath:path.relative(root,context.loaded.compositionFile)});
      if(modulePlanDigest(restored.composition)!==context.plan.baseCompositionDigest
        ||modulePlanDigest(restored.lock)!==context.plan.baseLockDigest)
        fail('rollback_mismatch','Restored checkout differs from its original composition and lock.');
      for(const profile of context.companions){
        const current=loadRuntimeComposition({root,compositionPath:profile.relative});
        if(modulePlanDigest(current.composition)!==profile.baseCompositionDigest
          ||modulePlanDigest(current.lock)!==profile.baseLockDigest)
          fail('rollback_mismatch',`Restored companion differs from base: ${profile.relative}`);
      }
    }catch(cause){rollbackError=cause;}
    if(rollbackError){journal.status='rollback_failed';writeFileSync(journalPath,serial(journal));
      fail('rollback_failed',`Apply failed; backup retained at ${stage}: ${rollbackError.message}`);}
    journal.status='rolled_back';writeFileSync(journalPath,serial(journal));
    throw error;
  }
}
export function applyModulePlan({root=process.cwd(),planPath,compositionPath,syncProfiles=[],write=false}){
  root=path.resolve(root);
  const flagsValue={'--plan':planPath,'--composition':compositionPath};
  const context=preflight(root,flagsValue);
  const changes=packageChanges(context);
  context.companions=companionProfiles(root,context.loaded.compositionFile,changes,
    syncProfiles,context.solved);
  const profiles=[{path:path.relative(root,context.loaded.compositionFile).replaceAll('\\','/'),
    appId:context.loaded.composition.application.id,
    baseCompositionDigest:context.plan.baseCompositionDigest,baseLockDigest:context.plan.baseLockDigest,
    targetCompositionDigest:context.plan.targetCompositionDigest,targetLockDigest:context.plan.targetLockDigest},
    ...context.companions.map(({relative,appId,baseCompositionDigest,baseLockDigest,
      targetCompositionDigest,targetLockDigest})=>({path:relative,appId,baseCompositionDigest,
      baseLockDigest,targetCompositionDigest,targetLockDigest}))];
  if(!write)return {status:'plan_revalidated',planId:context.plan.planId,
    targetCompositionDigest:context.plan.targetCompositionDigest,
    targetLockDigest:context.plan.targetLockDigest,
    installability:changes.length?'not_checked':'not_applicable',
    profiles,
    packages:changes.map(({kind,moduleId,name})=>({kind,moduleId,name})),
    changes:context.solved.summary.changes};
  const stageRoot='.creezio/module-apply';
  const stage=path.join(stageRoot,context.plan.planDigest.slice(7));
  const active=path.join(stageRoot,'active.json');
  if(existsSync(checked(root,active,{missing:true})))
    fail('incomplete_apply',`Inspect existing apply lock: ${active}`);
  if(existsSync(checked(root,stage,{missing:true,directory:true})))
    fail('incomplete_apply',`Inspect existing apply journal: ${stage}`);
  writeExclusive(root,active,serial({schemaVersion:1,planId:context.plan.planId,
    planDigest:context.plan.planDigest,pid:process.pid}));
  let committed=false;
  try{
    emptyDirectory(root,stage);
    const replacements=updates(root,context,changes,stage);
    const operations=stageOperations(root,context,changes,stage,replacements);
    preflight(root,flagsValue);
    assertCompanionBases(root,context.companions);
    const fresh=companionProfiles(root,context.loaded.compositionFile,changes,
      syncProfiles,context.solved);
    if(modulePlanDigest(fresh.map(item=>({path:item.relative,
      baseCompositionDigest:item.baseCompositionDigest,baseLockDigest:item.baseLockDigest,
      targetCompositionDigest:item.targetCompositionDigest,targetLockDigest:item.targetLockDigest})))
      !==modulePlanDigest(context.companions.map(item=>({path:item.relative,
        baseCompositionDigest:item.baseCompositionDigest,baseLockDigest:item.baseLockDigest,
        targetCompositionDigest:item.targetCompositionDigest,targetLockDigest:item.targetLockDigest}))))
      fail('profile_stale','Companion profiles changed during apply.');
    commit(root,context,operations,stage);
    committed=true;
    cleanupTree(root,stage);
    unlinkSync(checked(root,active));
    return {status:'applied_locally',planId:context.plan.planId,
      targetCompositionDigest:context.plan.targetCompositionDigest,
      targetLockDigest:context.plan.targetLockDigest,
      packages:changes.map(({kind,moduleId,name})=>({kind,moduleId,name})),profiles};
  }catch(error){
    if(!committed&&existsSync(checked(root,stage,{missing:true,directory:true}))){
      const journalFile=checked(root,path.join(stage,'journal.json'),{missing:true});
      if(!existsSync(journalFile)||JSON.parse(readFileSync(journalFile,'utf8')).status==='rolled_back'){
        cleanupTree(root,stage);
        unlinkSync(checked(root,active));
      }
    }
    throw error;
  }
}
export function runModuleApplyCli(argv,{cwd=process.cwd(),stdout=process.stdout,stderr=process.stderr}={}){
  try{
    const options=flags(argv);
    if(!options){stdout.write(usage);return 0;}
    stdout.write(`${JSON.stringify(applyModulePlan({root:cwd,planPath:options['--plan'],
      compositionPath:options['--composition'],syncProfiles:options.syncProfiles,
      write:!!options.write}))}\n`);
    return 0;
  }catch(error){stderr.write(`${error.code??'apply_error'}: ${error.message}\n`);return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=runModuleApplyCli(process.argv.slice(2));
