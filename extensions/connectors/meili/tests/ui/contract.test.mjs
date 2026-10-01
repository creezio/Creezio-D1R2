import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {createCommandJournal,readPendingCommand} from '@creezio/sdk/operations/command-journal';
import {manifest,read} from '../helpers.mjs';
import {retainedSessionId,scopeChange,sessionVerified,readPanel,panelData,preferFreshConfig,indexPageFrom,
  configRevisionChanged,readConfigThenIndex}
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
test('initial and refreshed index reads wait for their accepted config read',async()=>{
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});
    return {promise,resolve};};
  const first=deferred(),second=deferred(),calls=[];
  let current=true;
  const load=(name,config,selectedSource)=>readConfigThenIndex(async()=>{
    calls.push(`${name}:config`);await config.promise;
    return selectedSource===null?null:{source:selectedSource};
  },async value=>{calls.push(`${name}:index:${value.source}`);},()=>current);
  const initial=load('initial',first,'');
  assert.deepEqual(calls,['initial:config']);
  first.resolve();await initial;
  assert.deepEqual(calls,['initial:config','initial:index:']);
  const old=load('old',second,null);
  const refreshed=load('refresh',{promise:Promise.resolve()},'products');
  await refreshed;
  assert.deepEqual(calls,['initial:config','initial:index:','old:config',
    'refresh:config','refresh:index:products']);
  second.resolve();await old;
  assert.equal(calls.some(item=>item.startsWith('old:index')),false,
    'stale config must not restart index');
  await readConfigThenIndex(async()=>{
    calls.push('failed:config');
    try{await Promise.reject(new Error('configuration refused'));}
    catch{return null;}
  },async()=>{calls.push('failed:index');},()=>current);
  assert.equal(calls.includes('failed:index'),false,
    'a refused config read must not start an index read');
  const revoked=deferred();
  const rotated=load('rotated',revoked,'');
  current=false;revoked.resolve();await rotated;
  assert.equal(calls.some(item=>item.startsWith('rotated:index')),false,
    'scope loss blocks follow-up reads');
});
test('admin surface exposes a resumable projection without persisting provider secrets',()=>{
  const ui=read('ui/index.tsx');
  for(const label of ['Connexion','Clé API','Vérifier','Nouvelle génération Catalogue',
    'Préparer le lot suivant','Émettre le lot préparé','Vérifier la tâche fournisseur'])
    assert.ok(ui.includes(label),label);
  assert.match(ui,/name==='index\.emit'\?prior\.emitKey:crypto\.randomUUID\(\)/u);
  assert.match(ui,/acknowledgeUnknown:true/u);
  assert.ok(!ui.includes('ensureMeiliRuntime'));
  assert.equal(manifest.contracts.ui.views.length,1);
  assert.equal(manifest.contracts.ui.views[0].panel.inactiveEffects,'suspend');
  assert.match(ui,/index\.list/u);
  assert.match(ui,/setIndexPage\(null\)/u);
  assert.match(ui,/Page suivante/u);
});
test('index diagnostic accepts one bounded page and drops extra provider fields',()=>{
  const item={uid:'products',primaryKey:'id',createdAt:'2026-09-29T00:00:00Z',
    updatedAt:'2026-09-30T00:00:00Z',documents:[{secret:'hidden'}]};
  assert.deepEqual(indexPageFrom({items:[item],total:2,nextCursor:'1'}),{items:[{
    uid:'products',primaryKey:'id',createdAt:item.createdAt,updatedAt:item.updatedAt}],
    total:2,nextCursor:'1'});
  assert.equal(indexPageFrom({items:[item],total:2,nextCursor:'01'}),null);
  assert.equal(indexPageFrom({items:Array.from({length:21},()=>item),total:21,nextCursor:null}),null);
  assert.equal(indexPageFrom({items:[{uid:'bad'}],total:1,nextCursor:null}),null);
});
