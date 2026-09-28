import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema, inspectCompositionSchema, inspectManagedSchema,
  SCHEMA_RECEIPT_TABLE} from '../../scripts/data/apply-schema.mjs';
import {installComposed} from '../../scripts/data/install-composition.mjs';
import {sqlTableName} from '../../scripts/data/d1-schema.mjs';
import {runLocalSchema} from '../../scripts/local/schema.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {createAccountService} from '../../core/identity/accounts.ts';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const moduleId = 'creezio.modules-settings';
const password = ['synthetic','local','schema','password'].join('-');
const credentials = {loginIdentifier:'operator@example.invalid',displayName:'Local operator',password};
const itemModel = {id:'items',title:'items',scope:'application',fields:[
  {id:'id',type:'string',nullable:false,protected:true,computed:false},
  {id:'label',type:'string',nullable:false,protected:true,computed:false}],
  primaryKey:['id'],indexes:[],relations:[],permissions:[],deletion:{mode:'hard',requiresApproval:false},public:false};

function planFor(includeOutcome, withIndex=false) {
  const composition = json('../../configuration/composition.json');
  const lock = json('../../configuration/composition.lock.json');
  const access = json('../../extensions/native/access/module/manifest.json');
  const module = JSON.parse(JSON.stringify(access).replaceAll('creezio.access',moduleId));
  const models = json('../../extensions/native/modules-settings/module/models.json');
  module.contracts.models = [...models.filter(item=>includeOutcome || item.id!=='plan-outcomes')
    .map(item=>({...item,permissions:[]})),{...itemModel,
      indexes:withIndex?[{id:'label',fields:['label'],unique:false}]:[]}];
  module.contracts.schemas=[];module.contracts.permissions=[];module.contracts.operations=[];
  module.contracts.api=[];module.contracts.mcp={tools:[],resources:[],prompts:[],skills:[]};
  module.contracts.ui={...module.contracts.ui,views:[],navigation:[],slots:[],styles:[]};
  const selection={...structuredClone(composition.modules[0]),moduleId,origin:module.identity.origin};
  const node={...structuredClone(lock.modules[0]),moduleId,origin:module.identity.origin,
    contractIntegrity:contractIntegrity(module)};
  composition.modules=[composition.modules[0],selection];
  lock.modules=[lock.modules[0],node];
  composition.exposure.admin.moduleIds=['creezio.access'];
  composition.exposure.app.moduleIds=['creezio.access'];
  lock.compositionIntegrity=contractIntegrity(composition);
  return compileCompositionSchema({composition,lock,modules:[access,module]});
}
function harness(db, loadPlan, {approval, disposalError=false, busy=false}={}) {
  const calls={lines:[],purposes:[],released:0,disposed:0,opened:0,reads:0};
  const config={root:'unused',d1Path:'/isolated/local.d1',
    bindings:{database:'DB',databaseId:'isolated-schema-test'}};
  const io={interactive:true,write:value=>calls.lines.push(value),
    async readLine(){calls.reads++;return approval;}};
  const adapter=async()=>{calls.opened++;return {db,async dispose(){calls.disposed++;
    if(disposalError)throw Object.assign(new Error('unknown closure'),{code:'local_cleanup_failed'});}};};
  const lock=async(_config,purpose)=>{calls.purposes.push(purpose);
    if(busy)throw Object.assign(new Error('occupied'),{code:'local_busy'});
    return {async release(){calls.released++;}};};
  const engine={loadComposedInstallPlan:async()=>loadPlan(),inspectCompositionSchema,
    inspectManagedSchema,applyCompositionSchema};
  return {calls,run:mode=>runLocalSchema({mode,config,io,adapter,lock,engine})};
}

test('local schema command updates an initialized D1 only after exact approval and preserves records',async t=>{
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{DB:'isolated-schema-test'},d1Persist:false});
  t.after(async()=>mf.dispose());
  const db=await mf.getD1Database('DB'),previous=planFor(false),next=planFor(true);
  const newTable=sqlTableName(moduleId,'plan-outcomes');
  assert.deepEqual((await inspectCompositionSchema(db,next)).additions.length>0,true);
  const fresh=harness(db,()=>next,{approval:next.planDigest});
  assert.equal((await fresh.run('apply')).code,'schema_unmanaged');
  assert.equal((await db.prepare(`SELECT name FROM sqlite_schema WHERE name=?`).bind(newTable).first()),null);

  const installed=await installComposed(db,previous,{credentials,expectedPlanDigest:previous.planDigest,createSchema:true});
  assert.equal(installed.ok,true,JSON.stringify(installed));
  const items=sqlTableName(moduleId,'items');
  await db.prepare(`INSERT INTO "${items}" (id,label) VALUES (?,?)`).bind('witness','preserved').run();
  const before=await inspectCompositionSchema(db,next);
  assert.equal(before.state,'additive');
  assert.deepEqual(before.additions,[{type:'table',name:newTable}]);

  const rejected=harness(db,()=>next,{approval:previous.planDigest});
  assert.equal((await rejected.run('apply')).code,'schema_approval_mismatch');
  assert.equal(rejected.calls.reads,1);
  let loads=0;
  const changed=harness(db,()=>++loads===1?next:previous,{approval:next.planDigest});
  assert.equal((await changed.run('apply')).code,'source_changed');
  assert.equal((await db.prepare(`SELECT name FROM sqlite_schema WHERE name=?`).bind(newTable).first()),null);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n,1);

  const inspect=harness(db,()=>next);
  const preview=await inspect.run('inspect');
  assert.equal(preview.ok,true);assert.equal(preview.state,'additive');
  assert.deepEqual(preview.additions,[{type:'table',name:newTable}]);
  assert.deepEqual(inspect.calls.purposes,['inspect']);
  const approved=harness(db,()=>next,{approval:next.planDigest});
  const result=await approved.run('apply');
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.code,'schema.applied');assert.equal(result.effect,'confirmed');
  assert.deepEqual(approved.calls.purposes,['install']);
  assert.equal(approved.calls.released,1);assert.equal(approved.calls.disposed,1);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n,2);
  assert.ok(await db.prepare(`SELECT name FROM sqlite_schema WHERE name=?`).bind(newTable).first());
  assert.equal((await db.prepare(`SELECT label FROM "${items}" WHERE id='witness'`).first()).label,'preserved');
  const login=await createAccountService(db).login({loginIdentifier:credentials.loginIdentifier,
    password,audience:'admin'});
  assert.equal(login.ok,true);
  const replay=await approved.run('apply');
  assert.equal(replay.code,'schema.current');assert.equal(replay.effect,'none');
  assert.equal(approved.calls.reads,1,'ready plan needs no second approval or write');
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n,2);

  const later=planFor(true,true), uncertain=harness(db,()=>later,
    {approval:later.planDigest,disposalError:true});
  assert.equal((await inspectCompositionSchema(db,later)).state,'additive');
  const lostClosure=await uncertain.run('apply');
  assert.deepEqual(lostClosure,{ok:false,code:'local_cleanup_failed',effect:'unknown'});
  assert.equal(uncertain.calls.reads,1,'an unknown result is never replayed automatically');
  assert.equal(uncertain.calls.released,0,'an uncertain closure retains the cooperative lock');
  assert.equal((await inspectCompositionSchema(db,later)).state,'ready');
  assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${SCHEMA_RECEIPT_TABLE}`).first()).n,3);
  assert.equal((await db.prepare(`SELECT label FROM "${items}" WHERE id='witness'`).first()).label,'preserved');
});

test('busy storage and uncertain closure are reported without unsafe retry or lock release',async()=>{
  const plan=planFor(true);
  const busy=harness(null,()=>plan,{approval:plan.planDigest,busy:true});
  assert.deepEqual(await busy.run('apply'),{ok:false,code:'local_busy',effect:'none'});
  assert.equal(busy.calls.opened,0);
  const failedClose=harness({},()=>plan,{disposalError:true});
  // Inspection failure still closes the adapter; uncertain closure leaves its cooperative lock in place.
  const outcome=await failedClose.run('inspect');
  assert.deepEqual(outcome,{ok:false,code:'local_cleanup_failed',effect:'none'});
  assert.equal(failedClose.calls.released,0);
});
