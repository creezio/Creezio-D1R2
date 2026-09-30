import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('API and MCP use the same 21 declared operations in both audiences',()=>{
  const c=manifest.contracts;
  assert.equal(c.operations.length,21);
  assert.equal(c.api.length,42);
  assert.equal(c.mcp.tools.length,21);
  for(const op of c.operations){
    assert.ok(c.api.some(binding=>binding.id===`admin.${op.id}`&&binding.operation.id===op.id));
    assert.ok(c.api.some(binding=>binding.id===`app.${op.id}`&&binding.operation.id===op.id));
    assert.ok(c.mcp.tools.some(tool=>tool.operation.id===op.id&&tool.textFallback));
    assert.equal(op.context,'required');
    if(op.kind==='command')assert.equal(op.idempotency.mode,'required');
    if(op.kind==='command')assert.equal(op.concurrency.mode,'none',
      'the module CASes child and parents with their own revisions');
  }
});
test('contact lookup is a scoped public read contract without private model exposure',()=>{
  for(const binding of manifest.contracts.api)assert.ok(!binding.auth.includes('anonymous'));
  const [lookup]=manifest.contracts.publicContracts;
  assert.equal(lookup.id,'contact-lookup');
  assert.equal(lookup.version,'1.0.0');
  assert.deepEqual(lookup.models,[]);
  assert.deepEqual(lookup.operations.map(ref=>ref.id),['contact.search','contact.read']);
  assert.ok(lookup.operations.every(ref=>manifest.contracts.operations.find(op=>op.id===ref.id)?.kind==='query'));
  assert.ok(manifest.contracts.models.every(model=>model.relations.every(link=>link.target.moduleId==='creezio.crm')));
});
test('machine access uses explicit CRM permission and scoped API/MCP bearer tokens',()=>{
  const c=manifest.contracts;
  assert.equal(c.permissions[0].default,'deny');
  assert.ok(c.permissions[0].actors.includes('machine'));
  assert.equal(c.permissions[0].context,'required');
  for(const operation of c.operations){
    assert.ok(operation.actors.includes('machine'),operation.id);
    assert.deepEqual(operation.permissions.map(ref=>ref.id),['use']);
  }
  for(const binding of c.api){
    assert.ok(binding.auth.includes('api-token'),binding.id);
    assert.ok(!binding.auth.includes('anonymous'));
  }
  for(const tool of c.mcp.tools){
    assert.ok(tool.auth.includes('api-token'),tool.name);
    assert.ok(!tool.auth.includes('anonymous'));
  }
});
test('relation commands declare the parent models they CAS-update',()=>{
  const ops=manifest.contracts.operations;
  for(const name of ['create','update','restore']){
    const contact=ops.find(item=>item.id===`contact.${name}`);
    const prospect=ops.find(item=>item.id===`prospect.${name}`);
    assert.ok(contact.effects.writes.some(ref=>ref.id==='company'));
    assert.ok(prospect.effects.writes.some(ref=>ref.id==='company'));
    assert.ok(prospect.effects.writes.some(ref=>ref.id==='contact'));
  }
  const archive=ops.find(item=>item.id==='company.archive');
  assert.ok(archive.effects.reads.some(ref=>ref.id==='contact'));
  assert.ok(archive.effects.reads.some(ref=>ref.id==='prospect'));
});
test('six typed CRM widgets bind only existing read operations',()=>{
  const c=manifest.contracts;
  const tools=new Map(c.mcp.tools.map(tool=>[tool.operation.id,tool]));
  const resources=new Map(c.mcp.resources.map(resource=>[resource.id,resource]));
  assert.equal(c.widgets.length,6);
  assert.equal(resources.size,6);
  for(const entity of ['company','contact','prospect'])for(const kind of ['list','detail']){
    const name=`${entity}-${kind}`,widget=c.widgets.find(item=>item.id===name);
    assert.ok(widget,name);
    assert.equal(widget.input.schemaId,`${entity}-${kind==='list'?'page':'output'}`);
    assert.equal(widget.result.schemaId,widget.input.schemaId);
    assert.deepEqual(widget.audiences,['admin','app']);
    assert.deepEqual(widget.permissions.map(ref=>ref.id),['use']);
    assert.equal(widget.resource,`${name}-ui`);
    const resource=resources.get(widget.resource);
    assert.equal(resource.widget.id,name);
    assert.equal(resource.mimeType,'text/html;profile=mcp-app');
    assert.deepEqual(resource.permissions.map(ref=>ref.id),['use']);
    assert.deepEqual(widget.actions.map(action=>action.id),kind==='list'?['list','search']:['read']);
    for(const action of widget.actions){
      const operationId=`${entity}.${action.id}`,operation=c.operations.find(item=>item.id===operationId);
      assert.equal(operation?.kind,'query');
      assert.equal(action.mode,'direct');
      assert.equal(action.target.operation.id,operationId);
      assert.equal(action.input.schemaId,operation.input.schemaId);
      assert.equal(tools.get(operationId)?.widget?.id,name);
      assert.equal(tools.get(operationId)?.textFallback,true);
    }
  }
  for(const tool of c.mcp.tools.filter(item=>item.operation.id.endsWith('.create')
    ||item.operation.id.endsWith('.update')||item.operation.id.endsWith('.archive')
    ||item.operation.id.endsWith('.restore')))assert.equal(tool.widget,undefined);
});
