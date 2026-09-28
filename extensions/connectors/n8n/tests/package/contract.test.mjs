import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '@creezio/sdk/contracts/node';
import {manifest,moduleRoot,read} from '../helpers.mjs';

test('n8n source manifest is valid and declares every runtime/validation artifact',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation'])for(const name of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(name,moduleRoot));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),name);
  }
  assert.ok(manifest.packaging.runtime.files.includes('module/storage.ts'));
  assert.ok(manifest.packaging.runtime.files.includes('ui/index.tsx'));
  assert.equal(manifest.compatibility.sdk,'^1.2.0');
  assert.ok(read('module/storage.ts').includes('n8nConnectorDescriptor'));
});
