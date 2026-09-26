import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { generateD1Schema, inspectD1Schema, sqlTableName, D1SchemaError } from '../../scripts/data/d1-schema.mjs';

const moduleId = 'example.data';
const field = (id, type = 'string', extra = {}) => ({ id, type, nullable: false, protected: false, computed: false, ...extra });
const model = (id = 'items', fields = [field('id')], extra = {}) => ({
  id, title: id, scope: 'application', fields, primaryKey: ['id'], indexes: [], relations: [], permissions: [],
  deletion: { mode: 'hard', requiresApproval: false }, public: false, ...extra
});
const relation = (target, fields = ['parent_id'], targetFields = ['id'], extra = {}) => ({
  id: 'parent', fields, target: { moduleId, kind: 'model', id: target }, targetFields, onDelete: 'restrict', ...extra
});
const rejects = (models, code) => assert.throws(() => generateD1Schema(moduleId, models), error => error instanceof D1SchemaError && error.code === code);
const quote = name => `"${name}"`;

async function database(t) {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status: 404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: ['DB'], d1Persist: false });
  t.after(async () => { await mf.dispose(); });
  return mf.getD1Database('DB');
}

async function apply(db, schema) {
  if (schema.statements.length) await db.batch(schema.statements.map(sql => db.prepare(sql)));
}

test('deterministic current-model SQL names, ordering and no implicit repair', () => {
  const models = [model('zeta'), model('alpha', [field('other'), field('id')], {
    indexes: [{ id: 'lookup', fields: ['other'], unique: true }]
  })];
  const before = JSON.stringify(models), generated = generateD1Schema(moduleId, models);
  assert.equal(sqlTableName('example.data', 'alpha'), `cz_${Buffer.from('example.data').toString('hex')}_${Buffer.from('alpha').toString('hex')}`);
  assert.notEqual(sqlTableName('a.b', 'c'), sqlTableName('a', 'b.c'));
  assert.equal(Object.getPrototypeOf(generated.tables), null);
  assert.deepEqual(Object.keys(generated.tables), ['alpha', 'zeta']);
  assert.deepEqual(generated, generateD1Schema(moduleId, structuredClone(models).reverse()));
  assert.equal(JSON.stringify(models), before);
  assert.equal(generated.statements.length, 3);
  assert.match(generated.statements[0], /"id" TEXT NOT NULL/);
  assert.match(generated.statements[0], /WITHOUT ROWID;/);
  assert.doesNotMatch(generated.sql, /IF NOT EXISTS|DROP |ALTER |INSERT |UPDATE /);
  assert.deepEqual(generateD1Schema(moduleId, []).statements, []);
  assert.equal(
    generateD1Schema(moduleId, [model('json_defaults', [field('id'), field('data', 'json', { default: { z: 1, a: { z: 2, a: 3 } } })])]).sql,
    generateD1Schema(moduleId, [model('json_defaults', [field('id'), field('data', 'json', { default: { a: { a: 3, z: 2 }, z: 1 } })])]).sql
  );
  for (const invalid of ['a"', '../app', 'A', '', null, {}, ['example.data']]) {
    assert.throws(() => sqlTableName(invalid, 'id'), { code: 'sql.id' });
  }
});

test('reject invalid model shape and executable inputs before reading or interpolating values', () => {
  rejects([{ ...model(), extra: true }], 'sql.model-shape');
  rejects([model('items', [field('id', 'unknown')])], 'sql.model-shape');
  let called = false;
  const getter = model();
  Object.defineProperty(getter, 'title', { enumerable: true, get() { called = true; return 'x'; } });
  rejects([getter], 'json.type');
  assert.equal(called, false);
  const values = [model()];
  Object.setPrototypeOf(values, { includes() { called = true; return true; } });
  rejects(values, 'json.type');
  assert.equal(called, false);
});

test('reject duplicate identifiers, absent fields and nullable primary keys', () => {
  rejects([model(), model()], 'sql.duplicate');
  rejects([model('items', [field('id'), field('id')])], 'sql.duplicate');
  rejects([model('items', [field('id', 'string', { nullable: true })])], 'sql.primary-key');
  rejects([model('items', [field('id')], { primaryKey: ['id', 'id'] })], 'sql.fields');
  rejects([model('items', [field('id')], { indexes: [{ id: 'missing', fields: ['absent'], unique: false }] })], 'sql.fields');
  rejects([model('items', [field('id')], { indexes: [{ id: 'same', fields: ['id'], unique: false }, { id: 'same', fields: ['id'], unique: true }] })], 'sql.duplicate');
  rejects([model('items', [field('id')], { permissions: [{ moduleId, kind: 'model', id: 'items' }] })], 'sql.permission');
});

test('unsupported computed columns, schema references, patterns and structural JSON enum fail explicitly', () => {
  rejects([model('items', [field('id', 'string', { computed: true })])], 'sql.unsupported-computed');
  rejects([model('items', [field('id', 'string', { schema: { schemaId: 'shape' } })])], 'sql.unsupported-schema');
  rejects([model('items', [field('id', 'string', { constraints: { pattern: '^x' } })])], 'sql.unsupported-pattern');
  rejects([model('items', [field('id'), field('data', 'json', { constraints: { enum: [{ a: 1 }] } })])], 'sql.unsupported-json-enum');
});

test('type-specific bounds and enum semantics are independently validated', () => {
  for (const entry of [field('id', 'string', { constraints: { minimum: 1 } }),
    field('id', 'boolean', { constraints: { maxLength: 2 } }),
    field('id', 'integer', { constraints: { minimum: 0.5 } }),
    field('id', 'date-time', { constraints: { maxLength: 23 } }),
    field('id', 'integer', { constraints: { minimum: 2, maximum: 1 } }),
    field('id', 'string', { constraints: { minLength: 2, maxLength: 1 } })]) rejects([model('items', [entry])], 'sql.constraints');
  for (const entry of [field('id', 'integer', { constraints: { enum: [1, '2'] } }),
    field('id', 'string', { constraints: { enum: ['same', 'same'] } }),
    field('id', 'boolean', { constraints: { enum: [null] } }),
    field('id', 'number', { constraints: { minimum: 1, enum: [0] } })]) rejects([model('items', [entry])], 'sql.enum');
});

test('invalid defaults cannot silently exploit SQLite affinity, null, enum or date normalization', () => {
  for (const entry of [field('id', 'integer', { default: '1' }), field('id', 'integer', { default: 1.1 }),
    field('id', 'integer', { default: Number.MAX_SAFE_INTEGER + 1 }), field('id', 'boolean', { default: 1 }),
    field('id', 'string', { default: null }), field('id', 'json', { default: null }),
    field('id', 'string', { default: 'x\0y' }), field('id', 'string', { default: '\ud800' }),
    field('id', 'string', { constraints: { minLength: 2 }, default: '😀' }),
    field('id', 'string', { constraints: { enum: ['a'] }, default: 'b' }),
    field('id', 'date-time', { default: '2026-02-30T12:00:00.000Z' }),
    field('id', 'date-time', { default: '2026-01-01T12:00:00Z' })]) rejects([model('items', [entry])], 'sql.default');
});

test('foreign keys must target exact keys of compatible same-module models', () => {
  const parent = model('parents', [field('id'), field('label')]);
  const child = model('children', [field('id'), field('parent_id')], { relations: [relation('parents')] });
  for (const target of [{ moduleId: 'other.module', kind: 'model', id: 'parents' }]) {
    rejects([parent, { ...child, relations: [relation('parents', undefined, undefined, { target })] }], 'sql.unsupported-relation');
  }
  rejects([parent, { ...child, relations: [relation('parents', undefined, undefined, { via: { moduleId, kind: 'publicContract', id: 'port' } })] }], 'sql.unsupported-relation');
  rejects([child], 'sql.relation-target');
  rejects([parent, { ...child, relations: [relation('parents', ['parent_id'], ['label'])] }], 'sql.relation-key');
  rejects([parent, { ...child, fields: [field('id'), field('parent_id', 'integer')] }], 'sql.relation-type');
  rejects([parent, { ...child, relations: [relation('parents', ['parent_id'], ['id', 'label'])] }], 'sql.relation-type');
  rejects([parent, { ...child, relations: [relation('parents', undefined, undefined, { onDelete: 'set-null' })] }], 'sql.relation-null');
});

test('context foreign keys retain the exact source-to-target context position', () => {
  const parent = model('parents', [field('id'), field('context_id')], { scope: 'context', contextField: 'context_id', primaryKey: ['context_id', 'id'] });
  const child = model('children', [field('id'), field('parent_id'), field('context_id')], {
    scope: 'context', contextField: 'context_id', relations: [relation('parents', ['context_id', 'parent_id'], ['context_id', 'id'])]
  });
  assert.equal(generateD1Schema(moduleId, [parent, child]).statements.length, 2);
  rejects([parent, { ...child, relations: [relation('parents', ['parent_id', 'context_id'], ['context_id', 'id'])] }], 'sql.relation-context');
  rejects([{ ...parent, contextField: 'absent' }], 'sql.context');
  rejects([model('items', [field('id')], { contextField: 'id' })], 'sql.context');
});

test('generated schemas respect D1 column and statement byte limits', () => {
  rejects([model('items', [field('id'), ...Array.from({ length: 100 }, (_, index) => field(`f${index}`))])], 'sql.limit-columns');
  rejects([model('items', [field('id', 'string', { constraints: { enum: Array.from({ length: 1000 }, (_, index) => `${index}-${'a'.repeat(120)}`) } })])], 'sql.limit-statement');
});

test('real D1 enforces required keys, types, JSON, scalar bounds, enums and defaults', { timeout: 30000 }, async t => {
  const db = await database(t);
  const models = [model('values', [field('id'),
    field('active', 'boolean', { default: true }),
    field('count', 'integer', { default: 2, constraints: { minimum: 1, maximum: 3 } }),
    field('ratio', 'number', { default: 1.5, constraints: { minimum: 0, maximum: 2 } }),
    field('state', 'string', { default: 'ready', constraints: { enum: ['ready', 'done'] } }),
    field('label', 'string', { default: "O'Brien", constraints: { minLength: 1, maxLength: 100 } }),
    field('short', 'string', { default: '😀', constraints: { minLength: 1, maxLength: 1 } }),
    field('created_at', 'date-time', { default: '2026-09-26T12:00:00.000Z' }),
    field('data', 'json', { default: { apostrophe: "O'Brien", nested: [1, true] } }),
    field('optional', 'string', { nullable: true, default: null })]),
  model('integer_keys', [field('id', 'integer')])];
  const schema = generateD1Schema(moduleId, models), table = quote(schema.tables.values);
  await apply(db, schema);
  await db.prepare(`INSERT INTO ${table} (id) VALUES (?)`).bind('good').run();
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind('good').first();
  assert.equal(row.active, 1); assert.equal(row.count, 2); assert.equal(row.ratio, 1.5);
  assert.equal(row.label, "O'Brien"); assert.equal(row.short, '😀'); assert.equal(row.optional, null);
  assert.deepEqual(JSON.parse(row.data), { apostrophe: "O'Brien", nested: [1, true] });
  for (const [column, value] of [['active', 2], ['count', 1.5], ['count', 4], ['count', 'bad'], ['ratio', 3],
    ['state', 'missing'], ['label', ''], ['label', 'a\0b'], ['short', 'ab'], ['data', '{broken'],
    ['created_at', '2026-02-30T12:00:00.000Z'], ['created_at', '2026-09-26T12:00:00Z'], ['created_at', 'invalid']]) {
    await assert.rejects(db.prepare(`INSERT INTO ${table} (id, ${quote(column)}) VALUES (?, ?)`).bind(`bad-${column}`, value).run(), /CHECK constraint failed/);
  }
  await assert.rejects(db.prepare(`INSERT INTO ${table} (id) VALUES (NULL)`).run(), /NOT NULL constraint failed/);
  await assert.rejects(db.prepare(`INSERT INTO ${quote(schema.tables.integer_keys)} (id) VALUES (NULL)`).run(), /NOT NULL constraint failed/);
  await assert.rejects(db.prepare(`INSERT INTO ${quote(schema.tables.integer_keys)} (id) VALUES (?)`).bind(Number.MAX_SAFE_INTEGER + 1).run(), /CHECK constraint failed/);
  assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 1);
  assert.deepEqual(await inspectD1Schema(db, moduleId, models), { ok: true, errors: [] });
});

test('real D1 nullable enums, unique keys, foreign keys and rollback remain enforced', { timeout: 30000 }, async t => {
  const db = await database(t);
  const models = [model('parents', [field('id'), field('code'), field('optional', 'string', { nullable: true })], {
    indexes: [{ id: 'code_unique', fields: ['code'], unique: true }, { id: 'nullable_unique', fields: ['optional'], unique: true }]
  }), model('children', [field('id'), field('parent_code', 'string', { nullable: true }),
    field('choice', 'string', { nullable: true, default: null, constraints: { enum: [null, 'yes'] } }),
    field('null_only', 'string', { nullable: true, default: null, constraints: { enum: [null] } })], {
    relations: [relation('parents', ['parent_code'], ['code'], { onDelete: 'set-null' })]
  })];
  const schema = generateD1Schema(moduleId, models), parents = quote(schema.tables.parents), children = quote(schema.tables.children);
  await apply(db, schema);
  await db.prepare(`INSERT INTO ${parents} (id, code) VALUES ('a', 'first'), ('b', 'second')`).run();
  await assert.rejects(db.prepare(`INSERT INTO ${parents} (id, code) VALUES ('c', 'first')`).run(), /UNIQUE constraint failed/);
  await assert.rejects(db.prepare(`INSERT INTO ${children} (id, parent_code) VALUES ('orphan', 'absent')`).run(), /FOREIGN KEY constraint failed/);
  await db.prepare(`INSERT INTO ${children} (id, parent_code) VALUES ('child', 'first')`).run();
  await assert.rejects(db.prepare(`INSERT INTO ${children} (id, choice) VALUES ('wrong', 'no')`).run(), /CHECK constraint failed/);
  await assert.rejects(db.prepare(`INSERT INTO ${children} (id, null_only) VALUES ('wrong', 'yes')`).run(), /CHECK constraint failed/);
  await db.prepare(`DELETE FROM ${parents} WHERE id = 'a'`).run();
  assert.equal((await db.prepare(`SELECT parent_code FROM ${children} WHERE id = 'child'`).first()).parent_code, null);
  await assert.rejects(db.batch([
    db.prepare(`INSERT INTO ${parents} (id, code) VALUES ('rollback', 'rollback')`),
    db.prepare(`INSERT INTO ${children} (id, parent_code) VALUES ('fail', 'missing')`)
  ]), /FOREIGN KEY constraint failed/);
  assert.equal(await db.prepare(`SELECT id FROM ${parents} WHERE id = 'rollback'`).first(), null);
  assert.equal((await inspectD1Schema(db, moduleId, models)).ok, true);
});

test('read-only schema inspection refuses missing, changed and extra module objects, not other modules', { timeout: 30000 }, async t => {
  const db = await database(t), models = [model()];
  const generated = generateD1Schema(moduleId, models), table = quote(generated.tables.items);
  const missing = await inspectD1Schema(db, moduleId, models);
  assert.equal(missing.ok, false); assert.equal(missing.errors[0].code, 'sql.drift-missing');
  await apply(db, generated);
  await apply(db, generateD1Schema('other.module', models));
  assert.equal((await inspectD1Schema(db, moduleId, models)).ok, true);
  await db.prepare(`INSERT INTO ${table} (id) VALUES ('preserved')`).run();
  await db.prepare(`CREATE INDEX unrelated_name ON ${table} (id)`).run();
  const extra = await inspectD1Schema(db, moduleId, models);
  assert.equal(extra.ok, false); assert.ok(extra.errors.some(error => error.code === 'sql.drift-extra' && error.name === 'unrelated_name'));
  await db.prepare('DROP INDEX unrelated_name').run();
  await db.prepare(`CREATE TRIGGER outside_namespace AFTER INSERT ON ${table} BEGIN SELECT 1; END`).run();
  assert.ok((await inspectD1Schema(db, moduleId, models)).errors.some(error => error.code === 'sql.drift-extra' && error.name === 'outside_namespace'));
  await db.prepare('DROP TRIGGER outside_namespace').run();
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN unexpected TEXT`).run();
  const changed = await inspectD1Schema(db, moduleId, models);
  assert.equal(changed.ok, false); assert.ok(changed.errors.some(error => error.code === 'sql.drift-definition'));
  assert.equal((await db.prepare(`SELECT id FROM ${table}`).first()).id, 'preserved');
  assert.equal((await db.prepare(`PRAGMA table_info(${table})`).all()).results.some(column => column.name === 'unexpected'), true);
  assert.deepEqual(await inspectD1Schema({}, moduleId, models), { ok: false, errors: [{ code: 'sql.inspect-unavailable', message: 'The current database schema could not be read.' }] });
});
