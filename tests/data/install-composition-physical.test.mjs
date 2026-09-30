import '../../scripts/local-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { compileCompositionSchema } from '../../scripts/data/composition-schema.mjs';
import { applyCompositionSchema, inspectCompositionSchema, SCHEMA_RECEIPT_TABLE } from '../../scripts/data/apply-schema.mjs';
import { inspectComposedInstallation, installComposed } from '../../scripts/data/install-composition.mjs';
import { contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { ACCESS_TABLES } from '../../core/identity/d1-store.ts';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const moduleId = 'example.data';
const credentials = { loginIdentifier: 'owner@example.invalid', displayName: 'Local owner',
  password: 'Synthetic local installation password' };

function planFor(nullable, { removed = false } = {}) {
  const composition = json('../../configuration/composition.json');
  const lock = json('../../configuration/composition.lock.json');
  lock.sdkVersion = composition.sdk.version;
  const access = json('../../extensions/native/access/module/manifest.json');
  const module = JSON.parse(JSON.stringify(access).replaceAll('creezio.access', moduleId));
  module.contracts.models = [{ id: 'items', title: 'Items', scope: 'application',
    fields: [
      { id: 'id', type: 'string', nullable: false, protected: true, computed: false },
      ...(nullable ? [{ id: 'note', type: 'string', nullable: true, protected: true, computed: false }] : []),
    ], primaryKey: ['id'], indexes: [], relations: [], permissions: [],
    deletion: { mode: 'hard', requiresApproval: false }, public: false }];
  module.contracts.schemas = []; module.contracts.permissions = []; module.contracts.operations = [];
  module.contracts.api = []; module.contracts.mcp = { tools: [], resources: [], prompts: [], skills: [] };
  module.contracts.ui = { ...module.contracts.ui, views: [], navigation: [], slots: [], styles: [] };
  const selection = { ...structuredClone(composition.modules[0]), moduleId };
  const pinned = { ...structuredClone(lock.modules[0]), moduleId, contractIntegrity: contractIntegrity(module) };
  composition.modules = removed ? [composition.modules[0]] : [composition.modules[0], selection];
  lock.modules = removed ? [lock.modules[0]] : [lock.modules[0], pinned];
  composition.exposure.admin.moduleIds = ['creezio.access'];
  composition.exposure.app.moduleIds = ['creezio.access'];
  lock.compositionIntegrity = contractIntegrity(composition);
  return compileCompositionSchema({ composition, lock, modules: removed ? [access] : [access, module] });
}

const apply = (db, plan) => applyCompositionSchema(db, plan, { expectedPlanDigest: plan.planDigest });

test('local installer guards the exact physical schema after additive ALTER', async t => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status:404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: ['INITIALIZED', 'UNCLAIMED', 'READ_FAULT', 'RETIRED'], d1Persist: false });
  try {
    const oldPlan = planFor(false), nextPlan = planFor(true);
    await t.test('an initialized installation remains recognized and closed', async () => {
      const db = await mf.getD1Database('INITIALIZED');
      const installed = await installComposed(db, oldPlan,
        { credentials, expectedPlanDigest: oldPlan.planDigest, createSchema: true });
      assert.equal(installed.ok, true, JSON.stringify(installed));
      assert.equal((await apply(db, nextPlan)).ok, true);
      assert.equal((await inspectCompositionSchema(db, nextPlan)).state, 'ready');
      assert.equal((await inspectComposedInstallation(db, nextPlan)).state, 'initialized');
      const repeated = await installComposed(db, nextPlan,
        { credentials, expectedPlanDigest: nextPlan.planDigest, createSchema: false });
      assert.equal(repeated.ok, false);
      assert.equal(repeated.code, 'already_initialized');
    });
    await t.test('an unclaimed installation can bootstrap after the column migration', async () => {
      const db = await mf.getD1Database('UNCLAIMED');
      assert.equal((await apply(db, oldPlan)).ok, true);
      assert.equal((await apply(db, nextPlan)).ok, true);
      assert.equal((await inspectComposedInstallation(db, nextPlan)).state, 'schema_ready');
      const installed = await installComposed(db, nextPlan,
        { credentials, expectedPlanDigest: nextPlan.planDigest, createSchema: false });
      assert.equal(installed.ok, true, JSON.stringify(installed));
      assert.equal((await inspectComposedInstallation(db, nextPlan)).state, 'initialized');
    });
    await t.test('a read failure between inspections returns unavailable without bootstrap writes', async () => {
      const db = await mf.getD1Database('READ_FAULT');
      assert.equal((await apply(db, oldPlan)).ok, true);
      assert.equal((await apply(db, nextPlan)).ok, true);
      const receipt = (await db.prepare(`SELECT id FROM ${SCHEMA_RECEIPT_TABLE} ORDER BY sequence DESC LIMIT 1`).first()).id;
      const fault = () => {
        let batches = 0;
        return { prepare: sql => db.prepare(sql), batch: statements => {
          if (++batches === 3) throw new Error('synthetic guarded read outage');
          return db.batch(statements);
        } };
      };
      assert.equal((await inspectComposedInstallation(fault(), nextPlan)).state, 'unavailable');
      const attempted = await installComposed(fault(), nextPlan,
        { credentials, expectedPlanDigest: nextPlan.planDigest, createSchema: false });
      assert.equal(attempted.ok, false);
      assert.equal(attempted.effect, 'none');
      assert.equal((await db.prepare(`SELECT id FROM ${SCHEMA_RECEIPT_TABLE} ORDER BY sequence DESC LIMIT 1`).first()).id, receipt);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n, 0);
    });
    await t.test('a retained table from a removed module prevents bootstrap when it holds a row', async () => {
      const db = await mf.getD1Database('RETIRED');
      const removedPlan = planFor(false, { removed: true });
      const itemTable = oldPlan.runtimeCatalog.modules.find(item => item.moduleId === moduleId).models[0].table;
      assert.equal((await apply(db, oldPlan)).ok, true);
      await db.prepare(`INSERT INTO "${itemTable}" (id) VALUES ('preserved')`).run();
      assert.equal((await apply(db, removedPlan)).ok, true);
      assert.equal((await inspectCompositionSchema(db, removedPlan)).state, 'ready');
      const inspected = await inspectComposedInstallation(db, removedPlan);
      assert.equal(inspected.state, 'blocked');
      assert.equal(inspected.code, 'foreign_data');
      const attempted = await installComposed(db, removedPlan,
        { credentials, expectedPlanDigest: removedPlan.planDigest, createSchema: false });
      assert.equal(attempted.ok, false);
      assert.equal(attempted.effect, 'none');
      assert.equal((await db.prepare(`SELECT id FROM "${itemTable}" LIMIT 1`).first()).id, 'preserved');
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${ACCESS_TABLES.principals}"`).first()).n, 0);
    });
  } finally { await mf.dispose(); }
});
