import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {generateD1Schema,describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createOAuthService} from '../../core/oauth/service.ts';
import {oauthResource} from '../../core/oauth/protocol.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {createStorageMutationPort} from '../../core/storage-authority/native-mutation.ts';

const access=generateD1Schema('creezio.access',JSON.parse(readFileSync(
  new URL('../../extensions/native/access/module/models.json',import.meta.url),'utf8')));
const authority=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
const routeTable=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
const issuer='http://localhost:8787';
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const verifier='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge='E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

test('routed OAuth grant and token revocations wait for two target fences and exact source receipts',
  {timeout:60000},async()=>{
  const mf=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{DB:'t33-oauth-source',A:'t33-oauth-a',B:'t33-oauth-b'},
    d1Persist:false,telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  try{
    const source=await mf.getD1Database('DB'),a=await mf.getD1Database('A'),b=await mf.getD1Database('B');
    await source.batch([...access.statements,...authority.statements].map(sql=>source.prepare(sql)));
    const accounts=createAccountService(source),bootstrap=await provisionBootstrapCapability(source);
    const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'oauth-t33@example.invalid',
      displayName:'OAuth T33',password:'Synthetic OAuth T33 password'});
    assert.equal(owner.ok,true);
    const login=await accounts.login({loginIdentifier:'oauth-t33@example.invalid',
      password:'Synthetic OAuth T33 password',audience:'admin'});
    assert.equal(login.ok,true);
    const epoch=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
      WHERE id='application'`).first()).epoch;
    const identities=[{installationId:'t33-oauth',contextId:'tenant-a',slot:1},
      {installationId:'t33-oauth',contextId:'tenant-b',slot:2}];
    for(const [db,identity] of [[a,identities[0]],[b,identities[1]]]){
      await db.batch(authority.statements.map(sql=>db.prepare(sql)));
      await db.prepare(`INSERT INTO ${routeTable}
        (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
        VALUES (?,?,?,1,'active',NULL,?,0)`)
        .bind(identity.contextId,identity.installationId,identity.slot,epoch).run();
    }
    const healthyPort=createStorageMutationPort(source,[{identity:identities[0],db:a},
      {identity:identities[1],db:b}]);
    const blockedPort=createStorageMutationPort(source,[{identity:identities[0],db:a},
      {identity:identities[1],db:{prepare(sql){return b.prepare(sql);},batch(){throw new Error('target unavailable');}}}]);
    const base={issuer,permissions:[]};
    const healthy=createOAuthService(source,{...base,storageMutation:healthyPort});
    const blocked=createOAuthService(source,{...base,storageMutation:blockedPort});
    assert.equal(await healthy.registerPredefined({id:'chatgpt',displayName:'ChatGPT',
      redirectUris:[redirect],scopeAllowlist:[]}),true);
    const resource=oauthResource(issuer,'admin');
    async function issue(){
      const transaction=await healthy.authorize(new URLSearchParams({client_id:'chatgpt',redirect_uri:redirect,
        response_type:'code',code_challenge:challenge,code_challenge_method:'S256',
        state:'opaque-state',resource}));
      const preview=await healthy.preview(transaction.transactionId,login.token);
      const approval=await healthy.decide({requestId:transaction.transactionId,sessionToken:login.token,
        csrfToken:preview.csrfToken,decision:'approve',permissionIds:[]});
      const code=new URL(approval.redirectUri).searchParams.get('code');
      return healthy.exchangeCode({clientId:'chatgpt',code,redirectUri:redirect,resource,codeVerifier:verifier});
    }
    const first=await issue();
    assert.ok(await healthy.verifyAccess(first.access_token,resource));
    await assert.rejects(blocked.revokeToken('chatgpt',first.access_token),/temporarily_unavailable/);
    assert.ok(await healthy.verifyAccess(first.access_token,resource));
    assert.equal((await a.prepare(`SELECT state FROM ${routeTable}`).first()).state,'deny');
    assert.equal((await b.prepare(`SELECT state FROM ${routeTable}`).first()).state,'active');
    await healthy.revokeToken('chatgpt',first.access_token);
    assert.equal(await healthy.verifyAccess(first.access_token,resource),null);
    const second=await issue();
    const grant=(await healthy.verifyAccess(second.access_token,resource)).grantId;
    assert.equal(await healthy.revokeGrant(grant,owner.principalId),true);
    assert.equal(await healthy.verifyAccess(second.access_token,resource),null);
    const third=await issue();
    const rotated=await healthy.refresh({clientId:'chatgpt',refreshToken:third.refresh_token,resource});
    const delayed=createOAuthService(source,{...base,storageMutation:createStorageMutationPort(source,
      [{identity:identities[0],db:a},{identity:identities[1],db:{prepare(sql){
        if(sql.includes("SET state='active'"))throw new Error('target ACK unavailable');
        return b.prepare(sql);
      },batch(statements){return b.batch(statements)}}}])});
    await assert.rejects(delayed.refresh({clientId:'chatgpt',refreshToken:third.refresh_token,resource}),
      /temporarily_unavailable/);
    assert.equal((await b.prepare(`SELECT state FROM ${routeTable}`).first()).state,'deny');
    await assert.rejects(healthy.refresh({clientId:'chatgpt',refreshToken:third.refresh_token,resource}),
      /invalid_grant/);
    assert.equal(await healthy.verifyAccess(rotated.access_token,resource),null);
    for(const db of [a,b]){
      const route=await db.prepare(`SELECT state,generation FROM ${routeTable}`).first();
      assert.equal(route.state,'active');assert.equal(route.generation,4);
    }
    assert.equal((await source.prepare(`SELECT COUNT(*) AS count FROM
      "${STORAGE_AUTHORITY_TABLES.storage_source_receipts}" WHERE effect='revoked'`).first()).count,3);
  }finally{await mf.dispose();}
});
