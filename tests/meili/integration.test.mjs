import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {buildSync} from 'esbuild';
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
import {compileSearchProjectionSources} from '../../core/search/projection.ts';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import {compileWidgetCatalog} from '../../scripts/widgets/compile.mjs';
import * as handlers from '../../extensions/connectors/meili/module/operations.ts';
import {meiliConnectorDescriptor} from '../../extensions/connectors/meili/module/storage.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/connectors/meili/module/manifest.json'),moduleId=manifest.identity.id;
const digest=`sha256-${'8'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({
    modelId:model.id,table:generated.tables[model.id],model}))}]};
const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[]}}};
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
    handlers:Object.fromEntries(manifest.contracts.operations.map(op=>
      [`${moduleId}:${op.id}`,handlers[op.handler.export]]))});
}
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const success=value=>{assert.equal(value.execution?.state,'succeeded',JSON.stringify(value));return value.execution.output;};
const failed=async(promise,code)=>{
  const value=await promise.catch(error=>error);
  assert.notEqual(value.execution?.state,'succeeded');
  assert.equal(value.code??value.execution?.errorCode,code,JSON.stringify(value));
};

test('Meili connection uses real D1/vault/ACL and HTTP/MCP with bounded synthetic GETs',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-meili-integration'},d1Persist:false});
    let mcpClient,manageMcpClient;
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Meili connector qualification password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'meili-owner@example.invalid',
        displayName:'Meili owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'meili-owner@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'meili-owner@example.invalid',password,audience:'app'}));
      const machines=createMachineAccountService(db,{permissions});
      const machine=good(await machines.createService(admin.token,{displayName:'Meili probe client'})).principal;
      const acl=createAuthorizationService(db,{permissions});
      const before=good(await acl.readPolicy(admin.token)),policy=structuredClone(before.policy);
      policy.roles.push({id:'meili-admin',inherits:[],permissionIds:[`${moduleId}:manage`,`${moduleId}:read`],
        permissionOverrides:[]},{id:'meili-reader',inherits:[],permissionIds:[`${moduleId}:read`],
        permissionOverrides:[]});
      policy.contexts.push({id:'other',status:'active'});
      for(const [principalId,audience,contextId,roleId] of [
        [owner.principalId,'admin','application','meili-admin'],
        [owner.principalId,'admin','other','meili-admin'],
        [machine.id,'admin','application','meili-admin']]){
        if(!policy.memberships.some(item=>item.principalId===principalId&&item.audience===audience&&item.contextId===contextId))
          policy.memberships.push({principalId,audience,contextId,status:'active'});
        policy.assignments.push({principalId,audience,contextId,roleId});
      }
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const apiToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'Meili read test',
        ttlMs:60000,scopes:[{contextId:'application',audience:'admin',
          permissionIds:[`${moduleId}:read`]}]})).token;
      const manageToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'Meili manage test',
        ttlMs:60000,scopes:[{contextId:'application',audience:'admin',
          permissionIds:[`${moduleId}:read`,`${moduleId}:manage`]}]})).token;
      const keyring=createVaultKeyring({activeKeyId:'meili-test',keys:{'meili-test':new Uint8Array(32).fill(23)}});
      const secret='synthetic-meili-api-key',requests=[];
      let providerStatus=200,rotateDuringList=false,indexCount=3;
      const fetcher=async(url,init)=>{
        requests.push({url:String(url),method:init.method,redirect:init.redirect,
          credential:init.headers.get('Authorization')});
        const target=new URL(String(url)),limit=Number(target.searchParams.get('limit')),
          offset=Number(target.searchParams.get('offset')??0);
        if(rotateDuringList&&target.searchParams.has('offset')){
          rotateDuringList=false;
          await db.prepare(`UPDATE "${generated.tables.connector_config}" SET revision=4,enabled=0 WHERE context_id=?`)
            .bind('application').run();
        }
        const indexes=Array.from({length:indexCount},(_,index)=>({uid:
          ['private-index','other-index','last-index'][index]??`index-${index}`,
          primaryKey:index===1?null:'id',createdAt:'2026-09-29T00:00:00.000Z',
          updatedAt:'2026-09-30T00:00:00.000Z',documents:[{token:'never-return'}]}));
        return Response.json(providerStatus===200?
          {results:indexes.slice(offset,offset+limit),limit,offset,total:indexes.length}:
          {message:'private remote error'}, {status:providerStatus});
      };
      const registered=registry(),engine=createOperationEngine({db,catalog,registry:registered,permissions,
        connectors:[{descriptor:meiliConnectorDescriptor,keyring,fetcher}]});
      const invoke=(operationId,input,{token=admin.token,audience='admin',contextId='application',kind='session'}={})=>
        engine.invoke({credential:{kind,token},moduleId,operationId,contextId,audience,input});
      const first=success(await invoke('config.set',{requestKey:'set-origin',
        origin:'https://meili.example.invalid/',enabled:false,revision:0})).config;
      assert.equal(first.origin,'https://meili.example.invalid');assert.equal(first.revision,1);
      await failed(invoke('config.set',{requestKey:'stale-origin',origin:first.origin,
        enabled:false,revision:0}),'conflict');
      const keyed=success(await invoke('config.key.set',{requestKey:'set-key',apiKey:secret,revision:1})).config;
      assert.equal(keyed.hasKey,true);assert.equal(keyed.revision,2);
      assert.doesNotMatch(JSON.stringify(keyed),/synthetic-meili-api-key|creezio-secret/u);
      const storedConfig=await db.prepare(`SELECT key_ref FROM "${generated.tables.connector_config}" WHERE context_id=?`)
        .bind('application').first();
      const storedSecret=await db.prepare(`SELECT ciphertext,state FROM "${generated.tables.connector_secret}" WHERE context_id=?`)
        .bind('application').first();
      assert.notEqual(storedConfig.key_ref,secret);assert.notEqual(storedSecret.ciphertext,secret);
      assert.equal(storedSecret.state,'active');
      const enabled=success(await invoke('config.set',{requestKey:'enable',origin:first.origin,
        enabled:true,revision:2})).config;
      assert.equal(enabled.revision,3);assert.equal(enabled.enabled,true);
      await failed(invoke('config.set',{requestKey:'redirect-sealed-key',
        origin:'https://new-meili.example.invalid',enabled:false,revision:3}),'conflict');
      assert.equal(success(await invoke('config.read',{})).config.hasKey,true);
      await db.prepare(`UPDATE "${generated.tables.connector_config}" SET secret_version=99 WHERE context_id=?`)
        .bind('application').run();
      await failed(invoke('connection.check',{}),'unavailable');
      assert.equal(requests.length,0,'mismatched vault version blocks egress');
      await db.prepare(`UPDATE "${generated.tables.connector_config}" SET secret_version=1 WHERE context_id=?`)
        .bind('application').run();
      await failed(invoke('connection.check',{}, {token:app.token,audience:'app'}),'forbidden');
      await failed(invoke('connection.check',{}, {contextId:'other'}),'unavailable');
      const checked=success(await invoke('connection.check',{}));
      assert.deepEqual({...checked},{authenticated:true,status:'connected'});
      assert.equal(requests.length,1);
      assert.deepEqual(requests[0],{url:'https://meili.example.invalid/indexes?limit=1',
        method:'GET',redirect:'manual',credential:`Bearer ${secret}`});
      assert.doesNotMatch(JSON.stringify(checked),/private-index|primaryKey|total|synthetic-meili-api-key/u);
      await failed(invoke('index.list',{limit:2},{token:apiToken,kind:'api-token'}),'forbidden');
      await failed(invoke('index.list',{limit:2},{token:app.token,audience:'app'}),'forbidden');
      const listed=success(await invoke('index.list',{limit:2}));
      assert.deepEqual(listed.items.map(item=>item.uid),['private-index','other-index']);
      assert.equal(listed.total,3);assert.equal(listed.nextCursor,'2');
      assert.equal(listed.items[1].primaryKey,null);
      assert.doesNotMatch(JSON.stringify(listed),/documents|never-return|synthetic-meili-api-key/u);
      const next=success(await invoke('index.list',{limit:2,cursor:listed.nextCursor}));
      assert.deepEqual(next.items.map(item=>item.uid),['last-index']);assert.equal(next.nextCursor,null);
      assert.equal(requests.at(-2).url,'https://meili.example.invalid/indexes?offset=0&limit=2');
      assert.equal(requests.at(-1).url,'https://meili.example.invalid/indexes?offset=2&limit=2');
      indexCount=20;
      assert.equal(success(await invoke('index.list',{limit:20})).items.length,20,
        'engine budget includes both D1 reads and all twenty projected indexes');
      indexCount=3;
      await failed(invoke('index.list',{limit:21}),'invalid_input');
      await failed(invoke('index.list',{cursor:'02',limit:2}),'invalid_input');
      providerStatus=401;
      const refused=success(await invoke('connection.check',{}));
      assert.deepEqual({...refused},{authenticated:false,status:'key_rejected'});
      assert.doesNotMatch(JSON.stringify(refused),/private remote error/u);
      providerStatus=200;
      assert.equal((await machines.check(apiToken,{contextId:'application',audience:'admin',actors:['machine'],
        requiredPermissionIds:[`${moduleId}:read`],purpose:'operation'})).allowed,true);
      assert.equal(success(await invoke('connection.check',{}, {token:apiToken,kind:'api-token'})).authenticated,true);
      const httpBindings=compileHttpBindings({composition,modules:[manifest],operationCatalog:registered.catalog});
      const http=createOperationHttpTransport(httpBindings,engine),origin='https://creezio.example.invalid';
      const wire=(path,credential=apiToken)=>http.dispatch(new Request(origin+path,{headers:{
        authorization:`Bearer ${credential}`,'x-creezio-context':'application'}}),
      {profile:'sites',bindings:{DB:db}},{CREEZIO_APP_ORIGIN:origin},'meili-http');
      const httpCheck=await wire('/api/admin/meili/connection/check');
      assert.equal(httpCheck.status,200,await httpCheck.clone().text());
      assert.equal((await httpCheck.json()).execution.output.authenticated,true);
      assert.equal(await wire('/api/app/meili/connection/check'),null,'no app route is declared');
      const deniedList=await wire('/api/admin/meili/index/list?limit=2');
      assert.equal(deniedList.status,403);
      const httpList=await wire('/api/admin/meili/index/list?limit=2',manageToken);
      assert.equal(httpList.status,200,await httpList.clone().text());
      assert.equal((await httpList.json()).execution.output.nextCursor,'2');
      const widgetCatalog=compileWidgetCatalog({composition,modules:[manifest],
        operationCatalog:registered.catalog,
        readAsset:(_id,relative)=>readFileSync(new URL(`../../extensions/connectors/meili/${relative}`,
          import.meta.url),'utf8'),
        bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(
          `../../extensions/connectors/meili/${reference.path}`,import.meta.url))],bundle:true,
          write:false,platform:'browser',format:'iife',globalName:'__creezioWidget',target:'es2022',
          minify:true,footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
      const mcpBindings=compileMcpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog,widgetCatalog});
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
      mcpClient=new Client({name:'meili-integration',version:'1.0.0'});
      await mcpClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/admin'),{
        authProvider:{token:async()=>apiToken},fetch:(input,init)=>mcp.dispatch(new Request(input,init),'admin','meili-mcp')}));
      assert.ok((await mcpClient.listTools()).tools.some(tool=>tool.name==='meili_connection_check'));
      assert.ok(!(await mcpClient.listTools()).tools.some(tool=>tool.name==='meili_index_list'));
      const mcpCheck=await mcpClient.callTool({name:'meili_connection_check',arguments:{}});
      assert.equal(mcpCheck.structuredContent.authenticated,true);
      manageMcpClient=new Client({name:'meili-manage-integration',version:'1.0.0'});
      await manageMcpClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/admin'),{
        authProvider:{token:async()=>manageToken},fetch:(input,init)=>mcp.dispatch(new Request(input,init),'admin','meili-manage-mcp')}));
      assert.ok((await manageMcpClient.listTools()).tools.some(tool=>tool.name==='meili_index_list'));
      const mcpList=await manageMcpClient.callTool({name:'meili_index_list',arguments:{limit:2}});
      assert.equal(mcpList.structuredContent.nextCursor,'2');
      assert.doesNotMatch(JSON.stringify(mcpList),/never-return|synthetic-meili-api-key/u);
      rotateDuringList=true;
      await failed(invoke('index.list',{limit:2}),'conflict');
      await db.prepare(`UPDATE "${generated.tables.connector_config}" SET revision=3,enabled=1 WHERE context_id=?`)
        .bind('application').run();
      const revoked=success(await invoke('config.key.revoke',{requestKey:'revoke-key',revision:3})).config;
      assert.equal(revoked.hasKey,false);assert.equal(revoked.enabled,false);
      assert.equal((await db.prepare(`SELECT state FROM "${generated.tables.connector_secret}" WHERE context_id=?`)
        .bind('application').first()).state,'revoked');
      const beforeRefusal=requests.length;
      await failed(invoke('connection.check',{}),'unavailable');
      assert.equal(requests.length,beforeRefusal,'revoked key cannot reach Meili');
      const changedOrigin=success(await invoke('config.set',{requestKey:'origin-after-revoke',
        origin:'https://new-meili.example.invalid',enabled:false,revision:4})).config;
      assert.equal(changedOrigin.origin,'https://new-meili.example.invalid');
      assert.equal(changedOrigin.hasKey,false);
      assert.equal(requests.length,beforeRefusal,'changing origin after revoke does not reuse the old key');
      const latest=good(await acl.readPolicy(admin.token)),withoutMachine=structuredClone(latest.policy);
      withoutMachine.assignments=withoutMachine.assignments.filter(item=>item.principalId!==machine.id);
      good(await acl.replacePolicy(admin.token,{expectedEpoch:latest.epoch,policy:withoutMachine}));
      assert.equal((await wire('/api/admin/meili/connection/check')).status,403);
      await assert.rejects(mcpClient.callTool({name:'meili_connection_check',arguments:{}}));
    }finally{if(manageMcpClient)await manageMcpClient.close();
      if(mcpClient)await mcpClient.close();await runtime.dispose();}
  });

test('Meili projection uses D1 owner reads, task confirmation, tombstones and unknown write claims',
  {timeout:90000},async()=>{
    const catalogManifest=json('../../extensions/common/catalog/module/manifest.json');
    const catalogId=catalogManifest.identity.id,sourceId=`${catalogId}:catalog-products`;
    const catalogSchema=generateD1Schema(catalogId,catalogManifest.contracts.models);
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-meili-indexing-integration'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements,
        ...catalogSchema.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Meili indexing password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,
        loginIdentifier:'meili-indexer@example.invalid',displayName:'Meili indexer',password}));
      const admin=good(await accounts.login({loginIdentifier:'meili-indexer@example.invalid',password,
        audience:'admin'}));
      const definitions=[...permissions,...catalogManifest.contracts.permissions.map(item=>({
        id:`${catalogId}:${item.id}`,audiences:item.audiences,actors:item.actors}))];
      const acl=createAuthorizationService(db,{permissions:definitions});
      const before=good(await acl.readPolicy(admin.token)),policy=structuredClone(before.policy);
      policy.roles.push({id:'projection-manager',inherits:[],permissionIds:[`${moduleId}:manage`,
        `${moduleId}:read`,`${moduleId}:search`,`${catalogId}:view`],permissionOverrides:[]});
      policy.contexts.push({id:'other',status:'active'});
      for(const contextId of ['application','other']){
        if(!policy.memberships.some(item=>item.principalId===owner.principalId&&item.audience==='admin'
          &&item.contextId===contextId))policy.memberships.push({principalId:owner.principalId,
            audience:'admin',contextId,status:'active'});
        policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId,
          roleId:'projection-manager'});
      }
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const dataCatalog={schemaVersion:1,compositionDigest:digest,modules:[catalog.modules[0],{
        moduleId:catalogId,version:catalogManifest.identity.version,enabled:true,
        permissions:catalogManifest.contracts.permissions,models:catalogManifest.contracts.models.map(model=>({
          modelId:model.id,table:catalogSchema.tables[model.id],model}))}]};
      const sources=compileSearchProjectionSources(catalogManifest.contracts.search,dataCatalog);
      assert.deepEqual(sources.map(item=>item.id),[sourceId]);
      const insert=async(contextId,id,name,status,updatedAt,revision=1)=>db.prepare(
        `INSERT INTO "${catalogSchema.tables.product}" (context_id,id,sku,name,description,attributes,
        category_id,price_minor,currency,status,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(contextId,id,`${contextId}-${id}`,name,'','[]',
        'category-a',1299,'EUR',status,revision,updatedAt,updatedAt).run();
      for(const contextId of ['application','other'])await db.prepare(
        `INSERT INTO "${catalogSchema.tables.category}" (context_id,id,name,slug,parent_id,
        position,archived_at,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(contextId,'category-a','Category A','category-a',null,0,null,1,
          '2026-09-30T09:00:00.000Z','2026-09-30T09:00:00.000Z').run();
      await insert('application','visible','Visible application','published','2026-09-30T10:00:00.000Z');
      await insert('application','draft','Secret draft','draft','2026-09-30T10:01:00.000Z');
      await insert('other','visible','Visible other','published','2026-09-30T10:00:00.000Z');
      const keyring=createVaultKeyring({activeKeyId:'meili-index-test',
        keys:{'meili-index-test':new Uint8Array(32).fill(19)}});
      const remote=new Map(),tasks=new Map(),outbound=[];
      let nextTask=0,processingOnce=true,staleHit=false,throwNextPost=false;
      const fetcher=async(url,init)=>{
        const target=new URL(String(url)),parts=target.pathname.split('/').filter(Boolean);
        outbound.push({path:target.pathname,method:init.method,body:init.body});
        if(init.method==='POST'){
          if(throwNextPost){throwNextPost=false;throw new Error('synthetic lost acknowledgement');}
          const indexUid=parts[1],deleting=parts.at(-1)==='delete-batch',body=JSON.parse(init.body);
          const documents=remote.get(indexUid)??new Map();
          if(deleting)for(const id of body)documents.delete(id);
          else for(const document of body)documents.set(document.id,document);
          remote.set(indexUid,documents);
          const taskUid=++nextTask,type=deleting?'documentDeletion':'documentAdditionOrUpdate';
          tasks.set(taskUid,{indexUid,type});
          return Response.json({taskUid,indexUid,status:'enqueued',type},{status:202});
        }
        if(parts[0]==='tasks'){
          const uid=Number(parts[1]),task=tasks.get(uid);
          return Response.json({uid,indexUid:task.indexUid,type:task.type,
            status:processingOnce?(processingOnce=false,'processing'):'succeeded',
            error:{private:'never-return'}});
        }
        if(parts.at(-1)==='search'){
          const indexUid=parts[1],limit=Number(target.searchParams.get('limit')),
            offset=Number(target.searchParams.get('offset'));
          const ids=[...(remote.get(indexUid)?.keys()??[])];
          if(staleHit&&!ids.includes('visible'))ids.push('visible');
          return Response.json({hits:ids.slice(offset,offset+limit).map(id=>({id,secret:'hidden'})),
            offset,limit,estimatedTotalHits:999,facetDistribution:{secret:{hidden:999}}});
        }
        throw new Error(`Unexpected synthetic Meili request ${target.pathname}`);
      };
      const engine=createOperationEngine({db,catalog:dataCatalog,registry:registry(),permissions:definitions,
        connectors:[{descriptor:meiliConnectorDescriptor,keyring,fetcher}],
        search:[{moduleId,sources}]});
      const invoke=(operationId,input,contextId='application')=>engine.invoke({
        credential:{kind:'session',token:admin.token},moduleId,operationId,contextId,audience:'admin',input});
      for(const contextId of ['application','other']){
        success(await invoke('config.set',{requestKey:`origin-${contextId}`,
          origin:'https://meili.example.invalid',enabled:false,revision:0},contextId));
        success(await invoke('config.key.set',{requestKey:`key-${contextId}`,
          apiKey:'example_meili_local_test_key',revision:1},contextId));
        success(await invoke('config.set',{requestKey:`enable-${contextId}`,
          origin:'https://meili.example.invalid',enabled:true,revision:2},contextId));
      }
      const command=async(name,state,contextId='application',key=`${name}-${contextId}-${state.revision}`)=>
        success(await invoke(name,{source:sourceId,revision:state.revision,requestKey:key},contextId)).index;
      let app=success(await invoke('index.read',{source:sourceId})).index;
      app=await command('index.rebuild.start',app);
      const appUid=app.building;
      app=await command('index.prepare',app);
      assert.equal(app.preparedCount,1,'draft is not sent as a searchable document');
      app=await command('index.emit',app,'application',app.emitKey);
      assert.equal(app.state,'waiting');
      const beforePoll=await db.prepare(`SELECT cursor FROM "${generated.tables.index_job}"
        WHERE context_id=? AND id=?`).bind('application',sourceId).first();
      assert.equal(beforePoll.cursor,null);
      app=await command('index.reconcile',app);
      assert.equal(app.state,'waiting','processing is not task success');
      app=await command('index.reconcile',app);
      assert.equal(app.state,'building');
      const afterPoll=await db.prepare(`SELECT cursor FROM "${generated.tables.index_job}"
        WHERE context_id=? AND id=?`).bind('application',sourceId).first();
      assert.ok(afterPoll.cursor,'cursor advances only after task success');
      app=await command('index.prepare',app);
      assert.equal(app.state,'ready');assert.equal(app.active,appUid);
      let other=success(await invoke('index.read',{source:sourceId},'other')).index;
      other=await command('index.rebuild.start',other,'other');
      const otherUid=other.building;
      assert.notEqual(otherUid,appUid,'context-scoped generations have different provider UIDs');
      other=await command('index.prepare',other,'other');
      other=await command('index.emit',other,'other',other.emitKey);
      other=await command('index.reconcile',other,'other');
      other=await command('index.prepare',other,'other');
      assert.equal(other.state,'ready');
      const query={source:sourceId,q:'Visible',limit:20,offset:0};
      const appResult=success(await invoke('index.search',query));
      const otherResult=success(await invoke('index.search',query,'other'));
      assert.deepEqual(appResult.items.map(item=>item.fields.name),['Visible application']);
      assert.deepEqual(otherResult.items.map(item=>item.fields.name),['Visible other']);
      assert.deepEqual(JSON.parse(JSON.stringify(appResult.facets)),
        [{field:'category_id',values:[{value:'category-a',count:1}]}]);
      assert.equal(appResult.pageCount,1);
      assert.doesNotMatch(JSON.stringify(appResult),/999|hidden|Secret draft/u);
      await db.prepare(`UPDATE "${catalogSchema.tables.product}" SET status='archived',revision=2,
        updated_at='2026-09-30T11:00:00.000Z' WHERE context_id='application' AND id='visible'`).run();
      app=await command('index.sync.start',app);
      app=await command('index.prepare',app);
      assert.equal(app.preparedCount,1);
      app=await command('index.emit',app,'application',app.emitKey);
      assert.equal(outbound.filter(item=>item.method==='POST').at(-1).path,
        `/indexes/${appUid}/documents/delete-batch`);
      const beforeDeleteReconcile=await db.prepare(`SELECT revision,state,pending_task_uid,
        pending_kind FROM "${generated.tables.index_job}" WHERE context_id=? AND id=?`)
        .bind('application',sourceId).first();
      assert.equal(beforeDeleteReconcile.revision,app.revision);
      app=await command('index.reconcile',app);
      app=await command('index.prepare',app);
      assert.equal(app.state,'ready');
      staleHit=true;
      const invisible=success(await invoke('index.search',query));
      assert.deepEqual(invisible.items,[]);
      assert.equal(invisible.pageCount,0);
      assert.deepEqual(JSON.parse(JSON.stringify(invisible.facets)),[{field:'category_id',values:[]}]);
      await insert('application','new','New product','published','2026-09-30T12:00:00.000Z');
      app=await command('index.sync.start',app);
      app=await command('index.prepare',app);
      const frozenKey=app.emitKey,attempts=outbound.filter(item=>item.method==='POST').length;
      throwNextPost=true;
      const unknown=await invoke('index.emit',{source:sourceId,revision:app.revision,
        requestKey:frozenKey});
      assert.equal(unknown.execution.state,'unknown');
      const replay=await invoke('index.emit',{source:sourceId,revision:app.revision,
        requestKey:frozenKey});
      assert.equal(replay.execution.state,'unknown');
      await failed(invoke('index.emit',{source:sourceId,revision:app.revision,
        requestKey:'different-key'}),'conflict');
      assert.equal(outbound.filter(item=>item.method==='POST').length,attempts+1,
        'unknown POST is never re-emitted');
      const current=good(await acl.readPolicy(admin.token)),revoked=structuredClone(current.policy);
      revoked.roles.find(role=>role.id==='projection-manager').permissionIds=
        revoked.roles.find(role=>role.id==='projection-manager').permissionIds.filter(id=>id!==`${catalogId}:view`);
      good(await acl.replacePolicy(admin.token,{expectedEpoch:current.epoch,policy:revoked}));
      await failed(invoke('index.search',query,'other'),'forbidden');
    }finally{await runtime.dispose();}
  });
