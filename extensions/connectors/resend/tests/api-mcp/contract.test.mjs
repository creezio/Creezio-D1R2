import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('API and MCP expose config and bounded GET; signed ingress has its own route',()=>{
  const operations=manifest.contracts.operations;
  assert.deepEqual(operations.map(op=>op.id),['config.read','config.set','config.key.set',
    'config.key.revoke','config.key.webhook.set','config.key.webhook.revoke',
    'config.key.webhook.service.set','config.key.webhook.service.revoke',
    'event.receive','event.status','received.read','domain.list','delivery.readiness']);
  assert.equal(manifest.contracts.mcp.tools.length,operations.length-3);
  for(const op of operations.filter(op=>!['event.receive','event.status','received.read'].includes(op.id))){
    assert.deepEqual(op.audiences,op.id==='delivery.readiness'?['admin','app']:['admin']);
    assert.equal(op.context,'required');
    assert.ok(op.audit.required);
    assert.deepEqual(manifest.contracts.mcp.tools.find(item=>item.id===op.id).operation,
      {moduleId:'creezio.resend',kind:'operation',id:op.id});
    for(const audience of op.audiences){const http=manifest.contracts.api.find(item=>item.id===`${audience}.${op.id}`);
      assert.ok(http?.auth.includes('api-token'));}
  }
  const webhook=manifest.contracts.api.find(item=>item.id==='webhook.event.receive');
  assert.deepEqual(webhook.auth,['webhook-signature']);
  assert.equal(webhook.path,'/api/webhooks/resend');
  assert.equal(manifest.contracts.mcp.tools.some(item=>item.id==='event.receive'),false);
  assert.equal(manifest.contracts.mcp.tools.some(item=>item.id==='event.status'),false);
  assert.deepEqual(operations.filter(op=>op.effects.providers.length).map(op=>op.id),
    ['received.read','domain.list']);
  assert.ok(operations.every(op=>op.id!=='email.send'&&op.id!=='message.send'));
  assert.deepEqual(manifest.contracts.publicContracts[0].operations,
    [{moduleId:'creezio.resend',kind:'operation',id:'delivery.readiness'}]);
  assert.ok(manifest.contracts.schemas.filter(item=>item.id.endsWith('output'))
    .every(item=>!JSON.stringify(item.schema).includes('apiKey')));
});
