import test from 'node:test';import assert from 'node:assert/strict';import {manifest} from '../helpers.mjs';
test('widget absence is explicit while tools remain usable with text fallback',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.ok(manifest.validation.suites.widgets.justification.reason);
  assert.ok(manifest.contracts.mcp.tools.every(tool=>tool.textFallback));
});
