import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('every declared operation has exactly its audience API and MCP contract',()=>{
  const operations=manifest.contracts.operations;
  assert.deepEqual(operations.map(row=>row.id),['config.read','config.set','config.key.set',
    'config.key.revoke','config.key.webhook.set','config.key.webhook.revoke',
    'config.key.webhook.service.set','config.key.webhook.service.revoke','event.receive',
    'connection.check','sync.state','sync.start','sync.page','note.list',
    'folder.list','note.detail','note.refresh','transcript.page']);
  for(const operation of operations){
    assert.equal(operation.context,'required');assert.equal(operation.audit.required,true);
    assert.equal(manifest.contracts.mcp.tools.filter(row=>row.operation.id===operation.id).length,
      operation.id==='event.receive'?0:1);
    for(const audience of operation.audiences){
      const route=manifest.contracts.api.find(row=>row.operation.id===operation.id&&row.audience===audience);
      assert.ok(route,`${audience}:${operation.id}`);
      assert.deepEqual(route.auth,operation.id==='event.receive'?['webhook-signature']:
        ['session','oauth','api-token']);
    }
  }
  assert.equal(manifest.contracts.connectors[0].webhook.scheme,'standard');
  assert.equal(manifest.contracts.connectors[0].webhook.operationId,'event.receive');
  assert.equal(manifest.contracts.operations.find(row=>row.id==='sync.page').idempotency.mode,'required');
  assert.deepEqual(manifest.contracts.operations.find(row=>row.id==='transcript.page').audiences,['admin','app']);
  assert.doesNotMatch(JSON.stringify(manifest.contracts.api),/apiKey.*query/u);
});
