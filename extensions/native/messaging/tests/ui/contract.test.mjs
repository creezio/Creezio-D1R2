import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

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
  assert.equal(contracts.scopeChanged(initial,{...initial,client:{}}),true);
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
