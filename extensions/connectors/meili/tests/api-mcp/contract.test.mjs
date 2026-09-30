import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('HTTP and MCP expose six closed operations, with index metadata restricted to manage',()=>{
  const ops=manifest.contracts.operations;
  assert.deepEqual(ops.map(op=>op.id),['config.read','config.set','config.key.set',
    'config.key.revoke','connection.check','index.list']);
  assert.equal(manifest.contracts.mcp.tools.length,ops.length);
  for(const op of ops){
    assert.deepEqual(op.audiences,['admin']);
    assert.ok(op.actors.includes('machine'));
    assert.equal(op.context,'required');
    const route=manifest.contracts.api.find(item=>item.id==='admin.'+op.id);
    assert.equal(route.path,'/api/admin/meili/'+op.id.replaceAll('.','/'));
    assert.ok(route.auth.includes('api-token'));
    const tool=manifest.contracts.mcp.tools.find(item=>item.id===op.id);
    assert.deepEqual(tool.operation,{moduleId:'creezio.meili',kind:'operation',id:op.id});
    assert.ok(tool.auth.includes('api-token'));
    assert.deepEqual(op.permissions.map(item=>item.id),[op.id==='connection.check'?'read':'manage']);
  }
  const remote=ops.filter(op=>op.effects.providers.length);
  assert.deepEqual(remote.map(op=>op.id),['connection.check','index.list']);
  assert.ok(remote.every(op=>op.effects.providers[0]==='meili.api.v1'&&op.kind==='query'));
  const list=ops.find(op=>op.id==='index.list');
  assert.deepEqual(list.pagination,{mode:'cursor',cursorField:'cursor',limitField:'limit',maxItems:20});
  assert.equal(list.execution.maxItems,22);
  assert.deepEqual(manifest.contracts.api.find(api=>api.id==='admin.index.list').parameters,
    [{name:'limit',in:'query',inputField:'limit',required:false},
      {name:'cursor',in:'query',inputField:'cursor',required:false}]);
  assert.ok(ops.every(op=>!op.id.includes('search')));
});
