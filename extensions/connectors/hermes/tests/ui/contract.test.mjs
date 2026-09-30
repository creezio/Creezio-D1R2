import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {retainedSessionId,scopeChange,sessionVerified,hermesPanelData,readHermesPanel} from '../../ui/panel-state.ts';
import {createCommandJournal} from '@creezio/sdk/operations/command-journal';

test('session and workspace change purge Hermes data; loading only masks it',()=>{
  const auth=id=>({phase:'authenticated',pending:null,session:{id}});
  const loading={phase:'loading',pending:null,session:null};
  let id=retainedSessionId('',auth('session-a'));
  assert.equal(sessionVerified(auth('session-a'),id),true);
  id=retainedSessionId(id,loading);assert.equal(id,'session-a');
  assert.equal(sessionVerified(loading,id),false);
  const scope={sessionId:id,audience:'admin',contextId:'application',panelId:'panel-a'};
  assert.equal(scopeChange(scope,scope,'loading').purge,false);
  for(const next of [{...scope,sessionId:'session-b'},{...scope,audience:'app'},
    {...scope,contextId:'other'},{...scope,panelId:'other'}])
    assert.equal(scopeChange(scope,next,'authenticated').purge,true);
  assert.equal(retainedSessionId(id,{phase:'anonymous',pending:null,session:null}),'');
});
test('workspace keeps configuration, capability and run status cards without chat or secret persistence',()=>{
  const ui=read('ui/index.tsx');
  for(const text of ['Hermes externe','Connexion','Capacités et modèles','Suivi d’un run Creezio',
    'Clé API','Vérifier la connexion','Révoquer la clé'])assert.ok(ui.includes(text),text);
  assert.match(ui,/type="password"/);
  assert.match(ui,/scopeChange\(/);
  assert.match(ui,/isCurrent:\(\)=>current\(token\)/);
  assert.doesNotMatch(ui,/localStorage|sessionStorage|document\.cookie|\/v1\/chat\/completions/);
  assert.equal(manifest.contracts.ui.views.length,2);
  assert.equal(manifest.contracts.ui.views[0].panel.inactiveEffects,'suspend');
  assert.deepEqual(manifest.contracts.ui.views[1].operations.map(x=>x.id),
    ['run.read','run.refresh','run.prepare','run.submit','run.stop']);
  assert.deepEqual(manifest.contracts.ui.views[1].permissions.map(x=>x.id),['use','connect']);
  assert.match(ui,/if\(administrator\)void invoke\('config.read'/);
  assert.match(ui,/\{administrator&&<div className=\{card\}><h2 className="font-semibold">Connexion/);
  assert.match(ui,/createCommandJournal\(/);
  assert.match(ui,/controller\.execute\(/);
  assert.match(ui,/controller\.inspect\(/);
  assert.match(ui,/Vérifier la dernière commande/);
  assert.match(ui,/disabled=\{busy\|\|!!pending/);
});
test('pending Hermes command survives same verified panel scope without storing a payload',()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application',panelId:'panel-a'};
  const issued={sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    bindingId:'creezio.hermes:admin.run.submit',requestKey:'run-1',intent:'run.submit',targetId:'run-1'};
  const saved=JSON.parse(JSON.stringify(hermesPanelData(scope,'run-1',issued)));
  assert.deepEqual(readHermesPanel(saved,scope),{selectedRunId:'run-1',pending:issued});
  assert.equal(readHermesPanel(saved,{...scope,sessionId:'session-b'}),null);
  assert.equal(readHermesPanel(saved,{...scope,contextId:'other'}),null);
  assert.equal(readHermesPanel({...saved,pending:{...issued,input:'secret'}},scope)?.pending,null);
  assert.equal(readHermesPanel({...saved,pending:{...issued,bindingId:'creezio.other:admin.run.submit'}},scope)?.pending,null);
  assert.equal(readHermesPanel({...saved,pending:{...issued,intent:'config.read',
    bindingId:'creezio.hermes:admin.config.read'}},scope)?.pending,null);
  assert.equal(readHermesPanel({...saved,selectedRunId:'invalid id'},scope),null);
});
test('unknown Hermes submission retains its key and status inspection does not resubmit',async()=>{
  const scope={sessionId:'session-a',audience:'app',contextId:'application'};
  const issued={...scope,bindingId:'creezio.hermes:app.run.submit',requestKey:'run-1',intent:'run.submit',targetId:'run-1'};
  const calls=[];
  const client={audience:'app',invoke:async request=>{calls.push(['invoke',request]);
    return {kind:'unknown',code:'outcome_unknown'};},status:async request=>{calls.push(['status',request]);
      return {kind:'execution',execution:{state:'succeeded',output:{remoteId:'remote-1'}}};}};
  const persisted=[];
  const save=value=>{persisted.push(value);return true;};
  const journal=createCommandJournal(scope);
  const first=await journal.execute(client,issued,{id:'run-1',revision:1},()=>true,save);
  assert.equal(first.pending?.requestKey,'run-1');
  const restored=createCommandJournal(scope,JSON.parse(JSON.stringify(first.pending)));
  const checked=await restored.inspect(client,()=>true,save);
  assert.equal(checked?.pending,null);
  assert.deepEqual(calls.map(([kind])=>kind),['invoke','status']);
  assert.equal(calls[0][1].input.requestKey,calls[1][1].requestKey);
  assert.equal(persisted.at(-1),null);
});
