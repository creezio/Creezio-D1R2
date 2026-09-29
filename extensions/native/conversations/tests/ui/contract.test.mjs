import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlinkSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {projectTurnEvents} from '../../ui/turn-projection.ts';
import {startTurnDriveLoop} from '../../ui/drive-loop.ts';

const bundle = await build({entryPoints:[fileURLToPath(new URL('../../ui/panel.tsx',import.meta.url))],
  bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent'});
const providerBundle = await build({stdin:{contents:"export {projectProviderStatus} from '../../ui/index.tsx'; export {widgetContextActionStatus} from '../../ui/widget-message.tsx';",
  resolveDir:fileURLToPath(new URL('./',import.meta.url)),sourcefile:'provider-projection.ts',loader:'ts'},
  bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent'});
// Load beside this test so bare package imports resolve through the SDK's ESM exports.
const rendered = fileURLToPath(new URL(`./.contract-render-${randomUUID()}.mjs`,import.meta.url));
const providerRendered = fileURLToPath(new URL(`./.provider-render-${randomUUID()}.mjs`,import.meta.url));
let ConversationPanel, projectProviderStatus, widgetContextActionStatus;
let written = false;
let providerWritten = false;
try {
  writeFileSync(rendered,bundle.outputFiles[0].text,{flag:'wx'});
  written = true;
  ({ConversationPanel} = await import(pathToFileURL(rendered).href));
  writeFileSync(providerRendered,providerBundle.outputFiles[0].text,{flag:'wx'});
  providerWritten = true;
  ({projectProviderStatus,widgetContextActionStatus} = await import(pathToFileURL(providerRendered).href));
} finally {
  if (written) unlinkSync(rendered);
  if (providerWritten) unlinkSync(providerRendered);
}
const noop = () => {};
const props = {variant:'embedded',open:true,onOpenChange:noop,mode:'chat',onModeChange:noop,
  selectedId:'c1',conversations:[{id:'c1',title:'Test',mode:'chat',updatedAt:new Date().toISOString(),archivedAt:null}],
  messages:[{id:'m1',role:'user',content:'Bonjour'}],draft:'Brouillon conservé',onDraftChange:noop,
  onCreate:noop,onSelect:noop,onArchive:noop,onRestore:noop,searchQuery:'',onSearchQueryChange:noop,
  showArchived:false,onShowArchivedChange:noop,hasMore:false,onLoadMore:noop,providerStatus:'no_provider'};

test('widget host reports a confirmed context removal without claiming it is ready',()=>{
  assert.equal(widgetContextActionStatus({kind:'ok',value:{removed:true}}),
    'Contexte retiré pour les prochains tours.');
  assert.equal(widgetContextActionStatus({kind:'ok',value:{removed:false}}),
    'Contexte prêt pour le prochain tour.');
  assert.equal(widgetContextActionStatus({kind:'unknown',code:'unavailable',requestKey:'pending'}),
    'Résultat du contexte incertain.');
  assert.equal(widgetContextActionStatus({kind:'rejected',code:'forbidden'}),'Contexte refusé.');
});

test('embedded conversation renders history, draft, and an explicit unavailable provider', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel, props));
  assert.match(html,/data-conversations-panel="open"/);
  assert.match(html,/Bonjour/);
  assert.match(html,/value="Brouillon conservé"/);
  assert.match(html,/Fournisseur IA non configuré/);
  assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="Envoyer — fournisseur indisponible"/);
  assert.doesNotMatch(html,/aria-label="Ouvrir l(?:&#x27;|')assistant"/);
});

test('floating admin view starts from the assistant launcher without exposing thread content', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,variant:'floating',open:false}));
  assert.match(html,/aria-label="Ouvrir l(?:&#x27;|')assistant"/);
  assert.match(html,/data-creezio-assistant-launcher/);
  assert.doesNotMatch(html,/Bonjour|Brouillon conservé/);
});

test('older history is requested above the visible messages', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    hasMoreMessages:true,onLoadMoreMessages:noop}));
  assert.ok(html.indexOf('Charger les messages précédents') < html.indexOf('Bonjour'));
});

test('configured model enables send and an active turn offers stop with visible progress', () => {
  const ready = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    providerStatus:'ready',modelOptions:[{id:'configured-model',label:'Modèle autorisé'}],
    selectedModelId:'configured-model',onModelChange:noop,onSend:noop}));
  assert.match(ready,/Modèle autorisé/);
  assert.match(ready,/<button[^>]*aria-label="Envoyer le message"/);
  assert.doesNotMatch(ready,/<button[^>]*disabled=""[^>]*aria-label="Envoyer le message"/);
  const running = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    providerStatus:'ready',modelOptions:[{id:'configured-model',label:'Modèle autorisé'}],
    selectedModelId:'configured-model',onModelChange:noop,onSend:noop,onStop:noop,
    turnState:'running',assistantPreview:'Réponse partielle',progressSteps:[
      {id:'tool-1',label:'Lecture autorisée',state:'done'}]}));
  assert.match(running,/aria-label="Arrêter la réponse"/);
  assert.match(running,/Réponse partielle/);
  assert.match(running,/Lecture autorisée/);
  assert.doesNotMatch(running,/aria-label="Envoyer le message"/);
});

test('configured but unreadable provider is reported as unavailable without enabling send',()=>{
  const html=renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    providerStatus:'unavailable',onSend:noop,modelOptions:[],selectedModelId:null}));
  assert.match(html,/momentanément indisponible/);
  assert.doesNotMatch(html,/Fournisseur IA non configuré/);
  assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="Envoyer — fournisseur indisponible"/);
});

test('empty chat follows the public provider configuration, never the empty conversation verdict',()=>{
  const config={providerId:'openai.responses.v1',enabled:true,state:'ready',modelId:'allowed-1'};
  assert.deepEqual(projectProviderStatus({config}),{status:'checking',modelId:null});
  const status=projectProviderStatus({config},['allowed-1']);
  assert.deepEqual(status,{status:'ready',modelId:'allowed-1'});
  const html=renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    selectedId:null,conversations:[],messages:[],draft:'',providerStatus:status.status,
    modelOptions:[{id:status.modelId,label:status.modelId}],selectedModelId:status.modelId,onSend:noop}));
  assert.doesNotMatch(html,/Fournisseur IA non configuré|momentanément indisponible/);
  assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="Envoyer le message"/);
});

test('missing, disabled, invalid and unreadable configurations do not enable a model',()=>{
  const base={providerId:'openai.responses.v1',enabled:true,state:'ready',modelId:'allowed-1'};
  for(const config of [{...base,state:'missing'}, {...base,enabled:false},
    {...base,state:'invalid'}, {...base,state:'unverified'}, {...base,modelId:'invalid model'},
    {...base,providerId:'other'}]){
    const result=projectProviderStatus({config},['allowed-1']);
    assert.notEqual(result.status,'ready');
    const html=renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
      providerStatus:result.status,onSend:noop,modelOptions:[],selectedModelId:null}));
    assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="Envoyer — fournisseur indisponible"/);
    assert.equal(html.includes('Fournisseur IA non configuré'),result.status==='no_provider');
  }
  assert.deepEqual(projectProviderStatus({config:base},[]),{status:'unavailable',modelId:null});
  assert.deepEqual(projectProviderStatus(null),{status:'unavailable',modelId:null});
});

test('progress projection exposes bounded text and known steps without raw provider payloads',()=>{
  const events=[
    {turnId:'t',sequence:1,kind:'queued',payload:{modelId:'configured'},createdAt:''},
    {turnId:'t',sequence:2,kind:'text_delta',payload:{text:'Bonjour'},createdAt:''},
    {turnId:'t',sequence:3,kind:'tool_call',payload:{name:'private_operation',arguments:{secret:'hidden'}},createdAt:''},
    {turnId:'t',sequence:4,kind:'unexpected',payload:{secret:'hidden'},createdAt:''}];
  const projected=projectTurnEvents(events);
  assert.equal(projected.preview,'Bonjour');
  assert.deepEqual(projected.steps.map(step=>step.label),['Tour en attente','Outil en cours']);
  assert.doesNotMatch(JSON.stringify(projected),/private_operation|hidden|configured/);
});

test('tool exclusions remain visible after a turn without exposing operation names or payloads',()=>{
  const projected=projectTurnEvents([{turnId:'t',sequence:1,kind:'started',payload:{body:'',
    toolDiagnostics:[{code:'forbidden',count:2,name:'private_operation'},
      {code:'unsupported_schema',count:1,secret:'hidden'},
      {code:'count_limit',count:2},{code:'byte_limit',count:3},
      {code:'catalog_limit',count:1}],toolDiagnosticsTruncated:false},createdAt:''}]);
  assert.match(projected.toolDiagnostics,/2 sans autorisation/);
  assert.match(projected.toolDiagnostics,/1 schéma non compatible/);
  assert.match(projected.toolDiagnostics,/2 limite de nombre atteinte/);
  assert.match(projected.toolDiagnostics,/3 limite de taille atteinte/);
  assert.match(projected.toolDiagnostics,/catalogue limité à 1 000 entrées \(suite non inspectée\)/);
  const resumed=projectTurnEvents([{turnId:'t',sequence:1,kind:'started',payload:{
    toolDiagnostics:[{code:'count_limit',count:2}],toolDiagnosticsTruncated:true},createdAt:''},
  {turnId:'t',sequence:2,kind:'unknown',payload:{},createdAt:''},
  {turnId:'t',sequence:3,kind:'started',payload:{
    toolDiagnostics:[{code:'count_limit',count:1}],toolDiagnosticsTruncated:false},createdAt:''}]);
  assert.match(resumed.toolDiagnostics,/1 limite de nombre atteinte/);
  assert.doesNotMatch(resumed.toolDiagnostics,/2 limite de nombre|diagnostics limités/);
  assert.doesNotMatch(JSON.stringify(projected),/private_operation|hidden/);
  const terminal=renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    messages:[{id:'answer',role:'assistant',content:'Réponse'}],turnState:null,
    toolDiagnostics:projected.toolDiagnostics}));
  assert.match(terminal,/Outils non proposés/);
  assert.match(terminal,/Réponse/);
});

test('unknown provider outcome after stop is explicit and offers no futile retry',()=>{
  const projected=projectTurnEvents([{turnId:'t',sequence:2,kind:'unknown',
    payload:{cancelRequested:true,privateDetail:'hidden'},createdAt:''}]);
  assert.equal(projected.cancelOutcomeUnknown,true);
  assert.doesNotMatch(JSON.stringify(projected),/hidden/);
  const html=renderToStaticMarkup(React.createElement(ConversationPanel,{...props,
    turnState:'unknown',cancelOutcomeUnknown:projected.cancelOutcomeUnknown,
    onResume:undefined,onStop:undefined}));
  assert.match(html,/Arrêt demandé ; résultat fournisseur inconnu, impossible de confirmer l’arrêt/);
  assert.match(html,/aria-label="Nouvelle conversation"/);
  assert.doesNotMatch(html,/Reprendre le tour|Arrêter la réponse/);
});

test('active turn drives a continuation serially until it reaches a terminal state',async()=>{
  let state='queued',calls=0,active=0,maximumActive=0,refreshes=0;
  let finished;const done=new Promise(resolve=>{finished=resolve;});
  const loop=startTurnDriveLoop({turnId:'turn-1',delayMs:1,getTurn:()=>({id:'turn-1',state}),
    drive:async()=>{
      active++;maximumActive=Math.max(maximumActive,active);
      await new Promise(resolve=>setTimeout(resolve,5));
      calls++;state=calls===1?'running':'succeeded';active--;
      if(state==='succeeded')finished();
      return {kind:'ok',value:{id:'turn-1',state}};
    },refresh:async()=>{refreshes++;},onIssue:()=>assert.fail('No drive issue expected')});
  let timeout;
  try{
    await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Continuation stalled')),1000);})]);
    assert.equal(calls,2);assert.equal(maximumActive,1);assert(refreshes>=1);
  }finally{clearTimeout(timeout);loop.stop();}
});

test('unknown turn stops automatic polling and resumes only on explicit request',async()=>{
  let state='unknown',calls=0,refreshes=0;
  const loop=startTurnDriveLoop({turnId:'turn-unknown',delayMs:1,
    getTurn:()=>({id:'turn-unknown',state}),
    drive:async()=>{calls++;state='succeeded';return {kind:'ok',value:{id:'turn-unknown',state}};},
    refresh:async()=>{refreshes++;},onIssue:()=>assert.fail('No drive issue expected')});
  try{
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(calls,0);
    assert.equal(refreshes,1);
    const resumed=await loop.resume();
    assert.equal(resumed?.kind,'ok');
    assert.equal(calls,1);
    assert.equal(refreshes,2);
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls,1);
    assert.equal(refreshes,2);
  }finally{loop.stop();}
});

test('uncertain attachment is announced without implying the file was linked', () => {
  const html = renderToStaticMarkup(React.createElement(ConversationPanel,{...props,onAttach:noop,
    attachments:[{fileId:'f1',filename:'document.pdf',byteSize:1024}],onDownloadAttachment:noop,
    attachmentState:{phase:'unknown',message:'Résultat incertain : vérifiez avant de réessayer.'},
    onRetryUpload:noop,
    onReconcileUnknown:noop}));
  assert.match(html,/aria-label="Ajouter une pièce jointe"/);
  assert.match(html,/document.pdf/);
  assert.match(html,/role="alert"[^>]*>Résultat incertain/);
  assert.match(html,/Reprendre le téléversement/);
  assert.match(html,/Vérifier l.opération en attente/);
  assert.doesNotMatch(html,/est joint à la conversation/);
});
