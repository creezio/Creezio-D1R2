import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileOperationSchemas} from '../../../../../../scripts/operations/schemas.mjs';
import {compileHttpBindings} from '../../../../../../scripts/operations/http-bindings.mjs';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
test('selected GET and PATCH routes compile to their exact native operations and session audience',()=>{
  const composition=json('../../../../../../configuration/composition.workspace-witness.json');
  const lock=json('../../../../../../configuration/composition.workspace-witness.lock.json');
  const modules=[json('../../../../../../extensions/native/access/module/manifest.json'),json('../../module/manifest.json')];
  const operationCatalog=compileOperationSchemas({composition,lock,modules}).catalog;
  const bindings=compileHttpBindings({composition,modules,operationCatalog});
  const own=bindings.filter(binding=>binding.contributorModuleId==='example.workspace-witness');
  assert.deepEqual(own.map(binding=>[binding.id,binding.method,binding.path,binding.operationId,binding.audience]),[
    ['record-read-admin','GET','/api/witness/admin/records/{id}','read_record','admin'],
    ['record-rename-admin','PATCH','/api/witness/admin/records/{id}','rename_record','admin'],
    ['record-read-app','GET','/api/witness/app/records/{id}','read_record','app'],
    ['record-rename-app','PATCH','/api/witness/app/records/{id}','rename_record','app']]);
  assert.ok(own.every(binding=>binding.auth.includes('session')&&binding.parameters[0].codec==='string'));
  assert.equal(new Set(own.map(binding=>`${binding.contributorModuleId}:${binding.id}`)).size,4);
});
