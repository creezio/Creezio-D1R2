import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, RuntimeConfigurationError } from '../../core/runtime/dispatch.ts';

const digest='sha256-'+'1'.repeat(64);
const noop=()=>{throw new Error('Storage is not called by dispatcher health.');};
const environment=()=>({CREEZIO_RUNTIME_PROFILE:'local',DB:{prepare:noop,batch:noop},BUCKET:{get:noop,head:noop,put:noop,delete:noop},PRIVATE_KEY:'private-value'});
const operation=(changes={})=>({id:'read-status',operationId:'status',ownerModuleId:'example.test',method:'GET',path:'/api/modules/example.test/status',access:'public-read',maxDurationMs:1000,handler:()=>Response.json({status:'ready'}),...changes});
const moduleOf=(operations=[operation()],changes={})=>({id:'example.test',version:'1.0.0',operations,...changes});
const runtime=(modules=[moduleOf()])=>createRuntime({compositionDigest:digest,modules});
const request=(path,options={})=>new Request(`https://runtime.example${path}`,options);

test('non-API routes pass to the UI, while unknown API and MCP paths return JSON 404',async()=>{
  const app=runtime();
  for(const path of ['/','/witness','/assets/main.js','/apiary','/mcp-not-a-route','/landing/%ZZ'])assert.equal(await app.fetch(request(path),null),null);
  for(const path of ['/api','/api/unknown','/api/unknown/','/mcp','/mcp/admin','/%61pi/unknown']){
    const response=await app.fetch(request(path),environment());
    assert.equal(response.status,404);assert.match(response.headers.get('content-type'),/^application\/json/);
    assert.equal((await response.json()).error.code,'not_found');
  }
});

test('health checks structure only, does not expose environment or composition and generates its own request identity',async()=>{
  const app=runtime([]),env=environment();
  const response=await app.fetch(request('/api/health',{headers:{'x-creezio-request-id':'forged','oai-authenticated-user-id':'owner'}}),env);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok'});
  assert.match(response.headers.get('x-creezio-request-id'),/^[a-f0-9-]{36}$/);
  assert.notEqual(response.headers.get('x-creezio-request-id'),'forged');assert.equal(response.headers.get('cache-control'),'no-store');
  const head=await app.fetch(request('/api/health',{method:'HEAD'}),env);assert.equal(head.status,200);assert.equal(await head.text(),'');
  const post=await app.fetch(request('/api/health',{method:'POST'}),env);assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
});

test('missing bindings or an unknown profile fail with a redacted 503 and never invoke the handler',async()=>{
  let calls=0;const app=runtime([moduleOf([operation({handler:()=>{calls++;return Response.json({});}})])]);
  for(const env of [null,{}, {...environment(),DB:null},{...environment(),BUCKET:null},{...environment(),CREEZIO_RUNTIME_PROFILE:'production'}]){
    const response=await app.fetch(request('/api/modules/example.test/status'),env);
    assert.equal(response.status,503);const result=await response.json();assert.equal(result.error.code,'runtime_unavailable');assert.equal(JSON.stringify(result).includes('private-value'),false);
  }
  assert.equal(calls,0);
});

test('protected routes reject cookies, bearer tokens and GPT identity, including HEAD, without calling a handler',async()=>{
  let calls=0;const app=runtime([moduleOf([operation({access:'protected',handler:()=>{calls++;return Response.json({});}})])]);
  for(const method of ['GET','HEAD'])for(const headers of [{},{authorization:'Bearer forged'},{cookie:'creezio_session=forged'},{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.invalid','x-user-role':'owner'}]){
    const response=await app.fetch(request('/api/modules/example.test/status',{method,headers}),environment());
    assert.equal(response.status,401);
    if(method==='HEAD')assert.equal(await response.text(),'');else assert.equal((await response.json()).error.code,'authentication_required');
  }
  assert.equal(calls,0);
});

test('protected POST operations are closed, and HEAD cannot execute a protected POST handler',async()=>{
  const app=runtime([moduleOf([operation({method:'POST',access:'protected',handler:()=>{throw new Error('must not run');}})])]);
  for(const method of ['POST','HEAD'])assert.equal((await app.fetch(request('/api/modules/example.test/status',{method}),environment())).status,401);
});

test('public handler input has request data but context has no credentials, bindings or resolved actor',async()=>{
  let capture;const app=runtime([moduleOf([operation({path:'/api/modules/example.test/items/{item}',handler:(input,context)=>{capture={input,context};return Response.json({item:input.params.item,q:input.query.get('q')});}})])]);
  const response=await app.fetch(request('/api/modules/example.test/items/a%20b?q=hello&actor=owner',{headers:{authorization:'Bearer forged','oai-authenticated-user-id':'owner'}}),environment());
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{item:'a b',q:'hello'});
  assert.deepEqual(Object.keys(capture.input).sort(),['params','query']);assert.deepEqual(Object.keys(capture.context).sort(),['moduleId','profile','requestId','signal']);
  assert.equal(capture.context.moduleId,'example.test');assert.equal(capture.context.profile,'local');
  assert.ok(Object.isFrozen(capture.context));assert.ok(Object.isFrozen(capture.input.params));
  assert.equal(capture.input.query.get('actor'),'owner');assert.equal(capture.context.actor,undefined);
  assert.ok(capture.context.signal instanceof AbortSignal);
});

test('methods and malformed API paths fail without running a public handler',async()=>{
  let calls=0;const app=runtime([moduleOf([operation({handler:()=>{calls++;return Response.json({});}})])]);
  for(const method of ['POST','PATCH','DELETE','OPTIONS']){
    const response=await app.fetch(request('/api/modules/example.test/status',{method}),environment());assert.equal(response.status,405);assert.match(response.headers.get('allow'),/GET/);
  }
  for(const path of ['/api/%ZZ','/api/a%2fb','/api/a%5cb','/api/a%00b'])assert.equal((await app.fetch(request(path),environment())).status,400);
  assert.equal(calls,0);
});

test('HEAD reads discard the body and preserve the real status without creating a second dispatch',async()=>{
  let calls=0,cancelled=false;const app=runtime([moduleOf([operation({handler:()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:202});}})])]);
  const response=await app.fetch(request('/api/modules/example.test/status',{method:'HEAD'}),environment());
  assert.equal(response.status,202);assert.equal(await response.text(),'');assert.equal(calls,1);assert.equal(cancelled,true);
});

test('HEAD completes even when the stream producer never settles cancellation',async()=>{
  let cancelled=false,timer;
  const app=runtime([moduleOf([operation({handler:()=>new Response(new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}}),{status:202})})])]);
  const pending=app.fetch(request('/api/modules/example.test/status',{method:'HEAD'}),environment());
  const timeout=Symbol('HEAD did not complete');
  try {
    const response=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),100);})]);
    assert.notEqual(response,timeout);assert.equal(response.status,202);assert.equal(await response.text(),'');assert.equal(cancelled,true);
  } finally { clearTimeout(timer); }
});

test('handler failures and non-Response results become redacted JSON 500',async()=>{
  for(const handler of [()=>{throw new Error('PRIVATE_KEY=secret-value');},()=>({fake:true})]){
    const response=await runtime([moduleOf([operation({handler})])]).fetch(request('/api/modules/example.test/status'),environment());
    assert.equal(response.status,500);const text=await response.text();assert.match(text,/operation_failed/);assert.doesNotMatch(text,/secret-value|PRIVATE_KEY|fake/);
  }
});

test('runtime configuration rejects public writes, undeclared handlers, reserved paths and conflicts before any request',()=>{
  const cases=[
    [()=>runtime([moduleOf([operation({method:'POST'})])]),'operation.public-write'],
    [()=>runtime([moduleOf([operation({handler:undefined})])]),'operation.handler'],
    [()=>runtime([moduleOf([operation({ownerModuleId:undefined})])]),'operation.owner'],
    [()=>runtime([moduleOf([operation({ownerModuleId:'example.absent'})])]),'operation.owner'],
    [()=>runtime([moduleOf([operation({maxDurationMs:undefined})])]),'operation.budget'],
    [()=>runtime([moduleOf([operation({maxDurationMs:30001})])]),'operation.budget'],
    [()=>runtime([moduleOf([operation({path:'/api/health'})])]),'route.reserved'],
    [()=>runtime([moduleOf([operation({path:'/witness'})])]),'route.reserved'],
    [()=>runtime([moduleOf([operation({path:'/api/../secrets'})])]),'route.invalid'],
    [()=>runtime([moduleOf([operation(),operation()])]),'operation.invalid'],
    [()=>runtime([moduleOf(),moduleOf()]),'module.invalid'],
    [()=>runtime([moduleOf([operation({id:'first',path:'/api/items/{id}'}),operation({id:'second',path:'/api/items/{other}'})])]),'route.conflict'],
    [()=>runtime([moduleOf([operation({id:'first',path:'/api/business/{name}/details'}),operation({id:'second',path:'/api/business/fixed/{part}'})])]),'route.conflict'],
    [()=>createRuntime({modules:[],compositionDigest:'not-a-digest'}),'composition.invalid'],
  ];
  for(const [create,code] of cases)assert.throws(create,error=>error instanceof RuntimeConfigurationError&&error.code===code);
});

test('URL and query bounds reject oversized requests before invoking a handler',async()=>{
  let calls=0;const app=runtime([moduleOf([operation({handler:()=>{calls++;return Response.json({});}})])]);
  const base='/api/modules/example.test/status';
  for(const [path,status] of [[`${base}?q=${'a'.repeat(9000)}`,414],[`${base}?q=${'a'.repeat(2049)}`,400],[`${base}?${Array.from({length:65},()=>`q=a`).join('&')}`,400],[`${base}?${'k'.repeat(257)}=v`,400]]){
    assert.equal((await app.fetch(request(path),environment())).status,status);
  }
  assert.equal(calls,0);
});

test('a real short deadline aborts I/O and releases a late handler response',async()=>{
  let signal,release,bodyCancelled=false;
  const pending=new Promise(resolve=>{release=resolve;});
  const app=runtime([moduleOf([operation({maxDurationMs:15,handler:(_input,context)=>{signal=context.signal;return pending;}})])]);
  const response=await app.fetch(request('/api/modules/example.test/status'),environment());
  assert.equal(response.status,504);assert.equal((await response.json()).error.code,'operation_timeout');assert.equal(signal.aborted,true);
  release(new Response(new ReadableStream({cancel(){bodyCancelled=true;}})));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(bodyCancelled,true);
});

test('client cancellation does not create an identity or keep a handler deadline alive',async()=>{
  const controller=new AbortController();let signal;
  const app=runtime([moduleOf([operation({maxDurationMs:1000,handler:(_input,context)=>{signal=context.signal;return new Promise((_resolve,reject)=>context.signal.addEventListener('abort',()=>reject(new Error('provider credential')), {once:true}));}})])]);
  const pending=app.fetch(request('/api/modules/example.test/status',{signal:controller.signal}),environment());
  await new Promise(resolve=>setTimeout(resolve,0));controller.abort();const response=await pending;
  assert.equal(response.status,499);assert.equal(signal.aborted,true);assert.equal((await response.json()).error.code,'request_cancelled');
  let calls=0;const closed=runtime([moduleOf([operation({handler:()=>{calls++;return Response.json({});}})])]);
  assert.equal((await closed.fetch(request('/api/modules/example.test/status',{signal:controller.signal}),environment())).status,499);assert.equal(calls,0);
});

test('completed handlers clear their deadline and leave no late abort on the delivered context',async()=>{
  let signal;const app=runtime([moduleOf([operation({maxDurationMs:15,handler:(_input,context)=>{signal=context.signal;return Response.json({});}})])]);
  assert.equal((await app.fetch(request('/api/modules/example.test/status'),environment())).status,200);
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(signal.aborted,false);
});

test('explicit static routes precede parameter routes and compiled registration is insulated from later array mutation',async()=>{
  const generic=operation({id:'generic',path:'/api/items/{id}',handler:()=>Response.json({route:'generic'})});
  const fixed=operation({id:'fixed',path:'/api/items/status',handler:()=>Response.json({route:'fixed'})});
  const modules=[moduleOf([generic,fixed])],app=runtime(modules);generic.handler=()=>Response.json({route:'mutated'});modules[0].operations.length=0;
  assert.deepEqual(await (await app.fetch(request('/api/items/status'),environment())).json(),{route:'fixed'});
  assert.deepEqual(await (await app.fetch(request('/api/items/other'),environment())).json(),{route:'generic'});
});

test('a cross-module API binding executes with the canonical operation owner, regardless of registration order',async()=>{
  let owner;
  const contributor=moduleOf([operation({ownerModuleId:'vendor.provider',handler:(_input,context)=>{owner=context.moduleId;return Response.json({status:'ready'});}})]);
  const provider=moduleOf([],{id:'vendor.provider'});
  for(const modules of [[contributor,provider],[provider,contributor]]){
    const response=await runtime(modules).fetch(request('/api/modules/example.test/status'),environment());
    assert.equal(response.status,200);assert.equal(owner,'vendor.provider');
  }
});
