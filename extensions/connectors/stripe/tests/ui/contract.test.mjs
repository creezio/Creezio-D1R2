import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {manifest,read} from '../helpers.mjs';
import {panelData,readPanel,retainedSessionId,sessionVerified,scopeChange} from '../../ui/panel-state.ts';
import {externalConfigurationChanged,latestConfig,mergeRuns,reconcileRuns,sameConfiguration,
  subscriptionLifecycleAction} from '../../ui/state.ts';
import {formatStripeAmount,formatStripeFrequency} from '../../ui/money.ts';
import {createCommandJournal,readPendingCommand} from '@creezio/sdk/operations/command-journal';

test('verified identity retains a pending key through temporary loading and purges a true scope change',()=>{
  const authenticated=id=>({phase:'authenticated',pending:null,session:{id}});
  const loading={phase:'loading',pending:null,session:null};
  let id=retainedSessionId('',authenticated('session-a'));
  assert.equal(id,'session-a');assert.equal(sessionVerified(authenticated(id),id),true);
  id=retainedSessionId(id,loading);
  assert.equal(id,'session-a');assert.equal(sessionVerified(loading,id),false);
  const scope={sessionId:id,audience:'admin',contextId:'application',panelId:'stripe-panel'};
  assert.equal(scopeChange(scope,scope,'loading').purge,false);
  assert.equal(scopeChange(scope,{...scope,sessionId:'session-b'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,contextId:'other'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,panelId:'other'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,sessionId:''},'anonymous').purge,true);
});
test('panel persists metadata only and restores under the exact scope',()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application',panelId:'stripe-panel'};
  const pending={sessionId:'session-a',audience:'admin',contextId:'application',
    bindingId:'creezio.stripe:admin.sync.page',requestKey:'one-key',intent:'sync.page'};
  const data=panelData(scope,'invoices',pending);
  const schema=manifest.contracts.schemas.find(row=>row.id==='stripe-panel-state').schema;
  const validate=new Ajv2020({strict:true}).compile(schema);
  assert.equal(validate(data),true,JSON.stringify(validate.errors));
  assert.deepEqual(readPanel(data,scope),data);
  assert.equal(readPanel(data,{...scope,sessionId:'other'}),null);
  assert.equal(readPanel(data,{...scope,contextId:'other'}),null);
  assert.deepEqual(readPendingCommand(data.pending,scope),pending);
  assert.deepEqual(createCommandJournal(scope,pending).pending,pending);
  assert.equal(readPanel(panelData(scope,'prices',null),scope).tab,'prices');
  assert.doesNotMatch(JSON.stringify(data),/apiKey|runId|cursor|amountMinor|secret-reference/u);
});
test('late reads cannot roll back a confirmed configuration or run',()=>{
  const newer={origin:'https://api.stripe.com',enabled:true,hasKey:true,revision:4,state:'unverified'};
  const older={...newer,enabled:false,revision:3};
  assert.deepEqual(latestConfig(newer,older),newer);
  const confirmed={collection:'customers',runId:'run-a',cursor:'cus_8',status:'partial',revision:5,
    updatedAt:'2026-09-29T00:00:00.000Z'};
  const late={...confirmed,cursor:null,revision:4};
  assert.deepEqual(mergeRuns([confirmed],[late]),[confirmed]);
  assert.deepEqual(mergeRuns([], [confirmed]),[confirmed],
    'a command result appears even before initial sync.state succeeds');
  const externallyRotated={...newer,revision:6};
  const masked={...confirmed,runId:null,cursor:null,revision:5};
  assert.equal(externalConfigurationChanged(4,externallyRotated),true);
  assert.deepEqual(reconcileRuns([confirmed],[masked],true),[masked],
    'new configuration adopts the server-masked run instead of the old account');
  assert.deepEqual(reconcileRuns([confirmed],[],true),[],
    'failed state read still hides the old account after rotation');
  assert.equal(sameConfiguration(newer,externallyRotated),false,
    'config N, then old sync.state, then config N+1 must not reinstall the old run');
});
test('subscription lifecycle offers both test-mode directions only from a known eligible projection',()=>{
  const row={id:'sub_test_1',status:'active',livemode:false,cancel_at_period_end:false,revision:7};
  const schedule=subscriptionLifecycleAction(row);
  assert.deepEqual(schedule.input,{subscriptionId:row.id,revision:7,cancelAtPeriodEnd:true});
  assert.equal(schedule.operation,'subscription.cancel.set');
  assert.equal(schedule.label,'Arrêter à l’échéance');
  assert.match(schedule.confirmation,/Programmer l’arrêt/u);
  const retain=subscriptionLifecycleAction({...row,cancel_at_period_end:true,revision:8});
  assert.deepEqual(retain.input,{subscriptionId:row.id,revision:8,cancelAtPeriodEnd:false});
  assert.equal(retain.label,'Maintenir l’abonnement');
  assert.match(retain.confirmation,/Retirer l’arrêt programmé/u);
  for(const status of ['trialing','past_due'])assert.ok(subscriptionLifecycleAction({...row,status}));
  for(const invalid of [{livemode:true},{status:'canceled'},{cancel_at_period_end:null},
    {revision:0},{revision:1.5},{id:''}])assert.equal(subscriptionLifecycleAction({...row,...invalid}),null);
});
test('an uncertain lifecycle command blocks its reverse until status resolves; each direction keeps its own CAS input',async()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application'};
  const controller=createCommandJournal(scope);
  const calls=[];
  const client={audience:'admin',
    async invoke(command){calls.push(command);return calls.length===1?{kind:'unknown',code:'timeout'}:
      {kind:'execution',execution:{state:'succeeded',output:{subscriptionId:'sub_test_1',
        cancelAtPeriodEnd:false,livemode:false}}};},
    async status(){return {kind:'execution',execution:{state:'succeeded',output:{
      subscriptionId:'sub_test_1',cancelAtPeriodEnd:true,livemode:false}}};}};
  let saved=null;
  const persist=value=>{saved=value;return true;};
  const send=(action,key)=>controller.execute(client,{...scope,bindingId:`creezio.stripe:admin.${action.operation}`,
    requestKey:key,intent:action.operation},action.input,()=>true,persist);
  const first=subscriptionLifecycleAction({id:'sub_test_1',status:'active',livemode:false,
    cancel_at_period_end:false,revision:7});
  assert.equal((await send(first,'schedule-key')).result.kind,'unknown');
  assert.equal(saved.requestKey,'schedule-key');
  const reverse=subscriptionLifecycleAction({id:'sub_test_1',status:'active',livemode:false,
    cancel_at_period_end:true,revision:8});
  assert.equal((await send(reverse,'reverse-key')).result.code,'in_progress');
  assert.equal(calls.length,1,'no second supplier command before inspection');
  assert.equal(calls[0].input.cancelAtPeriodEnd,true);
  assert.equal(calls[0].input.revision,7);
  assert.equal(calls[0].input.requestKey,'schedule-key');
  assert.equal((await controller.inspect(client,()=>true,persist)).result.execution.state,'succeeded');
  assert.equal(saved,null);
  assert.equal((await send(reverse,'reverse-key')).result.execution.state,'succeeded');
  assert.equal(calls.length,2);
  assert.equal(calls[1].input.cancelAtPeriodEnd,false);
  assert.equal(calls[1].input.revision,8);
  assert.equal(calls[1].input.requestKey,'reverse-key');
});
test('a pending legacy schedule keeps its original binding and key for inspection without reissuing',async()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application'};
  const legacy={...scope,bindingId:'creezio.stripe:admin.subscription.cancel.schedule',
    requestKey:'legacy-key',intent:'subscription.cancel.schedule'};
  const restored=readPendingCommand(legacy,scope);
  const controller=createCommandJournal(scope,restored);
  let invoked=0,inspected=null,saved=restored;
  const client={audience:'admin',async invoke(){invoked++;throw Error('unexpected mutation');},
    async status(query){inspected=query;return {kind:'execution',execution:{state:'succeeded',
      output:{subscriptionId:'sub_test_1',cancelAtPeriodEnd:true,livemode:false}}};}};
  const result=await controller.inspect(client,()=>true,value=>{saved=value;return true;});
  assert.equal(result.result.execution.state,'succeeded');
  assert.equal(invoked,0);
  assert.equal(inspected.bindingId,legacy.bindingId);
  assert.equal(inspected.requestKey,legacy.requestKey);
  assert.equal(saved,null);
});
test('Stripe charge units render as customer-facing amounts across currency exceptions',()=>{
  assert.match(formatStripeAmount(1299,'EUR'),/12,99\s*€/u);
  assert.match(formatStripeAmount(500,'JPY'),/500/u);
  assert.doesNotMatch(formatStripeAmount(500,'JPY'),/5,00/u);
  assert.match(formatStripeAmount(250,'MGA'),/250/u);
  assert.match(formatStripeAmount(500,'ISK'),/5/u);
  assert.match(formatStripeAmount(500,'UGX'),/5/u);
  assert.match(formatStripeAmount(1045,'HUF'),/10,45/u);
  assert.match(formatStripeAmount(80045,'TWD'),/800,45/u);
  assert.match(formatStripeAmount(Number.MAX_SAFE_INTEGER,'EUR'),/,91\s*€/u,
    'a safe integer must not lose its last cent through floating-point division');
  assert.equal(formatStripeAmount(null,'EUR'),'—');
});
test('Stripe price intervals use French singular and plural without guessing unknown values',()=>{
  for(const [interval,one,many] of [
    ['day','Chaque jour','Tous les 2 jours'],
    ['week','Chaque semaine','Toutes les 2 semaines'],
    ['month','Chaque mois','Tous les 2 mois'],
    ['year','Chaque année','Tous les 2 ans']]){
    assert.equal(formatStripeFrequency('recurring',interval,1),one);
    assert.equal(formatStripeFrequency('recurring',interval,2),many);
  }
  assert.equal(formatStripeFrequency('one_time',null,null),'Paiement unique');
  assert.equal(formatStripeFrequency('recurring','quarter',1),'Périodicité non reconnue');
  assert.equal(formatStripeFrequency('recurring','month',null),'Périodicité non disponible');
});
test('original billing cards/tables remain and signed events are visible',()=>{
  const ui=read('ui/index.tsx');
  for(const label of ['Facturation','Revenu mensuel (MRR)','Abonnements actifs',
    'Factures impayées','Clients &amp; abonnements','Factures','Événements Stripe reçus',
    'Resynchroniser Stripe','SUB_STATUT_LABEL','INVOICE_STATUT_LABEL','Produits','Prix','Suite produits','Suite prix'])
    assert.ok(ui.includes(label),label);
  assert.ok(ui.includes("import {Badge,Button,Card} from '@creezio/sdk/ui'"));
  assert.match(ui,/subVariant\(/u);assert.match(ui,/invoiceVariant\(/u);
  assert.match(ui,/Calcul non disponible sur ce parcours partiel/u);
  assert.match(ui,/Aucun événement signé reçu dans cette connexion/u);
  assert.match(ui,/seul droit creezio\.stripe:webhook\.receive/u);
  assert.doesNotMatch(ui,/droit Stripe manage/u);
  assert.match(ui,/event\.list/u);
  assert.match(ui,/createCommandJournal/u);
  assert.match(ui,/Nom non rapproché/u);
  assert.doesNotMatch(ui,/products\.find\(/u,
    'a price must not inherit a product name from a separately loaded generation');
  assert.match(ui,/readPendingCommand/u);
  assert.match(ui,/controller\.inspect/u);
  assert.match(ui,/window\.confirm\(lifecycle\.confirmation\)/u);
  assert.match(ui,/refreshSubscriptions\(token\)/u);
  assert.match(ui,/pending\.intent==='subscription\.cancel\.set'/u);
  assert.match(ui,/inFlight\.current=false;return/u);
  assert.match(ui,/setPending\(journal\.current\.pending\)/u);
  assert.doesNotMatch(ui,/fetch\(|localStorage|sessionStorage|stripe\.com\/v1/u);
});
