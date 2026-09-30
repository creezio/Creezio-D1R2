import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createStorageFixture,permissions} from '../data/fixtures/storage.mjs';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {createImpersonationService} from '../../core/identity/impersonation.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {createStorageMutationPort} from '../../core/storage-authority/native-mutation.ts';

const authority=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;

test('routed impersonation stop resumes a partial fence without revoking source early',
  {timeout:60000},async()=>{
  const fixture=await createStorageFixture();
  const local=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{A:'t33-impersonation-a',B:'t33-impersonation-b'},
    d1Persist:false,telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  try{
    const source=fixture.db,a=await local.getD1Database('A'),b=await local.getD1Database('B');
    await source.batch(authority.statements.map(sql=>source.prepare(sql)));
    const lifecycle=createAccountLifecycleService(source,{permissions});
    const invitation=await lifecycle.issueInvitation(fixture.signed.token,
      {loginIdentifier:'subject-t33@example.invalid',displayName:'Subject T33'});
    assert.equal(invitation.ok,true,JSON.stringify(invitation));
    const subject=await lifecycle.redeem({token:invitation.token,purpose:'invitation',
      password:'Synthetic subject password for routed impersonation'});
    assert.equal(subject.ok,true,JSON.stringify(subject));
    const scopedPermissions=permissions.map(item=>item.id==='example.storage:records'
      ?{...item,actors:['user','impersonated-user']}:item);
    const acl=createAuthorizationService(source,{permissions:scopedPermissions});
    const before=await acl.readPolicy(fixture.signed.token);assert.equal(before.ok,true);
    const policy=structuredClone(before.policy);
    policy.memberships.push({principalId:subject.principalId,contextId:'other',audience:'admin',status:'active'});
    policy.assignments.push({principalId:subject.principalId,contextId:'other',audience:'admin',roleId:'storage'});
    policy.roles.push({id:'support-t33',inherits:[],permissionIds:['creezio.access:impersonate'],permissionOverrides:[]});
    policy.assignments.push({principalId:fixture.owner.principalId,contextId:'application',audience:'admin',roleId:'support-t33'});
    assert.equal((await acl.replacePolicy(fixture.signed.token,{expectedEpoch:before.epoch,policy})).ok,true);
    const epoch=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
      WHERE id='application'`).first()).epoch;
    const identities=[{installationId:'t33-impersonation',contextId:'other',slot:1},
      {installationId:'t33-impersonation',contextId:'tenant-b',slot:2}];
    for(const [db,identity] of [[a,identities[0]],[b,identities[1]]]){
      await db.batch(authority.statements.map(sql=>db.prepare(sql)));
      await db.prepare(`INSERT INTO ${routes}
        (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
        VALUES (?,?,?,1,'active',NULL,?,0)`)
        .bind(identity.contextId,identity.installationId,identity.slot,epoch).run();
    }
    const input={subjectPrincipalId:subject.principalId,contextId:'other',audience:'admin',
      permissionIds:['example.storage:records'],reason:'Synthetic routed support investigation',ttlMs:60000};
    const healthy=createImpersonationService(source,{permissions:scopedPermissions,
      storageMutation:createStorageMutationPort(source,[{identity:identities[0],db:a},
        {identity:identities[1],db:b}])});
    const started=await healthy.start(fixture.signed.token,input);
    assert.equal(started.ok,true,JSON.stringify(started));
    const unavailable={prepare(sql){return b.prepare(sql);},batch(){throw new Error('target unavailable');}};
    const blocked=createImpersonationService(source,{permissions:scopedPermissions,
      storageMutation:createStorageMutationPort(source,[{identity:identities[0],db:a},
        {identity:identities[1],db:unavailable}])});
    assert.deepEqual(await blocked.stop(started.token),{ok:false,error:'storage_error'});
    assert.equal((await a.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.equal((await b.prepare(`SELECT state FROM ${routes}`).first()).state,'active');
    assert.equal((await healthy.check(started.token,{contextId:'other',audience:'admin',
      actors:['impersonated-user'],requiredPermissionIds:['example.storage:records'],
      purpose:'operation'})).allowed,true);
    assert.deepEqual(await healthy.stop(started.token),{ok:true});
    assert.equal((await healthy.check(started.token,{contextId:'other',audience:'admin',
      actors:['impersonated-user'],requiredPermissionIds:['example.storage:records'],
      purpose:'operation'})).allowed,false);
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,2);
    }
  }finally{await local.dispose();await fixture.dispose();}
});
