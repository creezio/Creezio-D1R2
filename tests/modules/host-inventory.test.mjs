import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureHostInventory} from '../../core/operations/host-inventory.ts';
import {contractIntegrity} from '../../sdk/contracts/semantics.mjs';
import {currentModuleCandidateKeys} from '../../scripts/build/compose-runtime.mjs';
const descriptor=JSON.parse(readFileSync(new URL('../../extensions/native/modules-settings/module/manifest.json',import.meta.url),'utf8'));
const id=descriptor.identity.id,origin=descriptor.identity.origin;
function witness(){
  const source={kind:'workspace',path:'extensions/native/modules-settings'};
  const composition={modules:[{moduleId:id,origin,enabled:true,source}]};
  const candidates=[{moduleId:id,origin,version:descriptor.identity.version,source,descriptor}];
  return {current:{composition,lock:{},descriptors:[descriptor]},inventory:{schemaVersion:1,candidates,digest:contractIntegrity({schemaVersion:1,candidates})}};
}
test('host inventory is captured immutably and tied to deployed composition',()=>{
  const value=witness(),captured=captureHostInventory(value,contractIntegrity(value.current.composition));
  value.current.composition.modules[0].enabled=false;
  assert.equal(captured.current.composition.modules[0].enabled,true);
  assert.ok(Object.isFrozen(captured.inventory.candidates[0].descriptor));
  assert.equal(captureHostInventory(undefined,'unused'),undefined);
  assert.throws(()=>captureHostInventory(witness(),'sha256-'+ '0'.repeat(64)),{code:'invalid_catalog'});
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
