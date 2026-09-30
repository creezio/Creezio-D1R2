import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInThisContext} from 'node:vm';

let harness;
class FakeApp{
  constructor(){this.listeners=new Map();harness.app=this;}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  async connect(){if(harness.connectError)throw new Error('unavailable');}
  getHostCapabilities(){return harness.tools?{serverTools:{}}:{};}
  callServerTool(call){harness.calls.push(call);return harness.responses.shift()(call);}
  emit(name,value){this.listeners.get(name)?.(value);}
}
globalThis.__supportWidgetApp=FakeApp;
globalThis.__supportWidgetTransport=class {};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/widgets/runtime.ts',import.meta.url))],
  platform:'browser',format:'cjs',bundle:true,write:false,plugins:[{name:'mcp-stub',setup(ctx){
    ctx.onResolve({filter:/^@modelcontextprotocol\/ext-apps$/},()=>({path:'mcp-stub',namespace:'test'}));
    ctx.onLoad({filter:/.*/,namespace:'test'},()=>({contents:
      'export const App=globalThis.__supportWidgetApp; export const PostMessageTransport=globalThis.__supportWidgetTransport;'}));
  }}]});
// Execute this module's bundled source only; no external module loader is available.
const compiled={exports:{}};
runInThisContext('(function(module,exports){'+bundle.outputFiles[0].text+'\n})')
  (compiled,compiled.exports);
const {mountSupportWidget}=compiled.exports;
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.textContent='';
    this.value='';this.disabled=false;this.hidden=false;this.isConnected=true;}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  click(){if(!this.disabled)this.listeners.get('click')?.({});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(tools=true){
  const ids=['support-widget','status','results','opened','opened-title','opened-meta','create-panel',
    'query','list','more','subject','body','create','refresh','messages-load','messages-more','messages','reply','send',
    'ticket-meta'];
  const elements=new Map(ids.map(id=>[id,new Element(id)]));
  globalThis.document={getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)};
  globalThis.window={parent:{}};
  harness={app:null,tools,connectError:false,calls:[],responses:[]};
  return {elements,app:()=>harness.app,calls:harness.calls,responses:harness.responses};
}
const ticket=(id,revision=1)=>({id,requesterId:'actor',subject:`Sujet ${id}`,status:'ouvert',
  assignedTo:null,createdAt:'2026-09-29T00:00:00Z',updatedAt:'2026-09-29T00:00:00Z',
  lastMessageAt:null,lastPreview:null,messageCount:0,revision});
const render=(input,audience='app',host)=>({structuredContent:{kind:'creezio.widget.render.v1',
  instance:{audience,...(host?{host}:{})},input}});
const action=output=>({structuredContent:{kind:'creezio.widget.action.v1',state:'succeeded',output}});

test('host error does not accept a forged successful ticket page',async()=>{
  const {elements,app,responses}=setup();await mountSupportWidget('list','app');
  app().emit('toolresult',render({items:[ticket('real')],nextCursor:null}));
  responses.push(()=>Promise.resolve({...action({items:[ticket('forged')],nextCursor:null}),isError:true}));
  elements.get('list').click();await tick();
  assert.equal(elements.get('results').children[0].children[0].textContent,'Sujet real');
  assert.match(elements.get('status').textContent,/indisponible/);
});

test('historical card mounts without an operation and without tools remains readonly',async()=>{
  const {elements,app,calls}=setup(false);
  await mountSupportWidget('list','app');
  app().emit('toolresult',render({items:[ticket('t1')],nextCursor:'cursor'}));
  assert.equal(calls.length,0);
  assert.equal(elements.get('results').children[0].children[0].textContent,'Sujet t1');
  elements.get('list').click();elements.get('create').click();
  assert.equal(calls.length,0);
  assert.match(elements.get('status').textContent,/Lecture seule/);
});

test('app list creates once and a transmitted command blocks a second dispatch',async()=>{
  const {elements,app,calls,responses}=setup();
  await mountSupportWidget('list','app');
  assert.equal(elements.get('create').disabled,true);
  elements.get('create').click();assert.equal(calls.length,0);
  app().emit('toolresult',render({items:[],nextCursor:null}));
  assert.equal(elements.get('create').disabled,false);
  elements.get('subject').value='Incident';elements.get('body').value='Détail';
  responses.push(()=>Promise.resolve({structuredContent:{kind:'creezio.widget.action.v1',state:'transmitted'}}));
  elements.get('create').click();await tick();
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'support_ticket_create');
  assert.equal(calls[0].arguments.subject,'Incident');
  assert.match(calls[0].arguments.requestKey,/^[a-f0-9-]{36}$/);
  assert.equal(elements.get('create').disabled,true);
  elements.get('create').click();await tick();assert.equal(calls.length,1);
  assert.match(elements.get('status').textContent,/incertain/);
  app().emit('toolresult',render({items:[],nextCursor:null},'admin'));
  assert.match(elements.get('status').textContent,/incertain/);
});

test('admin list cannot create and pagination reuses declared query, status and cursor',async()=>{
  const {elements,app,calls,responses}=setup();
  await mountSupportWidget('list','admin');
  app().emit('toolinput',{arguments:{limit:3,query:'Sujet',status:'ouvert'}});
  app().emit('toolresult',render({items:[ticket('t1')],nextCursor:'c1'},'admin'));
  assert.equal(elements.get('create-panel').hidden,true);
  assert.equal(elements.get('more').disabled,false);
  responses.push(()=>Promise.resolve(action({items:[ticket('t2')],nextCursor:null})));
  elements.get('more').click();await tick();
  assert.deepEqual(calls[0],{name:'support_ticket_list_admin',arguments:{limit:3,query:'Sujet',status:'ouvert',cursor:'c1'}});
  assert.equal(elements.get('results').children[0].children[0].textContent,'Sujet t2');
});

test('native historical page without original filters explains why next page waits for refresh',async()=>{
  const {elements,app}=setup();
  await mountSupportWidget('list','app');
  app().emit('toolresult',render({items:[ticket('t1')],nextCursor:'c1'}));
  assert.equal(elements.get('more').disabled,true);
  assert.match(elements.get('status').textContent,/actualisez la liste/);
});

test('opening from list reads the same ticket and its fil inside the card',async()=>{
  const {elements,app,calls,responses}=setup();
  await mountSupportWidget('list','app');
  app().emit('toolresult',render({items:[ticket('t1',2)],nextCursor:null}));
  responses.push(()=>Promise.resolve(action({item:ticket('t1',2)})));
  responses.push(()=>Promise.resolve(action({items:[{id:'m1',ticketId:'t1',origin:'support',
    authorId:'agent',body:'Bonjour',createdAt:'2026-09-29T00:00:00Z'}],nextCursor:null})));
  elements.get('results').children[0].children[2].click();await tick();
  assert.equal(calls[0].name,'support_ticket_open_app');
  app().emit('toolresult',render({items:[ticket('old')],nextCursor:null}));
  assert.equal(elements.get('results').children[0].children[0].textContent,'Sujet t1');
  assert.equal(elements.get('opened').hidden,false);
  assert.equal(elements.get('opened-title').textContent,'Sujet t1');
  assert.equal(calls[1].name,'support_message_list_app_list');
  assert.equal(elements.get('messages').children[0].children[1].textContent,'Bonjour');
});

test('an initially empty message page keeps its ticket in a list card',async()=>{
  const {elements,app,calls}=setup();
  await mountSupportWidget('list','app');
  app().emit('toolinput',{arguments:{ticketId:'t1',limit:20}});
  app().emit('toolresult',render({items:[],nextCursor:null}));
  assert.equal(calls.length,0);
  assert.equal(elements.get('opened').hidden,false);
  assert.equal(elements.get('messages-load').disabled,false);
  assert.equal(elements.get('messages').children[0].textContent,'Aucun message dans ce fil.');
  assert.equal(elements.get('results').children.length,0);
});

test('a thread card accepts an enveloped initial reply result',async()=>{
  const {elements,app,calls}=setup();
  await mountSupportWidget('thread','app');
  app().emit('toolresult',render({ticket:ticket('t1',3),item:{id:'m1',ticketId:'t1',
    origin:'client',authorId:'actor',body:'Réponse du client',createdAt:'2026-09-29T00:00:00Z'}}));
  assert.equal(calls.length,0);
  assert.equal(elements.get('subject').textContent,'Sujet t1');
  assert.equal(elements.get('messages').children[0].children[1].textContent,'Réponse du client');
  assert.equal(elements.get('send').disabled,false);
});

test('admin thread reads the fil and replies using exact ticket revision, with no mount dispatch',async()=>{
  const {elements,app,calls,responses}=setup();
  await mountSupportWidget('thread','admin');
  app().emit('toolresult',render({item:ticket('t1',4)},'admin'));
  assert.equal(calls.length,0);
  responses.push(()=>Promise.resolve(action({items:[{id:'m1',ticketId:'t1',origin:'client',
    authorId:'actor',body:'Question',createdAt:'2026-09-29T00:00:00Z'}],nextCursor:null})));
  elements.get('messages-load').click();await tick();
  assert.deepEqual(calls[0],{name:'support_message_list_admin',arguments:{ticketId:'t1',limit:20}});
  assert.equal(elements.get('messages').children[0].children[1].textContent,'Question');
  elements.get('reply').value='Réponse';
  responses.push(()=>Promise.resolve(action({item:{id:'m2',ticketId:'t1',origin:'support',
    authorId:'agent',body:'Réponse',createdAt:'2026-09-29T00:00:00Z'},ticket:ticket('t1',5)})));
  elements.get('send').click();await tick();
  assert.equal(calls[1].name,'support_message_reply');
  assert.equal(calls[1].arguments.revision,4);
  assert.equal(calls[1].arguments.body,'Réponse');
  assert.equal(elements.get('reply').value,'');
});

test('external MCP command stores its key before dispatch and blocks after unknown across remount',async()=>{
  const stored=new Map();
  globalThis.sessionStorage={get length(){return stored.size;},key:index=>[...stored.keys()][index]??null,
    getItem:key=>stored.get(key)??null,
    setItem:(key,value)=>{stored.set(key,value);},removeItem:key=>{stored.delete(key);}};
  let view=setup();await mountSupportWidget('list','app');
  view.app().emit('toolresult',render({items:[],nextCursor:null},'app','external-mcp'));
  view.elements.get('subject').value='Incident';
  view.responses.push(()=>Promise.resolve({isError:true}));
  view.elements.get('create').click();await tick();
  assert.equal(view.calls.length,1);
  const [key]=stored.keys();assert.match(key,/creezio\.support\.widget\.pending/);
  assert.equal(JSON.parse(stored.get(key)).requestKey,view.calls[0].arguments.requestKey);
  view=setup();await mountSupportWidget('list','app');
  view.app().emit('toolresult',render({items:[],nextCursor:null},'app','external-mcp'));
  assert.equal(view.elements.get('create').disabled,true);
  view.elements.get('create').click();await tick();assert.equal(view.calls.length,0);
  stored.clear();delete globalThis.sessionStorage;
});

test('external journal entries are per command and cleanup cannot erase another pending key',async()=>{
  const stored=new Map();
  globalThis.sessionStorage={get length(){return stored.size;},key:index=>[...stored.keys()][index]??null,
    getItem:key=>stored.get(key)??null,
    setItem:(key,value)=>{stored.set(key,value);},removeItem:key=>{stored.delete(key);}};
  const {elements,app,calls,responses}=setup();
  await mountSupportWidget('list','app');
  app().emit('toolresult',render({items:[],nextCursor:null},'app','external-mcp'));
  elements.get('subject').value='Un ticket';
  responses.push(()=>{
    stored.set('creezio.support.widget.pending.v1.app.foreign',JSON.stringify({requestKey:'foreign'}));
    return Promise.resolve(render({item:ticket('new')},'app','external-mcp'));
  });
  elements.get('create').click();await tick();
  assert.equal(calls.length,1);
  assert.deepEqual([...stored.keys()],['creezio.support.widget.pending.v1.app.foreign']);
  delete globalThis.sessionStorage;
});

test('external MCP direct query unwraps server render envelope',async()=>{
  const {elements,app,calls,responses}=setup();
  await mountSupportWidget('thread','app');
  app().emit('toolresult',render({item:ticket('t1',2)},'app'));
  responses.push(()=>Promise.resolve(render({items:[{id:'m1',ticketId:'t1',origin:'support',
    authorId:'agent',body:'Réponse',createdAt:'2026-09-29T00:00:00Z'}],nextCursor:null},'app')));
  elements.get('messages-load').click();await tick();
  assert.equal(calls[0].name,'support_message_list');
  assert.equal(elements.get('messages').children[0].children[1].textContent,'Réponse');
});
