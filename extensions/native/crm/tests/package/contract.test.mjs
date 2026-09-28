import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '../../../../../sdk/contracts/validate.mjs';
import {manifest,moduleRoot} from '../helpers.mjs';

test('module contract validates and every packaged artifact is a regular file',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const group of ['runtime','validation'])for(const path of manifest.packaging[group].files){
    const stat=lstatSync(new URL(path,moduleRoot));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),path);
  }
});
