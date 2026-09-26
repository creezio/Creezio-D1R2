import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Miniflare } from 'miniflare';
import { loadAccessInstallPlan, inspectAccessInstallation, createAccessSchema, installAccess } from '../../scripts/data/install-access.mjs';
import { createAccountService, provisionBootstrapCapability } from '../../core/identity/accounts.ts';
import { createIdentityQualificationState } from './harness/d1-state.mjs';
import { integrity } from '../contracts/helpers.mjs';
import { loadRuntimeComposition } from '../../scripts/build/compose-runtime.mjs';
import { loadLocalConfiguration, localWorkerConfiguration } from '../../scripts/local/config.mjs';
import { acquireLocalRuntimeLock } from '../../scripts/local/lock.mjs';
import { openLocalAccessDatabase } from '../../scripts/local/database.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plan = loadAccessInstallPlan(root);
const password = 'Synthetic installation qualification password';
const credentials = () => ({ loginIdentifier: 'initial@example.invalid', displayName: 'Synthetic first administrator', password });
const quote = value => `"${value.replaceAll('"', '""')}"`;
const table = id => quote(plan.tables[id]);
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const freshBindings = ['FRESH', 'INPUT', 'FOREIGN', 'HIDDEN', 'PARTIAL', 'INCOMPATIBLE', 'DDL_RACE', 'DDL_FAIL',
  'SCHEMA_RACE', 'MAIN', 'MUTABLE', 'BOOT_RACE', 'BOOT_FAIL', 'PENDING', 'LOST_REPLY', 'INCONSISTENT'];
const install = (db, extra = {}) => installAccess(db, plan, { credentials: credentials(), expectedSqlDigest: plan.sqlDigest, createSchema: true, ...extra });
const inspect = db => inspectAccessInstallation(db, plan);
const schemaObjects = async db => (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
const internalMetadata = { type: 'table', name: '_cf_METADATA', tbl_name: '_cf_METADATA',
  sql: 'CREATE TABLE _cf_METADATA (\n        key INTEGER PRIMARY KEY,\n        value BLOB\n      )' };
const applicationObjects = async db => (await schemaObjects(db)).filter(object => JSON.stringify(object) !== JSON.stringify(internalMetadata));
const rows = async (db, id) => (await db.prepare(`SELECT * FROM ${table(id)}`).all()).results;
async function dataSnapshot(db) {
  const result = {};
  for (const id of Object.keys(plan.tables).sort()) result[id] = (await rows(db, id)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return result;
}
function safeResult(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [password, 'Synthetic private storage detail', '$argon2id$', 'cz1b_', 'capability_digest', 'password_record'])
    assert.equal(serialized.includes(forbidden), false, `Public operator result leaked ${forbidden}`);
}

// Instrument real D1 statements without replacing storage, constraints or batch
// semantics. Injection occurs only in this test, between inspection and effect.
function interceptedDatabase(db, { beforeBatch, afterBatch } = {}) {
  const wrapped = new WeakMap();
  const wrap = (statement, sql) => {
    const proxy = {
      bind(...values) { return wrap(statement.bind(...values), sql); },
      first(...values) { return statement.first(...values); },
      all(...values) { return statement.all(...values); },
      run(...values) { return statement.run(...values); },
      raw(...values) { return statement.raw(...values); },
    };
    wrapped.set(proxy, { statement, sql }); return proxy;
  };
  return {
    prepare(sql) { return wrap(db.prepare(sql), sql); },
    async batch(statements) {
      const entries = statements.map(statement => wrapped.get(statement) ?? { statement, sql: '' });
      const extra = await beforeBatch?.(entries.map(entry => entry.sql));
      const results = await db.batch([...entries.map(entry => entry.statement), ...(extra ?? [])]);
      await afterBatch?.(entries.map(entry => entry.sql), results);
      return results;
    },
  };
}
const createsSchema = sql => sql.some(statement => /^CREATE TABLE\b/i.test(statement.trim()));
const consumesBootstrap = sql => sql.some(statement => statement.includes(`UPDATE ${table('bootstrap')} SET claim_nonce`));

test('explicit access installation uses real D1, refuses unrelated or inconsistent state and preserves a completed installation', { timeout: 90000 }, async t => {
  const state = createIdentityQualificationState(root);
  const options = { host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, {status: 404}); } };',
    compatibilityDate: '2026-05-15', d1Databases: Object.fromEntries(freshBindings.map(name => [name, `creezio-access-install-${name.toLowerCase()}`])),
    d1Persist: join(state.directory, 'd1') };
  let runtime, failed = false, mainPrincipal;
  async function start() { runtime = new Miniflare(options); await runtime.ready; }
  const database = name => runtime.getD1Database(name);
  async function check(name, run) {
    await t.test(name, { timeout: 15000 }, async () => { try { await run(); } catch (error) { failed = true; throw error; } });
    if (failed) throw new Error(`Installation qualification stopped after: ${name}`);
  }
  try {
    await check('installation requires a coherent selected native Access module exposed to administrators', async () => {
      // Five inert artifacts, no copied source tree, dependency installation or
      // generated runtime. Each rejected composition has a matching lock digest.
      const fixtureRoot = join(state.directory, 'plan-fixture');
      const paths = ['extensions/native/access/module/models.json', 'extensions/native/access/module/manifest.json',
        'data/schema/access.sql', 'configuration/composition.json', 'configuration/composition.lock.json'];
      const baseline = Object.fromEntries(paths.map(path => [path, readFileSync(join(root, path))]));
      const write = (path, bytes) => { const target = join(fixtureRoot, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); };
      const json = value => JSON.stringify(value, null, 2) + '\n';
      const reset = () => { for (const path of paths) write(path, baseline[path]); };
      const originalEnvironment = ['CREEZIO_COMPOSITION', 'CREEZIO_COMPOSITION_LOCK'].map(key => [key, process.env[key]]);
      try {
        for (const [key] of originalEnvironment) delete process.env[key];
        reset();
        const approved = loadAccessInstallPlan(fixtureRoot);
        assert.equal(approved.sqlDigest, plan.sqlDigest);
        assert.equal(approved.compositionDigest, integrity(JSON.parse(baseline['configuration/composition.json'])));
        assert.equal(approved.lockDigest, `sha256-${createHash('sha256').update(baseline['configuration/composition.lock.json']).digest('hex')}`);
        for (const variation of ['disabled', 'admin-hidden', 'empty', 'other-native-path']) {
          reset();
          const composition = JSON.parse(baseline['configuration/composition.json']);
          const lock = JSON.parse(baseline['configuration/composition.lock.json']);
          if (variation === 'disabled') {
            composition.modules[0].enabled = false;
            composition.exposure.admin.moduleIds = []; composition.exposure.app.moduleIds = [];
          } else if (variation === 'admin-hidden') composition.exposure.admin.moduleIds = [];
          else if (variation === 'empty') {
            composition.modules = []; lock.modules = [];
            composition.exposure.admin.moduleIds = []; composition.exposure.app.moduleIds = [];
          } else {
            composition.modules[0].source.path = 'extensions/alternate/access';
            write('extensions/alternate/access/module/manifest.json', baseline['extensions/native/access/module/manifest.json']);
          }
          lock.compositionIntegrity = integrity(composition);
          write('configuration/composition.json', json(composition)); write('configuration/composition.lock.json', json(lock));
          assert.doesNotThrow(() => loadRuntimeComposition({ root: fixtureRoot }), `Otherwise valid composition: ${variation}`);
          assert.throws(() => loadAccessInstallPlan(fixtureRoot), { name: 'AccessInstallPlanError', code: 'invalid_plan' }, variation);
        }
        reset();
        const manifest = JSON.parse(baseline['extensions/native/access/module/manifest.json']);
        manifest.contracts.models[0].title = 'Descriptor drift without changing canonical models';
        const lock = JSON.parse(baseline['configuration/composition.lock.json']); lock.modules[0].contractIntegrity = integrity(manifest);
        write('extensions/native/access/module/manifest.json', json(manifest)); write('configuration/composition.lock.json', json(lock));
        assert.doesNotThrow(() => loadRuntimeComposition({ root: fixtureRoot }));
        assert.throws(() => loadAccessInstallPlan(fixtureRoot), { code: 'invalid_plan' });
        reset(); write('data/schema/access.sql', Buffer.concat([baseline['data/schema/access.sql'], Buffer.from('\n-- Unapproved SQL bytes\n')]));
        assert.throws(() => loadAccessInstallPlan(fixtureRoot), { code: 'invalid_plan' });
        assert.equal(existsSync(join(fixtureRoot, '.creezio')), false);
        assert.equal(existsSync(join(fixtureRoot, '.wrangler')), false);
      } finally {
        for (const [key, value] of originalEnvironment) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    });

    await start();

    await check('the approved plan hashes exact SQL bytes and fresh inspection performs no writes', async () => {
      const bytes = readFileSync(join(root, 'data/schema/access.sql'));
      assert.equal(plan.sqlDigest, `sha256-${createHash('sha256').update(bytes).digest('hex')}`);
      assert.equal(plan.sql, bytes.toString('utf8')); assert.equal(plan.moduleId, 'creezio.access');
      assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.statements)); assert.equal(Object.hasOwn(plan, 'models'), false);
      const db = await database('FRESH');
      // Miniflare materializes provider metadata after the first read. This is
      // distinct from an installer effect and never a wildcard exemption.
      assert.deepEqual(await schemaObjects(db), []);
      const before = await schemaObjects(db), result = await inspect(db);
      assert.deepEqual(before, [internalMetadata]); assert.equal(result.state, 'fresh', JSON.stringify(result)); assert.equal(result.bootstrap, 'none'); safeResult(result);
      assert.deepEqual(await schemaObjects(db), before);
    });

    await check('invalid inputs or schema digest and absent schema approval cannot create a schema or capability', async () => {
      const db = await database('INPUT');
      let getters = 0; const accessor = { loginIdentifier: credentials().loginIdentifier, displayName: credentials().displayName };
      Object.defineProperty(accessor, 'password', { enumerable: true, get() { getters++; return password; } });
      for (const input of [null, [], accessor, Object.create(credentials()), { ...credentials(), role: 'administrator' },
        { ...credentials(), password: 'too short' }, { ...credentials(), password: '🙂'.repeat(257) }]) {
        const result = await install(db, { credentials: input }); assert.equal(result.ok, false); assert.equal(result.code, 'invalid_input'); safeResult(result);
      }
      assert.equal(getters, 0);
      const forged = { ...plan, statements: ['CREATE TABLE should_never_exist (id TEXT)'] };
      assert.equal((await inspectAccessInstallation(db, forged)).state, 'blocked');
      assert.equal((await createAccessSchema(db, forged, { expectedSqlDigest: plan.sqlDigest })).ok, false);
      for (const execute of [() => createAccessSchema(db, plan, { expectedSqlDigest: 'sha256-' + '0'.repeat(64) }),
        () => install(db, { expectedSqlDigest: 'sha256-' + '0'.repeat(64) }), () => install(db, { createSchema: false })]) {
        const result = await execute(); assert.equal(result.ok, false); safeResult(result);
      }
      assert.deepEqual(await applicationObjects(db), []);
    });

    await check('foreign tables including underscore names and partial Access schema are never repaired or overwritten', async () => {
      for (const [binding, name] of [['FOREIGN', 'customer_records'], ['HIDDEN', '_private_records']]) {
        const db = await database(binding);
        await db.batch([db.prepare(`CREATE TABLE ${quote(name)} (id TEXT PRIMARY KEY,value TEXT NOT NULL)`),
          db.prepare(`INSERT INTO ${quote(name)} VALUES ('existing','Preserve synthetic existing data')`)]);
        const before = await schemaObjects(db), observed = await inspect(db), result = await install(db);
        assert.equal(observed.state, 'blocked'); assert.equal(observed.code, 'foreign_data');
        assert.equal(result.ok, false); safeResult(result); assert.deepEqual(await schemaObjects(db), before);
        assert.equal((await db.prepare(`SELECT value FROM ${quote(name)}`).first()).value, 'Preserve synthetic existing data');
      }
      const db = await database('PARTIAL'); await db.prepare(plan.statements.find(sql => /^CREATE TABLE/i.test(sql.trim()))).run();
      const before = await schemaObjects(db); assert.equal((await inspect(db)).state, 'blocked');
      assert.equal((await install(db)).ok, false); assert.deepEqual(await schemaObjects(db), before);
    });

    await check('a complete but changed schema is refused without silently adding or removing objects', async () => {
      const db = await database('INCOMPATIBLE');
      assert.equal((await createAccessSchema(db, plan, { expectedSqlDigest: plan.sqlDigest })).ok, true);
      await db.prepare(`ALTER TABLE ${table('principals')} ADD COLUMN unexpected TEXT`).run();
      const before = await schemaObjects(db), result = await install(db);
      assert.equal(result.ok, false); assert.equal((await inspect(db)).state, 'blocked'); safeResult(result);
      assert.deepEqual(await schemaObjects(db), before);
    });

    await check('foreign data arriving after inspection still blocks the DDL batch before Access objects are created', async () => {
      const db = await database('DDL_RACE'); let injected = false;
      const raced = interceptedDatabase(db, { beforeBatch: async sql => {
        if (!injected && createsSchema(sql)) {
          injected = true; await db.batch([db.prepare('CREATE TABLE arrived_during_inspection (value TEXT NOT NULL)'),
            db.prepare("INSERT INTO arrived_during_inspection VALUES ('Preserve concurrent data')")]);
        }
      } });
      const result = await createAccessSchema(raced, plan, { expectedSqlDigest: plan.sqlDigest });
      assert.equal(injected, true); assert.equal(result.ok, false); safeResult(result);
      assert.equal((await schemaObjects(db)).some(object => object.name.startsWith('cz_')), false);
      assert.equal((await db.prepare('SELECT value FROM arrived_during_inspection').first()).value, 'Preserve concurrent data');
    });

    await check('a truly late DDL error rolls back every table and index without a compensating drop', async () => {
      const db = await database('DDL_FAIL'); let injected = false;
      const faulted = interceptedDatabase(db, { beforeBatch: async sql => {
        if (!injected && createsSchema(sql)) { injected = true; return [db.prepare(plan.statements.find(statement => /^CREATE TABLE/i.test(statement.trim())))]; }
      } });
      const result = await createAccessSchema(faulted, plan, { expectedSqlDigest: plan.sqlDigest });
      assert.equal(injected, true); assert.equal(result.ok, false); safeResult(result);
      assert.deepEqual(await applicationObjects(db), []); assert.equal((await inspect(db)).state, 'fresh');
    });

    await check('concurrent schema creation converges to the exact approved schema without half-created objects', async () => {
      const db = await database('SCHEMA_RACE');
      const results = await Promise.all([createAccessSchema(db, plan, { expectedSqlDigest: plan.sqlDigest }),
        createAccessSchema(db, plan, { expectedSqlDigest: plan.sqlDigest })]);
      assert.ok(results.some(result => result.ok)); results.forEach(safeResult);
      assert.equal((await inspect(db)).state, 'schema_ready');
      assert.equal((await rows(db, 'principals')).length, 0);
    });

    await check('an approved installation creates only the canonical initial administrator and never a session', async () => {
      const db = await database('MAIN'), result = await install(db);
      assert.equal(result.ok, true); assert.equal(result.code, 'installed'); assert.equal(result.effect, 'confirmed'); safeResult(result);
      mainPrincipal = result.principalId; assert.equal(typeof mainPrincipal, 'string');
      assert.equal((await inspect(db)).state, 'initialized');
      assert.deepEqual((await rows(db, 'principals')).map(row => [row.id, row.kind, row.status]), [[mainPrincipal, 'human', 'active']]);
      assert.deepEqual(await rows(db, 'role_grants'), [{ role_id: 'administrator', permission_id: 'creezio.access:manage' }]);
      assert.deepEqual((await rows(db, 'memberships')).map(row => [row.principal_id, row.context_id, row.audience, row.status]),
        [[mainPrincipal, 'application', 'admin', 'active']]);
      assert.equal((await rows(db, 'sessions')).length, 0); assert.equal((await rows(db, 'access_audit')).length, 1);
      const all = JSON.stringify(await dataSnapshot(db)); assert.equal(all.includes(password), false); assert.equal(all.includes('cz1b_'), false);
      const service = createAccountService(db);
      const nativeLogin = await service.login({ loginIdentifier: credentials().loginIdentifier, password, audience: 'admin' });
      assert.equal(nativeLogin.ok, true); assert.equal(nativeLogin.session.principalId, mainPrincipal);
      assert.equal(await service.logout(nativeLogin.token, 'admin'), true);
    });

    await check('administrator inputs are captured before schema creation awaits and cannot change the account being installed', async () => {
      const db = await database('MUTABLE'), supplied = credentials(); let injected = false;
      const intercepted = interceptedDatabase(db, { beforeBatch: async sql => {
        if (!injected && createsSchema(sql)) {
          injected = true; supplied.loginIdentifier = 'changed-after-await@example.invalid'; supplied.password = 'Different valid synthetic password';
        }
      } });
      const result = await install(intercepted, { credentials: supplied });
      assert.equal(injected, true); assert.equal(result.ok, true); safeResult(result);
      assert.equal((await rows(db, 'human_accounts'))[0].login_identifier, credentials().loginIdentifier);
      const nativeLogin = await createAccountService(db).login({ loginIdentifier: credentials().loginIdentifier, password, audience: 'admin' });
      assert.equal(nativeLogin.ok, true);
    });

    await check('a completed installation cannot overwrite credentials or restore an administrator grant that was later removed', async () => {
      const db = await database('MAIN'); await db.prepare(`DELETE FROM ${table('role_grants')}`).run();
      const before = await dataSnapshot(db), result = await install(db, { credentials: { loginIdentifier: 'replacement@example.invalid', displayName: 'Replacement', password: 'Replacement synthetic password' } });
      assert.equal(result.code, 'already_initialized'); assert.equal(result.effect, 'none'); safeResult(result);
      assert.deepEqual(await dataSnapshot(db), before); assert.equal((await inspect(db)).state, 'initialized');
    });

    await check('a live lost bootstrap capability is not replaced; only explicit retry after expiry can install', async () => {
      const db = await database('PENDING');
      await createAccessSchema(db, plan, { expectedSqlDigest: plan.sqlDigest });
      const provisioned = await provisionBootstrapCapability(db); assert.ok(provisioned);
      assert.equal((await inspect(db)).state, 'bootstrap_live');
      const before = await dataSnapshot(db), refused = await install(db);
      assert.equal(refused.ok, false); assert.equal(refused.code, 'bootstrap_pending'); safeResult(refused);
      assert.deepEqual(await dataSnapshot(db), before);
      await db.prepare(`UPDATE ${table('bootstrap')} SET created_at_ms=${NOW}-2000,expires_at_ms=${NOW}-1000`).run();
      assert.equal((await inspect(db)).state, 'bootstrap_expired');
      const installed = await install(db); assert.equal(installed.ok, true); safeResult(installed);
      assert.equal((await rows(db, 'principals')).length, 1);
      assert.equal(JSON.stringify(await dataSnapshot(db)).includes(provisioned.token), false);
    });

    await check('two competing first-account installations have one winner, one principal and one initial audit', async () => {
      const db = await database('BOOT_RACE'); await createAccessSchema(db, plan, { expectedSqlDigest: plan.sqlDigest });
      const results = await Promise.all([install(db), install(db)]); results.forEach(safeResult);
      assert.equal(results.filter(result => result.code === 'installed').length, 1);
      assert.equal((await rows(db, 'principals')).length, 1); assert.equal((await rows(db, 'human_accounts')).length, 1);
      assert.equal((await rows(db, 'access_audit')).filter(row => row.action === 'bootstrap-completed').length, 1);
    });

    await check('a constraint evaluated after the final bootstrap audit rolls back every account effect and preserves schema', async () => {
      const db = await database('BOOT_FAIL'); await createAccessSchema(db, plan, { expectedSqlDigest: plan.sqlDigest });
      let beforeClaim, injected = false;
      const faulted = interceptedDatabase(db, { beforeBatch: async sql => {
        if (!injected && consumesBootstrap(sql)) {
          injected = true;
          beforeClaim = await dataSnapshot(db);
          // No trigger is added: a correctly guarded engine would reject schema
          // drift before running the claim, which would not prove late rollback.
          return [db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM ${table('access_audit')} WHERE action='bootstrap-completed')
            THEN json('Synthetic private storage detail') ELSE 'earlier audit was not inserted' END`)];
        }
      } });
      const result = await install(faulted); assert.equal(injected, true); assert.equal(result.ok, false); safeResult(result);
      assert.deepEqual(await dataSnapshot(db), beforeClaim);
      assert.equal((await inspect(db)).state, 'bootstrap_live');
      assert.equal((await rows(db, 'principals')).length, 0);
    });

    await check('a committed bootstrap whose reply is lost is reconciled without repeating the mutation or inventing failure atomicity', async () => {
      const db = await database('LOST_REPLY'); let commits = 0;
      const faulted = interceptedDatabase(db, { afterBatch: async sql => {
        if (consumesBootstrap(sql)) { commits++; throw new Error('Synthetic private storage detail'); }
      } });
      const result = await install(faulted); safeResult(result);
      assert.equal(commits, 1); assert.equal((await inspect(db)).state, 'initialized');
      assert.equal(result.observedState, 'initialized');
      assert.equal((await rows(db, 'principals')).length, 1); assert.equal((await rows(db, 'access_audit')).length, 1);
      const before = await dataSnapshot(db), retry = await install(db);
      assert.equal(retry.code, 'already_initialized'); assert.deepEqual(await dataSnapshot(db), before);
    });

    await check('an existing human without a consumed installation marker is blocked, never treated as a new empty installation', async () => {
      const db = await database('INCONSISTENT'); assert.equal((await install(db)).ok, true);
      await db.prepare(`DELETE FROM ${table('bootstrap')}`).run();
      const before = await dataSnapshot(db); assert.equal((await inspect(db)).state, 'blocked');
      assert.equal((await install(db)).ok, false); assert.deepEqual(await dataSnapshot(db), before);
    });

    await check('storage failures return redacted unavailable results rather than authorizing installation', async () => {
      const unavailable = { prepare() { throw new Error('Synthetic private storage detail'); }, batch() { assert.fail('No batch after failed inspection'); } };
      const observed = await inspect(unavailable); assert.equal(observed.state, 'unavailable'); safeResult(observed);
      const result = await install(unavailable); assert.equal(result.ok, false); safeResult(result);
    });

    await check('a sequential runtime restart preserves the account, closed bootstrap and deliberately removed rights', async () => {
      await runtime.dispose(); runtime = null; await start();
      const db = await database('MAIN'), observed = await inspect(db);
      assert.equal(observed.state, 'initialized'); assert.equal((await rows(db, 'principals'))[0].id, mainPrincipal);
      assert.deepEqual(await rows(db, 'role_grants'), []);
      const before = await dataSnapshot(db), repeated = await install(db);
      assert.equal(repeated.code, 'already_initialized'); assert.deepEqual(await dataSnapshot(db), before);
      const login = await createAccountService(db).login({ loginIdentifier: credentials().loginIdentifier, password, audience: 'admin' });
      assert.equal(login.ok, true); assert.equal(login.session.principalId, mainPrincipal);
    });

    await check('the local operator adapter persists the same database at the declared v3/d1 runtime path', async () => {
      // Close the engine harness before using the official adapter. Only its
      // tiny hosting declaration is needed; no repository or dependencies copy.
      await runtime.dispose(); runtime = null;
      const fixtureRoot = join(state.directory, 'adapter-fixture');
      mkdirSync(join(fixtureRoot, '.openai'), { recursive: true });
      writeFileSync(join(fixtureRoot, '.openai/hosting.json'), JSON.stringify({ d1: 'DB', r2: 'BUCKET' }));
      const config = loadLocalConfiguration({ root: fixtureRoot, origin: 'http://127.0.0.1:5173' });
      assert.equal(config.d1Path, join(fixtureRoot, '.wrangler/state/v3/d1'));
      assert.equal(config.persistenceRoot, join(fixtureRoot, '.wrangler/state/v3'));
      assert.deepEqual(localWorkerConfiguration(config).d1_databases, [{ binding: 'DB', database_name: 'creezio-local', database_id: config.bindings.databaseId }]);
      const lock = await acquireLocalRuntimeLock(config, 'install');
      let adapter, direct;
      try {
        adapter = await openLocalAccessDatabase(config);
        assert.deepEqual(await schemaObjects(adapter.db), []);
        assert.deepEqual(await schemaObjects(adapter.db), [internalMetadata]);
        await adapter.db.batch([adapter.db.prepare('CREATE TABLE qualification_sentinel (id TEXT PRIMARY KEY,value TEXT NOT NULL)'),
          adapter.db.prepare("INSERT INTO qualification_sentinel VALUES ('persistent','synthetic local path proof')")]);
        await adapter.dispose(); adapter = null;
        assert.ok(existsSync(config.d1Path)); assert.ok(readdirSync(config.d1Path).length > 0);
        // A separate Miniflare uses the explicit path, independently of the
        // adapter's defaultPersistRoot option. Never open both simultaneously.
        direct = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
          script: 'export default { fetch() { return new Response(null, { status: 404 }); } };',
          compatibilityDate: config.compatibilityDate, d1Databases: { DB: config.bindings.databaseId }, d1Persist: config.d1Path });
        const reopened = await direct.getD1Database('DB');
        assert.equal((await reopened.prepare("SELECT value FROM qualification_sentinel WHERE id='persistent'").first()).value, 'synthetic local path proof');
        assert.deepEqual((await schemaObjects(reopened)).filter(row => row.name === '_cf_METADATA'), [internalMetadata]);
      } finally {
        if (direct) await direct.dispose();
        if (adapter) await adapter.dispose();
        await lock.release();
      }
      assert.equal(existsSync(config.lockPath), false);
    });

    t.diagnostic('Real local Miniflare D1 exercised through the operator engine and native Node24 account service. No public installer endpoint, browser delivery or remote Sites/Cloudflare qualification is claimed.');
  } finally {
    if (runtime) await runtime.dispose(); state.cleanup();
  }
});
