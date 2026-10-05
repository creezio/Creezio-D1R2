#!/usr/bin/env node
/** Admit verified external package metadata; installation remains a separate accepted plan. */
import {createHash,randomBytes} from 'node:crypto';
import {closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,statSync,
  unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentModuleCandidateKeys,loadRuntimeComposition,
  mergeExternalPackageCandidates} from '../build/compose-runtime.mjs';
import {compileModuleInventoryWithDocuments} from '../../sdk/modules/inventory.mjs';
import {verifyCandidatePackageReceipt} from './package-receipt.mjs';
import {safePackagePath} from '../../sdk/contracts/references.mjs';

const usage=`Usage: node scripts/modules/admit.mjs --module-id ID --origin URL --package-name NAME --version VERSION \\
  --runtime .creezio/packages/FILE.tgz --runtime-sha256 sha256-HEX \\
  --validation .creezio/packages/FILE.tgz --validation-sha256 sha256-HEX \\
  --receipt .creezio/packages/FILE.json --receipt-sha256 sha256-HEX \\
  [--composition configuration/composition.json] [--inventory configuration/module-inventory.json] [--root DIR] [--write]`;
const DIGEST=/^sha256-[a-f0-9]{64}$/;
const within=(base,target)=>target===base||target.startsWith(`${base}${path.sep}`);
const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};

function localFile(root,relative,maxBytes){
  if(typeof relative!=='string'||!safePackagePath(relative))fail('path','Expected a safe checkout-relative file path.');
  const base=path.resolve(root),target=path.resolve(base,...relative.split('/'));
  if(!within(base,target)||!existsSync(base)||lstatSync(base).isSymbolicLink()
    ||!lstatSync(base).isDirectory())fail('path','Checkout path is missing or linked.');
  let cursor=base;
  for(const part of path.relative(base,target).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    if(!existsSync(cursor)||lstatSync(cursor).isSymbolicLink())fail('path','Input path is missing or linked.');
  }
  if(!lstatSync(target).isFile()||statSync(target).size>maxBytes)
    fail('path','Input is not a bounded regular file.');
  return {target,bytes:readFileSync(target)};
}

function localDirectory(root,relative){
  const base=path.resolve(root),target=path.resolve(base,...relative.split('/'));
  if(!within(base,target)||!existsSync(base)||lstatSync(base).isSymbolicLink()
    ||!lstatSync(base).isDirectory())fail('path','Checkout path is missing or linked.');
  let cursor=base;
  for(const part of path.relative(base,target).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    if(!existsSync(cursor))mkdirSync(cursor);
    if(lstatSync(cursor).isSymbolicLink()||!lstatSync(cursor).isDirectory())
      fail('path','Apply lock directory is linked or not a directory.');
  }
  return target;
}

function flags(argv){
  if(argv.length===1&&argv[0]==='--help')return null;
  const out={};
  const keys=new Set(['--root','--composition','--inventory','--module-id','--origin','--package-name',
    '--version','--runtime','--runtime-sha256','--validation','--validation-sha256',
    '--receipt','--receipt-sha256']);
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--write'){if(out.write)fail('arguments',usage);out.write=true;continue;}
    if(!keys.has(key)||Object.hasOwn(out,key)||!argv[i+1]||argv[i+1].startsWith('--'))
      fail('arguments',usage);
    out[key]=argv[++i];
  }
  if([...keys].filter(key=>!['--root','--composition','--inventory'].includes(key))
    .some(key=>!out[key]))fail('arguments',usage);
  return out;
}

export function admitExternalPackage({root=process.cwd(),compositionPath='configuration/composition.json',
  inventoryPath='configuration/module-inventory.json',moduleId,origin,packageName,version,
  runtimePath,runtimeIntegrity,validationPath,validationIntegrity,receiptPath,receiptIntegrity,
  write=false}){
  root=path.resolve(root);
  const inputs=[['runtime',runtimePath,runtimeIntegrity,64*1024*1024],
    ['validation',validationPath,validationIntegrity,64*1024*1024],
    ['receipt',receiptPath,receiptIntegrity,64*1024]];
  if(new Set(inputs.map(([,relative])=>relative)).size!==3
    ||inputs.some(([,relative,integrity])=>typeof relative!=='string'
      ||!relative.startsWith('.creezio/packages/')||!safePackagePath(relative)
      ||!DIGEST.test(integrity)))fail('input','Three distinct local package files and SHA-256 digests are required.');
  const inventoryFile=localFile(root,inventoryPath,64*1024),
    config=JSON.parse(inventoryFile.bytes.toString('utf8'));
  if(config?.schemaVersion!==1||!Array.isArray(config.allowedOrigins)
    ||!config.allowedOrigins.includes(origin)||!Array.isArray(config.available)
    ||!Array.isArray(config.externalPackages??[])
    ||Object.keys(config).some(key=>!['schemaVersion','allowedOrigins','available',
      'validationReceipts','externalPackages'].includes(key))
    ||(config.externalPackages?.length??0)>=16)fail('inventory','Inventory or allowed origin is invalid.');
  const loaded=loadRuntimeComposition({root,compositionPath});
  const installedSpecs=loaded.composition.modules.map(selection=>({source:selection.source,
    lockNode:loaded.lock.modules.find(node=>node.moduleId===selection.moduleId),
    ...(config.validationReceipts?.[selection.moduleId]
      ?{validationReceipt:config.validationReceipts[selection.moduleId]}:{})})).concat(config.available);
  const installed=compileModuleInventoryWithDocuments({root,candidates:installedSpecs,
    selectedCount:loaded.composition.modules.length,allowedOrigins:config.allowedOrigins,
    writeCache:false,allowUncached:true}).inventory;
  const inventory=mergeExternalPackageCandidates({root,composition:loaded.composition,lock:loaded.lock,
    installedInventory:installed,externalPackages:config.externalPackages??[],
    allowedOrigins:config.allowedOrigins});
  currentModuleCandidateKeys(loaded.composition,loaded.lock,inventory);
  const selection=loaded.composition.modules.find(item=>item.moduleId===moduleId),
    currentNode=loaded.lock.modules.find(item=>item.moduleId===moduleId);
  if(selection&&(selection.source?.kind!=='package'||selection.source.name!==packageName
    ||currentNode?.origin!==origin)||!selection&&currentNode
    ||loaded.composition.modules.some(item=>item.moduleId!==moduleId
      &&item.source?.kind==='package'&&item.source.name===packageName))
    fail('identity','Selected module or npm package belongs to a different source.');
  if(!selection){
    const npm=existsSync(path.join(root,'package.json'))
      ?JSON.parse(localFile(root,'package.json',1024*1024).bytes.toString('utf8')):null;
    const npmLock=existsSync(path.join(root,'package-lock.json'))
      ?JSON.parse(localFile(root,'package-lock.json',16*1024*1024).bytes.toString('utf8')):null;
    if(['dependencies','devDependencies','optionalDependencies','peerDependencies']
      .some(section=>Object.hasOwn(npm?.[section]??{},packageName))
      ||Object.hasOwn(npmLock?.packages??{},`node_modules/${packageName}`))
      fail('package_collision','npm package name is already owned by this checkout.');
  }
  const files=inputs.map(([,relative,,maxBytes])=>localFile(root,relative,maxBytes).bytes);
  const candidate=verifyCandidatePackageReceipt({currentNode,expectedModuleId:moduleId,
    expectedOrigin:origin,packageName,version,allowedOrigins:config.allowedOrigins,
    runtimeBytes:files[0],validationBytes:files[1],receiptBytes:files[2],
    expected:{runtime:runtimeIntegrity,validation:validationIntegrity,receipt:receiptIntegrity}});
  for(const existing of inventory.candidates){
    if(existing.candidateKey===candidate.candidateKey
      ||existing.moduleId===moduleId&&existing.version===version&&existing.origin===origin)
      fail('candidate_collision','Candidate identity or digest already exists.');
    if(existing.moduleId===moduleId&&(existing.origin!==origin
      ||existing.source?.kind==='package'&&existing.source.name!==packageName)
      ||existing.moduleId!==moduleId&&existing.source?.kind==='package'
        &&existing.source.name===packageName)
      fail('package_collision','Module identity or npm package name is already owned elsewhere.');
  }
  const existingPackages=config.externalPackages??[];
  if(existingPackages.some(item=>['runtime','validation','receipt'].some(role=>
    ['runtime','validation','receipt'].some(existingRole=>{
      const incoming=inputs.find(([name])=>name===role),prior=item[existingRole];
      return prior?.path===incoming[1]
        &&(existingRole!==role||prior.integrity!==incoming[2]);
    }))))
    fail('archive_collision','An archive path is already declared with another role or digest.');
  const declaration={moduleId,origin,packageName,version,
    runtime:{path:runtimePath,integrity:runtimeIntegrity},
    validation:{path:validationPath,integrity:validationIntegrity},
    receipt:{path:receiptPath,integrity:receiptIntegrity}};
  const next={...config,externalPackages:[...existingPackages,declaration]};
  const nextBytes=Buffer.from(`${JSON.stringify(next,null,2)}\n`);
  if(nextBytes.length>64*1024)fail('inventory_size','Updated inventory exceeds the loader byte limit.');
  const nextInventory=mergeExternalPackageCandidates({root,composition:loaded.composition,
    lock:loaded.lock,installedInventory:installed,externalPackages:next.externalPackages,
    allowedOrigins:next.allowedOrigins});
  currentModuleCandidateKeys(loaded.composition,loaded.lock,nextInventory);
  if(!nextInventory.candidates.some(item=>item.candidateKey===candidate.candidateKey))
    fail('candidate_missing','Verified candidate is absent from the resulting inventory.');
  const result={status:write?'admitted':'would_admit',candidateKey:candidate.candidateKey,
    moduleId,origin,packageName,version,inventory:inventoryPath,compositionUnchanged:true};
  if(!write)return result;
  const temporary=`${inventoryFile.target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const lockDirectory=localDirectory(root,'.creezio/module-apply');
  const lockFile=path.join(lockDirectory,'active.json'),token=randomBytes(16).toString('hex');
  const lockBytes=`${JSON.stringify({schemaVersion:1,kind:'admission',token,pid:process.pid,
    inventory:inventoryPath,baseDigest:sha(inventoryFile.bytes)})}\n`;
  let lockFd;
  try{
    try{lockFd=openSync(lockFile,'wx',0o600);}catch(error){
      if(error.code==='EEXIST')fail('inventory_locked','An admission lock exists; inspect it before another write.');
      throw error;
    }
    writeFileSync(lockFd,lockBytes);
    if(sha(readFileSync(inventoryFile.target))!==sha(inventoryFile.bytes))
      fail('inventory_stale','Inventory changed during admission.');
    writeFileSync(temporary,nextBytes,{flag:'wx'});
    renameSync(temporary,inventoryFile.target);
  }finally{
    if(existsSync(temporary))unlinkSync(temporary);
    if(lockFd!==undefined){
      closeSync(lockFd);
      if(existsSync(lockFile)&&!lstatSync(lockFile).isSymbolicLink()
        &&readFileSync(lockFile,'utf8')===lockBytes)unlinkSync(lockFile);
    }
  }
  return result;
}

export function runModuleAdmitCli(argv,{cwd=process.cwd(),stdout=console.log}={}){
  const args=flags(argv);
  if(!args){stdout(usage);return 0;}
  const result=admitExternalPackage({root:args['--root']??cwd,
    compositionPath:args['--composition']??'configuration/composition.json',
    inventoryPath:args['--inventory']??'configuration/module-inventory.json',
    moduleId:args['--module-id'],origin:args['--origin'],packageName:args['--package-name'],
    version:args['--version'],runtimePath:args['--runtime'],runtimeIntegrity:args['--runtime-sha256'],
    validationPath:args['--validation'],validationIntegrity:args['--validation-sha256'],
    receiptPath:args['--receipt'],receiptIntegrity:args['--receipt-sha256'],write:args.write===true});
  stdout(JSON.stringify(result));return 0;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.exitCode=runModuleAdmitCli(process.argv.slice(2));}
  catch(error){console.error(`${error.code??'admission_error'}: ${error.message}`);process.exitCode=1;}
}
