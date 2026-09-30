import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('API and MCP bind exactly the same authorized operations',()=>{
  const ops=manifest.contracts.operations;
  assert.deepEqual(ops.map(x=>x.id),['config.read','config.set','config.key.set','config.key.revoke',
    'capabilities.read','capabilities.capture','models.list','run.read','run.refresh','run.prepare','run.submit','run.stop']);
  assert.equal(manifest.contracts.mcp.tools.length,ops.length);
  for(const op of ops){
    assert.equal(op.context,'required');assert.equal(op.audit.required,true);
    assert.ok(manifest.contracts.mcp.tools.some(x=>x.id===op.id&&x.operation.id===op.id));
    for(const audience of op.audiences){const api=manifest.contracts.api.find(x=>x.id===`${audience}.${op.id}`);
      assert.ok(api);assert.equal(api.operation.id,op.id);assert.ok(api.auth.includes('api-token'));}
  }
  assert.ok(ops.filter(x=>x.id.startsWith('config.')||x.id.startsWith('capabilities.')||x.id==='models.list')
    .every(x=>x.audiences.length===1&&x.audiences[0]==='admin'));
  assert.ok(ops.filter(x=>x.id.startsWith('run.')).every(x=>x.audiences.join(',')==='admin,app'));
});
test('remote reads declare only Hermes provider and no generic outbound URL',()=>{
  const remote=manifest.contracts.operations.filter(x=>x.effects.providers.length);
  assert.deepEqual(remote.map(x=>x.id),['capabilities.read','capabilities.capture','models.list',
    'run.read','run.refresh','run.submit','run.stop']);
  assert.ok(remote.every(x=>x.effects.providers[0]==='hermes.api.v1'));
  assert.deepEqual(manifest.contracts.connectors[0].resources.filter(x=>x.method==='POST').map(x=>x.id),
    ['run-create','run-stop']);
  assert.ok(!JSON.stringify(manifest.contracts.schemas.filter(x=>x.id.endsWith('output'))).includes('apiKey'));
});
test('three read tools render the same MCP Apps resources for chat and GPT hosts',()=>{
  const expected={'capabilities.read':'capabilities','models.list':'models','run.read':'run'};
  for(const [operationId,widgetId] of Object.entries(expected)){
    const tool=manifest.contracts.mcp.tools.find(item=>item.operation.id===operationId);
    const widget=manifest.contracts.widgets.find(item=>item.id===widgetId);
    const resource=manifest.contracts.mcp.resources.find(item=>item.widget?.id===widgetId);
    assert.equal(tool.widget?.id,widgetId);
    assert.equal(widget.resource,resource.id);
    assert.deepEqual(widget.audiences,tool.audiences);
    assert.equal(resource.mimeType,'text/html;profile=mcp-app');
    assert.deepEqual(resource.audiences,tool.audiences);
  }
  assert.ok(manifest.contracts.mcp.tools.filter(item=>item.operation.kind==='operation'
    &&['run.submit','run.stop'].includes(item.operation.id)).every(item=>!item.widget));
});
