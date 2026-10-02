import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {manifest,moduleRoot} from '../helpers.mjs';

test('runtime and validation inventories are closed and versioned to SDK 1.6',()=>{
  assert.equal(manifest.identity.version,'0.5.0');
  assert.equal(manifest.compatibility.sdk,'^1.6.0');
  const files=[...manifest.packaging.runtime.files,...manifest.packaging.validation.files];
  assert.equal(new Set(files).size,files.length);
  for(const path of files){
    assert.ok(!path.includes('..')&&!path.startsWith('/'));
    assert.ok(readFileSync(new URL(path,moduleRoot)).byteLength>0,path);
  }
  assert.ok(manifest.packaging.runtime.files.includes('ui/state.ts'));
  assert.ok(manifest.packaging.runtime.files.includes('ui/front.tsx'));
  assert.ok(manifest.packaging.runtime.files.includes('plugin/skills/stripe-purchase.md'));
  assert.ok(manifest.packaging.runtime.files.includes('module/projection.ts'));
  assert.ok(!files.some(path=>path.startsWith('core/')||path.startsWith('sdk/')));
});

test('admin and app skills keep separate operation audiences and exact packaged text',()=>{
  const skills=manifest.contracts.mcp.skills;
  assert.deepEqual(skills.map(item=>[item.id,item.audiences]),
    [['stripe',['admin']],['stripe-purchase',['app']]]);
  assert.deepEqual(skills[1].operations.map(item=>item.id),
    ['app.offer.list','app.checkout.create','app.checkout.read']);
  assert.deepEqual(skills[1].resources,['offers-ui','checkout-status-ui']);
  for(const item of skills){
    const text=readFileSync(new URL(item.path,moduleRoot));
    assert.equal(item.integrity,`sha256-${createHash('sha256').update(text).digest('hex')}`);
    assert.ok(manifest.packaging.runtime.files.includes(item.path));
  }
});
