import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {bootstrapRegistry} from '../../services/registry/bootstrap.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://registry.example.invalid';
const schema = readFileSync(fileURLToPath(new URL('../../services/registry/schema.sql', import.meta.url)), 'utf8');

test('Worker accepts zero-byte token actions and refuses payloads without weakening owner checks', async () => {
  const bundle = await build({absWorkingDir: root, entryPoints: ['services/registry/worker.ts'],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent'});
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: bundle.outputFiles[0].text,
    bindings: {REGISTRY_ORIGIN: origin}, d1Databases: {DB: 'registry-token-body-worker'}, d1Persist: false});
  try {
    const db = await runtime.getD1Database('DB');
    await db.batch(schema.split(';').map(statement => statement.trim()).filter(Boolean)
      .map(statement => db.prepare(statement)));
    const owner = await bootstrapRegistry(db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const auth = {cookie: `__Host-creezio-registry-owner=${owner.ownerToken}`, origin,
      'x-creezio-request': '1'};
    const create = async (path, value) => runtime.dispatchFetch(`${origin}${path}`, {method: 'POST',
      headers: {...auth, 'content-type': 'application/json'}, body: JSON.stringify(value)});
    const project = await create('/v1/projects', {name: 'Token body', origin: 'https://source.example.invalid/'});
    assert.equal(project.status, 201);
    const projectId = (await project.json()).projectId;
    const installation = await create('/v1/installations', {projectId, target: 'sites'});
    assert.equal(installation.status, 201);
    const installationId = (await installation.json()).installationId;
    const route = `${origin}/v1/installations/${installationId}/rotate`;
    const version = async () => (await db.prepare('SELECT token_version FROM registry_installations WHERE id=?')
      .bind(installationId).first()).token_version;
    assert.equal((await runtime.dispatchFetch(route, {method: 'POST', headers: {cookie: auth.cookie, origin}})).status,
      403, 'CSRF still applies to an empty Worker POST');
    assert.equal((await runtime.dispatchFetch(route, {method: 'POST', headers: {origin,
      'x-creezio-request': '1'}})).status, 401, 'owner session still required');
    assert.equal((await runtime.dispatchFetch(route, {method: 'POST', headers: auth,
      body: '{}'})).status, 400, 'nonempty bodies remain invalid');
    assert.equal(await version(), 1);
    const rotated = await runtime.dispatchFetch(route, {method: 'POST', headers: auth});
    assert.equal(rotated.status, 200, 'Worker presents a zero-byte stream for a bodyless POST');
    assert.equal(await version(), 2);
    assert.equal((await runtime.dispatchFetch(route, {method: 'POST', headers: auth,
      body: ''})).status, 200, 'an explicit empty stream is also allowed');
    assert.equal(await version(), 3);
    const revoke = await runtime.dispatchFetch(`${origin}/v1/installations/${installationId}/revoke`,
      {method: 'POST', headers: auth});
    assert.equal(revoke.status, 200);
    assert.equal(await version(), 4);
  } finally {await runtime.dispose();}
});

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
    const page = await runtime.dispatchFetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await runtime.dispatchFetch(`${origin}/registry.js`)).status, 200);
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
    const browserStart = await runtime.dispatchFetch(`${origin}/v1/owners/github/start`, {redirect: 'manual'});
    const browserState = new URL(browserStart.headers.get('location')).searchParams.get('state');
    const browserCookie = browserStart.headers.get('set-cookie').split(';')[0];
    const browserDone = await runtime.dispatchFetch(
      `${origin}/v1/owners/github/callback?state=${encodeURIComponent(browserState)}&code=browser-code`,
      {redirect: 'manual', headers: {cookie: browserCookie, accept: 'text/html'}});
    assert.equal(browserDone.status, 303);
    assert.equal(browserDone.headers.get('location'), `${origin}/`);
    assert.ok(browserDone.headers.get('set-cookie').includes('__Host-creezio-registry-owner='));
  } finally {await runtime.dispose();}
});
