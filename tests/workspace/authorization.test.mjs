import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createWorkspaceAuthorizationService, projectWorkspaceAuthorization} from '../../core/workspace/authorization.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = `sha256-${'a'.repeat(64)}`;
const ref = id => ({moduleId: 'example.notes', kind: 'permission', id});
const permissions = [{id: 'example.notes:read', actors: ['user'], audiences: ['app']},
  {id: 'example.notes:write', actors: ['user'], audiences: ['app']}];
const catalog = {compositionDigest: digest,
  views: [{id: 'example.notes:list', surfaces: ['workspace'], audiences: ['app'], permissions: [ref('read')]},
    {id: 'example.notes:edit', surfaces: ['workspace'], audiences: ['app'], permissions: [ref('write')]}],
  navigation: [{id: 'example.notes:list-nav', viewId: 'example.notes:list', surfaces: ['workspace'], audiences: ['app'], permissions: []}]};

test('workspace projection requires a valid server catalogue and never infers a grant from a view or role name', () => {
  const db = {prepare() { assert.fail('No D1 read during catalog validation'); }};
  for (const bad of [
    {...catalog, compositionDigest: 'digest'},
    {...catalog, views: [...catalog.views, catalog.views[0]]},
    {...catalog, views: [{...catalog.views[0], permissions: [ref('missing')]}]},
    {...catalog, views: [{...catalog.views[0], audiences: []}]},
    {...catalog, navigation: [{...catalog.navigation[0], viewId: 'example.notes:missing'}]},
  ]) assert.throws(() => createWorkspaceAuthorizationService(db, {permissions, catalog: bad}));
  const state = {epoch: 2, nowMs: 100, session: {id: 'session-1', principalId: 'person-1', audience: 'app', expiresAtMs: 200},
    policy: {contexts: [{id: 'workspace-a', status: 'active'}], memberships: [{principalId: 'person-1', contextId: 'workspace-a', audience: 'app', status: 'active'}],
      roles: [{id: 'editor-by-name-only', inherits: [], permissionIds: ['example.notes:read'], permissionOverrides: []}], assignments: [], overrides: []}};
  assert.deepEqual(projectWorkspaceAuthorization(state, catalog, permissions, 'workspace-a', 'app')?.viewIds, []);
  assert.equal(projectWorkspaceAuthorization(state, catalog, permissions, 'outside', 'app'), null);
  assert.equal(projectWorkspaceAuthorization(state, catalog, permissions, 'workspace-a', 'admin'), null);
});

test('real D1 workspace projection changes with ACL epoch, context, audience and session revocation', {timeout: 60000}, async () => {
  const models = JSON.parse(readFileSync(join(root, 'extensions/native/access/module/models.json'), 'utf8'));
  const schema = generateD1Schema('creezio.access', models);
  const bundled = await build({absWorkingDir: root, entryPoints: ['tests/workspace/authorization-worker.mjs'],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent'});
  const instance = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true, script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-15', d1Databases: {DB: 'creezio-workspace-authorization-synthetic'}});
  try {
    await instance.ready;
    const db = await instance.getD1Database('DB');
    await db.batch(schema.statements.map(statement => db.prepare(statement)));
    const call = async (method, ...args) => {
      const response = await instance.dispatchFetch('http://internal-workspace-authorization/', {method: 'POST',
        headers: {'content-type': 'application/json'}, body: JSON.stringify({method, args})});
      const body = await response.json();
      assert.equal(response.status, 200, body.error);
      return body.value;
    };
    const credentials = {loginIdentifier: 'workspace-authorization@example.invalid',
      displayName: 'Synthetic workspace operator', password: 'Synthetic workspace qualification password'};
    const created = await call('bootstrap', credentials); assert.equal(created.ok, true);
    const admin = await call('login', {loginIdentifier: credentials.loginIdentifier, password: credentials.password, audience: 'admin'});
    const app = await call('login', {loginIdentifier: credentials.loginIdentifier, password: credentials.password, audience: 'app'});
    assert.equal(admin.ok, true); assert.equal(app.ok, true);
    assert.deepEqual(await call('read', app.token, 'app', 'workspace-a'), {ok: false, error: 'unauthorized'});
    const grant = await call('grant', admin.token, created.principalId); assert.equal(grant.ok, true);
    const allowed = await call('read', app.token, 'app', 'workspace-a');
    assert.equal(allowed.ok, true);
    assert.deepEqual(allowed.projection, {sessionId: app.session.id, principalId: created.principalId,
      audience: 'app', contextId: 'workspace-a', compositionDigest: digest, epoch: grant.epoch,
      viewIds: ['example.notes:list'], navigationIds: ['example.notes:list-nav']});
    assert.deepEqual(await call('read', app.token, 'app', 'application'), {ok: false, error: 'unauthorized'});
    assert.deepEqual(await call('read', admin.token, 'admin', 'workspace-a'), {ok: false, error: 'unauthorized'});
    assert.deepEqual(await call('read', app.token, 'admin', 'workspace-a'), {ok: false, error: 'unauthorized'});
    const denial = await call('deny', admin.token, created.principalId); assert.equal(denial.ok, true);
    const narrowed = await call('read', app.token, 'app', 'workspace-a');
    assert.equal(narrowed.ok, true); assert.equal(narrowed.projection.epoch, denial.epoch);
    assert.deepEqual(narrowed.projection.viewIds, []); assert.deepEqual(narrowed.projection.navigationIds, []);
    await call('revoke', app.session.id);
    assert.deepEqual(await call('read', app.token, 'app', 'workspace-a'), {ok: false, error: 'unauthorized'});
  } finally { await instance.dispose(); }
});
