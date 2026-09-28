import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('every native operation has separate admin/app HTTP and MCP bindings',()=>{
  const operations=manifest.contracts.operations;
  assert.equal(operations.length,15);
  for(const op of operations){
    assert.deepEqual(op.audiences,['admin','app']);
    assert.deepEqual(op.actors,['user','delegated-user','machine']);
    assert.deepEqual(op.permissions.map(x=>x.id),['use']);
    const routes=manifest.contracts.api.filter(x=>x.operation.id===op.id);
    assert.deepEqual(routes.map(x=>x.audience).sort(),['admin','app']);
    assert.ok(routes.every(x=>x.path.startsWith(`/api/${x.audience}/messaging/`)
      &&['session','oauth','api-token'].every(auth=>x.auth.includes(auth))));
    if(op.kind==='command')assert.equal(op.idempotency.mode,'required');
  }
  assert.deepEqual(manifest.contracts.mcp.tools.map(x=>x.operation.id),operations.map(x=>x.id));
  assert.ok(manifest.contracts.mcp.tools.every(x=>x.auth.includes('oauth')&&x.auth.includes('api-token')
    &&x.textFallback));
});

test('send is explicitly unavailable and no provider/outbox effect is claimed',()=>{
  const send=manifest.contracts.operations.find(x=>x.id==='message.send');
  assert.deepEqual(send.effects.writes,[]);
  assert.deepEqual(send.effects.providers,[]);
  assert.deepEqual(send.effects.emits,[]);
  assert.ok(send.errors.some(x=>x.code==='unavailable'));
  assert.equal(manifest.contracts.mcp.tools.find(x=>x.id==='message.send').annotations.openWorld,true);
});

test('private attachments and composer skill are protected by module permission',()=>{
  const permission=manifest.contracts.permissions.find(x=>x.id==='use');
  assert.equal(permission.default,'deny');
  assert.ok(permission.resources.some(x=>x.kind==='file'&&x.id==='attachments'));
  assert.ok(manifest.contracts.operations.find(x=>x.id==='attachment.link').effects.writes
    .some(x=>x.kind==='file'&&x.id==='attachments'));
  assert.equal(manifest.contracts.files[0].public,false);
  assert.equal(manifest.contracts.mcp.skills[0].path,'plugin/skills/compose-message.md');
});
