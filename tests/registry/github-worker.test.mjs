import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://registry.example.invalid';
const schema = readFileSync(fileURLToPath(new URL('../../services/registry/schema.sql', import.meta.url)), 'utf8');

test('GitHub callback handles provider responses in the Worker runtime without following redirects', async () => {
  const bundle = await build({absWorkingDir: root, entryPoints: ['services/registry/worker.ts'],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent'});
  const outbound = [];
  let provider = 'redirect';
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: bundle.outputFiles[0].text,
    bindings: {REGISTRY_ORIGIN: origin, GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret'},
    d1Databases: {DB: 'registry-github-worker'}, d1Persist: false,
    outboundService: async request => {
      outbound.push({url: request.url, method: request.method});
      if (provider === 'success') {
        if (request.url === 'https://github.com/login/oauth/access_token')
          return Response.json({access_token: 'gho_synthetic', token_type: 'bearer'});
        if (request.url === 'https://api.github.com/user')
          return Response.json({id: 42, login: 'verified-owner'});
      }
      return new Response(null, {status: 303, headers: {location: 'https://unexpected.example.invalid/redirect'}});
    }});
  try {
    const db = await runtime.getD1Database('DB');
    await db.batch(schema.split(';').map(statement => statement.trim()).filter(Boolean)
      .map(statement => db.prepare(statement)));
    const start = await runtime.dispatchFetch(`${origin}/v1/owners/github/start`, {redirect: 'manual'});
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const stateCookie = start.headers.get('set-cookie').split(';')[0];
    const callback = await runtime.dispatchFetch(
      `${origin}/v1/owners/github/callback?state=${encodeURIComponent(state)}&code=synthetic-code`,
      {headers: {cookie: stateCookie}});
    assert.equal(callback.status, 503);
    assert.deepEqual(await callback.json(), {error: {code: 'service_unavailable'}});
    assert.deepEqual(outbound, [{url: 'https://github.com/login/oauth/access_token', method: 'POST'}]);
    const owners = await db.prepare('SELECT count(*) AS count FROM registry_owners').first();
    assert.equal(owners.count, 0);

    provider = 'success';
    const secondStart = await runtime.dispatchFetch(`${origin}/v1/owners/github/start`, {redirect: 'manual'});
    assert.equal(secondStart.status, 302);
    const secondState = new URL(secondStart.headers.get('location')).searchParams.get('state');
    const secondCookie = secondStart.headers.get('set-cookie').split(';')[0];
    const secondUrl = `${origin}/v1/owners/github/callback?state=${encodeURIComponent(secondState)}&code=synthetic-success-code`;
    const completed = await runtime.dispatchFetch(secondUrl, {headers: {cookie: secondCookie}});
    assert.equal(completed.status, 200);
    const result = await completed.json();
    assert.equal(typeof result.ownerId, 'string');
    assert.ok(completed.headers.get('set-cookie').includes('__Host-creezio-registry-owner='));
    assert.deepEqual(outbound.slice(1), [
      {url: 'https://github.com/login/oauth/access_token', method: 'POST'},
      {url: 'https://api.github.com/user', method: 'GET'}]);
    const owner = await db.prepare('SELECT id,method,subject FROM registry_owners WHERE id=?')
      .bind(result.ownerId).first();
    assert.deepEqual(owner, {id: result.ownerId, method: 'github', subject: '42'});
    const sessions = await db.prepare('SELECT count(*) AS count FROM registry_owner_sessions WHERE owner_id=?')
      .bind(result.ownerId).first();
    assert.equal(sessions.count, 1);
    const replay = await runtime.dispatchFetch(secondUrl, {headers: {cookie: secondCookie}});
    assert.equal(replay.status, 403);
    assert.equal(outbound.length, 3);
  } finally {await runtime.dispose();}
});
