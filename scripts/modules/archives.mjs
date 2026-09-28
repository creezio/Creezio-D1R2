import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,renameSync,statSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {safePackagePath} from '../../sdk/contracts/references.mjs';

export class ModuleArchiveError extends Error {
  constructor(code) {super(`Module archive refused (${code}).`);this.name='ModuleArchiveError';this.code=code;}
}
const fail=code=>{throw new ModuleArchiveError(code);};
const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const within=(root,target)=>target===root||target.startsWith(`${root}${path.sep}`);
const textFile=name=>!(/\.(?:png|jpe?g|webp|gif|ico|svgz|woff2?|ttf|otf|pdf|zip|gz|wasm|mp[34])$/i.test(name));

function confined(root,target,{directory=false,missing=false}={}) {
  const absolute=path.resolve(target),base=path.resolve(root);
  if (!within(base,absolute)) fail('path_escape');
  let cursor=base;
  if (!existsSync(cursor)||lstatSync(cursor).isSymbolicLink()) fail('path_link');
  const relative=path.relative(base,absolute);
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail('path_link');
  }
  if (!missing && !existsSync(absolute)) fail('path_missing');
  if (existsSync(absolute) && (directory?!lstatSync(absolute).isDirectory():!lstatSync(absolute).isFile())) fail('path_type');
  if (existsSync(absolute) && !within(realpathSync(base),realpathSync(absolute))) fail('path_escape');
  return absolute;
}
const octal=(header,offset,width,value)=>{
  const valueText=value.toString(8);
  if (valueText.length>width-1) fail('archive_size');
  header.write(`${valueText.padStart(width-1,'0')}\0`,offset,width,'ascii');
};
function header(name,size,type='0') {
  const raw=Buffer.from(name,'utf8');
  if (raw.length>100) fail('archive_path');
  const out=Buffer.alloc(512);
  raw.copy(out,0); octal(out,100,8,0o644);octal(out,108,8,0);octal(out,116,8,0);
  octal(out,124,12,size);octal(out,136,12,0);
  out.fill(32,148,156);out.write(type,156,1,'ascii');
  out.write('ustar\0',257,6,'ascii');out.write('00',263,2,'ascii');
  const checksum=out.reduce((sum,byte)=>sum+byte,0);
  out.write(`${checksum.toString(8).padStart(6,'0')}\0 `,148,8,'ascii');
  return out;
}
function paxPath(name) {
  const item=`path=${name}\n`;
  let size=Buffer.byteLength(item)+3;
  for (;;) {const record=`${size} ${item}`;const actual=Buffer.byteLength(record);
    if (actual===size)return Buffer.from(record);size=actual;}
}
function blocks(name,bytes,index) {
  const parts=[];
  const encoded=Buffer.from(name,'utf8');
  const usePax=encoded.length>100||!encoded.every(byte=>byte>=32&&byte<127);
  if (usePax) {
    const pax=paxPath(name);
    parts.push(header(`PaxHeaders/${index}`,pax.length,'x'),pax,Buffer.alloc((512-pax.length%512)%512));
  }
  parts.push(header(usePax?`file-${index}`:name,bytes.length),bytes,
    Buffer.alloc((512-bytes.length%512)%512));
  return parts;
}
export function deterministicModuleArchive(files) {
  if (!Array.isArray(files)||files.length===0||files.length>4096) fail('archive_files');
  const names=files.map(item=>item.path);
  if (new Set(names).size!==names.length||names.some(name=>!safePackagePath(name))) fail('archive_path');
  const sections=[];
  const sorted=[...files].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
  for (const [index,file] of sorted.entries()) {
    if (!(file.bytes instanceof Uint8Array)) fail('archive_bytes');
    sections.push(...blocks(file.path,Buffer.from(file.bytes),index));
  }
  sections.push(Buffer.alloc(1024));
  const compressed=gzipSync(Buffer.concat(sections),{level:9});
  // gzip OS byte and mtime are fixed even if a future Node default changes.
  compressed.fill(0,4,8);compressed[9]=255;
  return compressed;
}
function readDeclared(directory,names,root) {
  if (!Array.isArray(names)||names.length===0||names.length>4096) fail('archive_files');
  return names.map(name=>{
    if (!safePackagePath(name)) fail('archive_path');
    const absolute=confined(root,path.join(directory,...name.split('/')));
    const bytes=readFileSync(absolute);
    if (textFile(name)) {
      try {new TextDecoder('utf-8',{fatal:true}).decode(bytes);} catch {fail('text_encoding');}
      if (bytes.includes(13)) fail('text_eol');
    }
    return {path:name,bytes};
  });
}
function cacheArchive(root,moduleId,kind,bytes,cacheRoot,writeCache) {
  const directory=confined(root,path.join(cacheRoot,moduleId),{directory:true,missing:true});
  if (writeCache) mkdirSync(directory,{recursive:true});
  if (existsSync(directory)) confined(root,directory,{directory:true});
  const integrity=sha(bytes);
  const destination=confined(root,path.join(directory,`${kind}-${integrity.slice(7)}.tgz`),{missing:true});
  if (existsSync(destination)) {
    if (sha(readFileSync(destination))!==integrity) fail('cache_corrupt');
    return {integrity,path:path.relative(root,destination).replaceAll('\\','/')};
  }
  if (!writeCache) fail('cache_missing');
  const temporary=confined(root,`${destination}.tmp-${process.pid}`,{missing:true});
  try {writeFileSync(temporary,bytes,{flag:'wx'});renameSync(temporary,destination);}
  finally {if(existsSync(temporary))unlinkSync(temporary);}
  return {integrity,path:path.relative(root,destination).replaceAll('\\','/')};
}
/** Node-only source packer. It never transforms line endings or executes module code. */
export function packModuleArtifacts({root,moduleDirectory,moduleId,descriptor,
  cacheDir='.creezio/module-artifacts',expected=null,writeCache=true,captureRuntimeFiles=[],
  detachedValidation=null,cacheDetachedValidation=false}) {
  const absoluteRoot=path.resolve(root),directory=confined(absoluteRoot,moduleDirectory,{directory:true});
  if (typeof moduleId!=='string'||!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(moduleId)
    || descriptor?.identity?.id!==moduleId||!safePackagePath(cacheDir)) fail('descriptor');
  const cacheRoot=confined(absoluteRoot,path.join(absoluteRoot,...cacheDir.split('/')),{directory:true,missing:true});
  if (!Array.isArray(captureRuntimeFiles)||new Set(captureRuntimeFiles).size!==captureRuntimeFiles.length
    || captureRuntimeFiles.some(name=>!safePackagePath(name)
      || !descriptor.packaging?.runtime?.files?.includes(name))) fail('capture_files');
  const runtimeFiles=readDeclared(directory,descriptor.packaging?.runtime?.files,absoluteRoot);
  const capturedRuntimeFiles=Object.fromEntries(runtimeFiles.filter(file=>captureRuntimeFiles.includes(file.path))
    .map(file=>[file.path,file.bytes]));
  const runtime=deterministicModuleArchive(runtimeFiles);
  if(detachedValidation && (!/^sha256-[a-f0-9]{64}$/.test(detachedValidation.integrity??'')
    || !safePackagePath(detachedValidation.path))) fail('validation_artifact');
  if(cacheDetachedValidation&&!detachedValidation)fail('validation_artifact');
  const validation=detachedValidation?null:deterministicModuleArchive(
    readDeclared(directory,descriptor.packaging?.validation?.files,absoluteRoot));
  const validationIntegrity=detachedValidation?.integrity??sha(validation);
  if (expected && (expected.runtime!==sha(runtime)||expected.validation!==validationIntegrity)) fail('lock_artifact');
  let detachedArtifact=detachedValidation;
  if(cacheDetachedValidation){
    const source=confined(absoluteRoot,path.join(absoluteRoot,...detachedValidation.path.split('/')));
    if(statSync(source).size>64*1024*1024)fail('validation_artifact');
    const bytes=readFileSync(source);
    if(sha(bytes)!==detachedValidation.integrity)fail('validation_artifact');
    detachedArtifact=cacheArchive(absoluteRoot,moduleId,'validation',bytes,cacheRoot,writeCache);
  }
  return Object.freeze({runtime:cacheArchive(absoluteRoot,moduleId,'runtime',runtime,cacheRoot,writeCache),
    validation:detachedArtifact??cacheArchive(absoluteRoot,moduleId,'validation',validation,cacheRoot,writeCache),
    capturedRuntimeFiles:Object.freeze(capturedRuntimeFiles)});
}
