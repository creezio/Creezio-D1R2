/** Synthetic OAuth client for the real built Worker. Never opens product data or logs credentials. */
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';

export async function startOAuthBrowserClient(origin) {
  const pending=new Map();
  let clientId,redirectUri;
  const resource=`${origin}/mcp/admin`;
  const post=async(path,form)=>fetch(`${origin}${path}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form)});
  const server=createServer(async(request,response)=>{
    response.setHeader('content-type','text/plain; charset=utf-8');
    response.setHeader('cache-control','no-store');response.setHeader('referrer-policy','no-referrer');
    try {
      const url=new URL(request.url,redirectUri);
      if(request.method!=='GET'||url.pathname!=='/callback'){response.writeHead(404);response.end('Introuvable');return;}
      const state=url.searchParams.get('state'),flow=pending.get(state);pending.delete(state);
      assert.ok(flow,'Unknown callback transaction');assert.equal(url.searchParams.get('iss'),origin);
      if(url.searchParams.get('error')){
        assert.equal(url.searchParams.get('error'),'access_denied');
        console.log(JSON.stringify({oauthBrowser:{denied:true,tokenRequested:false}}));
        response.end('Accès refusé. Aucun jeton demandé.');return;
      }
      const code=url.searchParams.get('code');assert.ok(code);
      const exchanged=await post('/oauth/token',{grant_type:'authorization_code',client_id:clientId,
        redirect_uri:redirectUri,resource,code,code_verifier:flow.verifier});
      assert.equal(exchanged.status,200);const pair=await exchanged.json();
      const client=new Client({name:'Creezio browser qualification',version:'1.0.0'},
        {versionNegotiation:{mode:{pin:'2026-07-28'}}});
      const wire=new StreamableHTTPClientTransport(new URL(resource),{authProvider:{token:async()=>pair.access_token}});
      let tools,epochAfter,executionId;
      try {
        await client.connect(wire);tools=(await client.listTools()).tools.map(tool=>tool.name);
        if(flow.scope){
          assert.equal(tools.length,10);
          const read=await client.callTool({name:'access_policy_read',arguments:{}});assert.ok(!read.isError);
          const input={requestKey:crypto.randomUUID(),expectedEpoch:read.structuredContent.epoch,
            changes:[{kind:'role-override',roleId:'administrator',permissionId:'creezio.access:impersonate',effect:'deny'}]};
          const first=await client.callTool({name:'access_policy_apply_delta',arguments:input});assert.ok(!first.isError);
          const repeated=await client.callTool({name:'access_policy_apply_delta',arguments:input});assert.ok(!repeated.isError);
          const envelope=JSON.parse(first.content.find(item=>item.type==='text').text);
          const replay=JSON.parse(repeated.content.find(item=>item.type==='text').text);
          executionId=envelope.executionId;assert.equal(replay.executionId,executionId);assert.equal(replay.replayed,true);
          epochAfter=(await client.callTool({name:'access_policy_read',arguments:{}})).structuredContent.epoch;
          assert.equal(epochAfter,input.expectedEpoch+1);
        } else assert.equal(tools.length,0);
      } finally {await client.close();}
      const wrongAudience=await fetch(`${origin}/mcp/app`,{method:'POST',headers:{authorization:`Bearer ${pair.access_token}`}});
      assert.equal(wrongAudience.status,401);
      const revoked=await post('/oauth/revoke',{client_id:clientId,token:pair.access_token});assert.equal(revoked.status,200);
      const refused=await fetch(resource,{method:'POST',headers:{authorization:`Bearer ${pair.access_token}`}});assert.equal(refused.status,401);
      const replay=await post('/oauth/token',{grant_type:'authorization_code',client_id:clientId,
        redirect_uri:redirectUri,resource,code,code_verifier:flow.verifier});assert.equal(replay.status,400);
      console.log(JSON.stringify({oauthBrowser:{approved:true,scope:flow.scope,tokenHTTP:exchanged.status,
        tools,epochAfter,executionId,idempotencyVerified:Boolean(flow.scope),wrongAudience:wrongAudience.status,
        revokedHTTP:revoked.status,afterRevocation:refused.status,codeReplay:replay.status}}));
      response.end('Recette réussie : consentement Creezio, client MCP, droits et révocation vérifiés.');
    } catch(error){console.error(JSON.stringify({oauthBrowser:{failed:true,name:error.name,message:error.message}}));
      response.writeHead(500);response.end('Échec de la recette. Consulter le rapport local sans credentials.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  redirectUri=`http://127.0.0.1:${server.address().port}/callback`;
  try {
    const registered=await fetch(`${origin}/oauth/register`,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({client_name:'Client de recette Creezio',redirect_uris:[redirectUri],token_endpoint_auth_method:'none',
        grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'creezio.access:manage'})});
    assert.equal(registered.status,201);clientId=(await registered.json()).client_id;assert.ok(clientId);
  } catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
  return {begin(scope='creezio.access:manage'){
    const verifier=randomBytes(32).toString('base64url'),state=randomBytes(24).toString('base64url');
    pending.set(state,{verifier,scope});
    const params=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,resource,response_type:'code',
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',scope,state});
    return `${origin}/oauth/authorize?${params}`;
  },async close(){pending.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
