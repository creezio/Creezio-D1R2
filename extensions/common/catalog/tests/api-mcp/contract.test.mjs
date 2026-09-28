import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('all catalog operations have scoped HTTP and MCP surfaces including machine access',()=>{
  const operations=manifest.contracts.operations;
  for(const operation of operations){
    assert.ok(operation.actors.includes('machine'),operation.id);
    for(const audience of operation.audiences){
      const route=manifest.contracts.api.find(route=>route.operation.id===operation.id
        &&route.audience===audience);
      assert.ok(route,operation.id+':'+audience);
      assert.ok(route.auth.includes('api-token'));
      const tool=manifest.contracts.mcp.tools.find(tool=>tool.operation.id===operation.id
        &&tool.audiences.includes(audience));
      assert.ok(tool,operation.id+':'+audience);
      assert.ok(tool.auth.includes('api-token'));
    }
  }
  assert.deepEqual(operations.find(op=>op.id==='product.search').audiences,['admin','app']);
  assert.deepEqual(operations.find(op=>op.id==='product.list').audiences,['admin']);
});
test('public versioned port means authorized operation contract, not anonymous endpoint',()=>{
  const port=manifest.contracts.publicContracts.find(port=>port.id==='catalog.products');
  assert.equal(port.version,'1.0.0');
  assert.deepEqual(port.operations.map(op=>op.id),['product.search','product.get','category.list']);
  assert.ok(manifest.contracts.api.every(route=>!route.auth.includes('anonymous')));
  assert.ok(manifest.contracts.files.every(file=>file.public===false));
});
