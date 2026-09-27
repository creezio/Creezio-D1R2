import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('T14 does not present a simulated assistant or undeclared widget',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.match(read('README.md'),/no_provider/);
  assert.match(read('prd.md'),/fournisseur absent/i);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
});
