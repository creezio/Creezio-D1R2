import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import {createVaultKeyring} from '../../core/vault/crypto.ts';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import * as handlers from '../../extensions/connectors/n8n/module/operations.ts';
import {n8nConnectorDescriptor} from '../../extensions/connectors/n8n/module/storage.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/connectors/n8n/module/manifest.json'),moduleId=manifest.identity.id;
const digest=`sha256-${'8'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({
    modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}};
function registry(overrides={}){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},names=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  const operationCatalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,
    schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]};
  return createOperationRegistry({catalog:operationCatalog,validators,
    handlers:Object.fromEntries(manifest.contracts.operations.map(op=>
      [`${moduleId}:${op.id}`,overrides[op.id]??handlers[op.handler.export]]))});
}
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const success=value=>{assert.equal(value.execution?.state,'succeeded',JSON.stringify(value));return value.execution.output;};
const failed=async(promise,code)=>{
  const value=await promise.catch(error=>error);
  assert.notEqual(value.execution?.state,'succeeded');
  assert.equal(value.code??value.execution?.errorCode,code,JSON.stringify(value));
};

test('n8n connector uses real D1/vault/ACL and HTTP/MCP while external REST is mocked',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-n8n-integration'},d1Persist:false});
    let mcpClient;
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic n8n connector qualification password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'n8n-owner@example.invalid',
        displayName:'n8n owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'n8n-owner@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'n8n-owner@example.invalid',password,audience:'app'}));
      const machines=createMachineAccountService(db,{permissions});
      const machine=good(await machines.createService(admin.token,{displayName:'n8n read client'})).principal;
      const acl=createAuthorizationService(db,{permissions});
      const before=good(await acl.readPolicy(admin.token)),policy=structuredClone(before.policy);
      policy.roles.push({id:'n8n-admin',inherits:[],permissionIds:[`${moduleId}:manage`,`${moduleId}:read`],
        permissionOverrides:[]},{id:'n8n-reader',inherits:[],permissionIds:[`${moduleId}:read`],permissionOverrides:[]});
      policy.contexts.push({id:'other',status:'active'});
      for(const [principalId,audience,contextId,roleId] of [[owner.principalId,'admin','application','n8n-admin'],
        [owner.principalId,'app','application','n8n-reader'],[owner.principalId,'admin','other','n8n-admin'],
        [machine.id,'app','application','n8n-reader']]){
        if(!policy.memberships.some(item=>item.principalId===principalId&&item.audience===audience&&item.contextId===contextId))
          policy.memberships.push({principalId,audience,contextId,status:'active'});
        policy.assignments.push({principalId,audience,contextId,roleId});
      }
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const apiToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'n8n read test',
        ttlMs:60000,scopes:[{contextId:'application',audience:'app',permissionIds:[`${moduleId}:read`]}]})).token;
      const keyring=createVaultKeyring({activeKeyId:'n8n-test',keys:{'n8n-test':new Uint8Array(32).fill(23)}});
      const secret='synthetic-n8n-api-key';
      const requests=[];
      const fetcher=async(url,init)=>{
        requests.push({url:String(url),method:init.method,redirect:init.redirect,
          credential:init.headers.get('X-N8N-API-KEY')});
        const path=new URL(url).pathname;
        if(path.endsWith('/workflows'))return Response.json({data:[{id:'wf-1',name:'Workflow local',active:true,
          isArchived:false,createdAt:'2026-09-28T00:00:00.000Z',updatedAt:'2026-09-28T00:00:00.000Z',
          versionId:'version-1',nodes:[{credentials:{token:'hidden'}}],pinData:{secret:'hidden'}}],nextCursor:null});
        if(path.endsWith('/workflows/wf-1'))return Response.json({id:'wf-1',name:'Workflow local',active:true,
          isArchived:false,createdAt:'2026-09-28T00:00:00.000Z',updatedAt:'2026-09-28T00:00:00.000Z',
          versionId:'version-1',nodes:[{credentials:{token:'hidden'}}]});
        if(path.endsWith('/executions'))return Response.json({data:[{id:'ex-1',workflowId:'wf-1',
          status:'success',mode:'trigger',startedAt:'2026-09-28T00:00:00.000Z',stoppedAt:null,
          data:{secret:'hidden'},workflowData:{credentials:'hidden'}}],nextCursor:null});
        if(path.endsWith('/executions/ex-1'))return Response.json({id:'ex-1',workflowId:'wf-1',status:'success',
          mode:'trigger',startedAt:'2026-09-28T00:00:00.000Z',stoppedAt:null,data:{secret:'hidden'}});
        return new Response(null,{status:404});
      };
      let retainedConnector=null,captureConnector=false;
      const registered=registry({'workflow.list':(input,context)=>{
        if(captureConnector){retainedConnector=context.connector;return {output:{items:[],nextCursor:null}};}
        return handlers.workflowList(input,context);
      }}),engine=createOperationEngine({db,catalog,registry:registered,permissions,
        connectors:[{descriptor:n8nConnectorDescriptor,keyring,fetcher}]});
      const invoke=(operationId,input,{token=admin.token,audience='admin',contextId='application',kind='session'}={})=>
        engine.invoke({credential:{kind,token},moduleId,operationId,contextId,audience,input});
      const first=success(await invoke('config.set',{requestKey:'set-origin',origin:'https://n8n.example.invalid/',
        enabled:false,revision:0})).config;
      assert.equal(first.origin,'https://n8n.example.invalid');assert.equal(first.revision,1);
      await failed(invoke('config.set',{requestKey:'stale-origin',origin:'https://other.example.invalid',
        enabled:false,revision:0}),'conflict');
      const keyed=success(await invoke('config.key.set',{requestKey:'set-key',apiKey:secret,revision:1})).config;
      assert.equal(keyed.hasKey,true);assert.equal(keyed.revision,2);
      assert.doesNotMatch(JSON.stringify(keyed),/synthetic-n8n-api-key|creezio-secret/u);
      const storedConfig=await db.prepare(`SELECT key_ref FROM "${generated.tables.connector_config}" WHERE context_id=?`)
        .bind('application').first();
      const storedSecret=await db.prepare(`SELECT ciphertext,state FROM "${generated.tables.connector_secret}" WHERE context_id=?`)
        .bind('application').first();
      assert.notEqual(storedConfig.key_ref,secret);
      assert.notEqual(storedSecret.ciphertext,secret);
      assert.doesNotMatch(JSON.stringify({storedConfig,storedSecret}),/synthetic-n8n-api-key/u);
      assert.equal(storedSecret.state,'active');
      const enabled=success(await invoke('config.set',{requestKey:'enable',origin:first.origin,
        enabled:true,revision:2})).config;
      assert.equal(enabled.revision,3);assert.equal(enabled.enabled,true);
      assert.equal(success(await invoke('config.read',{})).config.hasKey,true);
      await db.prepare(`UPDATE "${generated.tables.connector_config}" SET secret_version=99 WHERE context_id=?`)
        .bind('application').run();
      await failed(invoke('workflow.list',{limit:1}),'unavailable');
      assert.equal(requests.length,0,'mismatched vault version blocks egress');
      await db.prepare(`UPDATE "${generated.tables.connector_config}" SET secret_version=1 WHERE context_id=?`)
        .bind('application').run();
      await failed(invoke('config.read',{}, {token:app.token,audience:'app'}),'forbidden');
      await failed(invoke('workflow.list',{limit:1},{token:admin.token,contextId:'other'}),'unavailable');
      const appWorkflows=success(await invoke('workflow.list',{limit:1},{token:app.token,audience:'app'}));
      assert.deepEqual(appWorkflows.items.map(item=>item.id),['wf-1']);
      assert.doesNotMatch(JSON.stringify(appWorkflows),/hidden|nodes|pinData|credentials|synthetic-n8n-api-key/u);
      assert.equal(success(await invoke('workflow.read',{id:'wf-1'})).workflow.id,'wf-1');
      assert.equal(success(await invoke('execution.list',{limit:1})).items[0].id,'ex-1');
      assert.equal(success(await invoke('execution.read',{id:'ex-1'})).execution.id,'ex-1');
      assert.ok(requests.length>=4);
      assert.ok(requests.every(item=>item.credential===secret&&item.method==='GET'&&item.redirect==='manual'));
      assert.ok(requests.every(item=>item.url.startsWith('https://n8n.example.invalid/api/v1/')));
      captureConnector=true;
      const captured=success(await invoke('workflow.list',{limit:1}));
      assert.equal(captured.items.length,0);assert.equal(captured.nextCursor,null);
      captureConnector=false;
      assert.ok(retainedConnector);
      const beforeRetained=requests.length;
      assert.deepEqual(await retainedConnector.request({resource:'workflows',limit:1}),
        {kind:'error',code:'unavailable'});
      assert.equal(requests.length,beforeRetained,'closed operation cannot issue retained connector GET');
      const httpBindings=compileHttpBindings({composition,modules:[manifest],operationCatalog:registered.catalog});
      const http=createOperationHttpTransport(httpBindings,engine),origin='https://creezio.example.invalid';
      const wire=(path,credential=apiToken)=>http.dispatch(new Request(origin+path,{headers:{
        authorization:`Bearer ${credential}`,'x-creezio-context':'application'}}),
      {profile:'sites',bindings:{DB:db}},{CREEZIO_APP_ORIGIN:origin},'n8n-http');
      const appList=await wire('/api/app/n8n/workflow/list?limit=1');
      assert.equal(appList.status,200,await appList.clone().text());
      assert.equal((await appList.json()).execution.output.items[0].id,'wf-1');
      assert.equal((await wire('/api/admin/n8n/workflow/list?limit=1')).status,401);
      const mcpBindings=compileMcpBindings({composition,modules:[manifest],operationCatalog:registered.catalog});
      const mcp=createMcpHttpTransport(mcpBindings,registered,engine,{origin,
        resourceMetadataUrl:audience=>`${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
        authenticate:async(request,audience)=>{
          const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
          const checked=await machines.check(token,{contextId:'application',audience,actors:['machine'],
            requiredPermissionIds:[`${moduleId}:read`],purpose:'operation'});
          return checked.allowed?{credential:{kind:'api-token',token},contextId:'application'}:null;
        },canDiscover:async(identity,target)=>(await machines.check(identity.credential.token,{
          contextId:target.contextId,audience:target.audience,actors:target.actors,
          requiredPermissionIds:target.permissionIds,purpose:'operation'})).allowed});
      mcpClient=new Client({name:'n8n-integration',version:'1.0.0'});
      await mcpClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/app'),{
        authProvider:{token:async()=>apiToken},fetch:(input,init)=>mcp.dispatch(new Request(input,init),'app','n8n-mcp')}));
      assert.ok((await mcpClient.listTools()).tools.some(tool=>tool.name==='n8n_workflow_list'));
      const mcpList=await mcpClient.callTool({name:'n8n_workflow_list',arguments:{limit:1}});
      assert.equal(mcpList.structuredContent.items[0].id,'wf-1');
      const revoked=success(await invoke('config.key.revoke',{requestKey:'revoke-key',revision:3})).config;
      assert.equal(revoked.hasKey,false);assert.equal(revoked.enabled,false);
      assert.equal((await db.prepare(`SELECT state FROM "${generated.tables.connector_secret}" WHERE context_id=?`)
        .bind('application').first()).state,'revoked');
      const beforeRefusal=requests.length;
      await failed(invoke('workflow.list',{limit:1}),'unavailable');
      assert.equal(requests.length,beforeRefusal,'revoked key cannot reach n8n');
      const latest=good(await acl.readPolicy(admin.token)),withoutMachine=structuredClone(latest.policy);
      withoutMachine.assignments=withoutMachine.assignments.filter(item=>item.principalId!==machine.id);
      good(await acl.replacePolicy(admin.token,{expectedEpoch:latest.epoch,policy:withoutMachine}));
      assert.equal((await wire('/api/app/n8n/workflow/list?limit=1')).status,403);
      await assert.rejects(mcpClient.callTool({name:'n8n_workflow_list',arguments:{limit:1}}));
    }finally{if(mcpClient)await mcpClient.close();await runtime.dispose();}
  });
