import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import {linkedImageToolResult} from '../../sdk/widgets/private-image.ts';
import {validateCompiledWidgetCatalog} from '../../sdk/widgets/catalog.ts';

const neutral='Image privée remise au composant.';
const png=Uint8Array.of(137,80,78,71,13,10,26,10,0);
const hash=value=>`sha256-${createHash('sha256').update(value).digest('hex')}`;

test('compiled widget catalog accepts only an app-visible linked-image capability',()=>{
  const text='<!doctype html><html></html>',digest=hash(text),profile=hash('profile');
  const moduleId='creezio.catalog',widgetId='product-list',version='1.0.0';
  const uri=`ui://creezio/${moduleId}/${widgetId}/${version}/${digest}.html`;
  const uiMeta={csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},permissions:{}};
  const tool={kind:'linked-image',toolName:'catalog_linked_image_read',categoryId:'images',visibility:['app']};
  const widget={moduleId,widgetId,version,resourceUri:uri,resourceMimeType:'text/html;profile=mcp-app',
    resourceDigest:digest,bundleDigest:digest,schemas:{},audiences:['app'],permissions:['creezio.catalog:view'],
    actions:[{id:'display',mode:'message'}],renderTools:[{toolName:'catalog_product_search',
      operationModuleId:moduleId,operationId:'product.search',operationDigest:digest,audiences:['app']}],
    serverTools:[tool],transport:{protocol:'mcp-apps',maxPayloadBytes:1_048_576,timeoutMs:30_000,
      uncertainResult:'reconcile-before-retry',fallbackDispatch:'before-first-dispatch-only'}};
  const resource={uri,mimeType:'text/html;profile=mcp-app',digest,text,audiences:['app'],moduleId,
    widgetId,version,cspProfileId:profile,uiMeta};
  const deps={digestUtf8:hash,byteLengthUtf8:value=>Buffer.byteLength(value),digestUiMeta:()=>profile,
    validateUiMeta:()=>true,validators:new Map([[`${moduleId}\0${widgetId}\0${version}`,
      {actionInputs:new Map([['display',()=>true]])}]])};
  const validate=serverTools=>validateCompiledWidgetCatalog({widgets:[{...widget,serverTools}],
    resources:[resource]},deps);
  assert.equal(validate([tool]).size,1);
  assert.throws(()=>validate([{...tool,visibility:['model','app']}]),/linked-image/);
  assert.throws(()=>validate([{...tool,categoryId:'../images'}]),/linked-image/);
  assert.throws(()=>validate([tool,tool]),/duplicate server tool/);
  assert.throws(()=>validateCompiledWidgetCatalog({widgets:[{...widget,audiences:['admin'],
    renderTools:[{...widget.renderTools[0],audiences:['admin']}]}],
    resources:[{...resource,audiences:['admin']}]},deps),/linked-image/);
});

test('native linked image result keeps bytes only in private tool metadata',async()=>{
  const result=await linkedImageToolResult(new Blob([png],{type:'image/png'}));
  assert.deepEqual(result.content,[{type:'text',text:neutral}]);
  assert.equal(Object.hasOwn(result,'structuredContent'),false);
  assert.deepEqual(result._meta['creezio/linkedImage'],{schemaVersion:1,type:'image',
    mimeType:'image/png',data:Buffer.from(png).toString('base64')});
  const maximum=new Uint8Array(2_097_152);maximum.set(png);
  const bounded=await linkedImageToolResult(new Blob([maximum],{type:'image/png'}));
  assert.equal(bounded._meta['creezio/linkedImage'].data.length,2_796_204);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded))<3_145_728);
  assert.equal(await linkedImageToolResult(new Blob([Uint8Array.of(60,115,118,103,62)])),null);
  assert.equal(await linkedImageToolResult(new Blob([png],{type:'image/jpeg'})),null);
  assert.equal(await linkedImageToolResult(new Blob([new Uint8Array(2_097_153)])),null);
});

function relay() {
  const digest=`sha256-${'a'.repeat(64)}`,hostOrigin='https://host.example.invalid';
  const forwarded=[],fromWidget=[],listeners=new Map();
  const parent={postMessage(message){fromWidget.push(message);}};
  const innerWindow={postMessage(message){forwarded.push(message);}};
  let inner=null;
  const document={body:{replaceChildren(node){inner=node;}},createElement(){return {
    contentWindow:innerWindow,setAttribute(){},style:{},remove(){},
  };}};
  const window={parent,addEventListener(name,listener){listeners.set(name,listener);}};
  const context=createContext({window,document,location:{pathname:`/profiles/${digest}/sandbox.html`,
    origin:'https://sandbox.example.invalid'},URL,TextEncoder,setInterval(){return 1;},
    clearInterval(){},setTimeout(){return 1;},clearTimeout(){}});
  runInContext(`globalThis.__CREEZIO_WIDGET_SANDBOX_CONFIG__ = ${JSON.stringify({
    hostOrigins:[hostOrigin],profiles:{[digest]:{csp:{},permissions:{}}},
  })}`,context);
  runInContext(readFileSync(new URL('../../sdk/widgets/proxy/sandbox.js',import.meta.url),'utf8'),context);
  const clone=value=>runInContext('JSON',context).parse(JSON.stringify(value));
  const dispatch=(source,origin,data)=>listeners.get('message')({source,origin,data:clone(data)});
  dispatch(parent,hostOrigin,{jsonrpc:'2.0',method:'ui/notifications/sandbox-resource-ready',
    params:{html:'<p>Widget</p>',csp:{},permissions:{}}});
  assert.ok(inner);
  return {dispatch,parent,innerWindow,hostOrigin,forwarded,fromWidget};
}

test('sandbox enlarges only verified host-to-widget private image results',()=>{
  const subject=relay();
  const base64=Buffer.alloc(2_097_152).toString('base64');
  const response={jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:neutral}],
    _meta:{'creezio/linkedImage':{schemaVersion:1,type:'image',mimeType:'image/png',data:base64}}}};
  assert.ok(Buffer.byteLength(JSON.stringify(response))>1_048_576);
  assert.ok(Buffer.byteLength(JSON.stringify(response))<3_145_728);
  subject.dispatch(subject.parent,subject.hostOrigin,response);
  assert.equal(subject.forwarded.length,1);
  subject.dispatch(subject.innerWindow,'https://sandbox.example.invalid',response);
  assert.equal(subject.fromWidget.length,1); // only the initial ready notification
  for(const invalid of [
    {...response,result:{...response.result,structuredContent:{data:base64}}},
    {...response,result:{...response.result,_meta:{'creezio/linkedImage':{
      ...response.result._meta['creezio/linkedImage'],mimeType:'image/svg+xml'}}}},
    {...response,result:{...response.result,_meta:{'creezio/linkedImage':{
      ...response.result._meta['creezio/linkedImage'],data:base64+'AAAA'}}}},
    {...response,result:{...response.result,_meta:{'creezio/linkedImage':{
      ...response.result._meta['creezio/linkedImage'],data:'%%%%'}}}},
  ]) subject.dispatch(subject.parent,subject.hostOrigin,invalid);
  assert.equal(subject.forwarded.length,1);
  subject.dispatch(subject.parent,subject.hostOrigin,{jsonrpc:'2.0',id:2,
    result:{content:[{type:'text',text:base64}]}});
  assert.equal(subject.forwarded.length,1);
});
