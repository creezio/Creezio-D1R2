import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldRefreshHostAccess} from '../../app/access/operation-refusal.ts';
import {createWorkspaceController} from '../../sdk/workspace/controller.ts';

const denied=code=>({kind:'rejected',code,status:code==='authentication_required'?401:403});
const optional=[
  'creezio.analytics:admin.collection.effective',
  'creezio.analytics:app.collection.effective',
  'creezio.analytics:admin.retention.preview',
  'creezio.pages-navigation:admin.sidebar.resolved',
  'creezio.pages-navigation:app.sidebar.resolved',
  'creezio.openai:admin.config.read',
  'creezio.openai:app.config.read',
  'creezio.openai:admin.models.list',
  'creezio.openai:app.models.list',
];

test('an optional operation refusal cannot revoke unrelated workspace or front panels',()=>{
  for(const binding of optional){
    assert.equal(shouldRefreshHostAccess(denied('forbidden'),binding),false,binding);
    assert.equal(shouldRefreshHostAccess(denied('forbidden'),binding,'status'),true,binding);
    assert.equal(shouldRefreshHostAccess(denied('authentication_required'),binding),true,binding);
    assert.equal(shouldRefreshHostAccess(denied('unauthorized'),binding),true,binding);
    assert.equal(shouldRefreshHostAccess({kind:'rejected',code:'forbidden',status:401},binding),true,binding);
  }
});

test('other forbidden operations still revalidate access and non-refusals do not',()=>{
  assert.equal(shouldRefreshHostAccess(denied('forbidden'),
    'creezio.conversations:admin.conversation.list'),true);
  assert.equal(shouldRefreshHostAccess(denied('forbidden'),
    'creezio.conversations:admin.conversation.read'),true);
  assert.equal(shouldRefreshHostAccess(denied('forbidden'),
    'creezio.conversations:admin.turn.start'),true);
  for(const binding of ['creezio.analytics:admin.retention.configure',
    'creezio.analytics:admin.retention.purge',
    'creezio.analytics:admin.collection.configure']){
    assert.equal(shouldRefreshHostAccess(denied('forbidden'),binding),true,binding);
  }
  assert.equal(shouldRefreshHostAccess({kind:'unknown',code:'outcome_unknown'},optional[0]),false);
  assert.equal(shouldRefreshHostAccess({kind:'execution',execution:{state:'succeeded'}},optional[0]),false);
});

test('a denied optional OpenAI read keeps an authorized conversation pane while an authentication loss purges it',()=>{
  const session={id:'session-1',principalId:'person-1',audience:'admin'};
  const access={audience:'admin',getSnapshot:()=>({phase:'authenticated',session,pending:null}),
    subscribe:()=>()=>{}};
  const view={id:'creezio.conversations:admin',moduleId:'creezio.conversations',title:'Conversations',
    route:'/admin/conversations',surfaces:['workspace'],audiences:['admin'],
    panel:{identityFields:[],navigation:'sdk',retention:'preserve',inactiveEffects:'suspend'}};
  const controller=createWorkspaceController({access,views:[view],contextId:'t33-context-b'});
  controller.setProjection({sessionId:session.id,principalId:session.principalId,audience:'admin',
    contextId:'t33-context-b',compositionDigest:`sha256-${'a'.repeat(64)}`,epoch:6,
    viewIds:[view.id],navigationIds:[]});
  assert.equal(controller.visit('/admin/conversations'),true);
  const pane=controller.getSnapshot().tabs[0];
  if(shouldRefreshHostAccess(denied('forbidden'),'creezio.openai:admin.config.read'))
    controller.revokeProjection();
  assert.equal(controller.getSnapshot().tabs[0],pane);
  if(shouldRefreshHostAccess(denied('authentication_required'),'creezio.openai:admin.config.read'))
    controller.revokeProjection();
  assert.equal(controller.getSnapshot().tabs.length,0);
  controller.dispose();
});
