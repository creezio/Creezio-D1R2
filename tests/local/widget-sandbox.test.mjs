import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {EventEmitter} from 'node:events';
import {startLocalWidgetSandbox} from '../../scripts/local/widget-sandbox.mjs';
import {awaitLocalWidgetSandboxReady} from '../../scripts/local/widget-handshake.mjs';
import {loadLocalConfiguration} from '../../scripts/local/config.mjs';

const digest=`sha256-${'a'.repeat(64)}`;
function fixture(t){
  const root=temporaryDirectory(t,'creezio-widget-relay-');
  mkdirSync(path.join(root,'.openai'));
  writeFileSync(path.join(root,'.openai','hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
  mkdirSync(path.join(root,'.creezio','generated'),{recursive:true});
  writeFileSync(path.join(root,'.creezio','generated','widget-catalog.ts'),'export const widgetCatalog = null;\n');
  return loadLocalConfiguration({root,origin:'http://127.0.0.1:5173',
    sandboxOrigin:'http://127.0.0.1:5175'});
}
const catalog={resources:[{cspProfileId:digest,text:'PRIVATE-WIDGET-HTML',uiMeta:{
  csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},permissions:{}}}]};

test('local relay serves only static profiles on a distinct port and disposes on shutdown',async t=>{
  const config=fixture(t);let launched,disposed=0;
  class Runtime {constructor(options){launched=options;this.ready=Promise.resolve();}async dispose(){disposed++;}}
  const relay=await startLocalWidgetSandbox(config,{Runtime,loadCatalog:async()=>catalog});
  assert.equal(launched.host,'127.0.0.1');assert.equal(launched.port,5175);
  assert.equal(launched.cf,false);assert.equal(launched.modules,true);
  assert.match(launched.script,/http:\/\/127\.0\.0\.1:5173/);
  assert.equal(launched.script.includes('PRIVATE-WIDGET-HTML'),false);
  assert.equal(relay.origin,config.sandboxOrigin);
  await relay.close();assert.equal(disposed,1);
});

test('failed relay startup disposes its runtime before main app can launch',async t=>{
  const config=fixture(t);let disposed=0;
  class Runtime {constructor(){this.ready=Promise.reject(new Error('Synthetic bind conflict'));}
    async dispose(){disposed++;}}
  await assert.rejects(startLocalWidgetSandbox(config,{Runtime,loadCatalog:async()=>catalog}),
    /Synthetic bind conflict/);
  assert.equal(disposed,1);
});

test('local configuration refuses shared or remote sandbox origins',t=>{
  const config=fixture(t);
  for(const sandboxOrigin of [config.origin,'https://widgets.example.invalid',
    'http://0.0.0.0:5175','http://127.0.0.1:5175/path','http://127.0.0.1:999'])
    assert.throws(()=>loadLocalConfiguration({root:config.root,origin:config.origin,sandboxOrigin}));
});

test('Vite child handshake resolves only after parent relay acknowledgement and times out otherwise',async()=>{
  const previous=process.env.CREEZIO_LOCAL_WIDGET_HANDSHAKE;
  process.env.CREEZIO_LOCAL_WIDGET_HANDSHAKE='1';
  try{
    const child=new EventEmitter();child.connected=true;child.send=(value,callback)=>{
      assert.deepEqual(value,{type:'creezio-widget-catalog-ready',version:1});callback();};
    const ready=awaitLocalWidgetSandboxReady(child,{timeoutMs:1000});
    child.emit('message',{type:'irrelevant',version:1});
    child.emit('message',{type:'creezio-widget-sandbox-ready',version:1});
    await ready;
    assert.equal(child.listenerCount('message'),0);
    const stalled=new EventEmitter();stalled.connected=true;stalled.send=(_value,callback)=>callback();
    await assert.rejects(awaitLocalWidgetSandboxReady(stalled,{timeoutMs:10}),/timed out/);
    assert.equal(stalled.listenerCount('message'),0);
  }finally{
    if(previous===undefined)delete process.env.CREEZIO_LOCAL_WIDGET_HANDSHAKE;
    else process.env.CREEZIO_LOCAL_WIDGET_HANDSHAKE=previous;
  }
});
