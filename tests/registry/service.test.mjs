import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {bootstrapRegistry} from '../../services/registry/bootstrap.ts';
import {createRegistryService} from '../../services/registry/service.ts';
import {issueCredential} from '../../services/registry/credentials.ts';
import {createRegistryClient} from '../../core/registry/client.ts';

const origin = 'https://registry.example.invalid';
const artifact = {sourceSha: 'a'.repeat(40), artifactDigest: `sha256-${'b'.repeat(64)}`,
  coreVersion: '1.0.0', contractVersion: '1.0.0', compositionDigest: `sha256-${'c'.repeat(64)}`};
const schema = readFileSync(fileURLToPath(new URL('../../services/registry/schema.sql', import.meta.url)), 'utf8');
async function fixture(extra = {}) {
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: 'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases: {DB: 'registry-qualification'}, d1Persist: false});
  let db;
  try {db = await runtime.getD1Database('DB');
    await db.batch(schema.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => db.prepare(statement)));}
  catch (error) {await runtime.dispose(); throw error;}
  const environment = {DB: db, REGISTRY_ORIGIN: origin, ...extra};
  const service = createRegistryService(environment);
  const send = async (path, method = 'GET', value, headers = {}) => {
    const response = await service.fetch(new Request(`${origin}${path}`, {method, headers: {
      ...(value === undefined ? {} : {'content-type': 'application/json'}), ...headers},
      ...(value === undefined ? {} : {body: JSON.stringify(value)})}));
    return {response, body: await response.json()};
  };
  const ownerHeaders = token => ({cookie: `__Host-creezio-registry-owner=${token}`, origin,
    'x-creezio-request': '1'});
  return {runtime, db, environment, service, send, ownerHeaders, close: () => runtime.dispose()};
}
function interceptRun(db, fragment, beforeRun) {
  let pending = true;
  return {prepare(sql) {
    const wrap = statement => ({
      bind(...args) {return wrap(statement.bind(...args));},
      first(...args) {return statement.first(...args);},
      all(...args) {return statement.all(...args);},
      async run() {
        if (pending && sql.includes(fragment)) {pending = false; await beforeRun();}
        return statement.run();
      }
    });
    return wrap(db.prepare(sql));
  }, batch: statements => db.batch(statements)};
}
function interceptAll(db, fragment, beforeAll) {
  let pending = true;
  return {prepare(sql) {
    const wrap = statement => ({
      bind(...args) {return wrap(statement.bind(...args));},
      first(...args) {return statement.first(...args);},
      async all() {
        if (pending && sql.includes(fragment)) {pending = false; await beforeAll();}
        return statement.all();
      },
      run(...args) {return statement.run(...args);},
    });
    return wrap(db.prepare(sql));
  }, batch: statements => db.batch(statements)};
}

test('bootstrap is explicit and once-only; token is purpose separated and stored only as digest', async () => {
  const f = await fixture();
  try {
    const started = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    assert.match(started.ownerToken, /^cz1o_[A-Za-z0-9_-]{43}$/);
    await assert.rejects(bootstrapRegistry(f.db, {maintainerEmail: 'second@example.invalid', serviceId: 'registry-primary'}));
    const rows = await f.db.prepare('SELECT digest FROM registry_owner_sessions').all();
    assert.equal(rows.results.length, 1);
    assert.notEqual(rows.results[0].digest, started.ownerToken);
    assert.match(rows.results[0].digest, /^sha256:[a-f0-9]{64}$/);
    const owner = await f.db.prepare('SELECT method,subject,email FROM registry_owners').first();
    assert.equal(owner.method, 'bootstrap', 'operator bootstrap is not mislabeled as email verification');
    assert.equal(owner.subject, 'registry-primary');
    assert.equal(owner.email, 'owner@example.invalid');
  } finally {await f.close();}
});

test('owner browser reads are scoped, bounded and never return installation credentials', async () => {
  const f = await fixture();
  try {
    const page = await f.service.fetch(new Request(`${origin}/`));
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const script = await f.service.fetch(new Request(`${origin}/registry.js`));
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /^application\/javascript/);
    assert.equal((await f.send('/v1/owners/me')).response.status, 401);
    assert.equal((await f.send('/v1/projects')).response.status, 401);
    const first = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const auth = f.ownerHeaders(first.ownerToken);
    const project = await f.send('/v1/projects', 'POST',
      {name: 'First application', origin: 'https://github.com/example/first'}, auth);
    assert.equal(project.response.status, 201);
    const sites = await f.send('/v1/installations', 'POST',
      {projectId: project.body.projectId, target: 'sites'}, auth);
    const cloudflare = await f.send('/v1/installations', 'POST',
      {projectId: project.body.projectId, target: 'cloudflare'}, auth);
    assert.equal(sites.response.status, 201);
    assert.equal(cloudflare.response.status, 201);
    assert.deepEqual((await f.send('/v1/owners/me', 'GET', undefined, auth)).body, {
      ownerId: first.ownerId,
    });
    const listed = await f.send('/v1/projects', 'GET', undefined, auth);
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.complete, true);
    assert.deepEqual(listed.body.projects.map(item => item.projectId), [project.body.projectId]);
    const installations = await f.send(`/v1/projects/${project.body.projectId}/installations`,
      'GET', undefined, auth);
    assert.equal(installations.response.status, 200);
    assert.equal(installations.body.complete, true);
    assert.deepEqual(new Set(installations.body.installations.map(item => item.target)),
      new Set(['sites', 'cloudflare']));
    assert.equal(JSON.stringify({listed: listed.body, installations: installations.body})
      .includes(sites.body.token), false);
    assert.equal(JSON.stringify(installations.body).includes('tokenDigest'), false);
    const second = await issueCredential('owner');
    const secondId = crypto.randomUUID();
    await f.db.batch([
      f.db.prepare(`INSERT INTO registry_owners(id,method,subject,email,verified_at_ms)
        VALUES(?,'github',?,NULL,?)`).bind(secondId, 'second-owner', Date.now()),
      f.db.prepare(`INSERT INTO registry_owner_sessions(digest,owner_id,expires_at_ms,revoked_at_ms)
        VALUES(?,?,?,NULL)`).bind(second.digest, secondId, Date.now() + 60_000),
    ]);
    const other = f.ownerHeaders(second.token);
    assert.deepEqual((await f.send('/v1/projects', 'GET', undefined, other)).body.projects, []);
    assert.equal((await f.send(`/v1/projects/${project.body.projectId}/installations`,
      'GET', undefined, other)).response.status, 404);
    assert.equal((await f.send('/v1/projects', 'POST',
      {name: 'Denied', origin: 'https://github.com/example/denied'},
      {cookie: auth.cookie})).response.status, 403, 'the browser POST still requires exact CSRF headers');
    await f.db.batch(Array.from({length: 100}, (_, index) =>
      f.db.prepare('INSERT INTO registry_projects(id,owner_id,name,origin,created_at_ms) VALUES(?,?,?,?,?)')
        .bind(crypto.randomUUID(), first.ownerId, `Extra ${index}`,
          `https://github.com/example/extra-${index}`, Date.now() + index)));
    const bounded = await f.send('/v1/projects', 'GET', undefined, auth);
    assert.equal(bounded.body.projects.length, 100);
    assert.equal(bounded.body.complete, false, 'a bounded response never claims a complete inventory');
  } finally {await f.close();}
});

test('browser reads recheck session and project owner inside the final query', async () => {
  const f = await fixture();
  try {
    const actor = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const auth = f.ownerHeaders(actor.ownerToken);
    const project = await f.send('/v1/projects', 'POST',
      {name: 'Race read', origin: 'https://source.example.invalid/'}, auth);
    const install = await f.send('/v1/installations', 'POST',
      {projectId: project.body.projectId, target: 'sites'}, auth);
    assert.equal(install.response.status, 201);
    const nextOwner = crypto.randomUUID();
    await f.db.prepare("INSERT INTO registry_owners(id,method,subject,email,verified_at_ms) VALUES(?,'email',?,?,?)")
      .bind(nextOwner, 'next@example.invalid', 'next@example.invalid', Date.now()).run();
    const transferred = createRegistryService({...f.environment, DB: interceptAll(f.db,
      'LEFT JOIN registry_installations i', () => f.db.prepare('UPDATE registry_projects SET owner_id=? WHERE id=?')
        .bind(nextOwner, project.body.projectId).run())});
    const afterTransfer = await transferred.fetch(new Request(`${origin}/v1/projects/${project.body.projectId}/installations`,
      {headers: auth}));
    assert.equal(afterTransfer.status, 404);
    const revoked = createRegistryService({...f.environment, DB: interceptAll(f.db,
      'SELECT p.id,p.name,p.origin,p.created_at_ms', () => f.db.prepare(
        'UPDATE registry_owner_sessions SET revoked_at_ms=? WHERE owner_id=?')
        .bind(Date.now(), actor.ownerId).run())});
    const afterRevocation = await revoked.fetch(new Request(`${origin}/v1/projects`, {headers: auth}));
    assert.equal(afterRevocation.status, 200);
    assert.deepEqual((await afterRevocation.json()).projects, []);
  } finally {await f.close();}
});

test('publication requires verified owner and installation token; declaration is exact and idempotent', async () => {
  const f = await fixture();
  try {
    const started = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const project = await f.send('/v1/projects', 'POST', {name: 'Creezio A', origin: 'https://source.example.invalid/'},
      f.ownerHeaders(started.ownerToken));
    assert.equal(project.response.status, 201, JSON.stringify(project.body));
    const install = await f.send('/v1/installations', 'POST', {projectId: project.body.projectId, target: 'sites'},
      f.ownerHeaders(started.ownerToken));
    assert.equal(install.response.status, 201, JSON.stringify(install.body));
    const token = install.body.token;
    assert.match(token, /^cz1d_[A-Za-z0-9_-]{43}$/);
    assert.notEqual((await f.db.prepare('SELECT token_digest FROM registry_installations').first()).token_digest, token);
    const preflight = {projectId: project.body.projectId, installationId: install.body.installationId,
      target: 'sites', artifact};
    assert.equal((await f.send('/v1/publications/preflight', 'POST', preflight)).response.status, 401);
    assert.equal((await f.send('/v1/publications/preflight', 'POST', {...preflight, target: 'cloudflare'},
      {authorization: `Bearer ${token}`})).response.status, 403);
    const approved = await f.send('/v1/publications/preflight', 'POST', preflight,
      {authorization: `Bearer ${token}`});
    assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
    const declaration = {preflightId: approved.body.preflightId, requestKey: 'release-1',
      projectId: project.body.projectId, installationId: install.body.installationId, deploymentId: 'deploy-1',
      url: 'https://app.example.invalid/', artifact};
    const first = await f.send('/v1/deployments/declare', 'POST', declaration, {authorization: `Bearer ${token}`});
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.replayed, false);
    const replay = await f.send('/v1/deployments/declare', 'POST', declaration, {authorization: `Bearer ${token}`});
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.declaredAt, first.body.declaredAt);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_deployments').first()).n, 1);
    const changed = await f.send('/v1/deployments/declare', 'POST', {...declaration, url: 'https://other.example.invalid/'},
      {authorization: `Bearer ${token}`});
    assert.equal(changed.response.status, 409);
    const forged = await f.send('/v1/deployments/declare', 'POST', {...declaration,
      requestKey: 'release-2', artifact: {...artifact, artifactDigest: `sha256-${'f'.repeat(64)}`}},
    {authorization: `Bearer ${token}`});
    assert.equal(forged.response.status, 403);
    const delayed = createRegistryService(f.environment, {now: () => Date.now() + 3 * 86_400_000});
    const afterOutage = await delayed.fetch(new Request(`${origin}/v1/deployments/declare`, {
      method: 'POST', headers: {'authorization': `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({...declaration, requestKey: 'release-3', deploymentId: 'deploy-3'}),
    }));
    assert.equal(afterOutage.status, 200, 'a delivered publication can sync after a long registry outage');
    const rotated = await f.send(`/v1/installations/${install.body.installationId}/rotate`, 'POST', undefined,
      f.ownerHeaders(started.ownerToken));
    assert.equal(rotated.response.status, 200);
    assert.equal((await f.send('/v1/publications/preflight', 'POST', preflight,
      {authorization: `Bearer ${token}`})).response.status, 401);
    const afterRotation = await f.send('/v1/deployments/declare', 'POST', declaration,
      {authorization: `Bearer ${rotated.body.token}`});
    assert.equal(afterRotation.response.status, 200, 'a published result can be resynchronized after token rotation');
    assert.equal(afterRotation.body.replayed, true);
    const revoked = await f.send(`/v1/installations/${install.body.installationId}/revoke`, 'POST', undefined,
      f.ownerHeaders(started.ownerToken));
    assert.equal(revoked.response.status, 200);
    assert.equal((await f.send('/v1/publications/preflight', 'POST', preflight,
      {authorization: `Bearer ${rotated.body.token}`})).response.status, 401);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_deployments').first()).n, 2,
      'revocation does not delete an already delivered app or its history');
  } finally {await f.close();}
});

test('separate registry service speaks the exact server client protocol', async () => {
  const f = await fixture();
  try {
    const operator = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const project = await f.send('/v1/projects', 'POST', {name: 'Client contract', origin: 'https://source.example.invalid/'},
      f.ownerHeaders(operator.ownerToken));
    const install = await f.send('/v1/installations', 'POST', {projectId: project.body.projectId, target: 'cloudflare'},
      f.ownerHeaders(operator.ownerToken));
    const client = createRegistryClient({origin, installationToken: install.body.token,
      fetch: (url, init) => f.service.fetch(new Request(url, init))});
    const value = {projectId: project.body.projectId, installationId: install.body.installationId,
      target: 'cloudflare', artifact};
    const checked = await client.preflight(value);
    assert.equal(checked.projectId, value.projectId);
    const declared = await client.declare({preflightId: checked.preflightId, requestKey: 'client-contract-1',
      projectId: value.projectId, installationId: value.installationId, deploymentId: 'deployment-1',
      url: 'https://app.example.invalid/', artifact});
    assert.equal(declared.deploymentId, 'deployment-1');
    assert.equal(declared.replayed, false);
  } finally {await f.close();}
});

test('revocation between authorization read and D1 write blocks both preflight and declaration', async () => {
  const f = await fixture();
  try {
    const owner = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const project = await f.send('/v1/projects', 'POST', {name: 'Race', origin: 'https://source.example.invalid/'},
      f.ownerHeaders(owner.ownerToken));
    const a = await f.send('/v1/installations', 'POST', {projectId: project.body.projectId, target: 'sites'},
      f.ownerHeaders(owner.ownerToken));
    const request = {projectId: project.body.projectId, installationId: a.body.installationId, target: 'sites', artifact};
    const stale = createRegistryService({...f.environment, DB: interceptRun(f.db, 'INSERT INTO registry_preflights',
      () => f.db.prepare('UPDATE registry_installations SET revoked_at_ms=? WHERE id=?')
        .bind(Date.now(), a.body.installationId).run())});
    const preflightResponse = await stale.fetch(new Request(`${origin}/v1/publications/preflight`, {method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${a.body.token}`}, body: JSON.stringify(request)}));
    assert.equal(preflightResponse.status, 401);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_preflights').first()).n, 0);

    const b = await f.send('/v1/installations', 'POST', {projectId: project.body.projectId, target: 'sites'},
      f.ownerHeaders(owner.ownerToken));
    const allowed = await f.send('/v1/publications/preflight', 'POST', {...request, installationId: b.body.installationId},
      {authorization: `Bearer ${b.body.token}`});
    assert.equal(allowed.response.status, 200);
    const payload = {preflightId: allowed.body.preflightId, requestKey: 'race-1', projectId: project.body.projectId,
      installationId: b.body.installationId, deploymentId: 'deploy-race', url: 'https://app.example.invalid/', artifact};
    const raced = createRegistryService({...f.environment, DB: interceptRun(f.db, 'INSERT INTO registry_deployments',
      () => f.db.prepare('UPDATE registry_installations SET revoked_at_ms=? WHERE id=?')
        .bind(Date.now(), b.body.installationId).run())});
    const declarationResponse = await raced.fetch(new Request(`${origin}/v1/deployments/declare`, {method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${b.body.token}`}, body: JSON.stringify(payload)}));
    assert.equal(declarationResponse.status, 401);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_deployments').first()).n, 0);
  } finally {await f.close();}
});

test('owner transfer during installation request blocks the former owner at insertion', async () => {
  const f = await fixture();
  try {
    const operator = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const project = await f.send('/v1/projects', 'POST', {name: 'Owner race', origin: 'https://source.example.invalid/'},
      f.ownerHeaders(operator.ownerToken));
    const nextOwner = crypto.randomUUID();
    await f.db.prepare("INSERT INTO registry_owners(id,method,subject,email,verified_at_ms) VALUES(?,'email',?,?,?)")
      .bind(nextOwner, 'next@example.invalid', 'next@example.invalid', Date.now()).run();
    const raced = createRegistryService({...f.environment, DB: interceptRun(f.db, 'INSERT INTO registry_installations',
      () => f.db.prepare('UPDATE registry_projects SET owner_id=? WHERE id=?')
        .bind(nextOwner, project.body.projectId).run())});
    const response = await raced.fetch(new Request(`${origin}/v1/installations`, {method: 'POST',
      headers: {...f.ownerHeaders(operator.ownerToken), 'content-type': 'application/json'},
      body: JSON.stringify({projectId: project.body.projectId, target: 'sites'})}));
    assert.equal(response.status, 403);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_installations').first()).n, 0);
  } finally {await f.close();}
});

test('a cancelled body stops reception without creating a preflight', async () => {
  const f = await fixture();
  try {
    const owner = await bootstrapRegistry(f.db, {maintainerEmail: 'owner@example.invalid', serviceId: 'registry-primary'});
    const project = await f.send('/v1/projects', 'POST', {name: 'Body', origin: 'https://source.example.invalid/'},
      f.ownerHeaders(owner.ownerToken));
    const install = await f.send('/v1/installations', 'POST', {projectId: project.body.projectId, target: 'sites'},
      f.ownerHeaders(owner.ownerToken));
    const controller = new AbortController();
    const request = new Request(`${origin}/v1/publications/preflight`, {method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${install.body.token}`},
      body: new ReadableStream({pull() {return new Promise(() => {});}}), duplex: 'half', signal: controller.signal});
    const pending = f.service.fetch(request);
    setTimeout(() => controller.abort(), 25);
    const response = await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error('body did not stop')), 1000))]);
    assert.equal(response.status, 400);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_preflights').first()).n, 0);
  } finally {await f.close();}
});

test('email verification needs configured delivery and a one-use delivered code', async () => {
  const absent = await fixture();
  try {assert.equal((await absent.send('/v1/owners/email/start', 'POST', {email: 'a@example.invalid'},
    {origin, 'x-creezio-request': '1'})).response.status, 503);}
  finally {await absent.close();}
  const failed = await fixture({EMAIL_DELIVERY: {async fetch() {throw new Error('offline');}}});
  try {
    assert.equal((await failed.send('/v1/owners/email/start', 'POST', {email: 'a@example.invalid'},
      {origin, 'x-creezio-request': '1'})).response.status, 503);
    const challenge = await failed.db.prepare('SELECT consumed_at_ms FROM registry_email_challenges').first();
    assert.ok(challenge.consumed_at_ms, 'failed delivery cannot be verified or used for unlimited free attempts');
  } finally {await failed.close();}
  let delivery;
  const f = await fixture({EMAIL_DELIVERY: {async fetch(request) {delivery = await request.json(); return new Response(null, {status: 204});}}});
  try {
    const begin = await f.send('/v1/owners/email/start', 'POST', {email: 'a@example.invalid'},
      {origin, 'x-creezio-request': '1'});
    assert.equal(begin.response.status, 202, JSON.stringify(begin.body));
    assert.equal(delivery.to, 'a@example.invalid');
    const bad = await f.send('/v1/owners/email/verify', 'POST', {challengeId: begin.body.challengeId, code: '00000000'},
      {origin, 'x-creezio-request': '1'});
    assert.equal(bad.response.status, 403);
    const good = await f.send('/v1/owners/email/verify', 'POST', {challengeId: begin.body.challengeId, code: delivery.code},
      {origin, 'x-creezio-request': '1'});
    assert.equal(good.response.status, 200, JSON.stringify(good.body));
    assert.match(good.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal((await f.send('/v1/owners/email/verify', 'POST', {challengeId: begin.body.challengeId, code: delivery.code},
      {origin, 'x-creezio-request': '1'})).response.status, 403);
  } finally {await f.close();}
});

test('anonymous admission is globally bounded across distinct emails and GitHub, then prunes old states', async () => {
  let now = Date.now(), sent = 0;
  const f = await fixture({EMAIL_DELIVERY: {async fetch() {sent++; return new Response(null, {status: 204});}},
    GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret'});
  const service = createRegistryService(f.environment, {now: () => now});
  const emailStart = address => service.fetch(new Request(`${origin}/v1/owners/email/start`, {
    method: 'POST', headers: {origin, 'x-creezio-request': '1', 'content-type': 'application/json'},
    body: JSON.stringify({email: address}),
  }));
  try {
    const sameAddress = await Promise.all(Array.from({length: 5}, () => emailStart('same@example.invalid')));
    assert.deepEqual(sameAddress.map(response => response.status).sort(), [202, 202, 202, 429, 429]);
    assert.equal(sent, 3);
    for (let index = 0; index < 116; index++) {
      await f.db.prepare(`INSERT INTO registry_email_challenges
        (id,email,code_digest,created_at_ms,expires_at_ms,attempts,consumed_at_ms) VALUES(?,?,?,?,?,0,NULL)`)
        .bind(crypto.randomUUID(), `other-${index}@example.invalid`, 'digest', now, now + 600_000).run();
    }
    assert.equal((await emailStart('last@example.invalid')).status, 202);
    assert.equal(sent, 4);
    assert.equal((await emailStart('overflow@example.invalid')).status, 429,
      'unique addresses cannot bypass the global admission limit');
    assert.equal(sent, 4, 'a denied request never calls the delivery provider');
    assert.equal((await service.fetch(new Request(`${origin}/v1/owners/github/start`))).status, 429,
      'GitHub shares the same global limit');
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_oauth_states').first()).n, 0);
    now += 3_600_001;
    assert.equal((await service.fetch(new Request(`${origin}/v1/owners/github/start`))).status, 302);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_email_challenges').first()).n, 20,
      'one request prunes at most 100 old email admissions');
    assert.equal((await emailStart('fresh@example.invalid')).status, 202);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_email_challenges').first()).n, 1,
      'subsequent requests finish bounded cleanup');
    for (let index = 0; index < 119; index++) {
      await f.db.prepare(`INSERT INTO registry_oauth_states(state_digest,verifier,expires_at_ms,consumed_at_ms)
        VALUES(?,?,?,NULL)`).bind(`state-${index}`, 'verifier', now + 600_000).run();
    }
    assert.equal((await service.fetch(new Request(`${origin}/v1/owners/github/start`))).status, 429,
      'GitHub states themselves exhaust the durable quota');
    now += 3_600_001;
    assert.equal((await service.fetch(new Request(`${origin}/v1/owners/github/start`))).status, 302);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM registry_oauth_states').first()).n, 21,
      'one request prunes at most 100 old OAuth states');
  } finally {await f.close();}
});

test('explicit transfer accepts only another verified owner and removes old owner control', async () => {
  let delivery;
  const f = await fixture({EMAIL_DELIVERY: {async fetch(request) {delivery = await request.json(); return new Response(null, {status: 204});}}});
  try {
    const bootstrap = await bootstrapRegistry(f.db, {maintainerEmail: 'maintainer@example.invalid', serviceId: 'registry-primary'});
    const created = await f.send('/v1/projects', 'POST', {name: 'Transferred', origin: 'https://source.example.invalid/'},
      f.ownerHeaders(bootstrap.ownerToken));
    assert.equal(created.response.status, 201);
    const oldInstallation = await f.send('/v1/installations', 'POST', {projectId: created.body.projectId, target: 'sites'},
      f.ownerHeaders(bootstrap.ownerToken));
    assert.equal(oldInstallation.response.status, 201);
    const start = await f.send('/v1/owners/email/start', 'POST', {email: 'recipient@example.invalid'},
      {origin, 'x-creezio-request': '1'});
    const verified = await f.send('/v1/owners/email/verify', 'POST', {challengeId: start.body.challengeId, code: delivery.code},
      {origin, 'x-creezio-request': '1'});
    assert.equal(verified.response.status, 200);
    const newOwnerToken = /__Host-creezio-registry-owner=([^;]+)/.exec(verified.response.headers.get('set-cookie'))[1];
    const route = `/v1/projects/${created.body.projectId}/transfer`;
    assert.equal((await f.send(route, 'POST', {newOwnerId: 'forged-owner'},
      f.ownerHeaders(bootstrap.ownerToken))).response.status, 403);
    const transferred = await f.send(route, 'POST', {newOwnerId: verified.body.ownerId},
      f.ownerHeaders(bootstrap.ownerToken));
    assert.equal(transferred.response.status, 200);
    const install = {projectId: created.body.projectId, target: 'sites'};
    assert.equal((await f.send('/v1/publications/preflight', 'POST', {...install,
      installationId: oldInstallation.body.installationId, artifact},
    {authorization: `Bearer ${oldInstallation.body.token}`})).response.status, 401,
    'old owner cannot publish with a retained installation token after transfer');
    assert.equal((await f.send('/v1/installations', 'POST', install,
      f.ownerHeaders(bootstrap.ownerToken))).response.status, 403);
    assert.equal((await f.send('/v1/installations', 'POST', install,
      f.ownerHeaders(newOwnerToken))).response.status, 201);
  } finally {await f.close();}
});

test('GitHub web flow binds state and PKCE, rechecks user identity, and refuses absent config', async () => {
  const absent = await fixture();
  try {assert.equal((await absent.send('/v1/owners/github/start')).response.status, 503);}
  finally {await absent.close();}
  const calls = [];
  const f = await fixture({GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret'});
  const service = createRegistryService(f.environment, {fetch: async (url, options) => {
    calls.push([url, options]);
    if (url === 'https://github.com/login/oauth/access_token') return new Response(
      JSON.stringify({access_token: 'gho_test', token_type: 'bearer'}),
      {headers: {'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '20000'}});
    if (url === 'https://api.github.com/user') return Response.json({id: 42, login: 'verified-owner'});
    return new Response(null, {status: 404});
  }});
  try {
    const start = await service.fetch(new Request(`${origin}/v1/owners/github/start`));
    assert.equal(start.status, 302);
    const redirect = new URL(start.headers.get('location'));
    assert.equal(redirect.origin, 'https://github.com');
    assert.equal(redirect.searchParams.get('scope'), 'read:user');
    assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
    const state = redirect.searchParams.get('state');
    const stateCookie = start.headers.get('set-cookie').split(';')[0];
    const url = `${origin}/v1/owners/github/callback?state=${encodeURIComponent(state)}&code=issued-code`;
    assert.equal((await service.fetch(new Request(url))).status, 403, 'a header-supplied identity is not enough');
    const done = await service.fetch(new Request(url, {headers: {cookie: stateCookie}}));
    assert.equal(done.status, 200, await done.clone().text());
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0][1].body).code_verifier.length, 43);
    assert.equal(calls[0][1].redirect, 'manual');
    assert.equal(calls[1][1].redirect, 'manual');
    assert.equal(calls[1][1].headers.authorization, 'Bearer gho_test');
    assert.equal((await service.fetch(new Request(url, {headers: {cookie: stateCookie}}))).status, 403);
    const browserStart = await service.fetch(new Request(`${origin}/v1/owners/github/start`));
    const browserState = new URL(browserStart.headers.get('location')).searchParams.get('state');
    const browserCookie = browserStart.headers.get('set-cookie').split(';')[0];
    const browserDone = await service.fetch(new Request(
      `${origin}/v1/owners/github/callback?state=${encodeURIComponent(browserState)}&code=browser-code`,
      {headers: {cookie: browserCookie, accept: 'text/html,application/xhtml+xml'}}));
    assert.equal(browserDone.status, 303, 'browser callback lands on the same-origin registry page');
    assert.equal(browserDone.headers.get('location'), `${origin}/`);
    assert.ok(browserDone.headers.get('set-cookie').includes('__Host-creezio-registry-owner='));
    assert.equal(await browserDone.text(), '');
    const oversized = createRegistryService(f.environment, {fetch: async () => new Response('x'.repeat(16_385),
      {status: 200, headers: {'content-type': 'application/json'}})});
    const retry = await oversized.fetch(new Request(`${origin}/v1/owners/github/start`));
    const retryState = new URL(retry.headers.get('location')).searchParams.get('state');
    const retryCookie = retry.headers.get('set-cookie').split(';')[0];
    const denied = await oversized.fetch(new Request(`${origin}/v1/owners/github/callback?state=${encodeURIComponent(retryState)}&code=second-code`,
      {headers: {cookie: retryCookie}}));
    assert.equal(denied.status, 503, 'oversized provider response never verifies a new owner');
  } finally {await f.close();}
});
