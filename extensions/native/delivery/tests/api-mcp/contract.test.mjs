import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../module/manifest.json', import.meta.url), 'utf8'));
test('publication is absent from module operations, HTTP routes and MCP tools', () => {
  assert.deepEqual(manifest.contracts.operations, []);
  assert.deepEqual(manifest.contracts.api, []);
  assert.deepEqual(manifest.contracts.mcp, {tools: [], resources: [], prompts: [], skills: []});
  assert.equal(manifest.validation.suites['api-mcp'].mode, 'not-applicable');
  assert.deepEqual(manifest.contracts.permissions.map(item => [item.id, item.audiences]),
    [['manage', ['admin']]]);
});
