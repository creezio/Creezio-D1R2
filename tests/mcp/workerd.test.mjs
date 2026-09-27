import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {measureRuntimeArtifacts} from '../../scripts/quality/runtime.mjs';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';

test('built Worker completes native OAuth then real MCP discovery, call and revocation in workerd', {timeout:60000},async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),artifact=measureRuntimeArtifacts(root);
  let origin='https://mcp-qualification.example.invalid';
  const options={host:'127.0.0.1',port:0,cf:false,d1Persist:false,r2Persist:false,
    modules:[{type:'ESModule',path:join(root,'dist/server/index.js')},
      ...artifact.files.filter(file=>file.gzipBytes!==undefined&&file.path!=='dist/server/index.js')
        .map(file=>({type:'ESModule',path:join(root,file.path)}))],
    modulesRoot:join(root,'dist/server'),compatibilityDate:'2026-05-15',
    compatibilityFlags:['nodejs_compat'],bindings:{CREEZIO_RUNTIME_PROFILE:'local',CREEZIO_APP_ORIGIN:origin},
    d1Databases:{DB:'mcp-built-qualification'},r2Buckets:{BUCKET:'mcp-built-qualification'},
    assets:{directory:join(root,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true},
      assetConfig:{html_handling:'none',not_found_handling:'none'}}};
  const runtime=new Miniflare(options);
  let client;
  const send=(url,init={})=>fetch(url,{redirect:'manual',...init});
  const request=(path,init={})=>send(`${origin}${path}`,init);
  try {
    // Exercise actual HTTP so URL, Host and the canonical local deployment origin agree.
    origin=(await runtime.ready).origin;
    await runtime.setOptions({...options,port:Number(new URL(origin).port),
      bindings:{CREEZIO_RUNTIME_PROFILE:'local',CREEZIO_APP_ORIGIN:origin}});
    const resource=`${origin}/mcp/admin`;
    const db=await runtime.getD1Database('DB'),plan=await loadCompositionSchema({root});
    await db.batch(plan.statements.map(sql=>db.prepare(sql)));
    const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
    const loginIdentifier='mcp-workerd@example.invalid',password='Synthetic MCP workerd qualification';
    assert.equal((await accounts.bootstrap({token:bootstrap.token,loginIdentifier,password,displayName:'MCP test'})).ok,true);
    const signed=await accounts.login({loginIdentifier,password,audience:'admin'});assert.equal(signed.ok,true);
    const redirectUri='https://client.example.invalid/callback',verifier=randomBytes(32).toString('base64url');
    const dcr=await request('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({client_name:'Workerd qualification',redirect_uris:[redirectUri],scope:'creezio.access:manage'})});
    assert.equal(dcr.status,201);const clientId=(await dcr.json()).client_id;
    const params=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,resource,response_type:'code',
      scope:'creezio.access:manage',state:'workerd-state',code_challenge_method:'S256',
      code_challenge:createHash('sha256').update(verifier).digest('base64url')});
    const authorize=await request(`/oauth/authorize?${params}`);assert.equal(authorize.status,303);
    const consent=new URL(authorize.headers.get('location')).pathname;
    const cookie=`creezio-local-admin=${signed.token}`;
    const previewResponse=await request(`${consent}/preview`,{headers:{cookie}});assert.equal(previewResponse.status,200);
    const preview=await previewResponse.json();assert.deepEqual(preview.permissions.map(p=>p.id),['creezio.access:manage']);
    const approved=await request(consent,{method:'POST',headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({csrfToken:preview.csrfToken,decision:'approve',permissionIds:'creezio.access:manage'}).toString()});
    assert.equal(approved.status,303);const callback=new URL(approved.headers.get('location'));
    assert.equal(callback.searchParams.get('iss'),origin);assert.equal(callback.searchParams.get('state'),'workerd-state');
    const tokenResponse=await request('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:redirectUri,
        resource,code:callback.searchParams.get('code'),code_verifier:verifier}).toString()});
    assert.equal(tokenResponse.status,200);const pair=await tokenResponse.json();
    client=new Client({name:'Built Worker qualification',version:'1.0.0'}, {versionNegotiation:{mode:{pin:'2026-07-28'}}});
    const wire=new StreamableHTTPClientTransport(new URL(resource),{authProvider:{token:async()=>pair.access_token},
      fetch:send});
    await client.connect(wire);
    const tools=(await client.listTools()).tools;assert.equal(tools.length,10);
    assert.ok(tools.every(tool=>tool._meta.securitySchemes[0].scopes.includes('creezio.access:manage')));
    const read=await client.callTool({name:'access_policy_read',arguments:{}});assert.equal(read.isError,undefined);
    assert.equal(read.structuredContent.epoch,1);
    const api=await request('/api/admin/access/policy',{headers:{authorization:`Bearer ${pair.access_token}`}});
    assert.equal(api.status,200,'same OAuth authority must work in declared HTTP operations');
    const revoke=await request('/oauth/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:clientId,token:pair.access_token}).toString()});assert.equal(revoke.status,200);
    const refused=await request('/mcp/admin',{method:'POST',headers:{authorization:`Bearer ${pair.access_token}`}});
    assert.equal(refused.status,401);assert.match(refused.headers.get('www-authenticate'),/oauth-protected-resource/);
  } finally {await client?.close();await runtime.dispose();}
});
