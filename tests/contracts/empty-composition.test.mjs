import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contractIntegrity, validateComposition } from '../../sdk/contracts/validate.mjs';

test('a module-free bootstrap composition still requires its exact lock', () => {
  const composition=JSON.parse(readFileSync(new URL('../../configuration/composition.json',import.meta.url),'utf8'));
  const lock=JSON.parse(readFileSync(new URL('../../configuration/composition.lock.json',import.meta.url),'utf8'));
  composition.modules=[];lock.modules=[];
  composition.exposure.admin.moduleIds=[];composition.exposure.app.moduleIds=[];
  lock.compositionIntegrity=contractIntegrity(composition);
  assert.deepEqual(composition.modules,[]);assert.deepEqual(lock.modules,[]);
  assert.deepEqual(validateComposition(composition,{modules:[],lock}).errors,[]);
  lock.compositionIntegrity='sha256-'+'0'.repeat(64);
  assert.ok(validateComposition(composition,{modules:[],lock}).errors.some(error=>error.code==='lock.integrity'));
});
