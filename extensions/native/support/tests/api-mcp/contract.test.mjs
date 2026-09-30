import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('API and MCP use declared operations with audience-specific readonly widget aliases',()=>{
  const c=manifest.contracts;
  assert.equal(c.operations.length,17);
  assert.equal(c.mcp.tools.length,24);
  assert.equal(c.api.length,28);
  for(const op of c.operations){
    for(const audience of op.audiences)assert.ok(c.api.some(binding=>binding.id===`${audience}.${op.id}`));
    assert.ok(c.mcp.tools.some(tool=>tool.operation.id===op.id&&tool.textFallback));
    assert.equal(op.context,'required');
  }
  assert.deepEqual(c.operations.find(op=>op.id==='message.reply').audiences,['admin']);
  assert.deepEqual(c.operations.find(op=>op.id==='message.customer').audiences,['app']);
  const alias=c.mcp.tools.find(tool=>tool.id==='ticket.open.app');
  assert.equal(alias.operation.id,'ticket.read');
  assert.equal(alias.name,'support_ticket_open_app');
  assert.equal(alias.annotations.readOnly,true);
  assert.equal(alias.widget.id,'ticket-list-app');
  assert.deepEqual(alias.audiences,['app']);
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
test('optional CRM and Messaging lookups require explicit versioned selection',()=>{
  const integrations=manifest.dependencies.filter(dep=>dep.optional);
  assert.deepEqual(integrations.map(dep=>dep.moduleId),['creezio.crm','creezio.messaging']);
  assert.deepEqual(integrations.map(dep=>dep.contracts[0].id),['contact-lookup','message-lookup']);
  assert.ok(integrations.every(dep=>dep.contracts[0].versionRange==='^1.0.0'&&
    dep.whenAbsent==='disable-contributions'&&!dep.autoInstall));
  for(const [id,moduleId,target] of [
    ['reference.contact.search','creezio.crm','contact.search'],
    ['reference.contact.read','creezio.crm','contact.read'],
    ['reference.message.read','creezio.messaging','message.read']]){
    const op=manifest.contracts.operations.find(entry=>entry.id===id);
    assert.equal(op.kind,'query');
    assert.deepEqual(op.requiresModules,[moduleId]);
    assert.deepEqual(op.effects.calls,[{moduleId,kind:'operation',id:target}]);
    assert.deepEqual(op.effects.writes,[]);
    assert.ok(manifest.contracts.api.filter(api=>api.operation.id===id)
      .every(api=>api.requiresModules?.[0]===moduleId));
  }
  for(const [id,moduleId,target] of [
    ['reference.contact.link','creezio.crm','contact.read'],
    ['reference.message.link','creezio.messaging','message.read']]){
    const op=manifest.contracts.operations.find(entry=>entry.id===id);
    assert.equal(op.kind,'command');
    assert.deepEqual(op.requiresModules,[moduleId]);
    assert.deepEqual(op.effects.calls,[{moduleId,kind:'operation',id:target}]);
    assert.deepEqual(op.effects.writes.map(ref=>ref.id),['ticket']);
  }
  for(const id of ['reference.contact.unlink','reference.message.unlink']){
    const op=manifest.contracts.operations.find(entry=>entry.id===id);
    assert.equal(op.requiresModules,undefined,'orphaned references can be removed without the provider');
    assert.deepEqual(op.effects.calls,[]);
  }
});
test('front view declares only customer-visible operations from the same catalog',()=>{
  const c=manifest.contracts;
  const workspace=c.ui.views.find(view=>view.id==='workspace');
  const front=c.ui.views.find(view=>view.id==='front');
  assert.deepEqual(front.permissions,workspace.permissions);
  assert.deepEqual(workspace.operations.map(ref=>ref.id),c.operations.filter(op=>!op.requiresModules).map(op=>op.id));
  assert.deepEqual(front.operations.map(ref=>ref.id),c.operations.filter(op=>op.audiences.includes('app')&&!op.requiresModules).map(op=>op.id));
});
