import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema,inspectCompositionSchema,SCHEMA_RECEIPT_TABLE} from '../../scripts/data/apply-schema.mjs';
import {inspectComposedInstallation,installComposed} from '../../scripts/data/install-composition.mjs';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const plan=await loadCompositionSchema({root,compositionPath:'configuration/composition.widgets-local.json'});
const connectorsPlan=await loadCompositionSchema({root,
  compositionPath:'configuration/composition.connectors.json',
  lockPath:'configuration/composition.connectors.lock.json'});
const credentials={loginIdentifier:'owner@example.invalid',displayName:'Local owner',
  password:'Synthetic local installation password'};
async function database(t,id='composed-local-installation'){
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{DB:id},
    telemetry:{enabled:false},logRequests:false});
  t.after(async()=>mf.dispose());
  return mf.getD1Database('DB');
}

test('local installer creates the exact composed D1 schema before the native account, then refuses replay',async t=>{
  const db=await database(t);
  assert.equal((await inspectComposedInstallation(db,plan)).state,'fresh');
  const installed=await installComposed(db,plan,{credentials,expectedPlanDigest:plan.planDigest,createSchema:true});
  assert.equal(installed.ok,true,JSON.stringify(installed));
  assert.equal(installed.observedState,'initialized');
  assert.equal((await inspectComposedInstallation(db,plan)).state,'initialized');
  assert.equal((await inspectCompositionSchema(db,plan)).state,'ready');
  const names=(await db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()).results.map(row=>row.name);
  assert.ok(names.includes(SCHEMA_RECEIPT_TABLE));
  for(const object of plan.objects.filter(item=>item.type==='table'))assert.ok(names.includes(object.name),object.name);
  const session=await createAccountService(db).login({loginIdentifier:credentials.loginIdentifier,
    password:credentials.password,audience:'admin'});
  assert.equal(session.ok,true);
  const repeated=await installComposed(db,plan,{credentials,expectedPlanDigest:plan.planDigest,createSchema:false});
  assert.equal(repeated.ok,false);
  assert.equal(repeated.code,'already_initialized');
});

test('a centrally created schema without an account resumes without recreating tables',async t=>{
  const db=await database(t);
  const schema=await applyCompositionSchema(db,plan,{expectedPlanDigest:plan.planDigest});
  assert.equal(schema.ok,true,JSON.stringify(schema));
  assert.equal((await inspectComposedInstallation(db,plan)).state,'schema_ready');
  const installed=await installComposed(db,plan,{credentials,expectedPlanDigest:plan.planDigest,createSchema:false});
  assert.equal(installed.ok,true,JSON.stringify(installed));
  assert.equal((await inspectCompositionSchema(db,plan)).receiptId,schema.receiptId);
});

test('a live bootstrap capability blocks replacement; an expired one resumes on the same schema',async t=>{
  const db=await database(t);
  const schema=await applyCompositionSchema(db,plan,{expectedPlanDigest:plan.planDigest});
  assert.equal(schema.ok,true);
  assert.ok(await provisionBootstrapCapability(db));
  assert.equal((await inspectComposedInstallation(db,plan)).state,'bootstrap_live');
  const blocked=await installComposed(db,plan,{credentials,expectedPlanDigest:plan.planDigest,createSchema:false});
  assert.equal(blocked.ok,false);
  assert.equal(blocked.code,'bootstrap_pending');
  await db.prepare(`UPDATE "${ACCESS_TABLES.bootstrap}" SET created_at_ms=created_at_ms-10000,
    expires_at_ms=created_at_ms-9000
    WHERE id='installation'`).run();
  assert.equal((await inspectComposedInstallation(db,plan)).state,'bootstrap_expired');
  const resumed=await installComposed(db,plan,{credentials,expectedPlanDigest:plan.planDigest,createSchema:false});
  assert.equal(resumed.ok,true,JSON.stringify(resumed));
  assert.equal((await inspectCompositionSchema(db,plan)).receiptId,schema.receiptId);
});

test('foreign D1 objects block local installation without deleting data or creating a receipt',async t=>{
  const db=await database(t);
  await db.prepare('CREATE TABLE foreign_data (id TEXT PRIMARY KEY, value TEXT)').run();
  await db.prepare("INSERT INTO foreign_data VALUES ('keep','user')").run();
  assert.equal((await inspectComposedInstallation(db,plan)).state,'blocked');
  const refusal=await installComposed(db,plan,{credentials,expectedPlanDigest:plan.planDigest,createSchema:true});
  assert.equal(refusal.ok,false);
  assert.equal((await db.prepare("SELECT value FROM foreign_data WHERE id='keep'").first()).value,'user');
  assert.equal((await db.prepare(`SELECT name FROM sqlite_schema WHERE name='${SCHEMA_RECEIPT_TABLE}'`).first()),null);
});

test('wide connectors schema resumes one native owner and still rejects populated data',
  {timeout:120000},async t=>{
  const dataTables=connectorsPlan.objects.filter(item=>item.type==='table'
    &&![ACCESS_TABLES.bootstrap,ACCESS_TABLES.auth_throttles].includes(item.name));
  assert.ok(dataTables.length>=114,'exercise the full connector profile');
  const db=await database(t,'composed-wide-installation');
  assert.equal((await inspectComposedInstallation(db,connectorsPlan)).state,'fresh');
  const schema=await applyCompositionSchema(db,connectorsPlan,
    {expectedPlanDigest:connectorsPlan.planDigest});
  assert.equal(schema.ok,true,JSON.stringify(schema));
  assert.equal((await inspectComposedInstallation(db,connectorsPlan)).state,'schema_ready');
  const installed=await installComposed(db,connectorsPlan,{credentials,
    expectedPlanDigest:connectorsPlan.planDigest,createSchema:false});
  assert.equal(installed.ok,true,JSON.stringify(installed));
  assert.equal((await inspectComposedInstallation(db,connectorsPlan)).state,'initialized');
  assert.equal((await db.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
    WHERE id='application'`).first()).epoch,1);
  const replay=await installComposed(db,connectorsPlan,{credentials,
    expectedPlanDigest:connectorsPlan.planDigest,createSchema:false});
  assert.equal(replay.ok,false);
  assert.equal(replay.code,'already_initialized');

  const foreign=await database(t,'composed-wide-foreign');
  assert.equal((await applyCompositionSchema(foreign,connectorsPlan,
    {expectedPlanDigest:connectorsPlan.planDigest})).ok,true);
  await foreign.prepare(`INSERT INTO "${ACCESS_TABLES.contexts}" (id,status)
    VALUES ('foreign','active')`).run();
  const observed=await inspectComposedInstallation(foreign,connectorsPlan);
  assert.equal(observed.state,'blocked');
  assert.equal(observed.code,'foreign_data');
  const denied=await installComposed(foreign,connectorsPlan,{credentials,
    expectedPlanDigest:connectorsPlan.planDigest,createSchema:false});
  assert.equal(denied.ok,false);
  assert.equal(denied.code,'foreign_data');
  assert.equal((await foreign.prepare(`SELECT status FROM "${ACCESS_TABLES.contexts}"
    WHERE id='foreign'`).first()).status,'active');
});
