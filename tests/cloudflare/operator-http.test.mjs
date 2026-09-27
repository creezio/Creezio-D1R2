import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';
import {createLocalDeliveryServer} from '../../scripts/cloudflare/operator-http.mjs';

const appOrigin='http://127.0.0.1:5173';
const digest=`sha256-${'a'.repeat(64)}`;
const inspection={hostProfile:'docker-local',target:{accountId:'account-one',workerName:'worker-one'},
  configuration:'ready',preparation:'needed',activeTransferId:null,
  secretConnections:[]};
const prepared={transferId:'transfer-one',planDigest:digest,
  summary:{title:'Transfer',details:['One model'],warnings:[]}};
const transfer={transferId:'transfer-one',planDigest:digest,phase:'captured',summary:null,
  finalUrl:null,registryStatus:'pending'};
async function unusedPort(){
  const socket=createServer();
  await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));return port;
}
async function post(origin,route,cookie,body={},headers={}){
  const response=await fetch(`${origin}/api/local-delivery/${route}`,{method:'POST',headers:{
    origin:appOrigin,'x-creezio-request':'1','content-type':'application/json',connection:'close',
    cookie,...headers},body:JSON.stringify(body)});
  return {response,body:await response.json()};
}
async function get(origin,route,cookie,headers={}){
  const response=await fetch(`${origin}/api/local-delivery/${route}`,{headers:{origin:appOrigin,connection:'close',cookie,...headers}});
  return {response,body:await response.json()};
}

test('local capability binds native cookie and survives worker shutdown only for the prepared transfer',
  {timeout:30000},async t=>{
    const port=await unusedPort(),native=(await issueOpaqueToken('session')).token,
      wrong=(await issueOpaqueToken('session')).token;
    let online=true,authorizations=0,configureCalls=0,prepareCalls=0,startCalls=0,
      reconcileCalls=0,finishPrepare,finishStart;
    const fetcher=async(url,init)=>{
      if(url===`${appOrigin}/api/delivery/admin/connections`)
        return Response.json({secretConnections:[]});
      assert.equal(url,`${appOrigin}/api/delivery/admin/authorization`);
      assert.equal(init.headers.cookie,`creezio-local-admin=${native}`);
      assert.equal(init.headers.origin,appOrigin);
      assert.equal(init.headers['x-creezio-request'],'1');
      authorizations++;
      if(!online)throw new Error('Worker stopped');
      return Response.json({principalId:'principal-one',sessionId:'session-one',
        expiresAtMs:Date.now()+7_200_000,epoch:1,operatorOrigin:`http://127.0.0.1:${port}`});
    };
    const operations={
      inspect:async()=>inspection,
      configure:async()=>{configureCalls++;return inspection;},
      prepare:async input=>{prepareCalls++;assert.deepEqual(input,{secretSelections:[]});
        return new Promise(resolve=>{finishPrepare=()=>resolve(prepared);});},
      start:async input=>{startCalls++;assert.deepEqual(input,{transferId:'transfer-one',planDigest:digest});
        online=false;return new Promise(resolve=>{finishStart=()=>resolve(transfer);});},
      status:async id=>{assert.equal(id,'transfer-one');return transfer;},
      reconcile:async()=>{reconcileCalls++;return transfer;},
    };
    const server=createLocalDeliveryServer({config:{origin:appOrigin,operatorOrigin:`http://127.0.0.1:${port}`},
      port,operations,fetcher});
    await server.listen();t.after(()=>server.close());
    const initial=await post(server.origin,'session',`creezio-local-admin=${native}`);
    assert.equal(initial.response.status,200);
    assert.ok(initial.body.value.expiresAtMs<=Date.now()+3_600_000);
    const cap=initial.response.headers.get('set-cookie').split(';')[0];
    assert.match(initial.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const cookies=`creezio-local-admin=${native}; ${cap}`;
    let outcome=await get(server.origin,'inspect',cookies);
    assert.equal(outcome.response.status,200);
    outcome=await post(server.origin,'configure',cookies,
      {target:{accountId:'account-one',workerName:'worker-one'},credentials:{apiToken:'synthetic-secret'}});
    assert.equal(outcome.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));
    outcome=await get(server.origin,`jobs/${outcome.body.jobId}`,cookies);
    assert.equal(outcome.response.status,200);assert.equal(configureCalls,1);
    outcome=await post(server.origin,'prepare',cookies,{secretSelections:[]});
    assert.equal(outcome.response.status,202);const prepareJob=outcome.body.jobId;
    outcome=await post(server.origin,'prepare',cookies,{secretSelections:[]});
    assert.equal(outcome.body.jobId,prepareJob);assert.equal(prepareCalls,1);
    outcome=await get(server.origin,`jobs/${prepareJob}`,cookies);
    assert.equal(outcome.response.status,202);
    finishPrepare();await new Promise(resolve=>setImmediate(resolve));
    outcome=await get(server.origin,`jobs/${prepareJob}`,cookies);
    assert.equal(outcome.response.status,200);assert.deepEqual(outcome.body.value,prepared);
    outcome=await post(server.origin,'prepare',cookies,{secretSelections:[]});
    assert.equal(outcome.response.status,200);assert.deepEqual(outcome.body.value,prepared);
    assert.equal(prepareCalls,1);
    outcome=await post(server.origin,'start',cookies,{transferId:'transfer-one',planDigest:digest});
    assert.equal(outcome.response.status,202);const startJob=outcome.body.jobId;
    await new Promise(resolve=>setImmediate(resolve));assert.equal(startCalls,1);
    outcome=await post(server.origin,'start',cookies,{transferId:'transfer-one',planDigest:digest});
    assert.equal(outcome.body.jobId,startJob);assert.equal(startCalls,1);
    outcome=await get(server.origin,'status?transferId=transfer-one',cookies);
    assert.equal(outcome.response.status,200);assert.deepEqual(outcome.body.value,transfer);
    outcome=await post(server.origin,'reconcile',cookies,{transferId:'other',planDigest:digest});
    assert.equal(outcome.response.status,403);assert.equal(reconcileCalls,0);
    outcome=await post(server.origin,'reconcile',cookies,{transferId:'transfer-one',planDigest:digest});
    assert.equal(outcome.response.status,409); // The start callback still owns the transfer.
    finishStart();await new Promise(resolve=>setImmediate(resolve));
    outcome=await post(server.origin,'reconcile',cookies,{transferId:'transfer-one',planDigest:digest});
    assert.equal(outcome.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(reconcileCalls,1);
    outcome=await post(server.origin,'reconcile',cookies,{transferId:'transfer-one',planDigest:digest});
    assert.equal(outcome.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(reconcileCalls,2);
    outcome=await get(server.origin,'status?transferId=transfer-one',`creezio-local-admin=${wrong}; ${cap}`);
    assert.equal(outcome.response.status,401);
    outcome=await post(server.origin,'logout',cookies);
    assert.equal(outcome.response.status,200);
    outcome=await get(server.origin,'status?transferId=transfer-one',cookies);
    assert.equal(outcome.response.status,401);
    assert.equal(authorizations,12); // Every status/reconcile retries native ACL; only unavailable may use the started grant.
  });

test('failed start may be retried only while the exact journal remains prepared',
  {timeout:30000},async t=>{
    const port=await unusedPort(),native=(await issueOpaqueToken('session')).token;
    let starts=0,phase='prepared',revoked=false;
    const fetcher=async url=>url.endsWith('/connections')
      ?Response.json({secretConnections:[]})
      :revoked?Response.json({code:'forbidden'},{status:403})
        :Response.json({principalId:'principal-one',sessionId:'session-one',epoch:1,
          expiresAtMs:Date.now()+3_600_000,operatorOrigin:`http://127.0.0.1:${port}`});
    const current=()=>({...transfer,phase,summary:phase==='prepared'?prepared.summary:null});
    const server=createLocalDeliveryServer({config:{origin:appOrigin},port,fetcher,
      operations:{inspect:async()=>inspection,configure:async()=>inspection,
        prepare:async()=>prepared,status:async()=>current(),
        start:async()=>{starts++;if(starts===1)
          throw Object.assign(new Error('pre-start failure'),{code:'unavailable',status:503});
          return transfer;},reconcile:async()=>transfer}});
    await server.listen();t.after(()=>server.close());
    const initial=await post(server.origin,'session',`creezio-local-admin=${native}`);
    const cap=initial.response.headers.get('set-cookie').split(';')[0],
      cookies=`creezio-local-admin=${native}; ${cap}`;
    let result=await post(server.origin,'prepare',cookies,{secretSelections:[]});
    await new Promise(resolve=>setImmediate(resolve));
    result=await get(server.origin,`jobs/${result.body.jobId}`,cookies);
    assert.equal(result.response.status,200);
    const input={transferId:'transfer-one',planDigest:digest};
    result=await post(server.origin,'start',cookies,input);
    assert.equal(result.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));
    result=await get(server.origin,`jobs/${result.body.jobId}`,cookies);
    assert.equal(result.response.status,503);assert.equal(starts,1);
    phase='captured';
    result=await post(server.origin,'start',cookies,input);
    assert.equal(result.response.status,503);assert.equal(starts,1);
    phase='prepared';
    revoked=true;
    result=await post(server.origin,'start',cookies,input);
    assert.equal(result.response.status,403);assert.equal(starts,1);
    revoked=false;
    result=await post(server.origin,'start',cookies,input);
    assert.equal(result.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));
    result=await get(server.origin,`jobs/${result.body.jobId}`,cookies);
    assert.equal(result.response.status,200);assert.equal(starts,2);
  });

test('failed prepare can resume its durable intent after fresh native authorization',
  {timeout:30000},async t=>{
    const port=await unusedPort(),native=(await issueOpaqueToken('session')).token;
    let prepares=0,revoked=false;
    const fetcher=async url=>url.endsWith('/connections')
      ?Response.json({secretConnections:[]})
      :revoked?Response.json({code:'forbidden'},{status:403})
        :Response.json({principalId:'principal-one',sessionId:'session-one',epoch:1,
          expiresAtMs:Date.now()+3_600_000,operatorOrigin:`http://127.0.0.1:${port}`});
    const server=createLocalDeliveryServer({config:{origin:appOrigin},port,fetcher,
      operations:{inspect:async()=>inspection,configure:async()=>inspection,
        prepare:async()=>{prepares++;if(prepares===1)
          throw Object.assign(new Error('provisioning uncertain'),{code:'provision_unknown',status:409});
          return prepared;},status:async()=>transfer,start:async()=>transfer,reconcile:async()=>transfer}});
    await server.listen();t.after(()=>server.close());
    const initial=await post(server.origin,'session',`creezio-local-admin=${native}`);
    const cap=initial.response.headers.get('set-cookie').split(';')[0],
      cookies=`creezio-local-admin=${native}; ${cap}`,input={secretSelections:[]};
    let result=await post(server.origin,'prepare',cookies,input);
    assert.equal(result.response.status,202);
    const firstJob=result.body.jobId;
    await new Promise(resolve=>setImmediate(resolve));
    result=await get(server.origin,`jobs/${firstJob}`,cookies);
    assert.equal(result.response.status,409);assert.equal(prepares,1);
    revoked=true;
    result=await post(server.origin,'prepare',cookies,input);
    assert.equal(result.response.status,403);assert.equal(prepares,1);
    revoked=false;
    result=await post(server.origin,'prepare',cookies,input);
    assert.equal(result.response.status,202);
    assert.notEqual(result.body.jobId,firstJob);
    await new Promise(resolve=>setImmediate(resolve));
    result=await get(server.origin,`jobs/${result.body.jobId}`,cookies);
    assert.equal(result.response.status,200);assert.deepEqual(result.body.value,prepared);
    assert.equal(prepares,2);
    result=await get(server.origin,`jobs/${firstJob}`,cookies);
    assert.equal(result.response.status,409);
  });

test('operator refuses cross-origin and missing CSRF before invoking callbacks',{timeout:30000},async t=>{
  const port=await unusedPort();let calls=0;
  const server=createLocalDeliveryServer({config:{origin:appOrigin},port,
    operations:{configure(){calls++;},prepare(){calls++;},start(){calls++;},status(){calls++;},reconcile(){calls++;}},
    fetcher(){calls++;throw new Error('must not authorize');}});
  await server.listen();t.after(()=>server.close());
  let outcome=await post(server.origin,'session','',{}, {origin:'http://attacker.invalid'});
  assert.equal(outcome.response.status,403);
  outcome=await post(server.origin,'session','',{}, {'x-creezio-request':'0'});
  assert.equal(outcome.response.status,403);
  assert.equal(calls,0);
});

test('reload preserves a grant; restart resumes only the same principal and exact plan with fresh ACL',
  {timeout:30000},async t=>{
    const port=await unusedPort(),owner=(await issueOpaqueToken('session')).token,
      second=(await issueOpaqueToken('session')).token,other=(await issueOpaqueToken('session')).token;
    let revoked=false,reads=0;
    const identities=new Map([[owner,{principalId:'owner-one',sessionId:'session-one'}],
      [second,{principalId:'owner-one',sessionId:'session-two'}],
      [other,{principalId:'other-owner',sessionId:'session-three'}]]);
    const fetcher=async(url,init)=>{
      if(url===`${appOrigin}/api/delivery/admin/connections`)
        return Response.json({secretConnections:[]});
      const token=init.headers.cookie.split('=')[1],identity=identities.get(token);
      if(!identity||revoked&&token===second)return Response.json({error:{code:'forbidden'}},{status:403});
      return Response.json({...identity,expiresAtMs:Date.now()+7_200_000,epoch:1,
        operatorOrigin:`http://127.0.0.1:${port}`});
    };
    const operations={
      inspect:async()=>inspection,configure:async()=>inspection,prepare:async()=>prepared,
      start:async()=>transfer,reconcile:async()=>transfer,
      status:async(id,context)=>{reads++;if(context.principalId!=='owner-one')
        throw Object.assign(new Error('Forbidden'),{code:'forbidden',status:403});
        assert.equal(id,'transfer-one');return {...transfer,phase:'prepared',summary:prepared.summary};},
    };
    const options={config:{origin:appOrigin},port,operations,fetcher};
    const first=createLocalDeliveryServer(options);await first.listen();
    let result=await post(first.origin,'session',`creezio-local-admin=${owner}`);
    const cap=result.response.headers.get('set-cookie').split(';')[0],cookies=`creezio-local-admin=${owner}; ${cap}`;
    result=await post(first.origin,'prepare',cookies,{secretSelections:[]});
    await new Promise(resolve=>setImmediate(resolve));
    result=await post(first.origin,'session',cookies);
    assert.equal(result.response.status,200);
    assert.equal(result.response.headers.get('set-cookie'),null);
    result=await get(first.origin,'status?transferId=transfer-one',cookies);
    assert.equal(result.response.status,200);
    result=await post(first.origin,'reconcile',cookies,{transferId:'transfer-one',planDigest:digest});
    assert.equal(result.response.status,409);
    await first.close();
    const restarted=createLocalDeliveryServer(options);await restarted.listen();t.after(()=>restarted.close());
    result=await post(restarted.origin,'session',`creezio-local-admin=${other}`);
    const otherCap=result.response.headers.get('set-cookie').split(';')[0];
    result=await get(restarted.origin,'status?transferId=transfer-one',
      `creezio-local-admin=${other}; ${otherCap}`);
    assert.equal(result.response.status,403);
    result=await post(restarted.origin,'session',`creezio-local-admin=${second}`);
    const ownerCap=result.response.headers.get('set-cookie').split(';')[0],ownerCookies=`creezio-local-admin=${second}; ${ownerCap}`;
    result=await get(restarted.origin,'status?transferId=transfer-one',ownerCookies);
    assert.equal(result.response.status,200);
    assert.equal(result.body.value.phase,'prepared');
    result=await get(restarted.origin,'status?transferId=transfer-one',ownerCookies);
    assert.equal(result.response.status,200);assert.equal(reads,5);
    revoked=true;
    result=await post(restarted.origin,'reconcile',ownerCookies,
      {transferId:'transfer-one',planDigest:digest});
    assert.equal(result.response.status,403);
    result=await post(restarted.origin,'configure',ownerCookies,
      {target:{accountId:'account-one',workerName:'worker-one'},credentials:{apiToken:'synthetic-secret'}});
    assert.equal(result.response.status,403);
  });

test('operator accepts a bounded selection list larger than the former small body limit',
  {timeout:30000},async t=>{
    const port=await unusedPort(),native=(await issueOpaqueToken('session')).token;
    const secretConnections=Array.from({length:150},(_,index)=>({contextId:'application',
      reference:`creezio-secret:v1:${index.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`,
      bindingId:`connection-${index}`,label:'Connection '.padEnd(240,'x')}));
    const selected=secretConnections.map(({contextId,reference,bindingId})=>
      ({contextId,reference,bindingId,mode:'disable'}));
    assert.ok(Buffer.byteLength(JSON.stringify({secretSelections:selected}))>16_384);
    const fetcher=async url=>url.endsWith('/connections')
      ?Response.json({secretConnections})
      :Response.json({principalId:'principal-one',sessionId:'session-one',epoch:1,
        expiresAtMs:Date.now()+3_600_000,operatorOrigin:`http://127.0.0.1:${port}`});
    let observed=0;
    const server=createLocalDeliveryServer({config:{origin:appOrigin},port,fetcher,
      operations:{inspect:async context=>({...inspection,secretConnections:context.secretConnections}),
        configure:async()=>({...inspection,secretConnections}),
        prepare:async(input,context)=>{assert.deepEqual(input.secretSelections,selected);
          assert.equal(context.secretConnections.length,150);observed++;return prepared;},
        start:async()=>transfer,status:async()=>transfer,reconcile:async()=>transfer}});
    await server.listen();t.after(()=>server.close());
    const initial=await post(server.origin,'session',`creezio-local-admin=${native}`);
    const cap=initial.response.headers.get('set-cookie').split(';')[0],
      cookies=`creezio-local-admin=${native}; ${cap}`;
    let outcome=await get(server.origin,'inspect',cookies);
    assert.equal(outcome.response.status,200);
    assert.equal(outcome.body.value.secretConnections.length,150);
    outcome=await post(server.origin,'prepare',cookies,{secretSelections:selected});
    assert.equal(outcome.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));
    outcome=await get(server.origin,`jobs/${outcome.body.jobId}`,cookies);
    assert.equal(outcome.response.status,200);
    assert.equal(observed,1);
  });

test('update routes bind an exact plan and recover ownership through status',
  {timeout:30000},async t=>{
    const port=await unusedPort(),native=(await issueOpaqueToken('session')).token;
    const updateId='update-one';
    const updatePrepared={kind:'update',updateId,planDigest:digest,
      summary:{title:'Update',details:['Schema only'],warnings:[]}};
    const updateStatus={kind:'update',updateId,planDigest:digest,phase:'delivered',summary:null,
      finalUrl:'https://example.workers.dev',registryStatus:'effective'};
    let starts=0,reconciles=0,prepares=0,online=true,phase='prepared';
    const fetcher=async url=>{if(url.endsWith('/connections'))return Response.json({secretConnections:[]});
      if(!online)throw new Error('local runtime stopped');
      return Response.json({principalId:'principal-one',sessionId:'session-one',epoch:1,
        expiresAtMs:Date.now()+3_600_000,operatorOrigin:`http://127.0.0.1:${port}`});};
    const operations={inspect:async()=>inspection,configure:async()=>inspection,
      prepare:async()=>prepared,start:async()=>transfer,status:async()=>transfer,
      reconcile:async()=>transfer,
      inspectUpdate:async()=>({kind:'update',readiness:'ready',currentPublicationId:'publication-one',
        activeUpdateId:null,target:inspection.target}),
      prepareUpdate:async()=>{prepares++;return prepares===1?updatePrepared:
        {...updatePrepared,updateId:'update-two'};},
      startUpdate:async input=>{starts++;assert.deepEqual(input,{updateId,planDigest:digest});
        phase='delivered';return updateStatus;},
      statusUpdate:async(id,context)=>{assert.equal(id,updateId);
        assert.equal(context.principalId,'principal-one');return phase==='prepared'
          ?{...updateStatus,phase,summary:updatePrepared.summary,finalUrl:null,registryStatus:'pending'}
          :updateStatus;},
      reconcileUpdate:async()=>{reconciles++;return updateStatus;}};
    const server=createLocalDeliveryServer({config:{origin:appOrigin},port,operations,fetcher});
    await server.listen();t.after(()=>server.close());
    let result=await post(server.origin,'session',`creezio-local-admin=${native}`);
    const cap=result.response.headers.get('set-cookie').split(';')[0],
      cookies=`creezio-local-admin=${native}; ${cap}`;
    result=await get(server.origin,'update/inspect',cookies);
    assert.equal(result.response.status,200);
    result=await post(server.origin,'update/prepare',cookies,{});
    assert.equal(result.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));
    result=await get(server.origin,`jobs/${result.body.jobId}`,cookies);
    assert.deepEqual(result.body.value,updatePrepared);
    result=await post(server.origin,'update/prepare',cookies,{});
    assert.equal(result.response.status,200);
    assert.deepEqual(result.body.value,updatePrepared);
    assert.equal(prepares,1);
    result=await post(server.origin,'update/start',cookies,{updateId:'other',planDigest:digest});
    assert.equal(result.response.status,403);assert.equal(starts,0);
    result=await post(server.origin,'update/start',cookies,{updateId,planDigest:digest});
    assert.equal(result.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(starts,1);
    result=await get(server.origin,`jobs/${result.body.jobId}`,cookies);
    assert.deepEqual(result.body.value,updateStatus);
    online=false;
    result=await get(server.origin,`update/status?updateId=${updateId}`,cookies);
    assert.deepEqual(result.body.value,updateStatus);
    online=true;
    result=await post(server.origin,'session',cookies);
    assert.equal(result.response.status,200);
    result=await get(server.origin,`update/status?updateId=${updateId}`,cookies);
    assert.deepEqual(result.body.value,updateStatus);
    result=await post(server.origin,'update/reconcile',cookies,{updateId,planDigest:digest});
    assert.equal(result.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(reconciles,1);
    result=await post(server.origin,'update/prepare',cookies,{});
    assert.equal(result.response.status,202);
    await new Promise(resolve=>setImmediate(resolve));
    result=await get(server.origin,`jobs/${result.body.jobId}`,cookies);
    assert.equal(result.response.status,200);
    assert.equal(result.body.value.updateId,'update-two');
    assert.equal(prepares,2);
    result=await post(server.origin,'update/start',cookies,{updateId,planDigest:digest});
    assert.equal(result.response.status,403);
    assert.equal(starts,1);
  });
