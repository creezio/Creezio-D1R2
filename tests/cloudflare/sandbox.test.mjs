import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {compileWidgetSandbox} from '../../scripts/widgets/sandbox.mjs';
import {createCloudflareSandboxPublisher,readSandboxContent,CloudflareSandboxError}
  from '../../scripts/cloudflare/sandbox.mjs';

const accountId='a'.repeat(32),sourceSha='f'.repeat(40);
const versionId='11111111-2222-3333-4444-555555555555';
const target={schemaVersion:1,accountId,workerName:'first-app',
  databaseId:'22222222-3333-4444-5555-666666666666',databaseName:'first-db',
  bucketName:'first-bucket',origin:'https://first-app.acct.workers.dev',
  widgetSandboxOrigin:'https://first-app-widgets.acct.workers.dev'};
const source=()=>({head:sourceSha,tree:'e'.repeat(40),sha256:'d'.repeat(64),dirty:false});
const ok=body=>Response.json({success:true,result:body});

function fixture(t){
  const root=temporaryDirectory(t,'creezio-cloudflare-sandbox-');
  let profile='a',remote=null,uploads=0,lost=false,commits=true,builds=0,corruptBuild=false,
    raceOnIntent=false,versionResponseId=versionId;
  const calls=[];const records=new Map();
  const journal={
    async load(id){return records.get(id)??null;},
    async create(record){assert.equal(records.has(record.transferId),false);records.set(record.transferId,record);},
    async compareAndSave(previous,next){
      assert.deepEqual(records.get(previous.transferId),previous);
      assert.equal(next.revision,previous.revision+1);
      records.set(previous.transferId,next);
      if(raceOnIntent&&next.stage==='upload-intent')remote={record:{transferId:'foreign',
        artifactDigest:`sha256-${'a'.repeat(64)}`,sourceSha},
        script:'export default {};',deploymentId:versionId};
    }
  };
  const build=async ({name,accountId,appOrigin})=>{
    builds++;
    const catalog={resources:[{cspProfileId:`sha256-${profile.repeat(64)}`,
      uiMeta:{csp:{connectDomains:[],resourceDomains:[],frameDomains:[],baseUriDomains:[]},permissions:{}}}]};
    const compiled=compileWidgetSandbox({catalog,hostOrigins:[appOrigin]});
    const output=path.join(root,'.creezio/widget-sandbox');mkdirSync(output,{recursive:true});
    writeFileSync(path.join(output,'worker.mjs'),compiled.script);
    writeFileSync(path.join(output,'wrangler.json'),JSON.stringify({name,account_id:accountId,
      main:'worker.mjs',compatibility_date:'2026-05-15',no_bundle:true,workers_dev:true,
      observability:{enabled:false},...(corruptBuild?{vars:{TOKEN:'should-not-exist'}}:{})}));
    writeFileSync(path.join(output,'build.json'),JSON.stringify({name,accountId,
      artifactDigest:compiled.digest,hostOrigins:compiled.hostOrigins,
      profileIds:compiled.profileIds,assetPaths:compiled.assetPaths,
      bytes:Buffer.byteLength(compiled.script)}));
  };
  const controlPlane={accountId,
    async inspectConnection(scope){assert.equal(scope,'account');return {accountId,
      tokenId:'b'.repeat(32),workersSubdomain:'acct'};},
    async deployments(name){assert.equal(name,'first-app-widgets');
      return {deployments:remote?[{id:remote.deploymentId,versions:[{percentage:100,version_id:versionId}]}]:[]};},
    async workerSettings(name){assert.equal(name,'first-app-widgets');
      return remote?{annotations:{'workers/tag':`czw-${remote.record.transferId}`,
        'workers/message':`Creezio widget sandbox ${remote.record.artifactDigest} ${remote.record.sourceSha}`},
      bindings:remote.bindings??[]}:null;},
    async version(name,id){assert.equal(name,'first-app-widgets');assert.equal(id,versionId);return {id};}
  };
  const fetcher=async (url,init)=>{
    calls.push({url,init});
    if(url.startsWith('https://api.cloudflare.com/')){
      assert.equal(init.redirect,'error');
      assert.equal(init.headers.Authorization,'Bearer test-token-at-least-20-chars');
      assert.ok(url.endsWith(`/workers/workers/first-app-widgets/versions/${versionId}?include=modules`));
      if(!remote)return new Response(null,{status:404});
      const script=remote.script;
      return Response.json({success:true,result:{id:versionResponseId,main_module:'worker.mjs',modules:[
        {name:'worker.mjs',content_type:'application/javascript+module',
          content_base64:Buffer.from(script).toString('base64')}]}});
    }
    assert.equal(url,target.widgetSandboxOrigin+'/sandbox-config.js');
    assert.equal(init.redirect,'error');
    return new Response(`globalThis.config=${JSON.stringify([target.origin])};`);
  };
  const upload=async ({record,configPath})=>{
    uploads++;
    assert.equal(records.get(record.transferId).stage,'upload-intent');
    assert.equal(configPath,path.join(root,'.creezio/widget-sandbox/wrangler.json'));
    assert.equal(JSON.parse(readFileSync(configPath,'utf8')).vars,undefined);
    if(commits)remote={record,script:readFileSync(path.join(root,'.creezio/widget-sandbox/worker.mjs'),'utf8'),
      deploymentId:'33333333-4444-5555-6666-777777777777'};
    if(lost)throw new Error('ack lost');
  };
  const publisher=createCloudflareSandboxPublisher({root,target,
    token:'test-token-at-least-20-chars',controlPlane,journal,fetcher,build,upload,source});
  return {publisher,records,calls,build,
    setProfile(value){profile=value;},setLost(value){lost=value;},setCommit(value){commits=value;},
    setCorruptBuild(value){corruptBuild=value;},
    setRaceOnIntent(value){raceOnIntent=value;},
    setVersionResponseId(value){versionResponseId=value;},
    get uploads(){return uploads;},get builds(){return builds;},
    setRemote(value){remote=value;},get remote(){return remote;}};
}

test('fresh per-app sandbox journals intent, publishes one static Worker and reads its exact script',async t=>{
  const f=fixture(t);
  const result=await f.publisher.publishSandbox({transferId:'transfer-1'});
  assert.equal(result.state,'confirmed');
  assert.equal(result.receipt.origin,target.widgetSandboxOrigin);
  assert.equal(f.uploads,1);
  assert.equal(f.records.get('transfer-1').stage,'confirmed');
  assert.equal(f.calls.filter(call=>call.url.includes('?include=modules')).length,1);
  assert.ok(f.remote.script.includes(target.origin));
  assert.equal(f.remote.script.includes('test-token-at-least-20-chars'),false);
  const again=await f.publisher.publishSandbox({transferId:'transfer-1'});
  assert.equal(again.state,'confirmed');assert.equal(f.uploads,1);
});

test('existing unlinked Worker and wrong app sandbox origin refuse before upload',async t=>{
  const f=fixture(t);
  f.setRemote({record:{transferId:'foreign',artifactDigest:`sha256-${'a'.repeat(64)}`,
    sourceSha},script:'export default {};',deploymentId:versionId});
  await assert.rejects(f.publisher.publishSandbox({transferId:'transfer-2'}),
    error=>error instanceof CloudflareSandboxError&&error.code==='worker_exists');
  assert.equal(f.uploads,0);assert.equal(f.records.size,0);
  const bad={...target,widgetSandboxOrigin:'https://other.acct.workers.dev'};
  const publisher=createCloudflareSandboxPublisher({root:temporaryDirectory(t,'creezio-sandbox-target-'),
    target:bad,token:'test-token-at-least-20-chars',controlPlane:{accountId,
      inspectConnection:async()=>({accountId,tokenId:'b'.repeat(32),workersSubdomain:'acct'})},
    journal:{load:async()=>null,create:async()=>{},compareAndSave:async()=>{}},source});
  await assert.rejects(publisher.publishSandbox({transferId:'transfer-3'}),
    error=>error instanceof CloudflareSandboxError&&error.code==='target_mismatch');
});

test('secret-bearing build and unexpected live binding fail closed',async t=>{
  const f=fixture(t);f.setCorruptBuild(true);
  await assert.rejects(f.publisher.publishSandbox({transferId:'bad-build'}),
    error=>error instanceof CloudflareSandboxError&&error.code==='build_mismatch');
  assert.equal(f.records.size,0);assert.equal(f.uploads,0);
  f.setCorruptBuild(false);
  await f.publisher.publishSandbox({transferId:'clean-build'});
  f.remote.bindings=[{name:'TOKEN',type:'secret_text'}];
  await assert.rejects(f.publisher.inspectSandbox({transferId:'clean-build'}),
    error=>error instanceof CloudflareSandboxError&&error.code==='remote_conflict');
});

test('a Worker appearing after the journal intent blocks the upload',async t=>{
  const f=fixture(t);f.setRaceOnIntent(true);
  await assert.rejects(f.publisher.publishSandbox({transferId:'raced-transfer'}),
    error=>error instanceof CloudflareSandboxError&&error.code==='worker_exists');
  assert.equal(f.records.get('raced-transfer').stage,'upload-intent');
  assert.equal(f.uploads,0);
});

test('lost acknowledgement reconciles by inspection, and unresolved intent never uploads twice',async t=>{
  const f=fixture(t);f.setLost(true);
  const result=await f.publisher.publishSandbox({transferId:'transfer-4'});
  assert.equal(result.state,'confirmed');assert.equal(f.uploads,1);
  const g=fixture(t);g.setLost(true);g.setCommit(false);
  // A failed upload without a remotely visible Worker leaves an inspect-only intent.
  const missing=await g.publisher.publishSandbox({transferId:'transfer-5'});
  assert.equal(missing.state,'unknown');
  assert.equal((await g.publisher.publishSandbox({transferId:'transfer-5'})).state,'unknown');
  assert.equal(g.uploads,1);
});

test('update requires a previously confirmed receipt for the same Worker and exact old deployment',async t=>{
  const f=fixture(t);
  const first=await f.publisher.publishSandbox({transferId:'old-transfer'});
  f.setProfile('c');
  const second=await f.publisher.publishSandbox({transferId:'new-transfer',previousReceipt:first.receipt});
  assert.equal(second.state,'confirmed');assert.equal(f.uploads,2);
  assert.notEqual(second.receipt.artifactDigest,first.receipt.artifactDigest);
});

test('version reader rejects wrong envelope, extra module and non-account request',async()=>{
  const base={accountId,name:'first-app-widgets',versionId,token:'test-token-at-least-20-chars'};
  await assert.rejects(readSandboxContent({...base,fetcher:async()=>new Response('{}',
    {headers:{'content-type':'application/json'}})}),
  error=>error instanceof CloudflareSandboxError&&error.code==='content_format');
  const module={name:'worker.mjs',content_type:'application/javascript+module',content_base64:'YQ=='};
  await assert.rejects(readSandboxContent({...base,fetcher:async()=>Response.json({success:true,result:{id:versionId,
    main_module:'worker.mjs',modules:[module,module]}})}),
  error=>error instanceof CloudflareSandboxError&&error.code==='content_format');
  await assert.rejects(readSandboxContent({...base,accountId:'invalid',fetcher:async()=>ok({})}),
    error=>error instanceof CloudflareSandboxError&&error.code==='invalid_input');
});

test('sandbox content is never attributed to a response for another version',async t=>{
  const wrong=fixture(t);await wrong.publisher.publishSandbox({transferId:'wrong-version'});
  wrong.setVersionResponseId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal((await wrong.publisher.inspectSandbox({transferId:'wrong-version'})).state,'unknown');
});
