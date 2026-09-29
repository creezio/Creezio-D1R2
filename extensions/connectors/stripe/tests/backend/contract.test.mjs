import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {stripeConnectorDescriptor} from '../../module/storage.ts';
import {projectStripePage} from '../../module/projection.ts';
import {configSet,configKeySet,configKeyRevoke,syncStart,syncPage,connectionCheck} from '../../module/service.ts';

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
      model==='sync_state'?state:projection[key.id]??null;},
    planCreate(model,args){calls.push({create:model,args});const plan={plan:plans.length};plans.push(plan);return plan;},
    planPatch(model,args){calls.push({patch:model,args});const plan={plan:plans.length};plans.push(plan);return plan;},
    planGet(model,args){calls.push({guard:model,args});const plan={plan:plans.length};plans.push(plan);return plan;},
  },providerSecrets:{async preparePut(){return {plan:{secret:1},reference:'new-reference',version:1};},
    async prepareReplace(){return {plan:{secret:2},reference:'next-reference',version:2};},
    async prepareRevoke(){return {plan:{secret:3}};}},
  connector:{async request(request){calls.push({request});return {kind:'ok',status:200,body};}}};
  return {context,calls,plans};
}
test('fixed Stripe GET contract and admin deny-default permissions',()=>{
  assert.deepEqual(stripeConnectorDescriptor.auth,{kind:'bearer'});
  assert.equal(stripeConnectorDescriptor.fixedOrigin,'https://api.stripe.com');
  assert.deepEqual(stripeConnectorDescriptor.staticHeaders,[{name:'Stripe-Version',value:'2026-08-26.dahlia'}]);
  assert.deepEqual(stripeConnectorDescriptor.resources.map(row=>[row.id,row.method,row.path]),[
    ['customers','GET','/v1/customers'],['subscriptions','GET','/v1/subscriptions'],
    ['invoices','GET','/v1/invoices']]);
  assert.deepEqual(stripeConnectorDescriptor.resources[1].query.fixed,[{name:'status',value:'all'}]);
  assert.deepEqual(manifest.contracts.connectors,[stripeConnectorDescriptor]);
  assert.ok(manifest.contracts.permissions.every(row=>row.default==='deny'&&
    JSON.stringify(row.audiences)==='["admin"]'&&row.context==='required'));
  assert.equal(manifest.contracts.operations.find(row=>row.id==='sync.page').concurrency.mode,'none');
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
