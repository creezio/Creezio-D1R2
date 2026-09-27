import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('widget suite is explicitly inapplicable only while widget and MCP Apps lists are empty',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../module/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.deepEqual(manifest.contracts.mcp.resources,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.equal(manifest.validation.suites.widgets.justification.policyRule,'witness.widgets-absent');
});
