import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '../../../../../sdk/contracts/validate.mjs';
import {manifest,moduleRoot} from '../helpers.mjs';

test('OpenAI module manifest is valid and all declared artifacts exist',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation'])for(const name of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(name,moduleRoot));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),name);
  }
  assert.ok(manifest.packaging.runtime.files.includes('module/transport.ts'));
  assert.ok(manifest.packaging.runtime.files.includes('ui/index.tsx'));
});
