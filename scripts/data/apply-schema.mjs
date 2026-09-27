import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../sdk/contracts/validate.mjs';
import { inspectJson } from '../../sdk/contracts/load.mjs';
import { isCompositionSchemaPlan, SCHEMA_LIMITS, schemaDigest, normalizeSchemaSql, freezeSchemaValue } from './composition-schema.mjs';

// Host-owned receipt storage, never a module script or a runtime startup side effect.
export const SCHEMA_RECEIPT_TABLE = 'cz_schema_receipts';
const RECEIPT_SQL = `CREATE TABLE "${SCHEMA_RECEIPT_TABLE}" (
  sequence INTEGER NOT NULL CHECK (typeof(sequence) = 'integer' AND sequence BETWEEN 1 AND ${SCHEMA_LIMITS.receipts}),
  id TEXT NOT NULL CHECK (typeof(id) = 'text' AND length(id) = 71),
  previous_id TEXT CHECK (previous_id IS NULL OR (typeof(previous_id) = 'text' AND length(previous_id) = 71)),
  payload TEXT NOT NULL CHECK (typeof(payload) = 'text' AND json_valid(payload) = 1 AND length(CAST(payload AS BLOB)) <= ${SCHEMA_LIMITS.bytes + 4096}),
  PRIMARY KEY (sequence)
) WITHOUT ROWID`;
export const SCHEMA_RECEIPT_OBJECT = Object.freeze({ type: 'table', name: SCHEMA_RECEIPT_TABLE, table: SCHEMA_RECEIPT_TABLE, sql: RECEIPT_SQL });
// Exact optional provider definition qualified in the local D1 profile, including lazy creation.
export const D1_INTERNAL_SCHEMA_OBJECTS = Object.freeze([Object.freeze({ type: 'table', name: '_cf_METADATA', table: '_cf_METADATA',
  sql: 'CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )' })]);
const HASH = /^sha256-[a-f0-9]{64}$/;
const quote = name => `"${name.replaceAll('"', '""')}"`;
const key = object => `${object.type}:${object.name}`;
const same = (a, b) => a.type === b.type && a.name === b.name && a.table === b.table && a.sql === b.sql;
function checkedRows(result) {
  if (!result || result.success !== true || !Array.isArray(result.results)) throw new Error('Schema storage unavailable.');
  return result.results;
}
function checkedBatch(results, count) {
  if (!Array.isArray(results) || results.length !== count) throw new Error('Schema storage unavailable.');
  for (const result of results) checkedRows(result);
  return results;
}
function exactKeys(value, names) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}
const publicState = (state, code, plan, additions = [], receiptId = null) => freezeSchemaValue({ state, code,
  planDigest: isCompositionSchemaPlan(plan) ? plan.planDigest : null, additions: additions.map(object => ({ type: object.type, name: object.name })), receiptId });

/** Exact schema guard in the mutation batch. Receipt SQL from the database is never executed.
 * A mismatch raises a SQLite error, so D1 rolls back every statement in the batch. */
export function managedSchemaGuard(db, objects) {
  return db.prepare(`WITH expected AS (
    SELECT json_extract(value, '$.type') AS type, json_extract(value, '$.name') AS name,
      json_extract(value, '$.table') AS tbl_name, json_extract(value, '$.sql') AS sql FROM json_each(?)
  ), internal AS (
    SELECT json_extract(value, '$.type') AS type, json_extract(value, '$.name') AS name,
      json_extract(value, '$.table') AS tbl_name, json_extract(value, '$.sql') AS sql FROM json_each(?)
  ), actual AS (
    SELECT s.type, s.name, s.tbl_name, s.sql FROM sqlite_schema s WHERE NOT EXISTS (
      SELECT 1 FROM internal i WHERE s.type IS i.type AND s.name IS i.name AND s.tbl_name IS i.tbl_name AND s.sql IS i.sql)
  ) SELECT CASE WHEN (SELECT COUNT(*) FROM actual) = (SELECT COUNT(*) FROM expected)
    AND NOT EXISTS (SELECT 1 FROM expected e LEFT JOIN actual s ON s.name = e.name
      WHERE s.name IS NULL OR s.type IS NOT e.type OR s.tbl_name IS NOT e.tbl_name OR s.sql IS NOT e.sql)
    THEN 1 ELSE json('creezio-schema-guard-failed') END AS approved`)
    .bind(canonicalJson(objects), canonicalJson(D1_INTERNAL_SCHEMA_OBJECTS));
}

function validObjects(objects) {
  if (!Array.isArray(objects) || objects.length > SCHEMA_LIMITS.objects || Buffer.byteLength(canonicalJson(objects)) > SCHEMA_LIMITS.bytes) return false;
  const names = new Set(), tables = new Set(objects.filter(object => object?.type === 'table').map(object => object.name));
  for (const object of objects) {
    if (!exactKeys(object, ['type', 'name', 'table', 'sql']) || !['table', 'index'].includes(object.type)
      || typeof object.name !== 'string' || !/^cz_[a-f0-9]+_[a-f0-9]+(?:_idx_[a-f0-9]+)?$/.test(object.name)
      || typeof object.table !== 'string' || !/^cz_[a-f0-9]+_[a-f0-9]+$/.test(object.table)
      || !tables.has(object.table) || names.has(object.name) || typeof object.sql !== 'string'
      || Buffer.byteLength(object.sql) > 100000 || object.sql !== normalizeSchemaSql(object.sql)
      || (object.type === 'table' && object.name !== object.table)) return false;
    names.add(object.name);
  }
  return true;
}

async function readManaged(db) {
  const size = checkedRows(await db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(sql AS BLOB))), 0) AS bytes FROM sqlite_schema').all());
  if (size.length !== 1 || !Number.isSafeInteger(size[0].count) || !Number.isSafeInteger(size[0].bytes)
    || size[0].count > SCHEMA_LIMITS.objects + D1_INTERNAL_SCHEMA_OBJECTS.length + 1 || size[0].bytes > SCHEMA_LIMITS.bytes + 4096)
    return { ok: false, code: 'schema.limit' };
  const observed = checkedRows(await db.prepare(`SELECT type, name, tbl_name, CASE WHEN
    (SELECT COALESCE(SUM(length(CAST(sql AS BLOB))), 0) FROM sqlite_schema) <= ? THEN sql ELSE NULL END AS sql
    FROM sqlite_schema ORDER BY type, name LIMIT ?`)
    .bind(SCHEMA_LIMITS.bytes + 4096, SCHEMA_LIMITS.objects + D1_INTERNAL_SCHEMA_OBJECTS.length + 2).all());
  const actual = [];
  for (const row of observed) {
    if (D1_INTERNAL_SCHEMA_OBJECTS.some(object => row?.type === object.type && row.name === object.name && row.tbl_name === object.table && row.sql === object.sql)) continue;
    if (!row || !['table', 'index'].includes(row.type) || typeof row.name !== 'string' || typeof row.tbl_name !== 'string' || typeof row.sql !== 'string')
      return { ok: false, code: 'schema.foreign' };
    actual.push({ type: row.type, name: row.name, table: row.tbl_name, sql: normalizeSchemaSql(row.sql) });
  }
  if (actual.length > SCHEMA_LIMITS.objects + 1) return { ok: false, code: 'schema.limit' };
  const receiptTable = actual.find(object => object.name === SCHEMA_RECEIPT_TABLE);
  if (!receiptTable) return { ok: true, objects: actual, receipt: null, receiptId: null, headers: [] };
  if (!same(receiptTable, SCHEMA_RECEIPT_OBJECT)) return { ok: false, code: 'schema.receipt-definition' };
  const batch = checkedBatch(await db.batch([managedSchemaGuard(db, actual),
    db.prepare(`SELECT sequence, id, previous_id AS previousId FROM ${quote(SCHEMA_RECEIPT_TABLE)} ORDER BY sequence LIMIT ?`).bind(SCHEMA_LIMITS.receipts + 1),
    db.prepare(`SELECT payload FROM ${quote(SCHEMA_RECEIPT_TABLE)} ORDER BY sequence DESC LIMIT 1`),
  ]), 3);
  const headers = checkedRows(batch[1]), payloads = checkedRows(batch[2]);
  if (!headers.length || headers.length > SCHEMA_LIMITS.receipts || payloads.length !== 1) return { ok: false, code: 'schema.receipt-invalid' };
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (header.sequence !== i + 1 || typeof header.id !== 'string' || !HASH.test(header.id)
      || header.previousId !== (i ? headers[i - 1].id : null)) return { ok: false, code: 'schema.receipt-chain' };
  }
  const payload = payloads[0].payload;
  if (typeof payload !== 'string' || Buffer.byteLength(payload) > SCHEMA_LIMITS.bytes + 4096) return { ok: false, code: 'schema.receipt-limit' };
  let receipt;
  try { receipt = JSON.parse(payload); } catch { return { ok: false, code: 'schema.receipt-invalid' }; }
  if (inspectJson(receipt, { maxBytes: SCHEMA_LIMITS.bytes + 4096, maxNodes: 30000, maxDepth: 12 }).errors.length
    || !exactKeys(receipt, ['schemaVersion', 'applicationId', 'sequence', 'previousId', 'nonce', 'compositionDigest', 'modelDigest', 'sqlDigest', 'planDigest', 'objects'])
    || receipt.schemaVersion !== 1 || typeof receipt.applicationId !== 'string' || receipt.applicationId.length > 128
    || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(receipt.applicationId)
    || receipt.sequence !== headers.length || receipt.previousId !== headers.at(-1).previousId
    || typeof receipt.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(receipt.nonce)
    || ['compositionDigest', 'modelDigest', 'sqlDigest', 'planDigest'].some(field => typeof receipt[field] !== 'string' || !HASH.test(receipt[field]))
    || !validObjects(receipt.objects) || payload !== canonicalJson(receipt) || schemaDigest(payload) !== headers.at(-1).id)
    return { ok: false, code: 'schema.receipt-invalid' };
  const expected = [...receipt.objects, SCHEMA_RECEIPT_OBJECT];
  if (expected.length !== actual.length || actual.some(object => !expected.some(wanted => same(object, wanted)))) return { ok: false, code: 'schema.drift' };
  return { ok: true, objects: actual, receipt, receiptId: headers.at(-1).id, headers };
}

/** Inspection used also by the closed Access installer. Does not approve an unconsumed bootstrap.
 * Receipt integrity detects inconsistency; it is not a signature or protection against a DBA. */
export async function inspectManagedSchema(db) {
  try { const state = await readManaged(db); return state.ok ? freezeSchemaValue(state) : freezeSchemaValue({ ok: false, code: state.code }); }
  catch { return Object.freeze({ ok: false, code: 'schema.unavailable' }); }
}

async function inspect(db, plan) {
  if (!isCompositionSchemaPlan(plan)) return { public: publicState('blocked', 'schema.invalid-plan', plan) };
  try {
    const current = await readManaged(db);
    if (!current.ok) return { public: publicState('blocked', current.code, plan) };
    if (current.receipt && current.receipt.applicationId !== plan.applicationId) return { public: publicState('blocked', 'schema.application', plan) };
    const previous = current.receipt?.objects ?? current.objects;
    const byName = new Map(previous.map(object => [object.name, object]));
    const wanted = new Map(plan.objects.map(object => [object.name, object]));
    if (!current.receipt) {
      // Initial adoption accepts only whole, exact currently approved module schemas. A partial
      // namespace is never silently repaired; unrecognized objects are never adopted by name.
      for (const object of previous) if (!wanted.has(object.name) || !same(object, wanted.get(object.name)))
        return { public: publicState('blocked', 'schema.foreign', plan) };
      for (const module of [...plan.runtimeCatalog.modules, plan.host]) {
        const tables = new Set(module.models.map(item => item.table));
        const moduleObjects = plan.objects.filter(object => tables.has(object.table));
        if (moduleObjects.some(object => byName.has(object.name)) && moduleObjects.some(object => !byName.has(object.name)))
          return { public: publicState('blocked', 'schema.partial', plan) };
      }
    }
    const additions = [];
    for (const object of plan.objects) {
      const old = byName.get(object.name);
      if (old && !same(old, object)) return { public: publicState('blocked', 'schema.incompatible', plan) };
      if (!old) additions.push(object);
    }
    const objects = [...previous, ...additions].sort((a, b) => a.type === b.type ? a.name < b.name ? -1 : a.name > b.name ? 1 : 0 : a.type === 'table' ? -1 : 1);
    if (!validObjects(objects)) return { public: publicState('blocked', 'schema.limit', plan) };
    const ready = current.receipt?.planDigest === plan.planDigest && additions.length === 0;
    if (!ready && current.headers.length >= SCHEMA_LIMITS.receipts) return { public: publicState('blocked', 'schema.receipt-limit', plan) };
    return { public: publicState(ready ? 'ready' : 'additive', ready ? 'schema.current' : 'schema.approval-required', plan, additions, current.receiptId), current, objects, additions };
  } catch { return { public: publicState('unavailable', 'schema.unavailable', plan) }; }
}

export async function inspectCompositionSchema(db, plan) { return (await inspect(db, plan)).public; }

function receiptGuard(db, current) {
  return db.prepare(`SELECT CASE WHEN COUNT(*) = ? AND COALESCE(MAX(sequence), 0) = ?
    AND (? IS NULL OR EXISTS (SELECT 1 FROM ${quote(SCHEMA_RECEIPT_TABLE)} WHERE sequence = ? AND id = ? AND payload = ?))
    THEN 1 ELSE json('creezio-receipt-guard-failed') END AS approved FROM ${quote(SCHEMA_RECEIPT_TABLE)}`)
    .bind(current.headers.length, current.headers.length, current.receiptId, current.headers.length, current.receiptId,
      current.receipt ? canonicalJson(current.receipt) : null);
}

/** Operator-only additive publication. Approval binds the exact compiled plan; a previous receipt
 * is preserved and rechecked in the DDL batch. A lost acknowledgement is inspected once, never retried. */
export async function applyCompositionSchema(db, plan, options) {
  let approval;
  try { const descriptors = Object.getOwnPropertyDescriptors(options); if (Reflect.ownKeys(descriptors).length !== 1 || !Object.hasOwn(descriptors.expectedPlanDigest ?? {}, 'value')) throw 0;
    approval = descriptors.expectedPlanDigest.value; } catch { approval = null; }
  const outcome = (ok, code, effect, state, receiptId = null) => Object.freeze({ ok, code, effect, observedState: state, receiptId });
  if (!isCompositionSchemaPlan(plan) || approval !== plan.planDigest) return outcome(false, 'schema.approval-mismatch', 'none', 'unknown');
  const before = await inspect(db, plan);
  if (before.public.state === 'ready') return outcome(true, 'schema.current', 'none', 'ready', before.public.receiptId);
  if (before.public.state !== 'additive') return outcome(false, before.public.code, 'none', before.public.state);
  const receipt = { schemaVersion: 1, applicationId: plan.applicationId, sequence: before.current.headers.length + 1,
    previousId: before.current.receiptId, nonce: randomUUID(), compositionDigest: plan.compositionDigest,
    modelDigest: plan.modelDigest, sqlDigest: plan.sqlDigest, planDigest: plan.planDigest, objects: before.objects };
  const payload = canonicalJson(receipt), id = schemaDigest(payload);
  try {
    const statements = [managedSchemaGuard(db, before.current.objects)];
    if (!before.current.receipt) statements.push(db.prepare(RECEIPT_SQL));
    statements.push(receiptGuard(db, before.current));
    // Source of executable SQL is exclusively the branded, validated current plan, not receipts.
    statements.push(...before.additions.map(object => db.prepare(object.sql)));
    statements.push(db.prepare(`INSERT INTO ${quote(SCHEMA_RECEIPT_TABLE)} (sequence, id, previous_id, payload) VALUES (?, ?, ?, ?)`)
      .bind(receipt.sequence, id, receipt.previousId, payload));
    statements.push(managedSchemaGuard(db, [...before.objects, SCHEMA_RECEIPT_OBJECT]));
    checkedBatch(await db.batch(statements), statements.length);
    return outcome(true, 'schema.applied', 'confirmed', 'ready', id);
  } catch {
    const after = await inspect(db, plan);
    if (after.current?.receiptId === id && after.public.state === 'ready') return outcome(true, 'schema.applied', 'confirmed', 'ready', id);
    return outcome(false, 'schema.outcome-unknown', 'unknown', after.public.state, after.public.receiptId);
  }
}
