import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { inspectJson } from '../../sdk/contracts/load.mjs';
import { canonicalJson } from '../../sdk/contracts/semantics.mjs';

const schemaRoot = new URL('../../sdk/contracts/schemas/v1/', import.meta.url);
const common = JSON.parse(readFileSync(new URL('common.schema.json', schemaRoot), 'utf8'));
const modelsSchema = JSON.parse(readFileSync(new URL('models.schema.json', schemaRoot), 'utf8'));
const ajv = new Ajv2020({ strict: true, strictRequired: true, allErrors: true, ownProperties: true });
addFormats(ajv);
ajv.addSchema(common);
const validateModels = ajv.compile(modelsSchema);
const validateId = ajv.compile({ $ref: `${common.$id}#/$defs/id` });
const SQL_TYPES = Object.freeze({ string: 'TEXT', integer: 'INTEGER', number: 'REAL', boolean: 'INTEGER', 'date-time': 'TEXT', json: 'TEXT' });
const DELETE_ACTIONS = Object.freeze({ restrict: 'RESTRICT', 'set-null': 'SET NULL', cascade: 'CASCADE' });
// D1 documented per-statement limits; not an account quota or a batch-size promise.
const MAX_COLUMNS = 100, MAX_SQL_BYTES = 100000, MAX_INSPECTION_OBJECTS = 20000;
const has = (object, key) => Object.hasOwn(object, key);
const quote = name => `"${name.replaceAll('"', '""')}"`;
const hex = value => Buffer.from(value, 'utf8').toString('hex');
const compareIds = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const sameFields = (a, b) => a.length === b.length && a.every((field, index) => field === b[index]);
const location = (...parts) => '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');

export class D1SchemaError extends Error {
  constructor(code, path, message) {
    super(message); this.name = 'D1SchemaError'; this.code = code; this.path = path;
  }
}
const fail = (code, path, message) => { throw new D1SchemaError(code, path, message); };

function requireId(id, path) {
  if (typeof id !== 'string' || !validateId(id)) fail('sql.id', path, 'A canonical contract identifier is required.');
}

/** Raw, collision-free SQL name. Callers still quote it when forming SQL. */
export function sqlTableName(moduleId, modelId) {
  requireId(moduleId, '/moduleId'); requireId(modelId, '/modelId');
  return `cz_${hex(moduleId)}_${hex(modelId)}`;
}

function indexName(moduleId, modelId, indexId) {
  return `${sqlTableName(moduleId, modelId)}_idx_${hex(indexId)}`;
}

function uniqueById(items, path) {
  const map = new Map();
  for (const item of items) {
    if (map.has(item.id)) fail('sql.duplicate', path, 'Identifiers must be unique within their collection.');
    map.set(item.id, item);
  }
  return map;
}

function resolveFields(fields, fieldMap, path) {
  if (new Set(fields).size !== fields.length || fields.some(field => !fieldMap.has(field))) {
    fail('sql.fields', path, 'Fields must resolve exactly once in this model.');
  }
  return fields.map(field => fieldMap.get(field));
}

function canonicalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function valueMatchesType(value, field) {
  if (value === null) return field.nullable;
  switch (field.type) {
    case 'string': return typeof value === 'string' && !value.includes('\0') && value.isWellFormed();
    case 'integer': return Number.isSafeInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'date-time': return canonicalDate(value);
    case 'json': return true; // inspectJson and the contract already validated inert JSON.
    default: return false;
  }
}

function matchesBounds(value, constraints) {
  if (value === null) return true;
  if (has(constraints, 'minLength') && [...value].length < constraints.minLength) return false;
  if (has(constraints, 'maxLength') && [...value].length > constraints.maxLength) return false;
  if (has(constraints, 'minimum') && value < constraints.minimum) return false;
  if (has(constraints, 'maximum') && value > constraints.maximum) return false;
  return true;
}

function validateField(field, path) {
  if (field.computed) fail('sql.unsupported-computed', path, 'Computed columns require a qualified central compiler.');
  if (has(field, 'schema')) fail('sql.unsupported-schema', path, 'A JSON schema reference cannot be enforced by this SQL generator.');
  const constraints = field.constraints ?? {};
  if (has(constraints, 'pattern')) fail('sql.unsupported-pattern', path, 'Regex constraints are not translated into SQLite expressions.');
  for (const key of ['minLength', 'maxLength']) {
    if (has(constraints, key) && (!['string', 'date-time'].includes(field.type) || !Number.isSafeInteger(constraints[key]))) {
      fail('sql.constraints', path, 'Length bounds require a text field and safe integer bounds.');
    }
  }
  for (const key of ['minimum', 'maximum']) {
    if (has(constraints, key) && (!['number', 'integer'].includes(field.type) ||
      (field.type === 'integer' && !Number.isSafeInteger(constraints[key])))) {
      fail('sql.constraints', path, 'Numeric bounds must match the declared numeric type.');
    }
  }
  if (constraints.minLength > constraints.maxLength || constraints.minimum > constraints.maximum) {
    fail('sql.constraints', path, 'Constraint bounds are contradictory.');
  }
  if (field.type === 'date-time' && (constraints.minLength > 24 || constraints.maxLength < 24)) {
    fail('sql.constraints', path, 'Length bounds exclude every supported canonical date.');
  }
  if (has(constraints, 'enum')) {
    if (field.type === 'json') fail('sql.unsupported-json-enum', path, 'Structural JSON enums need a qualified comparison contract.');
    const seen = new Set();
    for (const value of constraints.enum) {
      if (!valueMatchesType(value, field) || !matchesBounds(value, constraints)) fail('sql.enum', path, 'Enum values must satisfy the declared type and bounds.');
      const key = JSON.stringify(value);
      if (seen.has(key)) fail('sql.enum', path, 'Enum values must be unique.');
      seen.add(key);
    }
  }
  if (has(field, 'default')) {
    if (!valueMatchesType(field.default, field) || !matchesBounds(field.default, constraints) ||
      (has(constraints, 'enum') && !constraints.enum.some(value => value === field.default))) {
      fail('sql.default', path, 'Default must satisfy nullability, type, bounds and enum.');
    }
  }
}

function validateSemanticModels(moduleId, models) {
  const byId = uniqueById(models, '/models');
  const fieldsByModel = new Map();
  for (const model of models) {
    const path = location('models', model.id);
    if (model.fields.length > MAX_COLUMNS) fail('sql.limit-columns', path, 'D1 supports at most 100 columns per table.');
    const fields = uniqueById(model.fields, `${path}/fields`);
    fieldsByModel.set(model.id, fields);
    for (const field of model.fields) validateField(field, `${path}/fields/${field.id}`);
    if (resolveFields(model.primaryKey, fields, `${path}/primaryKey`).some(field => field.nullable)) {
      fail('sql.primary-key', path, 'Primary key fields must be explicitly non-nullable.');
    }
    if (model.scope === 'context') {
      if (!model.contextField || !fields.has(model.contextField) || fields.get(model.contextField).nullable) {
        fail('sql.context', path, 'A context model requires its non-nullable context field.');
      }
    } else if (has(model, 'contextField')) fail('sql.context', path, 'An application model cannot declare a context field.');
    uniqueById(model.indexes, `${path}/indexes`);
    for (const index of model.indexes) resolveFields(index.fields, fields, `${path}/indexes/${index.id}`);
    uniqueById(model.relations, `${path}/relations`);
    for (const permission of model.permissions) {
      if (permission.kind !== 'permission') fail('sql.permission', path, 'Model permissions must reference permissions.');
    }
  }
  for (const model of models) for (const relation of model.relations) {
    const path = location('models', model.id, 'relations', relation.id);
    if (has(relation, 'via') || relation.target.moduleId !== moduleId) {
      fail('sql.unsupported-relation', path, 'This creation generator accepts only direct, same-module relations.');
    }
    const target = byId.get(relation.target.id);
    if (relation.target.kind !== 'model' || !target) fail('sql.relation-target', path, 'The target must be a model in this schema.');
    const sourceFields = resolveFields(relation.fields, fieldsByModel.get(model.id), path);
    const targetFields = resolveFields(relation.targetFields, fieldsByModel.get(target.id), path);
    if (sourceFields.length !== targetFields.length || sourceFields.some((field, index) => field.type !== targetFields[index].type)) {
      fail('sql.relation-type', path, 'Related fields must have matching arity and types.');
    }
    if (!sameFields(relation.targetFields, target.primaryKey) &&
      !target.indexes.some(index => index.unique && sameFields(index.fields, relation.targetFields))) {
      fail('sql.relation-key', path, 'A foreign key must target an exact primary or unique key.');
    }
    if (relation.onDelete === 'set-null' && sourceFields.some(field => !field.nullable)) {
      fail('sql.relation-null', path, 'SET NULL requires every source field to be nullable.');
    }
    if (target.scope === 'context' && (model.scope !== 'context' ||
      !relation.fields.some((field, index) => field === model.contextField && relation.targetFields[index] === target.contextField))) {
      fail('sql.relation-context', path, 'A relation must preserve the target context positionally.');
    }
  }
}

function scalarLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function fieldSQL(field) {
  const name = quote(field.id), constraints = field.constraints ?? {}, checks = [];
  switch (field.type) {
    case 'string': checks.push(`typeof(${name}) = 'text'`, `instr(${name}, char(0)) = 0`); break;
    case 'integer': checks.push(`typeof(${name}) = 'integer'`, `${name} BETWEEN -9007199254740991 AND 9007199254740991`); break;
    case 'number': checks.push(`typeof(${name}) IN ('integer', 'real')`, `${name} BETWEEN -1.7976931348623157e+308 AND 1.7976931348623157e+308`); break;
    case 'boolean': checks.push(`typeof(${name}) = 'integer'`, `${name} IN (0, 1)`); break;
    case 'json': checks.push(`typeof(${name}) = 'text'`, `json_valid(${name}) = 1`); break;
    case 'date-time': checks.push(`typeof(${name}) = 'text'`, `length(${name}) = 24`,
      `strftime('%Y-%m-%dT%H:%M:%fZ', ${name}) IS NOT NULL`, `strftime('%Y-%m-%dT%H:%M:%fZ', ${name}) = ${name}`); break;
  }
  if (has(constraints, 'minLength')) checks.push(`length(${name}) >= ${constraints.minLength}`);
  if (has(constraints, 'maxLength')) checks.push(`length(${name}) <= ${constraints.maxLength}`);
  if (has(constraints, 'minimum')) checks.push(`${name} >= ${constraints.minimum}`);
  if (has(constraints, 'maximum')) checks.push(`${name} <= ${constraints.maximum}`);
  if (has(constraints, 'enum')) {
    const values = constraints.enum.filter(value => value !== null);
    checks.push(values.length ? `${name} IN (${values.map(scalarLiteral).join(', ')})` : '0');
  }
  const allowsNull = field.nullable && (!has(constraints, 'enum') || constraints.enum.includes(null));
  const expression = `(${checks.join(' AND ')})`;
  const sqlCheck = allowsNull ? `${name} IS NULL OR ${expression}` : `${name} IS NOT NULL AND ${expression}`;
  const defaultSQL = has(field, 'default')
    ? ' DEFAULT ' + scalarLiteral(field.type === 'json' && field.default !== null ? canonicalJson(field.default) : field.default) : '';
  return `${name} ${SQL_TYPES[field.type]}${field.nullable ? '' : ' NOT NULL'}${defaultSQL} CHECK (${sqlCheck})`;
}

function compile(moduleId, models) {
  requireId(moduleId, '/moduleId');
  const inspected = inspectJson(models);
  if (inspected.errors.length) {
    const error = inspected.errors[0]; fail(error.code, error.path, error.message);
  }
  if (!validateModels(models)) {
    const error = validateModels.errors[0];
    fail('sql.model-shape', error.instancePath, `Models violate the v1 contract (${error.keyword}).`);
  }
  validateSemanticModels(moduleId, models);
  const tables = Object.create(null), objects = [], ordered = [...models].sort(compareIds);
  for (const model of ordered) {
    const table = sqlTableName(moduleId, model.id);
    tables[model.id] = table;
    const clauses = [...model.fields].sort(compareIds).map(fieldSQL);
    clauses.push(`PRIMARY KEY (${model.primaryKey.map(quote).join(', ')})`);
    for (const relation of [...model.relations].sort(compareIds)) {
      clauses.push(`FOREIGN KEY (${relation.fields.map(quote).join(', ')}) REFERENCES ${quote(sqlTableName(moduleId, relation.target.id))}` +
        ` (${relation.targetFields.map(quote).join(', ')}) ON DELETE ${DELETE_ACTIONS[relation.onDelete]}`);
    }
    // WITHOUT ROWID prevents INTEGER PRIMARY KEY from silently allocating an id for NULL.
    objects.push({ type: 'table', name: table, table, sql: `CREATE TABLE ${quote(table)} (\n  ${clauses.join(',\n  ')}\n) WITHOUT ROWID;` });
  }
  for (const model of ordered) for (const index of [...model.indexes].sort(compareIds)) {
    const name = indexName(moduleId, model.id, index.id), table = tables[model.id];
    objects.push({ type: 'index', name, table,
      sql: `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(name)} ON ${quote(table)} (${index.fields.map(quote).join(', ')});` });
  }
  for (const object of objects) {
    if (Buffer.byteLength(object.sql, 'utf8') > MAX_SQL_BYTES) fail('sql.limit-statement', '', 'Generated SQL exceeds the D1 statement byte limit.');
  }
  const statements = objects.map(object => object.sql);
  const sql = `-- Creezio D1 current-model creation v1\n-- Module: ${moduleId}\n-- Inspect before applying to a new database. No automatic repair.\n\n${statements.join('\n\n')}${statements.length ? '\n' : ''}`;
  return { sql, statements, tables, objects };
}

/** Pure creation compiler: no database calls, writes, module code or generated transformations. */
export function generateD1Schema(moduleId, models) {
  const { sql, statements, tables } = compile(moduleId, models);
  return { sql, statements, tables };
}

/** The same compiler, with inert schema-object metadata for central composition/receipts. */
export function describeD1Schema(moduleId, models) { return compile(moduleId, models); }

const storedSQL = sql => sql.trim().replace(/;$/, '').trimEnd();

/** Read-only conservative drift check. This does not assert data integrity or apply SQL. */
export async function inspectD1Schema(db, moduleId, models) {
  const { objects } = compile(moduleId, models);
  const prefix = `cz_${hex(moduleId)}_`;
  let results;
  try {
    const response = await db.prepare(
      'SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE substr(lower(name), 1, ?) = ? OR substr(lower(tbl_name), 1, ?) = ? ORDER BY type, name LIMIT ?'
    ).bind(prefix.length, prefix, prefix.length, prefix, MAX_INSPECTION_OBJECTS + 1).all();
    if (!response.success || !Array.isArray(response.results)) throw new Error('Invalid inspection result.');
    results = response.results;
  } catch {
    return { ok: false, errors: [{ code: 'sql.inspect-unavailable', message: 'The current database schema could not be read.' }] };
  }
  if (results.length > MAX_INSPECTION_OBJECTS) {
    return { ok: false, errors: [{ code: 'sql.inspect-limit', message: 'The module schema exceeds the inspection bound.' }] };
  }
  const expected = new Map(objects.map(object => [`${object.type}:${object.name}`, object]));
  const tableNames = new Set(objects.filter(object => object.type === 'table').map(object => object.name));
  const errors = [];
  for (const actual of results) {
    // PK autoindexes have no SQL and are already described by the exact CREATE TABLE.
    if (actual.type === 'index' && actual.sql === null && typeof actual.name === 'string' &&
      actual.name.startsWith('sqlite_autoindex_') && tableNames.has(actual.tbl_name)) continue;
    const key = `${actual.type}:${actual.name}`, wanted = expected.get(key);
    if (!wanted) errors.push({ code: 'sql.drift-extra', name: actual.name, message: 'An undeclared schema object belongs to this module namespace or table.' });
    else {
      if (actual.tbl_name !== wanted.table || typeof actual.sql !== 'string' || storedSQL(actual.sql) !== storedSQL(wanted.sql)) {
        errors.push({ code: 'sql.drift-definition', name: actual.name, message: 'The stored object differs from the approved generated definition.' });
      }
      expected.delete(key);
    }
  }
  for (const object of expected.values()) errors.push({ code: 'sql.drift-missing', name: object.name, message: 'A required generated schema object is missing.' });
  return { ok: errors.length === 0, errors };
}
