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
globalThis.__analyticsApp=FakeApp;globalThis.__analyticsTransport=class{};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/widgets/runtime.ts',import.meta.url))],
  platform:'browser',format:'esm',bundle:true,write:false,plugins:[{name:'mcp-stub',setup(ctx){
    ctx.onResolve({filter:/^@modelcontextprotocol\/ext-apps$/},()=>({path:'mcp-stub',namespace:'test'}));
    ctx.onLoad({filter:/.*/,namespace:'test'},()=>({contents:
      'export const App=globalThis.__analyticsApp; export const PostMessageTransport=globalThis.__analyticsTransport;'}));
  }}]});
const moduleUrl='data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64');
const {mountAnalyticsWidget}=await import(moduleUrl);
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.textContent='';
    this.value='';this.disabled=false;this.isConnected=true;}
  append(...children){this.children.push(...children);}
  appendChild(child){this.children.push(child);return child;}
  setAttribute(name,value){this[name]=value;}
  replaceChildren(...children){this.children=children;}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  click(){if(!this.disabled)this.listeners.get('click')?.({});}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(tools=true){
  const elements=new Map(['analytics-widget','status','result','more','refresh','period','query']
    .map(id=>[id,new Element(id)]));
  elements.get('period').value='week';
  globalThis.document={getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),
    createElementNS:(_namespace,tag)=>new Element(tag)};
  globalThis.window={parent:{}};
  state={app:null,tools,calls:[],responses:[]};return elements;
}
const period={period:'week',from:'2026-09-22T12:00:00.000Z',to:'2026-09-29T12:00:00.000Z'};
const summary=(cursor=null)=>({period,source:'reported',complete:cursor===null,scanned:1,nextCursor:cursor,
  totals:{events:1,pageViews:0,clicks:0,errors:0,reportedDurationMs:0},activePrincipals:1,
  timeline:[{name:'2026-09-29',count:1}]});
const event=(id)=>({id,type:'activity',surface:'admin',path:null,
  actionId:null,errorCode:null,occurredAt:'2026-09-29T12:00:00.000Z'});
const render=input=>({structuredContent:{kind:'creezio.widget.render.v1',input}});
const action=output=>({structuredContent:{kind:'creezio.widget.action.v1',state:'succeeded',output}});

test('summary history stays read-only without server tools and labels segment totals',async()=>{
  const ui=setup(false);await mountAnalyticsWidget('summary');
  state.app.emit('toolresult',render(summary()));
  assert.equal(state.calls.length,0);ui.get('refresh').click();assert.equal(state.calls.length,0);
  assert.equal(ui.get('result').children[1].textContent,'Totaux du segment');
  assert.match(ui.get('status').textContent,/lecture seule/);
});
test('events action carries the captured cursor and replaces the page',async()=>{
  const ui=setup();await mountAnalyticsWidget('events');
  state.app.emit('toolinput',{arguments:{period:'week'}});
  state.app.emit('toolresult',render({period,items:[event('old')],nextCursor:'next',complete:false,scanned:1}));
  state.responses.push(()=>Promise.resolve(action({period,items:[event('new')],nextCursor:null,
    complete:true,scanned:1})));
  ui.get('more').click();await tick();
  assert.deepEqual(state.calls[0],{name:'analytics_analytics_widget_events',arguments:{period:'week',cursor:'next'}});
  assert.equal(ui.get('result').children.filter(item=>item.tagName==='article').length,1);
  state.app.emit('toolresult',render({period,items:[event('stale')],nextCursor:null,
    complete:true,scanned:1}));
  assert.equal(ui.get('result').children.filter(item=>item.tagName==='article').length,1);
});
test('historical filtered result without tool input cannot paginate with invented filters',async()=>{
  const ui=setup();await mountAnalyticsWidget('events');
  const monthly={...period,period:'month'};
  state.app.emit('toolresult',render({period:monthly,items:[event('old')],nextCursor:'next',
    complete:false,scanned:1}));
  assert.equal(ui.get('more').disabled,true);
  assert.match(ui.get('result').children.at(-1).textContent,/relancez cette liste avec ses filtres/);
  ui.get('more').click();assert.equal(state.calls.length,0);
});
test('captured filters remain visible and are preserved on refresh',async()=>{
  const ui=setup();await mountAnalyticsWidget('events');
  state.app.emit('toolinput',{arguments:{period:'month',query:'achat',type:'click',principalId:'owner'}});
  state.app.emit('toolresult',render({period:{...period,period:'month'},items:[event('old')],
    nextCursor:'next',complete:false,scanned:1}));
  assert.equal(ui.get('period').value,'month');
  assert.equal(ui.get('query').value,'achat');
  assert.match(ui.get('result').children[1].textContent,/recherche appliquée.*type filtré.*émetteur filtré/);
  state.responses.push(()=>Promise.resolve(action({period:{...period,period:'month'},items:[event('new')],
    nextCursor:null,complete:true,scanned:1})));
  ui.get('refresh').click();await tick();
  assert.deepEqual(state.calls[0].arguments,
    {period:'month',query:'achat',type:'click',principalId:'owner'});
});
test('invalid or oversized result is explicit and never triggers a hidden call',async()=>{
  const ui=setup();await mountAnalyticsWidget('events');
  state.app.emit('toolresult',render({period,items:Array.from({length:6},(_,i)=>event(String(i))),
    nextCursor:null,complete:true,scanned:6}));
  assert.match(ui.get('status').textContent,/trop volumineux/);
  assert.equal(state.calls.length,0);
});
