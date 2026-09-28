import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {measureRuntimeArtifacts} from '../../scripts/quality/runtime.mjs';
import {inspectCloudflareDelivery,inspectCloudflareCurrent,createCloudflarePublisher} from '../../scripts/cloudflare/publisher.mjs';
import {cloudflareArtifactRoot} from '../../scripts/cloudflare/artifact-path.mjs';
import {cloudflareWorkerConfiguration} from '../../scripts/cloudflare/config.mjs';
import {sourceIdentity} from '../../scripts/quality/evidence.mjs';

const target={schemaVersion:1,accountId:'a'.repeat(32),workerName:'first-app',databaseName:'first-db',
  databaseId:'11111111-1111-4111-8111-111111111111',bucketName:'first-files',
  origin:'https://first-app.example.workers.dev',widgetSandboxOrigin:'https://sandbox.example.workers.dev'};
const versionId='22222222-2222-4222-8222-222222222222';
const delivery={id:'deployment-1',versions:[{percentage:100,version_id:versionId}]};
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
    indexBase64:null,
    wrongAsset:false,wrongVersion:false,sessionReply:()=>Response.json(
      {error:{code:'authentication_required'},requestId:'anonymous-probe'},{status:401})};
  const seen=[];
  function version(){
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
