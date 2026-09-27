import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareProvisioner, ProvisioningError} from '../../scripts/cloudflare/provisioning.mjs';

const accountId = 'a'.repeat(32);
const databaseId = '11111111-2222-3333-4444-555555555555';
const plan = Object.freeze({accountId, bucketName: 'creezio-test-bucket',
  databaseName: 'creezio-test-database', jurisdiction: 'default',
  tokenScope: 'account', transferId: 'transfer-123', workerName: 'creezio-test-worker'});
function fixture({preexistingD1 = false, publicBucket = false, lostD1 = false} = {}) {
  const calls = []; let database = preexistingD1 ? {name: plan.databaseName, id: databaseId} : null;
  let bucket = null, record = null;
  const control = {accountId,
    verifyToken: async scope => {calls.push('verify:' + scope); return {id: 'b'.repeat(32)};},
    workerSubdomain: async () => 'creezio-subdomain',
    findD1: async () => database,
    bucket: async () => bucket,
    workerSettings: async () => null,
    workerDeployment: async () => null,
    createD1: async name => {
      calls.push('POST:d1:' + record?.stage);
      database = {name, id: databaseId};
      if (lostD1) throw new Error('lost response after resource creation');
      return database;
    },
    createBucket: async name => {
      calls.push('POST:r2:' + record?.stage);
      bucket = {name, private: !publicBucket, createdAt: '2026-09-27T00:00:00Z'};
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

test('public R2 bucket is refused without attempting to hide or delete it', async () => {
  const f = fixture({publicBucket: true}), provisioner = createCloudflareProvisioner(f);
  await assert.rejects(provisioner.provision(plan),
    error => error instanceof ProvisioningError && error.code === 'bucket_not_private');
  assert.equal(f.current().stage, 'r2-intent');
  assert.equal(f.calls.filter(item => item.startsWith('POST:')).length, 2);
});
