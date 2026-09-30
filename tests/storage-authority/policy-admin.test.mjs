import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createStorageFixture,permissions} from '../data/fixtures/storage.mjs';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createAccountAdministrationService} from '../../core/identity/administration.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {createStorageMutationPort} from '../../core/storage-authority/native-mutation.ts';
import {createNativeStorageOperationCommit} from '../../core/storage-authority/native-operation.ts';

const schema=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;

test('routed policy and administration fence every target before acknowledging source commits',
  {timeout:60000},async()=>{
  const fixture=await createStorageFixture();
  const local=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{A:'t33-policy-a',B:'t33-policy-b'},
    d1Persist:false,telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  try{
    const source=fixture.db,a=await local.getD1Database('A'),b=await local.getD1Database('B');
    await source.batch(schema.statements.map(sql=>source.prepare(sql)));
    const epoch=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}" WHERE id='application'`).first()).epoch;
    const identities=[{installationId:'t33-policy-installation',contextId:'other',slot:1},
      {installationId:'t33-policy-installation',contextId:'tenant-b',slot:2}];
    for(const [db,identity] of [[a,identities[0]],[b,identities[1]]]){
      await db.batch(schema.statements.map(sql=>db.prepare(sql)));
      await db.prepare(`INSERT INTO ${routes}
        (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
        VALUES (?,?,?,1,'active',NULL,?,0)`)
        .bind(identity.contextId,identity.installationId,identity.slot,epoch).run();
    }
    const targets=[{identity:identities[0],db:a},{identity:identities[1],db:b}];
    const port=createStorageMutationPort(source,targets);
    const acl=createAuthorizationService(source,{permissions,storageMutation:port});
    const before=await acl.readPolicy(fixture.signed.token);assert.equal(before.ok,true);
    const policy=structuredClone(before.policy);
    policy.roles.find(role=>role.id==='storage').permissionIds=[];
    assert.deepEqual(await acl.replacePolicy(fixture.signed.token,{expectedEpoch:before.epoch,policy}),
      {ok:true,epoch:before.epoch+1});
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation,source_epoch AS sourceEpoch FROM ${routes}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,2);
      assert.equal(route.sourceEpoch,before.epoch+1);
    }
    const admin=createAccountAdministrationService(source,{permissions,storageMutation:port});
    assert.deepEqual(await admin.revokeSessionById(fixture.signed.token,{sessionId:fixture.signed.session.id}),
      {ok:true});
    assert.equal(await fixture.accounts.session(fixture.signed.token,'admin'),null);
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,3);
    }
    const beforeRace=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
      WHERE id='application'`).first()).epoch;
    let commits=0,begin,release;
    const started=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
    const racing={kind:'race.test',commandKey:'same-command',
      sourceCommit:async()=>{
        commits++;begin();await gate;
        await source.prepare(`UPDATE "${ACCESS_TABLES.authorization_state}" SET epoch=epoch+1
          WHERE id='application'`).run();
        return true;
      },committed:value=>value===true,
      inspectSource:async()=>
        (await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
          WHERE id='application'`).first()).epoch===beforeRace+1,
      recoverValue:async()=>true};
    const first=port.commit(racing);
    await started;
    assert.deepEqual(await port.commit(racing),{state:'pending'});
    release();
    assert.deepEqual(await first,{state:'confirmed',value:true});
    assert.equal(commits,1);
    assert.deepEqual(await port.commit(racing),{state:'confirmed',value:true});
    const machineAdmin=await fixture.accounts.login({loginIdentifier:'storage@example.invalid',
      password:'Synthetic storage qualification password',audience:'admin'});
    assert.equal(machineAdmin.ok,true);
    const machinePermissions=permissions.map(item=>item.id==='example.storage:records'
      ?{...item,actors:['user','machine']}:item);
    const machines=createMachineAccountService(source,{permissions:machinePermissions,storageMutation:port});
    const service=await machines.createService(machineAdmin.token,{displayName:'Routed service'});
    assert.equal(service.ok,true,JSON.stringify(service));
    const issued=await machines.issueToken(machineAdmin.token,{principalId:service.principal.id,
      label:'First token',ttlMs:60000,scopes:[{contextId:'other',audience:'admin',
        permissionIds:['example.storage:records']}]});
    assert.equal(issued.ok,true);
    const rotated=await machines.rotateToken(machineAdmin.token,{credentialId:issued.credential.id,ttlMs:60000});
    assert.equal(rotated.ok,true,JSON.stringify(rotated));
    assert.equal((await source.prepare(`SELECT revoked_at_ms AS revokedAtMs FROM "${ACCESS_TABLES.api_credentials}"
      WHERE id=?`).bind(issued.credential.id).first()).revokedAtMs!==null,true);
    assert.deepEqual(await machines.revokeToken(machineAdmin.token,{credentialId:rotated.credential.id}),
      {ok:true});
    assert.equal((await machines.setServiceStatus(machineAdmin.token,{principalId:service.principal.id,
      expectedAuthVersion:service.principal.authVersion,status:'disabled'})).ok,true);
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,7);
    }
    let reopenUnavailable=true;
    const delayed={prepare(sql){
      if(reopenUnavailable&&sql.includes("SET state='active'"))throw new Error('target ACK lost');
      return b.prepare(sql);
    },batch(statements){return b.batch(statements)}};
    const nativePort=createStorageMutationPort(source,[targets[0],{identity:identities[1],db:delayed}]);
    const native=createNativeStorageOperationCommit(source,nativePort);
    const legacy={id:'native-before-t33',state:'succeeded'};
    const legacyAuditId=await native.auditId('sessions.revoke',legacy.id);
    await source.prepare(`INSERT INTO "${ACCESS_TABLES.access_audit}"
      (id,action,principal_id,claim_nonce,created_at_ms,target_session_id)
      VALUES (?,'human-session-revoked',?,?,0,?)`)
      .bind(legacyAuditId,fixture.owner.principalId,crypto.randomUUID(),fixture.signed.session.id).run();
    const mutationCount=(await source.prepare(`SELECT COUNT(*) AS total FROM
      "${STORAGE_AUTHORITY_TABLES.storage_mutations}"`).first()).total;
    assert.deepEqual(await native.recover('sessions.revoke',legacy.id,async()=>legacy,
      value=>value.state==='succeeded'),{state:'pending'});
    assert.equal((await source.prepare(`SELECT COUNT(*) AS total FROM
      "${STORAGE_AUTHORITY_TABLES.storage_mutations}"`).first()).total,mutationCount);
    for(const db of [a,b])assert.deepEqual(await db.prepare(`SELECT state,generation FROM ${routes}`).first(),
      {state:'active',generation:7});
    const execution={id:'native-t33-execution',state:'succeeded'};
    const auditId=await native.auditId('sessions.revoke',execution.id);
    let nativeCommitted=false,nativeCommits=0;
    const nativeRequest={descriptor:{kind:'sessions.revoke',requestKey:'native-command',auditId,
      action:'human-session-revoked',targetSessionId:fixture.signed.session.id},
      executionId:execution.id,
      sourceCommit:async()=>{
        nativeCommits++;
        await source.prepare(`INSERT INTO "${ACCESS_TABLES.access_audit}"
          (id,action,principal_id,claim_nonce,created_at_ms,target_session_id)
          VALUES (?,'human-session-revoked',?,?,0,?)`)
          .bind(auditId,fixture.owner.principalId,crypto.randomUUID(),fixture.signed.session.id).run();
        nativeCommitted=true;return execution;
      },readExecution:async()=>nativeCommitted?execution:null,
      succeeded:value=>value.state==='succeeded'};
    assert.deepEqual(await native.commit(nativeRequest),{state:'pending'});
    assert.equal(nativeCommitted,true);
    assert.equal((await b.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.deepEqual(await native.recover('sessions.revoke',execution.id,nativeRequest.readExecution,
      nativeRequest.succeeded),{state:'pending'});
    reopenUnavailable=false;
    assert.deepEqual(await native.recover('sessions.revoke',execution.id,nativeRequest.readExecution,
      nativeRequest.succeeded),{state:'confirmed',value:execution});
    assert.deepEqual(await native.recover('sessions.revoke',execution.id,nativeRequest.readExecution,
      nativeRequest.succeeded),{state:'confirmed',value:execution});
    assert.equal(nativeCommits,1);
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,8);
    }
    const lifecycle=createAccountLifecycleService(source,{permissions,storageMutation:port});
    const capability=await lifecycle.issuePasswordReset(machineAdmin.token,{principalId:fixture.owner.principalId});
    assert.equal(capability.ok,true,JSON.stringify(capability));
    const newPassword='New synthetic routed password for qualification';
    assert.deepEqual(await lifecycle.redeem({token:capability.token,purpose:'password-reset',password:newPassword}),
      {ok:true,principalId:fixture.owner.principalId});
    assert.equal(await fixture.accounts.session(machineAdmin.token,'admin'),null);
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,9);
    }
    const beforeClaim=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
      WHERE id='application'`).first()).epoch;
    let failClaim=true,claimCommits=0;
    const transientSource={prepare(sql){return source.prepare(sql);},batch(statements){
      if(failClaim){failClaim=false;throw new Error('primary claim ACK unavailable');}
      return source.batch(statements);
    }};
    const retryable={kind:'claim.retry',commandKey:'atomic-all-targets',
      sourceCommit:async()=>{
        claimCommits++;
        await source.prepare(`UPDATE "${ACCESS_TABLES.authorization_state}" SET epoch=epoch+1
          WHERE id='application'`).run();
        return true;
      },committed:value=>value===true,
      inspectSource:async()=>
        (await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
          WHERE id='application'`).first()).epoch===beforeClaim+1,
      recoverValue:async()=>true};
    const claimFail=createStorageMutationPort(transientSource,targets);
    assert.deepEqual(await claimFail.commit(retryable),{state:'pending'});
    assert.equal(claimCommits,0);
    for(const db of [a,b])assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.deepEqual(await port.commit(retryable),{state:'confirmed',value:true});
    assert.equal(claimCommits,1);
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,10);
    }
    const login=await fixture.accounts.login({loginIdentifier:'storage@example.invalid',
      password:newPassword,audience:'admin'});
    assert.equal(login.ok,true);
    const unavailable={prepare(){throw new Error('target unavailable');},batch(){throw new Error('target unavailable');}};
    const blocked=createAccountAdministrationService(source,{permissions,storageMutation:
      createStorageMutationPort(source,[targets[0],{identity:identities[1],db:unavailable}])});
    assert.deepEqual(await blocked.revokeSessionById(login.token,{sessionId:login.session.id}),
      {ok:false,error:'storage_error'});
    assert.ok(await fixture.accounts.session(login.token,'admin'));
  }finally{await local.dispose();await fixture.dispose();}
});
