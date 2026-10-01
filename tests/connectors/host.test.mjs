import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {captureConnectorDescriptor,connectorOrigin,createConnectorHost} from '../../core/connectors/host.ts';
import {createVaultKeyring,createVaultReference} from '../../core/vault/crypto.ts';
import {meiliConnectorDescriptor} from '../../extensions/connectors/meili/module/storage.ts';

const moduleId='test.connector',connectorId='test.api.v1';
const config={moduleId,modelId:'connector_config',contextField:'context_id',
  fields:{id:'id',origin:'origin',keyRef:'key_ref',secretVersion:'secret_version',
    enabled:'enabled',revision:'revision',updatedAt:'updated_at'}};
const vault={moduleId,modelId:'connector_secret',contextField:'context_id',
  fields:{id:'id',bindingId:'binding_id',ciphertext:'ciphertext',keyId:'key_id',
    version:'version',state:'state'}};
const descriptor={id:connectorId,moduleId,config,vault,auth:{kind:'api-key-header',name:'X-N8N-API-KEY'},
  resources:[{id:'workflows',method:'GET',path:'/api/v1/workflows',params:['cursor','limit']},
    {id:'workflow',method:'GET',path:'/api/v1/workflows/{id}',params:['id']}]};
const field=(id,type='string',protectedValue=false,nullable=false,constraints)=>({id,type,
  nullable,protected:protectedValue,computed:false,...(constraints?{constraints}:{})});
const context=field('context_id','string',true);
const configModel={id:'connector_config',scope:'context',contextField:'context_id',
  primaryKey:['context_id','id'],fields:[context,field('id'),field('origin'),field('key_ref','string',false,true),
    field('secret_version','integer',false,true),field('connection_id'),field('enabled','boolean'),field('revision','integer'),
    field('updated_at','date-time')]};
const vaultModel={id:'connector_secret',scope:'context',contextField:'context_id',
  primaryKey:['context_id','id'],fields:[context,field('id','string',true),field('binding_id','string',true),
    field('ciphertext','string',true),field('key_id','string',true),
    field('version','integer',true,false,{minimum:1}),
    field('state','string',true,false,{enum:['active','revoked']})]};
const eventModel={id:'events',scope:'context',contextField:'context_id',
  primaryKey:['context_id','id'],fields:[context,field('id'),field('connection_id'),
    field('parent_id'),field('event_type'),field('created_at','date-time')],
  indexes:[{id:'by-parent',fields:['context_id','connection_id','parent_id','created_at','id']}]};
const catalog={schemaVersion:1,compositionDigest:'sha256-test',modules:[{moduleId,enabled:true,version:'0.0.0',
  permissions:[],models:[{modelId:'connector_config',model:configModel,table:'config'},
    {modelId:'connector_secret',model:vaultModel,table:'secret'},
    {modelId:'events',model:eventModel,table:'events'}]}]};

async function fixture(fetcher,described=descriptor){
  const keyring=createVaultKeyring({activeKeyId:'key',keys:{key:new Uint8Array(32).fill(17)}});
  const reference=createVaultReference();
  const ciphertext=await keyring.seal({moduleId,contextId:'application',bindingId:connectorId,
    reference,version:1},'secret-value');
  const state={revoked:false,alive:true,config:{id:connectorId,origin:'https://n8n.example.invalid',key_ref:reference,
    secret_version:1,connection_id:'connection-one',enabled:true,revision:1,updated_at:'2026-09-28T00:00:00.000Z'},
  secret:{id:reference,binding_id:connectorId,ciphertext,key_id:'key',version:1,state:'active'},
  events:[{id:'event-one',connection_id:'connection-one',parent_id:'mail-one',event_type:'received',
    created_at:'2026-09-28T00:00:00.000Z'}]};
  const identity={moduleId,contextId:'application',audience:'admin',principalId:'owner',
    actorPrincipalId:'owner',credentialKind:'session'};
  const plans=[];
  const data={
    async authorize(){if(state.revoked)throw Object.assign(new Error('revoked'),{code:'forbidden'});
      return {kind:'data-lease'};},
    describeLease(){return identity;},dispose(){},
    internalPort(_lease,options){return {async list(){return {items:state.events,nextAfter:null};},async get(_model,input){
      const row=options.modelId==='connector_config'?state.config:state.secret;
      if(!row)return null;
      if(Object.entries(input.where??{}).some(([key,value])=>row[key]!==value))return null;
      return row;
    },planGet(model,input){const plan=Object.freeze({kind:'data-plan',model,input,fields:options.fields});
      plans.push(plan);return plan;}};}
  };
  const host=createConnectorHost({data,catalog,descriptor:described,keyring,fetcher});
  const scope=(extra={})=>({lease:{kind:'data-lease'},credential:{kind:'session',token:'opaque'},
    contextId:'application',audience:'admin',actors:['user'],
    requiredPermissionIds:[`${moduleId}:read`],signal:new AbortController().signal,
    executionId:'claim-123',
    ensureActive(){if(!state.alive)throw new Error('operation closed');},...extra});
  const port=(extra={})=>host.port(scope(extra));
  return {host,state,port,scope,plans};
}

test('the descriptor and configured origin cannot redirect a secret to an arbitrary host or header',()=>{
  for(const value of ['http://n8n.example.invalid','https://localhost','https://localhost.',
    'https://127.0.0.1','https://127.0.0.1.','https://host.internal.',
    'https://[::1]','https://n8n.example.invalid/path','https://u:p@n8n.example.invalid',
    'https://n8n.example.invalid?x=1','https://n8n.example.invalid#part'])
    assert.equal(connectorOrigin(value),null,value);
  assert.equal(connectorOrigin('https://n8n.example.invalid/'),'https://n8n.example.invalid');
  assert.throws(()=>captureConnectorDescriptor({...descriptor,auth:{kind:'api-key-header',name:'Host'}}));
  assert.throws(()=>captureConnectorDescriptor({...descriptor,auth:{kind:'api-key-header',name:'X-Forwarded-Host'}}));
  assert.throws(()=>captureConnectorDescriptor({...descriptor,auth:{kind:'api-key-header',name:'X-Host'}}));
  assert.throws(()=>captureConnectorDescriptor({...descriptor,resources:[
    {id:'arbitrary',method:'GET',path:'https://other.example.invalid/',params:[]}]}));
});

test('one named GET uses the vaulted header and bounded typed output without exposing the secret',async()=>{
  const requests=[];
  const {port}=await fixture(async(url,init)=>{requests.push({url:String(url),init});
    return new Response(JSON.stringify({data:[{id:'w1'}],nextCursor:'next'}),
      {status:200,headers:{'content-type':'application/json'}});});
  const client=port();
  const result=await client.request({resource:'workflows',cursor:'cursor-a',limit:25});
  assert.deepEqual(result,{kind:'ok',status:200,body:{data:[{id:'w1'}],nextCursor:'next'}});
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://n8n.example.invalid/api/v1/workflows?cursor=cursor-a&limit=25');
  assert.equal(requests[0].init.method,'GET');
  assert.equal(requests[0].init.redirect,'manual');
  assert.equal(requests[0].init.headers.get('X-N8N-API-KEY'),'secret-value');
  assert.doesNotMatch(JSON.stringify(result),/secret-value/);
  assert.deepEqual(await client.request({resource:'workflow',id:'w1'}),
    {kind:'error',code:'invalid_request'});
  assert.equal(requests.length,1,'the operation can issue only one remote request');
  const nullable=await fixture(async()=>new Response('null',
    {headers:{'content-type':'application/json'}}));
  assert.deepEqual(await nullable.port().request({resource:'workflows'}),
    {kind:'ok',status:200,body:null});
});

test('a signed-event source proof is checked before the provider GET',async()=>{
  let requests=0;
  const described={...descriptor,config:{...config,fields:{...config.fields,connectionId:'connection_id'}}};
  const {port,state}=await fixture(async()=>{requests++;
    return new Response('{}',{headers:{'content-type':'application/json'}});},described);
  state.config.revision=2;
  assert.deepEqual(await port().request({resource:'workflow',id:'mail-one',
    sourceProof:{connectionId:'connection-one',configRevision:1}}),
    {kind:'error',code:'not_configured'});
  assert.equal(requests,0);
  state.config.revision=1;state.config.connection_id='connection-two';
  assert.deepEqual(await port().request({resource:'workflow',id:'mail-one',
    sourceProof:{connectionId:'connection-one',configRevision:1}}),
    {kind:'error',code:'not_configured'});
  assert.equal(requests,0);
});

test('the host source guard rejects config rotation and sealed-secret revocation at commit',async()=>{
  const described={...descriptor,config:{...config,fields:{...config.fields,connectionId:'connection_id'}},
    binaryDownloads:[{id:'attachment',proofOperationId:'mail.read',
      metadataPath:'/mail/{parentId}/attachments/{childId}',
      cdnOrigin:'https://cdn.example.invalid',cdnPath:'/{parentId}/attachments/{childId}',
      maxBytes:1024,event:{modelId:'events',indexId:'by-parent',connectionField:'connection_id',
        parentField:'parent_id',typeField:'event_type',typeValue:'received'}}]};
  const {host,state,scope}=await fixture(async()=>{throw new Error('no network');},described);
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null)}}',
    d1Databases:{DB:'connector-guard-proof'},d1Persist:false});
  try{
    const db=await runtime.getD1Database('DB');
    await db.batch([
      `CREATE TABLE config (context_id TEXT,id TEXT,connection_id TEXT,revision INTEGER,origin TEXT,
        key_ref TEXT,secret_version INTEGER,enabled INTEGER)`,
      `CREATE TABLE secret (context_id TEXT,id TEXT,version INTEGER,state TEXT,binding_id TEXT)`]
      .map(sql=>db.prepare(sql)));
    await db.prepare(`INSERT INTO config VALUES (?,?,?,?,?,?,?,?)`).bind('application',connectorId,
      'connection-one',1,state.config.origin,state.config.key_ref,1,1).run();
    await db.prepare(`INSERT INTO secret VALUES (?,?,?,?,?)`).bind('application',state.config.key_ref,
      1,'active',connectorId).run();
    const guard=await host.sourceGuard(scope(),{remoteId:'attachment',
      sourceProof:{connectionId:'connection-one',configRevision:1}});
    const verify=()=>db.prepare(`SELECT CASE WHEN (${guard.condition}) THEN 1
      ELSE json('source_changed') END AS accepted`).bind(...guard.bindings).first();
    assert.equal((await verify()).accepted,1);
    await db.prepare(`UPDATE config SET revision=2`).run();
    await assert.rejects(verify());
    await db.prepare(`UPDATE config SET revision=1`).run();
    await db.prepare(`UPDATE secret SET state='revoked'`).run();
    await assert.rejects(verify());
  }finally{await runtime.dispose();}
});

test('one declared binary child uses a bounded API GET and exact CDN origin',async()=>{
  const described={...descriptor,config:{...config,fields:{...config.fields,connectionId:'connection_id'}},
    binaryDownloads:[{id:'attachment',proofOperationId:'mail.read',
      metadataPath:'/mail/{parentId}/attachments/{childId}',
      cdnOrigin:'https://cdn.example.invalid',cdnPath:'/{parentId}/attachments/{childId}',
      maxBytes:8,event:{modelId:'events',indexId:'by-parent',connectionField:'connection_id',
        parentField:'parent_id',typeField:'event_type',typeValue:'received'}}]};
  const input={remoteId:'attachment',parentId:'mail-one',childId:'child-one',
    sourceProof:{connectionId:'connection-one',configRevision:1},
    expected:{filename:'proof.txt',contentType:'text/plain',byteSize:8}};
  const urls=[];
  const {host,scope}=await fixture(async(url,init)=>{
    urls.push(String(url));assert.equal(init.redirect,'manual');
    if(urls.length===1)return Response.json({id:'child-one',filename:'proof.txt',
      content_type:'text/plain',size:8,
      download_url:'https://cdn.example.invalid/mail-one/attachments/child-one?signature=x'});
    assert.equal(init.headers,undefined,'signed CDN URLs receive no provider credential');
    return new Response(new TextEncoder().encode('proof-01'),{headers:{'content-length':'8'}});
  },described);
  assert.equal(new TextDecoder().decode(await host.downloadBinary(scope(),input)),'proof-01');
  assert.deepEqual(urls,['https://n8n.example.invalid/mail/mail-one/attachments/child-one',
    'https://cdn.example.invalid/mail-one/attachments/child-one?signature=x']);
  let attempts=0;
  const blocked=await fixture(async()=>{attempts++;return Response.json({id:'child-one',
    filename:'proof.txt',content_type:'text/plain',size:8,
    download_url:'https://other.example.invalid/mail-one/attachments/child-one?signature=x'});},described);
  await assert.rejects(blocked.host.downloadBinary(blocked.scope(),input));
  assert.equal(attempts,1,'a foreign CDN is rejected before the second GET');
  let rotatedState,rotatedGets=0;
  const rotated=await fixture(async()=>{rotatedGets++;rotatedState.config.revision=2;
    return Response.json({id:'child-one',filename:'proof.txt',content_type:'text/plain',size:8,
      download_url:'https://cdn.example.invalid/mail-one/attachments/child-one?signature=x'});
  },described);
  rotatedState=rotated.state;
  await assert.rejects(rotated.host.downloadBinary(rotated.scope(),input));
  assert.equal(rotatedGets,1,'rotation after metadata refuses CDN egress');
});

test('remote auth and redirects are sanitized, and a revoked local grant hides even a completed response',async()=>{
  const unauthorized=await fixture(async()=>new Response('key was invalid',
    {status:401,headers:{'content-type':'text/plain'}}));
  assert.deepEqual(await unauthorized.port().request({resource:'workflows'}),
    {kind:'error',code:'remote_auth',status:401});
  const redirected=await fixture(async()=>Response.redirect('https://other.example.invalid',302));
  assert.deepEqual(await redirected.port().request({resource:'workflows'}),
    {kind:'error',code:'remote_error',status:302});
  let release;
  const delayed=await fixture(()=>new Promise(resolve=>{release=resolve;}));
  const running=delayed.port().request({resource:'workflows'});
  for(let attempt=0;attempt<20&&!release;attempt++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof release,'function','the remote request must start before revocation');
  delayed.state.revoked=true;
  release(new Response(JSON.stringify({data:[{id:'secret-workflow'}]}),
    {status:200,headers:{'content-type':'application/json'}}));
  assert.deepEqual(await running,{kind:'error',code:'access_denied'});
});

test('a retained connector port cannot issue a request after its operation closes',async()=>{
  let requests=0;
  const {port,state}=await fixture(async()=>{requests++;
    return new Response('{}',{headers:{'content-type':'application/json'}});});
  const retained=port();
  state.alive=false;
  assert.deepEqual(await retained.request({resource:'workflows'}),{kind:'error',code:'unavailable'});
  assert.equal(requests,0);
});

test('dot-segment identifiers cannot move a fixed resource path',async()=>{
  for(const id of ['.','..','%2e%2e','a/../b']){
    let requests=0;
    const {port}=await fixture(async()=>{requests++;
      return new Response('{}',{headers:{'content-type':'application/json'}});});
    assert.deepEqual(await port().request({resource:'workflow',id}),
      {kind:'error',code:'invalid_request'},id);
    assert.equal(requests,0,id);
  }
});

test('a config revision change and oversized response fail closed',async()=>{
  let stateRef;
  const rotated=await fixture(async()=>{stateRef.config.revision=2;
    return new Response(JSON.stringify({data:[]}),{headers:{'content-type':'application/json'}});});
  stateRef=rotated.state;
  assert.deepEqual(await rotated.port().request({resource:'workflows'}),
    {kind:'error',code:'unavailable'});
  let mismatchedCalls=0;
  const mismatched=await fixture(async()=>{mismatchedCalls++;return new Response('{}',
    {headers:{'content-type':'application/json'}});});
  mismatched.state.config.secret_version=2;
  assert.equal(await mismatched.host.availability({kind:'data-lease'}),'invalid');
  assert.deepEqual(await mismatched.port().request({resource:'workflows'}),
    {kind:'error',code:'not_configured'});
  assert.equal(mismatchedCalls,0);
  const huge=await fixture(async()=>new Response(JSON.stringify({data:'x'.repeat(1_048_576)}),
    {headers:{'content-type':'application/json'}}));
  assert.deepEqual(await huge.port().request({resource:'workflows'}),
    {kind:'error',code:'invalid_response',status:200});
});

test('compiled Stripe GET mapping fixes origin, version and query without client-controlled headers',async()=>{
  const stripe={...descriptor,auth:{kind:'bearer'},fixedOrigin:'https://api.stripe.com',
    staticHeaders:[{name:'Stripe-Version',value:'2026-08-26.dahlia'},
      {name:'Accept-Language',value:'fr'}],resources:[
      {id:'subscriptions',method:'GET',path:'/v1/subscriptions',params:['cursor','limit'],
        query:{cursor:'starting_after',fixed:[{name:'status',value:'all'}]}}]};
  for(const bad of [
    {...stripe,fixedOrigin:'https://api.stripe.com/'},
    {...stripe,staticHeaders:[{name:'Authorization',value:'Bearer other'}]},
    {...stripe,staticHeaders:[{name:'Proxy-Authorization',value:'Basic other'}]},
    {...stripe,staticHeaders:[{name:'X-Forwarded',value:'other'}]},
    {...stripe,staticHeaders:[{name:'X-Real',value:'other'}]},
    {...stripe,staticHeaders:[{name:'Stripe-Version',value:'x\r\nHost: other'}]},
    {...stripe,staticHeaders:[{name:'Stripe-Version',value:'2026-08-26.dahlia\n'}]},
    {...stripe,staticHeaders:[{name:'Stripe-Version\n',value:'2026-08-26.dahlia'}]},
    {...stripe,staticHeaders:[{name:'Stripe-Version',value:'x\u2028'}]},
    {...stripe,staticHeaders:[{name:'Stripe-Version',value:'a'},
      {name:'stripe-version',value:'b'}]},
    {...stripe,resources:[{...stripe.resources[0],query:{cursor:'status',fixed:[{name:'status',value:'all'}]}}]},
    {...stripe,resources:[{...stripe.resources[0],query:{cursor:'starting_after\n'}}]},
    {...stripe,resources:[{...stripe.resources[0],query:{fixed:[{name:'status',value:'all\n'}]}}]},
    {...stripe,resources:[{...stripe.resources[0],params:['limit'],query:{cursor:'starting_after'}}]},
  ])assert.throws(()=>captureConnectorDescriptor(bad));
  const requests=[];
  const ready=await fixture(async(url,init)=>{requests.push({url:String(url),init});
    return new Response(JSON.stringify({object:'list',data:[],has_more:false}),
      {headers:{'content-type':'application/json'}});},stripe);
  assert.equal(await ready.host.availability({kind:'data-lease'}),'invalid');
  assert.deepEqual(await ready.port().request({resource:'subscriptions',limit:8}),
    {kind:'error',code:'not_configured'});
  assert.equal(requests.length,0,'a configured origin cannot redirect the Stripe credential');
  ready.state.config.origin='https://api.stripe.com';
  assert.equal(await ready.host.availability({kind:'data-lease'}),'ready');
  assert.deepEqual(await ready.port().request({resource:'subscriptions',cursor:'sub_123',limit:8}),
    {kind:'ok',status:200,body:{object:'list',data:[],has_more:false}});
  assert.equal(requests[0].url,'https://api.stripe.com/v1/subscriptions?status=all&starting_after=sub_123&limit=8');
  assert.equal(requests[0].init.headers.get('Authorization'),'Bearer secret-value');
  assert.equal(requests[0].init.headers.get('Stripe-Version'),'2026-08-26.dahlia');
  assert.equal(requests[0].init.headers.get('Accept-Language'),'fr');
  assert.doesNotMatch(JSON.stringify(requests[0].init),/secret-value/);
});

test('successful command GET registers only host-private config and vault commit proofs',async()=>{
  const ready=await fixture(async()=>new Response('{}',{headers:{'content-type':'application/json'}}));
  const registered=[];
  assert.deepEqual(await ready.port({registerCommitGuards:tokens=>registered.push(tokens)})
    .request({resource:'workflows'}),{kind:'ok',status:200,body:{}});
  assert.equal(registered.length,1);
  assert.deepEqual(registered[0],ready.plans);
  assert.equal(ready.plans.length,2);
  assert.deepEqual(ready.plans[0].input,{key:{id:connectorId},required:true,
    where:{revision:1,origin:'https://n8n.example.invalid',key_ref:ready.state.secret.id,
      secret_version:1,enabled:true},fields:['id']});
  assert.deepEqual(ready.plans[1].input,{key:{id:ready.state.secret.id},required:true,
    where:{version:1,state:'active',binding_id:connectorId},fields:['id']});
  assert.deepEqual(ready.plans[1].fields,['id','version','state','binding_id']);
});

test('authenticated GET 404 carries the same private commit proofs while 429 does not',async()=>{
  const missing=await fixture(async()=>new Response(null,{status:404}));
  const missingGuards=[];
  assert.deepEqual(await missing.port({registerCommitGuards:tokens=>missingGuards.push(tokens)})
    .request({resource:'workflow',id:'gone'}),{kind:'error',code:'remote_not_found',status:404});
  assert.equal(missingGuards.length,1);
  assert.deepEqual(missingGuards[0],missing.plans);
  assert.equal(missing.plans.length,2);
  const limited=await fixture(async()=>new Response(null,{status:429}));
  const limitedGuards=[];
  assert.deepEqual(await limited.port({registerCommitGuards:tokens=>limitedGuards.push(tokens)})
    .request({resource:'workflow',id:'later'}),{kind:'error',code:'remote_error',status:429});
  assert.equal(limitedGuards.length,0);
});

test('a declared mutation sends only bounded fields with a claim-derived provider key',async()=>{
  const writing={...descriptor,resources:[...descriptor.resources,
    {id:'create',method:'POST',path:'/api/v1/items',params:[],
      body:{encoding:'json',fields:[{name:'title',wireName:'title',kind:'string',required:true,maxBytes:40}]},
      idempotencyHeader:'Idempotency-Key',successStatuses:[202]}]};
  const sent=[];
  const ready=await fixture(async(url,init)=>{sent.push({url:String(url),init});
    return new Response(JSON.stringify({taskUid:19}),
      {status:202,headers:{'content-type':'application/json'}});},writing);
  const registered=[];
  const result=await ready.port({registerCommitGuards:tokens=>registered.push(tokens)})
    .mutate({resource:'create',fields:{title:'Bonjour'}});
  assert.deepEqual(result,{kind:'ok',status:202,body:{taskUid:19}});
  assert.equal(sent.length,1);
  assert.equal(sent[0].url,'https://n8n.example.invalid/api/v1/items');
  assert.equal(sent[0].init.headers.get('Idempotency-Key'),'creezio-claim-123');
  assert.equal(sent[0].init.headers.get('Content-Type'),'application/json');
  assert.equal(sent[0].init.body,JSON.stringify({title:'Bonjour'}));
  assert.equal(registered.length,1);
  assert.equal(registered[0].length,2);
});

test('mutation rejects undeclared fields before egress and never retries an unknown outcome',async()=>{
  const writing={...descriptor,resources:[{id:'checkout',method:'POST',path:'/v1/checkout/sessions',
    params:[],body:{encoding:'form',fields:[
      {name:'price',wireName:'line_items[0][price]',kind:'string',required:true,maxBytes:128},
      {name:'quantity',wireName:'line_items[0][quantity]',kind:'integer',required:true,maxBytes:4}],
      fixed:[{name:'mode',value:'payment'}]},idempotencyHeader:'Idempotency-Key'}]};
  let calls=0;
  const ready=await fixture(async()=>{calls++;throw new Error('network lost');},writing);
  const port=ready.port({registerCommitGuards:()=>{}});
  assert.deepEqual(await port.mutate({resource:'checkout',fields:{price:'price_1',quantity:1,
    secret:'free-form'}}),{kind:'error',code:'invalid_request'});
  assert.equal(calls,0);
  const second=ready.port({registerCommitGuards:()=>{}});
  assert.deepEqual(await second.mutate({resource:'checkout',fields:{price:'price_1',quantity:1}}),
    {kind:'error',code:'outcome_unknown'});
  assert.deepEqual(await second.mutate({resource:'checkout',fields:{price:'price_1',quantity:1}}),
    {kind:'error',code:'invalid_request'});
  assert.equal(calls,1);
});

test('Meili document POST fixes primaryKey=id for ambiguous document fields',async()=>{
  const meili={...descriptor,resources:[meiliConnectorDescriptor.resources.find(
    item=>item.id==='document-upsert')]};
  const sent=[];
  const ready=await fixture(async(url,init)=>{sent.push({url:String(url),init});
    return new Response(JSON.stringify({taskUid:7,status:'enqueued'}),
      {status:202,headers:{'content-type':'application/json'}});},meili);
  const documents=[{id:'p1',productId:'sku1',category_id:'c1',title:'Book'},
    {id:'p2',productId:'sku2',category_id:'c2',title:'Desk'}];
  assert.deepEqual(await ready.port({registerCommitGuards:()=>{}}).mutate({resource:'document-upsert',
    id:'products',fields:{documents}}),
    {kind:'ok',status:202,body:{taskUid:7,status:'enqueued'}});
  assert.equal(sent.length,1);
  assert.equal(sent[0].url,'https://n8n.example.invalid/indexes/products/documents?primaryKey=id');
  assert.equal(sent[0].init.body,JSON.stringify(documents));
});

test('GET query fields are declared and bounded before network egress',async()=>{
  const search={...descriptor,resources:[{id:'search',method:'GET',path:'/indexes/{id}/search',
    params:['id','limit'],query:{fields:[
      {name:'q',wireName:'q',kind:'string',required:true,maxBytes:64},
      {name:'offset',wireName:'offset',kind:'integer',maxBytes:4}]}}]};
  const sent=[];
  const ready=await fixture(async(url)=>{sent.push(String(url));return new Response('{}',
    {headers:{'content-type':'application/json'}});},search);
  assert.deepEqual(await ready.port().request({resource:'search',id:'products',limit:8,
    fields:{q:'lamp',offset:2}}),{kind:'ok',status:200,body:{}});
  assert.equal(sent[0],'https://n8n.example.invalid/indexes/products/search?limit=8&q=lamp&offset=2');
  assert.deepEqual(await ready.port().request({resource:'search',id:'products',
    fields:{q:'lamp',arbitrary:'all'}}),{kind:'error',code:'invalid_request'});
  assert.equal(sent.length,1);
});
