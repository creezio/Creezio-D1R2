import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {manifest,read} from '../helpers.mjs';
import {panelData,readPanel,retainedSessionId,sessionVerified,scopeChange} from '../../ui/panel-state.ts';
import {externalConfigurationChanged,latestConfig,mergeRuns,reconcileRuns,sameConfiguration} from '../../ui/state.ts';
import {formatStripeAmount} from '../../ui/money.ts';
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
test('original billing cards/tables remain, unavailable numbers and events are explicit',()=>{
  const ui=read('ui/index.tsx');
  for(const label of ['Facturation','Revenu mensuel (MRR)','Abonnements actifs',
    'Factures impayées','Clients &amp; abonnements','Factures','Événements Stripe reçus',
    'Resynchroniser Stripe','SUB_STATUT_LABEL','INVOICE_STATUT_LABEL'])
    assert.ok(ui.includes(label),label);
  assert.ok(ui.includes("import {Badge,Button,Card} from '@creezio/sdk/ui'"));
  assert.match(ui,/subVariant\(/u);assert.match(ui,/invoiceVariant\(/u);
  assert.match(ui,/Calcul non disponible sur ce parcours partiel/u);
  assert.match(ui,/Aucun webhook n’est raccordé/u);
  assert.match(ui,/createCommandJournal/u);
  assert.match(ui,/readPendingCommand/u);
  assert.match(ui,/controller\.inspect/u);
  assert.match(ui,/inFlight\.current=false;return/u);
  assert.match(ui,/setPending\(journal\.current\.pending\)/u);
  assert.doesNotMatch(ui,/fetch\(|localStorage|sessionStorage|stripe\.com\/v1/u);
});
