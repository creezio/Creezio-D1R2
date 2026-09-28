import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('text tools remain usable without a support widget renderer',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.equal(manifest.lifecycle.absent.widgets.policyRule,'support.text-tools');
  assert.ok(manifest.contracts.mcp.tools.every(tool=>tool.textFallback&&!tool.widget));
});
