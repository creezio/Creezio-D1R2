import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('admin editing and authenticated published reads have distinct permissions',()=>{
  const operations=manifest.contracts.operations;
  const published=new Set(['page.published.list','page.published.read','navigation.published']);
  for(const op of operations){
    assert.deepEqual(op.audiences,published.has(op.id)?['admin','app']:['admin']);
    assert.equal(op.permissions[0].id,published.has(op.id)?'view':'edit');
    assert.deepEqual(op.actors,['user','delegated-user','machine']);
    assert.equal(op.public,false);
    assert.equal(op.effects.providers.length,0);
    if(op.kind==='command')assert.equal(op.idempotency.mode,'required');
    const routes=manifest.contracts.api.filter(route=>route.operation.id===op.id);
    assert.equal(routes.length,op.audiences.length);
    assert.ok(routes.every(route=>route.auth.includes('api-token')&&route.auth.includes('session')));
  }
  assert.equal(manifest.contracts.publicContracts.length,0);
});

test('MCP exposes the same protected operations and private media',()=>{
  assert.deepEqual(manifest.contracts.mcp.tools.map(tool=>tool.operation.id),
    manifest.contracts.operations.map(op=>op.id));
  assert.ok(manifest.contracts.mcp.tools.every(tool=>tool.auth.includes('api-token')
    &&tool.auth.includes('oauth')));
  assert.ok(manifest.contracts.permissions.every(permission=>permission.default==='deny'));
  assert.ok(manifest.contracts.permissions.find(permission=>permission.id==='edit').resources
    .some(resource=>resource.kind==='file'&&resource.id==='media'));
  assert.deepEqual(manifest.contracts.files[0].mimeTypes,['image/png','image/jpeg','image/webp']);
});
