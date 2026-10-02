import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';

test('Stripe admin and app operations have distinct API/MCP audiences and authentication',()=>{
  const operations=manifest.contracts.operations;
  assert.deepEqual(operations.map(row=>row.id),['config.read','config.set','config.key.set',
    'config.key.revoke','config.key.webhook.set','config.key.webhook.revoke',
    'config.key.webhook.service.set','config.key.webhook.service.revoke',
    'connection.check','offer.set','offer.list','app.offer.list','app.checkout.create',
    'app.checkout.read','checkout.payment.create',
    'checkout.subscription.create','checkout.read','subscription.cancel.schedule','subscription.cancel.set',
    'event.receive','event.list',
    'sync.state','sync.start','sync.page',
    'customer.list','subscription.list','invoice.list','product.list','price.list']);
  for(const operation of operations){
    const app=operation.id.startsWith('app.');
    assert.deepEqual(operation.audiences,[app?'app':'admin']);
    assert.equal(operation.actors.includes('machine'),!app);
    assert.equal(operation.context,'required');
    assert.equal(operation.audit.required,true);
    const api=manifest.contracts.api.find(row=>row.operation.id===operation.id);
    assert.ok(api);assert.deepEqual(api.auth,operation.id==='event.receive'
      ?['webhook-signature']:app?['session','oauth']:['session','oauth','api-token']);
    assert.equal(api.audience,app?'app':'admin');
    const tool=manifest.contracts.mcp.tools.find(row=>row.operation.id===operation.id);
    if(operation.id==='event.receive')assert.equal(tool,undefined);
    else{assert.ok(tool);assert.deepEqual(tool.auth,app?['oauth']:['oauth','api-token']);
      assert.deepEqual(tool.audiences,[app?'app':'admin']);}
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
  for(const id of ['checkout.payment.create','checkout.subscription.create',
    'subscription.cancel.schedule','subscription.cancel.set']){
    const row=operation(id);
    assert.equal(row.kind,'command');assert.equal(row.idempotency.mode,'required');
    assert.deepEqual(row.effects.providers,['stripe.api.v1']);
    assert.ok(row.effects.writes.length>0);
  }
  const checkoutRead=manifest.contracts.api.find(row=>row.operation.id==='checkout.read');
  assert.deepEqual(checkoutRead.parameters.map(row=>row.name),['session_id']);
  const cancellation=operation('subscription.cancel.set');
  assert.equal(cancellation.concurrency.mode,'object-version');
  assert.deepEqual(cancellation.permissions.map(row=>row.id),['manage']);
  const input=manifest.contracts.schemas.find(row=>row.id===cancellation.input.schemaId).schema;
  assert.deepEqual([...input.required].sort(),['requestKey','subscriptionId','revision','cancelAtPeriodEnd'].sort());
  assert.deepEqual(input.properties.cancelAtPeriodEnd,{type:'boolean'});
  const output=manifest.contracts.schemas.find(row=>row.id===cancellation.output.schemaId).schema;
  assert.deepEqual(output.properties.cancelAtPeriodEnd,{type:'boolean'});
  const legacy=operation('subscription.cancel.schedule');
  assert.deepEqual(manifest.contracts.schemas.find(row=>row.id===legacy.output.schemaId)
    .schema.properties.cancelAtPeriodEnd,{const:true});
  assert.equal(manifest.contracts.api.find(row=>row.operation.id===cancellation.id).path,
    '/api/admin/stripe/subscription/cancel/set');
  assert.equal(manifest.contracts.mcp.tools.find(row=>row.operation.id===cancellation.id).name,
    'stripe_subscription_cancel_set');
  assert.deepEqual(manifest.contracts.widgets[0].actions.map(row=>row.target.operation.id),['sync.state']);
  for(const [id,path,name] of [
    ['app.offer.list','/api/app/stripe/offer/list','stripe_app_offer_list'],
    ['app.checkout.create','/api/app/stripe/checkout/create','stripe_app_checkout_create'],
    ['app.checkout.read','/api/app/stripe/checkout/read','stripe_app_checkout_read']]){
    assert.equal(manifest.contracts.api.find(row=>row.operation.id===id).path,path);
    assert.equal(manifest.contracts.mcp.tools.find(row=>row.operation.id===id).name,name);
  }
  const appCreate=operation('app.checkout.create');
  assert.deepEqual(appCreate.permissions.map(row=>row.id),['purchase']);
  assert.deepEqual(manifest.contracts.schemas.find(row=>row.id===appCreate.input.schemaId)
    .schema.required,['requestKey','offerId']);
  assert.deepEqual(Object.keys(manifest.contracts.schemas.find(row=>row.id===appCreate.input.schemaId)
    .schema.properties),['requestKey','offerId']);
  assert.equal(appCreate.idempotency.mode,'required');
});
