import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('HTTP and MCP preserve operation permissions and machine access',()=>{
  const ops=manifest.contracts.operations;
  assert.deepEqual(ops.map(operation=>operation.id),
    ['event.record','event.list','analytics.snapshot','event.export']);
  assert.deepEqual(ops[0].audiences,['admin','app']);
  assert.deepEqual(ops.slice(1).map(operation=>operation.audiences),[['admin'],['admin'],['admin']]);
  assert.ok(ops.every(operation=>operation.actors.includes('machine')));
  assert.ok(manifest.contracts.api.every(api=>api.auth.includes('api-token')));
  assert.ok(manifest.contracts.mcp.tools.every(tool=>tool.auth.includes('api-token')));
  assert.equal(ops[0].idempotency.mode,'required');
});
