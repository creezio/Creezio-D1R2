import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import {compileWidgetCatalog} from '../../scripts/widgets/compile.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import * as handlers from '../../extensions/native/crm/module/operations.ts';

const json=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const manifest=json('../../extensions/native/crm/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'c'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,
  models:manifest.contracts.models.map(model=>({modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}};
function registry(){
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
    handlers:Object.fromEntries(manifest.contracts.operations.map(operation=>
      [`${moduleId}:${operation.id}`,handlers[operation.handler.export]]))});
}
const good=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};
const succeeded=result=>{assert.equal(result.execution?.state,'succeeded',JSON.stringify(result));return result.execution.output;};

test('CRM HTTP and MCP share records, reject foreign scopes and honor fresh machine revocation',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-crm-transports'},d1Persist:false});
    let client;
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic CRM transport qualification password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'crm-wire-owner@example.invalid',
        displayName:'CRM transport owner',password}));
      const ownerAdmin=good(await accounts.login({loginIdentifier:'crm-wire-owner@example.invalid',password,audience:'admin'}));
      const ownerApp=good(await accounts.login({loginIdentifier:'crm-wire-owner@example.invalid',password,audience:'app'}));
      const lifecycle=createAccountLifecycleService(db,{permissions});
      const invite=good(await lifecycle.issueInvitation(ownerAdmin.token,
        {loginIdentifier:'crm-colleague@example.invalid',displayName:'CRM colleague'}));
      const colleague=good(await lifecycle.redeem({token:invite.token,purpose:'invitation',password}));
      const colleagueApp=good(await accounts.login({loginIdentifier:'crm-colleague@example.invalid',password,audience:'app'}));
      const machines=createMachineAccountService(db,{permissions});
      const machine=good(await machines.createService(ownerAdmin.token,{displayName:'CRM machine'})).principal;
      const acl=createAuthorizationService(db,{permissions});
      const before=good(await acl.readPolicy(ownerAdmin.token)),policy=structuredClone(before.policy);
      policy.roles.push({id:'crm-user',inherits:[],permissionIds:[`${moduleId}:use`],permissionOverrides:[]});
      policy.contexts.push({id:'other',status:'active'});
      for(const [principalId,audience,contextId] of [[owner.principalId,'admin','application'],
        [owner.principalId,'app','application'],[owner.principalId,'app','other'],
        [colleague.principalId,'app','application'],[machine.id,'app','application']]){
        if(!policy.memberships.some(row=>row.principalId===principalId&&row.audience===audience&&row.contextId===contextId))
          policy.memberships.push({principalId,audience,contextId,status:'active'});
        policy.assignments.push({principalId,audience,contextId,roleId:'crm-user'});
      }
      good(await acl.replacePolicy(ownerAdmin.token,{expectedEpoch:before.epoch,policy}));
      const token=good(await machines.issueToken(ownerAdmin.token,{principalId:machine.id,label:'CRM wire test',ttlMs:60000,
        scopes:[{contextId:'application',audience:'app',permissionIds:[`${moduleId}:use`]}]})).token;
      const registered=registry(),engine=createOperationEngine({db,catalog,registry:registered,permissions});
      const invoke=(operationId,input,session=ownerApp,audience='app',contextId='application')=>engine.invoke({
        credential:{kind:'session',token:session.token},moduleId,operationId,audience,contextId,input});
      const httpBindings=compileHttpBindings({composition,modules:[manifest],operationCatalog:registered.catalog});
      const http=createOperationHttpTransport(httpBindings,engine),origin='https://crm.example.invalid';
      const wire=(path,body,contextId='application',credential=token)=>http.dispatch(new Request(origin+path,{
        method:body?'POST':'GET',headers:{authorization:`Bearer ${credential}`,'x-creezio-context':contextId,
          ...(body?{'content-type':'application/json','x-creezio-request':'1'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})}),{profile:'sites',bindings:{DB:db}},
        {CREEZIO_APP_ORIGIN:origin},'crm-transport');
      const creation={requestKey:'wire-company',name:'Transport CRM company',city:'Lyon'};
      const created=await wire('/api/app/crm/company/create',creation);
      assert.equal(created.status,200,await created.clone().text());
      const company=succeeded(await created.json()).item;
      const replay=await wire('/api/app/crm/company/create',creation);
      assert.equal(succeeded(await replay.json()).item.id,company.id,'HTTP retry is idempotent');
      assert.equal(succeeded(await invoke('company.read',{id:company.id},colleagueApp)).item.name,creation.name,
        'authorized colleagues share CRM records in their application scope');
      assert.equal(succeeded(await invoke('company.read',{id:company.id},ownerAdmin,'admin')).item.id,company.id,
        'the authorized administrator reads the same business record through the admin interface');
      for(const [session,audience,contextId] of [[ownerApp,'app','other']]){
        const result=await invoke('company.read',{id:company.id},session,audience,contextId).catch(error=>error);
        assert.equal(result.code??result.execution?.errorCode,'not_found');
      }
      assert.equal((await wire('/api/admin/crm/company/list?limit=5')).status,401);
      assert.equal((await wire('/api/app/crm/company/list?limit=5',undefined,'other')).status,401);
      assert.equal((await wire('/api/app/crm/company/list?limit=5',undefined,'application','invalid-token')).status,401);
      const widgetCatalog=compileWidgetCatalog({composition,modules:[manifest],
        operationCatalog:registered.catalog,
        readAsset:(_id,relative)=>readFileSync(new URL(`../../extensions/native/crm/${relative}`,
          import.meta.url),'utf8'),
        bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(
          `../../extensions/native/crm/${reference.path}`,import.meta.url))],bundle:true,
          write:false,platform:'browser',format:'iife',globalName:'__creezioWidget',target:'es2022',
          minify:true,footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
      assert.equal(widgetCatalog.widgets.length,6);
      const mcpBindings=compileMcpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog,widgetCatalog});
      const mcp=createMcpHttpTransport(mcpBindings,registered,engine,{origin,
        resourceMetadataUrl:audience=>`${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
        authenticate:async(request,audience)=>{
          const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'');
          const checked=await machines.check(bearer,{contextId:'application',audience,actors:['machine'],
            requiredPermissionIds:[`${moduleId}:use`],purpose:'operation'});
          return checked.allowed?{credential:{kind:'api-token',token:bearer},contextId:'application'}:null;
        },canDiscover:async(identity,target)=>(await machines.check(identity.credential.token,{
          contextId:target.contextId,audience:target.audience,actors:target.actors,
          requiredPermissionIds:target.permissionIds,purpose:'operation'})).allowed});
      client=new Client({name:'crm-native-transports',version:'1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/app'),{
        authProvider:{token:async()=>token},fetch:(input,init)=>mcp.dispatch(new Request(input,init),'app','crm-mcp')}));
      const tools=(await client.listTools()).tools;
      assert.ok(tools.some(tool=>tool.name==='crm_company_read'));
      const read=await client.callTool({name:'crm_company_read',arguments:{id:company.id}});
      assert.equal(read.structuredContent.kind,'creezio.widget.render.v1');
      assert.equal(read.structuredContent.input.item.name,creation.name);
      const changed=await client.callTool({name:'crm_company_update',arguments:{id:company.id,revision:1,
        requestKey:'wire-update',name:'Updated through MCP'}});
      assert.equal(changed.structuredContent.item.revision,2);
      const listed=await wire('/api/app/crm/company/list?limit=5');
      assert.equal(succeeded(await listed.json()).items[0].name,'Updated through MCP');
      const stale=await wire('/api/app/crm/company/update',{requestKey:'wire-stale',id:company.id,revision:1,name:'Lost update'});
      const staleBody=await stale.json();
      assert.equal(staleBody.error?.code??staleBody.execution?.errorCode,'conflict');
      const contact=succeeded(await invoke('contact.create',
        {requestKey:'widget-contact',name:'Widget contact'})).item;
      const prospect=succeeded(await invoke('prospect.create',
        {requestKey:'widget-prospect',name:'Widget prospect'})).item;
      const examples={company:{...company,name:'Updated through MCP'},contact,prospect};
      const resources=(await client.listResources()).resources;
      assert.equal(resources.length,6);
      for(const [entity,item] of Object.entries(examples)){
        for(const action of ['read','list','search']){
          const name=`crm_${entity}_${action}`,tool=tools.find(entry=>entry.name===name);
          assert.ok(tool?._meta?.ui?.resourceUri,`${name} advertises its declared widget`);
          const result=await client.callTool({name,arguments:action==='read'?{id:item.id}:
            {limit:5,...(action==='search'?{query:item.name}:{})}});
          assert.equal(result.structuredContent.kind,'creezio.widget.render.v1');
          assert.equal(result.structuredContent.instance.moduleId,moduleId);
          assert.equal(result.structuredContent.instance.audience,'app');
          const output=result.structuredContent.input;
          assert.ok(action==='read'?output.item.id===item.id:output.items.some(row=>row.id===item.id));
          assert.deepEqual(JSON.parse(result.content[0].text).output,output,
            'text-only clients receive the same authorized business result');
          const resource=await client.readResource({uri:tool._meta.ui.resourceUri});
          assert.ok(resource.contents.some(part=>typeof part.text==='string'&&part.text.includes('<main')));
        }
      }
      assert.ok(!tools.find(tool=>tool.name==='crm_company_update')._meta?.ui,
        'adding read widgets does not introduce a chat mutation action');
      const latest=good(await acl.readPolicy(ownerAdmin.token)),revoked=structuredClone(latest.policy);
      revoked.assignments=revoked.assignments.filter(row=>row.principalId!==machine.id);
      good(await acl.replacePolicy(ownerAdmin.token,{expectedEpoch:latest.epoch,policy:revoked}));
      assert.equal((await wire('/api/app/crm/company/list?limit=5')).status,403);
      await assert.rejects(client.callTool({name:'crm_company_read',arguments:{id:company.id}}));
      await assert.rejects(client.readResource({uri:resources[0].uri}));
      assert.equal(succeeded(await invoke('company.read',{id:company.id},colleagueApp)).item.revision,2,
        'machine revocation does not remove colleague access or data');
    }finally{if(client)await client.close();await runtime.dispose();}
  });
