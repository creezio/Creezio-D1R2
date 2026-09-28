import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {createReadGeneration,pageScopeAfter,panelBelongsToScope,parseContentInput,requiresPageReset,samePageSelection} from '../../ui/state.ts';
import {createCommandJournal} from '@creezio/sdk/operations/command-journal';
import {operationResult} from '../../ui/contracts.ts';

test('an unconfirmed server execution cannot be presented as a rejected write',()=>{
  for(const state of ['claimed','running','unknown']){
    const result=operationResult({kind:'execution',execution:{state,output:null,errorCode:null}});
    assert.equal(result.kind,'unknown');
  }
  assert.deepEqual(operationResult({kind:'execution',execution:{state:'succeeded',output:{page:{id:'one'}}}}),
    {kind:'ok',value:{page:{id:'one'}}});
  assert.deepEqual(operationResult({kind:'execution',execution:{state:'failed',errorCode:'conflict'}}),
    {kind:'rejected',code:'conflict'});
});

test('original five section prefabs remain available in the native editor',()=>{
  const prefabs=read('ui/prefabs.tsx'),editor=read('ui/index.tsx');
  for(const kind of ['hero','features','pricing','cta','footer']){
    assert.match(prefabs,new RegExp(kind));
    assert.match(editor,new RegExp(kind));
  }
  assert.match(editor,/page\.preview/);
  assert.match(editor,/page\.publish/);
  assert.match(editor,/navigation\.publish/);
  assert.match(editor,/window\.confirm/);
  assert.match(editor,/createFileClient/);
  assert.doesNotMatch(editor,/\b(?:db\.prepare|database\.prepare|sql`)/);
});

test('front only reads published snapshots under authenticated app permission',()=>{
  const front=read('ui/front-page.tsx');
  assert.match(front,/page\.published\.list/);
  assert.match(front,/navigation\.published/);
  assert.doesNotMatch(front,/page\.save|navigation\.save/);
  assert.match(front,/if\(!enabled\|\|!ownScope\)return/,
    'old published content must be hidden before the new scope reset effect runs');
  const view=manifest.contracts.ui.views.find(item=>item.id==='front');
  assert.deepEqual(view.permissions.map(item=>item.id),['view']);
  assert.ok(view.operations.every(item=>['page.published.list','page.published.read','navigation.published']
    .includes(item.id)));
});

test('inactive pages retain their draft, while identity and context changes invalidate it',()=>{
  const client={},access={},anonymous={sessionId:'',client,access,audience:'admin',contextId:'application'};
  assert.equal(requiresPageReset(anonymous,{...anonymous,sessionId:'session-a'}),false,
    'initial login may restore the saved panel selection');
  const established={...anonymous,sessionId:'session-a'};
  assert.equal(requiresPageReset(established,{...established}),false);
  const refreshing={...established,sessionId:'',phase:'loading'};
  assert.equal(requiresPageReset(established,refreshing),false);
  assert.equal(pageScopeAfter(established,refreshing),established,
    'temporary loading retains the established identity and its drafts');
  assert.equal(requiresPageReset(pageScopeAfter(established,refreshing),
    {...established,sessionId:'session-b'}),true,
    'a different session after loading still purges the old draft');
  assert.equal(requiresPageReset(established,{...refreshing,phase:'anonymous'}),true);
  for(const change of [{sessionId:'session-b'},{sessionId:''},{audience:'app'},{contextId:'other'}])
    assert.equal(requiresPageReset(established,{...established,...change}),true);
  assert.equal(requiresPageReset(established,{...established,client:{},access:{}}),false,
    'renewing SDK objects in the same verified scope must not erase unsaved edits');
});

test('saved selection and pending status are restored only for the verified panel scope',()=>{
  assert.equal(manifest.compatibility.sdk,'^1.2.0');
  const state=manifest.contracts.schemas.find(item=>item.id==='editor-panel-state');
  for(const key of ['sessionId','audience','contextId','pageId','pending'])
    assert.ok(state?.schema?.properties?.[key],`panel state must permit ${key}`);
  const scope={sessionId:'session-a',audience:'admin',contextId:'application'};
  const pending={...scope,bindingId:'creezio.pages-navigation:admin.page.create',
    requestKey:'request-1',intent:'page.create',targetId:'page-a'};
  const saved={...scope,pageId:'page-a',tab:'navigation',pending};
  assert.equal(panelBelongsToScope(saved,scope),true);
  assert.equal(createCommandJournal(scope,saved.pending).pending?.requestKey,'request-1');
  for(const changed of [{sessionId:'session-b'},{audience:'app'},{contextId:'other'}]){
    const foreign={...scope,...changed};
    assert.equal(panelBelongsToScope(saved,foreign),false);
    assert.equal(createCommandJournal(foreign,saved.pending).pending,null);
  }
  assert.equal(panelBelongsToScope({pageId:'page-a'},scope),false,
    'unscoped legacy panel state may not select a page after reload');
});

test('a page response belongs only to the same uninterrupted selection',()=>{
  assert.equal(samePageSelection('page-a','page-a',4,4),true);
  assert.equal(samePageSelection('page-a','page-b',4,4),false);
  assert.equal(samePageSelection('page-a','page-a',4,6),false,
    'switching away and back must reject the first page-a response');
});

test('a later same-page read or write prevents an earlier response from replacing it',async()=>{
  const generation=createReadGeneration();
  let releaseOld,releaseNew,visible='';
  const old=new Promise(resolve=>{releaseOld=resolve;});
  const newer=new Promise(resolve=>{releaseNew=resolve;});
  const first=generation.begin();
  const firstRead=old.then(value=>{if(generation.accepts(first))visible=value;});
  const second=generation.begin();
  const secondRead=newer.then(value=>{if(generation.accepts(second))visible=value;});
  releaseNew('revision 2');await secondRead;
  releaseOld('revision 1');await firstRead;
  assert.equal(visible,'revision 2');
  generation.invalidate();
  assert.equal(generation.accepts(second),false,'a confirmed write invalidates in-flight reads');
});

test('invalid structured content cannot replace the last valid value',()=>{
  const previous=[{label:'Publié'}];
  let persisted=previous;
  for(const draft of ['[{"label":','{"unterminated":true','']){
    const result=parseContentInput(draft);
    assert.equal(result.valid,false);
    if(result.valid)persisted=result.value;
    assert.deepEqual(persisted,previous);
  }
  const corrected=parseContentInput('[{"label":"Corrigé"}]');
  assert.deepEqual(corrected,{valid:true,value:[{label:'Corrigé'}]});
});
