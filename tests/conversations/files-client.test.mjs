import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileClient} from '../../sdk/files/client.ts';
const reference={fileId:`f1_${'a'.repeat(64)}`,intentId:'intent',generation:'1',digest:'b'.repeat(64)};
function access(){
  let state={phase:'authenticated',pending:null,session:{id:'session-one',principalId:'owner',audience:'app'}};
  const listeners=new Set();
  return {origin:'https://app.example.invalid',audience:'app',getSnapshot:()=>state,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},set(value){state=value;for(const fn of listeners)fn();}};
}
const client=(a,fetcher)=>createFileClient({access:a,moduleId:'creezio.conversations',categoryId:'attachments',contextId:'application',fetcher});
const upload={file:new Blob(['synthetic'],{type:'text/plain'}),filename:'doc é.txt',intentId:'retry-id'};

test('file upload uses only same-origin native credentials and preserves an explicit retry identity',async()=>{
  const a=access();let seen;
  const c=client(a,async(url,init)=>{seen={url,init};return Response.json({reference,filename:upload.filename,contentType:'text/plain',byteSize:upload.file.size},{status:201});});
  const result=await c.upload(upload);assert.equal(result.kind,'ready');
  assert.equal(seen.url,'https://app.example.invalid/api/files/app/creezio.conversations/attachments');
  assert.equal(seen.init.headers['x-creezio-file-intent'],'retry-id');
  assert.equal(seen.init.headers['x-creezio-file-name'],encodeURIComponent(upload.filename));
  assert.equal(seen.init.credentials,'same-origin');assert.equal(seen.init.redirect,'error');
  assert.equal(Object.hasOwn(seen.init.headers,'authorization'),false);
});

test('uncertain upload is never replayed and unauthorized calls do not reach transport',async()=>{
  const a=access();let count=0;const c=client(a,async()=>{count++;throw new Error('lost acknowledgement');});
  assert.deepEqual(await c.upload(upload),{kind:'unknown',code:'outcome_unknown'});assert.equal(count,1);
  a.set({phase:'anonymous',session:null,pending:null});
  assert.deepEqual(await c.upload(upload),{kind:'rejected',code:'unauthorized'});assert.equal(count,1);
});

test('private file response is discarded after session change or stale conversation',async()=>{
  const a=access();let release;
  const c=client(a,()=>new Promise(resolve=>{release=resolve;}));
  const pending=c.download(reference);
  a.set({phase:'authenticated',session:{id:'session-two',principalId:'other',audience:'app'},pending:null});
  release(new Response('synthetic'));
  assert.deepEqual(await pending,{kind:'unknown',code:'stale'});
  let calls=0;const d=client(a,async()=>{calls++;return new Response('synthetic');});
  assert.deepEqual(await d.download(reference,()=>false),{kind:'rejected',code:'stale'});assert.equal(calls,0);
});

test('download is bounded and cannot follow redirects or expose malformed references',async()=>{
  const a=access();let count=0;
  const c=client(a,async()=>{count++;return new Response('bad',{headers:{'content-length':String(11*1024*1024)}});});
  assert.deepEqual(await c.download(reference),{kind:'unknown',code:'unavailable'});
  assert.deepEqual(await c.download({...reference,fileId:'bucket/private/key'}),{kind:'rejected',code:'invalid_input'});assert.equal(count,1);
  const redirect=new Response('ignored');Object.defineProperty(redirect,'redirected',{value:true});
  assert.deepEqual(await client(a,async()=>redirect).download(reference),{kind:'unknown',code:'unavailable'});
});

test('empty response chunks are cancelled before a file client can spin indefinitely',async()=>{
  const a=access();let pulls=0,cancelled=false;
  const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array());},cancel(){cancelled=true;}});
  const result=await client(a,async()=>new Response(body,{status:200})).download(reference);
  assert.deepEqual(result,{kind:'unknown',code:'unavailable'});
  assert.equal(cancelled,true);assert.ok(pulls<=16386,`unbounded empty response stream: ${pulls}`);
});

test('an HTML 200 response is not accepted as a private downloaded file',async()=>{
  const a=access();
  const c=client(a,async()=>new Response('<html>not a file</html>',{status:200,headers:{'content-type':'text/html'}}));
  assert.deepEqual(await c.download(reference),{kind:'unknown',code:'unavailable'});
});

test('a temporarily invalidated session cannot accept its old file response after refresh',async()=>{
  const a=access(),before=a.getSnapshot();let release;
  const pending=client(a,()=>new Promise(resolve=>{release=resolve;})).download(reference);
  a.set({phase:'loading',session:null,pending:null});a.set(before);
  release(new Response('synthetic'));
  assert.deepEqual(await pending,{kind:'unknown',code:'stale'});
});

test('linked download uses the existing private transport with an explicit record and no retained capability',async()=>{
  const a=access();let seen;
  const c=client(a,async(url,init)=>{seen={url,init};return new Response('image-bytes',{headers:{'content-type':'application/octet-stream'}});});
  const result=await c.downloadLinked(reference,'record:one');
  assert.equal(result.kind,'ready');assert.equal(await result.value.text(),'image-bytes');
  assert.equal(result.value.type,'application/octet-stream','old linked GET keeps generic Blob type');
  const url=new URL(seen.url);
  assert.equal(url.pathname,'/api/files/app/creezio.conversations/attachments');
  assert.deepEqual(Object.fromEntries(url.searchParams),{...reference,recordId:'record:one'});
  assert.equal(seen.init.method,'GET');assert.equal(seen.init.cache,'no-store');
  assert.equal(seen.init.credentials,'same-origin');assert.equal(Object.hasOwn(seen.init.headers,'authorization'),false);
  await c.download(reference);assert.equal(new URL(seen.url).searchParams.has('recordId'),false);
});

test('linked download carries a verified MIME header without changing ordinary download',async()=>{
  const a=access();
  const c=client(a,async()=>new Response('image-bytes',{headers:{'content-type':'application/octet-stream',
    'x-creezio-file-content-type':'image/png'}}));
  const linked=await c.downloadLinked(reference,'record:one');
  assert.equal(linked.kind,'ready');assert.equal(linked.value.type,'image/png');
  const ordinary=await c.download(reference);
  assert.equal(ordinary.kind,'ready');assert.equal(ordinary.value.type,'application/octet-stream');
  const nonImage=client(a,async()=>new Response('private-text',{headers:{'content-type':'application/octet-stream',
    'x-creezio-file-content-type':'text/html'}}));
  const generic=await nonImage.downloadLinked(reference,'record:one');
  assert.equal(generic.kind,'ready');assert.equal(generic.value.type,'application/octet-stream');
});

test('linked download rejects invalid record identities before transport and drops a changed session',async()=>{
  const a=access();let calls=0,release;
  const c=client(a,()=>{calls++;return new Promise(resolve=>{release=resolve;});});
  for(const recordId of ['',undefined,'x&recordId=y','../private','x'.repeat(129)])
    assert.deepEqual(await c.downloadLinked(reference,recordId),{kind:'rejected',code:'invalid_input'});
  assert.equal(calls,0);
  const pending=c.downloadLinked(reference,'record-one');
  a.set({phase:'anonymous',pending:null,session:null});
  release(new Response('old-image',{headers:{'content-type':'application/octet-stream'}}));
  assert.deepEqual(await pending,{kind:'unknown',code:'stale'});assert.equal(calls,1);
});
