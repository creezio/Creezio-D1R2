import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateModule} from '../../../../../../sdk/contracts/validate.mjs';
import {loadRuntimeComposition} from '../../../../../../scripts/build/compose-runtime.mjs';

test('fixture module and explicit composition validate; declared source files exist without links',()=>{
  const base=new URL('../../',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('module/manifest.json',base)));
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation'])for(const name of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(name,base));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),name);
  }
  const loaded=loadRuntimeComposition({root:fileURLToPath(new URL('../../../../../../',import.meta.url)),
    compositionPath:'configuration/composition.workspace-witness.json'});
  assert.deepEqual(loaded.result.errors,[]);
  assert.equal(loaded.located.length,2);
});
