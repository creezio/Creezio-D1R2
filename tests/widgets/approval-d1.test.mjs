import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationFixture,quote} from '../operations/fixtures/identity.mjs';
import {createFixtureRegistry} from '../operations/fixtures/handlers.mjs';
import {moduleId,permissions} from '../operations/fixtures/operations.mjs';
import {createWidgetApprovalService} from '../../core/widgets/approval.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {OPERATION_TABLES} from '../../core/operations/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';

const good=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};

test('native human approval binds the exact command and is consumed once with its D1 effect',{timeout:60000},async()=>{
  const fixture=await createOperationFixture();
  try{
    const current=good(await fixture.authorization.readPolicy(fixture.ownerSession.token));
    const policy=structuredClone(current.policy);
    policy.roles.find(role=>role.id==='operation-user').permissionIds.push(`${moduleId}:approve`);
    good(await fixture.authorization.replacePolicy(fixture.ownerSession.token,{expectedEpoch:current.epoch,policy}));
    const {registry}=await createFixtureRegistry({overrides:{approved_rename(input,context){
      return {output:{id:input.id,title:input.title,revision:input.record_version+1},
        plans:[context.data.planPatch('record',{key:{id:input.id},
          compare:{field:'revision',expected:input.record_version},values:{title:input.title}})]};
    }}});
    const approvals=createWidgetApprovalService({db:fixture.db,catalog:fixture.catalog,permissions,registry});
    const engine=createOperationEngine({db:fixture.db,catalog:fixture.catalog,permissions,registry,approvals});
    const credential={kind:'session',token:good(await fixture.accounts.login({
      loginIdentifier:'operations-subject@example.invalid',password:'Synthetic operation qualification password',
      audience:'admin'})).token},contextId='application',audience='admin';
    const input={id:'approval-record',title:'Approved title',request_id:'approval-request',record_version:0};
    const create=await engine.invoke({credential,moduleId,operationId:'create_record',contextId,audience,
      input:{id:input.id,title:'Before',request_id:'approval-create'}});
    assert.equal(create.execution.state,'succeeded');
    const invoke=approvalId=>engine.invoke({credential,moduleId,operationId:'approved_rename',
      contextId,audience,input,...(approvalId?{approvalId}:{})});
    await assert.rejects(invoke(),{code:'approval_required'});
    const requested=await approvals.request({credential,audience,contextId,moduleId,operationId:'approved_rename',input});
    assert.equal(requested.state,'pending');
    const preview=await approvals.preview({credential,audience,contextId,approvalId:requested.approvalId});
    assert.equal(preview.fields.title,'Approved title');
    assert.equal(preview.fields.record_version,0);
    assert.ok(preview.csrfNonce);
    const decided=await approvals.decide({credential,audience,contextId,approvalId:requested.approvalId,
      decision:'approve',csrfNonce:preview.csrfNonce});
    assert.equal(decided.state,'approved');
    await assert.rejects(approvals.decide({credential,audience,contextId,approvalId:requested.approvalId,
      decision:'approve',csrfNonce:preview.csrfNonce}),{code:'conflict'});
    const first=await invoke(requested.approvalId);
    assert.equal(first.execution.state,'succeeded',JSON.stringify(first));
    assert.equal(first.execution.output.title,'Approved title');
    assert.equal((await fixture.record(input.id)).title,'Approved title');
    const row=await fixture.db.prepare(`SELECT state,object_version,consumed_nonce FROM ${quote(OPERATION_TABLES.approvals)} WHERE id=?`)
      .bind(requested.approvalId).first();
    assert.equal(row.state,'consumed');assert.equal(row.object_version,'0');assert.ok(row.consumed_nonce);
    const replay=await invoke();
    assert.equal(replay.replayed,true);assert.equal(replay.execution.id,first.execution.id);
    await assert.rejects(approvals.request({credential,audience,contextId,moduleId,operationId:'approved_rename',
      input:{...input,title:'Other title'}}),{code:'conflict'});
    const stale={...input,title:'Must roll back',request_id:'approval-stale'};
    const staleRequest=await approvals.request({credential,audience,contextId,moduleId,operationId:'approved_rename',input:stale});
    const stalePreview=await approvals.preview({credential,audience,contextId,approvalId:staleRequest.approvalId});
    await approvals.decide({credential,audience,contextId,approvalId:staleRequest.approvalId,
      decision:'approve',csrfNonce:stalePreview.csrfNonce});
    const failed=await engine.invoke({credential,moduleId,operationId:'approved_rename',contextId,audience,
      input:stale,approvalId:staleRequest.approvalId}).catch(error=>error);
    assert.notEqual(failed?.execution?.state,'succeeded');
    assert.equal((await fixture.record(input.id)).title,'Approved title');
    assert.equal((await fixture.db.prepare(`SELECT state FROM ${quote(OPERATION_TABLES.approvals)} WHERE id=?`)
      .bind(staleRequest.approvalId).first()).state,'approved');
  }finally{await fixture.dispose();}
});

test('OAuth approval resolves only the live exact approved grant without a client pointer',{timeout:60000},async()=>{
  const fixture=await createOperationFixture();
  try{
    const current=good(await fixture.authorization.readPolicy(fixture.ownerSession.token));
    const policy=structuredClone(current.policy);
    policy.roles.find(role=>role.id==='operation-user').permissionIds.push(`${moduleId}:approve`);
    good(await fixture.authorization.replacePolicy(fixture.ownerSession.token,{expectedEpoch:current.epoch,policy}));
    const {registry}=await createFixtureRegistry({delegatedUser:true,overrides:{approved_rename(input,context){
      return {output:{id:input.id,title:input.title,revision:input.record_version+1},
        plans:[context.data.planPatch('record',{key:{id:input.id},
          compare:{field:'revision',expected:input.record_version},values:{title:input.title}})]};
    }}});
    const catalog=structuredClone(fixture.catalog),delegatedPermissions=permissions.map(item=>item.id===`${moduleId}:edit`
      ?{...item,actors:[...item.actors,'delegated-user']}:item);
    catalog.compositionDigest=registry.compositionDigest;
    catalog.modules[0].permissions.find(item=>item.id==='edit').actors.push('delegated-user');
    const approvals=createWidgetApprovalService({db:fixture.db,catalog,permissions:delegatedPermissions,registry});
    const engine=createOperationEngine({db:fixture.db,catalog,permissions:delegatedPermissions,registry,approvals});
    const session={kind:'session',token:fixture.subjectSession.token};
    const resource='https://example.invalid/mcp/admin',oauth=await issueOpaqueToken('oauth-access');
    const versions=await fixture.db.prepare(`SELECT p.auth_version AS authVersion,h.version AS accountVersion,
      pc.version AS credentialVersion FROM ${quote(ACCESS_TABLES.principals)} p
      JOIN ${quote(ACCESS_TABLES.human_accounts)} h ON h.principal_id=p.id
      JOIN ${quote(ACCESS_TABLES.password_credentials)} pc ON pc.principal_id=p.id WHERE p.id=?`)
      .bind(fixture.subject.principalId).first();
    const now=Date.now(),clientId='client-widget-approval',grantId='grant-widget-approval';
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_clients)}
        (id,display_name,redirect_uris_json,token_endpoint_auth_method,scope_allowlist_json,registration_kind,created_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,?,?,NULL)`).bind(clientId,'Widget approval test','[]','none',`["${moduleId}:edit"]`,'predefined',now),
      fixture.db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_grants)}
        (id,principal_id,client_id,resource,audience,context_id,scopes_json,permission_ids_json,
          auth_version,account_version,credential_version,created_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind(grantId,fixture.subject.principalId,clientId,resource,'admin','application',
          `["${moduleId}:edit"]`,`["${moduleId}:edit"]`,versions.authVersion,versions.accountVersion,
          versions.credentialVersion,now),
      fixture.db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_access_tokens)}
        (id,secret_hash,grant_id,created_at_ms,expires_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,NULL)`).bind('token-widget-approval',oauth.digest,grantId,now,now+3_600_000),
    ]);
    const credential={kind:'oauth',token:oauth.token,resource},audience='admin',contextId='application';
    const input={id:'oauth-approved-record',title:'OAuth approved',request_id:'oauth-approval-1',record_version:0};
    assert.equal((await engine.invoke({credential:session,moduleId,operationId:'create_record',audience,contextId,
      input:{id:input.id,title:'Before',request_id:'oauth-create'}})).execution.state,'succeeded');
    const request={credential,audience,contextId,moduleId,operationId:'approved_rename',input};
    await assert.rejects(engine.invoke(request),{code:'approval_required'});
    const pending=await approvals.request(request);
    assert.equal(await approvals.resolveApproved(request),null);
    const preview=await approvals.preview({credential:session,audience,contextId,approvalId:pending.approvalId});
    await approvals.decide({credential:session,audience,contextId,approvalId:pending.approvalId,
      decision:'approve',csrfNonce:preview.csrfNonce});
    assert.deepEqual(await approvals.resolveApproved(request),{approvalId:pending.approvalId});
    assert.equal(await approvals.resolveApproved({...request,input:{...input,title:'Altered'}}),null);
    assert.equal(await approvals.resolveApproved({...request,input:{...input,record_version:1}}),null);
    await assert.rejects(approvals.resolveApproved({...request,contextId:'other'}),{code:'forbidden'});
    const otherOAuth=await issueOpaqueToken('oauth-access');
    await fixture.db.batch([
      fixture.db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_clients)}
        (id,display_name,redirect_uris_json,token_endpoint_auth_method,scope_allowlist_json,registration_kind,created_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,?,?,NULL)`).bind('client-other-approval','Other client','[]','none',`["${moduleId}:edit"]`,'predefined',now),
      fixture.db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_grants)}
        (id,principal_id,client_id,resource,audience,context_id,scopes_json,permission_ids_json,
          auth_version,account_version,credential_version,created_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind('grant-other-approval',fixture.subject.principalId,
          'client-other-approval',resource,'admin','application',`["${moduleId}:edit"]`,`["${moduleId}:edit"]`,
          versions.authVersion,versions.accountVersion,versions.credentialVersion,now),
      fixture.db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_access_tokens)}
        (id,secret_hash,grant_id,created_at_ms,expires_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,NULL)`).bind('token-other-approval',otherOAuth.digest,'grant-other-approval',now,now+3_600_000),
    ]);
    assert.equal(await approvals.resolveApproved({...request,credential:{...credential,token:otherOAuth.token}}),null);
    await fixture.db.prepare(`UPDATE ${quote(OPERATION_TABLES.approvals)} SET expires_at_ms=? WHERE id=?`)
      .bind(now-1000,pending.approvalId).run();
    assert.equal(await approvals.resolveApproved(request),null);
    await fixture.db.prepare(`UPDATE ${quote(OPERATION_TABLES.approvals)} SET expires_at_ms=? WHERE id=?`)
      .bind(now+60_000,pending.approvalId).run();
    await fixture.db.prepare(`UPDATE ${quote(ACCESS_TABLES.oauth_access_tokens)} SET revoked_at_ms=? WHERE grant_id=?`)
      .bind(now,grantId).run();
    await assert.rejects(approvals.resolveApproved(request),{code:'forbidden'});
    await fixture.db.prepare(`UPDATE ${quote(ACCESS_TABLES.oauth_access_tokens)} SET revoked_at_ms=NULL WHERE grant_id=?`)
      .bind(grantId).run();
    assert.equal((await fixture.record(input.id)).title,'Before');
    const pointer=await approvals.resolveApproved(request);
    const completed=await engine.invoke({...request,approvalId:pointer.approvalId});
    assert.equal(completed.execution.state,'succeeded');
    assert.equal((await fixture.record(input.id)).title,'OAuth approved');
    assert.equal((await fixture.db.prepare(`SELECT state FROM ${quote(OPERATION_TABLES.approvals)} WHERE id=?`)
      .bind(pending.approvalId).first()).state,'consumed');
    assert.equal(await approvals.resolveApproved(request),null);
  }finally{await fixture.dispose();}
});
