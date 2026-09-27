import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceController,createWorkspaceLocation,resolveWorkspaceLocation} from '../../sdk/workspace/controller.ts';

const digest=`sha256-${'a'.repeat(64)}`;
const view=(id,route,identityFields=[])=>({id:`example.notes:${id}`,moduleId:'example.notes',
  moduleIntegrity:`sha256-${'a'.repeat(64)}`,title:id,route,
  surfaces:['front'],audiences:['app'],panel:{identityFields,navigation:'sdk',retention:'preserve',inactiveEffects:'suspend'},
  validateInput:input=>Object.keys(input).every(key=>['id','section'].includes(key))
    && (id!=='record'||typeof input.id==='string'),component:()=>null});
const views=[view('home','/notes'),view('record','/notes/{id}',['id'])];
const allowed=new Set(views.map(item=>item.id));

test('front routes reuse canonical workspace params, query validation and ambiguity handling',()=>{
  const location=createWorkspaceLocation(views[1],{id:'a b',section:'details'});
  assert.equal(location.url,'/notes/a%20b?section=details');
  assert.deepEqual(resolveWorkspaceLocation(location.url,views,allowed,'front'),location);
  assert.equal(resolveWorkspaceLocation('/notes/a%2Fb',views,allowed,'front'),null);
  assert.equal(resolveWorkspaceLocation('/notes/a?unknown=1',views,allowed,'front'),null);
  assert.equal(resolveWorkspaceLocation(location.url,views,allowed),null,'workspace does not see front-only routes');
  assert.equal(resolveWorkspaceLocation('/notes/a', [...views,view('duplicate','/notes/{id}')],
    new Set([...allowed,'example.notes:duplicate']),'front'),null);
});

test('retained front panels use the app audience and reject stale projections',()=>{
  const session={id:'session-app',principalId:'person',audience:'app'};
  const access={audience:'app',origin:'https://creezio.example',getSnapshot:()=>({phase:'authenticated',session,pending:null}),
    subscribe:()=>()=>{}};
  const projection={sessionId:session.id,principalId:session.principalId,audience:'app',contextId:'application',
    compositionDigest:digest,epoch:2,viewIds:[views[1].id],navigationIds:[],slotIds:[]};
  const controller=createWorkspaceController({access,views,contextId:'application',surface:'front',projection});
  assert.equal(controller.open(views[1].id,{id:'note-a'}),true);
  assert.equal(controller.getSnapshot().tabs[0].location.url,'/notes/note-a');
  controller.setProjection({...projection,epoch:3,viewIds:[]});
  assert.deepEqual(controller.getSnapshot().tabs,[]);
  assert.equal(controller.open(views[1].id,{id:'note-b'}),false);
  controller.dispose();
});

test('front draft presentation survives a theme digest change after current route and ACL validation',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),
    removeItem:key=>data.delete(key)};
  const session={id:'session-app',principalId:'person',audience:'app'};
  const access={audience:'app',origin:'https://creezio.example',getSnapshot:()=>({phase:'authenticated',session,pending:null}),
    subscribe:()=>()=>{}};
  const projection={sessionId:session.id,principalId:session.principalId,audience:'app',contextId:'application',
    compositionDigest:digest,epoch:2,viewIds:[views[1].id],navigationIds:[],slotIds:[]};
  const first=createWorkspaceController({access,views,contextId:'application',surface:'front',projection,storage});
  first.open(views[1].id,{id:'note-a'});
  const tab=first.getSnapshot().tabs[0];
  assert.equal(first.savePanelStateFor(tab.id,{scrollTop:123}),true);
  first.dispose();
  const second=createWorkspaceController({access,views,contextId:'application',surface:'front',
    projection:{...projection,compositionDigest:`sha256-${'b'.repeat(64)}`},storage});
  assert.equal(second.getSnapshot().tabs[0]?.location.url,'/notes/note-a');
  assert.equal(second.getSnapshot().tabs[0]?.panelState.scrollTop,123);
  second.dispose();
  const saved=[...data.entries()];
  const third=createWorkspaceController({access,views:[{...views[1],moduleIntegrity:`sha256-${'f'.repeat(64)}`}],contextId:'application',
    surface:'front',projection:{...projection,compositionDigest:`sha256-${'c'.repeat(64)}`},storage});
  assert.equal(third.getSnapshot().tabs.length,0,'changed runtime integrity cannot adopt the old panel state');
  third.dispose();
  data.clear();for(const [key,value] of saved)data.set(key,value);
  const fourth=createWorkspaceController({access,views:[{...views[1],moduleIntegrity:`sha256-${'f'.repeat(64)}`}],
    contextId:'application',surface:'front',
    projection:{...projection,compositionDigest:`sha256-${'b'.repeat(64)}`},storage});
  assert.equal(fourth.getSnapshot().tabs.length,0,
    'a changed runtime integrity is rejected even when the composition digest is unchanged');
  fourth.dispose();
});
