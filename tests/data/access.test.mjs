import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { loadAccessInstallPlan } from '../../scripts/data/install-access.mjs';
import { generateD1Schema } from '../../scripts/data/d1-schema.mjs';
import { createAccountService, provisionBootstrapCapability } from '../../core/identity/accounts.ts';
import { createAccountLifecycleService } from '../../core/identity/lifecycle.ts';
import { createMachineAccountService } from '../../core/identity/machines.ts';
import { createImpersonationService } from '../../core/identity/impersonation.ts';
import { createAuthorizationService } from '../../core/authorization/service.ts';
import { ACCESS_TABLES } from '../../core/identity/d1-store.ts';
import { createDataAccess, DataAccessError } from '../../core/data/service.ts';
import { copyJson } from '../../core/data/input.ts';
import { decodeRows } from '../../core/data/plans.ts';

const moduleId = 'example.records';
const ref = (kind, id) => ({moduleId,kind,id});
const f = (id, type = 'string', extra = {}) => ({id,type,nullable:false,protected:false,computed:false,...extra});
const model = {id:'record',title:'Qualification record',scope:'context',contextField:'context_id',
  fields:[f('context_id','string',{protected:true}),f('id'),f('title'),f('revision','integer',{constraints:{minimum:0}}),
    f('secret','string',{protected:true,default:'sealed'}),f('flag','boolean',{default:false}),f('payload','json',{default:{}})],
  primaryKey:['context_id','id'],indexes:[],relations:[],permissions:[ref('permission','view'),ref('permission','edit')],
  deletion:{mode:'hard',requiresApproval:false},public:false};
const declarations = [
  {id:'view',actions:['read']}, {id:'edit',actions:['create','update','delete']},
].map(p => ({...p,title:p.id,audiences:['admin','app'],actors:['user','machine','impersonated-user'],scopes:[],context:'required',default:'deny',
  resources:[ref('model','record')],enforcement:{request:true,commit:true},public:false}));
const permissions = declarations.map(p => ({id:`${moduleId}:${p.id}`,audiences:p.audiences,actors:p.actors}));
const generated = generateD1Schema(moduleId,[model]);
const catalog = {schemaVersion:1,compositionDigest:`sha256-${'b'.repeat(64)}`,modules:[{moduleId,version:'1.0.0',enabled:true,
  permissions:declarations,models:[{modelId:model.id,table:generated.tables.record,model}]}]};
const target = (contextId='context-x',audience='admin',actors=['user'],requiredPermissionIds=[permissions[0].id]) => ({contextId,audience,actors,requiredPermissionIds,purpose:'operation'});
const q = id => `"${ACCESS_TABLES[id]}"`;
const code = expected => error => error instanceof DataAccessError && error.code === expected;
const good = value => {assert.equal(value.ok,true,JSON.stringify(value));return value;};

test('plain data capture rejects executable/accessor/cyclic/oversized containers before use', () => {
  let called=0;
  assert.throws(()=>copyJson({get value(){called++;return 'bad';}}),code('invalid_input'));
  const altered=['a'];Object.setPrototypeOf(altered,{...Array.prototype,map(){called++;return [];}});
  assert.throws(()=>copyJson(altered),code('invalid_input'));
  const cyclic={};cyclic.self=cyclic;
  assert.throws(()=>copyJson(cyclic),code('invalid_input'));
  assert.throws(()=>copyJson('é'.repeat(32769)),code('invalid_input'));
  assert.throws(()=>copyJson({value:'\ud800'}),code('invalid_input'));
  assert.equal(called,0);
  assert.throws(()=>decodeRows([{value:null}],[f('value','string',{nullable:true,constraints:{enum:['allowed']}})]),code('invalid_input'));
});

test('data ports use live native credentials, exact scopes and atomic D1 plans', {timeout:60000}, async t => {
  const runtime = new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',d1Databases:{DB:'creezio-data-access-qualification'},d1Persist:false});
  try {
    const db=await runtime.getD1Database('DB'),schema=loadAccessInstallPlan();
    await db.batch([...schema.statements,...generated.statements].map(sql=>db.prepare(sql)));
    const accounts=createAccountService(db),capability=await provisionBootstrapCapability(db);
    const password='Synthetic data qualification password only';
    const owner=good(await accounts.bootstrap({token:capability.token,loginIdentifier:'data-owner@example.invalid',displayName:'Data owner',password}));
    const signed=good(await accounts.login({loginIdentifier:'data-owner@example.invalid',password,audience:'admin'}));
    const lifecycle=createAccountLifecycleService(db,{permissions});
    const invited=good(await lifecycle.issueInvitation(signed.token,{loginIdentifier:'data-subject@example.invalid',displayName:'Data subject'}));
    const subject=good(await lifecycle.redeem({token:invited.token,purpose:'invitation',password}));
    const machines=createMachineAccountService(db,{permissions});
    const machine=good(await machines.createService(signed.token,{displayName:'Data machine'}));
    const acl=createAuthorizationService(db,{permissions}),current=good(await acl.readPolicy(signed.token)),policy=structuredClone(current.policy);
    policy.roles.find(role=>role.id==='administrator').permissionIds.push('creezio.access:impersonate');
    policy.roles.push({id:'record-editor',inherits:[],permissionIds:permissions.map(p=>p.id),permissionOverrides:[]});
    for(const contextId of ['context-x','context-y']) {
      policy.contexts.push({id:contextId,status:'active'});
      for(const principalId of [owner.principalId,subject.principalId,machine.principal.id]) for(const audience of ['admin','app']) {
        policy.memberships.push({principalId,contextId,audience,status:'active'});
        policy.assignments.push({principalId,contextId,audience,roleId:'record-editor'});
      }
    }
    good(await acl.replacePolicy(signed.token,{expectedEpoch:current.epoch,policy}));
    const data=createDataAccess(db,{catalog,permissions});
    const fresh=async (credential={kind:'session',token:signed.token},to=target(),source=data) => {
      const lease=await source.authorize(credential,to,{moduleId});return {lease,port:source.forModule(lease,moduleId)};
    };
    const initial=await fresh();
    await initial.port.create('record',{values:{id:'record-a',title:"literal '); DROP TABLE x; --",revision:0,flag:true,payload:{nested:['one',2]}}});

    await t.test('declared encodings, fields and keyset pages remain bounded and private',async()=>{
      const {port}=await fresh(),row=await port.get('record',{key:{id:'record-a'}});
      assert.equal(row.flag,true);assert.deepEqual(JSON.parse(JSON.stringify(row.payload)),{nested:['one',2]});
      assert.equal(Object.hasOwn(row,'secret'),false);assert.equal(Object.hasOwn(row,'context_id'),false);
      for(const id of ['record-b','record-c']) await port.create('record',{values:{id,title:id,revision:0}});
      const first=await port.list('record',{limit:2}),second=await port.list('record',{limit:2,after:first.nextAfter});
      assert.deepEqual(first.items.map(r=>r.id),['record-a','record-b']);assert.deepEqual(second.items.map(r=>r.id),['record-c']);
      assert.equal(second.nextAfter,null);assert.ok(Object.isFrozen(first.items));
      assert.throws(()=>port.planList('record',{limit:51}),code('invalid_input'));
      assert.throws(()=>port.planGet('record',{key:{id:'record-a'},fields:['secret']}),code('forbidden'));
      assert.throws(()=>port.planPatch('record',{key:{id:'record-a'},values:{secret:'leaked'}}),code('forbidden'));
      assert.throws(()=>port.planPatch('record',{key:{id:'record-a'},values:{context_id:'context-y'}}),code('forbidden'));
      assert.throws(()=>port.planGet('record',{key:{id:'record-a'},where:{secret:'sealed'}}),code('forbidden'));
    });
    await t.test('plans with required reads roll back earlier writes and cannot be replayed',async()=>{
      const {lease,port}=await fresh();
      const inserted=port.planCreate('record',{values:{id:'rolled-back',title:'absent',revision:0}});
      const required=port.planGet('record',{key:{id:'record-a'},where:{title:'no-match'},required:true});
      await assert.rejects(()=>data.commitBatch(lease,[inserted,required]),code('storage_error'));
      assert.equal(await port.get('record',{key:{id:'rolled-back'}}),null);
      await assert.rejects(()=>data.commitBatch(lease,[inserted]),code('invalid_plan'));
      const next=port.planPatch('record',{key:{id:'record-a'},values:{title:'updated'},compare:{field:'revision',expected:0}});
      await data.commitBatch(lease,[next]);
      assert.equal((await port.get('record',{key:{id:'record-a'}})).revision,1);
    });
    await t.test('internal field ports expose only their fixed mapping, still requiring a live lease',async()=>{
      const {lease}=await fresh(),port=data.internalPort(lease,{moduleId,modelId:'record',fields:['id','secret','revision']});
      const privateRow=await port.get('record',{key:{id:'record-a'}});assert.equal(privateRow.secret,'sealed');
      assert.equal(Object.hasOwn(privateRow,'title'),false);
      assert.throws(()=>port.planGet('record',{key:{id:'record-a'},fields:['title']}),code('forbidden'));
      await port.patch('record',{key:{id:'record-a'},values:{secret:'rotated'},compare:{field:'revision',expected:1}});
      assert.ok(Object.isFrozen(data.describeLease(lease)));data.dispose(lease);
      assert.throws(()=>data.describeLease(lease),code('invalid_lease'));
      await assert.rejects(()=>port.get('record',{key:{id:'record-a'}}),code('invalid_lease'));
    });
    await t.test('actions and resources are explicit, with no grant from a permissive operation target',async()=>{
      const readOnly=good(await machines.issueToken(signed.token,{principalId:machine.principal.id,label:'Read X admin',ttlMs:60000,
        scopes:[{contextId:'context-x',audience:'admin',permissionIds:[permissions[0].id]},
          {contextId:'context-y',audience:'app',permissionIds:[permissions[1].id]}]}));
      const credential={kind:'api-token',token:readOnly.token};
      const x=await fresh(credential,target('context-x','admin',['machine'],[]));
      assert.doesNotThrow(()=>data.requirePermissions(x.lease,[permissions[0].id]));
      assert.throws(()=>data.requirePermissions(x.lease,[permissions[1].id]),code('forbidden'));
      assert.ok(await x.port.get('record',{key:{id:'record-a'}}));
      assert.throws(()=>x.port.planPatch('record',{key:{id:'record-a'},values:{title:'scope bypass'}}),code('forbidden'));
      await assert.rejects(()=>fresh(credential,target('context-y','admin',['machine'],[])),code('unauthorized'));
      await assert.rejects(()=>fresh(credential,target('context-x','app',['machine'],[])),code('unauthorized'));
      const y=await fresh(credential,target('context-y','app',['machine'],[permissions[1].id]));
      await y.port.create('record',{values:{id:'machine-y',title:'machine only',revision:0}});
      assert.throws(()=>y.port.planGet('record',{key:{id:'machine-y'}}),code('forbidden'));
      const planned=x.port.planGet('record',{key:{id:'record-a'}});
      good(await machines.revokeToken(signed.token,{credentialId:readOnly.credential.id}));
      await assert.rejects(()=>data.readBatch(x.lease,[planned]),code('storage_error'));
    });
    await t.test('impersonation retains source and subject and rechecks termination before commit',async()=>{
      const impersonations=createImpersonationService(db,{permissions});
      const issued=good(await impersonations.start(signed.token,{subjectPrincipalId:subject.principalId,contextId:'context-x',audience:'admin',
        permissionIds:permissions.map(p=>p.id),reason:'Synthetic data qualification',ttlMs:60000}));
      const {lease,port}=await fresh({kind:'impersonation',token:issued.token},target('context-x','admin',['impersonated-user']));
      const projection=data.describeLease(lease);
      assert.equal(projection.principalId,subject.principalId);assert.equal(projection.actorPrincipalId,owner.principalId);
      assert.equal(projection.credentialKind,'impersonation');
      await port.patch('record',{key:{id:'record-a'},values:{title:'subject operation'},compare:{field:'revision',expected:2}});
      const planned=port.planCreate('record',{values:{id:'ended-impersonation',title:'must not exist',revision:0}});
      good(await impersonations.stop(issued.token));
      await assert.rejects(()=>data.commitBatch(lease,[planned]),code('storage_error'));
      assert.equal(await db.prepare(`SELECT count(*) AS n FROM "${generated.tables.record}" WHERE id='ended-impersonation'`).first('n'),0);
    });
    await t.test('changes to epoch, membership, expiry and account versions refuse subsequent reads and writes',async()=>{
      const changes=[
        [`UPDATE ${q('authorization_state')} SET epoch=epoch+1 WHERE id='application'`,[],`UPDATE ${q('authorization_state')} SET epoch=epoch-1 WHERE id='application'`,[]],
        [`UPDATE ${q('memberships')} SET status='disabled' WHERE principal_id=? AND context_id='context-x' AND audience='admin'`,[owner.principalId],`UPDATE ${q('memberships')} SET status='active' WHERE principal_id=? AND context_id='context-x' AND audience='admin'`,[owner.principalId]],
        [`UPDATE ${q('human_accounts')} SET version=version+1 WHERE principal_id=?`,[owner.principalId],`UPDATE ${q('human_accounts')} SET version=version-1 WHERE principal_id=?`,[owner.principalId]],
        [`UPDATE ${q('password_credentials')} SET expires_at_ms=0 WHERE principal_id=?`,[owner.principalId],`UPDATE ${q('password_credentials')} SET expires_at_ms=NULL WHERE principal_id=?`,[owner.principalId]],
      ];
      for(let i=0;i<changes.length;i++) {
        const {lease,port}=await fresh(),plan=port.planCreate('record',{values:{id:`rejected-${i}`,title:'no',revision:0}});
        const [sql,bindings,restore,restoreBindings]=changes[i];await db.prepare(sql).bind(...bindings).run();
        try {await assert.rejects(()=>port.get('record',{key:{id:'record-a'}}),code('storage_error'));
          await assert.rejects(()=>data.commitBatch(lease,[plan]),code('storage_error'));
        } finally {await db.prepare(restore).bind(...restoreBindings).run();}
      }
      assert.equal(await db.prepare(`SELECT count(*) AS n FROM "${generated.tables.record}" WHERE id LIKE 'rejected-%'`).first('n'),0);
    });
    await t.test('unimplemented deletion/relations/computed capabilities fail closed before database access',async()=>{
      for(const change of [m=>{m.deletion.mode='soft';},m=>{m.deletion.requiresApproval=true;},
        m=>{m.relations.push({id:'parent',fields:['id'],target:ref('model','record'),targetFields:['id'],onDelete:'restrict'});}]) {
        const variant=structuredClone(catalog);change(variant.modules[0].models[0].model);
        const service=createDataAccess(db,{catalog:variant,permissions}),{port}=await fresh(undefined,undefined,service);
        assert.throws(()=>port.planDelete('record',{key:{id:'record-a'}}),code('unsupported'));
      }
      const disabled=structuredClone(catalog);disabled.modules[0].enabled=false;
      await assert.rejects(()=>fresh(undefined,undefined,createDataAccess(db,{catalog:disabled,permissions})),code('forbidden'));
      const computed=structuredClone(catalog);computed.modules[0].models[0].model.fields.push(f('derived','string',{computed:true}));
      const {port}=await fresh(undefined,undefined,createDataAccess(db,{catalog:computed,permissions}));
      assert.throws(()=>port.planPatch('record',{key:{id:'record-a'},values:{derived:'not stored'}}),code('forbidden'));
      const booleanKey=structuredClone(catalog);booleanKey.modules[0].models[0].model.primaryKey=['context_id','flag'];
      const booleanPort=(await fresh(undefined,undefined,createDataAccess(db,{catalog:booleanKey,permissions}))).port;
      assert.throws(()=>booleanPort.planList('record',{limit:1}),code('unsupported'));
    });
    await t.test('OAuth, foreign token purposes and human approvals are not fabricated',async()=>{
      await assert.rejects(()=>fresh({kind:'oauth',token:signed.token}),code('invalid_input'));
      await assert.rejects(()=>fresh({kind:'api-token',token:signed.token}),code('unauthorized'));
      await assert.rejects(()=>fresh(undefined,{...target(),purpose:'human-approval'}),code('invalid_input'));
    });
    await t.test('oversized selected payload aborts in D1 before the row is transferred',async()=>{
      await db.prepare(`UPDATE "${generated.tables.record}" SET title=? WHERE context_id='context-x' AND id='record-a'`)
        .bind('x'.repeat(300000)).run();
      let oversizedTransferred=false;
      const observed={prepare:sql=>db.prepare(sql),batch:async statements=>{
        const result=await db.batch(statements);
        oversizedTransferred=result.some(r=>r.results.some(row=>typeof row.title==='string'&&row.title.length>262144));
        return result;
      }};
      const service=createDataAccess(observed,{catalog,permissions}),{port}=await fresh(undefined,undefined,service);
      await assert.rejects(()=>port.get('record',{key:{id:'record-a'}}),code('storage_error'));
      assert.equal(oversizedTransferred,false);
      assert.equal((await port.get('record',{key:{id:'record-a'},fields:['id','revision']})).id,'record-a');
    });
  } finally {await runtime.dispose();}
});
