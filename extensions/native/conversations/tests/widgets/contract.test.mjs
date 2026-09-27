import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('T16 hosts other modules widgets without declaring its own renderer or inventing an assistant',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.match(read('README.md'),/no_provider/);
  assert.match(read('prd.md'),/fournisseur absent/i);
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  assert.deepEqual(manifest.validation.suites.widgets.tests,
    ['tests/widgets/contract.test.mjs','tests/widgets/host.test.mjs']);
  assert.ok(manifest.packaging.validation.files.includes('tests/widgets/host.test.mjs'));
  assert.match(manifest.lifecycle.absent.widgets.reason,/hosts widgets from other modules/);
});
