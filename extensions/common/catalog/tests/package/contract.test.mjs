import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '@creezio/sdk/contracts/node';
import {manifest,moduleRoot} from '../helpers.mjs';

test('module, widget and file declarations validate with full package inventory',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  assert.equal(manifest.identity.id,'creezio.catalog');
  for(const kind of ['runtime','validation']){
    const files=manifest.packaging[kind].files;
    assert.equal(new Set(files).size,files.length);
    for(const file of files){
      assert.ok(!file.startsWith('/')&&!file.includes('..'));
      assert.ok(lstatSync(new URL(file,moduleRoot)).isFile(),file);
    }
  }
});
