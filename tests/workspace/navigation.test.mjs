import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWorkspaceLocation, createWorkspaceController, MAX_WORKSPACE_TABS} from '../../sdk/workspace/controller.ts';

const record = {id:'module:record',moduleId:'module',title:'Record',route:'/records/{id}',
  surfaces:['workspace'],audiences:['app'],panel:{identityFields:['id'],navigation:'sdk',
    retention:'preserve',inactiveEffects:'suspend'},component:()=>null};
const allowed = new Set([record.id]);

test('declared route and identity fields canonicalize direct links without hardcoded record names', () => {
  const location = resolveWorkspaceLocation('/records/a?section=details', [record], allowed);
  assert.equal(location.url,'/records/a?section=details');
  assert.equal(location.identity,JSON.stringify(['module','module:record','a']));
  assert.equal(resolveWorkspaceLocation('/records/b?section=details',[record],allowed).identity === location.identity,false);
  for (const url of ['https://evil.example/records/a','/records/a#fragment',
    '/records/a?id=other','/records/a?section=one&section=two','/unlisted/a']) {
    assert.equal(resolveWorkspaceLocation(url,[record],allowed),null,url);
  }
  assert.equal(resolveWorkspaceLocation('/records/a',[record],new Set()),null);
  assert.equal(resolveWorkspaceLocation('/records/%2E%2E',[record],allowed),null);
  assert.equal(resolveWorkspaceLocation('/records/a%2Fb',[record],allowed),null);
  assert.equal(resolveWorkspaceLocation('/records/a',[record,{...record,id:'other:record'}],new Set([record.id,'other:record'])),null);
});

test('a generated input validator rejects undeclared query arguments without coercion',()=>{
  const declared={...record,validateInput:input=>Object.keys(input).length===1&&typeof input.id==='string'};
  assert.equal(resolveWorkspaceLocation('/records/a',[declared],allowed)?.input.id,'a');
  assert.equal(resolveWorkspaceLocation('/records/a?unexpected=1',[declared],allowed),null);
  assert.equal(resolveWorkspaceLocation('/records/a?revision=1',[declared],allowed),null);
});

test('ordering keeps the pinned tab first and bounded panes refuse overflow', () => {
  const session={id:'s',principalId:'p',audience:'app'};
  const identity={audience:'app',getSnapshot:()=>({phase:'authenticated',session,pending:null}),subscribe:()=>()=>{}};
  const controller=createWorkspaceController({access:identity,views:[record],contextId:'application',
    projection:{sessionId:'s',principalId:'p',audience:'app',contextId:'application',
      compositionDigest:`sha256-${'a'.repeat(64)}`,epoch:1,viewIds:[record.id],navigationIds:[]}});
  for(let i=0;i<MAX_WORKSPACE_TABS;i++) assert.equal(controller.open(record.id,{id:String(i)}),true);
  assert.equal(controller.open(record.id,{id:'overflow'}),false);
  const second=controller.getSnapshot().tabs[1].id;
  assert.equal(controller.pin(second),true);
  assert.equal(controller.move(second,5),false);
  assert.equal(controller.move(controller.getSnapshot().tabs[2].id,0),true);
  assert.equal(controller.getSnapshot().tabs[0].id,second);
  controller.dispose();
});
