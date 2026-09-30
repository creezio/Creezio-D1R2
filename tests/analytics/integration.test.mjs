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
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import {recordPreEngineRefusal} from '../../core/operations/transport-diagnostics.ts';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {appendStorageCompositionReceipt} from '../storage-authority/fixtures/schema-receipt.mjs';
import * as handlers from '../../extensions/native/analytics/module/operations.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/native/analytics/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'a'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,
  models:manifest.contracts.models.map(model=>({modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},
  app:{moduleIds:[moduleId]}}};
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
const succeeded=result=>{assert.equal(result.execution?.state,'succeeded',JSON.stringify(result));return result.execution.output;};
const rejected=async(promise,code)=>{const result=await promise.catch(error=>error);
  assert.notEqual(result?.execution?.state,'succeeded',JSON.stringify(result));
  assert.equal(result.code??result.execution?.errorCode,code,JSON.stringify(result));};

test('analytics D1, paging, shared emission and admin-only read use engine ACL',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-analytics-integration'},d1Persist:false});
    let client;
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic analytics integration password';
      const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'analytics@example.invalid',
        displayName:'Analytics owner',password});
      assert.equal(owner.ok,true,JSON.stringify(owner));
      const admin=await accounts.login({loginIdentifier:'analytics@example.invalid',password,audience:'admin'});
      const app=await accounts.login({loginIdentifier:'analytics@example.invalid',password,audience:'app'});
      assert.equal(admin.ok,true);assert.equal(app.ok,true);
      await db.prepare(`INSERT INTO "${ACCESS_TABLES.role_grants}" (role_id,permission_id) VALUES (?,?)`)
        .bind('administrator',`${moduleId}:read`).run();
      await db.prepare(`INSERT INTO "${ACCESS_TABLES.role_grants}" (role_id,permission_id) VALUES (?,?)`)
        .bind('administrator',`${moduleId}:emit`).run();
      for(const right of ['manage-collection','manage-retention'])await db.prepare(
        `INSERT INTO "${ACCESS_TABLES.role_grants}" (role_id,permission_id) VALUES (?,?)`)
        .bind('administrator',`${moduleId}:${right}`).run();
      const diagnosticsRegistry=registry();
      const diagnosticsBindings=compileHttpBindings({composition,modules:[manifest],
        operationCatalog:diagnosticsRegistry.catalog});
      const engine=createOperationEngine({db,catalog,registry:diagnosticsRegistry,permissions,
        httpBindings:diagnosticsBindings});
      const invoke=(operationId,input,session=admin,audience='admin',contextId='application')=>engine.invoke({
        credential:{kind:'session',token:session.token},moduleId,operationId,contextId,audience,input});
      await rejected(invoke('event.list',{period:'week',limit:50},app,'app'),'forbidden');
      const acl=createAuthorizationService(db,{permissions}),before=await acl.readPolicy(admin.token);
      assert.equal(before.ok,true);
      const policy=structuredClone(before.policy);
      policy.contexts.push({id:'analytics-space',status:'active'});
      policy.roles.push({id:'analytics-app',inherits:[],permissionIds:[`${moduleId}:emit`],permissionOverrides:[]});
      if(!policy.memberships.some(row=>row.principalId===owner.principalId&&row.audience==='app'
        &&row.contextId==='application'))policy.memberships.push({principalId:owner.principalId,
          audience:'app',contextId:'application',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'app',contextId:'application',roleId:'analytics-app'});
      policy.memberships.push({principalId:owner.principalId,audience:'app',contextId:'analytics-space',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'app',contextId:'analytics-space',roleId:'analytics-app'});
      policy.memberships.push({principalId:owner.principalId,audience:'admin',contextId:'analytics-space',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId:'analytics-space',roleId:'administrator'});
      assert.equal((await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy})).ok,true);
      assert.equal(succeeded(await invoke('collection.effective',{},app,'app')).navigation,false);
      await recordPreEngineRefusal({db,transport:'api',method:'POST',routeTemplate:'/api/app/analytics/event/record',
        status:401,code:'authentication_required',startedAtMs:Date.now()});
      assert.equal((await db.prepare(`SELECT COUNT(*) AS total FROM "${generated.tables.transport_refusal}"`).first()).total,0);
      const collection=succeeded(await invoke('collection.configure',{requestKey:'enable-collection',expectedRevision:0,
        navigation:true,clicks:true,refusals:true,refusalRetentionDays:7}));
      assert.equal(collection.revision,1);
      assert.equal(succeeded(await invoke('collection.effective',{},app,'app')).navigation,true);
      assert.equal(succeeded(await invoke('collection.effective',{},app,'app')).clicks,true);
      assert.equal(succeeded(await invoke('collection.effective',{},app,'app','analytics-space')).navigation,true);
      const disabled=succeeded(await invoke('collection.configure',{requestKey:'disable-collection',
        expectedRevision:1,navigation:false,clicks:false,refusals:false,refusalRetentionDays:7}));
      assert.equal(disabled.revision,2);
      assert.equal(succeeded(await invoke('collection.effective',{},app,'app')).navigation,false);
      await recordPreEngineRefusal({db,transport:'api',method:'POST',routeTemplate:'/api/app/analytics/event/record',
        status:401,code:'authentication_required',startedAtMs:Date.now()});
      assert.equal((await db.prepare(`SELECT COUNT(*) AS total FROM "${generated.tables.transport_refusal}"`).first()).total,0);
      assert.equal(succeeded(await invoke('collection.configure',{requestKey:'reenable-collection',
        expectedRevision:2,navigation:true,clicks:true,refusals:true,refusalRetentionDays:7})).revision,3);
      await rejected(invoke('collection.configure',{requestKey:'stale-collection',expectedRevision:0,
        navigation:false,clicks:false,refusals:false,refusalRetentionDays:7}),'conflict');
      await recordPreEngineRefusal({db,transport:'api',method:'POST',routeTemplate:'/api/app/analytics/event/record',
        status:401,code:'authentication_required',startedAtMs:Date.now()-10});
      const refusal=succeeded(await invoke('refusals.list',{limit:50}));
      assert.equal(refusal.items.length,1);
      await rejected(invoke('refusals.list',{limit:50},admin,'admin','analytics-space'),'forbidden');
      assert.deepEqual(Object.keys(refusal.items[0]).sort(),['durationMs','errorCode','id','method','occurredAt',
        'routeTemplate','status','transport']);
      const oldId=crypto.randomUUID(),oldAt=Date.now()-8*86_400_000;
      await db.prepare(`INSERT INTO "${generated.tables.transport_refusal}"
        (id,transport,method,route_template,status,error_code,created_at_ms,duration_ms)
        VALUES (?,?,?,?,?,?,?,?)`).bind(oldId,'mcp','POST','/mcp/admin',403,'tool_unavailable',oldAt,2).run();
      const refusalPreview=succeeded(await invoke('refusals.preview',{}));
      assert.deepEqual(refusalPreview.items.map(item=>item.id),[oldId]);
      assert.equal(succeeded(await invoke('refusals.purge',{requestKey:'purge-old-refusal',
        revision:refusalPreview.revision,cutoff:refusalPreview.cutoff,items:refusalPreview.items})).deleted,1);
      assert.equal(succeeded(await invoke('refusals.list',{limit:50})).items.length,1);
      const recorded=succeeded(await invoke('event.record',{requestKey:'app-page',type:'page_view',
        surface:'front',path:'/home'},app,'app'));
      assert.equal(recorded.event.principalId,owner.principalId);
      await rejected(invoke('event.list',{period:'week',limit:50},app,'app'),'forbidden');
      const replay=succeeded(await invoke('event.record',{requestKey:'app-page',type:'page_view',
        surface:'front',path:'/home'},app,'app'));
      assert.equal(replay.event.id,recorded.event.id);
      for(let index=0;index<55;index++)succeeded(await invoke('event.record',
        {requestKey:`admin-${index}`,type:'click',surface:'workspace',actionId:`item-${index}`}));
      const first=succeeded(await invoke('event.list',{period:'week',limit:50}));
      assert.equal(first.items.length,50);
      const second=succeeded(await invoke('event.list',{period:'week',limit:50,cursor:first.nextCursor}));
      assert.equal(second.items.length,6);
      assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,56);
      const summary=succeeded(await invoke('analytics.snapshot',{period:'week'}));
      assert.equal(summary.totals.events,56);
      assert.equal(summary.totals.clicks,55);
      assert.equal(summary.complete,true);
      const diagnostics=succeeded(await invoke('diagnostics.executions',{period:'week',limit:5}));
      assert.ok(diagnostics.items.length>0);
      assert.ok(diagnostics.items.some(item=>item.operationId==='event.record'));
      const diagnosticCursor=JSON.parse(Buffer.from(diagnostics.nextCursor,'base64url').toString('utf8'));
      await rejected(invoke('diagnostics.executions',{period:'week',limit:5,cursor:Buffer.from(JSON.stringify({
        ...diagnosticCursor,from:-1})).toString('base64url')}),'invalid_input');
      await rejected(invoke('diagnostics.executions',{period:'week',limit:5,cursor:Buffer.from(JSON.stringify({
        ...diagnosticCursor,afterTime:diagnosticCursor.from-1})).toString('base64url')}),'invalid_input');
      assert.equal(diagnostics.items.every(item=>!Object.hasOwn(item,'output')
        &&!Object.hasOwn(item,'inputHash')&&!Object.hasOwn(item,'principalId')),true);
      const endpoints=succeeded(await invoke('diagnostics.endpoints',{limit:50}));
      assert.equal(endpoints.source,'compiled-http-bindings');
      assert.ok(endpoints.items.some(item=>item.operationId==='event.record'
        &&item.method==='POST'&&item.path==='/api/app/analytics/event/record'));
      await rejected(invoke('diagnostics.executions',{period:'week',limit:5},app,'app'),'forbidden');
      const widgetSummary=succeeded(await invoke('analytics.widget.summary',{}));
      assert.equal(widgetSummary.totals.events,56);
      assert.equal(widgetSummary.source,'reported');
      assert.equal(widgetSummary.complete,true);
      const widgetFirst=succeeded(await invoke('analytics.widget.events',{period:'week'}));
      const widgetSecond=succeeded(await invoke('analytics.widget.events',
        {period:'week',cursor:widgetFirst.nextCursor}));
      assert.equal(widgetFirst.items.length,5);
      assert.equal(widgetSecond.items.length,5);
      assert.deepEqual(widgetSecond.period,widgetFirst.period);
      assert.equal(new Set([...widgetFirst.items,...widgetSecond.items].map(item=>item.id)).size,10);
      assert.ok(Buffer.byteLength(JSON.stringify(widgetFirst))<7500);
      await rejected(invoke('analytics.widget.events',{period:'week'},app,'app'),'forbidden');
      const exported=succeeded(await invoke('event.export',{period:'week',limit:50,format:'csv'}));
      assert.ok(exported.content.startsWith('"id"'));
      assert.equal(exported.complete,false);
      await rejected(invoke('event.record',{requestKey:'bad-script',type:'click',surface:'workspace',
        actionId:'<script>alert(1)</script>'}),'invalid_input');
      await rejected(invoke('event.list',{period:'week',limit:50},admin,'admin','another-context'),'forbidden');
      const raw=await db.prepare(`SELECT COUNT(*) AS count FROM "${generated.tables.event}" WHERE context_id=?`)
        .bind('application').first();
      assert.equal(raw.count,56);
      const timestamp=new Date().toISOString(),escaped='\u0001'.repeat(256);
      const columns=['context_id','id','principal_id','actor_principal_id','event_type','action_id',
        'surface','path','error_code','duration_ms','created_at'];
      await db.batch(Array.from({length:520},(_,index)=>db.prepare(
        `INSERT INTO "${generated.tables.event}" (${columns.map(name=>`"${name}"`).join(',')})
          VALUES (${columns.map(()=>'?').join(',')})`).bind('application',`large-${index}`,
        'synthetic','synthetic','page_view',null,'workspace',escaped,null,null,timestamp)));
      const ids=new Set();let cursor;
      for(let page=0;page<12;page++){
        const listed=succeeded(await invoke('event.list',{period:'week',limit:50,principalId:'synthetic',
          ...(cursor?{cursor}:{})}));
        assert.ok(Buffer.byteLength(JSON.stringify(listed))<262144);
        for(const item of listed.items)ids.add(item.id);
        cursor=listed.nextCursor;
        if(!cursor)break;
      }
      assert.equal(ids.size,520,'maximally escaped rows remain reachable across D1 pages');
      assert.equal(cursor,null);
      const partial=succeeded(await invoke('analytics.snapshot',{period:'week',principalId:'synthetic'}));
      assert.equal(partial.totals.events,500);
      assert.equal(partial.complete,false);
      const continuation=succeeded(await invoke('analytics.snapshot',{period:'week',principalId:'synthetic',
        cursor:partial.nextCursor}));
      assert.equal(continuation.totals.events,20);
      assert.equal(continuation.complete,true);
      const escapedExport=succeeded(await invoke('event.export',{period:'week',limit:50,format:'json',
        principalId:'synthetic'}));
      assert.ok(Buffer.byteLength(escapedExport.content)<180000);
      assert.equal(JSON.parse(escapedExport.content).length,50);
      const machines=createMachineAccountService(db,{permissions});
      const machine=(await machines.createService(admin.token,{displayName:'Analytics machine'})).principal;
      const existing=await acl.readPolicy(admin.token),machinePolicy=structuredClone(existing.policy);
      machinePolicy.roles.push({id:'analytics-machine-admin',inherits:[],
        permissionIds:[`${moduleId}:read`],permissionOverrides:[]});
      machinePolicy.roles.push({id:'analytics-machine-app',inherits:[],
        permissionIds:[`${moduleId}:emit`],permissionOverrides:[]});
      for(const [audience,roleId] of [['admin','analytics-machine-admin'],['app','analytics-machine-app']]){
        machinePolicy.memberships.push({principalId:machine.id,audience,contextId:'application',status:'active'});
        machinePolicy.assignments.push({principalId:machine.id,audience,contextId:'application',roleId});
      }
      assert.equal((await acl.replacePolicy(admin.token,{expectedEpoch:existing.epoch,policy:machinePolicy})).ok,true);
      const issued=await machines.issueToken(admin.token,{principalId:machine.id,label:'Analytics wire',ttlMs:60000,
        scopes:[{contextId:'application',audience:'admin',permissionIds:[`${moduleId}:read`]},
          {contextId:'application',audience:'app',permissionIds:[`${moduleId}:emit`]}]});
      assert.equal(issued.ok,true,JSON.stringify(issued));
      const token=issued.token,registered=registry();
      const origin='https://analytics.example.invalid';
      const http=createOperationHttpTransport(compileHttpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog}),engine,undefined,true);
      const wire=(path,body,credential=token)=>http.dispatch(new Request(origin+path,{
        method:body?'POST':'GET',headers:{authorization:`Bearer ${credential}`,
          'x-creezio-context':'application',...(body?{'content-type':'application/json','x-creezio-request':'1'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})}),{profile:'sites',bindings:{DB:db}},
        {CREEZIO_APP_ORIGIN:origin},'analytics-http');
      const response=await wire('/api/app/analytics/event/record',{
        requestKey:'machine-app-1',type:'error',surface:'api',errorCode:'E_TEST'});
      assert.equal(response.status,200,await response.clone().text());
      assert.equal(succeeded(await response.json()).event.type,'error');
      const machineList=await wire('/api/admin/analytics/event/list?period=week&limit=50');
      assert.equal(machineList.status,200,await machineList.clone().text());
      assert.ok(succeeded(await machineList.json()).items.length>0);
      const widgetHttp=await wire('/api/admin/analytics/analytics/widget/events?period=week');
      assert.equal(widgetHttp.status,200,await widgetHttp.clone().text());
      assert.equal(succeeded(await widgetHttp.json()).items.length,5);
      assert.equal(await wire('/api/app/analytics/event/list?period=week&limit=50'),null,
        'app read is not exposed by HTTP bindings');
      const refusedHttp=await http.dispatch(new Request(origin+'/api/app/analytics/event/record',{
        method:'POST',headers:{authorization:'Bearer invalid', 'content-type':'application/json',
          'x-creezio-context':'application','x-creezio-request':'1'},body:'{}'}),
        {profile:'sites',bindings:{DB:db}},{CREEZIO_APP_ORIGIN:origin},'analytics-http-refusal');
      assert.equal(refusedHttp.status,401);
      assert.ok(succeeded(await invoke('refusals.list',{limit:50})).items.some(item=>
        item.transport==='api'&&item.routeTemplate==='/api/app/analytics/event/record'&&item.status===401));
      const widgetCatalog=compileWidgetCatalog({composition,modules:[manifest],
        operationCatalog:registered.catalog,
        readAsset:(_id,relative)=>readFileSync(new URL(`../../extensions/native/analytics/${relative}`,
          import.meta.url),'utf8'),
        bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(
          `../../extensions/native/analytics/${reference.path}`,import.meta.url))],bundle:true,
          write:false,platform:'browser',format:'iife',globalName:'__creezioWidget',target:'es2022',
          minify:true,footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
      assert.equal(widgetCatalog.widgets.length,2);
      const mcp=createMcpHttpTransport(compileMcpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog,widgetCatalog}),registered,engine,{origin,
        resourceMetadataUrl:audience=>`${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
        authenticate:async(request,audience)=>{
          const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'');
          const checked=await machines.check(bearer,{contextId:'application',audience,actors:['machine'],
            requiredPermissionIds:[`${moduleId}:read`],purpose:'operation'});
          return checked.allowed?{credential:{kind:'api-token',token:bearer},contextId:'application'}:null;
        },canDiscover:async(identity,target)=>(await machines.check(identity.credential.token,{
          contextId:target.contextId,audience:target.audience,actors:target.actors,
          requiredPermissionIds:target.permissionIds,purpose:'operation'})).allowed,diagnosticsDb:db});
      const refusedMcp=await mcp.dispatch(new Request(origin+'/mcp/admin',{method:'GET'}),
        'admin','analytics-mcp-refusal');
      assert.equal(refusedMcp.status,405);
      assert.ok(succeeded(await invoke('refusals.list',{limit:50})).items.some(item=>
        item.transport==='mcp'&&item.routeTemplate==='/mcp/admin'&&item.status===405));
      client=new Client({name:'analytics-native-transport',version:'1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/admin'),{
        authProvider:{token:async()=>token},fetch:(input,init)=>mcp.dispatch(new Request(input,init),
          'admin','analytics-mcp')}));
      const tools=(await client.listTools()).tools;
      assert.ok(tools.some(tool=>tool.name==='analytics_analytics_snapshot'));
      const summaryTool=tools.find(tool=>tool.name==='analytics_analytics_widget_summary');
      assert.ok(summaryTool?._meta?.ui?.resourceUri);
      const resources=(await client.listResources()).resources;
      assert.equal(resources.length,2);
      assert.ok(resources.some(resource=>resource.uri===summaryTool._meta.ui.resourceUri));
      const card=await client.readResource({uri:summaryTool._meta.ui.resourceUri});
      assert.ok(card.contents.some(part=>typeof part.text==='string'&&part.text.includes('analytics-widget')));
      const mcpSnapshot=await client.callTool({name:'analytics_analytics_snapshot',arguments:{period:'week'}});
      assert.ok(mcpSnapshot.structuredContent.totals.events>0);
      const mcpWidget=await client.callTool({name:'analytics_analytics_widget_summary',arguments:{}});
      assert.equal(mcpWidget.structuredContent.input.source,'reported');
      assert.ok(Buffer.byteLength(JSON.stringify(mcpWidget))<65536);
      const latest=await acl.readPolicy(admin.token),revoked=structuredClone(latest.policy);
      revoked.assignments=revoked.assignments.filter(item=>item.principalId!==machine.id);
      assert.equal((await acl.replacePolicy(admin.token,{expectedEpoch:latest.epoch,policy:revoked})).ok,true);
      assert.equal((await wire('/api/admin/analytics/event/list?period=week&limit=50')).status,403);
      await assert.rejects(client.callTool({name:'analytics_analytics_snapshot',arguments:{period:'week'}}));
      await assert.rejects(client.readResource({uri:summaryTool._meta.ui.resourceUri}));
    }finally{if(client)await client.close();await runtime.dispose();}
  });

test('routed A and B read only installation collection flags from guarded primary D1',
  {timeout:60000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{SOURCE:'analytics-routing-source',A:'analytics-routing-a',B:'analytics-routing-b'},
      d1Persist:false});
    try{
      const source=await runtime.getD1Database('SOURCE'),a=await runtime.getD1Database('A'),
        b=await runtime.getD1Database('B');
      const authority=generateD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
      await source.batch([...access.statements,...technical.statements,...generated.statements]
        .map(sql=>source.prepare(sql)));
      const accounts=createAccountService(source),bootstrap=await provisionBootstrapCapability(source);
      const password='Synthetic routed analytics password';
      const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'routed-analytics@example.invalid',
        displayName:'Routed analytics owner',password});
      assert.equal(owner.ok,true);
      const admin=await accounts.login({loginIdentifier:'routed-analytics@example.invalid',password,audience:'admin'});
      const app=await accounts.login({loginIdentifier:'routed-analytics@example.invalid',password,audience:'app'});
      assert.equal(admin.ok,true);assert.equal(app.ok,true);
      const acl=createAuthorizationService(source,{permissions}),before=await acl.readPolicy(admin.token);
      assert.equal(before.ok,true);
      const policy=structuredClone(before.policy);
      policy.contexts.push({id:'analytics-a',status:'active'},{id:'analytics-b',status:'active'});
      policy.roles.push({id:'analytics-routed-app',inherits:[],permissionIds:[`${moduleId}:emit`],
        permissionOverrides:[]});
      for(const contextId of ['analytics-a','analytics-b']){
        policy.memberships.push({principalId:owner.principalId,contextId,audience:'app',status:'active'});
        policy.assignments.push({principalId:owner.principalId,contextId,audience:'app',roleId:'analytics-routed-app'});
      }
      assert.equal((await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy})).ok,true);
      const at=new Date().toISOString(),policyTable=`"${generated.tables.collection_policy}"`;
      const putPolicy=(db,navigation,clicks)=>db.prepare(`INSERT INTO ${policyTable}
        (id,revision,navigation_enabled,clicks_enabled,refusals_enabled,refusal_retention_days,updated_at)
        VALUES ('application',1,?,?,0,7,?)`).bind(navigation,clicks,at).run();
      await putPolicy(source,1,1);
      const epoch=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
        WHERE id='application'`).first()).epoch;
      const lockDigest=`sha256-${'b'.repeat(64)}`,routedCatalog={...catalog,lockDigest};
      const routeTable=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;
      const identities=[{installationId:'analytics-routed',contextId:'analytics-a',slot:1},
        {installationId:'analytics-routed',contextId:'analytics-b',slot:2}];
      for(const [db,identity] of [[a,identities[0]],[b,identities[1]]]){
        await db.batch([...technical.statements,...generated.statements,...authority.statements]
          .map(sql=>db.prepare(sql)));
        await appendStorageCompositionReceipt(db,digest,lockDigest);
        await db.prepare(`INSERT INTO ${routeTable}
          (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
          VALUES (?,?,?,1,'active',NULL,?,0)`)
          .bind(identity.contextId,identity.installationId,identity.slot,epoch).run();
        await putPolicy(db,0,0);
      }
      const blocked=[`"${generated.tables.collection_policy}"`,`"${generated.tables.event}"`];
      const target=db=>({prepare(sql){
        if(blocked.some(table=>sql.includes(table)))throw new Error('unexpected target business/policy read');
        return db.prepare(sql);
      },batch(statements){return db.batch(statements)}});
      const registered=registry();
      for(const [db,identity] of [[a,identities[0]],[b,identities[1]]]){
        const engine=createOperationEngine({db:target(db),authorityDb:source,storageRoute:identity,
          catalog:routedCatalog,registry:registered,permissions});
        const result=succeeded(await engine.invoke({credential:{kind:'session',token:app.token},
          moduleId,operationId:'collection.effective',contextId:identity.contextId,
          audience:'app',input:{}}));
        assert.equal(result.navigation,true);assert.equal(result.clicks,true);
      }
      await source.prepare(`UPDATE ${policyTable} SET revision=2,navigation_enabled=0,clicks_enabled=0
        WHERE id='application'`).run();
      const engine=createOperationEngine({db:target(a),authorityDb:source,storageRoute:identities[0],
        catalog:routedCatalog,registry:registered,permissions});
      const after=succeeded(await engine.invoke({credential:{kind:'session',token:app.token},
        moduleId,operationId:'collection.effective',contextId:'analytics-a',audience:'app',input:{}}));
      assert.equal(after.navigation,false);assert.equal(after.clicks,false);
      for(const db of [a,b])assert.equal((await db.prepare(`SELECT navigation_enabled
        FROM ${policyTable} WHERE id='application'`).first()).navigation_enabled,0);
    }finally{await runtime.dispose();}
  });

test('manual retention previews and deletes bounded D1 batches with policy and event guards',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-analytics-retention'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements]
        .map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic retention qualification password';
      assert.equal((await accounts.bootstrap({token:bootstrap.token,
        loginIdentifier:'retention@example.invalid',displayName:'Retention owner',password})).ok,true);
      const admin=await accounts.login({loginIdentifier:'retention@example.invalid',password,audience:'admin'});
      const app=await accounts.login({loginIdentifier:'retention@example.invalid',password,audience:'app'});
      assert.equal(admin.ok,true);assert.equal(app.ok,true);
      const registered=registry(),engine=createOperationEngine({db,catalog,registry:registered,permissions});
      const invoke=(operationId,input,session=admin,audience='admin',contextId='application')=>engine.invoke({
        credential:{kind:'session',token:session.token},moduleId,operationId,contextId,audience,input});
      await rejected(invoke('retention.preview',{}),'forbidden');
      await db.prepare(`INSERT INTO "${ACCESS_TABLES.role_grants}" (role_id,permission_id) VALUES (?,?)`)
        .bind('administrator',`${moduleId}:manage-retention`).run();
      const absent=succeeded(await invoke('retention.preview',{}));
      assert.equal(absent.configured,false);assert.equal(absent.retentionDays,null);
      assert.equal(absent.revision,0);assert.equal(absent.manualOnly,true);
      assert.equal(absent.cutoff,null);assert.equal(absent.items.length,0);
      await rejected(invoke('retention.preview',{},app,'app'),'forbidden');
      await rejected(invoke('retention.preview',{},admin,'admin','another-context'),'forbidden');
      const configured=succeeded(await invoke('retention.configure',{
        requestKey:'retention-configure-1',retentionDays:30,expectedRevision:0}));
      assert.equal(configured.revision,1);assert.equal(configured.manualOnly,true);
      await rejected(invoke('retention.configure',{
        requestKey:'retention-configure-stale',retentionDays:90,expectedRevision:0}),'conflict');
      const eventTable=`"${generated.tables.event}"`;
      const columns=['context_id','id','principal_id','actor_principal_id','event_type','action_id',
        'surface','path','error_code','duration_ms','created_at'];
      const insert=(contextId,id,createdAt)=>db.prepare(`INSERT INTO ${eventTable}
        (${columns.map(name=>`"${name}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`)
        .bind(contextId,id,'retention-owner','retention-owner','activity',null,
          'workspace',null,null,null,createdAt);
      const old=Array.from({length:15},(_,i)=>insert('application',`old-${String(i).padStart(2,'0')}`,
        `2025-01-01T00:00:${String(i).padStart(2,'0')}.000Z`));
      await db.batch([...old,insert('other-context','other-old','2025-01-01T00:00:00.000Z'),
        insert('application','future',new Date(Date.now()+86_400_000).toISOString())]);
      const preview=succeeded(await invoke('retention.preview',{}));
      assert.equal(preview.items.length,10);assert.equal(preview.hasMore,true);
      assert.ok(preview.items.every(item=>item.id.startsWith('old-')));
      await rejected(invoke('retention.purge',{requestKey:'future-cutoff',revision:1,
        cutoff:new Date(Date.now()+86_400_000).toISOString(),items:preview.items}),'invalid_input');
      await rejected(invoke('retention.purge',{requestKey:'forged-preview',revision:1,
        cutoff:preview.cutoff,items:[{id:'future',occurredAt:preview.items[0].occurredAt}]}),'conflict');
      const changed=succeeded(await invoke('retention.configure',{requestKey:'retention-configure-2',
        retentionDays:45,expectedRevision:1}));
      assert.equal(changed.revision,2);
      await rejected(invoke('retention.purge',{requestKey:'stale-policy',revision:1,
        cutoff:preview.cutoff,items:preview.items}),'conflict');
      const fresh=succeeded(await invoke('retention.preview',{}));
      assert.equal(fresh.revision,2);
      const request=input=>invoke('retention.purge',input);
      const candidates=await Promise.all(['race-a','race-b'].map(requestKey=>
        request({requestKey,revision:fresh.revision,cutoff:fresh.cutoff,items:fresh.items})
          .catch(error=>error)));
      const winners=candidates.filter(result=>result.execution?.state==='succeeded');
      assert.equal(winners.length,1,JSON.stringify(candidates));
      assert.equal(winners[0].execution.output.deleted,10);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${eventTable}
        WHERE context_id='application' AND id LIKE 'old-%'`).first()).n,5);
      const next=succeeded(await invoke('retention.preview',{}));
      assert.equal(next.items.length,5);assert.equal(next.hasMore,false);
      const last=succeeded(await request({requestKey:'last-batch',revision:next.revision,
        cutoff:next.cutoff,items:next.items}));
      assert.equal(last.deleted,5);
      const replay=succeeded(await request({requestKey:'last-batch',revision:next.revision,
        cutoff:next.cutoff,items:next.items}));
      assert.deepEqual(replay,last,'same request key reads the journal without deleting again');
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${eventTable}
        WHERE context_id='application' AND id LIKE 'old-%'`).first()).n,0);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${eventTable}
        WHERE id IN ('other-old','future')`).first()).n,2);
    }finally{await runtime.dispose();}
  });
