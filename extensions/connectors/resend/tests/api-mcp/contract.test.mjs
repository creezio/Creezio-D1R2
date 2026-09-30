import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('API and MCP share only admin configuration and bounded domain GET',()=>{
  const operations=manifest.contracts.operations;
  assert.deepEqual(operations.map(op=>op.id),['config.read','config.set','config.key.set',
    'config.key.revoke','domain.list','delivery.readiness']);
  assert.equal(manifest.contracts.mcp.tools.length,operations.length);
  for(const op of operations){
    assert.deepEqual(op.audiences,op.id==='delivery.readiness'?['admin','app']:['admin']);
    assert.equal(op.context,'required');
    assert.ok(op.audit.required);
    assert.deepEqual(manifest.contracts.mcp.tools.find(item=>item.id===op.id).operation,
      {moduleId:'creezio.resend',kind:'operation',id:op.id});
    for(const audience of op.audiences){const http=manifest.contracts.api.find(item=>item.id===`${audience}.${op.id}`);
      assert.ok(http?.auth.includes('api-token'));}
  }
  assert.deepEqual(operations.filter(op=>op.effects.providers.length).map(op=>op.id),['domain.list']);
  assert.ok(operations.every(op=>op.id!=='email.send'&&op.id!=='message.send'));
  assert.deepEqual(manifest.contracts.publicContracts[0].operations,
    [{moduleId:'creezio.resend',kind:'operation',id:'delivery.readiness'}]);
  assert.ok(manifest.contracts.schemas.filter(item=>item.id.endsWith('output'))
    .every(item=>!JSON.stringify(item.schema).includes('apiKey')));
});
