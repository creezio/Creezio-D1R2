import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('HTTP and MCP preserve operation permissions and machine access',()=>{
  const ops=manifest.contracts.operations;
  assert.deepEqual(ops.map(operation=>operation.id),
    ['event.record','event.list','analytics.snapshot','event.export',
      'analytics.widget.summary','analytics.widget.events']);
  assert.deepEqual(ops[0].audiences,['admin','app']);
  assert.ok(ops.slice(1).every(operation=>operation.audiences.length===1&&
    operation.audiences[0]==='admin'));
  assert.ok(ops.every(operation=>operation.actors.includes('machine')));
  assert.ok(manifest.contracts.api.every(api=>api.auth.includes('api-token')));
  assert.ok(manifest.contracts.mcp.tools.every(tool=>tool.auth.includes('api-token')));
  assert.equal(ops[0].idempotency.mode,'required');
});
