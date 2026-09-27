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
    {origin:'http://127.0.0.1:5173'},{widgetSandboxOrigin:target.origin},{workerName:'../other'}])
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
