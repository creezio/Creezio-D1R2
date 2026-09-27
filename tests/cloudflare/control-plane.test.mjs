import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareControlPlane, CloudflareControlError} from '../../scripts/cloudflare/control-plane.mjs';

const accountId = 'a'.repeat(32);
const token = 'operator-token-at-least-20-chars';
const uuid = '11111111-2222-3333-4444-555555555555';
const ok = result => Response.json({success: true, result});
const client = fetcher => createCloudflareControlPlane({accountId, token, fetcher});

test('control plane pins account/user token verification and account-scoped resource reads', async () => {
  const calls = [];
  const control = client(async (url, init) => {
    calls.push({url, init});
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    if (url.endsWith('/tokens/verify')) return ok({id: 'b'.repeat(32), status: 'active'});
    if (url.endsWith('/workers/subdomain')) return ok({subdomain: 'creezio-test'});
    if (url.includes('/d1/database?')) return Response.json({success: true,
      result: [{name: 'creezio-db', uuid}], result_info: {count: 1, page: 1, total_count: 999}});
    return new Response(null, {status: 404});
  });
  assert.equal((await control.verifyToken('account')).scope, 'account');
  assert.equal((await control.verifyToken('user')).scope, 'user');
  assert.equal(await control.workerSubdomain(), 'creezio-test');
  assert.equal((await control.findD1('creezio-db')).id, uuid);
  assert.equal((await control.database('creezio-db')).id, uuid);
  assert.deepEqual(await control.inspectConnection('account'), {
    accountId, tokenId: 'b'.repeat(32), tokenScope: 'account',
    workersSubdomain: 'creezio-test'
  });
  assert.equal(calls.filter(item => item.url.includes('/d1/database?')).length, 2);
  assert.ok(calls.some(item => item.url.endsWith(`/accounts/${accountId}/tokens/verify`)));
  assert.ok(calls.some(item => item.url.endsWith('/user/tokens/verify')));
});

test('publisher reads exact deployment and version envelopes without mutating the Worker', async () => {
  const requests = [];
  const control = client(async (url, init) => {
    requests.push({url, method: init.method});
    if (url.includes('/deployments?')) return ok({deployments: [{id: uuid,
      versions: [{version_id: uuid, percentage: 100}],
      annotations: {'workers/message': 'sha256:abc'}}]});
    if (url.endsWith(`/versions/${uuid}`)) return ok({id: uuid,
      resources: {bindings: [{type: 'd1', name: 'DB'}]},
      metadata: {annotations: {'workers/tag': 't32-transfer'}}});
    return new Response(null, {status: 404});
  });
  const listed = await control.deployments('creezio-worker');
  assert.equal(listed.deployments[0].versions[0].percentage, 100);
  assert.equal((await control.workerDeployment('creezio-worker')).id, uuid);
  assert.deepEqual((await control.version('creezio-worker', uuid)).resources.bindings,
    [{type: 'd1', name: 'DB'}]);
  assert.deepEqual(requests.map(item => item.method), ['GET', 'GET', 'GET']);
  assert.ok(requests.every(item => item.url.startsWith(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/creezio-worker/`)));
});

test('control plane checks bucket public domains and never confuses name with ownership', async () => {
  const control = client(async url => {
    if (url.endsWith('/domains/managed')) return ok({enabled: false});
    if (url.endsWith('/domains/custom')) return ok({domains: [{domain: 'public.example', enabled: true}]});
    return ok({name: 'creezio-bucket', jurisdiction: 'default'});
  });
  assert.equal((await control.bucket('creezio-bucket')).private, false);
});

test('control plane create calls use exact names and do not retry lost responses', async () => {
  const posts = [];
  const control = client(async (url, init) => {
    posts.push({url, init});
    if (url.endsWith('/d1/database')) return ok({name: 'creezio-db', uuid});
    throw new Error('lost after commit');
  });
  assert.equal((await control.createD1('creezio-db')).id, uuid);
  await assert.rejects(control.createBucket('creezio-bucket'),
    error => error instanceof CloudflareControlError && error.code === 'unavailable');
  assert.equal(posts.length, 2);
  assert.deepEqual(JSON.parse(posts[0].init.body), {name: 'creezio-db'});
  assert.deepEqual(JSON.parse(posts[1].init.body), {name: 'creezio-bucket'});
  assert.equal(posts[1].init.headers['cf-r2-jurisdiction'], 'default');
});
