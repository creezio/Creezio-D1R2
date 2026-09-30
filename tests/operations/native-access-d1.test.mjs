import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {compileOperationSchemas} from '../../scripts/operations/schemas.mjs';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {OPERATION_TABLES} from '../../core/operations/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createAccountService, provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {resolveAccessHttpConfiguration,serializeAccessCookie} from '../../core/identity/http-policy.ts';
import {hostOnly} from '../../extensions/native/access/module/operations.ts';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const quote = value => `"${value.replaceAll('"','""')}"`;
const moduleId = 'creezio.access';
const manifest = json('../../extensions/native/access/module/manifest.json');
const stripeManifest=json('../../extensions/connectors/stripe/module/manifest.json');
const stripePermission=stripeManifest.contracts.permissions.filter(item=>item.id==='webhook.receive').map(item=>({
  id:'creezio.stripe:webhook.receive',audiences:item.audiences,actors:item.actors}));
const composition = json('../../configuration/composition.json');
const lock = json('../../configuration/composition.lock.json');
// This test qualifies the native Access adapter in isolation. Project the current
// application onto Access while retaining its exact descriptor and lock node.
composition.modules = composition.modules.filter(item => item.moduleId === moduleId);
for (const audience of ['admin','app']) composition.exposure[audience].moduleIds =
  composition.exposure[audience].moduleIds.filter(id => id === moduleId);
lock.modules = lock.modules.filter(item => item.moduleId === moduleId);
lock.modules[0].contractIntegrity = contractIntegrity(manifest);
lock.compositionIntegrity = contractIntegrity(composition);
const input = {composition,lock,modules:[manifest]};
const schema = compileCompositionSchema(input);

test('native Access effects, audit detail and T06 result commit together in real D1', {timeout:60000}, async () => {
  const compiled = compileOperationSchemas(input);
  const validators = {...await import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`)};
  const handlers = Object.fromEntries(manifest.contracts.operations.map(item => [`${moduleId}:${item.id}`,hostOnly]));
  const registry = createOperationRegistry({catalog:compiled.catalog,validators,handlers});
  const runtime = new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-access-operations-qualification'},d1Persist:false});
  try {
    const db=await runtime.getD1Database('DB');
    await db.batch(schema.statements.map(item=>db.prepare(item)));
    const accounts=createAccountService(db), bootstrap=await provisionBootstrapCapability(db);
    assert.ok(bootstrap);
    const password='Synthetic Access operations qualification password';
    const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'access-operations@example.invalid',
      displayName:'Access operations owner',password});
    assert.equal(owner.ok,true,JSON.stringify(owner));
    const session=await accounts.login({loginIdentifier:'access-operations@example.invalid',password,audience:'admin'});
    assert.equal(session.ok,true,JSON.stringify(session));
    const lifecycle=createAccountLifecycleService(db,{permissions:[]});
    const invitation=await lifecycle.issueInvitation(session.token,{loginIdentifier:'access-operations-user@example.invalid',
      displayName:'Access operations target'});
    assert.equal(invitation.ok,true,JSON.stringify(invitation));
    const target=await lifecycle.redeem({token:invitation.token,purpose:'invitation',password});
    assert.equal(target.ok,true,JSON.stringify(target));
    const targetSession=await accounts.login({loginIdentifier:'access-operations-user@example.invalid',password,audience:'app'});
    assert.equal(targetSession.ok,true,JSON.stringify(targetSession));
    const engine=createOperationEngine({db,registry,catalog:schema.runtimeCatalog,permissions:stripePermission});
    const invoke=(operationId, value) => engine.invoke({credential:{kind:'session',token:session.token},
      moduleId,operationId,contextId:'application',audience:'admin',input:value});
    const read=await invoke('policy.read',{});
    assert.equal(read.execution.state,'succeeded');
    const initial=read.execution.output.epoch;
    const permissions=await invoke('permissions.list',{limit:50});
    assert.equal(permissions.execution.state,'succeeded');
    assert.match(permissions.execution.output.catalogDigest,/^sha256:[a-f0-9]{64}$/);
    assert.ok(permissions.execution.output.items.some(item=>item.id==='creezio.access:manage'));
    const body={requestKey:'access-delta-1',expectedEpoch:initial,
      changes:[{kind:'role-grant',roleId:'administrator',permissionId:'creezio.access:impersonate',present:true}]};
    const applied=await invoke('policy.apply-delta',body);
    assert.equal(applied.execution.state,'succeeded',JSON.stringify(applied.execution));
    assert.equal(applied.execution.output.epoch,initial+1);
    const auditId=applied.execution.output.auditId;
    const detail=await db.prepare(`SELECT from_epoch,to_epoch,changes_json FROM ${quote(ACCESS_TABLES.access_policy_audit_details)} WHERE audit_id=?`)
      .bind(auditId).first();
    assert.equal(detail.from_epoch,initial);
    assert.equal(detail.to_epoch,initial+1);
    const envelope=JSON.parse(detail.changes_json);
    assert.equal(envelope.version,1);
    assert.equal(envelope.beforePolicy.roles.find(item=>item.id==='administrator').permissionIds.includes('creezio.access:impersonate'),false);
    assert.equal(envelope.afterPolicy.roles.find(item=>item.id==='administrator').permissionIds.includes('creezio.access:impersonate'),true);
    const replay=await invoke('policy.apply-delta',body);
    assert.equal(replay.replayed,true);
    assert.equal(replay.execution.id,applied.execution.id);
    await assert.rejects(invoke('policy.apply-delta',{...body,changes:[{...body.changes[0],present:false}]}),{code:'conflict'});
    assert.equal((await db.prepare(`SELECT epoch FROM ${quote(ACCESS_TABLES.authorization_state)} WHERE id='application'`).first()).epoch,initial+1);

    // The final operation audit fails after native writes have been prepared.
    // D1 must roll back policy, native audit/detail and execution result together.
    const operationAudit=quote(OPERATION_TABLES.audit);
    await db.prepare(`CREATE TRIGGER access_test_late_audit BEFORE INSERT ON ${operationAudit}
      WHEN NEW.event='committed' BEGIN SELECT RAISE(ABORT,'forced operation audit failure'); END`).run();
    const failedBody={requestKey:'access-delta-rollback',expectedEpoch:initial+1,
      changes:[{kind:'role-override',roleId:'administrator',permissionId:'creezio.access:impersonate',effect:'deny'}]};
    await assert.rejects(invoke('policy.apply-delta',failedBody),{code:'unknown'});
    const current=await db.prepare(`SELECT epoch FROM ${quote(ACCESS_TABLES.authorization_state)} WHERE id='application'`).first();
    assert.equal(current.epoch,initial+1);
    const nativeAudits=await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.access_audit)} WHERE action='authorization-updated'`).first();
    assert.equal(nativeAudits.n,1);
    const details=await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.access_policy_audit_details)}`).first();
    assert.equal(details.n,1);
    const execution=await engine.lookup({credential:{kind:'session',token:session.token},moduleId,
      operationId:'policy.apply-delta',contextId:'application',audience:'admin',requestKey:failedBody.requestKey});
    assert.notEqual(execution?.state,'succeeded');
    await db.prepare('DROP TRIGGER access_test_late_audit').run();
    const admission={requestKey:'access-admit-t33-context-a',expectedEpoch:initial+1,
      changes:[{kind:'context-admit',contextId:'t33-context-a',status:'disabled'}]};
    const admitted=await invoke('policy.apply-delta',admission);
    assert.equal(admitted.execution.state,'succeeded',JSON.stringify(admitted.execution));
    const admittedPolicy=(await invoke('policy.read',{})).execution.output.policy;
    assert.deepEqual({...admittedPolicy.contexts.find(item=>item.id==='t33-context-a')},
      {id:'t33-context-a',status:'disabled'});
    assert.equal(admittedPolicy.memberships.some(item=>item.contextId==='t33-context-a'),false);
    assert.equal(admittedPolicy.assignments.some(item=>item.contextId==='t33-context-a'),false);
    const admittedAudit=await invoke('audit.detail',{auditId:admitted.execution.output.auditId,limit:32});
    assert.equal(admittedAudit.execution.state,'succeeded');
    assert.deepEqual(admittedAudit.execution.output.changes.map(({kind,contextId,before,after})=>
      ({kind,contextId,before,after})),
    [{kind:'context-status',contextId:'t33-context-a',before:'absent',after:'disabled'}]);
    const duplicate=await invoke('policy.apply-delta',{...admission,requestKey:'access-admit-t33-duplicate',
      expectedEpoch:initial+2});
    assert.equal(duplicate.execution.state,'failed');
    assert.equal(duplicate.execution.errorCode,'invalid_input');
    const stale=await invoke('policy.apply-delta',{requestKey:'access-admit-t33-stale',expectedEpoch:initial+1,
      changes:[{kind:'context-admit',contextId:'t33-context-b',status:'active'}]});
    assert.equal(stale.execution.state,'failed');
    assert.equal(stale.execution.errorCode,'conflict');
    const created=await invoke('service.create',{requestKey:'webhook-service-create',displayName:'Stripe webhook fixture'});
    assert.equal(created.execution.state,'succeeded',JSON.stringify(created.execution));
    const serviceId=created.execution.output.principal.id;
    const policyBeforeService=(await invoke('policy.read',{})).execution.output;
    assert.equal(policyBeforeService.policy.memberships.some(item=>item.principalId===serviceId),false);
    assert.equal(policyBeforeService.policy.assignments.some(item=>item.principalId===serviceId),false);
    const admittedService=await invoke('policy.apply-delta',{requestKey:'webhook-service-grant',
      expectedEpoch:policyBeforeService.epoch,changes:[
        {kind:'membership',principalId:serviceId,contextId:'application',audience:'admin',status:'active'},
        {kind:'principal-override',principalId:serviceId,contextId:'application',audience:'admin',
          permissionId:'creezio.stripe:webhook.receive',effect:'allow'}]});
    assert.equal(admittedService.execution.state,'succeeded',JSON.stringify(admittedService.execution));
    const machineToken=await issueOpaqueToken('api-token');
    const issueInput={requestKey:'webhook-token-issue',label:'Signed Stripe webhook fixture',ttlMs:60000,
      scopes:[{contextId:'application',audience:'admin',permissionIds:['creezio.stripe:webhook.receive']}],
      apiToken:machineToken.token};
    const issueBinding=compileHttpBindings({composition,modules:[manifest],operationCatalog:compiled.catalog})
      .find(item=>item.id==='service.token.issue'&&item.audience==='admin');
    assert.ok(issueBinding);
    const issueHttp=createOperationHttpTransport([issueBinding],engine);
    const origin='https://access-operations.example.invalid';
    const cookie=serializeAccessCookie(resolveAccessHttpConfiguration({CREEZIO_APP_ORIGIN:origin},'sites'),
      'admin',session.token,session.session.expiresAtMs).split(';')[0];
    const issueRequest=()=>new Request(`${origin}/api/admin/access/services/${serviceId}/tokens/issue`,{
      method:'POST',headers:{cookie,origin,'content-type':'application/json','x-creezio-request':'1'},
      body:JSON.stringify(issueInput)});
    const issuedResponse=await issueHttp.dispatch(issueRequest(),{profile:'sites',bindings:{DB:db}},
      {CREEZIO_APP_ORIGIN:origin},'machine-issue-http');
    assert.equal(issuedResponse.status,200,await issuedResponse.clone().text());
    const issued=await issuedResponse.json();
    assert.equal(issued.execution.state,'succeeded',JSON.stringify(issued));
    const credentialId=issued.execution.output.credential.id;
    assert.equal(JSON.stringify(issued).includes(machineToken.token),false);
    const replayResponse=await issueHttp.dispatch(issueRequest(),{profile:'cloudflare',bindings:{DB:db}},
      {CREEZIO_APP_ORIGIN:origin},'machine-issue-replay');
    assert.equal(replayResponse.status,200);
    const replayIssue=await replayResponse.json();
    assert.equal(replayIssue.execution.id,issued.execution.id);
    assert.equal(replayIssue.execution.output.credential.id,credentialId);
    const credential=await db.prepare(`SELECT secret_hash FROM ${quote(ACCESS_TABLES.api_credentials)} WHERE id=?`)
      .bind(credentialId).first();
    assert.equal(credential.secret_hash,machineToken.digest);
    const machines=createMachineAccountService(db,{permissions:stripePermission});
    assert.equal((await machines.check(machineToken.token,{contextId:'application',audience:'admin',
      actors:['machine'],requiredPermissionIds:['creezio.stripe:webhook.receive'],purpose:'operation'})).allowed,true);
    assert.equal((await machines.check(machineToken.token,{contextId:'application',audience:'admin',
      actors:['machine'],requiredPermissionIds:['creezio.access:manage'],purpose:'operation'})).allowed,false);
    const readToken=await invoke('service.token.read',{credentialId});
    assert.equal(readToken.execution.state,'succeeded');
    assert.equal(readToken.execution.output.credential.id,credentialId);
    assert.equal(JSON.stringify(readToken).includes(machineToken.token),false);
    const persisted=await db.prepare(`SELECT input_hash,output FROM ${quote(OPERATION_TABLES.executions)} WHERE id=?`)
      .bind(issued.execution.id).first();
    assert.equal(JSON.stringify(persisted).includes(machineToken.token),false);
    const operationAuditRows=(await db.prepare(`SELECT * FROM ${quote(OPERATION_TABLES.audit)}
      WHERE execution_id=?`).bind(issued.execution.id).all()).results;
    const accessAuditRows=(await db.prepare(`SELECT * FROM ${quote(ACCESS_TABLES.access_audit)}
      WHERE action='api-token-issued'`).all()).results;
    assert.ok(accessAuditRows.length>0);
    assert.equal(JSON.stringify({operationAuditRows,accessAuditRows}).includes(machineToken.token),false);
    const forbiddenScopeToken=await issueOpaqueToken('api-token');
    await assert.rejects(invoke('service.token.issue',{...issueInput,
      requestKey:'webhook-token-broad-scope',apiToken:forbiddenScopeToken.token,
      scopes:[{contextId:'application',audience:'admin',permissionIds:['creezio.stripe:manage']}]}),
    {code:'invalid_input'});
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.api_credentials)}`).first()).n,1);
    const revokedToken=await invoke('service.token.revoke',{requestKey:'webhook-token-revoke',credentialId});
    assert.equal(revokedToken.execution.state,'succeeded');
    assert.equal((await machines.check(machineToken.token,{contextId:'application',audience:'admin',
      actors:['machine'],requiredPermissionIds:['creezio.stripe:webhook.receive'],purpose:'operation'})).allowed,false);
    const delegatedRevokeFixture=await issueOpaqueToken('api-token');
    const delegatedRevokeResponse=await issueHttp.dispatch(new Request(`${origin}/api/admin/access/services/${serviceId}/tokens/issue`,{
      method:'POST',headers:{cookie,origin,'content-type':'application/json','x-creezio-request':'1'},
      body:JSON.stringify({...issueInput,requestKey:'webhook-token-delegated-revoke',
        apiToken:delegatedRevokeFixture.token})}),{profile:'sites',bindings:{DB:db}},
    {CREEZIO_APP_ORIGIN:origin},'machine-issue-for-delegated-revoke');
    assert.equal(delegatedRevokeResponse.status,200);
    const delegatedRevokeCredentialId=(await delegatedRevokeResponse.json()).execution.output.credential.id;
    const serviceCountBefore=(await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.principals)}
      WHERE kind='service'`).first()).n;
    await db.prepare(`CREATE TRIGGER machine_test_late_audit BEFORE INSERT ON ${quote(OPERATION_TABLES.audit)}
      WHEN NEW.event='committed' BEGIN SELECT RAISE(ABORT,'forced machine audit failure'); END`).run();
    await assert.rejects(invoke('service.create',{requestKey:'webhook-service-rollback',
      displayName:'Must not persist'}),{code:'unknown'});
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.principals)}
      WHERE kind='service'`).first()).n,serviceCountBefore);
    assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${quote(ACCESS_TABLES.access_audit)}
      WHERE action='service-created'`).first()).n,1);
    await db.prepare('DROP TRIGGER machine_test_late_audit').run();
    const ownSessions=await invoke('sessions.list',{principalId:owner.principalId,limit:50});
    assert.equal(ownSessions.execution.state,'succeeded');
    assert.ok(ownSessions.execution.output.items.some(item=>item.id===session.session.id));
    const revoked=await invoke('sessions.revoke',{sessionId:session.session.id,requestKey:'self-revoke-1'});
    assert.equal(revoked.execution.state,'succeeded','the native claim completes after revoking its source session');
    assert.equal(revoked.execution.output.sessionId,session.session.id);
    assert.equal(revoked.execution.output.revoked,true);
    await assert.rejects(engine.lookup({credential:{kind:'session',token:session.token},moduleId,
      operationId:'sessions.revoke',contextId:'application',audience:'admin',requestKey:'self-revoke-1'}),
    {code:'unauthorized'},'a revoked credential cannot read status; this does not undo its completed effect');
    const row=await db.prepare(`SELECT revoked_at_ms FROM ${quote(ACCESS_TABLES.sessions)} WHERE id=?`)
      .bind(session.session.id).first();
    assert.ok(row.revoked_at_ms!==null);

    // A consented delegated user executes the same ten Access operations. The
    // access token is an OAuth credential, never a synthetic browser session.
    const versions=await db.prepare(`SELECT p.auth_version AS authVersion,h.version AS accountVersion,
      pc.version AS credentialVersion FROM ${quote(ACCESS_TABLES.principals)} p
      JOIN ${quote(ACCESS_TABLES.human_accounts)} h ON h.principal_id=p.id
      JOIN ${quote(ACCESS_TABLES.password_credentials)} pc ON pc.principal_id=p.id WHERE p.id=?`)
      .bind(owner.principalId).first();
    const oauth=await issueOpaqueToken('oauth-access');
    const resource='https://access-operations.example.invalid/mcp/admin';
    const clientId='client-access-test',grantId='grant-access-test',tokenId='token-access-test',now=Date.now();
    await db.batch([
      db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_clients)}
        (id,display_name,redirect_uris_json,token_endpoint_auth_method,scope_allowlist_json,registration_kind,created_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,?,?,NULL)`).bind(clientId,'Access test client','[]','none','["creezio.access:manage"]','predefined',now),
      db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_grants)}
        (id,principal_id,client_id,resource,audience,context_id,scopes_json,permission_ids_json,
          auth_version,account_version,credential_version,created_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).bind(grantId,owner.principalId,clientId,resource,'admin','application',
          '["creezio.access:manage"]','["creezio.access:manage"]',versions.authVersion,versions.accountVersion,
          versions.credentialVersion,now),
      db.prepare(`INSERT INTO ${quote(ACCESS_TABLES.oauth_access_tokens)}
        (id,secret_hash,grant_id,created_at_ms,expires_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,NULL)`).bind(tokenId,oauth.digest,grantId,now,now+3_600_000),
    ]);
    const delegated=(operationId,value)=>engine.invoke({credential:{kind:'oauth',token:oauth.token,resource},
      moduleId,operationId,contextId:'application',audience:'admin',input:value});
    const delegatedRead=await delegated('policy.read',{});
    assert.equal(delegatedRead.execution.state,'succeeded');
    const oauthIssueResponse=await issueHttp.dispatch(new Request(`${origin}/api/admin/access/services/${serviceId}/tokens/issue`,{
      method:'POST',headers:{authorization:`Bearer ${oauth.token}`,'content-type':'application/json',
        'x-creezio-request':'1'},body:JSON.stringify({...issueInput,requestKey:'oauth-http-issue-denied'})}),
    {profile:'sites',bindings:{DB:db}},{CREEZIO_APP_ORIGIN:origin},'oauth-machine-issue-refused');
    assert.equal(oauthIssueResponse.status,401);
    assert.equal((await delegated('service.token.read',{credentialId})).execution.state,'succeeded');
    const delegatedService=await delegated('service.create',{requestKey:'oauth-service-create',
      displayName:'Delegated metadata fixture'});
    assert.equal(delegatedService.execution.state,'succeeded',JSON.stringify(delegatedService.execution));
    const delegatedServiceId=delegatedService.execution.output.principal.id;
    const delegatedStatus=await delegated('service.status',{requestKey:'oauth-service-disable',
      principalId:delegatedServiceId,expectedAuthVersion:1,status:'disabled'});
    assert.equal(delegatedStatus.execution.state,'succeeded',JSON.stringify(delegatedStatus.execution));
    assert.equal(delegatedStatus.execution.output.principal.authVersion,2);
    const delegatedRevoke=await delegated('service.token.revoke',{requestKey:'oauth-machine-token-revoke',
      credentialId:delegatedRevokeCredentialId});
    assert.equal(delegatedRevoke.execution.state,'succeeded',JSON.stringify(delegatedRevoke.execution));
    const machineAudits=(await db.prepare(`SELECT action,principal_id AS principalId,
      credential_id AS actorCredentialId,target_principal_id AS targetPrincipalId,
      target_credential_id AS targetCredentialId FROM ${quote(ACCESS_TABLES.access_audit)}
      WHERE credential_id=? AND action IN ('service-created','service-status-updated','api-token-revoked')
      ORDER BY action`).bind(tokenId).all()).results;
    assert.deepEqual(machineAudits.map(row=>row.action),
      ['api-token-revoked','service-created','service-status-updated']);
    for(const row of machineAudits){
      assert.equal(row.principalId,owner.principalId);
      assert.equal(row.actorCredentialId,tokenId);
      assert.equal(row.targetPrincipalId,row.action==='api-token-revoked'?serviceId:delegatedServiceId);
      assert.equal(row.targetCredentialId,row.action==='api-token-revoked'?delegatedRevokeCredentialId:null);
    }
    await assert.rejects(delegated('service.token.issue',{requestKey:'oauth-token-denied',
      principalId:delegatedServiceId,label:'Denied',ttlMs:60000,
      scopes:[{contextId:'application',audience:'admin',permissionIds:['creezio.stripe:webhook.receive']}],
      apiToken:(await issueOpaqueToken('api-token')).token}),{code:'forbidden'});
    const httpBinding=compileHttpBindings({composition,modules:[manifest],operationCatalog:compiled.catalog})
      .find(item=>item.id==='policy.read' && item.audience==='admin');
    assert.ok(httpBinding);
    const http=createOperationHttpTransport([httpBinding],engine);
    const httpRequest=new Request('https://access-operations.example.invalid/api/admin/access/policy',
      {headers:{authorization:`Bearer ${oauth.token}`}});
    const httpResponse=await http.dispatch(httpRequest,{profile:'sites',bindings:{DB:db}},
      {CREEZIO_APP_ORIGIN:'https://access-operations.example.invalid'},'oauth-http-read');
    assert.equal(httpResponse.status,200,await httpResponse.clone().text());
    assert.equal((await httpResponse.json()).execution.state,'succeeded');
    const deltaBinding=compileHttpBindings({composition,modules:[manifest],operationCatalog:compiled.catalog})
      .find(item=>item.id==='policy.apply-delta' && item.audience==='admin');
    assert.ok(deltaBinding);
    const deltaHttp=createOperationHttpTransport([deltaBinding],engine);
    const deltaRequest=new Request('https://access-operations.example.invalid/api/admin/access/policy/delta',{
      method:'POST',headers:{authorization:`Bearer ${oauth.token}`,'content-type':'application/json',
        'x-creezio-request':'1'},body:JSON.stringify({requestKey:'oauth-http-admit-t33-context-b',
        expectedEpoch:delegatedRead.execution.output.epoch,
        changes:[{kind:'context-admit',contextId:'t33-context-b',status:'disabled'}]})});
    const deltaResponse=await deltaHttp.dispatch(deltaRequest,{profile:'sites',bindings:{DB:db}},
      {CREEZIO_APP_ORIGIN:'https://access-operations.example.invalid'},'oauth-http-admit');
    assert.equal(deltaResponse.status,200,await deltaResponse.clone().text());
    assert.equal((await deltaResponse.json()).execution.state,'succeeded');
    await assert.rejects(engine.invoke({credential:{kind:'oauth',token:oauth.token,
      resource:'https://access-operations.example.invalid/mcp/app'},moduleId,operationId:'policy.read',
      contextId:'application',audience:'admin',input:{}}),{code:'unauthorized'});
    await assert.rejects(engine.invoke({credential:{kind:'api-token',token:oauth.token},moduleId,
      operationId:'policy.read',contextId:'application',audience:'admin',input:{}}),{code:'forbidden'});
    assert.equal((await delegated('permissions.list',{limit:50})).execution.state,'succeeded');
    assert.equal((await delegated('principals.list',{limit:50,kind:'all'})).execution.state,'succeeded');
    assert.equal((await delegated('sessions.list',{principalId:target.principalId,limit:50})).execution.state,'succeeded');
    assert.equal((await delegated('audit.list',{limit:50})).execution.state,'succeeded');
    assert.equal((await delegated('audit.detail',{auditId,limit:32})).execution.state,'succeeded');
    const lockout=await delegated('policy.apply-delta',{requestKey:'oauth-self-lockout',
      expectedEpoch:delegatedRead.execution.output.epoch+1,
      changes:[{kind:'principal-override',principalId:owner.principalId,contextId:'application',audience:'admin',
        permissionId:'creezio.access:manage',effect:'deny'}]});
    assert.equal(lockout.execution.state,'failed');
    assert.equal(lockout.execution.errorCode,'forbidden');
    const changed=await delegated('policy.apply-delta',{requestKey:'oauth-policy-1',
      expectedEpoch:delegatedRead.execution.output.epoch+1,
      changes:[{kind:'role-override',roleId:'administrator',permissionId:'creezio.access:impersonate',effect:'deny'}]});
    assert.equal(changed.execution.state,'succeeded',JSON.stringify(changed.execution));
    const oauthAudit=await db.prepare(`SELECT session_id AS sessionId,principal_id AS principalId,
      credential_id AS credentialId,context_id AS contextId,audience
      FROM ${quote(ACCESS_TABLES.access_audit)} WHERE id=?`).bind(changed.execution.output.auditId).first();
    assert.equal(oauthAudit.sessionId,null);
    assert.equal(oauthAudit.principalId,owner.principalId);
    assert.equal(oauthAudit.credentialId,tokenId);
    assert.equal(oauthAudit.contextId,'application');
    assert.equal(oauthAudit.audience,'admin');
    assert.equal((await delegated('sessions.revoke',{sessionId:targetSession.session.id,requestKey:'oauth-revoke-session'}))
      .execution.state,'succeeded');
    const targetVersion=await db.prepare(`SELECT auth_version AS authVersion FROM ${quote(ACCESS_TABLES.principals)} WHERE id=?`)
      .bind(target.principalId).first();
    assert.equal((await delegated('principals.set-human-status',{principalId:target.principalId,
      expectedAuthVersion:targetVersion.authVersion,status:'disabled',requestKey:'oauth-disable-target'}))
      .execution.state,'succeeded');
    const ownerVersion=await db.prepare(`SELECT auth_version AS authVersion FROM ${quote(ACCESS_TABLES.principals)} WHERE id=?`)
      .bind(owner.principalId).first();
    assert.equal((await delegated('principals.revoke-sessions',{principalId:owner.principalId,
      expectedAuthVersion:ownerVersion.authVersion,requestKey:'oauth-self-revoke'})).execution.state,'succeeded');
    const auditRows=(await db.prepare(`SELECT action,session_id AS sessionId,credential_id AS credentialId,
      context_id AS contextId,audience FROM ${quote(ACCESS_TABLES.access_audit)} WHERE credential_id=? ORDER BY action`)
      .bind(tokenId).all()).results;
    assert.deepEqual(auditRows.map(row=>row.action),['api-token-revoked','authorization-updated',
      'authorization-updated','human-session-revoked','human-sessions-revoked','human-status-updated',
      'service-created','service-status-updated']);
    for(const row of auditRows){
      assert.equal(row.sessionId,null);
      assert.equal(row.credentialId,tokenId);
      assert.equal(row.contextId,'application');
      assert.equal(row.audience,'admin');
      assert.ok(!JSON.stringify(row).includes(oauth.token));
      assert.ok(!JSON.stringify(row).includes(oauth.digest));
    }
    await assert.rejects(delegated('policy.read',{}),{code:'unauthorized'});
  } finally {await runtime.dispose();}
});
