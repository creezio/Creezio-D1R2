import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createAccountService, provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createOAuthService} from '../../core/oauth/service.ts';
import {createD1OAuthStore} from '../../core/oauth/store.ts';
import {dispatchOAuthHttp} from '../../core/oauth/http.ts';
import {oauthResource} from '../../core/oauth/protocol.ts';

const root = fileURLToPath(new URL('../../',import.meta.url));
const models = JSON.parse(readFileSync(join(root,'extensions/native/access/module/models.json'),'utf8'));
const issuer = 'http://localhost:8787';
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

test('native D1 OAuth code, consent, refresh and revocation stay bound to app identity',
  {timeout:60_000}, async () => {
    const schema = generateD1Schema('creezio.access',models);
    const mf = new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      script:'export default { fetch() { return new Response("ok") } }',
      compatibilityDate:'2026-05-15',d1Databases:{DB:'oauth-test'},d1Persist:false});
    try {
      await mf.ready;
      const db = await mf.getD1Database('DB');
      await db.batch(schema.statements.map(statement => db.prepare(statement)));
      const accounts = createAccountService(db);
      const bootstrap = await provisionBootstrapCapability(db);
      assert.ok(bootstrap);
      const account = await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'oauth-owner@example.invalid',
        displayName:'OAuth owner',password:'Synthetic OAuth qualification password'});
      assert.equal(account.ok,true);
      const login = await accounts.login({loginIdentifier:'oauth-owner@example.invalid',
        password:'Synthetic OAuth qualification password',audience:'admin'});
      assert.equal(login.ok,true);
      const service = createOAuthService(db,{issuer,permissions:[]});
      assert.equal(await service.registerPredefined({id:'chatgpt',displayName:'ChatGPT',
        redirectUris:[redirect],scopeAllowlist:[]}),true);
      const resource = oauthResource(issuer,'admin');
      const authorize = new URLSearchParams({client_id:'chatgpt',redirect_uri:redirect,
        response_type:'code',code_challenge:challenge,code_challenge_method:'S256',
        state:'opaque-state',resource});
      const transaction = await service.authorize(authorize);
      assert.equal(transaction.audience,'admin');
      const preview = await service.preview(transaction.transactionId,login.token);
      assert.equal(preview.principal.id,account.principalId);
      assert.equal(preview.resource,resource);
      assert.deepEqual(preview.permissions,[]);
      await assert.rejects(service.decide({requestId:transaction.transactionId,
        sessionToken:login.token,csrfToken:'invalid',decision:'approve',permissionIds:[]}),/invalid_request/);
      const approval = await service.decide({requestId:transaction.transactionId,
        sessionToken:login.token,csrfToken:preview.csrfToken,decision:'approve',permissionIds:[]});
      const callback = new URL(approval.redirectUri);
      assert.equal(callback.searchParams.get('state'),'opaque-state');
      assert.equal(callback.searchParams.get('iss'),issuer);
      const code = callback.searchParams.get('code');
      assert.ok(code);
      await assert.rejects(service.exchangeCode({clientId:'chatgpt',code,redirectUri:redirect,
        resource:oauthResource(issuer,'app'),codeVerifier:verifier}),/invalid_grant/);
      const tokens = await service.exchangeCode({clientId:'chatgpt',code,redirectUri:redirect,
        resource,codeVerifier:verifier});
      assert.equal(tokens.token_type,'Bearer');
      assert.equal(tokens.scope,'');
      assert.equal((await service.verifyAccess(tokens.access_token,resource)).principalId,account.principalId);
      assert.equal(await service.verifyAccess(tokens.access_token,oauthResource(issuer,'app')),null);
      await assert.rejects(service.exchangeCode({clientId:'chatgpt',code,redirectUri:redirect,
        resource,codeVerifier:verifier}),/invalid_grant/);
      const rotated = await service.refresh({clientId:'chatgpt',refreshToken:tokens.refresh_token,resource});
      assert.notEqual(rotated.refresh_token,tokens.refresh_token);
      await assert.rejects(service.refresh({clientId:'chatgpt',refreshToken:tokens.refresh_token,resource}),
        /invalid_grant/);
      assert.equal(await service.verifyAccess(rotated.access_token,resource),null);
      const denied = await service.authorize(authorize);
      const deniedPreview = await service.preview(denied.transactionId,login.token);
      const refusal = await service.decide({requestId:denied.transactionId,sessionToken:login.token,
        csrfToken:deniedPreview.csrfToken,decision:'deny',permissionIds:[]});
      assert.equal(new URL(refusal.redirectUri).searchParams.get('error'),'access_denied');
      await assert.rejects(service.preview(denied.transactionId,login.token),/not_found/);

      const runtime = {profile:'local',bindings:{DB:db}};
      const environment = {CREEZIO_APP_ORIGIN:issuer};
      const nativeAccess = {admin:true,app:false};
      const dispatch = (request,path) => dispatchOAuthHttp(request,runtime,environment,[],
        'oauth-test-request',path,nativeAccess);
      const metadata = await dispatch(new Request(`${issuer}/.well-known/oauth-protected-resource/mcp/admin`),
        '/.well-known/oauth-protected-resource/mcp/admin');
      assert.equal(metadata.status,200);
      assert.equal((await metadata.json()).resource,resource);
      const hidden = await dispatch(new Request(`${issuer}/.well-known/oauth-protected-resource/mcp/app`),
        '/.well-known/oauth-protected-resource/mcp/app');
      assert.equal(hidden.status,404);
      const browserAuth = await dispatch(new Request(`${issuer}/oauth/authorize?${authorize}`),'/oauth/authorize');
      assert.equal(browserAuth.status,303);
      const consentPath = new URL(browserAuth.headers.get('location')).pathname;
      const previewPath = `${consentPath}/preview`;
      const anonymous = await dispatch(new Request(`${issuer}${previewPath}`),previewPath);
      assert.equal(anonymous.status,401);
      assert.equal((await anonymous.json()).audience,'admin');
      const cookie = `creezio-local-admin=${login.token}`;
      const visible = await dispatch(new Request(`${issuer}${previewPath}`,{headers:{cookie}}),previewPath);
      assert.equal(visible.status,200);
      const consentView = await visible.json();
      const deniedForm = new URLSearchParams({decision:'deny',csrfToken:consentView.csrfToken});
      const decided = await dispatch(new Request(`${issuer}${consentPath}`,{method:'POST',
        headers:{cookie,origin:issuer,'content-type':'application/x-www-form-urlencoded'},
        body:deniedForm}),consentPath);
      assert.equal(decided.status,303);
      assert.equal(new URL(decided.headers.get('location')).searchParams.get('error'),'access_denied');

      assert.equal(await service.registerPredefined({id:'chatgpt-admin',displayName:'ChatGPT Admin',
        redirectUris:[redirect],scopeAllowlist:['creezio.access:manage']}),true);
      const adminParams = new URLSearchParams({...Object.fromEntries(authorize),
        client_id:'chatgpt-admin',scope:'creezio.access:manage'});
      const adminTx = await service.authorize(adminParams);
      const adminPreview = await service.preview(adminTx.transactionId,login.token);
      assert.deepEqual(adminPreview.permissions.map(item=>item.id),['creezio.access:manage']);
      await assert.rejects(service.decide({requestId:adminTx.transactionId,sessionToken:login.token,
        csrfToken:adminPreview.csrfToken,decision:'approve',
        permissionIds:['creezio.access:impersonate']}),/invalid_scope/);
      const adminApproval = await service.decide({requestId:adminTx.transactionId,sessionToken:login.token,
        csrfToken:adminPreview.csrfToken,decision:'approve',permissionIds:['creezio.access:manage']});
      const adminCode = new URL(adminApproval.redirectUri).searchParams.get('code');
      const adminTokens = await service.exchangeCode({clientId:'chatgpt-admin',code:adminCode,
        redirectUri:redirect,resource,codeVerifier:verifier});
      assert.equal(adminTokens.scope,'creezio.access:manage');
      assert.deepEqual((await service.verifyAccess(adminTokens.access_token,resource)).permissionIds,
        ['creezio.access:manage']);
      await service.revokeToken('chatgpt-admin',adminTokens.access_token);
      assert.equal(await service.verifyAccess(adminTokens.access_token,resource),null);

      const table = `"${schema.tables.oauth_requests}"`;
      await db.prepare(`UPDATE ${table} SET expires_at_ms=0 WHERE id=?`).bind(denied.transactionId).run();
      await service.authorize(authorize);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id=?`)
        .bind(denied.transactionId).first()).n,0);
      let full = false;
      for (let attempt=0;attempt<40;attempt++) {
        try { await service.authorize(authorize); }
        catch (failure) {
          assert.match(String(failure),/rate_limited/);
          full = true; break;
        }
      }
      assert.equal(full,true);
      const countAtLimit = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
      await assert.rejects(service.authorize(authorize),/rate_limited/);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,countAtLimit);

      const store = createD1OAuthStore(db);
      const live = async () => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}
        WHERE client_id='chatgpt' AND consumed_at_ms IS NULL AND expires_at_ms >
        (CAST(unixepoch('now') AS INTEGER)*1000)`).first()).n;
      const makeRequest = () => store.createRequest({id:crypto.randomUUID(),clientId:'chatgpt',
        redirectUri:redirect,resource,audience:'admin',contextId:'application',scopes:[],state:'s',
        codeChallenge:challenge,principalId:null,sessionId:null,csrfDigest:null,
        expiresAtMs:Date.now()+600_000});
      const remaining = 95 - await live();
      assert.ok(remaining > 0);
      for (let i=0;i<remaining;i++) assert.equal(await makeRequest(),true);
      assert.equal(await live(),95);
      const raced = await Promise.all(Array.from({length:20},makeRequest));
      assert.equal(raced.filter(Boolean).length,5);
      assert.equal(await live(),100);
      assert.equal(await makeRequest(),false);
    } finally { await mf.dispose(); }
  });
