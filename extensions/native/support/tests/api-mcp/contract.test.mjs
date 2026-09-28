import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('API and MCP use the same ten operations with audience-specific exposure',()=>{
  const c=manifest.contracts;
  assert.equal(c.operations.length,10);
  assert.equal(c.mcp.tools.length,10);
  assert.equal(c.api.length,14);
  for(const op of c.operations){
    for(const audience of op.audiences)assert.ok(c.api.some(binding=>binding.id===`${audience}.${op.id}`));
    assert.ok(c.mcp.tools.some(tool=>tool.operation.id===op.id&&tool.textFallback));
    assert.equal(op.context,'required');
  }
  assert.deepEqual(c.operations.find(op=>op.id==='message.reply').audiences,['admin']);
  assert.deepEqual(c.operations.find(op=>op.id==='message.customer').audiences,['app']);
});
test('distinct rights and machine tokens stay explicit and deny by default',()=>{
  const c=manifest.contracts;
  assert.deepEqual(c.permissions.map(permission=>permission.id),['use','manage']);
  assert.ok(c.permissions.every(permission=>permission.default==='deny'&&permission.actors.includes('machine')));
  for(const id of ['ticket.status','ticket.claim','message.reply'])
    assert.deepEqual(c.operations.find(op=>op.id===id).permissions.map(ref=>ref.id),['use','manage']);
  assert.ok(c.api.every(binding=>binding.auth.includes('api-token')&&!binding.auth.includes('anonymous')));
  assert.ok(c.mcp.tools.every(tool=>tool.auth.includes('api-token')&&!tool.auth.includes('anonymous')));
  assert.deepEqual(c.publicContracts,[]);
});
test('front view declares only customer-visible operations from the same catalog',()=>{
  const c=manifest.contracts;
  const workspace=c.ui.views.find(view=>view.id==='workspace');
  const front=c.ui.views.find(view=>view.id==='front');
  assert.deepEqual(front.permissions,workspace.permissions);
  assert.deepEqual(workspace.operations.map(ref=>ref.id),c.operations.map(op=>op.id));
  assert.deepEqual(front.operations.map(ref=>ref.id),c.operations.filter(op=>op.audiences.includes('app')).map(op=>op.id));
});
