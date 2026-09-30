import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

let state;
class FakeApp{
  constructor(){this.listeners=new Map();state.app=this;}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  async connect(){}
  getHostCapabilities(){return state.tools?{serverTools:{}}:{}}
  callServerTool(call){state.calls.push(call);return state.responses.shift()(call);}
  emit(name,value){this.listeners.get(name)?.(value);}
}
globalThis.__messagingApp=FakeApp;globalThis.__messagingTransport=class{};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/widgets/runtime.ts',import.meta.url))],
  platform:'browser',format:'esm',bundle:true,write:false,plugins:[{name:'mcp-stub',setup(ctx){
    ctx.onResolve({filter:/^@modelcontextprotocol\/ext-apps$/},()=>({path:'mcp-stub',namespace:'test'}));
    ctx.onLoad({filter:/.*/,namespace:'test'},()=>({contents:
      'export const App=globalThis.__messagingApp; export const PostMessageTransport=globalThis.__messagingTransport;'}));
  }}]});
const moduleUrl='data:text/javascript;base64,'+
  Buffer.from(bundle.outputFiles[0].text).toString('base64');
const {mountMessagingWidget}=await import(moduleUrl);
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.textContent='';
    this.value='';this.disabled=false;this.isConnected=true;}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  click(){if(!this.disabled)this.listeners.get('click')?.({});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(tools=true){
  const elements=new Map(['messaging-widget','status','list','more','refresh','search','folder','query','reader']
    .map(id=>[id,new Element(id)]));
  globalThis.document={getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)};
  globalThis.window={parent:{}};
  state={app:null,tools,calls:[],responses:[]};return {elements,...state};
}
const row=(id)=>({id,boxId:'box-one',direction:'inbound',peerExcerpt:'A',peerHasMore:false,
  subjectExcerpt:'Sujet',subjectHasMore:false,bodyExcerpt:'Bonjour',bodyHasMore:false,
  state:'received',folder:'inbox',read:false,threadId:null,receivedAt:null,sentAt:null,revision:1});
const render=input=>({structuredContent:{kind:'creezio.widget.render.v1',input}});
const action=output=>({structuredContent:{kind:'creezio.widget.action.v1',state:'succeeded',output}});

test('a host error cannot smuggle a successful list through structured content',async()=>{
  const h=setup();await mountMessagingWidget('messages');
  state.app.emit('toolinput',{arguments:{boxId:'box-one',limit:5}});
  state.app.emit('toolresult',render({items:[row('one')],nextCursor:null}));
  h.responses.push(()=>Promise.resolve({...action({items:[row('spoofed')],nextCursor:null}),isError:true}));
  h.elements.get('refresh').click();await tick();
  assert.equal(h.elements.get('list').children.length,1);
  assert.match(h.elements.get('status').textContent,/refusée/);
});

test('history is read-only without tools and never calls at mount',async()=>{
  const h=setup(false);await mountMessagingWidget('messages');
  state.app.emit('toolresult',render({items:[row('one')],nextCursor:'next'}));
  assert.equal(h.calls.length,0);h.elements.get('more').click();
  assert.equal(h.calls.length,0);
  assert.match(h.elements.get('status').textContent,/lecture seule/);
});
test('explicit page uses captured box and cursor; stale history cannot replace it',async()=>{
  const h=setup();await mountMessagingWidget('messages');
  state.app.emit('toolinput',{arguments:{boxId:'box-one',folder:'inbox',limit:5}});
  state.app.emit('toolresult',render({items:[row('one')],nextCursor:'cursor-one'}));
  h.responses.push(()=>Promise.resolve(action({items:[row('two')],nextCursor:null})));
  h.elements.get('more').click();await tick();
  assert.deepEqual(h.calls[0],{name:'messaging_message_preview_list',
    arguments:{boxId:'box-one',folder:'inbox',limit:5,cursor:'cursor-one'}});
  assert.match(h.elements.get('list').children[0].children[0].textContent,/Sujet/);
  state.app.emit('toolresult',render({items:[row('stale')],nextCursor:null}));
  assert.equal(h.elements.get('list').children.length,1);
  h.responses.push(()=>Promise.resolve(action({message:{id:'two',boxId:'box-one',subject:'Sujet',
    text:'Détail relu',html:'',revision:1}})));
  h.elements.get('list').children[0].children.at(-1).click();await tick();
  assert.equal(h.calls[1].name,'messaging_message_read');
});
test('detail is fetched on click and HTML remains unrendered',async()=>{
  const h=setup();await mountMessagingWidget('messages');
  state.app.emit('toolinput',{arguments:{boxId:'box-one',limit:5}});
  state.app.emit('toolresult',render({items:[row('one')],nextCursor:null}));
  h.responses.push(()=>Promise.resolve(action({message:{id:'one',boxId:'box-one',subject:'Sujet',
    text:'',html:'<img src=x onerror=alert(1)>',revision:1}})));
  h.elements.get('list').children[0].children.at(-1).click();await tick();
  assert.equal(h.calls[0].name,'messaging_message_read');
  assert.match(h.elements.get('reader').children.at(-1).textContent,/ouvrir la messagerie/);
  assert.doesNotMatch(JSON.stringify(h.elements.get('reader').children),/<img/);
});
test('an explicit read result renders safely without a second tool call',async()=>{
  const h=setup(false);await mountMessagingWidget('messages');
  state.app.emit('toolresult',render({message:{id:'one',boxId:'box-one',subject:'Direct',
    text:'Contenu lu',html:'<img src=x onerror=alert(1)>',revision:1}}));
  assert.equal(h.calls.length,0);
  assert.equal(h.elements.get('reader').children.at(-1).textContent,'Contenu lu');
  assert.doesNotMatch(JSON.stringify(h.elements.get('reader').children),/<img/);
});
test('unicode excerpts use code points and boxes can refresh explicitly',async()=>{
  const h=setup();await mountMessagingWidget('boxes');
  state.app.emit('toolresult',render({items:[{id:'one',nameExcerpt:'😀'.repeat(48),
    nameHasMore:true,addressExcerpt:'a',addressHasMore:false,revision:1}],nextCursor:null}));
  assert.match(h.elements.get('list').children[0].children[0].textContent,/😀/);
  h.responses.push(()=>Promise.resolve(action({items:[],nextCursor:null})));
  h.elements.get('refresh').click();await tick();
  assert.deepEqual(h.calls[0],{name:'messaging_box_preview_list',arguments:{limit:5}});
});
