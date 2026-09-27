import test from 'node:test';import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
test('HTTP and MCP bind the same six operations with administrative native authentication',()=>{
  const ids=manifest.contracts.operations.map(op=>op.id);
  assert.equal(ids.length,6);
  assert.deepEqual(manifest.contracts.api.map(binding=>binding.operation.id),ids);
  assert.deepEqual(manifest.contracts.mcp.tools.map(tool=>tool.operation.id),ids);
  assert.ok(manifest.contracts.api.every(binding=>binding.audience==='admin'&&binding.auth.join(',')==='session,oauth'));
  for(const op of manifest.contracts.operations){assert.deepEqual(op.audiences,['admin']);assert.deepEqual(op.actors,['user','delegated-user']);assert.equal(op.context,'application');}
  const tool=manifest.contracts.mcp.tools.find(tool=>tool.id==='plans.accept');
  assert.equal(tool.annotations.readOnly,false);assert.equal(tool.annotations.idempotent,true);
  assert.equal(tool.annotations.openWorld,false);
});
