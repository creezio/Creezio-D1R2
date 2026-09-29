import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {createCommandJournal,readPendingCommand} from '@creezio/sdk/operations/command-journal';
import {manifest,read} from '../helpers.mjs';
import {retainedSessionId,scopeChange,sessionVerified,readPanel,panelData,preferFreshConfig,
  configRevisionChanged}
  from '../../ui/panel-state.ts';

test('transient access masks the old scope without dropping pending; real scope change purges it',()=>{
  const authenticated=id=>({phase:'authenticated',pending:null,session:{id}});
  const loading={phase:'loading',pending:null,session:null};
  const unavailable={phase:'unavailable',pending:null,session:null};
  let id=retainedSessionId('',authenticated('session-a'));
  assert.equal(sessionVerified(authenticated('session-a'),id),true);
  id=retainedSessionId(id,loading);assert.equal(id,'session-a');
  assert.equal(sessionVerified(loading,id),false);
  id=retainedSessionId(id,unavailable);assert.equal(id,'session-a');
  const scope={sessionId:id,audience:'admin',contextId:'application',panelId:'panel-a'};
  assert.equal(scopeChange(scope,scope,'loading').purge,false);
  assert.equal(scopeChange(scope,{...scope,sessionId:'session-b'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,panelId:'panel-b'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,contextId:'other'},'authenticated').purge,true);
  assert.equal(scopeChange(scope,{...scope,sessionId:''},'anonymous').purge,true);
});
test('panel state stores only scope and SDK journal pending, never origin or key',()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application',panelId:'panel-a'};
  const pending={sessionId:'session-a',audience:'admin',contextId:'application',
    bindingId:'creezio.meili:admin.config.set',requestKey:'request-a',intent:'config.set'};
  const data=panelData(scope,pending);
  const schema=manifest.contracts.schemas.find(item=>item.id==='meili-panel-state').schema;
  const validate=new Ajv2020({strict:true}).compile(schema);
  assert.equal(validate(data),true,JSON.stringify(validate.errors));
  assert.deepEqual(readPanel(data,scope)?.pending,pending);
  assert.equal(readPanel(data,{...scope,sessionId:'session-b'}),null);
  assert.equal(readPendingCommand(data.pending,{...scope,sessionId:''}),null);
  assert.deepEqual(createCommandJournal(scope,pending).pending,pending);
  assert.deepEqual(Object.keys(data).sort(),['audience','contextId','pending','sessionId']);
  const ui=read('ui/index.tsx');
  assert.match(ui,/createCommandJournal\(/u);
  assert.match(ui,/controller\.inspect\(/u);
  assert.match(ui,/savePanelState\(\{data:panelData\(/u);
  assert.doesNotMatch(ui,/savePanelState\([^)]*apiKey/u);
});
test('SDK journal persists a real pending command with intent before invoke',async()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application',panelId:'panel-a'};
  const schema=manifest.contracts.schemas.find(item=>item.id==='meili-panel-state').schema;
  const validate=new Ajv2020({strict:true}).compile(schema);
  const journal=createCommandJournal(scope);
  let stored=null,invoked=0;
  const command={sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    bindingId:'creezio.meili:admin.config.set',requestKey:'request-b',intent:'config.set'};
  const outcome=await journal.execute({audience:'admin',async invoke(){
    invoked++;assert.ok(stored,'pending must be saved before invoke');
    return {kind:'unknown',code:'synthetic'};
  }},command,{origin:'https://example.invalid',enabled:false,revision:0},()=>true,pending=>{
    const value=panelData(scope,pending);
    assert.equal(validate(value),true,JSON.stringify(validate.errors));
    stored=value;return true;
  });
  assert.equal(invoked,1);
  assert.equal(outcome.pending?.intent,'config.set');
  assert.equal(stored.pending?.intent,'config.set');
  assert.equal(stored.origin,undefined);
  assert.equal(stored.apiKey,undefined);
});
test('a confirmed old mutation clears pending without replacing a fresher read',async()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application',panelId:'panel-a'};
  const command={sessionId:scope.sessionId,audience:scope.audience,contextId:scope.contextId,
    bindingId:'creezio.meili:admin.config.set',requestKey:'request-c',intent:'config.set'};
  let displayed={origin:'https://old.example',enabled:false,hasKey:true,state:'configured',revision:1};
  const journal=createCommandJournal(scope);
  const persisted=[];
  const outcome=await journal.execute({audience:'admin',async invoke(){
    // A config.read from another admin completes while status of the old command is pending.
    displayed=preferFreshConfig(displayed,{origin:'https://new.example',enabled:true,
      hasKey:true,state:'unverified',revision:3});
    return {kind:'unknown',code:'synthetic'};
  }},command,{origin:'https://old.example',enabled:false,revision:1},()=>true,pending=>{
    persisted.push(panelData(scope,pending));return true;
  });
  assert.equal(outcome.pending?.intent,'config.set');
  const status=await journal.inspect({audience:'admin',async status(){
    return {kind:'execution',execution:{state:'succeeded',output:{config:{origin:'https://old.example',
      enabled:false,hasKey:true,state:'configured',revision:2}}}};
  }},()=>true,pending=>{persisted.push(panelData(scope,pending));return true;});
  assert.equal(status.pending,null,'terminal status clears SDK journal');
  const old=status.result.execution.output.config;
  displayed=preferFreshConfig(displayed,old);
  assert.equal(displayed.revision,3);
  assert.equal(displayed.origin,'https://new.example');
  assert.equal(persisted.at(-1).pending,undefined);
});
test('a fresh config read invalidates a prior connection check, same revision does not',()=>{
  const checked={revision:2,enabled:true,hasKey:true};
  const revoked={revision:3,enabled:false,hasKey:false};
  assert.equal(configRevisionChanged(checked,revoked),true);
  assert.equal(configRevisionChanged(revoked,{...revoked}),false);
  assert.equal(configRevisionChanged(null,checked),true);
  const ui=read('ui/index.tsx');
  assert.match(ui,/if\(configRevisionChanged\(configSnapshot\.current,next\)\)\{\s*checkSerial\.current\+\+;setChecking\(false\);setConnection\(null\)/u);
});
test('original settings surface exposes a connection probe while indexing/search remain unavailable',()=>{
  const ui=read('ui/index.tsx');
  for(const label of ['Connexion','Clé API','Vérifier','Réindexer'])
    assert.ok(ui.includes(label),label);
  assert.ok(ui.includes('indexation'));
  assert.ok(!ui.includes('ensureMeiliRuntime'));
  assert.equal(manifest.contracts.ui.views.length,1);
  assert.equal(manifest.contracts.ui.views[0].panel.inactiveEffects,'suspend');
  assert.deepEqual(manifest.contracts.search,[]);
});
