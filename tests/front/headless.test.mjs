import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadlessOperationClient} from '../../sdk/front/headless.ts';

const origin='https://headless.example',token='SyntheticOnlyApiToken_1234567890';
const binding=(changes={})=>({id:'write-http',contributorModuleId:'example.notes',moduleId:'example.notes',operationId:'write',
  method:'PATCH',path:'/api/notes/{id}',audience:'app',auth:['api-token','oauth'],context:'required',kind:'command',
  inputSchemaId:'input',outputSchemaId:'output',rateLimit:{requests:30,windowSeconds:60},contractDigest:`sha256-${'a'.repeat(64)}`,
  parameters:[{name:'id',inputField:'id',in:'path',required:true,codec:'string'},
    {name:'revision',inputField:'revision',in:'query',required:true,codec:'integer'}],...changes});
const request={bindingId:'example.notes:write-http',contextId:'application',input:{id:'note',revision:1,title:'A',request_id:'request-1'}};
const record={id:'execution-1',state:'succeeded',output:{title:'A'},errorCode:null};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const credentials=()=>({kind:'api-token',token});

test('headless uses declared app bindings with bearer, exact mapping and no cookies or redirect',async()=>{
  let calls=0;
  const client=createHeadlessOperationClient({origin,bindings:[binding()],credential:credentials,fetcher:async(url,init)=>{
    calls++;assert.equal(url,`${origin}/api/notes/note?revision=1`);assert.equal(init.method,'PATCH');
    assert.equal(init.headers.get('authorization'),`Bearer ${token}`);assert.equal(init.headers.has('cookie'),false);
    assert.equal(init.headers.get('x-creezio-context'),'application');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
    assert.deepEqual(JSON.parse(init.body),{title:'A',request_id:'request-1'});return json({execution:record});
  }});
  assert.equal(client.audience,'app');assert.deepEqual(await client.invoke(request),{kind:'execution',execution:record});assert.equal(calls,1);
  assert.equal(JSON.stringify(client).includes(token),false);
});

test('headless rejects admin, session-only, duplicate and reserved bindings before network',()=>{
  const create=bindings=>createHeadlessOperationClient({origin,bindings,credential:credentials});
  assert.throws(()=>create([binding({audience:'admin'})]));assert.throws(()=>create([binding({auth:['session']})]));
  assert.throws(()=>create([binding(),binding()]));
  assert.throws(()=>create([binding({parameters:[{name:'authorization',inputField:'token',in:'header',required:true,codec:'string'}]})]));
});

test('headless refuses mismatched credential, malformed input and stale caller before transmission',async()=>{
  let calls=0,credential={kind:'api-token',token};
  const client=createHeadlessOperationClient({origin,bindings:[binding({auth:['oauth']})],credential:()=>credential,fetcher:async()=>{calls++;return json({execution:record});}});
  assert.equal((await client.invoke(request)).code,'authentication_required');
  credential={kind:'oauth',token};assert.equal((await client.invoke({...request,isCurrent:()=>false})).code,'stale');
  assert.equal((await client.invoke({...request,input:{id:'note',revision:'bad'}})).code,'invalid_input');
  assert.equal((await client.invoke({...request,bindingId:'example.notes:unknown'})).code,'not_found');
  credential=null;assert.equal((await client.invoke(request)).code,'unauthorized');assert.equal(calls,0);
});

test('headless discards replies after credential rotation or projection invalidation',async()=>{
  let release,credential={kind:'oauth',token},current=true;
  const client=createHeadlessOperationClient({origin,bindings:[binding()],credential:()=>credential,
    fetcher:async()=>new Promise(resolve=>{release=resolve;})});
  const pending=client.invoke(request);credential={kind:'oauth',token:`${token}_rotated`};release(json({execution:record}));
  assert.deepEqual(await pending,{kind:'unknown',code:'stale'});
  const second=client.invoke({...request,isCurrent:()=>current});current=false;release(json({execution:record}));
  assert.deepEqual(await second,{kind:'unknown',code:'stale'});
});

test('headless preserves uncertainty and uses read-only lookup without automatic mutation replay',async()=>{
  const calls=[];
  const client=createHeadlessOperationClient({origin,bindings:[binding()],credential:credentials,fetcher:async(url,init)=>{
    calls.push({url,init});if(init.method==='PATCH')throw Error('lost');
    assert.equal(init.headers.get('x-creezio-request-key'),Buffer.from('é panier').toString('base64url'));
    return json({error:{code:'not_found'},requestId:'request-2'},404);
  }});
  assert.deepEqual(await client.invoke(request),{kind:'unknown',code:'outcome_unknown'});
  assert.deepEqual(await client.status({bindingId:request.bindingId,contextId:'application',requestKey:'é panier'}),{kind:'unknown',code:'execution_not_observed'});
  assert.equal(calls.length,2);assert.equal(calls[1].init.method,'GET');assert.equal(calls[1].init.body,undefined);
  assert.match(calls[1].url,/\/api\/operations\/lookup\/example.notes\/write-http$/);
});

test('headless bounds response bodies and preserves explicit refusal and failed execution',async()=>{
  const replies=[json({error:{code:'forbidden'},requestId:'request-1'},403),json({execution:{...record,state:'failed',errorCode:'conflict'}}),
    json({error:{code:'unsupported'},requestId:'request-1'},501),json({execution:{...record,output:'x'.repeat(300000)}})];
  const client=createHeadlessOperationClient({origin,bindings:[binding()],credential:credentials,fetcher:async()=>replies.shift()});
  assert.deepEqual(await client.invoke(request),{kind:'rejected',code:'forbidden',status:403});
  assert.equal((await client.invoke(request)).execution.state,'failed');
  assert.deepEqual(await client.invoke(request),{kind:'rejected',code:'unsupported',status:501});
  assert.deepEqual(await client.invoke(request),{kind:'unknown',code:'outcome_unknown'});
});
