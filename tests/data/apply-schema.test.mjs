import '../../scripts/local-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { temporaryDirectory } from '../quality/temporary.mjs';
import { compileCompositionSchema, schemaDigest } from '../../scripts/data/composition-schema.mjs';
import { applyCompositionSchema, inspectCompositionSchema, inspectManagedSchema, managedSchemaGuard, SCHEMA_RECEIPT_TABLE, D1_INTERNAL_SCHEMA_OBJECTS } from '../../scripts/data/apply-schema.mjs';
import { loadAccessInstallPlan, installAccess, inspectAccessInstallation } from '../../scripts/data/install-access.mjs';
import { contractIntegrity, canonicalJson } from '../../sdk/contracts/validate.mjs';
import { describeD1Schema } from '../../scripts/data/d1-schema.mjs';
import { RUNTIME_STORAGE_MODULE_ID, RUNTIME_MODELS } from '../../scripts/data/runtime-models.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const hostObjectCount = describeD1Schema(RUNTIME_STORAGE_MODULE_ID, RUNTIME_MODELS).objects.length;
const syntheticPassword = ['synthetic', 'password', 'for', 'isolated', 'd1', 'test'].join('-');
const json = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const field = (id, type = 'string', extra = {}) => ({ id, type, nullable: false, protected: true, computed: false, ...extra });
const model = (id, extra = {}) => ({ id, title: id, scope: 'application', fields: [field('id'), field('label')],
  primaryKey: ['id'], indexes: [], relations: [], permissions: [], deletion: { mode: 'hard', requiresApproval: false }, public: false, ...extra });
function planFor(models, { enabled = true, removed = false, access = false, moduleId = 'example.data' } = {}) {
  const composition = json('../../configuration/composition.json'), lock = json('../../configuration/composition.lock.json');
  // The shared checkout can have a new SDK declaration before its production lock is frozen.
  // This fixture binds a coherent in-memory lock and never rewrites the deployed lock.
  lock.sdkVersion = composition.sdk.version;
  const original = json('../../extensions/native/access/module/manifest.json');
  const module = JSON.parse(JSON.stringify(original).replaceAll('creezio.access', moduleId));
  // Permissions are outside the SQL compiler; the isolated fixture omits their module grants.
  module.contracts.models = models.map(item => ({ ...item, permissions: [] }));
  // This fixture exercises additive data publication, not Access contributions.
  // Drop references to the native models replaced by the synthetic declarations.
  module.contracts.schemas = [];
  module.contracts.permissions = [];
  module.contracts.operations = [];
  module.contracts.api = [];
  module.contracts.mcp = { tools: [], resources: [], prompts: [], skills: [] };
  module.contracts.ui = { ...module.contracts.ui, views: [], navigation: [], slots: [], styles: [] };
  const selection = { ...structuredClone(composition.modules[0]), moduleId: module.identity.id, enabled };
  const pinned = { ...structuredClone(lock.modules[0]), moduleId: module.identity.id, contractIntegrity: contractIntegrity(module) };
  const descriptors = access ? [original] : [];
  // Keep only the Access fixture when requested; the production composition also contains modules-settings.
  composition.modules = access ? composition.modules.filter(item => item.moduleId === 'creezio.access') : [];
  lock.modules = access ? lock.modules.filter(item => item.moduleId === 'creezio.access') : [];
  composition.exposure.admin.moduleIds = access
    ? composition.exposure.admin.moduleIds.filter(id => id === 'creezio.access') : [];
  composition.exposure.app.moduleIds = access
    ? composition.exposure.app.moduleIds.filter(id => id === 'creezio.access') : [];
  if (!removed) {
    composition.modules.push(selection); lock.modules.push(pinned); descriptors.push(module);
    if (enabled) { composition.exposure.admin.moduleIds.push(module.identity.id); composition.exposure.app.moduleIds.push(module.identity.id); }
  }
  lock.compositionIntegrity = contractIntegrity(composition);
  return compileCompositionSchema({ composition, lock, modules: descriptors });
}
const apply = (db, plan) => applyCompositionSchema(db, plan, { expectedPlanDigest: plan.planDigest });
const table = (plan, id = 'items', moduleId = 'example.data') => plan.runtimeCatalog.modules.find(module => module.moduleId === moduleId).models.find(item => item.modelId === id).table;
const objects = async db => (await db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(row => row.name);
function wrapBatch(db, intercept) { return { prepare: sql => db.prepare(sql), batch: statements => intercept(statements) }; }
function sampleValue(field) {
  const constraints = field.constraints ?? {};
  if (constraints.enum?.length) return constraints.enum.find(value => value !== null);
  if (field.type === 'boolean') return 0;
  if (field.type === 'integer' || field.type === 'number') return Math.max(1, constraints.minimum ?? 1);
  if (field.type === 'date-time') return '2026-09-30T00:00:00.000Z';
  if (field.type === 'json') return '{}';
  return 'x'.repeat(Math.max(1, constraints.minLength ?? 1));
}
async function insertSample(db, plan, moduleId, item) {
  const fields = item.fields.filter(field => !field.nullable);
  const names = fields.map(field => `"${field.id}"`).join(',');
  await db.prepare(`INSERT INTO "${table(plan, item.id, moduleId)}" (${names}) VALUES (${fields.map(() => '?').join(',')})`)
    .bind(...fields.map(sampleValue)).run();
}

test('hosted D1 provider table is accepted only with its exact sqlite_schema definition', async () => {
  const plan=planFor([model('items')]);
  const provider=D1_INTERNAL_SCHEMA_OBJECTS.find(item=>item.name==='_cf_KV');
  assert.deepEqual(provider,{type:'table',name:'_cf_KV',table:'_cf_KV',
    sql:'CREATE TABLE _cf_KV (\n        key TEXT PRIMARY KEY,\n        value BLOB\n      ) WITHOUT ROWID'});
  const inspected=[];
  const db=(sql,name='_cf_KV')=>({prepare(query){
    const statement={bind(...params){inspected.push({query,params});return statement;},
      async all(){
        if(query.startsWith('SELECT COUNT(*) AS count'))return {success:true,results:[
          {count:1,bytes:Buffer.byteLength(sql)}]};
        if(query.startsWith('SELECT type, name, tbl_name'))return {success:true,results:[
          {type:'table',name,tbl_name:name,sql}]};
        throw new Error('Unexpected schema query.');
      }};
    return statement;
  }});
  assert.equal((await inspectCompositionSchema(db(provider.sql),plan)).state,'additive');
  const guard=managedSchemaGuard(db(provider.sql),[]);
  assert.ok(guard);
  assert.ok(inspected.some(item=>item.query.includes('FROM sqlite_schema s')
    &&JSON.parse(item.params[1]).some(object=>object.name==='_cf_KV'&&object.sql===provider.sql)));
  assert.equal((await inspectCompositionSchema(db(provider.sql.replace('value BLOB','value TEXT')),plan)).code,
    'schema.foreign');
  assert.equal((await inspectCompositionSchema(db('CREATE TABLE _cf_EXTRA (value BLOB)','_cf_EXTRA'),plan)).code,
    'schema.foreign');
});

test('central additive publication with real D1, isolated ephemeral bindings', async t => {
  const names = Array.from({ length: 17 }, (_, i) => `DB${i}`);
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status:404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: names, d1Persist: false });
  try {
    let cursor = 0;
    const db = () => mf.getD1Database(names[cursor++]);
    await t.test('exact approval and branded plans precede writes; first publication and repeat are explicit', async () => {
      const database = await db(), plan = planFor([model('items')]);
      assert.equal((await applyCompositionSchema(database, plan, { expectedPlanDigest: 'wrong' })).effect, 'none');
      assert.equal((await apply(database, structuredClone(plan))).code, 'schema.approval-mismatch');
      assert.deepEqual(await objects(database), []);
      assert.equal((await inspectCompositionSchema(database, plan)).state, 'additive');
      const result = await apply(database, plan); assert.equal(result.ok, true); assert.equal(result.effect, 'confirmed');
      assert.equal((await apply(database, plan)).effect, 'none');
      assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n, 1);
    });
    await t.test('legacy receipts remain inspectable and gain a lock proof without recreating data',async()=>{
      const database=await db(),plan=planFor([model('items')]);
      assert.equal((await apply(database,plan)).ok,true);
      await database.prepare(`INSERT INTO "${table(plan)}" (id,label) VALUES ('one','preserved')`).run();
      const current=await inspectManagedSchema(database);
      assert.equal(current.receipt.lockDigest,plan.lockDigest);
      const legacy={...current.receipt};delete legacy.lockDigest;
      const payload=canonicalJson(legacy),id=schemaDigest(payload);
      await database.prepare(`UPDATE ${SCHEMA_RECEIPT_TABLE} SET id=?,payload=? WHERE sequence=1`)
        .bind(id,payload).run();
      assert.equal((await inspectManagedSchema(database)).ok,true);
      const inspected=await inspectCompositionSchema(database,plan);
      assert.equal(inspected.state,'additive');assert.equal(inspected.additions.length,0);
      assert.equal((await apply(database,plan)).ok,true);
      const updated=await inspectManagedSchema(database);
      assert.equal(updated.receipt.sequence,2);assert.equal(updated.receipt.previousId,id);
      assert.equal(updated.receipt.lockDigest,plan.lockDigest);
      assert.equal((await database.prepare(`SELECT label FROM "${table(plan)}" WHERE id='one'`).first()).label,'preserved');
    });
    await t.test('new tables and indexes are additive, existing records survive disabled and removed modules', async () => {
      const database = await db(), first = planFor([model('items')]);
      assert.equal((await apply(database, first)).ok, true);
      await database.prepare(`INSERT INTO "${table(first)}" (id,label) VALUES (?,?)`).bind('one', 'preserved').run();
      const next = planFor([model('items', { indexes: [{ id: 'label', fields: ['label'], unique: false }] }), model('notes')]);
      const inspected = await inspectCompositionSchema(database, next); assert.equal(inspected.additions.length, 2);
      assert.equal((await apply(database, next)).ok, true);
      const disabled = planFor([model('items', { indexes: [{ id: 'label', fields: ['label'], unique: false }] }), model('notes')],
        { enabled: false });
      assert.equal((await apply(database, disabled)).ok, true);
      const removed = planFor([], { removed: true }); assert.equal((await apply(database, removed)).ok, true);
      assert.equal((await database.prepare(`SELECT label FROM "${table(first)}" WHERE id='one'`).first()).label, 'preserved');
      assert.equal((await inspectManagedSchema(database)).receipt.objects.length, hostObjectCount + 3);
    });
    await t.test('nullable columns preserve rows and exact physical SQL through a second extension', async () => {
      const database = await db(), first = planFor([model('items')]);
      assert.equal((await apply(database, first)).ok, true);
      await database.prepare(`INSERT INTO "${table(first)}" (id,label) VALUES ('one','preserved')`).run();
      const second = planFor([model('items', { fields: [...model('items').fields, field('note', 'string', { nullable: true })],
        indexes: [{ id: 'note', fields: ['note'], unique: false }] })]);
      assert.equal((await inspectCompositionSchema(database, second)).state, 'additive');
      assert.equal((await apply(database, second)).ok, true);
      const managed = await inspectManagedSchema(database);
      assert.equal(managed.ok, true);
      assert.equal(managed.receipt.logicalTables.length, 1);
      assert.equal(managed.receipt.logicalTables[0].logicalDigest,
        schemaDigest(second.objects.find(object => object.name === table(second)).sql));
      assert.equal(managed.receipt.objects.find(object => object.name === table(second)).sql,
        (await database.prepare('SELECT sql FROM sqlite_schema WHERE name=?').bind(table(second)).first()).sql);
      assert.deepEqual(await database.prepare(`SELECT label,note FROM "${table(second)}" WHERE id='one'`).first(),
        { label: 'preserved', note: null });
      const third = planFor([model('items', { fields: [...model('items').fields,
        field('note', 'string', { nullable: true }), field('tag', 'string', { nullable: true })],
        indexes: [{ id: 'note', fields: ['note'], unique: false }] })]);
      assert.equal((await apply(database, third)).ok, true);
      assert.equal((await inspectCompositionSchema(database, third)).state, 'ready');
      assert.deepEqual(await database.prepare(`SELECT label,note,tag FROM "${table(third)}" WHERE id='one'`).first(),
        { label: 'preserved', note: null, tag: null });
    });
    await t.test('changed columns and external DDL are blocked without repair', async () => {
      const database = await db(), first = planFor([model('items')]); await apply(database, first);
      const changed = planFor([model('items', { fields: [field('id'), field('label', 'integer')] })]);
      assert.equal((await apply(database, changed)).code, 'schema.incompatible');
      await database.prepare('CREATE TABLE foreign_table (id TEXT)').run();
      assert.equal((await apply(database, first)).code, 'schema.drift');
      assert.ok((await objects(database)).includes('foreign_table'));
    });
    await t.test('omitting a selected model index is incompatible; removing its module retains the object', async () => {
      const database = await db();
      const indexed = planFor([model('items', { indexes: [{ id: 'label', fields: ['label'], unique: false }] })]);
      assert.equal((await apply(database, indexed)).ok, true);
      assert.equal((await inspectCompositionSchema(database, planFor([model('items')]))).code, 'schema.incompatible');
      const removed = planFor([], { removed: true });
      assert.equal((await apply(database, removed)).ok, true);
      assert.equal((await inspectManagedSchema(database)).receipt.objects.some(object =>
        object.name.endsWith('_idx_6c6162656c')), true);
    });
    await t.test('partial schemas and unknown tables cannot be silently adopted', async () => {
      const database = await db(), plan = planFor([model('items'), model('notes')]);
      await database.prepare(plan.statements[0]).run();
      assert.equal((await apply(database, plan)).code, 'schema.partial');
      assert.equal((await objects(database)).length, 1);
    });
    await t.test('foreign object created after inspection aborts CREATE and receipt in the same D1 batch', async () => {
      const database = await db(), plan = planFor([model('items')]); let injected = false;
      const wrapped = wrapBatch(database, async statements => {
        if (!injected) { injected = true; await database.prepare('CREATE TABLE foreign_table (id TEXT)').run(); }
        return database.batch(statements);
      });
      const result = await apply(wrapped, plan); assert.equal(result.effect, 'unknown'); assert.equal(result.ok, false);
      assert.deepEqual(await objects(database), ['foreign_table']);
    });
    await t.test('late failure rolls back all DDL and the receipt', async () => {
      const database = await db(), plan = planFor([model('items')]);
      const wrapped = wrapBatch(database, statements => database.batch([...statements, database.prepare("SELECT json('invalid-json')")]));
      assert.equal((await apply(wrapped, plan)).effect, 'unknown');
      assert.deepEqual(await objects(database), []);
    });
    await t.test('lost acknowledgement is reconciled with this exact immutable receipt and no second write', async () => {
      const database = await db(), plan = planFor([model('items')]); let lost = false, writes = 0;
      const wrapped = wrapBatch(database, async statements => {
        const result = await database.batch(statements);
        if (!lost) { lost = true; writes++; throw new Error('synthetic lost acknowledgement'); }
        return result;
      });
      const result = await apply(wrapped, plan); assert.equal(result.ok, true); assert.equal(result.effect, 'confirmed');
      assert.equal(writes, 1); assert.equal((await inspectCompositionSchema(database, plan)).receiptId, result.receiptId);
    });
    await t.test('concurrent initial publication has exactly one committed receipt', async () => {
      const database = await db(), plan = planFor([model('items')]);
      const results = await Promise.all([apply(database, plan), apply(database, plan)]);
      assert.ok(results.some(result => result.ok));
      assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n, 1);
      assert.equal((await inspectCompositionSchema(database, plan)).state, 'ready');
    });
    await t.test('a failing new unique index leaves the old receipt and data untouched', async () => {
      const database = await db(), first = planFor([model('items')]); await apply(database, first);
      const previous = (await inspectCompositionSchema(database, first)).receiptId;
      await database.batch(['a', 'b'].map(id => database.prepare(`INSERT INTO "${table(first)}" (id,label) VALUES (?, 'same')`).bind(id)));
      const next = planFor([model('items', { indexes: [{ id: 'unique-label', fields: ['label'], unique: true }] }), model('notes')]);
      assert.equal((await apply(database, next)).ok, false);
      assert.equal((await inspectCompositionSchema(database, first)).receiptId, previous);
      assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM "${table(first)}"`).first()).n, 2);
      assert.equal((await objects(database)).length, hostObjectCount + 2);
    });
    await t.test('receipt tampering is refused and cannot become executable SQL', async () => {
      const database = await db(), plan = planFor([model('items')]); await apply(database, plan);
      await database.prepare(`UPDATE ${SCHEMA_RECEIPT_TABLE} SET payload=json_set(payload, '$.sqlDigest', ?)`).bind('sha256-' + '0'.repeat(64)).run();
      assert.equal((await apply(database, plan)).code, 'schema.receipt-invalid');
      assert.ok((await objects(database)).includes(table(plan)));
    });
    await t.test('a concurrent additive plan cannot append against a stale receipt head', async () => {
      const database = await db(), first = planFor([model('items')]); await apply(database, first);
      const candidates = [planFor([model('items'), model('left')]), planFor([model('items'), model('right')])];
      let waiting = 0, release;
      const barrier = new Promise(resolve => { release = resolve; });
      const wrapped = wrapBatch(database, async statements => {
        if (statements.length > 3) { if (++waiting === 2) release(); await barrier; }
        return database.batch(statements);
      });
      const results = await Promise.all(candidates.map(plan => apply(wrapped, plan)));
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal(results.filter(result => result.effect === 'unknown').length, 1);
      assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n, 2);
      assert.equal((await inspectManagedSchema(database)).receipt.objects.length, hostObjectCount + 2);
    });
    await t.test('an unavailable reconciliation never claims rollback or retries a lost write', async () => {
      const database = await db(), plan = planFor([model('items')]); let written = false, attempts = 0;
      const wrapped = { prepare(sql) { if (written) throw new Error('synthetic read outage'); return database.prepare(sql); },
        async batch(statements) { attempts++; await database.batch(statements); written = true; throw new Error('synthetic response outage'); } };
      const result = await apply(wrapped, plan);
      assert.equal(result.effect, 'unknown'); assert.equal(result.observedState, 'unavailable'); assert.equal(result.ok, false);
      assert.equal(attempts, 1); assert.equal((await inspectCompositionSchema(database, plan)).state, 'ready');
    });
    await t.test('initialized native Access remains permanently closed after composed additions', async () => {
      const database = await db(), native = loadAccessInstallPlan(root);
      const installed = await installAccess(database, native, { credentials: { loginIdentifier: 'operator@example.invalid',
        displayName: 'Synthetic operator', password: syntheticPassword }, expectedSqlDigest: native.sqlDigest, createSchema: true });
      assert.equal(installed.ok, true);
      const plan = planFor([model('items')], { access: true }); assert.equal((await apply(database, plan)).ok, true);
      assert.equal((await inspectAccessInstallation(database, native)).state, 'initialized');
      const again = await installAccess(database, native, { credentials: { loginIdentifier: 'other@example.invalid', displayName: 'Other',
        password: syntheticPassword }, expectedSqlDigest: native.sqlDigest, createSchema: true });
      assert.equal(again.code, 'already_initialized');
      assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM "${native.tables.principals}"`).first()).n, 1);
    });
    await t.test('composed schema does not authorize a new bootstrap when the marker is unconsumed', async () => {
      const database = await db(), native = loadAccessInstallPlan(root), plan = planFor([model('items')], { access: true });
      assert.equal((await apply(database, plan)).ok, true);
      assert.equal((await inspectAccessInstallation(database, native)).state, 'blocked');
      assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM "${native.tables.principals}"`).first()).n, 0);
    });
  } finally { await mf.dispose(); }
});

test('composed data and the immutable receipt survive a local D1 adapter restart', async t => {
  const directory = temporaryDirectory(t, 'creezio-composed-schema-');
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status:404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: { DB: '00000000-0000-4000-8000-000000000001' }, d1Persist: directory };
  const plan = planFor([model('items')]); let firstReceipt;
  let mf = new Miniflare(options);
  try {
    const database = await mf.getD1Database('DB'); firstReceipt = (await apply(database, plan)).receiptId;
    await database.prepare(`INSERT INTO "${table(plan)}" (id,label) VALUES ('persisted','after restart')`).run();
  } finally { await mf.dispose(); }
  mf = new Miniflare(options);
  try {
    const database = await mf.getD1Database('DB');
    assert.equal((await inspectCompositionSchema(database, plan)).receiptId, firstReceipt);
    assert.equal((await apply(database, plan)).effect, 'none');
    assert.equal((await database.prepare(`SELECT label FROM "${table(plan)}" WHERE id='persisted'`).first()).label, 'after restart');
  } finally { await mf.dispose(); }
});

test('the four deployed model changes migrate old rows with their real table, index and FK definitions', async t => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status:404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: ['STRIPE', 'MESSAGING', 'MESSAGING-INBOUND', 'SUPPORT'], d1Persist: false });
  const cases = [
    { binding: 'STRIPE', moduleId: 'creezio.stripe', path: '../../extensions/connectors/stripe/module/models.json',
      added: { connector_config: ['checkout_return_origin', 'webhook_key_ref', 'webhook_secret_version',
        'webhook_previous_key_ref', 'webhook_previous_secret_version', 'webhook_service_token_ref',
        'webhook_service_token_version'], stripe_subscription: ['cancel_at_period_end'] },
      rows: ['connector_config', 'stripe_subscription'] },
    { binding: 'MESSAGING', moduleId: 'creezio.messaging', path: '../../extensions/native/messaging/module/models.json',
      added: { draft: ['send_intent_id'] }, rows: ['box', 'draft'] },
    { binding: 'SUPPORT', moduleId: 'creezio.support', path: '../../extensions/native/support/module/models.json',
      added: { ticket: ['contact_id', 'message_box_id', 'message_id'] }, rows: ['ticket'] },
  ];
  try {
    for (const item of cases) await t.test(item.moduleId, async () => {
      const current = json(item.path), prior = structuredClone(current);
      for (const previousModel of prior) previousModel.fields = previousModel.fields.filter(field =>
        !(item.added[previousModel.id] ?? []).includes(field.id));
      const oldPlan = planFor(prior, { moduleId: item.moduleId });
      const nextPlan = planFor(current, { moduleId: item.moduleId });
      const database = await mf.getD1Database(item.binding);
      assert.equal((await apply(database, oldPlan)).ok, true);
      for (const id of item.rows) await insertSample(database, oldPlan, item.moduleId, prior.find(model => model.id === id));
      const before = await inspectManagedSchema(database);
      assert.equal(before.ok, true);
      const inspected = await inspectCompositionSchema(database, nextPlan);
      assert.equal(inspected.state, 'additive');
      assert.equal(inspected.columnAdditions.length, Object.keys(item.added).length);
      assert.equal(inspected.columnAdditions.reduce((total, entry) => total + entry.columns.length, 0),
        Object.values(item.added).reduce((total, fields) => total + fields.length, 0));
      assert.equal((await apply(database, nextPlan)).ok, true);
      const after = await inspectManagedSchema(database);
      assert.equal(after.ok, true);
      assert.equal(after.receipt.sequence, before.receipt.sequence + 1);
      assert.equal(after.receipt.previousId, before.receiptId);
      assert.equal((await inspectCompositionSchema(database, nextPlan)).state, 'ready');
      for (const id of item.rows) {
        const columns = item.added[id] ?? [];
        const row = await database.prepare(`SELECT * FROM "${table(nextPlan, id, item.moduleId)}" LIMIT 1`).first();
        assert.ok(row);
        for (const name of columns) assert.equal(row[name], null);
      }
      for (const changed of after.receipt.logicalTables) {
        const physical = after.receipt.objects.find(object => object.name === changed.name);
        assert.equal(physical.sql,
          (await database.prepare('SELECT sql FROM sqlite_schema WHERE name=?').bind(changed.name).first()).sql);
      }
    });
    await t.test('deployed Messaging seven-model data survives its exact two inbound tables and indexes', async () => {
      const moduleId = 'creezio.messaging';
      const current = json('../../extensions/native/messaging/module/models.json');
      const inbound = new Set(['inbound_snapshot', 'inbound_stage_receipt']);
      const prior = current.filter(item => !inbound.has(item.id));
      assert.equal(prior.length, 7);
      const oldPlan = planFor(prior, { moduleId });
      const nextPlan = planFor(current, { moduleId });
      const database = await mf.getD1Database('MESSAGING-INBOUND');
      assert.equal((await apply(database, oldPlan)).ok, true);
      await insertSample(database, oldPlan, moduleId, prior.find(item => item.id === 'box'));
      const oldBox = await database.prepare(`SELECT * FROM "${table(oldPlan, 'box', moduleId)}" LIMIT 1`).first();
      const before = await inspectManagedSchema(database);
      const inspected = await inspectCompositionSchema(database, nextPlan);
      assert.equal(inspected.state, 'additive');
      assert.equal(inspected.columnAdditions.length, 0);
      const inboundTables = new Set([...inbound].map(id => table(nextPlan, id, moduleId)));
      const additions = inspected.additions.map(item => item.name).sort();
      const expected = nextPlan.objects.filter(item => inboundTables.has(item.table))
        .map(item => item.name).sort();
      assert.deepEqual(inspected.additions.map(item => item.type).sort(), ['index', 'index', 'table', 'table']);
      assert.deepEqual(additions, expected);
      assert.equal((await apply(database, nextPlan)).ok, true);
      const after = await inspectManagedSchema(database);
      assert.equal(after.receipt.sequence, before.receipt.sequence + 1);
      assert.equal(after.receipt.previousId, before.receiptId);
      assert.equal((await inspectCompositionSchema(database, nextPlan)).state, 'ready');
      assert.deepEqual(await database.prepare(`SELECT * FROM "${table(nextPlan, 'box', moduleId)}" LIMIT 1`).first(), oldBox);
      for (const id of inbound) assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM "${table(nextPlan, id, moduleId)}"`).first()).n, 0);
    });
  } finally { await mf.dispose(); }
});

test('column migration refuses unsafe changes and retains one atomic receipt under failures', async t => {
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status:404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: ['REJECT', 'RACE', 'ROLLBACK', 'ACK', 'CONCURRENT'], d1Persist: false });
  const base = model('items', { indexes: [{ id: 'label', fields: ['label'], unique: false }] });
  const first = planFor([base]);
  const extend = extra => planFor([model('items', { fields: [...base.fields, field('note', 'string', { nullable: true }), ...extra],
    indexes: base.indexes })]);
  const next = extend([]);
  try {
    await t.test('old fields, constraints, indexes, non-null and default additions stay blocked', async () => {
      const database = await mf.getD1Database('REJECT');
      assert.equal((await apply(database, first)).ok, true);
      const bad = [
        model('items', { fields: [field('id'), field('label', 'integer'), field('note', 'string', { nullable: true })], indexes: base.indexes }),
        model('items', { fields: [field('id'), field('label', 'string', { constraints: { minLength: 2 } }),
          field('note', 'string', { nullable: true })], indexes: base.indexes }),
        model('items', { fields: [...base.fields, field('note')], indexes: base.indexes }),
        model('items', { fields: [...base.fields, field('note', 'string', { nullable: true, default: 'x' })], indexes: base.indexes }),
        model('items', { fields: [...base.fields, field('note', 'string', { nullable: true })],
          indexes: [{ id: 'label', fields: ['id'], unique: false }] }),
      ];
      for (const candidate of bad) assert.equal((await inspectCompositionSchema(database, planFor([candidate]))).code,
        'schema.incompatible');
      assert.equal((await inspectCompositionSchema(database, next)).columnAdditions[0].columns[0].name, 'note');
      assert.equal((await database.prepare(`PRAGMA table_xinfo("${table(first)}")`).all()).results.some(row => row.name === 'note'), false);
    });
    await t.test('a concurrent foreign object blocks ALTER and receipt in the same batch', async () => {
      const database = await mf.getD1Database('RACE');
      assert.equal((await apply(database, first)).ok, true);
      const previous = (await inspectManagedSchema(database)).receiptId;
      let once = false;
      const wrapped = wrapBatch(database, async statements => {
        if (statements.length > 3 && !once) { once = true; await database.prepare('CREATE TABLE foreign_table (id TEXT)').run(); }
        return database.batch(statements);
      });
      const result = await apply(wrapped, next);
      assert.equal(result.ok, false);
      assert.equal(once, true);
      assert.equal((await inspectManagedSchema(database)).code, 'schema.drift');
      assert.equal((await database.prepare(`PRAGMA table_xinfo("${table(first)}")`).all()).results.some(row => row.name === 'note'), false);
      assert.equal((await database.prepare(`SELECT id FROM ${SCHEMA_RECEIPT_TABLE} ORDER BY sequence DESC LIMIT 1`).first()).id, previous);
    });
    await t.test('late batch failure rolls back ALTER and receipt', async () => {
      const database = await mf.getD1Database('ROLLBACK');
      assert.equal((await apply(database, first)).ok, true);
      const previous = (await inspectManagedSchema(database)).receiptId;
      let mutation = false;
      const wrapped = wrapBatch(database, statements => {
        if (statements.length > 3) { mutation = true; return database.batch([...statements, database.prepare("SELECT json('invalid-json')")]); }
        return database.batch(statements);
      });
      assert.equal((await apply(wrapped, next)).ok, false);
      assert.equal(mutation, true);
      assert.equal((await inspectManagedSchema(database)).receiptId, previous);
      assert.equal((await database.prepare(`PRAGMA table_xinfo("${table(first)}")`).all()).results.some(row => row.name === 'note'), false);
    });
    await t.test('lost acknowledgement reconciles the migrated physical schema without another ALTER', async () => {
      const database = await mf.getD1Database('ACK');
      assert.equal((await apply(database, first)).ok, true);
      let calls = 0;
      const wrapped = wrapBatch(database, async statements => {
        const response = await database.batch(statements);
        if (statements.length > 3) { calls++; throw new Error('synthetic lost acknowledgement'); }
        return response;
      });
      const result = await apply(wrapped, next);
      assert.equal(result.ok, true);
      assert.equal(calls, 1);
      assert.equal((await inspectCompositionSchema(database, next)).state, 'ready');
      assert.equal((await database.prepare(`PRAGMA table_xinfo("${table(first)}")`).all()).results.filter(row => row.name === 'note').length, 1);
    });
    await t.test('concurrent ALTER attempts commit one new receipt and one physical column', async () => {
      const database = await mf.getD1Database('CONCURRENT');
      assert.equal((await apply(database, first)).ok, true);
      const results = await Promise.all([apply(database, next), apply(database, next)]);
      assert.ok(results.some(result => result.ok));
      assert.equal((await database.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n, 2);
      assert.equal((await database.prepare(`PRAGMA table_xinfo("${table(first)}")`).all()).results.filter(row => row.name === 'note').length, 1);
      assert.equal((await inspectCompositionSchema(database, next)).state, 'ready');
    });
  } finally { await mf.dispose(); }
});
