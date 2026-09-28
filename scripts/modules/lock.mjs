#!/usr/bin/env node
import {existsSync,lstatSync,readFileSync,realpathSync,renameSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalJson,contractIntegrity,validateComposition,validateModule} from '../../sdk/contracts/validate.mjs';
import {safePackagePath} from '../../sdk/contracts/references.mjs';
import {packModuleArtifacts} from './archives.mjs';
import {verifyPackageReceipt} from './package-receipt.mjs';

const usage='Usage: node scripts/modules/lock.mjs [--root DIRECTORY] [--composition configuration/composition.json] [--lock configuration/composition.lock.json] [--inventory configuration/module-inventory.json] [--validation-receipt moduleId=RELATIVE_PATH]... [--cache-validation moduleId]... [--write]\n';
const within=(root,target)=>target===root||target.startsWith(`${root}${path.sep}`);
function localPath(root,relative,{missing=false}={}) {
  if (!safePackagePath(relative)) throw new Error(`Unsafe local path: ${relative}`);
  const absolute=path.resolve(root,...relative.split('/'));
  if (!within(root,absolute)) throw new Error(`Path leaves root: ${relative}`);
  let cursor=root;
  if (!existsSync(cursor)||lstatSync(cursor).isSymbolicLink()) throw new Error('Root is unavailable or linked.');
  for (const part of path.relative(root,absolute).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    if (existsSync(cursor)&&lstatSync(cursor).isSymbolicLink()) throw new Error(`Linked path: ${relative}`);
  }
  if (!missing&&!existsSync(absolute)) throw new Error(`Missing local file: ${relative}`);
  if (existsSync(absolute)&&!lstatSync(absolute).isFile()) throw new Error(`Not a file: ${relative}`);
  if (existsSync(absolute)&&!within(realpathSync(root),realpathSync(absolute)))
    throw new Error(`Path leaves root: ${relative}`);
  return absolute;
}
function json(root,relative,maxBytes) {
  const file=localPath(root,relative);
  if (statSync(file).size>maxBytes) throw new Error(`JSON file exceeds bound: ${relative}`);
  return JSON.parse(readFileSync(file,'utf8'));
}
function flags(argv) {
  if (argv.length===1&&argv[0]==='--help') return null;
  const out={write:false,receipts:new Map(),cacheValidation:new Set()};
  for (let index=0;index<argv.length;index++) {
    const key=argv[index];
    if (key==='--write') {if(out.write)throw new Error(usage.trim());out.write=true;continue;}
    if (key==='--validation-receipt') {
      const value=argv[++index]??'',separator=value.indexOf('='),moduleId=value.slice(0,separator),receipt=value.slice(separator+1);
      if(separator<1||! /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(moduleId)
        ||!safePackagePath(receipt)||out.receipts.has(moduleId))throw new Error(usage.trim());
      out.receipts.set(moduleId,receipt);continue;
    }
    if(key==='--cache-validation'){
      const moduleId=argv[++index]??'';
      if(!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(moduleId)||out.cacheValidation.has(moduleId))
        throw new Error(usage.trim());
      out.cacheValidation.add(moduleId);continue;
    }
    if (!['--root','--composition','--lock','--inventory'].includes(key)||!argv[index+1]
      || argv[index+1].startsWith('--')||Object.hasOwn(out,key)) throw new Error(usage.trim());
    out[key]=argv[++index];
  }
  return out;
}
function sourceDirectory(root,source) {
  if (source?.kind==='workspace') {
    if (!safePackagePath(source.path)) throw new Error('Unsafe workspace source.');
    return path.resolve(root,...source.path.split('/'));
  }
  if (source?.kind==='package') {
    if (typeof source.name!=='string'||!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(source.name))
      throw new Error('Unsafe package source.');
    const directory=path.resolve(root,'node_modules',...source.name.split('/'));
    const pkg=json(root,path.relative(root,path.join(directory,'package.json')).replaceAll('\\','/'),64*1024);
    if (pkg.name!==source.name) throw new Error('Package name does not match selected source.');
    return directory;
  }
  throw new Error('Unsupported source kind.');
}
function descriptorAt(root,source) {
  const directory=sourceDirectory(root,source);
  const manifest=path.relative(root,path.join(directory,'module','manifest.json')).replaceAll('\\','/');
  const descriptor=json(root,manifest,2*1024*1024);
  const result=validateModule(descriptor);
  if (result.errors.length) throw new Error(`Module contract invalid (${manifest}): ${result.errors[0].code}`);
  if (source.kind==='package') {
    const pkg=json(root,path.relative(root,path.join(directory,'package.json')).replaceAll('\\','/'),64*1024);
    if (pkg.version!==descriptor.identity.version) throw new Error('Package version differs from module descriptor.');
  }
  return {directory,descriptor};
}
function buildLock(root,composition,allowedOrigins,writeCache,receipts=new Map(),cacheValidation=new Set(),existingLock=null) {
  if (!Array.isArray(composition?.modules)||composition.modules.length>1000
    || !Array.isArray(allowedOrigins)||allowedOrigins.length===0
    || allowedOrigins.some(origin=>typeof origin!=='string'||!origin.startsWith('https://')))
    throw new Error('Composition or allowed origins are invalid.');
  const modules=[],descriptors=[],ids=new Set();
  for (const selection of composition.modules) {
    if (ids.has(selection.moduleId)) throw new Error(`Duplicate module: ${selection.moduleId}`);
    ids.add(selection.moduleId);
    const {directory,descriptor}=descriptorAt(root,selection.source);
    if (descriptor.identity.id!==selection.moduleId || descriptor.identity.origin!==selection.origin
      || !allowedOrigins.includes(selection.origin)) throw new Error(`Module identity or origin refused: ${selection.moduleId}`);
    const receiptPath=receipts.get(selection.moduleId);
    if(receiptPath&&selection.source.kind!=='package')throw new Error(`Detached validation needs a package source: ${selection.moduleId}`);
    if(cacheValidation.has(selection.moduleId)&&!receiptPath)
      throw new Error(`Cached validation needs a detached receipt: ${selection.moduleId}`);
    const detachedValidation=receiptPath?verifyPackageReceipt({root,receiptPath,moduleDirectory:directory,descriptor}).validation:null;
    const canonicalValidation=detachedValidation
      ?`.creezio/module-artifacts/${selection.moduleId}/validation-${detachedValidation.integrity.slice(7)}.tgz`:null;
    const previous=existingLock?.modules?.find(node=>node.moduleId===selection.moduleId);
    const cacheDetachedValidation=cacheValidation.has(selection.moduleId)
      ||!!canonicalValidation&&previous?.validation?.location?.path===canonicalValidation;
    const artifacts=packModuleArtifacts({root,moduleDirectory:directory,moduleId:selection.moduleId,
      descriptor,writeCache,detachedValidation,cacheDetachedValidation});
    descriptors.push(descriptor);
    modules.push({moduleId:descriptor.identity.id,origin:descriptor.identity.origin,
      version:descriptor.identity.version,source:structuredClone(descriptor.identity.source),
      contractIntegrity:contractIntegrity(descriptor),
      runtime:{integrity:artifacts.runtime.integrity,location:{kind:'local',path:artifacts.runtime.path}},
      validation:{integrity:artifacts.validation.integrity,location:{kind:'local',path:artifacts.validation.path}},
      dependencies:[]});
  }
  for(const moduleId of receipts.keys())if(!ids.has(moduleId))
    throw new Error(`Validation receipt names an unselected module: ${moduleId}`);
  for(const moduleId of cacheValidation)if(!ids.has(moduleId))
    throw new Error(`Cached validation names an unselected module: ${moduleId}`);
  const versions=new Map(modules.map(module=>[module.moduleId,module.version]));
  for (let index=0;index<modules.length;index++) modules[index].dependencies=
    descriptors[index].dependencies.filter(dep=>versions.has(dep.moduleId))
      .map(dep=>({moduleId:dep.moduleId,version:versions.get(dep.moduleId)}));
  const lock={schemaVersion:'1.0.0',applicationId:composition.application.id,
    sdkVersion:composition.sdk.version,coreVersion:composition.sdk.coreVersion,
    policy:structuredClone(composition.sdk.policy),compositionIntegrity:contractIntegrity(composition),modules};
  const validation=validateComposition(composition,{lock,modules:descriptors});
  if (validation.errors.length) throw new Error(`Composition refused: ${validation.errors[0].code} ${validation.errors[0].path}`);
  return lock;
}
function saveLock(root,relative,lock) {
  const target=localPath(root,relative,{missing:true});
  const temporary=localPath(root,`${relative}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`,{missing:true});
  try {writeFileSync(temporary,`${JSON.stringify(lock,null,2)}\n`,{flag:'wx'});renameSync(temporary,target);}
  finally {if (existsSync(temporary)) unlinkSync(temporary);}
}

/** Check by default; --write refreshes only the local lock after full validation. */
export function runModuleLockCli(argv,{cwd=process.cwd(),stdout=process.stdout,stderr=process.stderr}={}) {
  try {
    const args=flags(argv);
    if (!args) {stdout.write(usage);return 0;}
    const root=path.resolve(cwd,args['--root']??'.');
    const compositionPath=args['--composition']??'configuration/composition.json';
    const lockPath=args['--lock']??compositionPath.replace(/\.json$/,'.lock.json');
    const inventoryPath=args['--inventory']??'configuration/module-inventory.json';
    const composition=json(root,compositionPath,2*1024*1024);
    const inventory=json(root,inventoryPath,64*1024);
    if (inventory?.schemaVersion!==1||!Array.isArray(inventory.allowedOrigins))
      throw new Error('Invalid module inventory configuration.');
    const existing=existsSync(localPath(root,lockPath,{missing:true}))
      ?json(root,lockPath,2*1024*1024):null;
    const expected=buildLock(root,composition,inventory.allowedOrigins,args.write,args.receipts,
      args.cacheValidation,existing);
    if (!args.write && (!existing||canonicalJson(existing)!==canonicalJson(expected)))
      throw new Error('Composition lock is missing or obsolete. Run with --write after reviewing the selected sources.');
    if (args.write && (!existing||canonicalJson(existing)!==canonicalJson(expected))) saveLock(root,lockPath,expected);
    stdout.write(`${args.write?'written':'valid'}: ${lockPath} (${expected.modules.length} modules)\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error?error.message:String(error)}\n`);
    return 1;
  }
}

if (process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.exitCode=runModuleLockCli(process.argv.slice(2));
