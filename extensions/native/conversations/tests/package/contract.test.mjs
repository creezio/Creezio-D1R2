import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '../../../../../sdk/contracts/validate.mjs';
import {manifest,moduleRoot} from '../helpers.mjs';

test('manifest is valid and every declared artifact exists as a regular file',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation'])for(const name of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(name,moduleRoot));
    assert.ok(stat.isFile()&&!stat.isSymbolicLink(),name);
  }
  assert.ok(manifest.packaging.runtime.files.includes('ui/panel.tsx'));
  assert.ok(manifest.packaging.runtime.files.includes('module/service.ts'));
});
