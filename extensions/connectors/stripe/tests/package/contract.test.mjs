import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manifest,moduleRoot} from '../helpers.mjs';

test('runtime and validation inventories are closed and versioned to SDK 1.4',()=>{
  assert.equal(manifest.identity.version,'0.1.0');
  assert.equal(manifest.compatibility.sdk,'^1.4.0');
  const files=[...manifest.packaging.runtime.files,...manifest.packaging.validation.files];
  assert.equal(new Set(files).size,files.length);
  for(const path of files){
    assert.ok(!path.includes('..')&&!path.startsWith('/'));
    assert.ok(readFileSync(new URL(path,moduleRoot)).byteLength>0,path);
  }
  assert.ok(manifest.packaging.runtime.files.includes('ui/state.ts'));
  assert.ok(manifest.packaging.runtime.files.includes('module/projection.ts'));
  assert.ok(!files.some(path=>path.startsWith('core/')||path.startsWith('sdk/')));
});
