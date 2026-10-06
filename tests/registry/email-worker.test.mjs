import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {buildEmailDelivery} from '../../scripts/registry/build-email-delivery.mjs';
import {emailDeliveryConfiguration} from '../../scripts/registry/configure.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://registry.example.invalid';
const schema = readFileSync(fileURLToPath(new URL('../../services/registry/schema.sql', import.meta.url)), 'utf8');
const recipient = 'owner@example.invalid';
async function bundle(entry) {
  const result = await build({absWorkingDir: root, entryPoints: [entry], bundle: true,
    write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent'});
  return result.outputFiles[0].text;
}

test('private email Worker requires a valid service request and a confirmed Resend receipt', async () => {
  const report = await buildEmailDelivery();
  assert.match(report.artifactDigest, /^sha256-[a-f0-9]{64}$/);
  const script = await bundle('services/registry/email-delivery.ts');
  const outbound = [];
  let provider = 'ok';
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script,
    bindings: {RESEND_API_KEY: 'synthetic-key', EMAIL_FROM: 'noreply@updates.creez.io'},
    outboundService: async request => {
      outbound.push({url: request.url, method: request.method, headers: Object.fromEntries(request.headers),
        body: await request.json()});
      if (provider === 'redirect') return new Response(null, {status: 302, headers: {location: 'https://elsewhere.invalid'}});
      if (provider === 'bad-receipt') return Response.json({error: 'not delivered'});
      return Response.json({id: crypto.randomUUID()});
    }});
  const url = 'https://registry-email-delivery.invalid/verification';
  const payload = {to: recipient, code: '01234567', challengeId: crypto.randomUUID()};
  const send = (value = payload, path = url) => runtime.dispatchFetch(path, {method: 'POST',
    headers: {'content-type': 'application/json'}, body: JSON.stringify(value)});
  try {
    assert.equal((await runtime.dispatchFetch(url)).status, 404);
    assert.equal((await send(payload, 'https://wrong.invalid/verification')).status, 404);
    assert.equal((await send({...payload, code: 'bad'})).status, 400);
    assert.equal(outbound.length, 0);
    const accepted = await send();
    assert.equal(accepted.status, 204);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].url, 'https://api.resend.com/emails');
    assert.equal(outbound[0].method, 'POST');
    assert.equal(outbound[0].headers['idempotency-key'], `registry-verification/${payload.challengeId}`);
    assert.equal(outbound[0].headers.authorization, 'Bearer synthetic-key');
    assert.deepEqual(outbound[0].body.to, [recipient]);
    assert.equal(outbound[0].body.from, 'noreply@updates.creez.io');
    assert.match(outbound[0].body.text, /01234567/);
    provider = 'redirect';
    assert.equal((await send()).status, 503);
    provider = 'bad-receipt';
    assert.equal((await send()).status, 503);
  } finally {await runtime.dispose();}
});

test('registry OTP is delivered through a real Worker service binding before owner verification', async () => {
  const [registryScript, emailScript] = await Promise.all([
    bundle('services/registry/worker.ts'), bundle('services/registry/email-delivery.ts')]);
  let email;
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false,
    workers: [
      {name: 'registry', modules: true, script: registryScript, compatibilityDate: '2026-05-15',
        bindings: {REGISTRY_ORIGIN: origin}, d1Databases: {DB: 'registry-email-binding'},
        serviceBindings: {EMAIL_DELIVERY: 'email-delivery'}},
      {name: 'email-delivery', modules: true, script: emailScript, compatibilityDate: '2026-05-15',
        bindings: {RESEND_API_KEY: 'synthetic-key', EMAIL_FROM: 'noreply@updates.creez.io'},
        outboundService: async request => {
          email = {request, body: await request.json()};
          return Response.json({id: crypto.randomUUID()});
        }},
    ], d1Persist: false});
  try {
    const db = await runtime.getD1Database('DB');
    await db.batch(schema.split(';').map(statement => statement.trim()).filter(Boolean)
      .map(statement => db.prepare(statement)));
    const headers = {origin, 'x-creezio-request': '1', 'content-type': 'application/json'};
    const start = await runtime.dispatchFetch(`${origin}/v1/owners/email/start`, {method: 'POST', headers,
      body: JSON.stringify({email: recipient})});
    assert.equal(start.status, 202);
    const challenge = await start.json();
    assert.equal(email.body.to[0], recipient);
    const code = /([0-9]{8})/.exec(email.body.text)[1];
    const verified = await runtime.dispatchFetch(`${origin}/v1/owners/email/verify`, {method: 'POST', headers,
      body: JSON.stringify({challengeId: challenge.challengeId, code})});
    assert.equal(verified.status, 200);
    assert.match(verified.headers.get('set-cookie'), /__Host-creezio-registry-owner=/);
  } finally {await runtime.dispose();}
});

test('email delivery configuration exposes no secret or public route', () => {
  const env = {CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CREEZIO_REGISTRY_WORKER_NAME: 'registry-test',
    CREEZIO_REGISTRY_EMAIL_DELIVERY_WORKER_NAME: 'registry-email-test',
    CREEZIO_REGISTRY_EMAIL_FROM: 'noreply@updates.creez.io', RESEND_API_KEY: 'synthetic-secret'};
  const config = emailDeliveryConfiguration(env);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(JSON.stringify(config).includes(env.RESEND_API_KEY), false);
  assert.deepEqual(config.vars, {EMAIL_FROM: 'noreply@updates.creez.io'});
  assert.throws(() => emailDeliveryConfiguration({...env, CREEZIO_REGISTRY_EMAIL_FROM: 'not-an-email'}));
  assert.equal(emailDeliveryConfiguration({...env, CREEZIO_REGISTRY_EMAIL_FROM: 'sender@example.invalid'})
    .vars.EMAIL_FROM, 'sender@example.invalid');
  assert.throws(() => emailDeliveryConfiguration({...env,
    CREEZIO_REGISTRY_EMAIL_DELIVERY_WORKER_NAME: 'registry-test'}));
});
