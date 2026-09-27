import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileCompositionSchema, loadCompositionSchema } from '../../scripts/data/composition-schema.mjs';
import { contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { describeD1Schema } from '../../scripts/data/d1-schema.mjs';
import { OPERATION_STORAGE_MODULE_ID, OPERATION_MODELS } from '../../core/operations/models.ts';

const json = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const hostObjects = describeD1Schema(OPERATION_STORAGE_MODULE_ID, OPERATION_MODELS).objects.length;
function inputs() {
  return { composition: json('../../configuration/composition.json'), lock: json('../../configuration/composition.lock.json'),
    modules: [json('../../extensions/native/access/module/manifest.json')] };
}
function relock(input) {
  input.lock.compositionIntegrity = contractIntegrity(input.composition);
  for (const module of input.modules) input.lock.modules.find(item => item.moduleId === module.identity.id).contractIntegrity = contractIntegrity(module);
  return input;
}

test('composed compiler reuses exact central Access SQL definitions and freezes the runtime projection', async () => {
  const input = inputs(), plan = compileCompositionSchema(input);
  assert.equal(plan.runtimeCatalog.modules[0].models.length, 28);
  assert.equal(plan.objects.length, 74 + hostObjects);
  assert.equal(plan.host.moduleId, OPERATION_STORAGE_MODULE_ID);
  assert.equal(plan.host.models.length, 4);
  assert.equal(plan.runtimeCatalog.modules.some(module => module.moduleId === OPERATION_STORAGE_MODULE_ID), false);
  assert.equal(plan.runtimeCatalog.modules[0].permissions.length, 2);
  assert.deepEqual(plan.runtimeCatalog.modules[0].permissions, input.modules[0].contracts.permissions);
  assert.ok(Object.isFrozen(plan.runtimeCatalog.modules[0].models[0].model.fields[0]));
  input.modules[0].contracts.models[0].fields[0].nullable = true;
  assert.equal(plan.runtimeCatalog.modules[0].models[0].model.fields[0].nullable, false);
  assert.equal((await loadCompositionSchema({ root: fileURLToPath(new URL('../../', import.meta.url)) })).planDigest, plan.planDigest);
});

test('disabled selection preserves data declarations while the catalog closes its runtime port', () => {
  const input = inputs(); input.composition.modules[0].enabled = false;
  input.composition.exposure.admin.moduleIds = []; input.composition.exposure.app.moduleIds = [];
  const plan = compileCompositionSchema(relock(input));
  assert.equal(plan.runtimeCatalog.modules[0].enabled, false);
  assert.equal(plan.objects.length, 74 + hostObjects);
});

test('empty composition is explicit and still locked', () => {
  const input = inputs(); input.composition.modules = []; input.modules = []; input.lock.modules = [];
  input.composition.exposure.admin.moduleIds = []; input.composition.exposure.app.moduleIds = [];
  const plan = compileCompositionSchema(relock(input));
  assert.equal(plan.objects.length, hostObjects); assert.deepEqual(plan.runtimeCatalog.modules, []);
  assert.throws(() => compileCompositionSchema({ ...input, lock: undefined }), { code: 'schema.composition' });
});

test('the technical runtime namespace cannot be selected or exposed as a product module', () => {
  const input = inputs();
  const renamed = JSON.parse(JSON.stringify(input).replaceAll('creezio.access', OPERATION_STORAGE_MODULE_ID));
  assert.throws(() => compileCompositionSchema(relock(renamed)), { code: 'schema.reserved-module' });
});

test('stale lock, malformed model and unsupported SQL capabilities fail instead of producing partial plans', () => {
  const input = inputs(); input.modules[0].contracts.models[0].title += ' changed';
  assert.throws(() => compileCompositionSchema(input), { code: 'schema.composition' });
  input.modules[0].contracts.models[0].fields[0].computed = true;
  assert.throws(() => compileCompositionSchema(relock(input)), { code: 'sql.unsupported-computed' });
  input.modules[0].contracts.models[0].fields[0].computed = false;
  input.modules[0].contracts.models[0].fields[0].constraints = { pattern: '^x$' };
  assert.throws(() => compileCompositionSchema(relock(input)), { code: 'sql.unsupported-pattern' });
});

test('schema object order is deterministic under declaration reordering and output names are injective', () => {
  const input = inputs(), first = compileCompositionSchema(input);
  input.modules[0].contracts.models.reverse();
  for (const model of input.modules[0].contracts.models) { model.fields.reverse(); model.indexes.reverse(); model.relations.reverse(); }
  const second = compileCompositionSchema(relock(input));
  assert.equal(second.sqlDigest, first.sqlDigest);
  assert.equal(new Set(first.objects.map(object => object.name)).size, first.objects.length);
});

test('contract accessors are rejected without calling them', () => {
  const input = inputs(); let called = false;
  Object.defineProperty(input.modules[0].contracts.models[0], 'title', { enumerable: true, get() { called = true; return 'bad'; } });
  assert.throws(() => compileCompositionSchema(input), { code: 'schema.composition' }); assert.equal(called, false);
});
