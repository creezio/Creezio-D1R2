import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {canonicalJson,contractIntegrity,validateArtifactReceipt} from '../../sdk/contracts/validate.mjs';
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
