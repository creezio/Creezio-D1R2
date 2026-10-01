import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldRefreshHostAccess} from '../../app/access/operation-refusal.ts';

const denied=code=>({kind:'rejected',code,status:code==='authentication_required'?401:403});
const optional=[
  'creezio.analytics:admin.collection.effective',
  'creezio.analytics:app.collection.effective',
  'creezio.analytics:admin.retention.preview',
  'creezio.pages-navigation:admin.sidebar.resolved',
  'creezio.pages-navigation:app.sidebar.resolved',
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
  for(const binding of ['creezio.analytics:admin.retention.configure',
    'creezio.analytics:admin.retention.purge',
    'creezio.analytics:admin.collection.configure']){
    assert.equal(shouldRefreshHostAccess(denied('forbidden'),binding),true,binding);
  }
  assert.equal(shouldRefreshHostAccess({kind:'unknown',code:'outcome_unknown'},optional[0]),false);
  assert.equal(shouldRefreshHostAccess({kind:'execution',execution:{state:'succeeded'}},optional[0]),false);
});
