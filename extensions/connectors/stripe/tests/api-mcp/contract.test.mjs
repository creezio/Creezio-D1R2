import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('every Stripe operation has explicit admin API and MCP exposure with machine token access',()=>{
  const operations=manifest.contracts.operations;
  assert.deepEqual(operations.map(row=>row.id),['config.read','config.set','config.key.set',
    'config.key.revoke','config.key.webhook.set','config.key.webhook.revoke',
    'config.key.webhook.service.set','config.key.webhook.service.revoke',
    'connection.check','checkout.payment.create',
    'checkout.subscription.create','checkout.read','subscription.cancel.schedule',
    'event.receive','event.list',
    'sync.state','sync.start','sync.page',
    'customer.list','subscription.list','invoice.list','product.list','price.list']);
  for(const operation of operations){
    assert.deepEqual(operation.audiences,['admin']);
    assert.ok(operation.actors.includes('machine'));
    assert.equal(operation.context,'required');
    assert.equal(operation.audit.required,true);
    const api=manifest.contracts.api.find(row=>row.operation.id===operation.id);
    assert.ok(api);assert.deepEqual(api.auth,operation.id==='event.receive'
      ?['webhook-signature']:['session','oauth','api-token']);
    assert.equal(api.audience,'admin');
    const tool=manifest.contracts.mcp.tools.find(row=>row.operation.id===operation.id);
    if(operation.id==='event.receive')assert.equal(tool,undefined);
    else{assert.ok(tool);assert.deepEqual(tool.auth,['oauth','api-token']);
      assert.deepEqual(tool.audiences,['admin']);}
  }
});
test('GET projections and commands have matching auth, pagination and no arbitrary remote input',()=>{
  const operation=id=>manifest.contracts.operations.find(row=>row.id===id);
  for(const id of ['customer.list','subscription.list','invoice.list','product.list','price.list','event.list']){
    const row=operation(id);assert.equal(row.kind,'query');
    assert.equal(row.pagination.mode,'cursor');assert.equal(row.pagination.maxItems,25);
    assert.deepEqual(row.effects.providers,[]);
  }
  const page=operation('sync.page');
  assert.equal(page.kind,'command');assert.deepEqual(page.effects.providers,['stripe.api.v1']);
  assert.equal(page.idempotency.mode,'required');assert.equal(page.concurrency.mode,'none');
  assert.equal(page.execution.maxItems,32);
  const schema=manifest.contracts.schemas.find(row=>row.id===page.input.schemaId).schema;
  assert.deepEqual(Object.keys(schema.properties).sort(),
    ['collection','cursor','expectedRevision','limit','requestKey','runId'].sort());
  assert.equal(schema.properties.limit.maximum,8);
  assert.ok(!JSON.stringify(manifest.contracts.api).includes('apiKey'));
  for(const id of ['checkout.payment.create','checkout.subscription.create','subscription.cancel.schedule']){
    const row=operation(id);
    assert.equal(row.kind,'command');assert.equal(row.idempotency.mode,'required');
    assert.deepEqual(row.effects.providers,['stripe.api.v1']);
    assert.ok(row.effects.writes.length>0);
  }
  const checkoutRead=manifest.contracts.api.find(row=>row.operation.id==='checkout.read');
  assert.deepEqual(checkoutRead.parameters.map(row=>row.name),['session_id']);
});
