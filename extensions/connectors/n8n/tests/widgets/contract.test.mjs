import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('remote widgets are explicitly deferred without a false empty success',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.equal(manifest.lifecycle.absent.widgets.policyRule,'n8n.widgets-pending-qualification');
  assert.match(read('TODO.md'),/widgets de données externes/u);
});
