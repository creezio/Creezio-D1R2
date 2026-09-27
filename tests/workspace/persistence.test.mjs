import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceController, WORKSPACE_STORAGE_KEY} from '../../sdk/workspace/controller.ts';

const digest = `sha256-${'a'.repeat(64)}`;
const session = {id:'session-1',principalId:'person-1',audience:'admin'};
const view = (id, route, identityFields = []) => ({id:`module:${id}`,moduleId:'module',title:id,
  route,surfaces:['workspace'],audiences:['admin'],panel:{identityFields,navigation:'sdk',retention:'preserve',inactiveEffects:'suspend'},
  validateInput: input => Object.keys(input).every(key => ['id','section'].includes(key)),component:()=>null});
const views = [view('home','/home'),view('record','/records/{id}',['id'])];
const projection = (extra = {}) => ({sessionId:session.id,principalId:session.principalId,audience:'admin',
  contextId:'application',compositionDigest:digest,epoch:1,viewIds:views.map(item=>item.id),navigationIds:[],...extra});
function memoryStorage() {
  const entries = new Map();
  return {entries,getItem:key=>entries.get(key)??null,setItem:(key,value)=>{entries.set(key,value);},
    removeItem:key=>{entries.delete(key);},get length(){return entries.size;},key:index=>[...entries.keys()][index]??null};
}
function access() {
  let state={phase:'authenticated',session,pending:null}; const listeners=new Set();
  return {audience:'admin',getSnapshot:()=>state,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    set(next){state=next;for(const listener of listeners)listener();}};
}
const create = (identity,storage,initialProjection=projection()) => createWorkspaceController({access:identity,views,
  contextId:'application',storage,homeViewId:'module:home',projection:initialProjection});
const key = `${WORKSPACE_STORAGE_KEY}:admin:application`;

test('sessionStorage restores original-style tabs/history only after fresh matching projection', () => {
  const storage=memoryStorage(), first=create(access(),storage);
  assert.equal(first.open('module:record',{id:'alpha',section:'overview'}),true);
  const alpha=first.getSnapshot().activeTabId;
  assert.equal(first.savePanelState({activeSubview:'details',scrollTop:77,scrollLeft:2}),true);
  assert.equal(first.open('module:record',{id:'alpha',section:'details'}),true);
  assert.equal(first.open('module:record',{id:'beta'}),true);
  assert.equal(first.activate(alpha),true);
  const persisted=storage.getItem(key);
  assert.ok(persisted); assert.equal(persisted.includes('credential'),false);
  assert.equal(JSON.parse(persisted).tabs.length,3);
  first.dispose();
  const second=create(access(),storage,null);
  assert.equal(second.getSnapshot().tabs.length,0,'no eager restore without projection');
  assert.equal(second.open('module:record',{id:'bypass'}),false);
  second.setProjection(projection({epoch:2}));
  const snapshot=second.getSnapshot();
  assert.equal(snapshot.tabs.length,3);
  assert.equal(snapshot.activeTabId,alpha);
  assert.equal(snapshot.tabs[1].history.length,2);
  assert.equal(snapshot.tabs[1].history[0].url,'/records/alpha?section=overview');
  assert.deepEqual(snapshot.tabs[1].panelState,{activeSubview:'details',scrollTop:77,scrollLeft:2});
  assert.equal(second.readPanelState().activeSubview,'details');
  assert.equal(second.back(),true);
  assert.equal(second.getSnapshot().tabs[1].location.input.section,'overview');
  second.dispose();
});

test('fresh projection removes revoked views from stored tabs and refuses stale epoch restoration', () => {
  const storage=memoryStorage(), first=create(access(),storage);
  first.open('module:record',{id:'alpha'}); first.dispose();
  const second=create(access(),storage,null);
  second.setProjection(projection({epoch:2,viewIds:['module:home']}));
  assert.deepEqual(second.getSnapshot().tabs.map(tab=>tab.location.viewId),['module:home']);
  assert.equal(JSON.parse(storage.getItem(key)).tabs.length,1);
  second.setProjection(projection({epoch:1}));
  assert.equal(second.open('module:record',{id:'restored-incorrectly'}),false);
  second.dispose();
});

test('stored links are reparsed through declared routes and input validators', () => {
  const storage=memoryStorage(), first=create(access(),storage);
  first.open('module:record',{id:'alpha',section:'details'});first.dispose();
  const value=JSON.parse(storage.getItem(key));
  value.tabs[1].history[0]='/records/alpha?unexpected=secret';
  storage.setItem(key,JSON.stringify(value));
  const second=create(access(),storage,null);second.setProjection(projection());
  assert.deepEqual(second.getSnapshot().tabs.map(tab=>tab.location.viewId),['module:home']);
  assert.equal(storage.getItem(key).includes('unexpected'),false);
  second.dispose();
});

test('malformed, oversized and foreign storage cannot restore; confirmed logout purges all own contexts', () => {
  const storage=memoryStorage();
  storage.setItem(key,'{bad');
  const bad=create(access(),storage,null);bad.setProjection(projection());
  assert.equal(bad.getSnapshot().tabs.length,1);bad.dispose();
  storage.setItem(key,'x'.repeat(65_537));
  const oversized=create(access(),storage,null);oversized.setProjection(projection());
  assert.equal(oversized.getSnapshot().tabs.length,1);oversized.dispose();
  const old=create(access(),storage);old.open('module:record',{id:'alpha'});old.dispose();
  const foreign=JSON.parse(storage.getItem(key));foreign.sessionId='other-session';storage.setItem(key,JSON.stringify(foreign));
  const identity=access(), current=create(identity,storage,null);current.setProjection(projection());
  assert.equal(current.getSnapshot().tabs.length,1,'foreign session was not restored');
  storage.setItem(`${WORKSPACE_STORAGE_KEY}:admin:other`,JSON.stringify({...JSON.parse(storage.getItem(key)),contextId:'other'}));
  identity.set({phase:'authenticated',session,pending:'logout'});
  assert.equal(current.getSnapshot().tabs.length,0);
  assert.equal(storage.getItem(key),null);
  assert.equal(storage.getItem(`${WORKSPACE_STORAGE_KEY}:admin:other`),null);
  current.dispose();
});

test('panel state is explicit and limited to small presentation fields', () => {
  const storage=memoryStorage(), controller=create(access(),storage);
  controller.open('module:record',{id:'alpha'});
  const alpha=controller.getSnapshot().activeTabId;
  assert.equal(controller.savePanelState({activeSubview:'details'}),true);
  assert.equal(controller.savePanelState({password:'secret'}),false);
  assert.equal(controller.savePanelState({scrollTop:-1}),false);
  assert.equal(controller.savePanelState({activeSubview:'x'.repeat(600)}),false);
  assert.deepEqual(controller.readPanelState(),{activeSubview:'details'});
  controller.open('module:record',{id:'beta'});
  const beta=controller.getSnapshot().activeTabId;
  assert.equal(controller.savePanelStateFor(alpha,{activeSubview:'notes'}),true);
  assert.equal(controller.getSnapshot().activeTabId,beta);
  assert.deepEqual(controller.readPanelStateFor(alpha),{activeSubview:'notes'});
  assert.equal(controller.readPanelState(),null);
  assert.equal(storage.getItem(key).includes('secret'),false);
  controller.dispose();
});

test('confirmed authorization refusal purges persisted and mounted panes', () => {
  const storage=memoryStorage(), controller=create(access(),storage);
  controller.open('module:record',{id:'alpha'});
  assert.ok(storage.getItem(key));
  controller.revokeProjection();
  assert.equal(storage.getItem(key),null);
  assert.equal(controller.getSnapshot().tabs.length,0);
  assert.equal(controller.open('module:record',{id:'alpha'}),false);
  controller.dispose();
});

test('declared panel data is copied, bounded, and revalidated on restore', () => {
  const storage=memoryStorage();
  const stateful={...view('stateful','/stateful/{id}',['id']),validateState: data =>
    data?.mode === 'list' && typeof data.note === 'string' && data.note.length <= 64};
  const stateViews=[...views,stateful];
  const stateProjection=projection({viewIds:stateViews.map(item=>item.id)});
  const make=() => createWorkspaceController({access:access(),views:stateViews,contextId:'application',storage,
    homeViewId:'module:home',projection:stateProjection});
  const first=make();
  assert.equal(first.open('module:stateful',{id:'alpha'}),true);
  const source={mode:'list',note:'draft'};
  assert.equal(first.savePanelState({data:source}),true);
  source.note='changed after save';
  assert.deepEqual(first.readPanelState()?.data,{mode:'list',note:'draft'});
  assert.equal(Object.isFrozen(first.readPanelState()?.data),true);
  assert.equal(first.savePanelState({data:{mode:'list',note:'x'.repeat(8193)}}),false);
  assert.equal(first.savePanelState({data:Object.create({mode:'list',note:'prototype'})}),false);
  const cycle={mode:'list',note:'ok'};cycle.self=cycle;
  assert.equal(first.savePanelState({data:cycle}),false);
  const accessor={mode:'list',get note(){throw new Error('must not run');}};
  assert.equal(first.savePanelState({data:accessor}),false);
  first.dispose();
  const second=make();
  assert.deepEqual(second.readPanelState()?.data,{mode:'list',note:'draft'});
  second.dispose();
  const saved=JSON.parse(storage.getItem(key));
  saved.tabs[1].panelState.data.mode='forbidden';
  storage.setItem(key,JSON.stringify(saved));
  const third=make();
  assert.equal(third.getSnapshot().tabs.length,2);
  assert.equal(third.readPanelState(),null);
  assert.equal(storage.getItem(key).includes('forbidden'),false);
  third.dispose();
});

test('twelve declared near-8KiB panel states survive reload within the bounded snapshot', () => {
  const storage=memoryStorage();
  const validateState=data=>['a','b','c','d'].every(key=>typeof data?.[key]==='string'&&data[key].length===1970);
  const stateViews=views.map(item=>({...item,validateState}));
  const stateProjection=projection({viewIds:stateViews.map(item=>item.id)});
  const make=()=>createWorkspaceController({access:access(),views:stateViews,contextId:'application',storage,
    homeViewId:'module:home',projection:stateProjection});
  const first=make();
  for(let index=0;index<12;index++) {
    if(index>0) assert.equal(first.open('module:record',{id:`record-${index}`}),true);
    const letter=String.fromCharCode(65+index);
    assert.equal(first.savePanelState({data:{a:letter.repeat(1970),b:letter.repeat(1970),
      c:letter.repeat(1970),d:letter.repeat(1970)}}),true);
  }
  assert.equal(first.getSnapshot().tabs.length,12);
  assert.ok(Buffer.byteLength(storage.getItem(key),'utf8')>65_536);
  first.dispose();
  const second=make();
  assert.equal(second.getSnapshot().tabs.length,12);
  for(let index=0;index<12;index++) assert.equal(second.getSnapshot().tabs[index].panelState.data.a[0],
    String.fromCharCode(65+index));
  second.dispose();
});

test('quota refusal reports false while keeping mounted draft and last valid persisted draft', () => {
  const storage=memoryStorage(), set=storage.setItem;
  let rejectWrites=false;
  storage.setItem=(name,value)=>{if(rejectWrites)throw new DOMException('Quota exceeded','QuotaExceededError');set(name,value);};
  const first=create(access(),storage);
  first.open('module:record',{id:'alpha'});
  assert.equal(first.savePanelState({activeSubview:'details'}),true);
  const previous=storage.getItem(key);
  rejectWrites=true;
  assert.equal(first.savePanelState({activeSubview:'notes'}),false);
  assert.equal(first.readPanelState().activeSubview,'notes');
  assert.equal(storage.getItem(key),previous);
  first.dispose();
  rejectWrites=false;
  const second=create(access(),storage);
  assert.equal(second.readPanelState().activeSubview,'details');
  second.dispose();
});

test('oversized histories report unsaved state without deleting prior snapshot', () => {
  const storage=memoryStorage(), first=create(access(),storage);
  first.open('module:record',{id:'alpha'});
  assert.equal(first.savePanelState({activeSubview:'details'}),true);
  for(let index=0;index<80;index++) assert.equal(first.open('module:record',
    {id:'alpha',section:`${'x'.repeat(1800)}${index}`}),true);
  assert.equal(first.savePanelState({activeSubview:'notes'}),false);
  assert.equal(first.readPanelState().activeSubview,'notes');
  assert.ok(storage.getItem(key));
  first.dispose();
  const second=create(access(),storage);
  assert.equal(second.readPanelState().activeSubview,'details');
  second.dispose();
});
