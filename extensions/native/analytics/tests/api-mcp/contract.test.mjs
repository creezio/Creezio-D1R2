import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('HTTP and MCP preserve operation permissions and machine access',()=>{
  const ops=manifest.contracts.operations;
  assert.deepEqual(ops.map(operation=>operation.id),
    ['event.record','event.list','analytics.snapshot','event.export',
      'analytics.widget.summary','analytics.widget.events','diagnostics.executions','diagnostics.endpoints',
      'collection.policy','collection.effective','collection.configure','refusals.list','refusals.preview','refusals.purge',
      'retention.policy','retention.configure','retention.preview','retention.purge']);
  assert.deepEqual(ops[0].audiences,['admin','app']);
  assert.ok(ops.filter(operation=>!['event.record','collection.effective'].includes(operation.id))
    .every(operation=>operation.audiences.length===1&&
    operation.audiences[0]==='admin'));
  assert.ok(ops.slice(0,8).every(operation=>operation.actors.includes('machine')));
  for(const id of ['collection.configure','refusals.preview','refusals.purge',
    'retention.policy','retention.configure','retention.preview','retention.purge']){
    const operation=ops.find(item=>item.id===id);
    assert.equal(operation.actors.includes('machine'),false,id);
    assert.ok(manifest.contracts.api.filter(api=>api.operation.id===id)
      .every(api=>!api.auth.includes('api-token')),id);
  }
  assert.deepEqual(ops.find(operation=>operation.id==='collection.effective').audiences,['admin','app']);
  assert.equal(ops[0].idempotency.mode,'required');
  for(const operation of ops.slice(6,8)){
    assert.equal(operation.kind,'query');assert.equal(operation.permissions[0].id,'read');
    assert.deepEqual(operation.effects.reads,[],'diagnostics use only the host-scoped port');
    assert.ok(manifest.contracts.api.some(api=>api.operation.id===operation.id&&api.audience==='admin'));
    assert.ok(manifest.contracts.mcp.tools.some(tool=>tool.operation.id===operation.id));
  }
  assert.equal(ops.at(-1).effects.writes[0].id,'event');
  assert.equal(ops.find(operation=>operation.id==='refusals.purge').effects.writes[0].id,'transport_refusal');
  assert.equal(ops.at(-1).idempotency.mode,'required');
  assert.equal(manifest.contracts.mcp.tools.find(tool=>tool.id==='retention.purge').annotations.destructive,true);
});
