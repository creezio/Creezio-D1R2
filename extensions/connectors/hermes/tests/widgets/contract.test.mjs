import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('run widgets remain explicitly unavailable until durable submission exists',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.equal(manifest.lifecycle.absent.widgets.policyRule,'hermes.widgets-pending-run-contract');
  assert.match(read('TODO.md'),/Widgets/u);
});
