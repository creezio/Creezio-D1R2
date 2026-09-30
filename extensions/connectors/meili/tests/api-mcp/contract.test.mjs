import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('HTTP and MCP expose bounded projection operations with app search read only',()=>{
  const ops=manifest.contracts.operations;
  assert.deepEqual(ops.map(op=>op.id),['config.read','config.set','config.key.set',
    'config.key.revoke','connection.check','index.list','index.read','index.rebuild.start',
    'index.sync.start','index.prepare','index.emit','index.reconcile','index.abandon','index.search']);
  assert.equal(manifest.contracts.mcp.tools.length,ops.length);
  for(const op of ops){
    assert.deepEqual(op.audiences,op.id==='index.search'?['admin','app']:['admin']);
    assert.ok(op.actors.includes('machine'));
    assert.equal(op.context,'required');
    const route=manifest.contracts.api.find(item=>item.id==='admin.'+op.id);
    assert.equal(route.path,'/api/admin/meili/'+op.id.replaceAll('.','/'));
    assert.ok(route.auth.includes('api-token'));
    const tool=manifest.contracts.mcp.tools.find(item=>item.id===op.id);
    assert.deepEqual(tool.operation,{moduleId:'creezio.meili',kind:'operation',id:op.id});
    assert.ok(tool.auth.includes('api-token'));
    assert.deepEqual(op.permissions.map(item=>item.id),[op.id==='connection.check'?'read':
      op.id==='index.search'?'search':'manage']);
  }
  const remote=ops.filter(op=>op.effects.providers.length);
  assert.deepEqual(remote.map(op=>op.id),['connection.check','index.list','index.emit',
    'index.reconcile','index.search']);
  assert.ok(remote.every(op=>op.effects.providers[0]==='meili.api.v1'));
  const list=ops.find(op=>op.id==='index.list');
  assert.deepEqual(list.pagination,{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:20});
  assert.equal(list.execution.maxItems,22);
  assert.deepEqual(manifest.contracts.api.find(api=>api.id==='admin.index.list').parameters,
    [{name:'limit',in:'query',inputField:'limit',required:false},
      {name:'cursor',in:'query',inputField:'cursor',required:false}]);
  assert.deepEqual(manifest.contracts.publicContracts[0].operations.map(item=>item.id),
    ['index.rebuild.start','index.emit','index.search']);
  assert.ok(manifest.contracts.api.some(api=>api.id==='app.index.search'));
});
