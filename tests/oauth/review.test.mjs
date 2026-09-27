import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createAccountService, provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createOAuthService} from '../../core/oauth/service.ts';
import {oauthResource} from '../../core/oauth/protocol.ts';

const root = fileURLToPath(new URL('../../',import.meta.url));
const models = JSON.parse(readFileSync(join(root,'extensions/native/access/module/models.json'),'utf8'));
const issuer = 'http://localhost:8787';
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

test('concurrent exchange consumes one code; refresh replay revokes the winning family',
  {timeout: 60_000}, async () => {
    const mf = new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      script:'export default { fetch() { return new Response("ok") } }',
      compatibilityDate:'2026-05-15',d1Databases:{DB:'oauth-review'},d1Persist:false});
    try {
      await mf.ready;
      const db = await mf.getD1Database('DB');
      const schema = generateD1Schema('creezio.access',models);
      await db.batch(schema.statements.map(statement => db.prepare(statement)));
      const accounts = createAccountService(db);
      const bootstrap = await provisionBootstrapCapability(db);
      assert.ok(bootstrap);
      const account = await accounts.bootstrap({token:bootstrap.token,
        loginIdentifier:'oauth-review@example.invalid',displayName:'Review account',
        password:'Synthetic OAuth review qualification password'});
      assert.equal(account.ok,true);
      const login = await accounts.login({loginIdentifier:'oauth-review@example.invalid',
        password:'Synthetic OAuth review qualification password',audience:'admin'});
      assert.equal(login.ok,true);
      const service = createOAuthService(db,{issuer,permissions:[]});
      assert.equal(await service.registerPredefined({id:'review-client',displayName:'Review client',
        redirectUris:[redirect],scopeAllowlist:[]}),true);
      const resource = oauthResource(issuer,'admin');
      const params = new URLSearchParams({client_id:'review-client',redirect_uri:redirect,
        response_type:'code',code_challenge:challenge,code_challenge_method:'S256',
        state:'review-state',resource});
      const transaction = await service.authorize(params);
      const preview = await service.preview(transaction.transactionId,login.token);
      const approval = await service.decide({requestId:transaction.transactionId,
        sessionToken:login.token,csrfToken:preview.csrfToken,
        decision:'approve',permissionIds:[]});
      const code = new URL(approval.redirectUri).searchParams.get('code');
      assert.ok(code);
      const exchange = () => service.exchangeCode({clientId:'review-client',code,
        redirectUri:redirect,resource,codeVerifier:verifier});
      const exchanged = await Promise.allSettled([exchange(),exchange()]);
      assert.deepEqual(exchanged.map(item=>item.status).sort(),['fulfilled','rejected']);
      const tokens = exchanged.find(item=>item.status==='fulfilled').value;
      assert.ok(await service.verifyAccess(tokens.access_token,resource));
      const renew = () => service.refresh({clientId:'review-client',
        refreshToken:tokens.refresh_token,resource});
      const renewed = await Promise.allSettled([renew(),renew()]);
      assert.deepEqual(renewed.map(item=>item.status).sort(),['fulfilled','rejected']);
      const winner = renewed.find(item=>item.status==='fulfilled').value;
      assert.equal(await service.verifyAccess(winner.access_token,resource),null);
      assert.equal(await service.verifyAccess(tokens.access_token,resource),null);
      // The original authorization counted toward the client window. The
      // 31st anonymous request must not create another persisted transaction.
      for (let i=0;i<29;i++) assert.ok((await service.authorize(params)).transactionId);
      await assert.rejects(service.authorize(params),/rate_limited/);
    } finally { await mf.dispose(); }
  });
