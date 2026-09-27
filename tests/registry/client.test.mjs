import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistryClient, RegistryClientError } from '../../core/registry/client.ts';

const origin = 'https://registry.creezio.example';
const installationToken = `cz1d_${'A'.repeat(43)}`;
const artifact = Object.freeze({ sourceSha: 'a'.repeat(40), artifactDigest: `sha256-${'b'.repeat(64)}`,
  coreVersion: '1.0.0', contractVersion: '1', compositionDigest: `sha256-${'c'.repeat(64)}` });
const preflight = Object.freeze({ projectId: 'project-1', installationId: 'installation-1',
  target: 'cloudflare', artifact });
const checkedAt = '2026-09-27T02:00:00.000Z', expiresAt = '2026-09-27T02:10:00.000Z';
const preflightResult = { preflightId: 'preflight-1', projectId: preflight.projectId,
  installationId: preflight.installationId, checkedAt, expiresAt };
const declaration = Object.freeze({ preflightId: preflightResult.preflightId, requestKey: 'request-1',
  projectId: preflight.projectId, installationId: preflight.installationId,
  deploymentId: 'deployment-1', url: 'https://app.example/', artifact,
  publishedSha: 'd'.repeat(40) });
const declarationResult = { projectId: preflight.projectId, installationId: preflight.installationId,
  deploymentId: declaration.deploymentId, declaredAt: '2026-09-27T02:02:00.000Z', replayed: false };
const json = (value, status = 200) => new Response(JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json' } });

test('server client sends only bounded metadata with installation Bearer token to fixed paths', async () => {
  const calls = [];
  const client = createRegistryClient({ origin, installationToken, fetch: async (url, init) => {
    calls.push({ url, init });
    return json(calls.length === 1 ? preflightResult : declarationResult);
  } });
  assert.deepEqual(await client.preflight(preflight), preflightResult);
  assert.deepEqual(await client.declare(declaration), declarationResult);
  assert.deepEqual(calls.map(call => call.url), [
    `${origin}/v1/publications/preflight`, `${origin}/v1/deployments/declare`
  ]);
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.referrerPolicy, 'no-referrer');
    assert.equal(new Headers(call.init.headers).get('authorization'), `Bearer ${installationToken}`);
    assert.doesNotMatch(call.init.body, /cz1d_/);
    assert.doesNotMatch(call.init.body, /businessData|providerSecret/);
  }
  assert.deepEqual(JSON.parse(calls[0].init.body), preflight);
  assert.deepEqual(JSON.parse(calls[1].init.body), declaration);
});

test('client rejects unsafe endpoints, missing token, malformed metadata and extra fields before fetch', async () => {
  for (const bad of ['http://registry.example', 'https://user:pass@registry.example',
    'https://registry.example/path', 'http://192.168.1.2:8080']) {
    assert.throws(() => createRegistryClient({ origin: bad, installationToken }), RegistryClientError);
  }
  assert.throws(() => createRegistryClient({ origin, installationToken: '' }), RegistryClientError);
  assert.doesNotThrow(() => createRegistryClient({ origin: 'http://127.0.0.1:8787',
    installationToken, allowLoopback: true }));
  let calls = 0;
  const client = createRegistryClient({ origin, installationToken, fetch: async () => {
    calls++; return json(preflightResult);
  } });
  for (const bad of [
    { ...preflight, target: 'docker' },
    { ...preflight, artifact: { ...artifact, artifactDigest: 'bad' } },
    { ...preflight, businessData: { customer: 'private' } },
    { ...preflight, installationId: 'wrong/path' }
  ]) await assert.rejects(client.preflight(bad), { code: 'invalid_input' });
  await assert.rejects(client.declare({ ...declaration, url: 'http://app.example/' }), { code: 'invalid_input' });
  await assert.rejects(client.declare({ ...declaration, publishedSha: 'unknown' }), { code: 'invalid_input' });
  assert.equal(calls, 0);
});

test('client fails closed on wrong scope, oversized or malformed responses and remote rejection', async () => {
  const responses = [
    json({ ...preflightResult, installationId: 'other' }),
    json({ ...preflightResult, secret: 'extra' }),
    json({ ...preflightResult, expiresAt: '2026-09-28T02:10:00.000Z' }),
    new Response('x'.repeat(16_385), { status: 200, headers: { 'content-type': 'application/json' } }),
    json({ error: { code: 'authentication_required' } }, 401)
  ];
  const client = createRegistryClient({ origin, installationToken, fetch: async () => responses.shift() });
  for (let i = 0; i < 4; i++) await assert.rejects(client.preflight(preflight), { code: 'invalid_response' });
  await assert.rejects(client.preflight(preflight), { code: 'authentication_required', status: 401 });
});

test('client accepts decoded JSON with retained compression headers and bounds decoded bytes', async () => {
  const decoded = (value, encoding) => new Response(JSON.stringify(value), { status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-encoding': encoding } });
  const responses = [
    decoded(preflightResult, 'br'),
    decoded(declarationResult, 'gzip'),
    new Response('x'.repeat(16_385), { status: 200,
      headers: { 'content-type': 'application/json', 'content-encoding': 'br', 'content-length': '100' } })
  ];
  const client = createRegistryClient({ origin, installationToken, fetch: async () => responses.shift() });
  assert.deepEqual(await client.preflight(preflight), preflightResult);
  assert.deepEqual(await client.declare(declaration), declarationResult);
  await assert.rejects(client.preflight(preflight), { code: 'invalid_response' });
});

test('client reports transport failure without leaking the installation credential', async () => {
  const client = createRegistryClient({ origin, installationToken, fetch: async () => {
    throw new Error(`secret ${installationToken}`);
  } });
  await assert.rejects(client.preflight(preflight), error => {
    assert.equal(error.code, 'unavailable');
    assert.doesNotMatch(error.message, /cz1d_/);
    return true;
  });
});
