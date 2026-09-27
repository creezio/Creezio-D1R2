import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {measureRuntimeArtifacts} from '../../scripts/quality/runtime.mjs';
import {inspectCloudflareDelivery,createCloudflarePublisher} from '../../scripts/cloudflare/publisher.mjs';

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
    {type:'plain_text',name:'CREEZIO_WIDGET_SANDBOX_ORIGIN',text:target.widgetSandboxOrigin}]};
  const flags={wrongModule:false,missingDependency:false,extraModule:false,
    wrongAsset:false,wrongSession:false,wrongVersion:false};
  const seen=[];
  function version(){
    const modules=[{name:'index.js',content_type:'application/javascript+module',
      content_base64:Buffer.from(flags.wrongModule?'other':readFileSync(path.join(artifactRoot,'dist/server/index.js'))).toString('base64')}];
    if(!flags.missingDependency)modules.push({name:'dep.js',content_type:'application/javascript+module',
      content_base64:readFileSync(path.join(artifactRoot,'dist/server/dep.js')).toString('base64')});
    if(flags.extraModule)modules.push({name:'ssr/unused.js',content_type:'application/javascript+module',
      content_base64:readFileSync(path.join(artifactRoot,'dist/server/ssr/unused.js')).toString('base64')});
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
    return Response.json({session:flags.wrongSession?{id:'unexpected'}:null});
  };
  return {root,artifactRoot,target,artifact,token:'x'.repeat(24),transferId:'transfer1',flags,seen,settings,
    controlPlane:{deployments:async()=>({deployments:[delivery]}),
      version:async()=>({id:versionId}),workerSettings:async()=>settings},fetcher};
}
test('reconciliation verifies active modules, public asset bytes, bindings and anonymous native session',async t=>{
  const input=fixture(t),publisher=createCloudflarePublisher(input),receipt=await publisher.inspect(input);
  assert.equal(receipt.deploymentId,'deployment-1');assert.equal(receipt.publishedSha,versionId);
  assert.deepEqual(receipt.remoteVerified,{modules:2,moduleBytes:readFileSync(path.join(input.artifactRoot,'dist/server/index.js')).length
    +readFileSync(path.join(input.artifactRoot,'dist/server/dep.js')).length,configurationModules:1,
    excludedLocalModules:1,assets:1,assetBytes:7});
  assert.equal(input.seen.length,3);
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
test('version-specific readback rejects a response for any other version',async t=>{
  const wrong=fixture(t);wrong.flags.wrongVersion=true;
  await assert.rejects(inspectCloudflareDelivery(wrong),{code:'content_format'});
});
test('wrong marker, rebound database, deployment race and invalid session block confirmation',async t=>{
  const tag=fixture(t);tag.settings.annotations['workers/message']='other';
  await assert.rejects(inspectCloudflareDelivery(tag),{code:'not_confirmed'});
  const database=fixture(t);database.settings.bindings[0].id='other';
  await assert.rejects(inspectCloudflareDelivery(database),{code:'binding_mismatch'});
  const widget=fixture(t);widget.settings.bindings[4].text='https://other.example.workers.dev';
  await assert.rejects(inspectCloudflareDelivery(widget),{code:'binding_mismatch'});
  const race=fixture(t);let count=0;
  race.controlPlane.deployments=async()=>({deployments:[{...delivery,id:++count===1?'deployment-1':'other'}]});
  await assert.rejects(inspectCloudflareDelivery(race),{code:'deployment_changed'});
  const auth=fixture(t);auth.flags.wrongSession=true;
  await assert.rejects(inspectCloudflareDelivery(auth),{code:'probe_failed'});
});
