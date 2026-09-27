import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateD1Schema, inspectD1Schema } from './d1-schema.mjs';
import { inspectManagedSchema, managedSchemaGuard } from './apply-schema.mjs';
import { validateModule, contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { loadRuntimeComposition } from '../build/compose-runtime.mjs';
import { ACCESS_TABLES, normalizeLoginIdentifier } from '../../core/identity/d1-store.ts';
import { normalizeDisplayName } from '../../core/identity/input.ts';
import { createAccountService, provisionBootstrapCapability, validNewPassword } from '../../core/identity/accounts.ts';
import { digestOpaqueToken } from '../../core/identity/tokens.ts';

const MODULE_ID = 'creezio.access';
const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const plans = new WeakMap();
// Miniflare D1 creates this exact provider table lazily after its first schema read.
// Optional presence is qualified; a similarly named table or changed definition is foreign.
const INTERNAL_OBJECTS = Object.freeze([Object.freeze({ type: 'table', name: '_cf_METADATA', table: '_cf_METADATA',
  sql: 'CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )' })]);
const sha256 = bytes => `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const storedSql = sql => sql.trim().replace(/;$/, '').trimEnd();
const quote = name => `"${name.replaceAll('"', '""')}"`;
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export class AccessInstallPlanError extends Error {
  constructor() { super('The approved access installation artifacts are unavailable or inconsistent.'); this.name = 'AccessInstallPlanError'; this.code = 'invalid_plan'; }
}

function readArtifact(root, relative) {
  const target = path.resolve(root, relative), confined = path.relative(root, target);
  if (confined === '..' || confined.startsWith(`..${path.sep}`) || path.isAbsolute(confined)) throw new AccessInstallPlanError();
  // Inspect every ancestor, including ancestors of the repository itself. Never follow a junction.
  for (let cursor = target;; cursor = path.dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink()) throw new AccessInstallPlanError();
    if (cursor === path.dirname(cursor)) break;
  }
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new AccessInstallPlanError();
  const bytes = readFileSync(target);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new AccessInstallPlanError();
  return bytes;
}

function objectFromStatement(statement) {
  const table = /^CREATE TABLE "([a-z0-9_]+)" \(/.exec(statement);
  if (table) return { type: 'table', name: table[1], table: table[1], sql: storedSql(statement) };
  const index = /^CREATE (?:UNIQUE )?INDEX "([a-z0-9_]+)" ON "([a-z0-9_]+)" \(/.exec(statement);
  if (index) return { type: 'index', name: index[1], table: index[2], sql: storedSql(statement) };
  throw new AccessInstallPlanError();
}

/** Read and validate current sources and their approved generated artifact. No database is opened.
 * The public, frozen plan can be displayed for confirmation. Only a plan produced by this loader
 * is executable; copied objects or caller-provided SQL are not accepted as installation plans.
 */
export function loadAccessInstallPlan(root = DEFAULT_ROOT) {
  try {
    if (typeof root !== 'string' || !root.length) throw new AccessInstallPlanError();
    root = path.resolve(root);
    const compositionPath = process.env.CREEZIO_COMPOSITION || 'configuration/composition.json';
    const lockPath = process.env.CREEZIO_COMPOSITION_LOCK || compositionPath.replace(/\.json$/, '.lock.json');
    const compositionBytes = readArtifact(root, compositionPath), lockBytes = readArtifact(root, lockPath);
    const paths = ['extensions/native/access/module/models.json', 'extensions/native/access/module/manifest.json', 'data/schema/access.sql'];
    const bytes = paths.map(relative => readArtifact(root, relative));
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const models = JSON.parse(decoder.decode(bytes[0])), manifest = JSON.parse(decoder.decode(bytes[1]));
    if (manifest.identity?.id !== MODULE_ID) throw new AccessInstallPlanError();
    // Same deterministic source-to-artifact contract as prepare-access.mjs, on the captured bytes.
    manifest.contracts.models = models;
    manifest.identity.source.integrity = sha256(bytes[0]);
    if (validateModule(manifest).errors.length || !bytes[1].equals(Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))) throw new AccessInstallPlanError();
    const generated = generateD1Schema(MODULE_ID, models);
    if (!bytes[2].equals(Buffer.from(generated.sql))) throw new AccessInstallPlanError();
    if (Object.keys(generated.tables).length !== Object.keys(ACCESS_TABLES).length
      || Object.entries(ACCESS_TABLES).some(([id, name]) => generated.tables[id] !== name)) throw new AccessInstallPlanError();
    const runtime = loadRuntimeComposition({ root, compositionPath, lockPath });
    const selected = runtime.composition.modules.find(module => module.moduleId === MODULE_ID);
    const located = runtime.located.find(module => module.descriptor.identity.id === MODULE_ID);
    if (!selected?.enabled || !runtime.composition.exposure.admin.moduleIds.includes(MODULE_ID)
      || selected.source.kind !== 'workspace' || !located
      || path.resolve(located.directory) !== path.resolve(root, 'extensions/native/access')
      || contractIntegrity(located.descriptor) !== contractIntegrity(manifest)
      || contractIntegrity(runtime.composition) !== contractIntegrity(JSON.parse(decoder.decode(compositionBytes)))) throw new AccessInstallPlanError();
    // A local operator installs the precise selected native module, not a different package
    // reusing its id. Other selected descriptors remain inert and are validated by the build loader.
    for (const module of runtime.located) {
      const captured = JSON.parse(decoder.decode(readArtifact(root, path.join(module.directory, 'module/manifest.json'))));
      if (contractIntegrity(captured) !== contractIntegrity(module.descriptor)) throw new AccessInstallPlanError();
    }
    // Reject a change during loading rather than approving mixed generations of artifacts.
    if (paths.some((relative, index) => !readArtifact(root, relative).equals(bytes[index]))) throw new AccessInstallPlanError();
    if (!readArtifact(root, compositionPath).equals(compositionBytes) || !readArtifact(root, lockPath).equals(lockBytes)) throw new AccessInstallPlanError();
    const objects = generated.statements.map(objectFromStatement);
    const plan = freeze({ moduleId: MODULE_ID, modelDigest: sha256(bytes[0]), sqlDigest: sha256(bytes[2]),
      compositionDigest: contractIntegrity(runtime.composition), lockDigest: sha256(lockBytes),
      sql: generated.sql, statements: generated.statements, tables: generated.tables });
    plans.set(plan, freeze({ models, objects, expectedObjects: JSON.stringify(objects), applicationId: runtime.composition.application.id }));
    return plan;
  } catch { throw new AccessInstallPlanError(); }
}

// Capture data descriptors, never getters or property reads on a caller-supplied Proxy.
function fields(value, keys) {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length) return null;
    const copy = Object.create(null);
    for (const key of keys) {
      if (!Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value')) return null;
      copy[key] = descriptors[key].value;
    }
    return copy;
  } catch { return null; }
}

function inspection(state, bootstrap, code, plan) {
  return Object.freeze({ state, bootstrap, code, sqlDigest: plans.has(plan) ? plan.sqlDigest : null });
}
function result(ok, code, stage, effect, observedState, principalId) {
  return Object.freeze({ ok, code, stage, effect, observedState, ...(principalId ? { principalId } : {}) });
}
function successfulBatch(results, count) {
  if (!Array.isArray(results) || results.length !== count || results.some(item => !item || item.success !== true)) throw new Error('Access installation storage unavailable.');
  return results;
}
function rows(result) {
  if (!result || result.success !== true || !Array.isArray(result.results)) throw new Error('Access installation storage unavailable.');
  return result.results;
}

/** There is deliberately no broad sqlite_/_cf_ internal-object exemption. Only the exact provider
 * definition observed both absent and lazily present in the qualified Miniflare profile is allowed.
 * A different adapter must qualify its definitions rather than silently admitting foreign objects.
 */
function schemaGuard(db, plan) {
  const internal = plans.get(plan);
  // SQLite lazily evaluates CASE. Invalid JSON deliberately raises a SQL error on a mismatch;
  // D1 rolls back the whole batch, including earlier CREATE statements. No guard table survives.
  return db.prepare(`WITH expected AS (
    SELECT json_extract(value, '$.type') AS type, json_extract(value, '$.name') AS name,
      json_extract(value, '$.table') AS tbl_name, json_extract(value, '$.sql') AS sql FROM json_each(?)
  ), internal AS (
    SELECT json_extract(value, '$.type') AS type, json_extract(value, '$.name') AS name,
      json_extract(value, '$.table') AS tbl_name, json_extract(value, '$.sql') AS sql FROM json_each(?)
  ), actual AS (
    SELECT s.type, s.name, s.tbl_name, s.sql FROM sqlite_schema s WHERE NOT EXISTS (
      SELECT 1 FROM internal i WHERE s.type IS i.type AND s.name IS i.name AND s.tbl_name IS i.tbl_name AND s.sql IS i.sql)
  ) SELECT CASE WHEN
    (SELECT COUNT(*) FROM actual) = (SELECT COUNT(*) FROM expected)
    AND NOT EXISTS (SELECT 1 FROM expected e LEFT JOIN actual s ON s.name = e.name
      WHERE s.name IS NULL OR s.type IS NOT e.type OR s.tbl_name IS NOT e.tbl_name OR s.sql IS NOT e.sql)
    THEN 1 ELSE json('creezio-install-guard-failed') END AS approved`).bind(internal.expectedObjects, JSON.stringify(INTERNAL_OBJECTS));
}
function noApplicationData(plan) {
  return Object.entries(plan.tables).filter(([id]) => id !== 'bootstrap' && id !== 'auth_throttles')
    .map(([, name]) => `NOT EXISTS (SELECT 1 FROM ${quote(name)} LIMIT 1)`).join(' AND ');
}
function emptyDataGuard(db, plan) {
  return db.prepare(`SELECT CASE WHEN ${noApplicationData(plan)}
    THEN 1 ELSE json('creezio-install-data-guard-failed') END AS approved`);
}

async function inspect(db, plan) {
  if (!plans.has(plan)) return { public: inspection('blocked', 'unknown', 'invalid_input', plan), marker: null };
  try {
    const internal = plans.get(plan);
    const observed = rows(await db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name LIMIT ?')
      .bind(internal.objects.length + INTERNAL_OBJECTS.length + 1).all());
    const actual = observed.filter(row => !INTERNAL_OBJECTS.some(object => row?.type === object.type && row?.name === object.name
      && row?.tbl_name === object.table && row?.sql === object.sql));
    if (!actual.length) return { public: inspection('fresh', 'none', 'ready', plan), marker: null };
    const expected = new Map(internal.objects.map(object => [`${object.type}:${object.name}`, object]));
    let foreign = actual.length > internal.objects.length, mismatch = false;
    for (const row of actual) {
      const object = expected.get(`${row?.type}:${row?.name}`);
      if (!object) { foreign = true; continue; }
      if (row.tbl_name !== object.table || typeof row.sql !== 'string' || storedSql(row.sql) !== object.sql) mismatch = true;
      expected.delete(`${row.type}:${row.name}`);
    }
    let managed = null;
    if (foreign) {
      // A centrally approved additive publication may retain other modules. It can only prove
      // permanent installation closure here, never reopen or provision an unconsumed bootstrap.
      managed = await inspectManagedSchema(db);
      if (!managed.ok || !managed.receipt || managed.receipt.applicationId !== internal.applicationId
        || internal.objects.some(wanted => !managed.objects.some(object => object.type === wanted.type
          && object.name === wanted.name && object.table === wanted.table && object.sql === wanted.sql)))
        return { public: inspection('blocked', 'unknown', 'foreign_data', plan), marker: null };
    }
    if (!managed && (mismatch || expected.size)) return { public: inspection('blocked', 'unknown', 'schema_mismatch', plan), marker: null };
    const drift = await inspectD1Schema(db, MODULE_ID, internal.models);
    if (!drift.ok) return { public: inspection(drift.errors.some(error => error.code === 'sql.inspect-unavailable') ? 'unavailable' : 'blocked',
      'unknown', drift.errors.some(error => error.code === 'sql.inspect-unavailable') ? 'storage_unavailable' : 'schema_mismatch', plan), marker: null };
    // One coherent D1 transaction for guard, marker, data facts and database time.
    const responses = successfulBatch(await db.batch([
      managed ? managedSchemaGuard(db, managed.objects) : schemaGuard(db, plan),
      db.prepare(`SELECT id, capability_digest AS digest, created_at_ms AS createdAtMs, expires_at_ms AS expiresAtMs,
        claim_nonce AS claimNonce, claimed_at_ms AS claimedAtMs, principal_id AS principalId FROM ${quote(plan.tables.bootstrap)} LIMIT 2`),
      db.prepare(`SELECT ${NOW} AS nowMs, CASE WHEN ${noApplicationData(plan)} THEN 0 ELSE 1 END AS hasData`),
    ]), 3);
    const markers = rows(responses[1]), facts = rows(responses[2]);
    if (markers.length > 1 || facts.length !== 1 || !Number.isSafeInteger(facts[0].nowMs)
      || facts[0].nowMs <= 0 || ![0, 1].includes(facts[0].hasData)) throw new Error('Invalid installation facts.');
    const marker = markers[0] ?? null;
    if (marker) {
      const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.exec(value)?.[0] === value;
      if (marker.id !== 'installation' || typeof marker.digest !== 'string' || /^sha256:[a-f0-9]{64}$/.exec(marker.digest)?.[0] !== marker.digest
        || !Number.isSafeInteger(marker.createdAtMs) || marker.createdAtMs <= 0 || !Number.isSafeInteger(marker.expiresAtMs)
        || marker.expiresAtMs <= marker.createdAtMs) return { public: inspection('blocked', 'unknown', 'foreign_data', plan), marker: null };
      if (validId(marker.claimNonce) && Number.isSafeInteger(marker.claimedAtMs) && marker.claimedAtMs > 0 && validId(marker.principalId)) {
        // Permanent closure; no ACL or active-account check can reopen a consumed installation.
        return { public: inspection('initialized', 'consumed', 'already_initialized', plan), marker };
      }
      if (marker.claimNonce !== null || marker.claimedAtMs !== null || marker.principalId !== null) {
        return { public: inspection('blocked', 'unknown', 'foreign_data', plan), marker: null };
      }
    }
    if (managed) return { public: inspection('blocked', 'unknown', 'foreign_data', plan), marker: null };
    if (facts[0].hasData) return { public: inspection('blocked', 'unknown', 'foreign_data', plan), marker: null };
    if (!marker) return { public: inspection('schema_ready', 'none', 'ready', plan), marker: null };
    const live = marker.expiresAtMs > facts[0].nowMs;
    return { public: inspection(live ? 'bootstrap_live' : 'bootstrap_expired', live ? 'live' : 'expired', live ? 'bootstrap_pending' : 'ready', plan), marker };
  } catch { return { public: inspection('unavailable', 'unknown', 'storage_unavailable', plan), marker: null }; }
}

/** Strictly read-only. Diagnostics contain neither database rows nor SQL/credential values. */
export async function inspectAccessInstallation(db, plan) { return (await inspect(db, plan)).public; }

/** Apply the approved CREATE batch only to a fresh database, under a final exact-schema guard.
 * On any thrown/ambiguous acknowledgement, observe once without retrying any write.
 */
export async function createAccessSchema(db, plan, input) {
  const options = fields(input, ['expectedSqlDigest']);
  if (!plans.has(plan) || !options || typeof options.expectedSqlDigest !== 'string') return result(false, 'invalid_input', 'preflight', 'none', 'unknown');
  if (options.expectedSqlDigest !== plan.sqlDigest) return result(false, 'schema_digest_mismatch', 'preflight', 'none', 'unknown');
  const before = await inspectAccessInstallation(db, plan);
  if (before.state !== 'fresh') return result(false, before.code === 'ready' ? 'schema_mismatch' : before.code, 'preflight', 'none', before.state);
  try {
    const statements = [...plan.statements.map(statement => db.prepare(statement)), schemaGuard(db, plan)];
    successfulBatch(await db.batch(statements), statements.length);
    return result(true, 'schema_created', 'schema', 'confirmed', 'schema_ready');
  } catch {
    const after = await inspectAccessInstallation(db, plan);
    // A schema observed now may belong to a racing installer. Do not attribute it to this call,
    // and do not continue bootstrap after an unknown DDL acknowledgement.
    return result(false, 'outcome_unknown', 'schema', 'unknown', after.state);
  }
}

function guardedDatabase(db, plan) {
  return Object.freeze({
    prepare: statement => db.prepare(statement),
    async batch(statements) {
      // Canonical services keep their statement/result contract. Guards participate in their
      // same transaction; a mismatch cannot leave a claim or any later effect half-applied.
      const results = successfulBatch(await db.batch([schemaGuard(db, plan), emptyDataGuard(db, plan),
        ...statements, schemaGuard(db, plan)]), statements.length + 3);
      return results.slice(2, -1);
    },
  });
}

/** Operator-only orchestration, never an HTTP/MCP operation. Inputs and explicit approval are
 * captured before the first await/write. Schema creation and bootstrap are separate atomic
 * batches; an installation error never means they were both rolled back. No automatic retries.
 */
export async function installAccess(db, plan, input) {
  const options = fields(input, ['credentials', 'expectedSqlDigest', 'createSchema']);
  const supplied = options && fields(options.credentials, ['loginIdentifier', 'displayName', 'password']);
  const loginIdentifier = supplied && normalizeLoginIdentifier(supplied.loginIdentifier);
  const displayName = supplied && normalizeDisplayName(supplied.displayName);
  if (!plans.has(plan) || !options || typeof options.createSchema !== 'boolean' || typeof options.expectedSqlDigest !== 'string'
    || !loginIdentifier || !displayName || !validNewPassword(supplied?.password)) return result(false, 'invalid_input', 'preflight', 'none', 'unknown');
  const credentials = Object.freeze({ loginIdentifier, displayName, password: supplied.password });
  const expectedSqlDigest = options.expectedSqlDigest, createSchema = options.createSchema;
  if (expectedSqlDigest !== plan.sqlDigest) return result(false, 'schema_digest_mismatch', 'preflight', 'none', 'unknown');
  let before = await inspectAccessInstallation(db, plan), changed = false;
  if (before.state === 'fresh') {
    if (!createSchema) return result(false, 'schema_required', 'preflight', 'none', 'fresh');
    const created = await createAccessSchema(db, plan, { expectedSqlDigest });
    if (!created.ok) return created;
    changed = true;
    before = await inspectAccessInstallation(db, plan);
  }
  if (!['schema_ready', 'bootstrap_expired'].includes(before.state)) {
    return result(false, before.code, 'preflight', changed ? 'confirmed' : 'none', before.state);
  }
  let capabilityDigest = null;
  try {
    const guarded = guardedDatabase(db, plan);
    const capability = await provisionBootstrapCapability(guarded);
    if (!capability) {
      const after = await inspectAccessInstallation(db, plan);
      return result(false, after.state === 'bootstrap_live' ? 'bootstrap_pending' : 'bootstrap_unavailable', 'bootstrap', changed ? 'confirmed' : 'none', after.state);
    }
    changed = true;
    capabilityDigest = await digestOpaqueToken(capability.token, 'bootstrap');
    const account = await createAccountService(guarded).bootstrap({ ...credentials, token: capability.token });
    if (!account.ok) {
      const after = await inspectAccessInstallation(db, plan);
      return result(false, account.code, 'bootstrap', 'confirmed', after.state);
    }
    // Only metadata leaves this engine. The one-use capability and password never enter output.
    return result(true, 'installed', 'complete', 'confirmed', 'initialized', account.principalId);
  } catch {
    const after = await inspect(db, plan);
    if (capabilityDigest && after.public.state === 'initialized' && after.marker?.digest === capabilityDigest) {
      return result(true, 'installed', 'complete', 'confirmed', 'initialized', after.marker.principalId);
    }
    return result(false, 'outcome_unknown', 'bootstrap', 'unknown', after.public.state);
  }
}
