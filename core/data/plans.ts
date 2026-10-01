import { authorize } from '../authorization/authorize.ts';
import { type ResolvedDataAuthorization, type SqlStatement } from './authorization.ts';
import { copyJson, keys, own, quote, record, validId } from './input.ts';
import { DATA_LIMITS, DataAccessError, type RuntimeDataCatalog, type DataModel, type DataField, type DataRecord,
  type DataAction, type JsonValue, type DataCompare, type InternalDataPortOptions } from './types.ts';

export interface CompiledModel { readonly moduleId: string; readonly modelId: string; readonly table: string;
  readonly model: DataModel; readonly enabled: boolean; readonly permissions: RuntimeDataCatalog['modules'][number]['permissions'] }
export interface CompiledDataPlan {
  readonly statements: readonly SqlStatement[]; readonly resultIndex: number; readonly write: boolean;
  readonly fields: readonly DataField[]; readonly list?: { readonly limit: number; readonly keyFields: readonly string[] };
}
const fullId = (moduleId: string, id: string) => `${moduleId}:${id}`;
const hex = (value: string) => Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');

/** The input is a generated, server-owned catalogue, never a module/client JSON body. */
export function compileDataCatalog(input: RuntimeDataCatalog): ReadonlyMap<string, CompiledModel> {
  try {
    const catalog = copyJson(input, 4 * 1024 * 1024) as unknown as RuntimeDataCatalog;
    if (catalog.schemaVersion !== 1 || typeof catalog.compositionDigest !== 'string' || !catalog.compositionDigest
      || !Array.isArray(catalog.modules) || catalog.modules.length > 1000) throw new Error();
    const modules = new Set<string>(), models = new Map<string, CompiledModel>(), tables = new Set<string>();
    for (const module of catalog.modules) {
      if (!validId(module.moduleId) || modules.has(module.moduleId) || typeof module.enabled !== 'boolean'
        || !Array.isArray(module.models) || !Array.isArray(module.permissions)) throw new Error();
      modules.add(module.moduleId);
      for (const entry of module.models) {
        const model = entry.model;
        if (!validId(entry.modelId) || model.id !== entry.modelId || !['context', 'application'].includes(model.scope)
          || entry.table !== `cz_${hex(module.moduleId)}_${hex(entry.modelId)}` || tables.has(entry.table)
          || !Array.isArray(model.fields) || model.fields.length < 1 || model.fields.length > DATA_LIMITS.fields
          || !Array.isArray(model.primaryKey) || !model.primaryKey.length || !Array.isArray(model.permissions)
          || !Array.isArray(model.indexes) || !Array.isArray(model.relations)
          || !model.deletion || !['soft', 'hard'].includes(model.deletion.mode) || typeof model.deletion.requiresApproval !== 'boolean') throw new Error();
        const fields = new Map<string, DataField>(model.fields.map((field: DataField) => [field.id, field]));
        if (fields.size !== model.fields.length || model.fields.some((f: DataField) => !validId(f.id) || !['string','integer','number','boolean','date-time','json'].includes(f.type)
          || typeof f.protected !== 'boolean' || typeof f.computed !== 'boolean' || typeof f.nullable !== 'boolean')
          || model.primaryKey.some((id: string) => !fields.has(id) || fields.get(id)!.computed)
          || new Set(model.primaryKey).size !== model.primaryKey.length
          || model.scope === 'context' && (!model.contextField || !fields.has(model.contextField)
            || fields.get(model.contextField)!.type !== 'string' || fields.get(model.contextField)!.computed)) throw new Error();
        if (new Set(model.indexes.map((index: DataModel['indexes'][number]) => index.id)).size !== model.indexes.length
          || model.indexes.some((index: DataModel['indexes'][number]) => !validId(index.id) || typeof index.unique !== 'boolean'
            || !Array.isArray(index.fields) || !index.fields.length || new Set(index.fields).size !== index.fields.length
            || index.fields.some((id: string) => !fields.has(id) || fields.get(id)!.computed))) throw new Error();
        const key = fullId(module.moduleId, entry.modelId);
        if (models.has(key)) throw new Error();
        models.set(key, Object.freeze({ moduleId: module.moduleId, modelId: entry.modelId, table: entry.table,
          model, enabled: module.enabled, permissions: module.permissions })); tables.add(entry.table);
      }
    }
    for (const source of models.values()) for (const relation of source.model.relations) {
      if (!validId(relation.id) || !Array.isArray(relation.fields) || !Array.isArray(relation.targetFields)
        || !relation.fields.length || relation.fields.length !== relation.targetFields.length
        || !['restrict', 'cascade', 'set-null'].includes(relation.onDelete)) throw new Error();
      if (relation.target.moduleId !== source.moduleId) continue; // Cross-module writes remain unavailable.
      const target = models.get(fullId(source.moduleId, relation.target.id));
      if (relation.target.kind !== 'model' || !target) throw new Error();
      const sourceFields = new Map(source.model.fields.map(field => [field.id, field]));
      const targetFields = new Map(target.model.fields.map(field => [field.id, field]));
      if (relation.fields.some((id, i) => !sourceFields.has(id) || !targetFields.has(relation.targetFields[i])
        || sourceFields.get(id)!.type !== targetFields.get(relation.targetFields[i])!.type)) throw new Error();
      const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
      if (![target.model.primaryKey, ...target.model.indexes.filter(index => index.unique).map(index => index.fields)]
        .some(fields => same(fields, relation.targetFields))) throw new Error();
      if (target.model.scope === 'context' && (source.model.scope !== 'context'
        || !relation.fields.some((id, i) => id === source.model.contextField
          && relation.targetFields[i] === target.model.contextField))) throw new Error();
    }
    return models;
  } catch { throw new DataAccessError('invalid_catalog'); }
}

// Stored/editable separation is portable; no implicit metadata columns or JSON record fallback.
export const storedFields = (model: DataModel) => model.fields.filter(field => !field.computed);
export const editableFields = (model: DataModel) => storedFields(model).filter(field => !field.protected);

function permits(entry: CompiledModel, state: ResolvedDataAuthorization, action: DataAction): boolean {
  return entry.permissions.some(permission => entry.model.permissions.some(ref => ref.kind === 'permission'
    && ref.moduleId === entry.moduleId && ref.id === permission.id) && permission.actions.includes(action)
    && permission.resources.some(ref => ref.kind === 'model' && ref.moduleId === entry.moduleId && ref.id === entry.modelId)
    && authorize(state.snapshot, { ...state.target, requiredPermissionIds: [...new Set([
      ...state.target.requiredPermissionIds, fullId(entry.moduleId, permission.id),
    ])] }, state.nowMs).allowed);
}

function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => own(b, k) && jsonEqual((a as Record<string, JsonValue>)[k], (b as Record<string, JsonValue>)[k]));
}
function encode(field: DataField, value: JsonValue): string | number | null {
  if (value === null) {
    if (!field.nullable || field.constraints?.enum && !field.constraints.enum.includes(null)) throw new DataAccessError('invalid_input');
    return null;
  }
  if (field.computed || field.schema || field.constraints?.pattern) throw new DataAccessError('unsupported');
  const c = field.constraints;
  if ((field.type === 'integer' && !Number.isSafeInteger(value)) || (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
    || (field.type === 'boolean' && typeof value !== 'boolean')
    || (['string','date-time'].includes(field.type) && typeof value !== 'string')) throw new DataAccessError('invalid_input');
  if (field.type === 'date-time' && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value)) throw new DataAccessError('invalid_input');
  if (typeof value === 'string') {
    const length = [...value].length;
    if (c?.minLength !== undefined && length < c.minLength || c?.maxLength !== undefined && length > c.maxLength)
      throw new DataAccessError('invalid_input');
  }
  if (typeof value === 'number' && (c?.minimum !== undefined && value < c.minimum || c?.maximum !== undefined && value > c.maximum))
    throw new DataAccessError('invalid_input');
  if (c?.enum && !c.enum.some(item => jsonEqual(item, value))) throw new DataAccessError('invalid_input');
  return field.type === 'json' ? JSON.stringify(value) : typeof value === 'boolean' ? Number(value) : value as string | number;
}

export function decodeRows(rows: readonly Record<string, unknown>[], fields: readonly DataField[]): readonly DataRecord[] {
  const decoded = rows.map(row => {
    const output: Record<string, JsonValue> = Object.create(null);
    for (const field of fields) {
      if (!own(row, field.id)) throw new DataAccessError('storage_error');
      let value = row[field.id];
      if (value !== null && field.type === 'json') { if (typeof value !== 'string') throw new DataAccessError('storage_error'); value = JSON.parse(value); }
      if (value !== null && field.type === 'boolean') {
        if (value !== 0 && value !== 1) throw new DataAccessError('storage_error'); value = value === 1;
      }
      const copied = copyJson(value, DATA_LIMITS.resultBytes);
      encode(field, copied); output[field.id] = copied;
    }
    return Object.freeze(output);
  });
  if (new TextEncoder().encode(JSON.stringify(decoded)).length > DATA_LIMITS.resultBytes) throw new DataAccessError('storage_error');
  return Object.freeze(decoded);
}

/** Build only fixed SQL shapes from the validated catalogue; identifiers never come from bound data. */
export function compileDataPlan(entry: CompiledModel, state: ResolvedDataAuthorization, action: DataAction,
  input: unknown, list: boolean, internal?: InternalDataPortOptions,
  catalog?: ReadonlyMap<string, CompiledModel>): CompiledDataPlan {
  const { model } = entry;
  if (!entry.enabled || model.scope === 'application' && state.target.contextId !== 'application') throw new DataAccessError('forbidden');
  // Explicit actions/resources, never role names or a permission-id naming convention.
  // The signed-webhook host may plan a protected read guard without granting the
  // machine token general access to the vault model. It cannot mint a write plan.
  if (!(internal?.guardOnly === true && action === 'read' && !list)
    && !permits(entry, state, action)) throw new DataAccessError('forbidden');
  if (action === 'delete' && (model.deletion.mode !== 'hard' || model.deletion.requiresApproval)) throw new DataAccessError('unsupported');
  // Foreign keys establish integrity. This port additionally requires a readable
  // same-module parent and proves its presence in the write transaction.
  if (action !== 'read' && model.relations.some(relation => relation.target.moduleId !== entry.moduleId))
    throw new DataAccessError('unsupported');
  const captured = copyJson(input); record(captured);
  const fieldMap = new Map(model.fields.map(field => [field.id, field]));
  const internalFields = new Set(internal?.fields ?? []);
  const usable = (id: string) => {
    const field = fieldMap.get(id);
    if (!field || field.computed || (internal ? !internalFields.has(id) : field.protected)) throw new DataAccessError('forbidden');
    return field;
  };
  const primaryKey = model.primaryKey.filter(id => id !== model.contextField);
  if (primaryKey.length === 0) throw new DataAccessError('unsupported');
  const conditions: string[] = [], bindings: (string | number | null)[] = [];
  if (model.scope === 'context') { conditions.push(`${quote(model.contextField!)} = ?`); bindings.push(state.target.contextId); }
  function equalities(value: JsonValue | undefined, key = false) {
    record(value);
    const ids = Object.keys(value);
    if (ids.length > DATA_LIMITS.conditions || key && (ids.length !== primaryKey.length || primaryKey.some(id => !own(value, id))))
      throw new DataAccessError('invalid_input');
    for (const id of ids) {
      if (id === model.contextField) throw new DataAccessError('forbidden');
      const field = usable(id), encoded = encode(field, value[id]);
      conditions.push(`${quote(id)} IS ?`); bindings.push(encoded);
    }
  }
  function projection(value: JsonValue | undefined): readonly DataField[] {
    const selected = value === undefined ? storedFields(model).filter(f => (internal ? internalFields.has(f.id) : !f.protected) && f.id !== model.contextField).map(f => f.id) : value;
    if (!Array.isArray(selected) || selected.length === 0 || selected.length > DATA_LIMITS.fields
      || selected.some(id => typeof id !== 'string') || new Set(selected).size !== selected.length) throw new DataAccessError('invalid_input');
    return Object.freeze(selected.map(id => usable(id as string)));
  }
  const table = quote(entry.table), statements: SqlStatement[] = [];
  const add = (sql: string, values: readonly (string | number | null)[]) => {
    if (values.length > DATA_LIMITS.bindings) throw new DataAccessError('invalid_input');
    statements.push(Object.freeze({ sql, bindings: Object.freeze([...values]) }));
  };
  const guardRelation = (relation: DataModel['relations'][number], values: Readonly<Record<string, JsonValue>>) => {
    const parent = catalog?.get(fullId(entry.moduleId, relation.target.id));
    if (!parent || relation.target.kind !== 'model' || !parent.enabled
      || relation.fields.length !== relation.targetFields.length) throw new DataAccessError('invalid_catalog');
    if (!permits(parent, state, 'read')) throw new DataAccessError('forbidden');
    const relationValues = relation.fields.map(id => values[id]);
    if (relationValues.some(value => value === undefined)) throw new DataAccessError('unsupported');
    // SQLite composite foreign keys intentionally permit an optional (NULL)
    // relation; otherwise the parent must exist in this same atomic batch.
    if (relationValues.some(value => value === null)) return;
    const parentFields = new Map(parent.model.fields.map(field => [field.id, field]));
    if (relation.fields.some((id, i) => !fieldMap.has(id) || !parentFields.has(relation.targetFields[i])
      || fieldMap.get(id)!.type !== parentFields.get(relation.targetFields[i])!.type)
      || parent.model.scope === 'context' && !relation.fields.some((id, i) =>
        id === model.contextField && relation.targetFields[i] === parent.model.contextField))
      throw new DataAccessError('invalid_catalog');
    add(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${quote(parent.table)} WHERE ${relation.targetFields.map(id => `${quote(id)} IS ?`).join(' AND ')})
      THEN 1 ELSE json('creezio_data_relation') END AS allowed`, relation.fields.map(id => encode(fieldMap.get(id)!, values[id])));
  };
  if (action === 'read') {
    keys(captured, list ? ['limit'] : ['key'], list ? ['after','where','fields','order'] : ['where','fields','required']);
    if (captured.required !== undefined && typeof captured.required !== 'boolean') throw new DataAccessError('invalid_input');
    const fields = projection(captured.fields);
    if (captured.where !== undefined) equalities(captured.where);
    let limit = 1;
    let listKeys: readonly string[] = primaryKey, listDirection: 'asc' | 'desc' = 'asc';
    if (list) {
      if (!Number.isSafeInteger(captured.limit) || Number(captured.limit) < 1 || Number(captured.limit) > DATA_LIMITS.page) throw new DataAccessError('invalid_input');
      limit = Number(captured.limit);
      let orderedKeys = primaryKey, direction: 'asc' | 'desc' = 'asc';
      if (captured.order !== undefined) {
        const order = captured.order;
        record(order); keys(order, ['indexId', 'direction']);
        if (!validId(order.indexId) || !['asc', 'desc'].includes(String(order.direction)))
          throw new DataAccessError('invalid_input');
        const index = model.indexes.find(item => item.id === order.indexId);
        if (!index) throw new DataAccessError('invalid_input');
        if (model.scope === 'context' && index.fields[0] !== model.contextField) throw new DataAccessError('unsupported');
        orderedKeys = [...new Set([...index.fields, ...model.primaryKey])].filter(id => id !== model.contextField);
        direction = order.direction as 'asc' | 'desc';
      }
      for (const id of orderedKeys) {
        if (['boolean','json'].includes(usable(id).type)) throw new DataAccessError('unsupported');
        if (usable(id).nullable) throw new DataAccessError('unsupported');
        if (!fields.some(f => f.id === id)) throw new DataAccessError('invalid_input');
      }
      if (captured.after !== undefined && captured.after !== null) {
        record(captured.after); keys(captured.after, orderedKeys);
        const alternatives: string[] = [];
        for (let i = 0; i < orderedKeys.length; i++) {
          const terms: string[] = [];
          for (let j = 0; j <= i; j++) {
            const field = usable(orderedKeys[j]), value = captured.after[field.id];
            if (value === null || ['boolean','json'].includes(field.type)) throw new DataAccessError('unsupported');
            terms.push(`${quote(field.id)} ${j === i ? direction === 'asc' ? '>' : '<' : '='} ?`);
            bindings.push(encode(field, value));
          }
          alternatives.push(`(${terms.join(' AND ')})`);
        }
        conditions.push(`(${alternatives.join(' OR ')})`);
      }
      listKeys = orderedKeys; listDirection = direction;
    } else equalities(captured.key, true);
    if (captured.required === true) add(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${conditions.join(' AND ') || '1'})
      THEN 1 ELSE json('creezio_data_required') END AS allowed`, bindings);
    const pageSql = `SELECT ${fields.map(f => quote(f.id)).join(',')} FROM ${table} WHERE ${conditions.join(' AND ') || '1'}
      ORDER BY ${(list ? listKeys : primaryKey).map(id => `${quote(id)} ${list ? listDirection.toUpperCase() : 'ASC'}`).join(',')} LIMIT ?`;
    const pageBindings = [...bindings, list ? limit + 1 : 1];
    // Bound the selected payload BEFORE transfer to the Worker. SQLite's JSON
    // quoting accounts for UTF-8 and escaped control characters at their actual
    // size. Booleans decode to words, and JS may print a number more expansively
    // than SQLite (for example 1e20), so reserve fixed safe widths for those.
    // A JSON column may contain noncanonical numeric text written outside this
    // port (1e20 expands when JS serializes it); retain the general bound there.
    const names = fields.reduce((n, field) => n + new TextEncoder().encode(JSON.stringify(field.id)).length + 4, 3);
    const bytes = fields.map(field => {
      const column = quote(field.id);
      if (field.type === 'boolean') return `(CASE WHEN ${column} IS NULL THEN 4 ELSE 5 END)`;
      if (field.type === 'integer' || field.type === 'number') return `(CASE WHEN ${column} IS NULL THEN 4 ELSE 32 END)`;
      if (field.type === 'json') return `(6 * COALESCE(length(CAST(${column} AS BLOB)), 4))`;
      return `length(CAST(json_quote(${column}) AS BLOB))`;
    }).join(' + ');
    add(`SELECT CASE WHEN COALESCE(SUM(${names} + ${bytes}), 0) <= ? THEN 1
      ELSE json('creezio_data_result_limit') END AS allowed FROM (${pageSql}) AS bounded_page`,
    [DATA_LIMITS.resultBytes, ...pageBindings]);
    add(pageSql, pageBindings);
    return Object.freeze({ statements: Object.freeze(statements), resultIndex: statements.length - 1, write: false, fields,
      ...(list ? { list: Object.freeze({limit, keyFields: Object.freeze(listKeys)}) } : {}) });
  }
  keys(captured, action === 'create' ? ['values'] : action === 'update' ? ['key','values'] : ['key'],
    action === 'create' ? [] : ['compare','where']);
  const writeValues: Record<string, JsonValue> = Object.create(null);
  if (action !== 'delete') {
    record(captured.values);
    for (const [id, value] of Object.entries(captured.values)) {
      if (id === model.contextField || action === 'update' && model.primaryKey.includes(id)) throw new DataAccessError('forbidden');
      encode(usable(id), value); writeValues[id] = value;
    }
    if (action === 'create') {
      if (model.scope === 'context') writeValues[model.contextField!] = state.target.contextId;
      for (const field of storedFields(model)) {
        if (own(writeValues, field.id)) continue;
        if (own(field, 'default')) writeValues[field.id] = field.default!;
        else if (field.nullable) writeValues[field.id] = null;
        else throw new DataAccessError('invalid_input');
        encode(field, writeValues[field.id]);
      }
      for (const relation of model.relations) guardRelation(relation, writeValues);
      const fields = Object.keys(writeValues);
      add(`INSERT INTO ${table} (${fields.map(quote).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
        fields.map(id => encode(fieldMap.get(id)!, writeValues[id])));
      return Object.freeze({ statements: Object.freeze(statements), resultIndex: statements.length - 1,
        write: true, fields: Object.freeze([]) });
    }
  }
  if (action === 'update') for (const relation of model.relations) {
    if (!relation.fields.some(id => own(writeValues, id))) continue;
    record(captured.key); keys(captured.key, primaryKey);
    const relatedValues: Record<string, JsonValue> = { ...writeValues };
    for (const id of relation.fields) {
      if (id === model.contextField) relatedValues[id] = state.target.contextId;
      else if (!own(relatedValues, id) && own(captured.key, id)) relatedValues[id] = captured.key[id];
    }
    guardRelation(relation, relatedValues);
  }
  equalities(captured.key, true);
  if (captured.where !== undefined) equalities(captured.where);
  let compare: DataCompare | null = null;
  if (captured.compare !== undefined) {
    record(captured.compare); keys(captured.compare, ['field','expected']);
    if (typeof captured.compare.field !== 'string' || !Number.isSafeInteger(captured.compare.expected)
      || Number(captured.compare.expected) < 0 || Number(captured.compare.expected) >= Number.MAX_SAFE_INTEGER) throw new DataAccessError('invalid_input');
    const field = usable(captured.compare.field);
    if (field.type !== 'integer' || field.nullable || model.primaryKey.includes(field.id) || own(writeValues, field.id)) throw new DataAccessError('invalid_input');
    compare = { field: field.id, expected: Number(captured.compare.expected) };
    conditions.push(`${quote(field.id)} = ?`); bindings.push(encode(field, compare.expected));
    if (action === 'update') writeValues[field.id] = compare.expected + 1;
  }
  const where = conditions.join(' AND ');
  add(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${where}) THEN 1 ELSE json('creezio_data_conflict') END AS allowed`, bindings);
  if (action === 'delete') add(`DELETE FROM ${table} WHERE ${where}`, bindings);
  else {
    const fields = Object.keys(writeValues);
    if (!fields.length) throw new DataAccessError('invalid_input');
    add(`UPDATE ${table} SET ${fields.map(id => `${quote(id)} = ?`).join(',')} WHERE ${where}`,
      [...fields.map(id => encode(fieldMap.get(id)!, writeValues[id])), ...bindings]);
  }
  return Object.freeze({ statements: Object.freeze(statements), resultIndex: statements.length - 1,
    write: true, fields: Object.freeze([]) });
}
