import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

test('widget absence is explicit because this tranche returns no search data',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.equal(manifest.lifecycle.absent.widgets.policyRule,'meili.widgets-pending-qualification');
  assert.match(read('TODO.md'),/Aucun résultat de recherche/u);
});
