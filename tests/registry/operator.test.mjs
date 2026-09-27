import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {resolve} from 'node:path';
import {buildRegistry, registryRoot} from '../../scripts/registry/build.mjs';
import {createRegistryD1Operator} from '../../scripts/registry/cloudflare-d1.mjs';
import {registryConfiguration} from '../../scripts/registry/configure.mjs';

test('standalone registry bundle runs in workerd without app imports or a bootstrap route', async () => {
  const report = await buildRegistry();
  assert.ok(report.bytes > 0);
  assert.match(report.artifactDigest, /^sha256-[a-f0-9]{64}$/);
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    scriptPath: resolve(registryRoot, '.quality/registry/worker.mjs'), compatibilityDate: '2026-05-15',
    bindings: {REGISTRY_ORIGIN: 'https://registry.example.invalid'}, d1Databases: {DB: 'registry-http-test'}, d1Persist: false});
  try {
    const health = await runtime.dispatchFetch('https://registry.example.invalid/v1/health');
    assert.equal(health.status, 200); assert.deepEqual(await health.json(), {status: 'ok'});
    assert.equal((await runtime.dispatchFetch('https://registry.example.invalid/bootstrap', {method: 'POST'})).status, 404);
    assert.equal((await runtime.dispatchFetch('https://registry.example.invalid/v1/publications/preflight', {method: 'POST'})).status, 401);
    assert.equal((await runtime.dispatchFetch('https://other.example.invalid/v1/health')).status, 503);
  } finally {await runtime.dispose();}
});

test('operator sends parameterized batches only to selected D1 and never follows redirects or reflects provider errors', async () => {
  const config = {accountId: 'a'.repeat(32), databaseId: '11111111-1111-4111-8111-111111111111', token: 'qualification-token-not-a-real-secret'};
  let captured;
  const db = createRegistryD1Operator({...config, fetcher: async (url, init) => {
    captured = {url, init};
    return Response.json({success: true, result: [{success: true, results: [], meta: {changes: 1}},
      {success: true, results: [], meta: {changes: 1}}]});
  }});
  await db.batch([db.prepare('INSERT INTO examples(value) VALUES(?)').bind("a';DROP TABLE examples;--"),
    db.prepare('UPDATE examples SET value=? WHERE id=?').bind('b', 2)]);
  assert.equal(captured.url, `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`);
  assert.equal(captured.init.redirect, 'error');
  assert.equal(JSON.parse(captured.init.body).batch[0].params[0], "a';DROP TABLE examples;--");
  await assert.rejects(db.batch([{}]), /Foreign statement/);
  const denied = createRegistryD1Operator({...config, fetcher: async () => Response.json({success: false,
    errors: [{message: config.token}]}, {status: 403})});
  await assert.rejects(denied.prepare('SELECT 1').all(), error => !error.message.includes(config.token));
});

test('registry deployment configuration is explicit, credential-free and independent of app bindings', () => {
  const env = {CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CREEZIO_REGISTRY_DATABASE_ID: '11111111-1111-4111-8111-111111111111',
    CREEZIO_REGISTRY_WORKER_NAME: 'creezio-registry-test', CREEZIO_REGISTRY_ORIGIN: 'https://registry.example.invalid',
    CLOUDFLARE_API_TOKEN: 'not-written'};
  const config = registryConfiguration(env);
  assert.equal(config.d1_databases[0].binding, 'DB'); assert.equal(config.vars.REGISTRY_ORIGIN, env.CREEZIO_REGISTRY_ORIGIN);
  assert.equal(JSON.stringify(config).includes(env.CLOUDFLARE_API_TOKEN), false);
  for (const origin of ['http://registry.example.invalid', 'https://registry.example.invalid/', 'https://u:p@registry.example.invalid'])
    assert.throws(() => registryConfiguration({...env, CREEZIO_REGISTRY_ORIGIN: origin}));
  assert.throws(() => registryConfiguration({...env, CREEZIO_REGISTRY_DATABASE_ID: ''}));
  assert.throws(() => registryConfiguration({...env, CREEZIO_REGISTRY_DATABASE_ID: '-'.repeat(36)}));
});
