import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureHostInventory} from '../../core/operations/host-inventory.ts';
import {contractIntegrity} from '../../sdk/contracts/semantics.mjs';
import {currentModuleCandidateKeys} from '../../scripts/build/compose-runtime.mjs';
import {installedDocumentDigest} from '../../sdk/modules/documents.ts';
const descriptor=JSON.parse(readFileSync(new URL('../../extensions/native/modules-settings/module/manifest.json',import.meta.url),'utf8'));
const id=descriptor.identity.id,origin=descriptor.identity.origin;
function witness(){
  const source={kind:'workspace',path:'extensions/native/modules-settings'};
  const composition={modules:[{moduleId:id,origin,enabled:true,source}]};
  const lockNode={moduleId:id,origin,version:descriptor.identity.version,source:descriptor.identity.source,
    contractIntegrity:contractIntegrity(descriptor),runtime:{integrity:'sha256-'+ 'a'.repeat(64)},
    validation:{integrity:'sha256-'+ 'b'.repeat(64)}};
  const lock={modules:[lockNode]};
  const candidates=[{candidateKey:'candidate',moduleId:id,origin,version:descriptor.identity.version,source,descriptor,lockNode}];
  const currentInstalledDocuments=['readme','prd','changelog'].map(kind=>{
    const declaration=descriptor.documentation.installed[kind],content=`${kind} documentation\n`;
    const bytes=new TextEncoder().encode(content);
    return {moduleId:id,origin,version:descriptor.identity.version,
      sourceRevision:descriptor.identity.source.revision,runtimeIntegrity:lockNode.runtime.integrity,
      kind,visibility:declaration.visibility,path:declaration.path,digest:installedDocumentDigest(bytes),
      byteLength:bytes.byteLength,blockCount:1,content};
  });
  return {current:{composition,lock,descriptors:[descriptor]},inventory:{schemaVersion:1,candidates,
    digest:contractIntegrity({schemaVersion:1,candidates})},currentInstalledDocuments};
}
test('host inventory is captured immutably and tied to deployed composition',()=>{
  const value=witness(),captured=captureHostInventory(value,contractIntegrity(value.current.composition));
  value.current.composition.modules[0].enabled=false;
  assert.equal(captured.current.composition.modules[0].enabled,true);
  assert.ok(Object.isFrozen(captured.inventory.candidates[0].descriptor));
  assert.ok(Object.isFrozen(captured.currentInstalledDocuments[0]));
  assert.equal(captureHostInventory(undefined,'unused'),undefined);
  assert.throws(()=>captureHostInventory(witness(),'sha256-'+ '0'.repeat(64)),{code:'invalid_catalog'});
});
test('host refuses altered, foreign or development documentation',()=>{
  for(const change of [value=>value.currentInstalledDocuments[0].content='tampered',
    value=>value.currentInstalledDocuments[0].runtimeIntegrity='sha256-'+ 'c'.repeat(64),
    value=>value.currentInstalledDocuments[0].kind='agents',
    value=>value.currentInstalledDocuments.push({...value.currentInstalledDocuments[0]})]) {
    const value=witness();change(value);
    assert.throws(()=>captureHostInventory(value,contractIntegrity(value.current.composition)),{code:'invalid_catalog'});
  }
});
test('a selected disabled module keeps its installed documentation in host data',()=>{
  const value=witness(),disabledId='vendor.disabled';
  const descriptor=structuredClone(value.current.descriptors[0]);
  descriptor.identity.id=disabledId;descriptor.identity.origin='https://example.invalid/vendor';
  const source={kind:'workspace',path:'extensions/vendor/disabled'};
  const node=structuredClone(value.current.lock.modules[0]);
  Object.assign(node,{moduleId:disabledId,origin:descriptor.identity.origin,
    contractIntegrity:contractIntegrity(descriptor)});
  value.current.composition.modules.push({moduleId:disabledId,origin:descriptor.identity.origin,
    enabled:false,source});
  value.current.lock.modules.push(node);value.current.descriptors.push(descriptor);
  value.inventory.candidates.push({candidateKey:'disabled',moduleId:disabledId,
    origin:descriptor.identity.origin,version:descriptor.identity.version,source,descriptor,lockNode:node});
  value.inventory.digest=contractIntegrity({schemaVersion:1,candidates:value.inventory.candidates});
  value.currentInstalledDocuments.push(...value.currentInstalledDocuments.map(doc=>({...doc,
    moduleId:disabledId,origin:descriptor.identity.origin})));
  const captured=captureHostInventory(value,contractIntegrity(value.current.composition));
  assert.equal(captured.currentInstalledDocuments.filter(doc=>doc.moduleId===disabledId).length,3);
});
test('host refuses a selected document set above the one MiB aggregate bound',()=>{
  const value=witness();
  for(let index=1;index<6;index++) {
    const nextId=`vendor.module${index}`;
    const descriptor=structuredClone(value.current.descriptors[0]);descriptor.identity.id=nextId;
    const source={kind:'workspace',path:`extensions/vendor/module${index}`};
    const node=structuredClone(value.current.lock.modules[0]);
    Object.assign(node,{moduleId:nextId,contractIntegrity:contractIntegrity(descriptor)});
    value.current.composition.modules.push({moduleId:nextId,origin:descriptor.identity.origin,
      enabled:false,source});
    value.current.lock.modules.push(node);value.current.descriptors.push(descriptor);
    value.inventory.candidates.push({candidateKey:`candidate${index}`,moduleId:nextId,
      origin:descriptor.identity.origin,version:descriptor.identity.version,source,descriptor,lockNode:node});
    value.currentInstalledDocuments.push(...value.currentInstalledDocuments.slice(0,3)
      .map(doc=>({...doc,moduleId:nextId})));
  }
  const content='x'.repeat(64*1024),digest=installedDocumentDigest(new TextEncoder().encode(content));
  for(const document of value.currentInstalledDocuments)
    Object.assign(document,{content,digest,byteLength:64*1024,blockCount:4});
  value.inventory.digest=contractIntegrity({schemaVersion:1,candidates:value.inventory.candidates});
  assert.throws(()=>captureHostInventory(value,contractIntegrity(value.current.composition)),{code:'invalid_catalog'});
});
test('same module ID cannot obtain the host inventory from a third-party origin or source',()=>{
  for(const change of [value=>value.current.composition.modules[0].origin='https://third.invalid',
    value=>value.current.composition.modules[0].source={kind:'package',name:'third-module'},
    value=>value.inventory.digest='sha256-'+ '0'.repeat(64),
    value=>value.current.composition.modules[0].enabled=false]){
    const value=witness();change(value);
    assert.throws(()=>captureHostInventory(value,contractIntegrity(value.current.composition)),{code:'invalid_catalog'});
  }
});
test('current module descriptors are selected by exact lock rather than available version order',()=>{
  const source={kind:'workspace',path:'application/extensions/cart'};
  const node={moduleId:'store.cart',version:'1.1.0',origin:'https://store.example',contractIntegrity:'current',
    runtime:{integrity:'runtime'},validation:{integrity:'validation'}};
  const selected={candidateKey:'selected',moduleId:node.moduleId,version:node.version,origin:node.origin,source,lockNode:node};
  const older={...selected,candidateKey:'older',version:'1.0.0',lockNode:{...node,version:'1.0.0',contractIntegrity:'older'}};
  const composition={modules:[{moduleId:node.moduleId,source}]},lock={modules:[node]};
  assert.deepEqual(currentModuleCandidateKeys(composition,lock,{candidates:[older,selected]}),['selected']);
  assert.throws(()=>currentModuleCandidateKeys(composition,lock,{candidates:[older]}),{code:'inventory.current-candidate'});
  assert.throws(()=>currentModuleCandidateKeys(composition,lock,{candidates:[selected,{...selected}]}),{code:'inventory.current-candidate'});
});
