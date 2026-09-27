import {existsSync,readFileSync,lstatSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {validateModule,contractIntegrity,canonicalJson} from '../contracts/validate.mjs';
import {safePackagePath} from '../contracts/references.mjs';
import {packModuleArtifacts} from '../../scripts/modules/archives.mjs';

export class ModuleInventoryError extends Error {
  constructor(code,detail='') {super(`Module inventory refused (${code}${detail?`: ${detail}`:''}).`);
    this.name='ModuleInventoryError';this.code=code;}
}
const fail=(code,detail)=>{throw new ModuleInventoryError(code,detail);};
const contained=(base,target)=>target===base||target.startsWith(`${base}${path.sep}`);
function existing(root,target,directory=false) {
  const base=path.resolve(root),absolute=path.resolve(target);
  if (!contained(base,absolute)) fail('path_escape');
  if (!existsSync(base)) fail('path_missing');
  if (lstatSync(base).isSymbolicLink()) fail('path_link');
  let cursor=base;
  for (const part of path.relative(base,absolute).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    if (!existsSync(cursor)) fail('path_missing');
    if (lstatSync(cursor).isSymbolicLink()) fail('path_link');
  }
  if (!contained(realpathSync(base),realpathSync(absolute))) fail('path_escape');
  if (directory?!lstatSync(absolute).isDirectory():!lstatSync(absolute).isFile()) fail('path_type');
  return absolute;
}
function located(root,source) {
  if (!source||typeof source!=='object') fail('source');
  if (source.kind==='workspace') {
    if (!safePackagePath(source.path)) fail('source_path');
    return existing(root,path.join(root,...source.path.split('/')),true);
  }
  if (source.kind==='package') {
    if (typeof source.name!=='string'||!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(source.name))
      fail('source_package');
    const directory=existing(root,path.join(root,'node_modules',...source.name.split('/')),true);
    const metadata=JSON.parse(readFileSync(existing(root,path.join(directory,'package.json')),'utf8'));
    if (metadata.name!==source.name) fail('source_package');
    return directory;
  }
  return fail('source_kind');
}
const ordered=(left,right)=>left.moduleId.localeCompare(right.moduleId)
  || left.version.localeCompare(right.version)||left.candidateKey.localeCompare(right.candidateKey);

/** Node/build only. Every entry comes from an already present source and real cached artifact bytes. */
export function compileModuleInventory({root,candidates,allowedOrigins,cacheDir='.creezio/module-artifacts'}) {
  if (typeof root!=='string'||!Array.isArray(candidates)||candidates.length>1000
    || !Array.isArray(allowedOrigins)||allowedOrigins.some(origin=>typeof origin!=='string')) fail('input');
  const absoluteRoot=existing(root,root,true),allowed=new Set(allowedOrigins);
  const compiled=[],identities=new Set();
  for (const [index,item] of candidates.entries()) {
    if (!item||typeof item!=='object'||!item.source||!item.lockNode) fail('candidate',String(index));
    const directory=located(absoluteRoot,item.source);
    const manifest=existing(absoluteRoot,path.join(directory,'module','manifest.json'));
    if (statSync(manifest).size>2*1024*1024) fail('descriptor_size',String(index));
    const descriptor=JSON.parse(readFileSync(manifest,'utf8'));
    const validation=validateModule(descriptor);
    if (validation.errors.length) fail('descriptor',`${index}:${validation.errors[0].code}`);
    const moduleId=descriptor.identity.id,origin=descriptor.identity.origin,version=descriptor.identity.version;
    if (!allowed.has(origin)) fail('origin',moduleId);
    if (item.source.kind==='package') {
      const pkg=JSON.parse(readFileSync(existing(absoluteRoot,path.join(directory,'package.json')),'utf8'));
      if (pkg.version!==version) fail('package_version',moduleId);
    }
    const node=item.lockNode;
    if (node.moduleId!==moduleId||node.origin!==origin||node.version!==version
      || canonicalJson(node.source)!==canonicalJson(descriptor.identity.source)
      || node.contractIntegrity!==contractIntegrity(descriptor)) fail('lock_identity',moduleId);
    const artifact=packModuleArtifacts({root:absoluteRoot,moduleDirectory:directory,moduleId,descriptor,cacheDir,
      expected:{runtime:node.runtime?.integrity,validation:node.validation?.integrity}});
    if (node.runtime?.integrity!==artifact.runtime.integrity
      || node.validation?.integrity!==artifact.validation.integrity) fail('lock_artifact',moduleId);
    // A local lock must name the very bytes just packed. HTTPS locations are never fetched here.
    if (node.runtime.location?.kind==='local'&&node.runtime.location.path!==artifact.runtime.path
      || node.validation.location?.kind==='local'&&node.validation.location.path!==artifact.validation.path
      || !['local','https'].includes(node.runtime.location?.kind)
      || !['local','https'].includes(node.validation.location?.kind)) fail('lock_location',moduleId);
    const identity=`${moduleId}:${version}:${origin}`;
    if (identities.has(identity)) fail('duplicate',identity);
    identities.add(identity);
    const core={moduleId,origin,version,source:item.source,descriptor,lockNode:node};
    compiled.push(Object.freeze({candidateKey:contractIntegrity({moduleId,origin,version,source:item.source,
      contractIntegrity:node.contractIntegrity,runtime:node.runtime.integrity,validation:node.validation.integrity}),
      ...core}));
  }
  compiled.sort(ordered);
  const base={schemaVersion:1,candidates:Object.freeze(compiled)};
  return Object.freeze({...base,digest:contractIntegrity(base)});
}
