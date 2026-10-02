import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareProvisioner, ProvisioningError} from '../../scripts/cloudflare/provisioning.mjs';
import {CloudflareControlError} from '../../scripts/cloudflare/control-plane.mjs';

const accountId = 'a'.repeat(32);
const databaseId = '11111111-2222-3333-4444-555555555555';
const plan = Object.freeze({accountId, bucketName: 'creezio-test-bucket',
  databaseName: 'creezio-test-database', jurisdiction: 'default',
  tokenScope: 'account', transferId: 'transfer-123', workerName: 'creezio-test-worker'});
function fixture({preexistingD1 = false, publicBucket = false, lostD1 = false, lostR2 = false,
  workerExists = false, refused = null, inspectionFails = false} = {}) {
  const calls = []; let database = preexistingD1 ? {name: plan.databaseName, id: databaseId} : null;
  let bucket = null, record = null, failNextInspection = false;
  const control = {accountId,
    verifyToken: async scope => {calls.push('verify:' + scope); return {id: 'b'.repeat(32)};},
    workerSubdomain: async () => 'creezio-subdomain',
    findD1: async () => {
      if (failNextInspection && refused === 'd1') {failNextInspection = false; throw Error('inspection unavailable');}
      return database;
    },
    bucket: async () => {
      if (failNextInspection && refused === 'r2') {failNextInspection = false; throw Error('inspection unavailable');}
      return bucket;
    },
    workerSettings: async () => workerExists ? {bindings:[]} : null,
    workerDeployment: async () => null,
    createD1: async name => {
      calls.push('POST:d1:' + record?.stage);
      if (refused === 'd1') {
        failNextInspection = inspectionFails;
        throw new CloudflareControlError('refused', 400, [1000], true);
      }
      database = {name, id: databaseId};
      if (lostD1) throw new Error('lost response after resource creation');
      return database;
    },
    createBucket: async name => {
      calls.push('POST:r2:' + record?.stage);
      if (refused === 'r2') {
        failNextInspection = inspectionFails;
        throw new CloudflareControlError('refused', 400, [1000], true);
      }
      bucket = {name, private: !publicBucket, createdAt: '2026-09-27T00:00:00Z'};
      if (lostR2) throw new Error('lost response after bucket creation');
      return bucket;
    }};
  const journal = {load: async () => record,
    create: async value => {assert.equal(record, null); calls.push('journal:create'); record = value;},
    compareAndSave: async (before, after) => {
      assert.deepEqual(record, before);
      assert.equal(after.revision, before.revision + 1);
      calls.push('journal:' + after.stage);
      record = after;
    }};
  return {control, journal, calls, current: () => record};
}

test('provisioning journals D1 and R2 intent before POST and returns exact target identity', async () => {
  const f = fixture(), provisioner = createCloudflareProvisioner(f);
  const result = await provisioner.provision(plan);
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.target, {accountId, workerName: plan.workerName,
    databaseId, bucketName: plan.bucketName, jurisdiction: 'default',
    origin: `https://${plan.workerName}.creezio-subdomain.workers.dev`});
  assert.ok(f.calls.indexOf('journal:d1-intent') < f.calls.indexOf('POST:d1:d1-intent'));
  assert.ok(f.calls.indexOf('journal:r2-intent') < f.calls.indexOf('POST:r2:r2-intent'));
  assert.equal(f.current().stage, 'ready');
  const again = await provisioner.provision(plan);
  assert.equal(again.state, 'ready');
  assert.equal(f.calls.filter(item => item.startsWith('POST:')).length, 2);
});

test('existing unlinked destination blocks before journal or remote mutation', async () => {
  const f = fixture({preexistingD1: true}), provisioner = createCloudflareProvisioner(f);
  await assert.rejects(provisioner.provision(plan),
    error => error instanceof ProvisioningError && error.code === 'resource_exists');
  assert.equal(f.current(), null);
  assert.equal(f.calls.filter(item => item.startsWith('POST:')).length, 0);
});

test('lost D1 response is inspected but never causes another create', async () => {
  const f = fixture({lostD1: true}), provisioner = createCloudflareProvisioner(f);
  const first = await provisioner.provision(plan);
  assert.deepEqual(first, {state: 'unknown', resource: 'd1', candidateId: databaseId});
  assert.equal(f.current().stage, 'd1-intent');
  const second = await provisioner.provision(plan);
  assert.equal(second.state, 'unknown');
  assert.equal(f.calls.filter(item => item.startsWith('POST:')).length, 1);
});

test('lost R2 response keeps its created D1 and bucket candidate uncertain', async () => {
  const f = fixture({lostR2:true}), provisioner = createCloudflareProvisioner(f);
  const first = await provisioner.provision(plan);
  assert.deepEqual(first,{state:'unknown',resource:'r2',candidateName:plan.bucketName});
  assert.equal(f.current().stage,'r2-intent');
  assert.equal(f.current().databaseId,databaseId);
  assert.equal(f.current().refusal,undefined);
  assert.equal((await provisioner.provision(plan)).state,'unknown');
  assert.equal(f.calls.filter(item => item.startsWith('POST:')).length,2);
});

for (const resource of ['d1', 'r2']) {
  test(`explicit ${resource.toUpperCase()} provider refusal is journaled without a second POST`, async () => {
    const f = fixture({refused: resource}), provisioner = createCloudflareProvisioner(f);
    const first = await provisioner.provision(plan);
    assert.deepEqual(first, {state: 'refused', resource, httpStatus: 400, providerCodes: [1000]});
    assert.equal(f.current().stage, `${resource}-intent`);
    assert.equal(f.current().refusal.resource, resource);
    assert.deepEqual(f.current().refusal.providerCodes, [1000]);
    assert.equal(f.current().databaseId, resource === 'r2' ? databaseId : null);
    const again = await provisioner.provision(plan);
    assert.deepEqual(again, first);
    assert.equal(f.calls.filter(item => item.startsWith('POST:d1:')).length, 1);
    assert.equal(f.calls.filter(item => item.startsWith('POST:r2:')).length, resource === 'r2' ? 1 : 0);
  });

  test(`${resource.toUpperCase()} inspection failure remains unknown after explicit provider response`, async () => {
    const f = fixture({refused: resource, inspectionFails: true});
    const provisioner = createCloudflareProvisioner(f);
    const first = await provisioner.provision(plan);
    assert.equal(first.state, 'unknown');
    assert.equal(first.resource, resource);
    assert.equal(first.inspection, 'failed');
    assert.equal(f.current().refusal, undefined);
    const second = await provisioner.provision(plan);
    assert.equal(second.state, 'unknown');
    assert.equal(f.calls.filter(item => item === `POST:${resource}:${resource}-intent`).length, 1);
  });
}

test('public R2 bucket is refused without attempting to hide or delete it', async () => {
  const f = fixture({publicBucket: true}), provisioner = createCloudflareProvisioner(f);
  await assert.rejects(provisioner.provision(plan),
    error => error instanceof ProvisioningError && error.code === 'bucket_not_private');
  assert.equal(f.current().stage, 'r2-intent');
  assert.equal(f.calls.filter(item => item.startsWith('POST:')).length, 2);
});

test('adding a pair to an existing Worker requires an exact owner guard throughout provisioning',
  async()=>{
    const unguarded=fixture({workerExists:true});
    await assert.rejects(createCloudflareProvisioner(unguarded).provision(plan),
      error=>error.code==='worker_exists');
    assert.equal(unguarded.current(),null);
    const guarded=fixture({workerExists:true});let checks=0;
    const provisioner=createCloudflareProvisioner({...guarded,
      assertWorker:async()=>{checks++;if(checks===3)throw new Error('prior deployment changed');}});
    await assert.rejects(provisioner.provision(plan),/prior deployment changed/);
    assert.equal(guarded.current().stage,'d1-created');
    assert.equal(guarded.calls.filter(item=>item.startsWith('POST:r2:')).length,0);
    assert.ok(checks>=3);
  });
