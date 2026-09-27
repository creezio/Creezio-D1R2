import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeRuntime} from '../../scripts/build/compose-runtime.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {temporaryDirectory} from '../quality/temporary.mjs';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const read=relative=>JSON.parse(readFileSync(path.join(repository,relative),'utf8'));
const generated=readFileSync(path.join(repository,'.creezio/generated/provider-catalog.ts'),'utf8');
const catalog=JSON.parse(generated.match(/export const toolCatalog: readonly ProviderOperationSchema\[\] = freeze\((\[[^\n]+\])\);/)?.[1]??'null');

test('provider tool schemas are the exact canonical inputs of selected operations',()=>{
  assert.ok(Array.isArray(catalog)&&catalog.length>0);
  const composition=read('configuration/composition.json');
  const selected=new Set(composition.modules.filter(item=>item.enabled).map(item=>item.moduleId));
  const seen=new Set();
  for(const item of catalog){
    assert.deepEqual(Object.keys(item).sort(),['audiences','inputSchema','moduleId','operationId','schemaDigest']);
    assert.ok(selected.has(item.moduleId));
    const label=`${item.moduleId}:${item.operationId}`;
    assert.equal(seen.has(label),false);seen.add(label);
    const module=composition.modules.find(node=>node.moduleId===item.moduleId);
    assert.deepEqual(item.audiences,['admin','app'].filter(audience=>
      composition.exposure[audience].moduleIds.includes(item.moduleId)));
    const manifest=read(`${module.source.path}/module/manifest.json`);
    const operation=manifest.contracts.operations.find(op=>op.id===item.operationId);
    assert.ok(operation,label);
    const schema=manifest.contracts.schemas.find(entry=>entry.id===operation.input.schemaId)?.schema;
    assert.deepEqual(item.inputSchema,schema,label);
    assert.equal(item.schemaDigest,contractIntegrity(schema),label);
  }
  assert.match(generated,/export const openAiProvider = Object\.freeze\(\{config:/);
  assert.doesNotMatch(generated,/CREEZIO_VAULT_KEYRING|Bearer\s|sk-proj-/);
});

test('composition without OpenAI emits no provider import or host definition',async t=>{
  const root=temporaryDirectory(t,'creezio-provider-compose-');
  mkdirSync(path.join(root,'configuration'));
  writeFileSync(path.join(root,'package.json'),'{"type":"module"}\n');
  const composition=read('configuration/composition.json');
  const lock=read('configuration/composition.lock.json');
  composition.modules=composition.modules.filter(item=>item.moduleId==='creezio.access');
  lock.modules=lock.modules.filter(item=>item.moduleId==='creezio.access');
  for(const exposure of Object.values(composition.exposure))
    exposure.moduleIds=exposure.moduleIds.filter(id=>id==='creezio.access');
  lock.compositionIntegrity=contractIntegrity(composition);
  const access=read('extensions/native/access/module/manifest.json');
  for(const file of access.packaging.runtime.files){
    const relative=path.join('extensions/native/access',file),destination=path.join(root,relative);
    mkdirSync(path.dirname(destination),{recursive:true});
    copyFileSync(path.join(repository,relative),destination);
  }
  writeFileSync(path.join(root,'configuration/composition.json'),JSON.stringify(composition));
  writeFileSync(path.join(root,'configuration/composition.lock.json'),JSON.stringify(lock));
  await composeRuntime({root});
  const source=readFileSync(path.join(root,'.creezio/generated/provider-catalog.ts'),'utf8');
  assert.match(source,/export const openAiProvider = null;/);
  assert.doesNotMatch(source,/extensions\/native\/openai|openAiConfigStorage|createOpenAITransport/);
  assert.doesNotMatch(source,/"moduleId":"creezio\.openai"/);
});
