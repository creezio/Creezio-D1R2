import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalDeliveryTransport} from '../../admin/delivery/transport.ts';

const origin='http://127.0.0.1:5173',operator='http://127.0.0.1:5176';
const digest=`sha256-${'a'.repeat(64)}`;
const data={hostProfile:'docker-local',target:null,configuration:'needed',preparation:'needed',activeTransferId:null,secretConnections:[]};
function access(){
  let session={id:'session-1'},listener;
  return {origin,audience:'admin',getSnapshot:()=>({phase:session?'authenticated':'anonymous',session,pending:null}),
    subscribe(fn){listener=fn;return ()=>{};},logout(){session=null;listener();}};
}
function startup(url){
  if(url.endsWith('/authorization'))return Response.json({operatorOrigin:operator});
  if(url.endsWith('/session'))return Response.json({ok:true,value:{sessionId:'session-1',operatorOrigin:operator}});
}
test('browser transport polls the accepted job and never repeats a mutation with unknown response',async()=>{
  const seen=[];let polls=0;
  const transport=createLocalDeliveryTransport({access:access(),pollMs:1,fetcher:async(url,init)=>{
    seen.push({url,init});const initial=startup(url);if(initial)return initial;
    if(url.endsWith('/inspect'))return Response.json({ok:true,value:data});
    if(url.endsWith('/prepare'))return Response.json({ok:true,pending:true,jobId:'a'.repeat(22)},{status:202});
    if(url.includes('/jobs/')){polls++;return polls===1
      ?Response.json({ok:true,pending:true,jobId:'a'.repeat(22)},{status:202})
      :Response.json({ok:true,value:{transferId:'one',planDigest:digest,summary:{title:'One',details:[],warnings:[]}}});}
    throw new Error('connection lost');
  }});
  try{
    assert.deepEqual(await transport.inspect(),{ok:true,value:data});
    assert.equal((await transport.prepare({secretSelections:[]})).ok,true);
    assert.equal(polls,2);assert.equal(seen.filter(item=>item.url.endsWith('/prepare')).length,1);
    assert.deepEqual(await transport.start({transferId:'one',planDigest:digest}),{ok:false,code:'outcome_unknown'});
    assert.equal(seen.filter(item=>item.url.endsWith('/start')).length,1);
    assert.ok(seen.every(item=>item.init.credentials==='include'&&item.init.redirect==='error'));
  }finally{transport.dispose();}
});
test('browser operator discovery refuses a remote target and discards completion after logout',async()=>{
  let remoteCalls=0;
  const denied=createLocalDeliveryTransport({access:access(),fetcher:async url=>{
    remoteCalls++;return Response.json({operatorOrigin:'https://evil.example'});
  }});
  assert.deepEqual(await denied.inspect(),{ok:false,code:'invalid_response'});assert.equal(remoteCalls,1);denied.dispose();
  const identity=access();let complete,called;
  const waiting=new Promise(resolve=>{called=resolve;});
  const transport=createLocalDeliveryTransport({access:identity,fetcher:async url=>{
    const initial=startup(url);if(initial)return initial;
    called();return new Promise(resolve=>{complete=resolve;});
  }});
  const request=transport.configure({target:{accountId:'account',workerName:'worker'},credentials:{apiToken:'synthetic'}});
  await waiting;identity.logout();complete(Response.json({ok:true,value:data}));
  assert.deepEqual(await request,{ok:false,code:'stale'});transport.dispose();
});

test('browser rebinds a passive read after operator restart without replaying a mutation',async()=>{
  let sessions=0,reads=0,mutations=0,capability=0;
  const transport=createLocalDeliveryTransport({access:access(),fetcher:async url=>{
    const initial=startup(url);
    if(url.endsWith('/authorization'))return initial;
    if(url.endsWith('/session')){
      sessions++;capability=sessions;
      return initial;
    }
    if(url.endsWith('/inspect')){
      reads++;
      return capability===1?Response.json({ok:false,code:'authentication_required'},{status:401})
        :Response.json({ok:true,value:data});
    }
    if(url.endsWith('/prepare')){
      mutations++;
      return Response.json({ok:false,code:'authentication_required'},{status:401});
    }
    throw new Error('unexpected request');
  }});
  try{
    assert.deepEqual(await transport.inspect(),{ok:true,value:data});
    assert.equal(sessions,2);assert.equal(reads,2);
    assert.deepEqual(await transport.prepare({secretSelections:[]}),{ok:false,code:'authentication_required'});
    assert.equal(mutations,1);assert.equal(sessions,2);
    assert.deepEqual(await transport.inspect(),{ok:true,value:data});
    assert.equal(sessions,3);
  }finally{transport.dispose();}
});

test('browser update start acknowledges one accepted job and reads its exact status',async()=>{
  const seen=[];
  const update={kind:'update',updateId:'update-one',planDigest:digest,phase:'delivered',summary:null,
    finalUrl:'https://example.workers.dev',registryStatus:'effective'};
  const transport=createLocalDeliveryTransport({access:access(),fetcher:async(url,init)=>{
    seen.push(url);const initial=startup(url);if(initial)return initial;
    if(url.endsWith('/update/start'))
      return Response.json({ok:true,pending:true,jobId:'a'.repeat(22)},{status:202});
    if(url.endsWith('/update/status?updateId=update-one'))return Response.json({ok:true,value:update});
    throw new Error('unexpected request');
  }});
  try{
    assert.deepEqual(await transport.startUpdate({updateId:'update-one',planDigest:digest}),
      {ok:true,value:{...update,phase:'building',finalUrl:null,registryStatus:'pending'}});
    assert.deepEqual(await transport.statusUpdate('update-one'),{ok:true,value:update});
    assert.equal(seen.filter(url=>url.endsWith('/update/start')).length,1);
    assert.equal(seen.filter(url=>url.includes('/jobs/')).length,0);
  }finally{transport.dispose();}
});

test('browser posts one exact rejection request and accepts only a bounded terminal receipt',async()=>{
  const seen=[];let malformed=false;
  const diagnostic={phase:'wrangler',reason:'exit_nonzero',exitCode:1,apiCodes:[10021],
    validationIssue:'unknown_validation'};
  const terminal={kind:'update',updateId:'update-one',planDigest:digest,phase:'rejected',
    summary:null,finalUrl:null,registryStatus:'pending',retryEligible:false,diagnostic};
  const transport=createLocalDeliveryTransport({access:access(),fetcher:async(url,init)=>{
    const initial=startup(url);if(initial)return initial;
    if(url.endsWith('/update/reject')){
      seen.push(JSON.parse(init.body));
      return Response.json({ok:true,value:malformed
        ?{...terminal,diagnostic:{...diagnostic,rawLog:'provider secret'}}:terminal});
    }
    throw new Error('unexpected request');
  }});
  try{
    const input={updateId:'update-one',planDigest:digest};
    assert.deepEqual(await transport.rejectUpdate(input),{ok:true,value:terminal});
    malformed=true;
    assert.deepEqual(await transport.rejectUpdate(input),{ok:false,code:'invalid_response'});
    assert.deepEqual(seen,[input,input]);
  }finally{transport.dispose();}
});
