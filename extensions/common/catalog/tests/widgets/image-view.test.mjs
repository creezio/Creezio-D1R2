import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../../ui/widgets/image-view.ts',import.meta.url))],
  platform:'browser',format:'esm',bundle:true,write:false});
const {createWidgetImageView,linkedImageFromResult,linkedMediaFromResult}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.listeners=new Map();this.textContent='';
    this.isConnected=true;this.parent=null;this.src='';}
  appendChild(child){child.parent=this;this.children.push(child);return child;}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];
    for(const child of children)this.appendChild(child);}
  addEventListener(name,callback){this.listeners.set(name,callback);}
  remove(){if(!this.parent)return;this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}
  querySelector(tag){return this.children.find(child=>child.tagName===tag)??null;}
}
class Observer {
  static pending=[];
  constructor(callback){this.callback=callback;Observer.pending.push(this);}
  observe(element){this.element=element;}
  disconnect(){this.element=null;}
  trigger(){this.callback([{isIntersecting:true}]);}
}
globalThis.document={createElement:tag=>new Element(tag)};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const media=(number)=>Array.from({length:number},(_,index)=>({contentType:'image/png',
  reference:{fileId:`f${index}`,intentId:'i',generation:'1',digest:'d'}}));

test('media.list reference must match the requested published product and file proof',()=>{
  const ref={fileId:`f1_${'a'.repeat(64)}`,intentId:'intent',generation:'1',digest:'b'.repeat(64)};
  const row={productId:'p1',fileId:ref.fileId,digest:ref.digest,contentType:'image/png',reference:ref};
  const response={structuredContent:{kind:'creezio.widget.action.v1',state:'succeeded',output:{items:[row]}}};
  assert.deepEqual(linkedMediaFromResult(response,'p1'),[{contentType:'image/png',reference:ref}]);
  assert.equal(linkedMediaFromResult(response,'p2'),null);
  assert.equal(linkedMediaFromResult({structuredContent:{items:[{...row,digest:'c'.repeat(64)}]}},'p1'),null);
  assert.equal(linkedMediaFromResult({structuredContent:{items:[{...row,contentType:'image/svg+xml'}]}},'p1'),null);
});

test('private MCP image metadata decodes only a bounded supported binary',()=>{
  const bytes=Buffer.from([137,80,78,71]);
  const payload={_meta:{'creezio/linkedImage':{schemaVersion:1,type:'image',data:bytes.toString('base64'),mimeType:'image/png'}},
    content:[{type:'text',text:'Image privée remise au composant.'}]};
  assert.deepEqual(linkedImageFromResult(payload),{mimeType:'image/png',bytes:new Uint8Array(bytes)});
  assert.equal(linkedImageFromResult({...payload,isError:true}),null);
  assert.equal(linkedImageFromResult({...payload,structuredContent:{data:bytes.toString('base64')}}),null);
  assert.equal(linkedImageFromResult({_meta:{'creezio/linkedImage':{...payload._meta['creezio/linkedImage'],
    schemaVersion:2}}}),null);
  assert.equal(linkedImageFromResult({_meta:{'creezio/linkedImage':{...payload._meta['creezio/linkedImage'],
    mimeType:'image/svg+xml'}}}),null);
  assert.equal(linkedImageFromResult({_meta:{'creezio/linkedImage':{...payload._meta['creezio/linkedImage'],
    data:Buffer.alloc(2*1024*1024+1).toString('base64')}}}),null);
});

test('visible list card reads only its first image and revokes its Blob URL',async()=>{
  Observer.pending=[];let mediaCalls=0,imageCalls=0;const made=[],revoked=[];
  const view=createWidgetImageView({media:async()=>{mediaCalls++;return media(5);},
    image:async()=>{imageCalls++;return {mimeType:'image/png',bytes:new Uint8Array([137,80,78,71])};}},
  {observer:Observer,makeUrl:()=>{const url=`blob:${made.length}`;made.push(url);return url;},
    revokeUrl:url=>revoked.push(url)});
  const card=new Element('section');view.attach(card,'p1',1);
  assert.equal(mediaCalls,0,'mount does not fetch an off-screen card');
  assert.equal(card.children[0].textContent,'Chargement de l’image…');
  Observer.pending.at(-1).trigger();await tick();await tick();
  assert.equal(mediaCalls,1);assert.equal(imageCalls,1);
  assert.equal(card.children[0].tagName,'img');assert.equal(card.children[0].src,'blob:0');
  view.clear();assert.deepEqual(revoked,['blob:0']);assert.equal(card.children.length,0);
});

test('without visibility observer the widget does not fetch on mount',async()=>{
  let calls=0;
  const view=createWidgetImageView({media:async()=>{calls++;return media(1);},
    image:async()=>{calls++;return {mimeType:'image/png',bytes:new Uint8Array([1])};}},
  {observer:null});
  const card=new Element('section');view.attach(card,'p1',1);await tick();
  assert.equal(calls,0);
  assert.equal(card.children[0].textContent,'Aperçu indisponible dans cet hôte');view.clear();
});

test('late binary response after a product change cannot create a new URL',async()=>{
  Observer.pending=[];let resolveImage;const made=[];
  const view=createWidgetImageView({media:async()=>media(1),
    image:()=>new Promise(resolve=>{resolveImage=resolve;})},
  {observer:Observer,makeUrl:()=>{made.push('blob:stale');return 'blob:stale';}});
  const card=new Element('section');view.attach(card,'old',1);Observer.pending.at(-1).trigger();
  await tick();assert.equal(typeof resolveImage,'function');
  view.clear();resolveImage({mimeType:'image/png',bytes:new Uint8Array([1])});await tick();
  assert.deepEqual(made,[]);assert.equal(card.children.length,0);
});

test('detail gallery is capped at five and refuses invalid binary without truncation',async()=>{
  Observer.pending=[];let calls=0;const made=[];
  const view=createWidgetImageView({media:async()=>media(5),image:async()=>{
    calls++;return calls===1?{mimeType:'image/png',bytes:new Uint8Array(2*1024*1024+1)}:
      {mimeType:'image/png',bytes:new Uint8Array([1,2,3])};}},
  {observer:Observer,makeUrl:()=>{const url=`blob:${made.length}`;made.push(url);return url;}});
  const gallery=new Element('section');view.attach(gallery,'p1',5);Observer.pending.at(-1).trigger();
  for(let i=0;i<8;i++)await tick();
  assert.equal(calls,5);assert.equal(made.length,4,'oversized image is rejected, not truncated');
  assert.equal(gallery.children.length,5);
  assert.equal(gallery.children[0].children[0].textContent,'Image indisponible');
  assert.equal(gallery.children[1].children[0].tagName,'img');view.clear();
});

test('one refused gallery image leaves the other authorized images readable',async()=>{
  Observer.pending=[];let calls=0;
  const view=createWidgetImageView({media:async()=>media(2),image:async()=>{
    if(++calls===1)throw new Error('forbidden');
    return {mimeType:'image/png',bytes:new Uint8Array([1,2,3])};}},
  {observer:Observer,makeUrl:()=> 'blob:second'});
  const gallery=new Element('section');view.attach(gallery,'p1',5);Observer.pending.at(-1).trigger();
  for(let i=0;i<6;i++)await tick();
  assert.equal(calls,2);
  assert.equal(gallery.children[0].children[0].textContent,'Image indisponible');
  assert.equal(gallery.children[1].children[0].src,'blob:second');view.clear();
});
