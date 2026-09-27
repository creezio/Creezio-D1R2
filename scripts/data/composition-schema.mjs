import { createHash } from 'node:crypto';
import { describeD1Schema } from './d1-schema.mjs';
import { validateComposition, canonicalJson, contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { OPERATION_STORAGE_MODULE_ID, OPERATION_MODELS, OPERATION_TABLES } from '../../core/operations/models.ts';

const approved = new WeakSet();
const compareModelId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const SCHEMA_LIMITS = Object.freeze({ objects: 1024, bytes: 1024 * 1024, receipts: 256 });
export const schemaDigest = value => `sha256-${createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')}`;
export const normalizeSchemaSql = sql => sql.trim().replace(/;$/, '').trimEnd();
export function freezeSchemaValue(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeSchemaValue(child); Object.freeze(value); }
  return value;
}
export class CompositionSchemaError extends Error {
  constructor(code, message, diagnostics = []) { super(message); this.name = 'CompositionSchemaError'; this.code = code; this.diagnostics = diagnostics; }
}
const fail = (code, message, diagnostics) => { throw new CompositionSchemaError(code, message, diagnostics); };
export const isCompositionSchemaPlan = value => approved.has(value);

/** Pure, build-time compilation. All descriptors, including disabled modules, require the exact
 * composition lock. Only current-model CREATE statements are emitted; no module code is loaded. */
export function compileCompositionSchema(input) {
  let composition, modules, lock;
  try {
    if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw 0;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== 3 || ['composition', 'modules', 'lock'].some(name => !Object.hasOwn(descriptors[name] ?? {}, 'value'))) throw 0;
    ({ composition, modules, lock } = Object.fromEntries(Object.entries(descriptors).map(([name, descriptor]) => [name, descriptor.value])));
  } catch { fail('schema.composition', 'An inert composition, descriptor collection and lock are required.'); }
  const validation = validateComposition(composition, { modules, lock });
  if (validation.errors.length) fail('schema.composition', 'Composition and lock are not valid.', validation.errors);
  const copy = JSON.parse(canonicalJson({ composition, modules, lock }));
  if (copy.modules.some(module => module.identity.id === OPERATION_STORAGE_MODULE_ID))
    fail('schema.reserved-module', 'The technical runtime namespace is reserved to the host.');
  const byId = new Map(copy.modules.map(module => [module.identity.id, module]));
  const technical = describeD1Schema(OPERATION_STORAGE_MODULE_ID, OPERATION_MODELS);
  if (Object.keys(technical.tables).length !== Object.keys(OPERATION_TABLES).length
    || Object.entries(OPERATION_TABLES).some(([id, table]) => technical.tables[id] !== table))
    fail('schema.host-tables', 'Host operation table mappings differ from the canonical compiler.');
  const host = { moduleId: OPERATION_STORAGE_MODULE_ID, models: [...OPERATION_MODELS].sort((a, b) => compareModelId(a.id, b.id))
    .map(model => ({ modelId: model.id, table: technical.tables[model.id], model: JSON.parse(canonicalJson(model)) })) };
  const objects = technical.objects.map(object => ({ ...object, sql: normalizeSchemaSql(object.sql) })), entries = [];
  for (const selection of [...copy.composition.modules].sort((a, b) => a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0)) {
    const descriptor = byId.get(selection.moduleId), models = descriptor.contracts.models;
    const generated = describeD1Schema(selection.moduleId, models);
    for (const object of generated.objects) objects.push({ ...object, sql: normalizeSchemaSql(object.sql) });
    entries.push({ moduleId: selection.moduleId, version: descriptor.identity.version, enabled: selection.enabled,
      permissions: descriptor.contracts.permissions,
      models: [...models].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        .map(model => ({ modelId: model.id, table: generated.tables[model.id], model })) });
  }
  objects.sort((a, b) => a.type === b.type ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.type === 'table' ? -1 : 1);
  if (objects.length > SCHEMA_LIMITS.objects || Buffer.byteLength(canonicalJson(objects)) > SCHEMA_LIMITS.bytes)
    fail('schema.limit', 'Composed schema exceeds the qualified inspection bound.');
  if (new Set(objects.map(object => object.name)).size !== objects.length) fail('schema.collision', 'Composed SQL object names collide.');
  const compositionDigest = contractIntegrity(copy.composition);
  const runtimeCatalog = { schemaVersion: 1, compositionDigest, modules: entries };
  const modelDigest = schemaDigest({ host, modules: entries }), statements = objects.map(object => object.sql + ';');
  const sql = `-- Creezio composed D1 creation v1\n-- Inspect before applying. No destructive changes or automatic repair.\n\n${statements.join('\n\n')}${statements.length ? '\n' : ''}`;
  const data = { schemaVersion: 1, applicationId: copy.composition.application.id, compositionDigest,
    lockDigest: contractIntegrity(copy.lock), modelDigest, sqlDigest: schemaDigest(sql), sql, statements, objects, host, runtimeCatalog };
  const plan = freezeSchemaValue({ ...data, planDigest: schemaDigest(data) });
  approved.add(plan);
  return plan;
}

/** Read-only local loading shares the runtime resolver. The dynamic import avoids a cycle with
 * the build generator, which imports only the pure compiler above. Recheck captured declarations. */
export async function loadCompositionSchema(options = {}) {
  const { loadRuntimeComposition } = await import('../build/compose-runtime.mjs');
  const loaded = loadRuntimeComposition(options);
  const plan = compileCompositionSchema({ composition: loaded.composition, lock: loaded.lock,
    modules: loaded.located.map(item => item.descriptor) });
  // The second resolver run repeats confinement and catches a changed composition/module/lock.
  const fresh = loadRuntimeComposition(options);
  if (contractIntegrity(fresh.composition) !== plan.compositionDigest || contractIntegrity(fresh.lock) !== plan.lockDigest
    || canonicalJson(fresh.located.map(item => item.descriptor)) !== canonicalJson(loaded.located.map(item => item.descriptor)))
    fail('schema.source-changed', 'Schema inputs changed while loading.');
  return plan;
}
