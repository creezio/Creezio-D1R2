import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {readFileSync} from 'node:fs';

test('Messaging intentionally has no widget renderer, while its MCP tools remain usable as text',()=>{
  assert.deepEqual(manifest.contracts.widgets,[]);
  assert.equal(manifest.validation.suites.widgets.mode,'not-applicable');
  assert.equal(manifest.validation.suites.widgets.justification.policyRule,'messaging.text-tools-only');
  assert.ok(manifest.contracts.mcp.tools.length>=4);
  assert.ok(manifest.contracts.mcp.tools.every(tool=>tool.textFallback===true));
  const contributions=readFileSync(new URL('../../plugin/contributions.ts',import.meta.url),'utf8');
  assert.match(contributions,/widgets:\[\]/);
});
