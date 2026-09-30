import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {createCommandJournal,readPendingCommand} from '@creezio/sdk/operations/command-journal';
import {manifest,read} from '../helpers.mjs';
import {retainedSessionId,scopeChange,sessionVerified,readPanel,panelData} from '../../ui/panel-state.ts';

test('transient access masks configuration; identity changes purge the panel',()=>{
  const authenticated=id=>({phase:'authenticated',pending:null,session:{id}});
  const loading={phase:'loading',pending:null,session:null};
  let id=retainedSessionId('',authenticated('session-a'));
  assert.equal(sessionVerified(authenticated('session-a'),id),true);
  id=retainedSessionId(id,loading);assert.equal(id,'session-a');assert.equal(sessionVerified(loading,id),false);
  const scope={sessionId:id,audience:'admin',contextId:'application',panelId:'panel-a'};
  assert.equal(scopeChange(scope,scope,'loading').purge,false);
  assert.equal(scopeChange(scope,{...scope,sessionId:'session-b'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,contextId:'other'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,sessionId:''},'anonymous').purge,true);
});
test('saved panel retains only scoped pending command, never the API key',()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application',panelId:'panel-a'};
  const pending={sessionId:'session-a',audience:'admin',contextId:'application',
    bindingId:'creezio.resend:admin.config.set',requestKey:'request-a'};
  const data=panelData(scope,pending);
  const schema=manifest.contracts.schemas.find(item=>item.id==='resend-panel-state').schema;
  const validate=new Ajv2020({strict:true}).compile(schema);
  assert.equal(validate(data),true,JSON.stringify(validate.errors));
  assert.deepEqual(readPanel(data,scope).pending,pending);
  assert.equal(readPanel(data,{...scope,sessionId:'session-b'}),null);
  assert.equal(readPendingCommand(data.pending,{...scope,sessionId:''}),null);
  assert.deepEqual(createCommandJournal(scope,pending).pending,pending);
  const ui=read('ui/index.tsx');
  assert.match(ui,/readPendingCommand\(saved\?\.pending/u);
  assert.match(ui,/controller\.inspect\(/u);
  assert.doesNotMatch(ui,/savePanelState\([^)]*apiKey/u);
});
test('workspace configures fixed Resend origin and GET domain metadata only',()=>{
  const ui=read('ui/index.tsx');
  for(const text of ['Expéditeur','Clé API Resend','Révoquer la clé','Domaines',
    'aucun envoi ne part de cet écran'])assert.ok(ui.includes(text),text);
  assert.doesNotMatch(ui,/email\.send|\.mutate\(/u);
  assert.equal(manifest.contracts.ui.views.length,1);
  assert.equal(manifest.contracts.ui.views[0].panel.inactiveEffects,'suspend');
});
