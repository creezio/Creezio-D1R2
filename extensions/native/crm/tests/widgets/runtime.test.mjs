import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

let harness;
class FakeApp {
  constructor(){this.listeners=new Map();harness.app=this;}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  async connect(){if(harness.connectError)throw new Error('unavailable');}
  getHostCapabilities(){return harness.tools?{serverTools:{}}:{};}
  callServerTool(call){harness.calls.push(call);return harness.responses.shift()(call);}
  emit(name,value){this.listeners.get(name)?.(value);}
}
globalThis.__crmWidgetApp=FakeApp;
globalThis.__crmWidgetTransport=class {};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/widgets/runtime.ts',import.meta.url))],
  platform:'browser',format:'esm',bundle:true,write:false,plugins:[{name:'mcp-stub',setup(ctx){
    ctx.onResolve({filter:/^@modelcontextprotocol\/ext-apps$/},()=>({path:'mcp-stub',namespace:'test'}));
    ctx.onLoad({filter:/.*/,namespace:'test'},()=>({contents:
      'export const App=globalThis.__crmWidgetApp; export const PostMessageTransport=globalThis.__crmWidgetTransport;'}));
  }}]});
const {mountCrmWidget}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.textContent='';
    this.value='';this.disabled=false;this.isConnected=true;}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  click(){if(!this.disabled)this.listeners.get('click')?.({});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(tools=true){
  const elements=new Map(['crm-widget','status','results','name','fields','all','search','more','refresh','query']
    .map(id=>[id,new Element(id)]));
  globalThis.document={getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)};
  globalThis.window={parent:{}};
  harness={app:null,tools,connectError:false,calls:[],responses:[]};
  return {elements,app:()=>harness.app,calls:harness.calls,responses:harness.responses};
}
const item=(id,revision=1)=>({id,name:`Entreprise ${id}`,city:'Paris',website:null,notes:'Une note',
  createdAt:'2026-09-29T00:00:00Z',updatedAt:'2026-09-29T00:00:00Z',archivedAt:null,revision});
const render=input=>({structuredContent:{kind:'creezio.widget.render.v1',input}});
const action=output=>({structuredContent:{kind:'creezio.widget.action.v1',state:'succeeded',output}});
const names=element=>element.children.map(card=>card.children[0]?.textContent);

test('an errored historical result cannot replace a valid company card',async()=>{
  const {elements,app}=setup(false);await mountCrmWidget('company','list');
  app().emit('toolresult',render({items:[item('real')],nextCursor:null}));
  app().emit('toolresult',{...render({items:[item('forged')],nextCursor:null}),isError:true});
  assert.deepEqual(names(elements.get('results')),['Entreprise real']);
});

test('historical list stays read-only without direct host tools',async()=>{
  const {elements,app,calls}=setup(false);
  await mountCrmWidget('company','list');
  app().emit('toolresult',render({items:[item('a')],nextCursor:'next'}));
  assert.deepEqual(names(elements.get('results')),['Entreprise a']);
  elements.get('all').click();elements.get('more').click();
  assert.equal(calls.length,0);
  assert.match(elements.get('status').textContent,/lecture seule/);
});

test('list/search actions are deliberate, page by original query and cursor, and reject a refusal',async()=>{
  const {elements,app,calls,responses}=setup();
  await mountCrmWidget('company','list');
  assert.equal(calls.length,0);
  app().emit('toolinput',{arguments:{limit:2,query:'Alpha',archived:true}});
  app().emit('toolresult',render({items:[item('a')],nextCursor:'cursor-1'}));
  assert.equal(elements.get('more').disabled,false);
  responses.push(()=>Promise.resolve(action({items:[item('b')],nextCursor:null})));
  elements.get('more').click();await tick();
  assert.deepEqual(calls[0],{name:'crm_company_search',arguments:{limit:2,query:'Alpha',archived:true,cursor:'cursor-1'}});
  assert.deepEqual(names(elements.get('results')),['Entreprise b']);
  elements.get('query').value='Beta';
  responses.push(()=>Promise.resolve({isError:true}));
  elements.get('search').click();await tick();
  assert.deepEqual(calls[1],{name:'crm_company_search',arguments:{limit:10,query:'Beta'}});
  assert.deepEqual(names(elements.get('results')),['Entreprise b']);
  assert.match(elements.get('status').textContent,/refusée/);
  app().emit('toolresult',render({items:[item('stale')],nextCursor:null}));
  assert.deepEqual(names(elements.get('results')),['Entreprise b']);
});

test('detail refuses a stale or different item and never refreshes at mount',async()=>{
  const {elements,app,calls,responses}=setup();
  await mountCrmWidget('company','detail');
  app().emit('toolresult',render({item:item('a',3)}));
  assert.equal(calls.length,0);
  responses.push(()=>Promise.resolve(action({item:item('a',2)})));
  elements.get('refresh').click();await tick();
  assert.deepEqual(calls[0],{name:'crm_company_read',arguments:{id:'a'}});
  assert.equal(elements.get('name').textContent,'Entreprise a');
  assert.match(elements.get('status').textContent,/obsolète/);
  responses.push(()=>Promise.resolve(action({item:item('b',4)})));
  elements.get('refresh').click();await tick();
  assert.equal(elements.get('name').textContent,'Entreprise a');
});
