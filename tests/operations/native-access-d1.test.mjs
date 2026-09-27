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
import {hostOnly} from '../../extensions/native/access/module/operations.ts';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const quote = value => `"${value.replaceAll('"','""')}"`;
const moduleId = 'creezio.access';
const manifest = json('../../extensions/native/access/module/manifest.json');
const composition = json('../../configuration/composition.json');
const lock = json('../../configuration/composition.lock.json');
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
    const engine=createOperationEngine({db,registry,catalog:schema.runtimeCatalog,permissions:[]});
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
      expectedEpoch:delegatedRead.execution.output.epoch,
      changes:[{kind:'principal-override',principalId:owner.principalId,contextId:'application',audience:'admin',
        permissionId:'creezio.access:manage',effect:'deny'}]});
    assert.equal(lockout.execution.state,'failed');
    assert.equal(lockout.execution.errorCode,'forbidden');
    const changed=await delegated('policy.apply-delta',{requestKey:'oauth-policy-1',
      expectedEpoch:delegatedRead.execution.output.epoch,
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
    assert.deepEqual(auditRows.map(row=>row.action),['authorization-updated','human-session-revoked',
      'human-sessions-revoked','human-status-updated']);
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
