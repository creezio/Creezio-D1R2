import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateComposition} from '../../sdk/contracts/validate.mjs';
import {lockFor} from '../contracts/helpers.mjs';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
function composition(withProviders){
  const value=json('../../configuration/composition.json');
  const ids=['creezio.access','creezio.support',...(withProviders?['creezio.crm','creezio.messaging']:[])];
  value.modules=value.modules.filter(item=>ids.includes(item.moduleId));
  for(const audience of ['admin','app'])value.exposure[audience].moduleIds=ids;
  value.front={kind:'workspace'};
  const support=value.modules.find(item=>item.moduleId==='creezio.support');
  support.integrations.forEach(item=>{item.enabled=withProviders;});
  const modules=value.modules.map(item=>json(`../../${item.source.path}/module/manifest.json`));
  // Declaration-only graph proof; archive integrity is checked by the separate package gates.
  return {value,modules,lock:lockFor(value,modules)};
}

test('Support stays usable without optional CRM and Messaging while linked lookups disappear',()=>{
  const {value,modules,lock}=composition(false);
  const result=validateComposition(value,{modules,lock});
  assert.deepEqual(result.errors,[]);
  const support=modules.find(item=>item.identity.id==='creezio.support');
  const inactive=new Set(result.metrics.disabledContributions.filter(item=>item.moduleId==='creezio.support').map(item=>item.path));
  support.contracts.operations.forEach((operation,index)=>{
    assert.equal(inactive.has(`/contracts/operations/${index}`),Boolean(operation.requiresModules?.length),operation.id);
  });
  assert.equal(result.metrics.disabledContributions.some(item=>item.moduleId==='creezio.support'&&item.path.startsWith('/contracts/ui/views/')),false);
  assert.ok(support.contracts.operations.filter(operation=>operation.id.endsWith('.unlink')).every(operation=>!operation.requiresModules));
});

test('explicit optional integrations expose Support links only with the consumed public contracts',()=>{
  const {value,modules,lock}=composition(true);
  const result=validateComposition(value,{modules,lock});
  assert.deepEqual(result.errors,[]);
  assert.equal(result.metrics.disabledContributions.some(item=>item.moduleId==='creezio.support'),false);
  const crm=modules.find(item=>item.identity.id==='creezio.crm');
  crm.contracts.publicContracts=[];
  const refused=validateComposition(value,{modules,lock:lockFor(value,modules)});
  assert.ok(refused.errors.some(error=>error.code==='dependency.contract'||error.code==='ref.private'));
});
