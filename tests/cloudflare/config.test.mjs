import '../../scripts/local-environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {validateCloudflareTarget,cloudflareWorkerConfiguration,assertCloudflareBuiltConfiguration} from '../../scripts/cloudflare/config.mjs';
import {projectCloudflareComposition} from '../../scripts/cloudflare/composition.mjs';

const target={schemaVersion:1,accountId:'1'.repeat(32),workerName:'example-app',databaseName:'example-db',
  databaseId:'11111111-1111-4111-8111-111111111111',bucketName:'example-files',
  origin:'https://example-app.example.workers.dev',widgetSandboxOrigin:'https://widgets.example.workers.dev'};
test('production build pins real bindings without provider credentials or local fallbacks',()=>{
  const worker=cloudflareWorkerConfiguration(target);
  assert.equal(worker.vars.CREEZIO_RUNTIME_PROFILE,'cloudflare');
  assert.equal(worker.d1_databases[0].database_id,target.databaseId);
  assertCloudflareBuiltConfiguration(worker,target);
  for(const change of [{token:'private'},{databaseId:'00000000-0000-4000-8000-000000000000'},
    {origin:'http://127.0.0.1:5173'},{widgetSandboxOrigin:target.origin},{workerName:'../other'},
    {workerName:123},{databaseName:{toString:()=>target.databaseName}},{bucketName:123}])
    assert.throws(()=>validateCloudflareTarget({...target,...change}));
  assert.throws(()=>assertCloudflareBuiltConfiguration({...worker,vars:{...worker.vars,CLOUDFLARE_API_TOKEN:'private'}},target));
  assert.throws(()=>assertCloudflareBuiltConfiguration({...worker,r2_buckets:[{binding:'BUCKET',bucket_name:'wrong'}]},target));
});
test('Cloudflare host projection keeps the application, module locks and generated SQL unchanged',()=>{
  const result=projectCloudflareComposition({root:fileURLToPath(new URL('../../',import.meta.url)),
    compositionPath:'configuration/composition.json',lockPath:'configuration/composition.lock.json'});
  assert.equal(result.composition.host.profile,'cloudflare');
  assert.notEqual(result.sourcePlan.compositionDigest,result.targetPlan.compositionDigest);
  assert.notEqual(result.sourcePlan.planDigest,result.targetPlan.planDigest);
  assert.equal(result.sourcePlan.modelDigest,result.targetPlan.modelDigest);
  assert.equal(result.sourcePlan.sql,result.targetPlan.sql);
  assert.deepEqual(result.sourcePlan.objects,result.targetPlan.objects);
  assert.match(result.compatibilityDigest,/^sha256-[a-f0-9]{64}$/);
});

test('version 2 target declares distinct active bindings and a revoked route without fallback',()=>{
  const extended={...target,schemaVersion:2,resources:[
    {contextId:'tenant-a',slot:1,status:'active',databaseName:'tenant-a-db',
      databaseId:'22222222-2222-4222-8222-222222222222',bucketName:'tenant-a-files'},
    {contextId:'tenant-b',slot:2,status:'revoked',databaseName:'tenant-b-db',
      databaseId:'33333333-3333-4333-8333-333333333333',bucketName:'tenant-b-files'}]};
  const worker=cloudflareWorkerConfiguration(extended);
  assert.deepEqual(worker.d1_databases.map(item=>item.binding),['DB','DB_RESOURCE_01']);
  assert.deepEqual(worker.r2_buckets.map(item=>item.binding),['BUCKET','BUCKET_RESOURCE_01']);
  assert.deepEqual(JSON.parse(worker.vars.CREEZIO_STORAGE_ROUTES).routes.map(item=>item.status),['active','revoked']);
  assertCloudflareBuiltConfiguration(worker,extended);
  assert.throws(()=>assertCloudflareBuiltConfiguration({...worker,d1_databases:worker.d1_databases.slice(0,1)},extended));
  assert.throws(()=>validateCloudflareTarget({...extended,resources:[extended.resources[0],
    {...extended.resources[1],databaseId:extended.resources[0].databaseId}]}));
  assert.throws(()=>validateCloudflareTarget({...extended,resources:[{...extended.resources[0],
    bucketName:{toString:()=>extended.resources[0].bucketName}},extended.resources[1]]}));
});

test('version 3 target carries a stable physical installation UUID into the route manifest',()=>{
  const storageInstallationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const extended={...target,schemaVersion:3,storageInstallationId,resources:[
    {contextId:'tenant-a',slot:1,status:'active',databaseName:'tenant-a-db',
      databaseId:'22222222-2222-4222-8222-222222222222',bucketName:'tenant-a-files'}]};
  const worker=cloudflareWorkerConfiguration(extended);
  assert.equal(JSON.parse(worker.vars.CREEZIO_STORAGE_ROUTES).storageInstallationId,storageInstallationId);
  assert.equal(JSON.parse(worker.vars.CREEZIO_STORAGE_ROUTES).schemaVersion,2);
  assertCloudflareBuiltConfiguration(worker,extended);
  assert.throws(()=>validateCloudflareTarget({...extended,storageInstallationId:'foreign'}));
});
