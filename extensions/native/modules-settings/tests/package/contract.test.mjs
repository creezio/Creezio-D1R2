import test from 'node:test';import assert from 'node:assert/strict';import {lstatSync} from 'node:fs';
import {manifest,moduleRoot} from '../helpers.mjs';
import {validateModule} from '../../../../../sdk/contracts/validate.mjs';
test('module artifacts declare all local regular files and separate runtime from validation',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation'])for(const file of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(file,moduleRoot));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),file);
  }
  assert.ok(manifest.packaging.runtime.files.every(file=>!file.startsWith('tests/')&&!file.startsWith('ci/')));
  assert.equal(manifest.packaging.installation,'build-and-publish');
  assert.equal(manifest.packaging.providerInstallation,false);
});
