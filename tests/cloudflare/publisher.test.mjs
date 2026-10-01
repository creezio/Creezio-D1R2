import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {measureRuntimeArtifacts} from '../../scripts/quality/runtime.mjs';
import {inspectCloudflareDelivery,inspectCloudflareCurrent,createCloudflarePublisher,
  runCloudflareUpload,
  CloudflarePublicationError,publicationFailure} from '../../scripts/cloudflare/publisher.mjs';
import {cloudflareArtifactRoot} from '../../scripts/cloudflare/artifact-path.mjs';
import {cloudflareWorkerConfiguration} from '../../scripts/cloudflare/config.mjs';
import {sourceIdentity} from '../../scripts/quality/evidence.mjs';

const target={schemaVersion:1,accountId:'a'.repeat(32),workerName:'first-app',databaseName:'first-db',
  databaseId:'11111111-1111-4111-8111-111111111111',bucketName:'first-files',
  origin:'https://first-app.example.workers.dev',widgetSandboxOrigin:'https://sandbox.example.workers.dev'};
const versionId='22222222-2222-4222-8222-222222222222';
const delivery={id:'deployment-1',versions:[{percentage:100,version_id:versionId}]};
test('publication diagnostics expose only bounded scalars',()=>{
  const failure=new CloudflarePublicationError('outcome_unknown',{phase:'wrangler',
    reason:'exit_nonzero',exitCode:1,apiCodes:[10001,10002,10003,10004,10005],
    stderr:'Bearer very-secret-token'});
  assert.deepEqual(publicationFailure(failure),{phase:'wrangler',reason:'exit_nonzero',
    exitCode:1,apiCodes:[10001,10002,10003,10004]});
  assert.deepEqual(publicationFailure(new Error('Bearer very-secret-token')),
    {phase:'unknown',reason:'unavailable',exitCode:null,apiCodes:[]});
});
test('Wrangler 10021 extracts only a closed validation issue across stderr chunks',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'creezio-wrangler-diagnostic-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,'node_modules/wrangler/bin'),{recursive:true});
  writeFileSync(path.join(root,'node_modules/wrangler/bin/wrangler.js'),'');
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  const spawnChild=()=>{queueMicrotask(()=>{
    child.stderr.emit('data',Buffer.from('Bearer secret-value https://host.invalid/?token=secret'));
    child.stderr.emit('data',Buffer.from(' Script startup exceeded CPU'));
    child.stderr.emit('data',Buffer.from(' time limit (code: 10021)'));
    child.emit('close',1);
  });return child;};
  let error;
  try{await runCloudflareUpload({root,configPath:'wrangler.json',transferId:'update-one',
    artifact:{artifactDigest:`sha256-${'a'.repeat(64)}`,sourceSha:'b'.repeat(40),
      compositionDigest:`sha256-${'c'.repeat(64)}`},token:'x'.repeat(24),accountId:'a'.repeat(32)},
    spawnChild);}catch(cause){error=cause;}
  assert.equal(error?.code,'outcome_unknown');
  const diagnostic=publicationFailure(error);
  assert.deepEqual(diagnostic,{phase:'wrangler',reason:'exit_nonzero',exitCode:1,
    apiCodes:[10021],validationIssue:'startup_cpu_limit'});
  assert.equal(JSON.stringify(diagnostic).includes('secret'),false);
});
function fixture(t){
  const root=mkdtempSync(path.join(tmpdir(),'creezio-publisher-'));
  const artifactRoot=path.join(root,'.wrangler','delivery','build','artifact');
  t.after(()=>{if(root.startsWith(path.resolve(tmpdir())+path.sep))rmSync(root,{recursive:true,force:true});});
  mkdirSync(path.join(artifactRoot,'dist/server/ssr'),{recursive:true});
  mkdirSync(path.join(artifactRoot,'dist/client/.vite'),{recursive:true});
  writeFileSync(path.join(artifactRoot,'dist/server/index.js'),'import {value} from "./dep.js"; export default {value};\n');
  writeFileSync(path.join(artifactRoot,'dist/server/dep.js'),'export const value = "expected";\n');
  writeFileSync(path.join(artifactRoot,'dist/server/ssr/unused.js'),'export default "not deployed";\n');
  writeFileSync(path.join(artifactRoot,'dist/server/wrangler.json'),'{}\n');
  writeFileSync(path.join(artifactRoot,'dist/client/favicon.svg'),'<svg/>\n');
  writeFileSync(path.join(artifactRoot,'dist/client/_headers'),'/*\n x-test: true\n');
  writeFileSync(path.join(artifactRoot,'dist/client/.assetsignore'),'ignored\n');
  writeFileSync(path.join(artifactRoot,'dist/client/.vite/manifest.json'),'{}\n');
  const artifact={sourceSha:'b'.repeat(40),compositionDigest:'sha256-'+'c'.repeat(64),
    artifactDigest:measureRuntimeArtifacts(artifactRoot).digest,coreVersion:'0.0.0',contractVersion:'1.0.0'};
  const settings={annotations:{'workers/tag':'cz-transfer1',
    'workers/message':`Creezio ${artifact.artifactDigest} ${artifact.sourceSha}`},bindings:[
    {type:'d1',name:'DB',id:target.databaseId},{type:'r2_bucket',name:'BUCKET',bucket_name:target.bucketName},
    {type:'plain_text',name:'CREEZIO_RUNTIME_PROFILE',text:'cloudflare'},
    {type:'plain_text',name:'CREEZIO_APP_ORIGIN',text:target.origin},
    {type:'plain_text',name:'CREEZIO_WIDGET_SANDBOX_ORIGIN',text:target.widgetSandboxOrigin},
    {type:'secret_text',name:'CREEZIO_VAULT_KEYRING'}]};
  const flags={wrongModule:false,missingDependency:false,extraModule:false,foreignModule:false,
    indexBase64:null,versionResponse:null,
    wrongAsset:false,wrongVersion:false,sessionReply:()=>Response.json(
      {error:{code:'authentication_required'},requestId:'anonymous-probe'},{status:401})};
  const seen=[];
  function version(){
    if(flags.versionResponse)return flags.versionResponse();
    const modules=[{name:'index.js',content_type:'application/javascript+module',
      content_base64:flags.indexBase64??Buffer.from(flags.wrongModule?'other':
        readFileSync(path.join(artifactRoot,'dist/server/index.js'))).toString('base64')}];
    if(!flags.missingDependency)modules.push({name:'dep.js',content_type:'application/javascript+module',
      content_base64:readFileSync(path.join(artifactRoot,'dist/server/dep.js')).toString('base64')});
    if(flags.extraModule)modules.push({name:'ssr/unused.js',content_type:'application/javascript+module',
      content_base64:readFileSync(path.join(artifactRoot,'dist/server/ssr/unused.js')).toString('base64')});
    if(flags.foreignModule)modules.push({name:'foreign.js',content_type:'application/javascript+module',
      content_base64:Buffer.from('foreign').toString('base64')});
    modules.push({name:'_headers',content_type:'text/plain',
      content_base64:readFileSync(path.join(artifactRoot,'dist/client/_headers')).toString('base64')});
    return Response.json({success:true,result:{id:flags.wrongVersion?'33333333-3333-4333-8333-333333333333':versionId,
      main_module:'index.js',modules}});
  }
  const fetcher=async(url,options)=>{
    seen.push(url);assert.equal(options.redirect,'error');
    if(url.startsWith('https://api.cloudflare.com/')){
      assert.equal(options.headers.Authorization,'Bearer '+'x'.repeat(24));
      assert.ok(url.endsWith(`/workers/workers/${target.workerName}/versions/${versionId}?include=modules`));
      return version();
    }
    if(url===target.origin+'/favicon.svg')return new Response(flags.wrongAsset?'other':'<svg/>\n');
    assert.equal(url,target.origin+'/api/access/admin/session');
    assert.equal(options.headers?.cookie,undefined);
    return flags.sessionReply();
  };
  return {root,artifactRoot,target,artifact,token:'x'.repeat(24),transferId:'transfer1',flags,seen,settings,
    controlPlane:{deployments:async()=>({deployments:[delivery]}),
      version:async()=>({id:versionId}),workerSettings:async()=>settings},fetcher};
}
test('reconciliation verifies active modules, public asset bytes, bindings and anonymous native session',async t=>{
  const input=fixture(t),publisher=createCloudflarePublisher(input),receipt=await publisher.inspect(input);
  assert.equal(receipt.deploymentId,'deployment-1');assert.equal(receipt.publishedSha,input.artifact.sourceSha);
  assert.deepEqual(receipt.remoteVerified,{modules:2,moduleBytes:readFileSync(path.join(input.artifactRoot,'dist/server/index.js')).length
    +readFileSync(path.join(input.artifactRoot,'dist/server/dep.js')).length,configurationModules:1,
    excludedLocalModules:1,assets:1,assetBytes:7});
  assert.equal(input.seen.length,3);
});

test('reconciliation verifies a multi-megabyte module without overflowing base64 validation',async t=>{
  const input=fixture(t),modulePath=path.join(input.artifactRoot,'dist/server/index.js');
  const prefix=Buffer.from('import {value} from "./dep.js"; export default {value};\n');
  const module=Buffer.concat([prefix,Buffer.alloc(4*1024*1024,32)]);
  writeFileSync(modulePath,module);
  input.artifact.artifactDigest=measureRuntimeArtifacts(input.artifactRoot).digest;
  input.settings.annotations['workers/message']=
    `Creezio ${input.artifact.artifactDigest} ${input.artifact.sourceSha}`;
  const receipt=await inspectCloudflareDelivery(input);
  assert.equal(receipt.remoteVerified.modules,2);
  assert.equal(receipt.remoteVerified.moduleBytes,module.length+
    readFileSync(path.join(input.artifactRoot,'dist/server/dep.js')).length);
});

test('version readback accepts a bounded aggregate above 16 MiB without changing file limits',async t=>{
  const input=fixture(t);
  const index=path.join(input.artifactRoot,'dist/server/index.js');
  const dep=path.join(input.artifactRoot,'dist/server/dep.js');
  const moduleBytes=7*1024*1024;
  writeFileSync(index,Buffer.concat([
    Buffer.from('import {value} from "./dep.js"; export default {value};\n'),
    Buffer.alloc(moduleBytes,32)]));
  writeFileSync(dep,Buffer.concat([Buffer.from('export const value = 1;\n'),
    Buffer.alloc(moduleBytes,32)]));
  input.artifact.artifactDigest=measureRuntimeArtifacts(input.artifactRoot).digest;
  input.settings.annotations['workers/message']=
    `Creezio ${input.artifact.artifactDigest} ${input.artifact.sourceSha}`;
  const encodedMinimum=4*Math.ceil((moduleBytes*2)/3);
  assert.ok(encodedMinimum>16*1024*1024);
  const receipt=await inspectCloudflareDelivery(input);
  assert.equal(receipt.remoteVerified.modules,2);
  assert.ok(receipt.remoteVerified.moduleBytes>14*1024*1024);
});

test('version readback refuses an unbounded aggregate even without Content-Length',async t=>{
  const input=fixture(t),chunk=Buffer.alloc(2*1024*1024,32);
  input.flags.versionResponse=()=>{
    let sent=0;
    return new Response(new ReadableStream({pull(controller){
      controller.enqueue(chunk);if(++sent===17)controller.close();
    }}),{headers:{'content-type':'application/json'}});
  };
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_limit'});
});

test('a canonical single module above 16 MiB remains forbidden inside the larger envelope',async t=>{
  const input=fixture(t),module=Buffer.alloc(16*1024*1024+1,32);
  input.flags.indexBase64=module.toString('base64');
  assert.equal(Buffer.from(input.flags.indexBase64,'base64').length,module.length);
  assert.ok(input.flags.indexBase64.length<32*1024*1024);
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_format'});
});

test('remote module base64 must use the exact canonical alphabet, padding and tail bits',async t=>{
  const input=fixture(t);
  for(const encoded of ['!!!!','A===','YW Jj','/x==']){
    input.flags.indexBase64=encoded;
    await assert.rejects(inspectCloudflareDelivery(input),{code:'content_format'});
  }
});
test('wrong remote module, missing imported module and wrong public asset block confirmation',async t=>{
  const input=fixture(t);input.flags.wrongModule=true;
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_mismatch'});
  input.flags.wrongModule=false;input.flags.missingDependency=true;
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_mismatch'});
  input.flags.missingDependency=false;input.flags.wrongAsset=true;
  await assert.rejects(inspectCloudflareDelivery(input),{code:'asset_mismatch'});
  input.flags.wrongAsset=false;input.flags.extraModule=true;
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_mismatch'});
});

test('no-bundle ESModule rules require the exact local module inventory, including unreferenced modules',async t=>{
  const input=fixture(t);
  writeFileSync(path.join(input.artifactRoot,'dist/server/wrangler.json'),JSON.stringify({
    main:'index.js',no_bundle:true,rules:[{type:'ESModule',globs:['**/*.js','**/*.mjs']}]}));
  input.artifact.artifactDigest=measureRuntimeArtifacts(input.artifactRoot).digest;
  input.settings.annotations['workers/message']=
    `Creezio ${input.artifact.artifactDigest} ${input.artifact.sourceSha}`;
  input.flags.extraModule=true;
  const receipt=await inspectCloudflareDelivery(input);
  assert.equal(receipt.remoteVerified.modules,3);
  assert.equal(receipt.remoteVerified.excludedLocalModules,0);
  input.flags.extraModule=false;
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_mismatch'});
  input.flags.extraModule=true;input.flags.foreignModule=true;
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_mismatch'});
  input.flags.foreignModule=false;input.flags.wrongModule=true;
  await assert.rejects(inspectCloudflareDelivery(input),{code:'content_mismatch'});
});
test('version-specific readback rejects a response for any other version',async t=>{
  const wrong=fixture(t);wrong.flags.wrongVersion=true;
  await assert.rejects(inspectCloudflareDelivery(wrong),{code:'content_format'});
});
test('wrong marker, rebound database and deployment race block confirmation',async t=>{
  const tag=fixture(t);tag.settings.annotations['workers/message']='other';
  await assert.rejects(inspectCloudflareDelivery(tag),{code:'not_confirmed'});
  const database=fixture(t);database.settings.bindings[0].id='other';
  await assert.rejects(inspectCloudflareDelivery(database),{code:'binding_mismatch'});
  const widget=fixture(t);widget.settings.bindings[4].text='https://other.example.workers.dev';
  await assert.rejects(inspectCloudflareDelivery(widget),{code:'binding_mismatch'});
  const race=fixture(t);let count=0;
  race.controlPlane.deployments=async()=>({deployments:[{...delivery,id:++count===1?'deployment-1':'other'}]});
  await assert.rejects(inspectCloudflareDelivery(race),{code:'deployment_changed'});
});
test('anonymous session probe rejects other statuses, errors, sessions, cookies and malformed replies',async t=>{
  const input=fixture(t);
  const replies=[
    ()=>Response.json({session:null}),
    ()=>Response.json({error:{code:'authentication_required'}},{status:500}),
    ()=>Response.json({error:{code:'other'}},{status:401}),
    ()=>Response.json({error:{code:'authentication_required'},session:null},{status:401}),
    ()=>Response.json({error:{code:'authentication_required'}},
      {status:401,headers:{'set-cookie':'__Host-creezio-admin=unexpected'}}),
    ()=>new Response('not json',{status:401}),
    ()=>Response.json({unknown:true},{status:401}),
  ];
  for(const reply of replies){
    input.flags.sessionReply=reply;
    await assert.rejects(inspectCloudflareDelivery(input),{code:'probe_failed'});
  }
});

test('current deployment inspection returns a stable version and target bindings',async t=>{
  const input=fixture(t);
  const current=await inspectCloudflareCurrent(input);
  assert.equal(current.deploymentId,'deployment-1');
  assert.equal(current.versionId,versionId);
  assert.equal(current.tag,'cz-transfer1');
  assert.equal(current.message,input.settings.annotations['workers/message']);
  assert.equal(current.bindings.length,6);
  assert.ok(Object.isFrozen(current.bindings));
  let reads=0;
  input.controlPlane.deployments=async()=>({deployments:[{
    ...delivery,id:++reads===1?'deployment-1':'other-deployment'}]});
  await assert.rejects(inspectCloudflareCurrent(input),{code:'deployment_changed'});
});

test('version 1 target refuses an unexpected surviving storage route',async t=>{
  const input=fixture(t);
  input.settings.bindings.push({type:'plain_text',name:'CREEZIO_STORAGE_ROUTES',
    text:'{"schemaVersion":1,"routes":[]}'});
  await assert.rejects(inspectCloudflareCurrent(input),{code:'binding_mismatch'});
});

test('current deployment inspection requires every active resource binding and route manifest',async t=>{
  const input=fixture(t);
  input.target={...target,schemaVersion:2,resources:[{contextId:'tenant-a',slot:1,status:'active',
    databaseId:'33333333-3333-4333-8333-333333333333',databaseName:'tenant-a-db',bucketName:'tenant-a-files'},
    {contextId:'tenant-b',slot:2,status:'revoked',databaseId:'44444444-4444-4444-8444-444444444444',
      databaseName:'tenant-b-db',bucketName:'tenant-b-files'}]};
  const expected=cloudflareWorkerConfiguration(input.target);
  input.settings.bindings.push(
    {type:'d1',name:'DB_RESOURCE_01',id:input.target.resources[0].databaseId},
    {type:'r2_bucket',name:'BUCKET_RESOURCE_01',bucket_name:input.target.resources[0].bucketName},
    {type:'plain_text',name:'CREEZIO_STORAGE_ROUTES',text:expected.vars.CREEZIO_STORAGE_ROUTES});
  assert.equal((await inspectCloudflareCurrent(input)).bindings.length,9);
  input.settings.bindings=input.settings.bindings.filter(item=>item.name!=='BUCKET_RESOURCE_01');
  await assert.rejects(inspectCloudflareCurrent(input),{code:'binding_mismatch'});
  input.settings.bindings.push({type:'r2_bucket',name:'BUCKET_RESOURCE_01',bucket_name:'wrong-bucket'});
  await assert.rejects(inspectCloudflareCurrent(input),{code:'binding_mismatch'});
  input.settings.bindings.at(-1).bucket_name=input.target.resources[0].bucketName;
  input.settings.bindings.push({type:'d1',name:'DB_RESOURCE_02',id:input.target.resources[1].databaseId});
  await assert.rejects(inspectCloudflareCurrent(input),{code:'binding_mismatch'});
});

test('update inspection refuses a missing production vault after deployment',async t=>{
  const input=fixture(t);
  input.settings.bindings=input.settings.bindings.filter(item=>item.name!=='CREEZIO_VAULT_KEYRING');
  await assert.rejects(inspectCloudflareCurrent(input),{code:'binding_mismatch'});
  await assert.rejects(inspectCloudflareDelivery({...input,requireVault:true}),
    {code:'binding_mismatch'});
});

test('update publisher rechecks the previous deployment after local validation',async t=>{
  const input=fixture(t),updateId='33333333-3333-4333-8333-333333333333';
  writeFileSync(path.join(input.root,'.gitignore'),'.wrangler/\n.quality/\n');
  const git=(...args)=>execFileSync('git',args,{cwd:input.root,stdio:'ignore'});
  git('init','-q');git('config','user.email','test@example.invalid');
  git('config','user.name','Synthetic Fixture');git('add','.gitignore');git('commit','-qm','fixture');
  const updateRoot=cloudflareArtifactRoot(input.root,updateId);
  mkdirSync(path.dirname(updateRoot),{recursive:true});
  renameSync(input.artifactRoot,updateRoot);
  writeFileSync(path.join(updateRoot,'dist/server/wrangler.json'),
    JSON.stringify(cloudflareWorkerConfiguration(input.target)));
  const source=sourceIdentity(input.root);
  input.artifact.sourceSha=source.head;
  input.artifact.artifactDigest=measureRuntimeArtifacts(updateRoot).digest;
  mkdirSync(path.join(updateRoot,'.quality'),{recursive:true});
  writeFileSync(path.join(updateRoot,'.quality/cloudflare-build.json'),JSON.stringify({
    source,artifact:{digest:input.artifact.artifactDigest},
    compositionDigest:input.artifact.compositionDigest}));
  let reads=0,uploads=0;
  input.controlPlane.deployments=async()=>({deployments:[{
    ...delivery,versions:[{percentage:100,version_id:++reads<=2?versionId:
      '44444444-4444-4444-8444-444444444444'}]}]});
  input.controlPlane.version=async(_name,id)=>({id});
  const publisher=createCloudflarePublisher({...input,artifactRoot:updateRoot,
    upload:async()=>{uploads++;}});
  await assert.rejects(publisher.deliver({transferId:updateId,artifact:input.artifact,
    expectedPreviousVersionId:versionId,expectedPreviousDeploymentId:'deployment-1'}),
  {code:'deployment_changed'});
  assert.ok(reads>=3);
  assert.equal(uploads,0);
});

test('update publisher refuses a changed base before any upload and preserves initial artifact path',async t=>{
  const input=fixture(t),updateId='33333333-3333-4333-8333-333333333333';
  let uploads=0;
  const publisher=createCloudflarePublisher({...input,
    artifactRoot:cloudflareArtifactRoot(input.root,updateId),
    upload:async()=>{uploads++;}});
  await assert.rejects(publisher.deliver({transferId:updateId,artifact:input.artifact,
    expectedPreviousVersionId:'44444444-4444-4444-8444-444444444444',
    expectedPreviousDeploymentId:'deployment-1'}),{code:'deployment_changed'});
  assert.equal(uploads,0);
  await assert.rejects(publisher.deliver({transferId:updateId,artifact:input.artifact}),
    {code:'invalid_input'});
  assert.equal(uploads,0);
  assert.doesNotThrow(()=>createCloudflarePublisher(input));
  assert.throws(()=>createCloudflarePublisher({...input,
    artifactRoot:path.join(input.root,'.wrangler/delivery/updates/invalid!/artifact')}),
  {code:'invalid_configuration'});
});

test('preserved update checks its old receipt and remote head with a newer operator source',async t=>{
  const input=fixture(t),updateId='33333333-3333-4333-8333-333333333333';
  writeFileSync(path.join(input.root,'.gitignore'),'.wrangler/\n.quality/\n');
  const git=(...args)=>execFileSync('git',args,{cwd:input.root,stdio:'ignore'});
  git('init','-q');git('config','user.email','test@example.invalid');
  git('config','user.name','Synthetic Fixture');git('add','.gitignore');git('commit','-qm','artifact source');
  const updateRoot=cloudflareArtifactRoot(input.root,updateId);
  mkdirSync(path.dirname(updateRoot),{recursive:true});renameSync(input.artifactRoot,updateRoot);
  writeFileSync(path.join(updateRoot,'dist/server/wrangler.json'),
    JSON.stringify(cloudflareWorkerConfiguration(input.target)));
  const source=sourceIdentity(input.root);
  input.artifact.sourceSha=source.head;
  input.artifact.artifactDigest=measureRuntimeArtifacts(updateRoot).digest;
  mkdirSync(path.join(updateRoot,'.quality'),{recursive:true});
  writeFileSync(path.join(updateRoot,'.quality/cloudflare-build.json'),JSON.stringify({
    source,artifact:{digest:input.artifact.artifactDigest},
    compositionDigest:input.artifact.compositionDigest}));
  writeFileSync(path.join(updateRoot,'receipt.json'),JSON.stringify({selected:{updateId,
    target:input.target,sourceSha:source.head,sourceFingerprint:source.sha256,
    compositionDigest:input.artifact.compositionDigest},
    artifactDigest:input.artifact.artifactDigest}));
  writeFileSync(path.join(input.root,'operator.txt'),'new operator source\n');
  git('add','operator.txt');git('commit','-qm','operator source');
  assert.notEqual(sourceIdentity(input.root).head,source.head);
  let latest=versionId,uploads=0;
  input.controlPlane.latestVersion=async()=>({id:latest});
  const publisher=createCloudflarePublisher({...input,artifactRoot:updateRoot,
    upload:async()=>{uploads++;throw new Error('synthetic upload stop');}});
  latest='44444444-4444-4444-8444-444444444444';
  await assert.rejects(publisher.deliverPreservedUpdate({transferId:updateId,
    artifact:input.artifact,sourceFingerprint:source.sha256,
    expectedPreviousVersionId:versionId,expectedPreviousDeploymentId:'deployment-1'}),
  {code:'not_confirmed'});
  assert.equal(uploads,0);
  latest=versionId;
  await assert.rejects(publisher.deliverPreservedUpdate({transferId:updateId,
    artifact:input.artifact,sourceFingerprint:source.sha256,
    expectedPreviousVersionId:versionId,expectedPreviousDeploymentId:'deployment-1'}),
  /synthetic upload stop/);
  assert.equal(uploads,1);
});
