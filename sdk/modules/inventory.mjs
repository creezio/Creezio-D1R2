import {existsSync,readFileSync,lstatSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {validateModule,contractIntegrity,canonicalJson} from '../contracts/validate.mjs';
import {safePackagePath} from '../contracts/references.mjs';
import {packModuleArtifacts} from '../../scripts/modules/archives.mjs';
import {verifyPackageReceipt} from '../../scripts/modules/package-receipt.mjs';
import {decodeInstalledDocument,installedDocumentDigest,splitInstalledDocumentContent,
  INSTALLED_DOCUMENT_LIMITS} from './documents.ts';

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
function compile({root,candidates,allowedOrigins,cacheDir='.creezio/module-artifacts',selectedCount=0}) {
  if (typeof root!=='string'||!Array.isArray(candidates)||candidates.length>1000
    || !Array.isArray(allowedOrigins)||allowedOrigins.some(origin=>typeof origin!=='string')
    || !Number.isSafeInteger(selectedCount)||selectedCount<0||selectedCount>candidates.length) fail('input');
  const absoluteRoot=existing(root,root,true),allowed=new Set(allowedOrigins);
  const compiled=[],identities=new Set(),currentInstalledDocuments=[];
  let totalDocumentBytes=0;
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
    const installed=descriptor.documentation.installed;
    const kinds=['readme','prd','changelog'];
    if(item.validationReceipt && item.source.kind!=='package')fail('receipt_source',moduleId);
    const detachedValidation=item.validationReceipt?verifyPackageReceipt({root:absoluteRoot,
      receiptPath:item.validationReceipt,moduleDirectory:directory,descriptor}).validation:null;
    const cachedValidation=detachedValidation
      ?`${cacheDir}/${moduleId}/validation-${detachedValidation.integrity.slice(7)}.tgz`:null;
    const cacheDetachedValidation=!!detachedValidation
      &&node.validation?.location?.path===cachedValidation;
    if(detachedValidation&&(node.validation?.location?.kind!=='local'
      ||node.validation.location.path!==detachedValidation.path&&!cacheDetachedValidation))
      fail('lock_location',moduleId);
    if(item.source.kind==='package'&&node.validation?.location?.kind==='local'
      &&node.validation.location.path.startsWith('.creezio/packages/')&&!detachedValidation)fail('receipt_missing',moduleId);
    const artifact=packModuleArtifacts({root:absoluteRoot,moduleDirectory:directory,moduleId,descriptor,cacheDir,
      expected:{runtime:node.runtime?.integrity,validation:node.validation?.integrity},
      detachedValidation,cacheDetachedValidation,
      captureRuntimeFiles:index<selectedCount?kinds.map(kind=>installed[kind].path):[]});
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
    if (index<selectedCount) {
      let moduleBytes=0;
      for (const kind of kinds) {
        const declaration=installed[kind],bytes=artifact.capturedRuntimeFiles[declaration.path];
        if (!bytes) fail('document_missing',`${moduleId}:${kind}`);
        moduleBytes+=bytes.byteLength;totalDocumentBytes+=bytes.byteLength;
        if (bytes.byteLength>INSTALLED_DOCUMENT_LIMITS.documentBytes
          || moduleBytes>INSTALLED_DOCUMENT_LIMITS.moduleBytes
          || totalDocumentBytes>INSTALLED_DOCUMENT_LIMITS.totalBytes) fail('document_size',`${moduleId}:${kind}`);
        let content,blockCount;
        try {content=decodeInstalledDocument(bytes);blockCount=splitInstalledDocumentContent(content).length;}
        catch {fail('document_encoding',`${moduleId}:${kind}`);}
        currentInstalledDocuments.push(Object.freeze({moduleId,origin,version,
          sourceRevision:descriptor.identity.source.revision,runtimeIntegrity:node.runtime.integrity,
          kind,visibility:declaration.visibility,path:declaration.path,
          digest:installedDocumentDigest(bytes),byteLength:bytes.byteLength,blockCount,content}));
      }
    }
    const core={moduleId,origin,version,source:item.source,descriptor,lockNode:node};
    compiled.push(Object.freeze({candidateKey:contractIntegrity({moduleId,origin,version,source:item.source,
      contractIntegrity:node.contractIntegrity,runtime:node.runtime.integrity,validation:node.validation.integrity}),
      ...core}));
  }
  compiled.sort(ordered);
  const base={schemaVersion:1,candidates:Object.freeze(compiled)};
  return {inventory:Object.freeze({...base,digest:contractIntegrity(base)}),
    currentInstalledDocuments:Object.freeze(currentInstalledDocuments)};
}

export function compileModuleInventory(options) {return compile(options).inventory;}

/** Build-only capture of selected documents, from the exact bytes used to verify runtime archives. */
export function compileModuleInventoryWithDocuments(options) {return compile(options);}
