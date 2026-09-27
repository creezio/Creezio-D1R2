import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceController} from '../../sdk/workspace/controller.ts';

const digest = `sha256-${'a'.repeat(64)}`;
const session = {id:'session-1', principalId:'person-1', audience:'admin'};
const view = (id, route, identityFields = []) => ({id:`module:${id}`, moduleId:'module',
  title:id, route, surfaces:['workspace'], audiences:['admin'],
  panel:{identityFields, navigation:'sdk', retention:'preserve', inactiveEffects:'suspend'},
  component: () => null});
const views = [view('home','/home'), view('record','/records/{id}',['id'])];
const projection = (overrides = {}) => ({sessionId:session.id, principalId:session.principalId,
  audience:'admin', contextId:'application', compositionDigest:digest, epoch:1,
  viewIds:views.map(view => view.id), navigationIds:[], ...overrides});
function access() {
  let snapshot = {phase:'authenticated', session, pending:null};
  const listeners = new Set();
  return {audience:'admin', origin:'https://creezio.example', getSnapshot:()=>snapshot,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    set(next){snapshot=next;for(const listener of listeners)listener();}};
}
const create = (overrides = {}) => {
  const identity = access();
  const controller = createWorkspaceController({access:identity, views,
    contextId:'application', projection:projection(), homeViewId:'module:home', ...overrides});
  return {identity,controller};
};

test('home is pinned; two declared record identities retain separate panes and drafts can stay mounted', () => {
  const {controller} = create();
  assert.deepEqual(controller.getSnapshot().tabs.map(tab => [tab.location.viewId,tab.pinned]), [['module:home',true]]);
  assert.equal(controller.close(controller.getSnapshot().tabs[0].id), false);
  assert.equal(controller.open('module:record',{id:'a'}), true);
  const first = controller.getSnapshot().activeTabId;
  assert.equal(controller.open('module:record',{id:'b'}), true);
  const second = controller.getSnapshot().activeTabId;
  assert.notEqual(first, second);
  assert.equal(controller.getSnapshot().tabs.length,3);
  controller.activate(first);
  assert.equal(controller.getSnapshot().tabs.find(tab => tab.id === first).location.input.id,'a');
  assert.equal(controller.open('module:record',{id:'b'}), true);
  assert.equal(controller.getSnapshot().activeTabId,second);
  controller.dispose();
});

test('history is local, query-only transitions do not replace a panel, and lock protects it', () => {
  const {controller} = create();
  controller.open('module:record',{id:'a',section:'overview'});
  const first = controller.getSnapshot().activeTabId;
  controller.open('module:record',{id:'a',section:'details'});
  assert.equal(controller.getSnapshot().tabs.length,2);
  assert.equal(controller.getSnapshot().tabs[1].history.length,2);
  assert.equal(controller.back(),true);
  assert.equal(controller.getSnapshot().tabs[1].location.input.section,'overview');
  assert.equal(controller.forward(),true);
  assert.equal(controller.getSnapshot().tabs[1].location.input.section,'details');
  controller.lock(first,true);
  controller.open('module:record',{id:'b'});
  assert.equal(controller.getSnapshot().tabs.find(tab => tab.id === first).location.input.id,'a');
  assert.equal(controller.close(first),false);
  assert.equal(controller.lock(first,false),true);
  assert.equal(controller.close(first),true);
  controller.dispose();
});

test('revocation, pending logout, context mismatch and session replacement purge protected panes', () => {
  const {controller,identity} = create();
  controller.open('module:record',{id:'a'});
  controller.setProjection(projection({epoch:2,viewIds:['module:home']}));
  assert.deepEqual(controller.getSnapshot().tabs.map(tab => tab.location.viewId), ['module:home']);
  controller.setProjection(projection({epoch:1}));
  assert.equal(controller.open('module:record',{id:'b'}),false,'older authorization cannot restore a revoked view');
  controller.setProjection(projection({epoch:3}));
  controller.open('module:record',{id:'b'});
  identity.set({phase:'authenticated',session,pending:'logout'});
  assert.equal(controller.getSnapshot().tabs.length,0);
  identity.set({phase:'authenticated',session:{...session,id:'session-2'},pending:null});
  controller.setProjection(projection());
  assert.equal(controller.open('module:record',{id:'c'}),false);
  controller.setProjection(projection({sessionId:'session-2',contextId:'other'}));
  assert.equal(controller.open('module:record',{id:'c'}),false);
  controller.dispose();
});

test('session refresh and unavailable read suspend commands without discarding mounted panel identities', () => {
  const {controller,identity}=create();
  controller.open('module:record',{id:'alpha'});
  const retained=controller.getSnapshot().tabs[1];
  identity.set({phase:'loading',session:null,pending:null});
  controller.setProjection(null);
  assert.equal(controller.open('module:record',{id:'beta'}),false);
  assert.equal(controller.getSnapshot().tabs[1],retained);
  identity.set({phase:'unavailable',session:null,pending:null});
  assert.equal(controller.getSnapshot().tabs[1],retained);
  identity.set({phase:'authenticated',session,pending:null});
  controller.setProjection(projection({epoch:2}));
  assert.equal(controller.getSnapshot().tabs[1],retained);
  assert.equal(controller.open('module:record',{id:'beta'}),true);
  controller.dispose();
});
