import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../sdk/widgets/provider.tsx',import.meta.url))],
  bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
const module={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {createWidgetLinkContinuity}=module.exports;

const digest=`sha256-${'a'.repeat(64)}`;
const scope=()=>({sessionId:'session_1',principalId:'principal_1',audience:'app',contextId:'application',
  conversationId:'conversation_1',messageId:'message_1',instanceSignature:'instance_1:revision_1',
  instanceId:'instance_1',instanceRevision:1,
  moduleId:'creezio.stripe',widgetId:'checkout-status',widgetVersion:'0.5.0',
  resourceUri:'ui://creezio/stripe/status',resourceDigest:digest,catalogEpoch:7});
const session=()=>({id:'session_1',principalId:'principal_1',audience:'app'});
const config=()=>({sandboxOrigin:'https://sandbox.example.test',sessionId:'session_1',principalId:'principal_1',
  audience:'app',contextId:'application',epoch:7,
  widgets:[{moduleId:'creezio.stripe',widgetId:'checkout-status',version:'0.5.0',
    resourceUri:'ui://creezio/stripe/status',resourceDigest:digest,audiences:['app']}],
  resources:[{moduleId:'creezio.stripe',widgetId:'checkout-status',version:'0.5.0',
    uri:'ui://creezio/stripe/status',digest,audiences:['app']}]});
const url='https://checkout.stripe.com/c/pay/cs_test_existing';
const retain=(continuity,selectedScope=scope(),selectedUrl=url,selectedConfig=config(),
  generation=continuity.generation())=>continuity.retain(selectedScope,selectedUrl,selectedConfig,generation);

test('a suspended host link resumes once only after the same fresh session, scope and catalog',()=>{
  const continuity=createWidgetLinkContinuity();
  assert.equal(retain(continuity),true);
  assert.equal(continuity.take(scope(),null,null),null);
  // The host deliberately does not call take until the new session/catalog are ready.
  assert.equal(retain(continuity),true);
  assert.equal(continuity.take(scope(),config(),session()),url);
  assert.equal(continuity.take(scope(),config(),session()),null);
  continuity.clear();
});

test('keyboard focus intent needs a forward Tab and is cancelled by later interaction',()=>{
  let time=1000;
  const continuity=createWidgetLinkContinuity({now:()=>time});
  assert.equal(continuity.retain(scope(),url,config(),continuity.generation(),true),true);
  assert.equal(continuity.keyboardFocus(scope()),false);
  continuity.confirmForwardTab();
  assert.equal(continuity.keyboardFocus(scope()),true);
  continuity.cancelFocus();
  assert.equal(continuity.keyboardFocus(scope()),false);
  assert.equal(continuity.take(scope(),config(),session()),url);
  assert.equal(continuity.retain(scope(),url,config(),continuity.generation(),true),true);
  time+=1001;
  continuity.confirmForwardTab();
  assert.equal(continuity.keyboardFocus(scope()),false);
  continuity.clear();
});

test('continuation refuses changed identity, instance, resource, epoch and missing permission',()=>{
  const variants=[
    {name:'session',session:{...session(),id:'session_2'}},
    {name:'principal',session:{...session(),principalId:'principal_2'}},
    {name:'audience',session:{...session(),audience:'admin'}},
    {name:'context',scope:{...scope(),contextId:'other'}},
    {name:'conversation',scope:{...scope(),conversationId:'conversation_2'}},
    {name:'message',scope:{...scope(),messageId:'message_2'}},
    {name:'instance',scope:{...scope(),instanceSignature:'instance_2'}},
    {name:'resource',config:{...config(),resources:[]}},
    {name:'catalog epoch',config:{...config(),epoch:8}},
    {name:'widget permission',config:{...config(),widgets:[{...config().widgets[0],audiences:['admin']}]}},
    {name:'changed widget action',config:{...config(),widgets:[{...config().widgets[0],actions:[{id:'new'}]}]}},
    {name:'changed sandbox',config:{...config(),sandboxOrigin:'https://other.example.test'}},
  ];
  for(const variant of variants){
    const continuity=createWidgetLinkContinuity();
    assert.equal(retain(continuity),true,variant.name);
    assert.equal(continuity.take(variant.scope??scope(),variant.config??config(),variant.session??session()),null,
      variant.name);
    continuity.clear();
  }
  const changed=createWidgetLinkContinuity();
  assert.equal(retain(changed),true);
  assert.equal(changed.take({...scope(),instanceRevision:2,instanceSignature:'instance_1:revision_2'},config(),session()),null);
  assert.equal(changed.take(scope(),config(),session()),null,'new revision discards the old instance intent');
  changed.clear();
});

test('conversation closure, revocation and expiry discard memory-only URLs without opening them',()=>{
  let time=1000, callback=null, cancelled=0;
  const continuity=createWidgetLinkContinuity({now:()=>time,schedule:fn=>{callback=fn;return 1;},
    unschedule:()=>{cancelled++;callback=null;}});
  assert.equal(retain(continuity),true);
  continuity.discardConversation('conversation_2');
  assert.equal(continuity.take(scope(),config(),session()),url);
  assert.equal(retain(continuity),true);
  continuity.discardConversation('conversation_1');
  assert.equal(continuity.take(scope(),config(),session()),null);
  assert.equal(retain(continuity),true);
  continuity.clear(); // logout or confirmed revocation from the provider subscription
  assert.equal(continuity.take(scope(),config(),session()),null);
  assert.equal(retain(continuity),true);
  time+=60_000;
  assert.equal(continuity.take(scope(),config(),session()),null);
  assert.ok(cancelled>=3);
  assert.equal(callback,null);
});

test('selecting another conversation during access loading cancels the held link before fresh access',()=>{
  const continuity=createWidgetLinkContinuity();
  const oldWidgetGeneration=continuity.generation();
  assert.equal(retain(continuity),true);
  // The conversation view signals selection or closure while the access snapshot has no session.
  continuity.discardConversation('conversation_1');
  assert.equal(retain(continuity,scope(),url,config(),oldWidgetGeneration),false,
    'the old widget cleanup cannot recreate a link after explicit closure');
  assert.equal(continuity.take(scope(),config(),session()),null);
  assert.equal(retain(continuity),true,'a new widget mounted after selection uses the new generation');
  continuity.clear();
});

test('the host retains only canonical HTTPS, the pinned resource and a bounded number of links',()=>{
  const continuity=createWidgetLinkContinuity();
  assert.equal(retain(continuity,scope(),'http://checkout.stripe.com/'),false);
  assert.equal(retain(continuity,scope(),url,{...config(),resources:[]}),false);
  for(let index=0;index<8;index++)assert.equal(retain(continuity,{...scope(),messageId:`message_${index}`}),true);
  assert.equal(retain(continuity,{...scope(),messageId:'message_9'}),false);
  continuity.clear();
});
