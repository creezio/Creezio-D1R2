import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('workspace view uses no MCP widget renderer',()=>{
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.ok(manifest.lifecycle.absent.widgets.policyRule);
});
