import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('native API and MCP expose the same bounded authorized operations',()=>{
  const operations=manifest.contracts.operations;
  assert.deepEqual(operations.map(op=>op.id),['config.read','config.set','config.key.set','config.key.revoke',
    'connection.check','workflow.list','workflow.read','execution.list','execution.read']);
  assert.equal(manifest.contracts.mcp.tools.length,operations.length);
  for(const op of operations){
    assert.ok(op.actors.includes('machine'));
    assert.equal(op.context,'required');
    assert.ok(op.audit.required);
    const tool=manifest.contracts.mcp.tools.find(item=>item.id===op.id);
    assert.deepEqual(tool.operation,{moduleId:'creezio.n8n',kind:'operation',id:op.id});
    for(const audience of op.audiences){
      const http=manifest.contracts.api.find(item=>item.id===`${audience}.${op.id}`);
      assert.ok(http);assert.ok(http.auth.includes('api-token'));
      assert.equal(http.audience,audience);
    }
  }
  for(const op of operations.filter(op=>op.id.startsWith('config.')||op.id==='connection.check'))
    assert.deepEqual(op.audiences,['admin']);
  for(const op of operations.filter(op=>op.id.startsWith('workflow.')||op.id.startsWith('execution.')))
    assert.deepEqual(op.audiences,['admin','app']);
});
test('remote operations declare only the exact connector provider, never execute or provider secrets',()=>{
  const remote=manifest.contracts.operations.filter(op=>op.effects.providers.length);
  assert.deepEqual(remote.map(op=>op.id),['connection.check','workflow.list','workflow.read',
    'execution.list','execution.read']);
  assert.ok(remote.every(op=>op.effects.providers[0]==='n8n.api.v1'&&op.kind==='query'));
  assert.ok(manifest.contracts.operations.every(op=>!op.id.includes('execute')&&!op.id.includes('publish')));
  const outputs=manifest.contracts.schemas.filter(item=>item.id.endsWith('output'));
  assert.ok(outputs.every(item=>!JSON.stringify(item.schema).includes('apiKey')));
});
