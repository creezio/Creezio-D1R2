import {copyJson} from '../data/input.ts';
import {OperationError} from './types.ts';
import {contractIntegrity} from '../../sdk/contracts/semantics.mjs';
import type {ModuleSettingsHostInventory} from '../../sdk/module-settings/types.ts';
import {INSTALLED_DOCUMENT_LIMITS, verifyInstalledDocumentContent} from '../../sdk/modules/documents.ts';

const moduleId = 'creezio.modules-settings';
const origin = 'https://github.com/creezio/Creezio-D1R2';
const sourcePath = 'extensions/native/modules-settings';

/** Static host configuration only. A request or a module cannot supply this capability. */
export function captureHostInventory(value: ModuleSettingsHostInventory | undefined, compositionDigest: string) {
  if (value === undefined) return undefined;
  try {
    const captured = copyJson(value, 4 * 1024 * 1024) as unknown as ModuleSettingsHostInventory;
    const {current, inventory} = captured;
    if (contractIntegrity(current.composition) !== compositionDigest || inventory.schemaVersion !== 1
      || contractIntegrity({schemaVersion: 1, candidates: inventory.candidates}) !== inventory.digest
      || !Array.isArray(current.composition.modules) || !Array.isArray(current.descriptors)
      || !Array.isArray(current.lock.modules) || !Array.isArray(captured.currentInstalledDocuments)) throw new Error();
    const documents=captured.currentInstalledDocuments;
    if (documents.length!==current.composition.modules.length*3) throw new Error();
    let totalBytes=0;
    const seen=new Set<string>();
    for (const selection of current.composition.modules) {
      const descriptor=current.descriptors.find(item=>(item.identity as {id?:string}|undefined)?.id===selection.moduleId);
      const node=current.lock.modules.find(item=>item.moduleId===selection.moduleId);
      if (!descriptor||!node) throw new Error();
      const identity=descriptor.identity as {id:string;origin:string;version:string;source:{revision:string}};
      const installed=(descriptor.documentation as {installed:Record<string,{path:string;visibility:string;artifact:string}>}).installed;
      if (node.moduleId!==selection.moduleId||node.version!==identity.version
        || node.origin!==identity.origin||selection.origin!==node.origin
        || contractIntegrity(identity.source)!==contractIntegrity(node.source)
        || node.contractIntegrity!==contractIntegrity(descriptor)) throw new Error();
      const matching=inventory.candidates.filter(candidate=>{
        const candidateNode=candidate.lockNode as {contractIntegrity:string;runtime:{integrity:string};validation:{integrity:string}};
        return candidate.moduleId===selection.moduleId
          && candidate.version===node.version&&candidate.origin===node.origin
          && candidateNode.contractIntegrity===node.contractIntegrity
          && candidateNode.runtime.integrity===node.runtime.integrity
          && candidateNode.validation.integrity===node.validation.integrity
          && contractIntegrity(candidate.source)===contractIntegrity(selection.source);
      });
      if (matching.length!==1||contractIntegrity(matching[0].descriptor)!==contractIntegrity(descriptor)) throw new Error();
      const runtimeFiles=(descriptor.packaging as {runtime:{files:string[]}}).runtime.files;
      let moduleBytes=0;
      for (const kind of ['readme','prd','changelog'] as const) {
        const declaration=installed[kind];
        const matches=documents.filter(item=>item.moduleId===selection.moduleId&&item.kind===kind);
        if (matches.length!==1) throw new Error();
        const doc=matches[0],key=`${doc.moduleId}:${doc.kind}`;
        if (seen.has(key)||declaration.artifact!=='runtime'||!runtimeFiles.includes(declaration.path)
          || doc.origin!==node.origin
          || doc.version!==node.version||doc.sourceRevision!==identity.source.revision
          || doc.runtimeIntegrity!==node.runtime.integrity||doc.path!==declaration.path
          || doc.visibility!==declaration.visibility||!verifyInstalledDocumentContent(doc,doc.content)
          || doc.byteLength>INSTALLED_DOCUMENT_LIMITS.documentBytes
          || doc.blockCount<1||doc.blockCount>INSTALLED_DOCUMENT_LIMITS.maxBlocks) throw new Error();
        seen.add(key);moduleBytes+=doc.byteLength;totalBytes+=doc.byteLength;
      }
      if(moduleBytes>INSTALLED_DOCUMENT_LIMITS.moduleBytes) throw new Error();
    }
    if(totalBytes>INSTALLED_DOCUMENT_LIMITS.totalBytes) throw new Error();
    const selection = current.composition.modules.find(item => item.moduleId === moduleId);
    const descriptor = current.descriptors.find(item => (item.identity as Record<string, unknown>)?.id === moduleId);
    const identity = descriptor?.identity as Record<string, unknown> | undefined;
    if (!selection?.enabled || selection.origin !== origin || selection.source?.kind !== 'workspace'
      || selection.source.path !== sourcePath || identity?.origin !== origin || identity?.publisher !== 'creezio') throw new Error();
    const candidate = inventory.candidates.find(item => item.moduleId === moduleId && item.origin === origin
      && item.version === identity.version && item.source.kind === 'workspace' && item.source.path === sourcePath);
    if (!candidate || contractIntegrity(candidate.descriptor) !== contractIntegrity(descriptor)) throw new Error();
    return captured;
  } catch { throw new OperationError('invalid_catalog'); }
}
