import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import semver from 'semver';
import {canonicalJson,contractIntegrity,validateArtifactReceipt,validateModule} from '../../sdk/contracts/validate.mjs';
import {deterministicModuleArchive} from './archives.mjs';
import {safePackagePath} from '../../sdk/contracts/references.mjs';

export class PackageReceiptError extends Error {
  constructor(code){super(`Package receipt refused (${code}).`);this.name='PackageReceiptError';this.code=code;}
}
const fail=code=>{throw new PackageReceiptError(code);};
const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const within=(base,target)=>target===base||target.startsWith(`${base}${path.sep}`);

function localFile(root,relative,maxBytes){
  if(!safePackagePath(relative))fail('path');
  const base=path.resolve(root),target=path.resolve(base,...relative.split('/'));
  if(!within(base,target)||!existsSync(base)||lstatSync(base).isSymbolicLink())fail('path');
  let cursor=base;
  for(const part of path.relative(base,target).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);
    if(!existsSync(cursor)||lstatSync(cursor).isSymbolicLink())fail('path');
  }
  if(!lstatSync(target).isFile()||!within(realpathSync(base),realpathSync(target))
    ||statSync(target).size>maxBytes)fail('path');
  return readFileSync(target);
}
function tarEntries(archive){
  if(archive.byteLength>64*1024*1024)fail('archive_size');
  let tar;try{tar=gunzipSync(archive,{maxOutputLength:256*1024*1024});}catch{fail('archive_gzip');}
  const entries=[],seen=new Set();let extendedPath=null,terminated=false;
  for(let offset=0;offset+512<=tar.length;){
    const header=tar.subarray(offset,offset+512);
    if(header.every(byte=>byte===0)){
      if(tar.subarray(offset).some(byte=>byte!==0))fail('archive_trailer');
      terminated=true;break;
    }
    const expected=parseInt(header.subarray(148,156).toString('ascii').replace(/\0.*$/,'').trim(),8);
    const copy=Buffer.from(header);copy.fill(32,148,156);
    if(!Number.isSafeInteger(expected)||expected!==copy.reduce((sum,byte)=>sum+byte,0))fail('archive_checksum');
    const rawName=header.subarray(0,100).toString('utf8').replace(/\0.*$/,'');
    const prefix=header.subarray(345,500).toString('utf8').replace(/\0.*$/,'');
    const name=prefix?`${prefix}/${rawName}`:rawName;
    const size=parseInt(header.subarray(124,136).toString('ascii').replace(/\0.*$/,'').trim(),8);
    if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)fail('archive_entry');
    const type=String.fromCharCode(header[156]);
    const data=tar.subarray(offset+512,offset+512+size);
    if(type==='x'){
      const record=data.toString('utf8').match(/(?:^|\n)\d+ path=([^\n]+)\n/);
      extendedPath=record?.[1]??null;
      if(!extendedPath)fail('archive_pax');
    }else if(type==='0'||type==='\0'){
      const filename=extendedPath??name;
      if(!safePackagePath(filename)||seen.has(filename))fail('archive_path');
      seen.add(filename);entries.push({path:filename,bytes:Buffer.from(data)});extendedPath=null;
    }else if(type==='5'){extendedPath=null;}
    else fail('archive_link');
    offset+=512+Math.ceil(size/512)*512;
  }
  if(!terminated||extendedPath!==null||entries.length===0||entries.length>4096)fail('archive_entries');
  return entries;
}
function exact(entries,names){
  if(!Array.isArray(names)||names.length!==entries.length||new Set(names).size!==names.length
    ||names.some(name=>!safePackagePath(name)))fail('archive_inventory');
  const declared=new Set(names);
  if(entries.some(entry=>!declared.has(entry.path)))fail('archive_inventory');
}

/** Match the build loader's static package export check without loading candidate code. */
export function packageExports(exportsValue) {
  const paths=new Set();
  function visit(value) {
    if(typeof value==='string') {if(value.startsWith('./')&&!value.includes('*'))paths.add(value.slice(2));}
    else if(Array.isArray(value))value.forEach(visit);
    else if(value&&typeof value==='object')Object.values(value).forEach(visit);
  }
  visit(exportsValue);return paths;
}

function requiredBuildExports(descriptor) {
  const paths=new Set(['module/manifest.json']);
  const add=reference=>{if(reference?.path)paths.add(reference.path);};
  add(descriptor.entrypoints.server);add(descriptor.entrypoints.ui);
  for(const operation of descriptor.contracts.operations)add(operation.handler);
  for(const view of descriptor.contracts.ui.views)add(view.component);
  for(const theme of descriptor.contracts.ui.themes??[])add(theme.component);
  for(const stylesheet of descriptor.contracts.ui.styles)paths.add(stylesheet);
  for(const resource of descriptor.contracts.mcp.resources){
    if(resource.source.kind==='asset')paths.add(resource.source.path);
  }
  for(const widget of descriptor.contracts.widgets){
    add(widget.renderer);
    for(const asset of widget.assets)paths.add(asset);
    for(const action of widget.actions){
      add(action.target?.handler);
      if(action.target?.template)paths.add(action.target.template);
    }
  }
  if(descriptor.identity.id==='creezio.openai'){
    paths.add('module/storage.ts');paths.add('module/transport.ts');
  }
  return paths;
}

/** Read a new or future package from supplied bytes. No writes or module execution. */
export function verifyCandidatePackageReceipt({currentNode,expectedModuleId,expectedOrigin,
  packageName,version,allowedOrigins,
  runtimeBytes,validationBytes,receiptBytes,expected}) {
  const digest=/^sha256-[a-f0-9]{64}$/;
  const updating=currentNode!==undefined&&currentNode!==null;
  if(typeof packageName!=='string'
    ||!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)
    ||!semver.valid(version)
    ||(updating&&(!semver.valid(currentNode.version)||!semver.gt(version,currentNode.version)))
    ||(!updating&&(typeof expectedModuleId!=='string'||!expectedModuleId
      ||typeof expectedOrigin!=='string'||!expectedOrigin))
    ||!Array.isArray(allowedOrigins)||!expected
    ||![expected.runtime,expected.validation,expected.receipt].every(item=>digest.test(item))
    ||![runtimeBytes,validationBytes,receiptBytes].every(item=>item instanceof Uint8Array)
    ||receiptBytes.byteLength>64*1024||runtimeBytes.byteLength>64*1024*1024
    ||validationBytes.byteLength>64*1024*1024)fail('candidate_input');
  const runtime=Buffer.from(runtimeBytes),detached=Buffer.from(validationBytes);
  const receiptRaw=Buffer.from(receiptBytes);
  if(sha(runtime)!==expected.runtime||sha(detached)!==expected.validation
    ||sha(receiptRaw)!==expected.receipt)fail('candidate_digest');
  let receipt;try{receipt=JSON.parse(receiptRaw.toString('utf8'));}catch{fail('receipt_json');}
  if(validateArtifactReceipt(receipt).errors.length)fail('receipt_schema');
  const entries=tarEntries(runtime),validationEntries=tarEntries(detached);
  const index=new Map(entries.map(entry=>[entry.path,entry.bytes]));
  let pkg,descriptor;
  try{pkg=JSON.parse(index.get('package/package.json')?.toString('utf8'));
    descriptor=JSON.parse(index.get('package/module/manifest.json')?.toString('utf8'));}
  catch{fail('candidate_manifest');}
  if(validateModule(descriptor).errors.length)fail('candidate_descriptor');
  if(pkg?.name!==packageName||pkg.version!==version
    ||descriptor.identity.id!==(updating?currentNode.moduleId:expectedModuleId)
    ||descriptor.identity.origin!==(updating?currentNode.origin:expectedOrigin)
    ||(expectedModuleId!==undefined&&descriptor.identity.id!==expectedModuleId)
    ||(expectedOrigin!==undefined&&descriptor.identity.origin!==expectedOrigin)
    ||descriptor.identity.version!==version
    ||!allowedOrigins.includes(descriptor.identity.origin))fail('candidate_identity');
  if(receipt.module.id!==descriptor.identity.id||receipt.module.origin!==descriptor.identity.origin
    ||receipt.module.version!==version
    ||canonicalJson(receipt.module.source)!==canonicalJson(descriptor.identity.source)
    ||receipt.contractIntegrity!==contractIntegrity(descriptor)
    ||canonicalJson(receipt.policy)!==canonicalJson(descriptor.validation.policy)
    ||receipt.runtime.integrity!==expected.runtime
    ||receipt.validation.integrity!==expected.validation
    ||receipt.runtime.location.kind!=='local'||receipt.validation.location.kind!=='local'
    ||receipt.runtime.location.path===receipt.validation.location.path
    ||(updating&&receipt.validation.location.path===currentNode.validation?.location?.path))
    fail('candidate_receipt');
  exact(entries,descriptor.packaging.runtime.files.map(name=>`package/${name}`));
  exact(validationEntries,descriptor.packaging.validation.files);
  const exports=packageExports(pkg.exports);
  if([...requiredBuildExports(descriptor)].some(name=>!exports.has(name)))fail('candidate_exports');
  const central=deterministicModuleArchive(entries.map(entry=>({
    path:entry.path.slice('package/'.length),bytes:entry.bytes})));
  const centralIntegrity=sha(central);
  const source={kind:'package',name:packageName};
  // A receipt proves the supplied bytes; its file paths do not select staging targets.
  const artifactDirectory=`.creezio/module-artifacts/${descriptor.identity.id}`;
  const lockNode={moduleId:descriptor.identity.id,origin:descriptor.identity.origin,
    version,source:structuredClone(descriptor.identity.source),
    contractIntegrity:contractIntegrity(descriptor),
    runtime:{integrity:centralIntegrity,location:{kind:'local',
      path:`${artifactDirectory}/runtime-${centralIntegrity.slice(7)}.tgz`}},
    validation:{integrity:expected.validation,location:{kind:'local',
      path:`${artifactDirectory}/validation-${expected.validation.slice(7)}.tgz`}},
    dependencies:[]};
  const candidateKey=contractIntegrity({moduleId:lockNode.moduleId,origin:lockNode.origin,
    version,source,contractIntegrity:lockNode.contractIntegrity,
    runtime:centralIntegrity,validation:expected.validation});
  return Object.freeze({candidateKey,moduleId:lockNode.moduleId,origin:lockNode.origin,
    version,source,descriptor,lockNode});
}

/** Return archive contents only after the complete detached receipt preflight succeeds. */
export function readVerifiedCandidatePackageArchives(args) {
  const candidate=verifyCandidatePackageReceipt(args);
  const runtimeFiles=tarEntries(Buffer.from(args.runtimeBytes)).map(entry=>Object.freeze({
    path:entry.path.slice('package/'.length),bytes:entry.bytes}));
  const validationFiles=tarEntries(Buffer.from(args.validationBytes)).map(entry=>Object.freeze({
    path:entry.path,bytes:entry.bytes}));
  return Object.freeze({candidate,runtimeFiles:Object.freeze(runtimeFiles),
    validationFiles:Object.freeze(validationFiles)});
}

/** Verify both independently acquired tarballs against one explicit, local receipt and installed package. */
export function verifyPackageReceipt({root,receiptPath,moduleDirectory,descriptor}){
  const base=path.resolve(root),relative=path.relative(base,path.resolve(moduleDirectory)).replaceAll('\\','/');
  if(relative&&!safePackagePath(relative))fail('package_path');
  const raw=localFile(base,receiptPath,64*1024);
  let receipt;try{receipt=JSON.parse(raw.toString('utf8'));}catch{fail('receipt_json');}
  const validation=validateArtifactReceipt(receipt);
  if(validation.errors.length)fail('receipt_schema');
  if(receipt.module.id!==descriptor.identity.id||receipt.module.origin!==descriptor.identity.origin
    ||receipt.module.version!==descriptor.identity.version
    ||canonicalJson(receipt.module.source)!==canonicalJson(descriptor.identity.source)
    ||receipt.contractIntegrity!==contractIntegrity(descriptor)
    ||canonicalJson(receipt.policy)!==canonicalJson(descriptor.validation.policy))fail('receipt_identity');
  if(receipt.runtime.location.kind!=='local'||receipt.validation.location.kind!=='local')fail('receipt_location');
  const runtime=localFile(base,receipt.runtime.location.path,64*1024*1024);
  const detached=localFile(base,receipt.validation.location.path,64*1024*1024);
  if(sha(runtime)!==receipt.runtime.integrity||sha(detached)!==receipt.validation.integrity)fail('receipt_integrity');
  const runtimeEntries=tarEntries(runtime),validationEntries=tarEntries(detached);
  exact(runtimeEntries,descriptor.packaging.runtime.files.map(name=>`package/${name}`));
  exact(validationEntries,descriptor.packaging.validation.files);
  for(const entry of runtimeEntries){
    const name=entry.path.slice('package/'.length);
    if(!entry.bytes.equals(localFile(base,relative?`${relative}/${name}`:name,64*1024*1024)))fail('installed_runtime');
  }
  return Object.freeze({receipt,validation:Object.freeze({integrity:receipt.validation.integrity,
    path:receipt.validation.location.path})});
}
