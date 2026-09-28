import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '@creezio/sdk/contracts/node';
import {manifest,moduleRoot} from '../helpers.mjs';

test('package includes every declared runtime and validation file',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  assert.equal(manifest.identity.id,'creezio.pages-navigation');
  for(const kind of ['runtime','validation']){
    const files=manifest.packaging[kind].files;
    assert.equal(new Set(files).size,files.length);
    for(const file of files){
      assert.ok(!file.startsWith('/')&&!file.includes('..'));
      assert.ok(lstatSync(new URL(file,moduleRoot)).isFile(),file);
    }
  }
  for(const path of ['ui/index.tsx','ui/front-page.tsx','ui/prefabs.tsx','ui/landing.css'])
    assert.ok(manifest.packaging.runtime.files.includes(path));
  for(const suite of ['backend','ui','api-mcp','widgets','package','docs'])
    assert.ok(manifest.packaging.validation.files.includes(`tests/${suite}/contract.test.mjs`));
});
