import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {dispatchDeliveryAuthorizationHttp} from '../../core/delivery/http.ts';

const models=JSON.parse(readFileSync(new URL('../../extensions/native/access/module/models.json',import.meta.url),'utf8'));
const schema=generateD1Schema('creezio.access',models);
const openaiModels=JSON.parse(readFileSync(new URL('../../extensions/native/openai/module/manifest.json',
  import.meta.url),'utf8')).contracts.models;
const openaiSchema=generateD1Schema('creezio.openai',openaiModels);
const permission={id:'creezio.delivery:manage',audiences:['admin'],actors:['user']};
const origin='http://127.0.0.1:5173',operatorOrigin='http://127.0.0.1:5177';
const raw={CREEZIO_APP_ORIGIN:origin,CREEZIO_LOCAL_DELIVERY_ORIGIN:operatorOrigin};
function request(token,overrides={}){
  const headers={origin,'x-creezio-request':'1','content-type':'application/json',
    cookie:`creezio-local-admin=${token}`,...overrides.headers};
  return new Request(`${origin}/api/delivery/admin/authorization`,{method:'POST',headers,
    body:overrides.body??'{}'});
}
function connectionsRequest(token){return new Request(`${origin}/api/delivery/admin/connections`,
  {headers:{origin,cookie:`creezio-local-admin=${token}`}});}

test('native delivery authorization requires local human ACL, admin cookie and same-origin CSRF',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'t32-operator-auth'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch(schema.statements.map(sql=>db.prepare(sql)));
      const capability=await provisionBootstrapCapability(db),accounts=createAccountService(db),
        password='Synthetic delivery authorization password';
      const owner=await accounts.bootstrap({token:capability.token,loginIdentifier:'delivery@example.invalid',
        displayName:'Delivery owner',password});
      assert.equal(owner.ok,true);
      const login=await accounts.login({loginIdentifier:'delivery@example.invalid',password,audience:'admin'});
      assert.equal(login.ok,true);
      const environment={profile:'local',bindings:{DB:db}};
      let response=await dispatchDeliveryAuthorizationHttp(request(login.token),environment,raw,'request-one',[permission]);
      assert.equal(response.status,403);
      const acl=createAuthorizationService(db,{permissions:[permission]}),current=await acl.readPolicy(login.token);
      assert.equal(current.ok,true);
      const policy=structuredClone(current.policy);
      policy.roles.push({id:'delivery',inherits:[],permissionIds:[permission.id],permissionOverrides:[]});
      policy.assignments.push({principalId:owner.principalId,contextId:'application',audience:'admin',roleId:'delivery'});
      assert.equal((await acl.replacePolicy(login.token,{expectedEpoch:current.epoch,policy})).ok,true);
      response=await dispatchDeliveryAuthorizationHttp(request(login.token),environment,raw,'request-two',[permission]);
      assert.equal(response.status,200);
      const granted=await response.json();
      assert.equal(granted.principalId,owner.principalId);
      assert.equal(granted.sessionId,login.session.id);
      assert.equal(granted.operatorOrigin,operatorOrigin);
      assert.equal(granted.expiresAtMs,login.session.expiresAtMs);
      const emptyCatalog={schemaVersion:1,compositionDigest:'test',modules:[]};
      response=await dispatchDeliveryAuthorizationHttp(connectionsRequest(login.token),environment,raw,
        'connections-empty',[permission],emptyCatalog);
      assert.equal(response.status,200);assert.deepEqual(await response.json(),{secretConnections:[]});
      const configTable=openaiSchema.tables.provider_config,secretTable=openaiSchema.tables.provider_secret,
        reference='creezio-secret:v1:11111111-1111-4111-8111-111111111111';
      const catalog={schemaVersion:1,compositionDigest:'test',modules:[{moduleId:'creezio.openai',enabled:true,
        models:[{modelId:'provider_config',table:configTable},
          {modelId:'provider_secret',table:secretTable}]}]};
      response=await dispatchDeliveryAuthorizationHttp(connectionsRequest(login.token),environment,raw,
        'connections-unavailable',[permission],catalog);
      assert.equal(response.status,503);
      await db.batch(openaiSchema.statements.map(sql=>db.prepare(sql)));
      await db.prepare(`INSERT INTO "${secretTable}"
        (context_id,id,binding_id,ciphertext,key_id,version,state) VALUES (?,?,?,?,?,?,?)`)
        .bind('application',reference,'openai.responses.v1','private-ciphertext','local',1,'active').run();
      await db.prepare(`INSERT INTO "${configTable}"
        (context_id,id,model_id,api_key_ref,secret_version,enabled,revision,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .bind('application','openai.responses.v1','gpt-test',reference,1,1,1,new Date().toISOString()).run();
      response=await dispatchDeliveryAuthorizationHttp(connectionsRequest(login.token),environment,raw,
        'connections-one',[permission],catalog);
      assert.equal(response.status,200);
      const connections=await response.json();
      assert.deepEqual(connections.secretConnections,[{contextId:'application',reference,
        bindingId:'openai.responses.v1',label:'gpt-test · openai.responses.v1'}]);
      assert.equal(JSON.stringify(connections).includes('private-ciphertext'),false);
      response=await dispatchDeliveryAuthorizationHttp(request(login.token,
        {headers:{origin:'http://127.0.0.1:5174'}}),environment,raw,'request-three',[permission]);
      assert.equal(response.status,403);
      response=await dispatchDeliveryAuthorizationHttp(request(login.token,
        {headers:{authorization:'Bearer fake'}}),environment,raw,'request-four',[permission]);
      assert.equal(response.status,401);
      response=await dispatchDeliveryAuthorizationHttp(request(login.token,{body:'{"x":1}'}),
        environment,raw,'request-five',[permission]);
      assert.equal(response.status,400);
      response=await dispatchDeliveryAuthorizationHttp(request(login.token),
        {...environment,profile:'cloudflare'},raw,'request-six',[permission]);
      assert.equal(response.status,404);
      response=await dispatchDeliveryAuthorizationHttp(request(login.token),environment,raw,'request-seven',[]);
      assert.equal(response.status,403);
      const grantedPolicy=await acl.readPolicy(login.token),revoked=structuredClone(grantedPolicy.policy);
      revoked.assignments=revoked.assignments.filter(item=>item.roleId!=='delivery');
      assert.equal((await acl.replacePolicy(login.token,
        {expectedEpoch:grantedPolicy.epoch,policy:revoked})).ok,true);
      response=await dispatchDeliveryAuthorizationHttp(request(login.token),environment,raw,'request-eight',[permission]);
      assert.equal(response.status,403);
    }finally{await runtime.dispose();}
  });
