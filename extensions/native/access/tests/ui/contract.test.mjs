import test from 'node:test';
import assert from 'node:assert/strict';
import {build, transform} from 'esbuild';
import Ajv2020 from 'ajv/dist/2020.js';
import {fileURLToPath} from 'node:url';
import {manifest, read} from '../helpers.mjs';

test('Access contributes its native administration view and panel-scoped command state', () => {
  const [view] = manifest.contracts.ui.views;
  assert.equal(manifest.contracts.ui.views.length, 1);
  assert.equal(view.id, 'admin');
  assert.equal(view.route, '/admin/access');
  assert.deepEqual(view.surfaces, ['workspace']);
  assert.deepEqual(view.component, {path: 'ui/index.ts', export: 'AccessAdminView'});
  assert.deepEqual(view.permissions, [{moduleId: 'creezio.access', kind: 'permission', id: 'manage'}]);
  assert.deepEqual(view.panel.identityFields, []);
  const input = manifest.contracts.schemas.find(item => item.id === view.input.schemaId)?.schema;
  assert.deepEqual(input, {type: 'object', properties: {}, additionalProperties: false});
  assert.equal(view.panel.retention, 'preserve');
  assert.equal(view.panel.inactiveEffects, 'suspend');
  assert.equal(view.panel.stateSchema.schemaId, 'access-admin-panel-state');
  const state = manifest.contracts.schemas.find(item => item.id === 'access-admin-panel-state')?.schema;
  assert.ok(state);
  assert.equal(state.additionalProperties, false);
  assert.deepEqual(Object.keys(state.properties).sort(), ['pendingBindingId', 'pendingRequestKey']);
  assert.deepEqual(view.operations.map(item => item.id), ['policy.read', 'permissions.list', 'principals.list', 'sessions.list',
    'audit.list', 'audit.detail', 'policy.apply-delta', 'principals.set-human-status',
    'principals.revoke-sessions', 'sessions.revoke']);
  assert.equal(manifest.contracts.ui.navigation[0].view.id, 'admin');
  assert.equal(manifest.contracts.ui.navigation[0].id, 'admin-nav');
});

test('Access view opens from its route and navigation without a view input', async () => {
  const [declared] = manifest.contracts.ui.views;
  const schema = manifest.contracts.schemas.find(item => item.id === declared.input.schemaId).schema;
  const validateInput = new Ajv2020({strict: true, ownProperties: true}).compile(schema);
  const sdkEntry = fileURLToPath(new URL('../../../../../sdk/workspace/controller.ts', import.meta.url));
  const compiled = await build({entryPoints: [sdkEntry], bundle: true, platform: 'node', format: 'esm',
    write: false, logLevel: 'silent'});
  const sdk = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
  const session = {id: 'session-1', principalId: 'admin-1', audience: 'admin'};
  const access = {audience: 'admin', getSnapshot: () => ({phase: 'authenticated', pending: null, session}),
    subscribe: () => () => {}};
  const view = {id: 'creezio.access:admin', moduleId: 'creezio.access', title: declared.title,
    route: declared.route, surfaces: declared.surfaces, audiences: ['admin'], panel: declared.panel,
    validateInput, component: () => null};
  const controller = sdk.createWorkspaceController({access, views: [view], contextId: 'application'});
  controller.setProjection({sessionId: session.id, principalId: session.principalId, audience: 'admin',
    contextId: 'application', compositionDigest: `sha256-${'0'.repeat(64)}`, epoch: 1,
    viewIds: [view.id], navigationIds: ['creezio.access:admin-nav']});
  assert.equal(controller.open(view.id, {}), true);
  assert.equal(controller.getSnapshot().tabs[0].location.url, '/admin/access');
  assert.equal(controller.visit('/admin/access'), true);
  assert.equal(controller.visit('/admin/access?context_id=application'), false);
  controller.dispose();
});

test('original three panels compile through the public SDK without a private host import or direct fetch', async () => {
  const entry = read('ui/index.ts'), screen = read('ui/access-admin-client.tsx');
  const compiled = await Promise.all([
    transform(entry, {loader: 'ts', jsx: 'automatic'}),
    transform(screen, {loader: 'tsx', jsx: 'automatic'})
  ]);
  assert.ok(compiled.every(result => result.code.length > 0));
  for (const label of ['Matrice des rôles', 'Comptes', 'Journal', 'Enregistrer', 'Voir les changements'])
    assert.match(screen, new RegExp(label));
  assert.match(entry, /createAccessAdminController/);
  assert.match(screen, /controller\.applyDelta/);
  assert.match(screen, /controller\.setHumanStatus/);
  assert.match(screen, /controller\.revokeAllSessions/);
  assert.match(screen, /controller\.revokeSession/);
  assert.match(screen, /controller\.readAuditDetail/);
  assert.doesNotMatch(entry + screen, /@creezio\/shell-ui|admin\/workspace|fetch\(/);
});
