import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manifest} from '../helpers.mjs';
import {createCommandJournal} from '@creezio/sdk/operations/command-journal';
import {clearSubmittedReply,putReply,requiresSupportReset,supportPanelBelongsToScope,supportPanelData,supportScopeForAccess} from '../../ui/state.ts';

test('workspace and front retain the original customer/agent pathways',()=>{
  const view=manifest.contracts.ui.views[0];
  assert.equal(view.panel.inactiveEffects,'suspend');
  assert.equal(view.operations.length,10);
  const front=manifest.contracts.ui.views.find(item=>item.id==='front');
  assert.equal(front.route,'/support');
  assert.deepEqual(front.surfaces,['front']);
  assert.deepEqual(front.component,view.component);
  assert.equal(front.panel.inactiveEffects,'suspend');
  assert.equal(front.operations.length,7);
  assert.equal(manifest.contracts.ui.front.mode,'provided');
  assert.equal(manifest.compatibility.sdk,'^1.2.0');
  const panel=manifest.contracts.schemas.find(item=>item.id===view.panel.stateSchema.schemaId).schema;
  assert.deepEqual(panel.required,[]);
  for(const key of ['sessionId','audience','contextId','ticketId'])
    assert.ok(panel.properties[key],`panel state must carry ${key}`);
  assert.deepEqual(panel.properties.pending.required,
    ['sessionId','audience','contextId','bindingId','requestKey']);
  assert.equal(panel.properties.pending.additionalProperties,false);
  assert.ok(manifest.contracts.ui.navigation.some(item=>item.id==='support-front'&&
    item.view.id==='front'&&item.surfaces.includes('front')));
  const source=readFileSync(new URL('../../ui/index.tsx',import.meta.url),'utf8');
  for(const label of ['Tickets support','Ouvrir un ticket','Prendre en charge','Enregistrer la réponse',
    'Afficher la suite du fil','Aucun e-mail externe'])assert.ok(source.includes(label),label);
});

test('an inactive panel retains drafts, while a real session or context change requires a reset',()=>{
  const client={},access={},base={sessionId:'',client,access,audience:'admin',contextId:'application'};
  assert.equal(requiresSupportReset(base,{...base,sessionId:'session-a'}),false,
    'the initial authenticated session may restore the saved ticket');
  const established={...base,sessionId:'session-a'};
  assert.equal(requiresSupportReset(established,{...established}),false,
    'activity changes are not a change of identity');
  for(const changed of [{sessionId:'session-b'},{sessionId:''},{contextId:'other'},
    {audience:'app'}])
    assert.equal(requiresSupportReset(established,{...established,...changed}),true);
  for(const changed of [{client:{}},{access:{}}])
    assert.equal(requiresSupportReset(established,{...established,...changed}),false);
});

test('unresolved visibility refresh retains the draft scope until identity is verified',()=>{
  const verified={sessionId:'session-a',client:{},access:{},audience:'app',contextId:'application'};
  let retained=verified;
  for(const phase of ['loading','unavailable','loading']){
    const next=supportScopeForAccess(retained,{...verified,sessionId:''},phase);
    assert.equal(requiresSupportReset(retained,next),false);
    retained=next;
  }
  assert.equal(requiresSupportReset(retained,supportScopeForAccess(retained,verified,'authenticated')),false);
  assert.equal(requiresSupportReset(retained,supportScopeForAccess(retained,
    {...verified,sessionId:'session-b'},'authenticated')),true);
  assert.equal(requiresSupportReset(retained,supportScopeForAccess(retained,
    {...verified,sessionId:''},'anonymous')),true);
  for(const change of [{contextId:'another'},{audience:'admin'}])
    assert.equal(requiresSupportReset(retained,supportScopeForAccess(retained,
      {...verified,...change,sessionId:''},'loading')),true);
});

test('reply drafts are isolated per ticket and only an unedited version is cleared',()=>{
  let drafts=putReply(new Map(),'ticket-a','Réponse A');
  drafts=putReply(drafts,'ticket-b','Réponse B');
  drafts=putReply(drafts,'ticket-a','Réponse A');
  const unchanged=clearSubmittedReply(drafts,'ticket-a',1,3);
  assert.equal(unchanged.get('ticket-a'),'Réponse A',
    'retyping identical text during the request is still a new draft');
  assert.equal(unchanged.get('ticket-b'),'Réponse B');
  const cleared=clearSubmittedReply(unchanged,'ticket-a',3,3);
  assert.equal(cleared.has('ticket-a'),false);
  assert.equal(cleared.get('ticket-b'),'Réponse B');
});

test('Support panel saves selection with only pending metadata before a mutation and restores it',async()=>{
  const scope={sessionId:'session-a',audience:'admin',contextId:'application'};
  const issued={...scope,bindingId:'creezio.support:admin.message.reply',requestKey:'key-a',
    intent:'message.reply',targetId:'ticket-a'};
  let panel=supportPanelData(scope,'ticket-a',null),writes=0,invocations=0,allowSave=false;
  const persist=value=>{writes++;if(!allowSave)return false;panel=supportPanelData(scope,'ticket-a',value);return true;};
  const client={audience:'admin',async invoke(){invocations++;return {kind:'unknown',code:'outcome_unknown'};},
    async status(){return {kind:'rejected',code:'unavailable',status:503};}};
  let journal=createCommandJournal(scope);
  const refused=await journal.execute(client,issued,{ticketId:'ticket-a',body:'Message privé'},()=>true,persist);
  assert.equal(refused.result.code,'client_state_unavailable');
  assert.equal(invocations,0,'no mutation is sent unless the panel state is durably saved');
  allowSave=true;
  const uncertain=await journal.execute(client,issued,{ticketId:'ticket-a',body:'Message privé'},()=>true,persist);
  assert.equal(uncertain.result.kind,'unknown');
  assert.equal(invocations,1);
  assert.equal(panel.ticketId,'ticket-a');
  assert.equal(supportPanelBelongsToScope(panel,scope),true);
  assert.deepEqual(Object.keys(panel.pending).sort(),Object.keys(issued).sort(),
    'the panel stores identifiers, never subject or message text');
  journal=createCommandJournal(scope,panel.pending);
  assert.equal(journal.pending.requestKey,'key-a');
  const blocked=await journal.execute(client,{...issued,requestKey:'key-b'},{body:'Duplicate'},()=>true,persist);
  assert.equal(blocked.result.code,'in_progress');assert.equal(invocations,1);
  const status=await journal.inspect(client,()=>true,persist);
  assert.equal(status.result.code,'unavailable');
  assert.equal(journal.pending.requestKey,'key-a','status refusal must retain the unresolved command');
  assert.ok(writes>=2);
});

test('terminal status only clears a Support command when panel persistence succeeds',async()=>{
  const scope={sessionId:'session-a',audience:'app',contextId:'application'};
  const issued={...scope,bindingId:'creezio.support:app.ticket.create',requestKey:'key-c',intent:'ticket.create'};
  let panel=supportPanelData(scope,null,issued),saveClear=false;
  const journal=createCommandJournal(scope,panel.pending);
  const client={audience:'app',async status(){return {kind:'execution',execution:{state:'succeeded',output:{item:{id:'ticket-c'}}}};}};
  const persist=value=>{if(!value&&!saveClear)return false;panel=supportPanelData(scope,null,value);return true;};
  const first=await journal.inspect(client,()=>true,persist);
  assert.equal(first.result.execution.state,'succeeded');
  assert.equal(first.result.execution.output.item.id,'ticket-c',
    'status supplies the server-generated ticket ID without adding it to the create input');
  assert.equal(Object.hasOwn(panel.pending,'targetId'),false);
  assert.equal(journal.pending.requestKey,'key-c');
  saveClear=true;await journal.inspect(client,()=>true,persist);
  assert.equal(journal.pending,null);
  assert.deepEqual(panel,{sessionId:'session-a',audience:'app',contextId:'application'});
});

test('saved ticket selection and pending metadata never cross session, audience or context',()=>{
  const scope={sessionId:'session-a',audience:'app',contextId:'application'};
  const pending={...scope,bindingId:'creezio.support:app.ticket.create',requestKey:'key-c',
    intent:'ticket.create',targetId:'ticket-c'};
  const panel=supportPanelData(scope,'ticket-c',pending);
  assert.equal(supportPanelBelongsToScope(panel,scope),true);
  for(const change of [{sessionId:'session-b'},{audience:'admin'},{contextId:'other'}]){
    const foreign={...scope,...change};
    assert.equal(supportPanelBelongsToScope(panel,foreign),false);
    assert.equal(createCommandJournal(foreign,panel.pending).pending,null);
  }
  assert.equal(supportPanelBelongsToScope({ticketId:'ticket-c'},scope),false);
});
