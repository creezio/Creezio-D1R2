import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCommandJournal} from '@creezio/sdk/operations/command-journal';
import {manifest} from '../helpers.mjs';

async function compiled(relative){
  const source=fileURLToPath(new URL(relative,import.meta.url));
  const result=await build({entryPoints:[source],bundle:true,platform:'node',format:'esm',
    packages:'external',write:false,logLevel:'silent'});
  const temp=fileURLToPath(new URL(`./.ui-contract-${randomUUID()}.mjs`,import.meta.url));
  try{writeFileSync(temp,result.outputFiles[0].text,{flag:'wx'});return await import(pathToFileURL(temp).href);}
  finally{unlinkSync(temp);}
}
const view=await compiled('../../ui/presentation.tsx');
const contracts=await compiled('../../ui/contracts.ts');
const workspace=await compiled('../../ui/index.tsx');
const editor=await compiled('../../ui/rich-editor.tsx');

test('rich editor accepts only parsed HTTP(S) links',()=>{
  assert.equal(editor.safeHttpUrl('https://example.test/path'),'https://example.test/path');
  for(const value of ['javascript:alert(1)','data:text/html,x','https://','https://example.test\njavascript:alert(1)'])
    assert.equal(editor.safeHttpUrl(value),null,value);
});

test('linking or removing an attachment advances revision without erasing unsaved composition',()=>{
  const editor={id:'draft-one',revision:2,to:'a@example.test',cc:'',bcc:'',subject:'Unsaved subject',
    text:'Unsaved body',html:'<p>Unsaved body</p>'};
  const linked=contracts.attachmentRevision(editor,{id:'draft-one',revision:3});
  assert.equal(linked.revision,3);
  assert.equal(linked.subject,editor.subject);
  assert.equal(linked.html,editor.html);
  assert.strictEqual(contracts.attachmentRevision(linked,{id:'other-draft',revision:4}),linked);
  assert.strictEqual(contracts.attachmentRevision(linked,{id:'draft-one',revision:2}),linked);
});

test('the first authenticated render hides panel data until its session scope is hydrated',()=>{
  const snapshot={phase:'authenticated',pending:false,session:{id:'session-new',principalId:'owner'}};
  const access={subscribe:()=>()=>{},getSnapshot:()=>snapshot};
  const props={active:true,authorized:true,audience:'admin',contextId:'application',panelId:'messaging',
    access,client:{audience:'admin'},navigation:{readPanelState:()=>({activeSubview:'drafts',
      data:{sessionId:'session-old',audience:'admin',contextId:'application',boxId:'box-old'}})}};
  const html=renderToStaticMarkup(React.createElement(workspace.MessagingView,props));
  assert.match(html,/Chargement de la messagerie/);
  assert.doesNotMatch(html,/Boîte de réception|Brouillons|box-old/);
});

test('original folder structure and explicit unavailable transport remain visible',()=>{
  const html=renderToStaticMarkup(React.createElement(view.FoldersPanel,{boxes:[],boxId:'',folder:'inbox',
    unread:0,onBox:()=>{},onFolder:()=>{},onCompose:()=>{}}));
  for(const label of ['Boîte de réception','Envoyés','Brouillons','File d’attente','Archives','Corbeille','Nouveau message'])
    assert.ok(html.includes(label),label);
  assert.match(html,/envoi et réception indisponibles/);
});

test('message reader isolates incoming HTML in a strict sandbox',()=>{
  const message={id:'m1',boxId:'b1',direction:'inbound',from:'a@example.test',to:'b@example.test',cc:'',
    subject:'Sujet',text:'Texte',html:'<p>Corps</p>',state:'inbound',folder:'inbox',read:false,
    threadId:null,replyTo:null,inReplyTo:null,receivedAt:'2026-09-28T10:00:00.000Z',sentAt:null,revision:1};
  const html=renderToStaticMarkup(React.createElement(view.ReaderPanel,{message,draft:null,thread:[],
    threadHasMore:false,threadLoading:false,onThreadMore:()=>{},attachments:[],loading:false,busy:false,onReply:()=>{},onEdit:()=>{},onDownload:()=>{},
    onUpdate:()=>{},onDeleteDraft:()=>{},onThreadSelect:()=>{}}));
  assert.match(html,/<iframe[^>]*sandbox="allow-popups"/);
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/default-src &#x27;none&#x27;/);
  assert.doesNotMatch(html,/allow-scripts|allow-same-origin|dangerouslySetInnerHTML/);
  assert.match(html,/Marquer lu/);
  assert.match(html,/Archiver/);
  assert.match(html,/Corbeille/);
  const trash=renderToStaticMarkup(React.createElement(view.ReaderPanel,{message:{...message,folder:'trash'},
    draft:null,thread:[],threadHasMore:false,threadLoading:false,onThreadMore:()=>{},attachments:[],
    loading:false,busy:false,onReply:()=>{},onEdit:()=>{},onDownload:()=>{},onUpdate:()=>{},
    onDeleteDraft:()=>{},onDeleteMessage:()=>{},onThreadSelect:()=>{}}));
  assert.match(trash,/Supprimer définitivement/);
  const sent=renderToStaticMarkup(React.createElement(view.ReaderPanel,{message:{...message,
    direction:'outbound',folder:'trash'},draft:null,thread:[],threadHasMore:false,threadLoading:false,
    onThreadMore:()=>{},attachments:[],loading:false,busy:false,onReply:()=>{},onEdit:()=>{},
    onDownload:()=>{},onUpdate:()=>{},onDeleteDraft:()=>{},onDeleteMessage:()=>{},onThreadSelect:()=>{}}));
  assert.match(sent,/Historique d’envoi et accusés conservés/);
  assert.match(sent,/disabled=""[^>]*>.*Supprimer définitivement/s);
});

test('long threads and searched lists expose their continuation instead of appearing complete',()=>{
  const message={id:'m1',boxId:'b1',direction:'inbound',from:'a@example.test',to:'b@example.test',cc:'',
    subject:'Sujet',text:'Texte',html:'',state:'inbound',folder:'inbox',read:true,threadId:'t1',
    replyTo:null,inReplyTo:null,receivedAt:'2026-09-28T10:00:00.000Z',sentAt:null,revision:1};
  const reader=renderToStaticMarkup(React.createElement(view.ReaderPanel,{message,draft:null,thread:[message],
    threadHasMore:true,threadLoading:false,onThreadMore:()=>{},onThreadSelect:()=>{},attachments:[],
    loading:false,busy:false,onReply:()=>{},onEdit:()=>{},onDownload:()=>{},onUpdate:()=>{},onDeleteDraft:()=>{}}));
  assert.match(reader,/Afficher la suite du fil/);
  const list=renderToStaticMarkup(React.createElement(view.ListPanel,{folder:'inbox',messages:[],drafts:[],
    selectedId:null,query:'test',onQuery:()=>{},unreadOnly:false,onUnreadOnly:()=>{},onSelect:()=>{},
    onRefresh:()=>{},loading:false,hasMore:true,onMore:()=>{}}));
  assert.match(list,/Recherche partielle/);
  assert.match(list,/Afficher plus de résultats/);
});

test('uncertain mutation is surfaced once for reconciliation, without a UI bridge replay',async()=>{
  let count=0;const scope={audience:'admin',contextId:'workspace',client:{invoke:async()=>{
    count++;return {kind:'unknown',code:'outcome_unknown'};}}};
  const result=await contracts.call(scope,'draft.save',{requestKey:'one'},()=>true);
  assert.deepEqual(result,{kind:'unknown',code:'outcome_unknown'});
  assert.equal(count,1);
});

test('panel restore survives first mount, while a real identity or context change purges it',()=>{
  const client={},access={};
  const initial={sessionId:'s1',contextId:'c1',audience:'admin',client,access};
  assert.equal(contracts.scopeChanged(null,initial),false);
  assert.equal(contracts.scopeChanged(initial,{...initial}),false);
  assert.equal(contracts.scopeChanged(initial,{...initial,sessionId:'s2'}),true);
  assert.equal(contracts.scopeChanged(initial,{...initial,contextId:'c2'}),true);
  assert.equal(contracts.scopeChanged(initial,{...initial,audience:'app'}),true);
  assert.equal(contracts.scopeChanged(initial,{...initial,client:{}}),false);
  assert.equal(contracts.scopeChanged(initial,{...initial,sessionId:'',phase:'loading'}),false,
    'a transient access refresh does not purge the current command');
  assert.equal(contracts.scopeChanged(initial,{...initial,sessionId:'',phase:'unavailable'}),false,
    'a temporarily unavailable session keeps local search and box-form input');
  assert.equal(contracts.scopeChanged(initial,{...initial,sessionId:'s2',phase:'authenticated'}),true,
    'a different authenticated session purges local search and box-form input');
  assert.equal(contracts.scopeChanged(initial,{...initial,sessionId:'',phase:'anonymous'}),true,
    'a completed logout does purge the command');
  assert.equal(contracts.scopeChanged({...initial,sessionId:''},initial),false,
    'hydrating the initial anonymous mount must preserve the saved panel');
  const owned={sessionId:'s1',audience:'admin',contextId:'c1'};
  const saved=contracts.messagingPanelData(owned,'box-a','draft-a',null);
  assert.equal(contracts.panelMatchesScope(saved,owned),true);
  assert.equal(contracts.panelMatchesScope(saved,{...owned,sessionId:'s2'}),false);
  assert.equal(contracts.panelMatchesScope(saved,{...owned,audience:'app'}),false);
  assert.equal(contracts.panelMatchesScope(undefined,owned),false);
});

test('panel schema stores scoped selection and bounded journal metadata',()=>{
  assert.equal(manifest.compatibility.sdk,'^1.9.0');
  const view=manifest.contracts.ui.views.find(item=>item.id==='admin');
  const schema=manifest.contracts.schemas.find(item=>item.id===view.panel.stateSchema.schemaId).schema;
  assert.deepEqual(schema.required,['sessionId','audience','contextId']);
  assert.deepEqual(schema.properties.pending.required,
    ['sessionId','audience','contextId','bindingId','requestKey']);
  assert.equal(schema.properties.pending.additionalProperties,false);
});

test('a draft mutation persists metadata before invoke and survives unknown status without replay',async()=>{
  const scope={sessionId:'s1',audience:'app',contextId:'c1'};
  const command={...scope,bindingId:'creezio.messaging:app.draft.save',requestKey:'key-1',
    intent:'draft.save',targetId:'draft-a'};
  let panel=contracts.messagingPanelData(scope,'box-a','draft-a',null),saveAllowed=false,invocations=0,
    selectedBox='box-a',selectedDraft='draft-a';
  const persist=value=>{if(!saveAllowed)return false;
    panel=contracts.messagingPanelData(scope,selectedBox,selectedDraft,value);return true;};
  const client={audience:'app',async invoke(){invocations++;return {kind:'unknown',code:'outcome_unknown'};},
    async status(){return {kind:'rejected',code:'forbidden',status:403};}};
  let journal=createCommandJournal(scope);
  const refused=await journal.execute(client,command,{boxId:'box-a',draftId:'draft-a',subject:'Secret'},()=>true,persist);
  assert.equal(refused.result.code,'client_state_unavailable');assert.equal(invocations,0);
  saveAllowed=true;
  const unknown=await journal.execute(client,command,{boxId:'box-a',draftId:'draft-a',subject:'Secret'},()=>true,persist);
  assert.equal(unknown.result.kind,'unknown');assert.equal(invocations,1);
  assert.equal(panel.boxId,'box-a');assert.equal(panel.draftId,'draft-a');
  assert.equal(JSON.stringify(panel).includes('Secret'),false);
  selectedBox='box-b';selectedDraft=null;panel=contracts.messagingPanelData(scope,selectedBox,null,panel.pending);
  assert.equal(panel.boxId,'box-b');assert.equal(panel.pending.requestKey,'key-1',
    'switching mailboxes keeps the pending command');
  journal=createCommandJournal(scope,panel.pending);
  const blocked=await journal.execute(client,{...command,requestKey:'key-2'},{},()=>true,persist);
  assert.equal(blocked.result.code,'in_progress');assert.equal(invocations,1);
  const refusedStatus=await journal.inspect(client,()=>true,persist);
  assert.equal(refusedStatus.result.code,'forbidden');assert.equal(journal.pending.requestKey,'key-1');
  client.status=async()=>({kind:'unknown',code:'execution_not_observed'});
  const missingStatus=await journal.inspect(client,()=>true,persist);
  assert.equal(missingStatus.result.code,'execution_not_observed');
  assert.equal(journal.pending.requestKey,'key-1','lookup 404 does not prove absence of an effect');
  client.status=async()=>({kind:'execution',execution:{state:'succeeded',output:{draft:{id:'draft-a'}}}});
  saveAllowed=false;
  const confirmedButUncleared=await journal.inspect(client,()=>true,persist);
  assert.equal(confirmedButUncleared.result.execution.state,'succeeded');
  assert.equal(journal.pending.requestKey,'key-1');
  saveAllowed=true;await journal.inspect(client,()=>true,persist);
  assert.equal(journal.pending,null);assert.equal(panel.pending,undefined);
});

test('later list and selection reads win when equal-parameter responses arrive in reverse order',async()=>{
  for(const kind of ['list','selection']){
    const latest=contracts.createLatestRequest();
    let finishOld,finishNew,published='';
    const oldToken=latest.begin();
    const old=new Promise(resolve=>{finishOld=resolve;}).then(value=>{
      if(latest.accepts(oldToken))published=value;
    });
    const newToken=latest.begin();
    const newer=new Promise(resolve=>{finishNew=resolve;}).then(value=>{
      if(latest.accepts(newToken))published=value;
    });
    finishNew(`${kind}-new`);await newer;
    finishOld(`${kind}-old`);await old;
    assert.equal(published,`${kind}-new`);
    latest.invalidate();
    assert.equal(latest.accepts(newToken),false,
      'a mutation or navigation also invalidates an in-flight read');
  }
});

test('a stale busy completion cannot unlock a newer operation, while navigation can finish its own lease',()=>{
  const busy=contracts.createLatestRequest();
  const original=busy.begin();
  assert.equal(busy.accepts(original),true,
    'changing a mailbox does not prevent the current operation from releasing busy');
  busy.invalidate();
  const next=busy.begin();
  assert.equal(busy.accepts(original),false);
  assert.equal(busy.accepts(next),true);
});

test('A to B to A navigation makes an old automatic read mark stale without losing its request key',async()=>{
  const identity=contracts.createLatestRequest();
  const token=identity.capture();let selected='message-a',finish;
  const scope={sessionId:'session-a',audience:'app',contextId:'application'};
  const issued={...scope,bindingId:'creezio.messaging:app.message.update',requestKey:'read-key',
    intent:'message.update',targetId:'message-a'};
  let saved=null;
  const client={audience:'app',invoke:()=>new Promise(resolve=>{finish=resolve;})};
  const journal=createCommandJournal(scope);
  const current=()=>selected==='message-a'&&identity.accepts(token);
  const running=journal.execute(client,issued,{messageId:'message-a',read:true},current,
    pending=>{saved=pending;return true;});
  assert.equal(saved.requestKey,'read-key');
  selected='message-b';identity.invalidate();
  selected='message-a';identity.invalidate();
  finish({kind:'execution',execution:{state:'succeeded',output:{message:{id:'message-a',read:true,revision:2}}}});
  const outcome=await running;
  assert.equal(outcome.result.code,'stale');
  assert.equal(outcome.pending.requestKey,'read-key');
  assert.equal(saved.requestKey,'read-key','the result must be inspected after the navigation');
});

test('a newer read of the same message wins over an older automatic read mark',async()=>{
  const identity=contracts.createLatestRequest();
  const token=identity.begin();let finish,invocations=0,publishedRevision=1;
  const scope={sessionId:'session-a',audience:'app',contextId:'application'};
  const issued={...scope,bindingId:'creezio.messaging:app.message.update',requestKey:'read-key',
    intent:'message.update',targetId:'message-a'};
  const client={audience:'app',invoke:()=>{invocations++;return new Promise(resolve=>{finish=resolve;});},
    status:async()=>({kind:'execution',execution:{state:'succeeded',output:{message:{id:'message-a',revision:3}}}})};
  const journal=createCommandJournal(scope);
  const current=()=>identity.accepts(token);
  const running=journal.execute(client,issued,{messageId:'message-a',read:true},current,()=>true);
  assert.equal(journal.pending.requestKey,'read-key');
  identity.begin(); // loadSelection starts again for the same message after status reconciliation.
  const inspected=await journal.inspect(client,()=>true,()=>true);
  assert.equal(inspected.result.execution.state,'succeeded');
  publishedRevision=3;
  finish({kind:'execution',execution:{state:'succeeded',output:{message:{id:'message-a',revision:2}}}});
  const old=await running;
  if(current()&&old.result.kind==='execution')publishedRevision=old.result.execution.output.message.revision;
  assert.equal(old.result.code,'stale');
  assert.equal(publishedRevision,3);
  assert.equal(invocations,1,'the status read must not replay the mutation');
});

test('operation bridge addresses the shared messaging binding without raw transport',async()=>{
  const calls=[];const scope={audience:'app',contextId:'workspace',client:{invoke:async request=>{
    calls.push(request);return {kind:'execution',execution:{state:'succeeded',output:{state:'unavailable',send:false,receive:false}}};}}};
  const result=await contracts.call(scope,'transport.status',{},()=>true);
  assert.deepEqual(result,{kind:'ok',value:{state:'unavailable',send:false,receive:false}});
  assert.equal(calls[0].bindingId,'creezio.messaging:app.transport.status');
  assert.equal(calls[0].contextId,'workspace');
  assert.deepEqual(calls[0].input,{});
});
