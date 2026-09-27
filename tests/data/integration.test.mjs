import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { loadAccessInstallPlan } from '../../scripts/data/install-access.mjs';
import { generateD1Schema } from '../../scripts/data/d1-schema.mjs';
import { createAccountService, provisionBootstrapCapability } from '../../core/identity/accounts.ts';
import { createAuthorizationService } from '../../core/authorization/service.ts';
import { createDataAccess } from '../../core/data/service.ts';

// Independently authored integration: real D1 and native services, not an
// alternative authorization implementation or an application composition.
const moduleId = 'example.data';
const field = (id, type = 'string', protectedField = false) => ({
  id, type, nullable: false, protected: protectedField, computed: false,
});
const model = {
  id: 'record', title: 'Synthetic record', scope: 'context', contextField: 'context_id',
  fields: [field('context_id', 'string', true), field('id'), field('title'),
    { ...field('revision', 'integer'), constraints: { minimum: 0 } }],
  primaryKey: ['context_id', 'id'], indexes: [], relations: [],
  permissions: [{ moduleId, kind: 'permission', id: 'manage-records' }],
  deletion: { mode: 'hard', requiresApproval: false }, public: false,
};
const declaration = { id: 'manage-records', title: 'Synthetic record operations',
  audiences: ['admin', 'app'], actors: ['user', 'machine', 'impersonated-user'],
  scopes: ['records'], context: 'required', default: 'deny',
  resources: [{ moduleId, kind: 'model', id: 'record' }],
  actions: ['read', 'create', 'update', 'delete'], enforcement: { request: true, commit: true }, public: false };
const permissions = [{ id: `${moduleId}:manage-records`, audiences: declaration.audiences, actors: declaration.actors }];
const generated = generateD1Schema(moduleId, [model]);
const catalog = { schemaVersion: 1, compositionDigest: `sha256-${'a'.repeat(64)}`, modules: [
  { moduleId, version: '1.0.0', enabled: true, permissions: [declaration],
    models: [{ modelId: model.id, table: generated.tables.record, model }] },
] };
const target = contextId => ({ contextId, audience: 'admin', actors: ['user'],
  requiredPermissionIds: permissions.map(p => p.id), purpose: 'operation' });

test('native accounts and the composed data port preserve context and atomic authorization', { timeout: 45000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const bundle = await build({ absWorkingDir: root, entryPoints: ['tests/data/harness/worker.mjs'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const output of Object.values(bundle.metafile.outputs)) assert.deepEqual(output.imports, []);
  const runtime = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: bundle.outputFiles[0].text,
    bindings: { CATALOG: catalog, PERMISSIONS: permissions },
    d1Databases: { DB: 'creezio-data-independent-qualification' } });
  try {
    const db = await runtime.getD1Database('DB');
    const accessPlan = loadAccessInstallPlan(root);
    await db.batch([...accessPlan.statements, ...generated.statements].map(sql => db.prepare(sql)));
    const accounts = createAccountService(db);
    const bootstrap = await provisionBootstrapCapability(db);
    assert.ok(bootstrap);
    const credentials = { loginIdentifier: 'data-test@example.invalid', displayName: 'Synthetic data operator',
      password: 'Synthetic independent D1 qualification password' };
    const installed = await accounts.bootstrap({ ...credentials, token: bootstrap.token });
    assert.equal(installed.ok, true);
    const signedIn = await accounts.login({ loginIdentifier: credentials.loginIdentifier,
      password: credentials.password, audience: 'admin' });
    assert.equal(signedIn.ok, true);
    const token = signedIn.token;
    const authorization = createAuthorizationService(db, { permissions });
    const current = await authorization.readPolicy(token);
    assert.equal(current.ok, true);
    const policy = structuredClone(current.policy);
    policy.roles.push({ id: 'data-editor', inherits: [], permissionIds: permissions.map(p => p.id), permissionOverrides: [] });
    for (const contextId of ['context-x', 'context-y']) {
      policy.contexts.push({ id: contextId, status: 'active' });
      policy.memberships.push({ principalId: installed.principalId, contextId, audience: 'admin', status: 'active' });
      policy.assignments.push({ principalId: installed.principalId, contextId, audience: 'admin', roleId: 'data-editor' });
    }
    assert.equal((await authorization.replacePolicy(token, { expectedEpoch: current.epoch, policy })).ok, true);
    const data = createDataAccess(db, { catalog, permissions });
    const credential = { kind: 'session', token };
    const fresh = async contextId => {
      const lease = await data.authorize(credential, target(contextId), { moduleId });
      return { lease, port: data.forModule(lease, moduleId) };
    };

    await t.test('same primary identifier is isolated by the server context', async () => {
      const x = await fresh('context-x'), y = await fresh('context-y');
      await x.port.create('record', { values: { id: 'shared-id', title: 'X only', revision: 0 } });
      await y.port.create('record', { values: { id: 'shared-id', title: 'Y only', revision: 0 } });
      assert.equal((await x.port.get('record', { key: { id: 'shared-id' } })).title, 'X only');
      assert.equal((await y.port.list('record', { limit: 1 })).items[0].title, 'Y only');
      await assert.rejects(() => data.authorize(credential, target('context-z'), { moduleId }));
      assert.throws(() => x.port.planCreate('record', { values: { context_id: 'context-y', id: 'injected', title: 'bad', revision: 0 } }));
    });
    await t.test('planned inputs are captured and a late CAS conflict rolls back the entire batch', async () => {
      const { lease, port } = await fresh('context-x');
      const input = { key: { id: 'shared-id' }, values: { title: 'captured' }, compare: { field: 'revision', expected: 0 } };
      const first = port.planPatch('record', input);
      input.values.title = 'changed after validation';
      input.compare.expected = 99;
      await data.commitBatch(lease, [first]);
      assert.equal((await port.get('record', { key: { id: 'shared-id' } })).title, 'captured');
      const create = port.planCreate('record', { values: { id: 'must-rollback', title: 'not committed', revision: 0 } });
      const stale = port.planPatch('record', { key: { id: 'shared-id' }, values: { title: 'stale' }, compare: { field: 'revision', expected: 0 } });
      await assert.rejects(() => data.commitBatch(lease, [create, stale]));
      assert.equal(await port.get('record', { key: { id: 'must-rollback' } }), null);
      assert.equal((await port.get('record', { key: { id: 'shared-id' } })).title, 'captured');
    });
    await t.test('opaque capabilities cannot cross module or service instances', async () => {
      const { lease, port } = await fresh('context-x');
      assert.throws(() => data.forModule({ kind: 'data-lease' }, moduleId));
      assert.throws(() => data.forModule(lease, 'example.other'));
      const other = createDataAccess(db, { catalog, permissions });
      assert.throws(() => other.forModule(lease, moduleId));
      const plan = port.planGet('record', { key: { id: 'shared-id' } });
      await assert.rejects(() => data.readBatch(lease, [{ ...plan }]));
    });
    await t.test('the same data guard and vault encryption execute inside workerd', async () => {
      const response = await runtime.dispatchFetch('http://qualification.invalid/', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { title: 'captured', roundtrip: true,
        wrongContextRefused: true, plaintextAbsentFromEnvelope: true });
    });
    await t.test('revocation between planning and commit prevents every effect and read', async () => {
      const { lease, port } = await fresh('context-x');
      const plan = port.planCreate('record', { values: { id: 'revoked-write', title: 'not committed', revision: 0 } });
      assert.equal(await accounts.logout(token, 'admin'), true);
      await assert.rejects(() => data.commitBatch(lease, [plan]));
      await assert.rejects(() => port.get('record', { key: { id: 'shared-id' } }));
      assert.equal(await db.prepare(`SELECT count(*) AS total FROM "${generated.tables.record}" WHERE id=?`).bind('revoked-write').first('total'), 0);
    });
  } finally { await runtime.dispose(); }
});
