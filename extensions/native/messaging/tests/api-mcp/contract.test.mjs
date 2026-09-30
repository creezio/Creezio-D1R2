import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('message lookup exports only authorized read, not storage or transport',()=>{
  const [lookup]=manifest.contracts.publicContracts;
  assert.equal(lookup.id,'message-lookup');
  assert.equal(lookup.version,'1.0.0');
  assert.deepEqual(lookup.models,[]);
  assert.deepEqual(lookup.operations.map(ref=>ref.id),['message.read']);
  assert.equal(manifest.contracts.operations.find(op=>op.id==='message.read').kind,'query');
});

test('every native operation has separate admin/app HTTP and MCP bindings',()=>{
  const operations=manifest.contracts.operations;
  assert.equal(operations.length,19);
  for(const op of operations){
    assert.deepEqual(op.audiences,['admin','app']);
    assert.deepEqual(op.actors,['user','delegated-user','machine']);
    assert.deepEqual(op.permissions.map(x=>x.id),['use']);
    const routes=manifest.contracts.api.filter(x=>x.operation.id===op.id);
    assert.deepEqual(routes.map(x=>x.audience).sort(),op.id==='message.delivery.prepare'?[]:['admin','app']);
    assert.ok(routes.every(x=>x.path.startsWith(`/api/${x.audience}/messaging/`)
      &&['session','oauth','api-token'].every(auth=>x.auth.includes(auth))));
    if(op.kind==='command')assert.equal(op.idempotency.mode,'required');
  }
  assert.deepEqual(manifest.contracts.mcp.tools.map(x=>x.operation.id),
    operations.filter(x=>x.id!=='message.delivery.prepare').map(x=>x.id));
  assert.ok(manifest.contracts.mcp.tools.every(x=>x.auth.includes('oauth')&&x.auth.includes('api-token')
    &&x.textFallback));
});

test('send declares durable snapshot, optional Resend readiness and provider intent',()=>{
  const send=manifest.contracts.operations.find(x=>x.id==='message.send');
  assert.deepEqual(send.effects.writes.map(x=>x.id),['message','draft','send_snapshot']);
  assert.deepEqual(send.effects.providers,['resend.api.v1']);
  assert.deepEqual(send.effects.calls.map(x=>x.id),['delivery.readiness']);
  assert.deepEqual(send.effects.emits,[]);
  assert.ok(send.errors.some(x=>x.code==='unavailable'));
  assert.equal(manifest.contracts.mcp.tools.find(x=>x.id==='message.send').annotations.openWorld,true);
  assert.deepEqual(send.requiresModules,['creezio.resend']);
  assert.equal(manifest.contracts.api.find(x=>x.id==='app.message.send').requiresModules[0],'creezio.resend');
  assert.equal(manifest.contracts.operations.find(x=>x.id==='message.delivery.prepare').public,false);
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
