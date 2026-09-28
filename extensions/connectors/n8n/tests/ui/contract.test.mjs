import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {createCommandJournal,readPendingCommand} from '@creezio/sdk/operations/command-journal';
import {manifest,read} from '../helpers.mjs';
import {retainedSessionId,scopeChange,sessionVerified,readPanel,panelData} from '../../ui/panel-state.ts';

test('transient access masks n8n without dropping the panel or a pending command',()=>{
  const authenticated=id=>({phase:'authenticated',pending:null,session:{id}});
  const loading={phase:'loading',pending:null,session:null},unavailable={phase:'unavailable',pending:null,session:null};
  let id=retainedSessionId('',authenticated('session-a'));
  assert.equal(sessionVerified(authenticated('session-a'),id),true);
  id=retainedSessionId(id,loading);assert.equal(id,'session-a');assert.equal(sessionVerified(loading,id),false);
  id=retainedSessionId(id,unavailable);assert.equal(id,'session-a');
  const scope={sessionId:id,audience:'admin',contextId:'application',panelId:'panel-a'};
  assert.equal(scopeChange(scope,scope,'loading').purge,false);
  assert.equal(scopeChange(scope,{...scope,sessionId:'session-b'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,panelId:'panel-b'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,contextId:'other'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,sessionId:''},'anonymous').purge,true);
});
test('saved panel carries pending and restores only after verified same scope',()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application',panelId:'panel-a'};
  const pending={sessionId:'session-a',audience:'admin',contextId:'application',
    bindingId:'creezio.n8n:admin.config.set',requestKey:'request-a'};
  const data=panelData(scope,'workflows','cursor-a',null,pending);
  const schema=manifest.contracts.schemas.find(item=>item.id==='n8n-panel-state').schema;
  const validate=new Ajv2020({strict:true}).compile(schema);
  assert.equal(validate(data),true,JSON.stringify(validate.errors));
  assert.deepEqual(readPanel(data,scope).pending,pending);
  assert.equal(readPanel(data,{...scope,sessionId:'session-b'}),null);
  assert.equal(readPendingCommand(data.pending,{...scope,sessionId:''}),null);
  assert.deepEqual(createCommandJournal(scope,pending).pending,pending);
  const ui=read('ui/index.tsx');
  assert.match(ui,/readPendingCommand\(saved\?\.pending/u);
  assert.match(ui,/createCommandJournal\(/u);
  assert.match(ui,/controller\.inspect\(/u);
  assert.equal((ui.match(/savePanelState\(/gu)??[]).length,1);
  assert.match(ui,/data:panelData\(/u);
  assert.doesNotMatch(ui,/savePanelState\([^)]*apiKey/u);
});
test('workspace retains the three original discovery surfaces with explicit external configuration',()=>{
  const ui=read('ui/index.tsx');
  for(const text of ['Connexion','Workflows','Exécutions','URL HTTPS','Clé API n8n',
    'Vérifier la connexion','Révoquer la clé'])assert.ok(ui.includes(text),text);
  assert.ok(!ui.includes('ensureN8nRuntime'));
  assert.match(ui,/invoke\(`\$\{kind\}\.read`,\{id\}/u);
  assert.equal(manifest.contracts.ui.views.length,1);
  assert.equal(manifest.contracts.ui.views[0].panel.inactiveEffects,'suspend');
});
