import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {validateModule} from '@creezio/sdk/contracts/node';
import {manifest,moduleRoot,read} from '../helpers.mjs';

test('hermes source manifest is valid and declares every runtime/validation artifact',()=>{
  assert.deepEqual(validateModule(manifest).errors,[]);
  for(const artifact of ['runtime','validation'])for(const name of manifest.packaging[artifact].files){
    const stat=lstatSync(new URL(name,moduleRoot));assert.ok(stat.isFile()&&!stat.isSymbolicLink(),name);
  }
  assert.ok(manifest.packaging.runtime.files.includes('module/storage.ts'));
  assert.ok(manifest.packaging.runtime.files.includes('ui/index.tsx'));
  for(const name of ['capabilities','models','run'])
    assert.ok(manifest.packaging.runtime.files.includes(`ui/widgets/${name}.html`));
  assert.ok(manifest.packaging.runtime.files.includes('ui/widgets/runtime.ts'));
  assert.ok(manifest.packaging.runtime.files.includes('ui/widgets/model.ts'));
  assert.equal(manifest.compatibility.sdk,'^1.6.0');
  assert.ok(read('module/storage.ts').includes('hermesConnectorDescriptor'));
  const panel=manifest.contracts.schemas.find(item=>item.id==='hermes-panel-state').schema;
  assert.ok(!panel.required.includes('pending'),'existing panel state remains readable');
  assert.deepEqual(panel.properties.pending.anyOf[0].required,
    ['sessionId','audience','contextId','bindingId','requestKey']);
  assert.deepEqual(Object.keys(panel.properties.pending.anyOf[0].properties),
    ['sessionId','audience','contextId','bindingId','requestKey','intent','targetId']);
  assert.equal(panel.properties.pending.anyOf[0].additionalProperties,false);
});
