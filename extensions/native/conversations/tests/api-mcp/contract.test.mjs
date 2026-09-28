import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('every protected operation has separate admin and app bindings',()=>{
  const operations=manifest.contracts.operations;
  assert.deepEqual(operations.map(op=>op.id),[
    'conversation.list','conversation.search','conversation.create','conversation.read',
    'conversation.rename','conversation.archive','conversation.restore','message.list','message.add',
    'widget.message.create','widget.context.replace','widget.context.remove','widget.context.read','widget.render.read',
    'draft.read','draft.save','turn.read','turn.start','event.list','turn.cancel',
    'attachment.link','attachment.list',
  ]);
  for(const op of operations){
    assert.deepEqual(op.audiences,['admin','app']);
    assert.deepEqual(op.permissions.map(ref=>ref.id),['use']);
    const routes=manifest.contracts.api.filter(item=>item.operation.id===op.id);
    assert.deepEqual(routes.map(item=>item.audience).sort(),['admin','app']);
    assert.ok(routes.every(item=>item.path.startsWith(`/api/${item.audience}/conversations/`)
      && item.auth.includes('session')&&item.auth.includes('oauth')));
    if(op.kind==='command')assert.equal(op.idempotency.mode,'required');
  }
  assert.deepEqual(manifest.contracts.mcp.tools.map(tool=>tool.operation.id),operations.map(op=>op.id));
  assert.ok(manifest.contracts.mcp.tools.every(tool=>tool.auth.includes('oauth')
    &&tool.audiences.includes('admin')&&tool.audiences.includes('app')&&tool.textFallback));
});

test('event and file contracts require the same protected module permission',()=>{
  const permission=manifest.contracts.permissions.find(item=>item.id==='use');
  assert.deepEqual(permission.audiences,['admin','app']);
  assert.equal(permission.default,'deny');
  assert.ok(permission.resources.some(item=>item.kind==='file'&&item.id==='attachments'));
  const attach=manifest.contracts.operations.find(item=>item.id==='attachment.link');
  assert.ok(attach.effects.writes.some(item=>item.kind==='file'&&item.id==='attachments'));
  assert.ok(attach.effects.writes.some(item=>item.kind==='model'&&item.id==='conversation_attachment'));
});
