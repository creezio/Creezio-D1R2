import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {loadAccessInstallPlan} from '../../scripts/data/install-access.mjs';
import {createAccountService, provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createD1AuthorizationStore} from '../../core/authorization/d1-store.ts';
import {createDataAuthorization, freshDataGuard} from '../../core/data/authorization.ts';
import {createMcpAuthentication} from '../../core/mcp/authentication.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';

const READ='example.records:read', WRITE='example.records:write';
const permissions=[READ,WRITE].map(id=>({id,audiences:['admin','app'],actors:['user','delegated-user']}));
const target=(changes={})=>({contextId:'application',audience:'app',actors:['delegated-user'],requiredPermissionIds:[READ],purpose:'operation',...changes});
const q=id=>`"${ACCESS_TABLES[id]}"`;
const good=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};

test('OAuth data authority keeps grant, resource and current ACL constraints through the D1 batch', {timeout:60000},async t=>{
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',d1Databases:{DB:'oauth-authority'},d1Persist:false});
  try {
    const db=await runtime.getD1Database('DB');
    await db.batch(loadAccessInstallPlan().statements.map(sql=>db.prepare(sql)));
    await db.prepare('CREATE TABLE qualification_effects (id TEXT PRIMARY KEY)').run();
    const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
    const loginIdentifier='oauth-authority@example.invalid',password='Synthetic OAuth authority qualification';
    const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier,password,displayName:'OAuth qualification'}));
    const signed=good(await accounts.login({loginIdentifier,password,audience:'admin'}));
    const acl=createAuthorizationService(db,{permissions}),current=good(await acl.readPolicy(signed.token)),policy=structuredClone(current.policy);
    policy.roles.push({id:'record-editor',inherits:[],permissionIds:[READ,WRITE],permissionOverrides:[]});
    policy.memberships.push({principalId:owner.principalId,contextId:'application',audience:'app',status:'active'});
    policy.assignments.push({principalId:owner.principalId,contextId:'application',audience:'app',roleId:'record-editor'});
    good(await acl.replacePolicy(signed.token,{expectedEpoch:current.epoch,policy}));
    const resource='https://app.example.invalid/mcp/app',now=Date.now();
    const issued=await issueOpaqueToken('oauth-access');
    await db.prepare(`INSERT INTO ${q('oauth_clients')}
      (id,display_name,redirect_uris_json,token_endpoint_auth_method,scope_allowlist_json,registration_kind,created_at_ms,revoked_at_ms)
      VALUES ('client-1','Qualification','["https://client.example.invalid/callback"]','none',?,'predefined',?,NULL)`)
      .bind(JSON.stringify([READ,WRITE]),now).run();
    await db.prepare(`INSERT INTO ${q('oauth_grants')}
      (id,principal_id,client_id,resource,audience,context_id,scopes_json,permission_ids_json,auth_version,account_version,credential_version,created_at_ms,revoked_at_ms)
      SELECT 'grant-1',p.id,'client-1',?,'app','application',?,?,p.auth_version,h.version,pc.version,?,NULL
      FROM ${q('principals')} p JOIN ${q('human_accounts')} h ON h.principal_id=p.id
      JOIN ${q('password_credentials')} pc ON pc.principal_id=p.id WHERE p.id=?`)
      .bind(resource,JSON.stringify([READ]),JSON.stringify([READ]),now,owner.principalId).run();
    await db.prepare(`INSERT INTO ${q('oauth_access_tokens')}
      (id,secret_hash,grant_id,created_at_ms,expires_at_ms,revoked_at_ms) VALUES ('token-1',?,'grant-1',?,?,NULL)`)
      .bind(issued.digest,now,now+600000).run();
    const credential={kind:'oauth',token:issued.token,resource};
    const authorization=createDataAuthorization(db,permissions),store=createD1AuthorizationStore(db);
    const commit=async(state,id)=>{
      const guard=freshDataGuard(state);
      return db.batch([db.prepare(guard.sql).bind(...guard.bindings),db.prepare('INSERT INTO qualification_effects(id) VALUES (?)').bind(id)]);
    };
    await t.test('native actor, exact resource and consent ceiling are preserved',async()=>{
      const state=await authorization.resolve(credential,target());
      assert.equal(state.snapshot.credential.kind,'oauth');assert.equal(state.snapshot.actor.id,owner.principalId);
      assert.deepEqual(state.snapshot.credential.permissionIds,[READ]);assert.equal(state.oauth.grantId,'grant-1');
      await commit(state,'accepted');
      assert.equal(await db.prepare('SELECT count(*) n FROM qualification_effects').first('n'),1);
      assert.equal((await store.readOAuthAccess(issued.digest,null,'app',resource)).credential.contextId,'application');
      for(const [candidate,to] of [
        [{...credential,resource:'https://other.example.invalid/mcp/app'},target()],
        [credential,target({audience:'admin'})], [credential,target({contextId:'other'})],
        [credential,target({actors:['user']})], [credential,target({requiredPermissionIds:[WRITE]})],
        [{kind:'session',token:issued.token},target()], [{kind:'api-token',token:issued.token},target()],
      ]) await assert.rejects(()=>authorization.resolve(candidate,to));
    });
    await t.test('every mutable authority change invalidates a previously resolved write',async()=>{
      const changes=[
        ['oauth_access_tokens','revoked_at_ms','id','token-1',now,null],
        ['oauth_access_tokens','expires_at_ms','id','token-1',1,now+600000],
        ['oauth_grants','revoked_at_ms','id','grant-1',now,null],
        ['oauth_clients','revoked_at_ms','id','client-1',now,null],
        ['oauth_grants','permission_ids_json','id','grant-1','[]',JSON.stringify([READ])],
        ['principals','auth_version','id',owner.principalId,2,1],
        ['human_accounts','version','principal_id',owner.principalId,2,1],
        ['password_credentials','version','principal_id',owner.principalId,2,1],
        ['authorization_state','epoch','id','application',3,2],
      ];
      for(const [table,field,key,id,changed,restored] of changes){
        const state=await authorization.resolve(credential,target());
        const update=value=>db.prepare(`UPDATE ${q(table)} SET ${field}=? WHERE ${key}=?`).bind(value,id).run();
        await update(changed);
        await assert.rejects(()=>commit(state,`rejected-${table}-${field}`));
        assert.equal(await db.prepare('SELECT count(*) n FROM qualification_effects').first('n'),1);
        await update(restored); // Isolated synthetic fixture; not a product recovery operation.
      }
    });
    await t.test('MCP ignores cookies, resolves the grant context and checks actors and current permissions',async()=>{
      const mcp=createMcpAuthentication(db,permissions);
      assert.equal(await mcp.authenticate(new Request(resource,{headers:{cookie:`creezio-local-app=${signed.token}`}}),'app',resource),null);
      assert.equal(await mcp.authenticate(new Request(resource,{headers:{authorization:`Bearer ${signed.token}`}}),'app',resource),null);
      const identity=await mcp.authenticate(new Request(resource,{headers:{authorization:`Bearer ${issued.token}`,
        'x-creezio-context':'forged-context'}}),'app',resource);
      assert.equal(identity.contextId,'application');
      assert.equal(await mcp.canDiscover(identity,{audience:'app',contextId:'application',actors:['delegated-user'],permissionIds:[READ]}),true);
      assert.equal(await mcp.canDiscover(identity,{audience:'app',contextId:'application',actors:['user'],permissionIds:[READ]}),false);
      assert.equal(await mcp.canDiscover(identity,{audience:'app',contextId:'application',actors:['delegated-user'],permissionIds:[WRITE]}),false);
      const next=good(await acl.readPolicy(signed.token)),changed=structuredClone(next.policy);
      changed.roles.find(r=>r.id==='record-editor').permissionIds=[];
      good(await acl.replacePolicy(signed.token,{expectedEpoch:next.epoch,policy:changed}));
      assert.equal(await mcp.canDiscover(identity,{audience:'app',contextId:'application',actors:['delegated-user'],permissionIds:[READ]}),false);
    });
  } finally {await runtime.dispose();}
});
