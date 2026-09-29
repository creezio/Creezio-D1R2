import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {runInThisContext} from 'node:vm';

let harness;
class FakeApp {
  constructor(){this.listeners=new Map();harness.app=this;}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  async connect(){}
  getHostCapabilities(){return harness.hasTools?{serverTools:{}}:{};}
  callServerTool(call){harness.calls.push(call);return harness.respond(call);}
  emit(name,value){this.listeners.get(name)?.(value);}
}
globalThis.__catalogWidgetApp=FakeApp;
globalThis.__catalogWidgetTransport=class {};
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/widgets/runtime.ts',import.meta.url))],
  platform:'browser',format:'cjs',bundle:true,write:false,plugins:[{name:'mcp-stub',setup(ctx){
    ctx.onResolve({filter:/^@modelcontextprotocol\/ext-apps$/},()=>({path:'mcp-stub',namespace:'test'}));
    ctx.onLoad({filter:/.*/,namespace:'test'},()=>({contents:
      'export const App=globalThis.__catalogWidgetApp; export const PostMessageTransport=globalThis.__catalogWidgetTransport;'}));
  }}]});
const compiled={exports:{}};
runInThisContext('(function(module,exports){'+bundle.outputFiles[0].text+'\n})')(compiled,compiled.exports);
const {mountCatalogWidget}=compiled.exports;

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.parent=null;this.listeners=new Map();this.textContent='';
    this.value='';this.disabled=false;this.hidden=false;this.isConnected=true;this.className='';this.src='';}
  appendChild(child){child.parent=this;this.children.push(child);return child;}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];
    for(const child of children)this.appendChild(child);}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  click(){if(!this.disabled)this.listeners.get('click')?.({});}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}
  querySelector(tag){return this.children.find(child=>child.tagName===tag)??null;}
}
class Observer {
  static pending=[];
  constructor(callback){this.callback=callback;Observer.pending.push(this);}
  observe(element){this.element=element;}
  disconnect(){this.element=null;}
  trigger(){this.callback([{isIntersecting:true}]);}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const product=id=>({id,sku:`SKU-${id}`,name:`Produit ${id}`,categoryId:null,priceMinor:1299,
  currency:'EUR',status:'published',revision:1,updatedAt:'2026-09-29T00:00:00Z'});
const ref={fileId:`f1_${'a'.repeat(64)}`,intentId:'intent',generation:'1',digest:'b'.repeat(64)};
const image=productId=>({productId,fileId:ref.fileId,digest:ref.digest,contentType:'image/png',reference:ref});
const render=(items,audience)=>({structuredContent:{kind:'creezio.widget.render.v1',
  instance:{audience},input:{items,nextCursor:null,complete:true,scanned:items.length}}});
const detail=(id,audience)=>({structuredContent:{kind:'creezio.widget.render.v1',instance:{audience},
  input:{product:{...product(id),description:'Description',attributes:[],createdAt:'2026-09-29T00:00:00Z'}}}});
const binary=()=>({content:[{type:'text',text:'Image privée remise au composant.'}],
  _meta:{'creezio/linkedImage':{schemaVersion:1,type:'image',mimeType:'image/png',
    data:Buffer.from([137,80,78,71]).toString('base64')}}});
function setup(respond,hasTools=true){
  Observer.pending=[];const ids=['catalog-widget','direct','status','results','query','name','sku',
    'price','description','attributes','images'];
  const elements=new Map(ids.map(id=>[id,new Element(id)]));
  globalThis.document={getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)};
  globalThis.window={parent:{},addEventListener:()=>{}};
  globalThis.IntersectionObserver=Observer;
  const urls=[],revoked=[];
  URL.createObjectURL=()=>{const value=`blob:${urls.length}`;urls.push(value);return value;};
  URL.revokeObjectURL=value=>revoked.push(value);
  harness={app:null,calls:[],respond,hasTools};
  return {elements,app:()=>harness.app,calls:harness.calls,urls,revoked};
}

test('app list loads one linked image only after a card becomes visible',async()=>{
  const ui=setup(async call=>call.name==='catalog_media_list'
    ?{structuredContent:{items:[image('p1')]}}:binary());
  await mountCatalogWidget('list');
  ui.app().emit('toolinput',{arguments:{audience:'app',instanceId:'widget-1'}});
  ui.app().emit('toolresult',render([product('p1')],'app'));
  assert.equal(ui.calls.length,0);
  assert.equal(ui.elements.get('results').children[0].children[0].className,'image');
  Observer.pending.at(-1).trigger();for(let i=0;i<4;i++)await tick();
  assert.deepEqual(ui.calls.map(call=>call.name),['catalog_media_list','catalog_linked_image_read']);
  assert.deepEqual(ui.calls[1].arguments,{recordId:'p1',reference:ref});
  assert.equal(ui.elements.get('results').children[0].children[0].children[0].tagName,'img');
  ui.app().emit('toolresult',render([product('p2')],'app'));
  assert.deepEqual(ui.revoked,['blob:0']);
});

test('admin widget remains text-only and does not request media',async()=>{
  const ui=setup(async()=>{throw new Error('image call not expected');});
  await mountCatalogWidget('list');
  ui.app().emit('toolinput',{arguments:{audience:'admin',instanceId:'widget-2'}});
  ui.app().emit('toolresult',render([product('p1')],'admin'));
  assert.equal(ui.elements.get('results').children[0].children[0].tagName,'strong');
  assert.equal(Observer.pending.length,0);assert.equal(ui.calls.length,0);
});

test('host without server tools keeps direct refresh disabled after rendering',async()=>{
  const ui=setup(async()=>{throw new Error('tool call not expected');},false);
  await mountCatalogWidget('list');
  ui.app().emit('toolresult',render([product('p1')],'admin'));
  assert.equal(ui.elements.get('direct').disabled,true);
  ui.elements.get('direct').click();
  assert.equal(ui.calls.length,0);
});

test('app detail keeps text and loads its bounded gallery on visibility',async()=>{
  const rows=Array.from({length:5},(_,index)=>({productId:'p1',contentType:'image/png',
    fileId:`f1_${String(index).repeat(64)}`,digest:String(index).repeat(64),
    reference:{...ref,fileId:`f1_${String(index).repeat(64)}`,digest:String(index).repeat(64)}}));
  const ui=setup(async call=>call.name==='catalog_media_list'?{structuredContent:{items:rows}}:binary());
  await mountCatalogWidget('detail');
  ui.app().emit('toolinput',{arguments:{audience:'app',instanceId:'widget-detail'}});
  ui.app().emit('toolresult',detail('p1','app'));
  assert.equal(ui.elements.get('name').textContent,'Produit p1');
  assert.equal(ui.calls.length,0);
  Observer.pending.at(-1).trigger();for(let i=0;i<12;i++)await tick();
  assert.equal(ui.calls.filter(call=>call.name==='catalog_linked_image_read').length,5);
  assert.equal(ui.elements.get('images').children.length,5);
  assert.equal(ui.elements.get('images').children[0].children[0].tagName,'img');
});

test('late image from an old product cannot replace the new card',async()=>{
  let resolveBinary;const ui=setup(async call=>call.name==='catalog_media_list'
    ?{structuredContent:{items:[image('p1')]}}:new Promise(resolve=>{resolveBinary=resolve;}));
  await mountCatalogWidget('list');
  ui.app().emit('toolinput',{arguments:{audience:'app',instanceId:'widget-3'}});
  ui.app().emit('toolresult',render([product('p1')],'app'));
  Observer.pending.at(-1).trigger();await tick();await tick();
  assert.equal(typeof resolveBinary,'function');
  ui.app().emit('toolresult',render([product('p2')],'app'));
  resolveBinary(binary());await tick();
  assert.equal(ui.urls.length,0);
  assert.equal(ui.elements.get('results').children[0].children[1].textContent,'Produit p2');
});
