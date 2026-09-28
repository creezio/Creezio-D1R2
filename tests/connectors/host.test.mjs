import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureConnectorDescriptor,connectorOrigin,createConnectorHost} from '../../core/connectors/host.ts';
import {createVaultKeyring,createVaultReference} from '../../core/vault/crypto.ts';

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
    field('secret_version','integer',false,true),field('enabled','boolean'),field('revision','integer'),
    field('updated_at','date-time')]};
const vaultModel={id:'connector_secret',scope:'context',contextField:'context_id',
  primaryKey:['context_id','id'],fields:[context,field('id','string',true),field('binding_id','string',true),
    field('ciphertext','string',true),field('key_id','string',true),
    field('version','integer',true,false,{minimum:1}),
    field('state','string',true,false,{enum:['active','revoked']})]};
const catalog={schemaVersion:1,compositionDigest:'sha256-test',modules:[{moduleId,enabled:true,version:'0.0.0',
  permissions:[],models:[{modelId:'connector_config',model:configModel,table:'config'},
    {modelId:'connector_secret',model:vaultModel,table:'secret'}]}]};

async function fixture(fetcher){
  const keyring=createVaultKeyring({activeKeyId:'key',keys:{key:new Uint8Array(32).fill(17)}});
  const reference=createVaultReference();
  const ciphertext=await keyring.seal({moduleId,contextId:'application',bindingId:connectorId,
    reference,version:1},'secret-value');
  const state={revoked:false,alive:true,config:{id:connectorId,origin:'https://n8n.example.invalid',key_ref:reference,
    secret_version:1,enabled:true,revision:1,updated_at:'2026-09-28T00:00:00.000Z'},
  secret:{id:reference,binding_id:connectorId,ciphertext,key_id:'key',version:1,state:'active'}};
  const identity={moduleId,contextId:'application',audience:'admin',principalId:'owner',
    actorPrincipalId:'owner',credentialKind:'session'};
  const data={
    async authorize(){if(state.revoked)throw Object.assign(new Error('revoked'),{code:'forbidden'});
      return {kind:'data-lease'};},
    describeLease(){return identity;},dispose(){},
    internalPort(_lease,options){return {async get(_model,input){
      const row=options.modelId==='connector_config'?state.config:state.secret;
      if(!row)return null;
      if(Object.entries(input.where??{}).some(([key,value])=>row[key]!==value))return null;
      return row;
    }};}
  };
  const host=createConnectorHost({data,catalog,descriptor,keyring,fetcher});
  const port=()=>host.port({lease:{kind:'data-lease'},credential:{kind:'session',token:'opaque'},
    contextId:'application',audience:'admin',actors:['user'],
    requiredPermissionIds:[`${moduleId}:read`],signal:new AbortController().signal,
    ensureActive(){if(!state.alive)throw new Error('operation closed');}});
  return {host,state,port};
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
