import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {stripeConnectorDescriptor} from '../../module/storage.ts';
import {projectStripePage} from '../../module/projection.ts';
import {configSet,configKeySet,configKeyRevoke,syncStart,syncPage,syncState,connectionCheck,
  checkoutPaymentCreate,checkoutSubscriptionCreate,checkoutRead,subscriptionCancelSchedule} from '../../module/service.ts';

const config={id:'stripe.api.v1',origin:'https://api.stripe.com',key_ref:'secret-reference',
  secret_version:1,connection_id:'connection-a',enabled:true,revision:3,updated_at:'2026-09-29T00:00:00.000Z'};
const run={id:'customers',run_id:'run-a',connection_id:'connection-a',cursor:null,status:'partial',revision:4,
  updated_at:'2026-09-29T00:00:00.000Z'};
const customer=id=>({id,object:'customer',livemode:false,name:'Synthetic',email:'private@example.invalid',
  metadata:{token:'never-project'}});
function harness({configuration=config,state=run,projection={},body={object:'list',data:[],has_more:false}}={}){
  const calls=[],plans=[];
  const context={signal:new AbortController().signal,data:{
    async get(model,{key}){calls.push({get:model,key});return model==='connector_config'?configuration:
      model==='sync_state'||model==='stripe_catalog_sync_state'?state:projection[key.id]??null;},
    planCreate(model,args){calls.push({create:model,args});const plan={plan:plans.length};plans.push(plan);return plan;},
    planPatch(model,args){calls.push({patch:model,args});const plan={plan:plans.length};plans.push(plan);return plan;},
    planGet(model,args){calls.push({guard:model,args});const plan={plan:plans.length};plans.push(plan);return plan;},
  },providerSecrets:{async preparePut(){return {plan:{secret:1},reference:'new-reference',version:1};},
    async prepareReplace(){return {plan:{secret:2},reference:'next-reference',version:2};},
    async prepareRevoke(){return {plan:{secret:3}};}},
  connector:{async request(request){calls.push({request});return {kind:'ok',status:200,body};},
    async mutate(request){calls.push({mutation:request});return {kind:'ok',status:200,body};}}};
  context.executionId='execution-test';
  return {context,calls,plans};
}
test('fixed Stripe outbound contract and admin deny-default permissions',()=>{
  assert.deepEqual(stripeConnectorDescriptor.auth,{kind:'bearer'});
  assert.equal(stripeConnectorDescriptor.fixedOrigin,'https://api.stripe.com');
  assert.deepEqual(stripeConnectorDescriptor.staticHeaders,[{name:'Stripe-Version',value:'2026-08-26.dahlia'}]);
  assert.deepEqual(stripeConnectorDescriptor.resources.map(row=>[row.id,row.method,row.path]),[
    ['customers','GET','/v1/customers'],['subscriptions','GET','/v1/subscriptions'],
    ['invoices','GET','/v1/invoices'],['products','GET','/v1/products'],
    ['prices_active','GET','/v1/prices'],['prices_inactive','GET','/v1/prices'],
    ['checkout_payment_create','POST','/v1/checkout/sessions'],
    ['checkout_subscription_create','POST','/v1/checkout/sessions'],
    ['checkout_session','GET','/v1/checkout/sessions/{id}'],
    ['subscription_schedule_cancel','POST','/v1/subscriptions/{id}']]);
  assert.deepEqual(stripeConnectorDescriptor.resources[1].query.fixed,[{name:'status',value:'all'}]);
  assert.deepEqual(stripeConnectorDescriptor.resources[4].query.fixed,[{name:'active',value:'true'}]);
  assert.deepEqual(stripeConnectorDescriptor.resources[5].query.fixed,[{name:'active',value:'false'}]);
  assert.deepEqual(manifest.contracts.connectors,[stripeConnectorDescriptor]);
  assert.ok(manifest.contracts.permissions.every(row=>row.default==='deny'&&
    JSON.stringify(row.audiences)==='["admin"]'&&row.context==='required'));
  const webhookPermission=manifest.contracts.permissions.find(row=>row.id==='webhook.receive');
  assert.deepEqual(webhookPermission?.actors,['machine']);
  assert.deepEqual(webhookPermission.resources.map(row=>row.id),
    ['connector_config','stripe_event','stripe_checkout']);
  assert.deepEqual(manifest.contracts.operations.find(row=>row.id==='event.receive')
    .permissions.map(row=>row.id),['webhook.receive']);
  assert.deepEqual(manifest.contracts.operations.find(row=>row.id==='event.receive')
    .actors,['machine','signed-webhook']);
  assert.ok(manifest.contracts.operations.find(row=>row.id==='config.key.webhook.service.set')
    .audit.redactFields.includes('serviceToken'));
  assert.equal(manifest.contracts.operations.find(row=>row.id==='sync.page').concurrency.mode,'none');
});
test('product and price projection validates the relation and preserves non-simple money',()=>{
  const product={id:'prod_1',object:'product',name:'Plan test',active:true,livemode:false,
    default_price:'price_1',metadata:{secret:'excluded'}};
  const projected=projectStripePage({object:'list',data:[product],has_more:false},'products',8);
  assert.deepEqual(projected.rows[0].values,{name:'Plan test',active:true,
    default_price_id:'price_1',livemode:false});
  const price={id:'price_1',object:'price',product:'prod_1',active:true,livemode:false,
    currency:'eur',type:'recurring',billing_scheme:'per_unit',unit_amount:1299,
    unit_amount_decimal:'1299',recurring:{interval:'month',interval_count:1,usage_type:'licensed'},
    tiers_mode:null,custom_unit_amount:null,metadata:{secret:'excluded'}};
  const row=projectStripePage({object:'list',data:[price],has_more:false},'prices_active',8).rows[0];
  assert.equal(row.values.product_id,'prod_1');assert.equal(row.values.unit_amount_minor,1299);
  assert.doesNotMatch(JSON.stringify(row),/secret|metadata/u);
  assert.equal(projectStripePage({object:'list',data:[{...price,id:'price_2',unit_amount:null,
    unit_amount_decimal:'1299.125'}],has_more:false},'prices_active',8)
    .rows[0].values.unit_amount_decimal,'1299.125');
  for(const bad of [{...price,product:'cus_1'}, {...price,active:false},
    {...price,recurring:null}, {...price,unit_amount_decimal:'1299.1234567890123'}])
    assert.throws(()=>projectStripePage({object:'list',data:[bad],has_more:false},'prices_active',8),
      {code:'unavailable'});
  assert.throws(()=>projectStripePage({object:'list',data:[product,product],has_more:false},'products',8),
    {code:'unavailable'});
});
test('projection rejects malformed whole pages and never stores raw supplier objects',()=>{
  const page=projectStripePage({object:'list',data:[customer('cus_1')],has_more:true},'customers',8);
  assert.equal(page.nextCursor,'cus_1');assert.equal(page.status,'partial');
  assert.deepEqual(page.rows[0].values,{livemode:false,name:'Synthetic'});
  assert.doesNotMatch(JSON.stringify(page),/private@example|never-project|metadata/u);
  for(const body of [{object:'list',data:[customer('cus_1'),customer('cus_1')],has_more:false},
    {object:'list',data:[],has_more:true},{object:'list',data:[{...customer('cus_1'),object:'invoice'}],has_more:false},
    {object:'list',data:Array.from({length:9},(_,i)=>customer(`cus_${i}`)),has_more:false}])
    assert.throws(()=>projectStripePage(body,'customers',8),{code:'unavailable'});
  const withoutName=customer('cus_2');delete withoutName.name;
  const cleared=projectStripePage({object:'list',data:[withoutName],has_more:false},
    'customers',8);
  assert.equal(cleared.rows[0].values.name,null);
});
test('subscription and invoice fields are bounded, absent money is never fabricated',()=>{
  const subscription=projectStripePage({object:'list',has_more:false,data:[{id:'sub_1',object:'subscription',
    customer:'cus_1',status:'active',livemode:false,items:{data:[],has_more:false},
    metadata:{secret:'hidden'}}]},'subscriptions',8).rows[0].values;
  assert.equal(subscription.unit_amount_minor,null);assert.equal(subscription.currency,null);
  const invoice=projectStripePage({object:'list',has_more:false,data:[{id:'in_1',object:'invoice',
    customer:'cus_1',status:'open',currency:'eur',amount_due:12345,livemode:false,
    lines:{data:[{description:'do-not-copy'}]}}]},'invoices',8).rows[0].values;
  assert.equal(invoice.amount_due_minor,12345);assert.equal(invoice.currency,'EUR');
  assert.doesNotMatch(JSON.stringify(invoice),/do-not-copy|lines/u);
});
test('configuration and key rotation use revision CAS without exposing credentials',async()=>{
  const initial=harness({configuration:null});
  const created=await configSet({requestKey:'a',enabled:false,revision:0},initial.context);
  assert.equal(created.output.config.revision,1);
  assert.equal(initial.calls.find(row=>row.create)?.create,'connector_config');
  await assert.rejects(configSet({requestKey:'b',enabled:false,revision:2},harness().context),{code:'conflict'});
  const changed=harness();
  const keyed=await configKeySet({requestKey:'k',apiKey:'synthetic-secret',revision:3},changed.context);
  assert.equal(keyed.plans.length,2);assert.equal(keyed.output.config.enabled,false);
  assert.equal(changed.calls.find(row=>row.patch).args.compare.expected,3);
  assert.notEqual(changed.calls.find(row=>row.patch).args.values.connection_id,config.connection_id);
  assert.doesNotMatch(JSON.stringify(keyed),/synthetic-secret|new-reference/u);
  const revoked=harness();
  const result=await configKeyRevoke({requestKey:'r',revision:3},revoked.context);
  assert.equal(result.output.config.hasKey,false);
  assert.equal(revoked.calls.find(row=>row.patch).args.values.connection_id,null);
  assert.equal(revoked.calls.find(row=>row.patch).args.compare.expected,3);
});
test('sync start and page create or patch with one run CAS and <=16 total plans',async()=>{
  const first=harness({state:null});
  const started=await syncStart({requestKey:'s',collection:'customers',runId:'run-a',revision:0},first.context);
  assert.equal(started.output.state.revision,1);
  assert.equal(first.calls.find(row=>row.create)?.create,'sync_state');
  assert.deepEqual(first.calls.find(row=>row.guard)?.args.where,
    {connection_id:'connection-a',enabled:true});
  const rows=Array.from({length:8},(_,i)=>customer(`cus_${i}`));
  const pageHarness=harness({body:{object:'list',data:rows,has_more:true}});
  const page=await syncPage({requestKey:'p',collection:'customers',runId:'run-a',cursor:null,
    expectedRevision:4,limit:8},pageHarness.context);
  assert.equal(page.output.processed,8);assert.equal(page.output.state.cursor,'cus_7');
  assert.equal(page.plans.length,10);
  assert.equal(pageHarness.calls.filter(row=>row.request).length,1);
  assert.equal(pageHarness.calls.find(row=>row.patch==='sync_state').args.compare.expected,4);
  assert.equal(pageHarness.calls.filter(row=>row.create==='stripe_customer').length,8);
  assert.ok(pageHarness.calls.filter(row=>row.create==='stripe_customer')
    .every(row=>row.args.values.connection_id==='connection-a'));
  await assert.rejects(syncPage({requestKey:'p2',collection:'customers',runId:'run-a',cursor:null,
    expectedRevision:3,limit:8},harness().context),{code:'conflict'});
  const unchanged=harness({body:{object:'list',data:[],has_more:false}});
  const end=await syncPage({requestKey:'end',collection:'customers',runId:'run-a',cursor:null,
    expectedRevision:4,limit:8},unchanged.context);
  assert.equal(end.output.state.status,'pages_exhausted');
  assert.equal(end.output.processed,0);
  assert.equal(end.plans.length,2);
  await assert.rejects(syncPage({requestKey:'old',collection:'customers',runId:'run-a',cursor:null,
    expectedRevision:4,limit:8},harness({configuration:{...config,connection_id:'connection-b'}}).context),
    {code:'conflict'});
});
test('remote connection check reads only one bounded customer page',async()=>{
  const h=harness();
  assert.deepEqual((await connectionCheck({},h.context)).output,{reachable:true});
  assert.deepEqual(h.calls.find(row=>row.request).request.resource,'customers');
  assert.equal(h.calls.find(row=>row.request).request.limit,1);
});
test('catalog sync reuses the same run engine with an additive state table and one fixed GET',async()=>{
  const first=harness({state:null});
  const started=await syncStart({requestKey:'catalog-start',collection:'prices_inactive',
    runId:'run-price',revision:0},first.context);
  assert.equal(started.output.state.collection,'prices_inactive');
  assert.equal(first.calls.find(row=>row.create)?.create,'stripe_catalog_sync_state');
  const price={id:'price_1',object:'price',product:'prod_1',active:false,livemode:false,
    currency:'eur',type:'one_time',billing_scheme:'tiered',unit_amount:null,unit_amount_decimal:null,
    recurring:null,tiers_mode:'graduated',custom_unit_amount:null};
  const h=harness({state:{...run,id:'prices_inactive',run_id:'run-price'},
    body:{object:'list',data:[price],has_more:false}});
  const page=await syncPage({requestKey:'catalog-page',collection:'prices_inactive',
    runId:'run-price',cursor:null,expectedRevision:4,limit:8},h.context);
  assert.equal(page.output.processed,1);
  assert.equal(h.calls.find(row=>row.request).request.resource,'prices_inactive');
  assert.equal(h.calls.find(row=>row.create)?.create,'stripe_price');
  assert.equal(h.calls.find(row=>row.patch==='stripe_catalog_sync_state')?.args.compare.expected,4);
  const states=await syncState({},h.context);
  assert.equal(states.output.states.length,6);
});
test('Checkout validates a projected fixed test price and uses server-bound return origin',async()=>{
  const configuration={...config,checkout_return_origin:'https://app.example.test'};
  const price={id:'price_test',connection_id:config.connection_id,active:true,livemode:false,
    type:'one_time',billing_scheme:'per_unit',custom_amount:false,usage_type:null,
    unit_amount_minor:1299};
  const body={id:'cs_test_123',object:'checkout.session',livemode:false,mode:'payment',
    status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/c/test',
    client_reference_id:'execution-test',metadata:{secret:'excluded'}};
  const h=harness({configuration,projection:{price_test:price},body});
  const result=await checkoutPaymentCreate({priceId:'price_test',quantity:2},h.context);
  assert.equal(result.output.session.url,'https://checkout.stripe.com/c/test');
  assert.equal(result.plans.length,1);
  const sent=h.calls.find(call=>call.mutation).mutation;
  assert.equal(sent.resource,'checkout_payment_create');
  assert.equal(sent.fields.successUrl,
    'https://app.example.test/?checkout=success&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(sent.fields.clientReferenceId,'execution-test');
  assert.equal(h.calls.find(call=>call.create).create,'stripe_checkout');
  assert.doesNotMatch(JSON.stringify(result),/metadata|excluded/u);
  await assert.rejects(checkoutPaymentCreate({priceId:'price_test',quantity:2},
    harness({configuration,projection:{price_test:{...price,livemode:true}},body}).context),
  {code:'invalid_input'});
  await assert.rejects(checkoutSubscriptionCreate({priceId:'price_test',quantity:2},h.context),
    {code:'invalid_input'});
});
test('Checkout read stays within the saved session and subscription cancel uses CAS',async()=>{
  const session={id:'cs_test_123',connection_id:config.connection_id,mode:'payment'};
  const checkout=harness({projection:{cs_test_123:session},body:{id:'cs_test_123',
    object:'checkout.session',livemode:false,mode:'payment',status:'complete',
    payment_status:'paid',url:null}});
  assert.equal((await checkoutRead({sessionId:'cs_test_123'},checkout.context))
    .output.session.paymentStatus,'paid');
  assert.equal(checkout.calls.find(call=>call.request).request.id,'cs_test_123');
  const subscription={id:'sub_123',connection_id:config.connection_id,livemode:false,
    customer_id:'cus_123',status:'active',revision:3,cancel_at_period_end:false};
  const h=harness({projection:{sub_123:subscription},body:{id:'sub_123',object:'subscription',
    livemode:false,customer:'cus_123',cancel_at_period_end:true}});
  const result=await subscriptionCancelSchedule({subscriptionId:'sub_123',revision:3},h.context);
  assert.equal(result.output.cancelAtPeriodEnd,true);
  assert.equal(h.calls.find(call=>call.mutation).mutation.fields.cancelAtPeriodEnd,true);
  assert.equal(h.calls.find(call=>call.patch).args.compare.expected,3);
  await assert.rejects(subscriptionCancelSchedule({subscriptionId:'sub_123',revision:2},h.context),
    {code:'conflict'});
});
