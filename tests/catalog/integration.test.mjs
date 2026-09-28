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
import {createDataAccess} from '../../core/data/service.ts';
import {createFileService} from '../../core/files/service.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';
import * as handlers from '../../extensions/common/catalog/module/operations.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/common/catalog/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'5'.repeat(64)}`;
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
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,
    schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]},
  validators,handlers:Object.fromEntries(manifest.contracts.operations.map(op=>[
    `${moduleId}:${op.id}`,handlers[op.handler.export]]))});
}
const good=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};
const output=result=>{assert.equal(result.execution?.state,'succeeded',JSON.stringify(result));return result.execution.output;};
const rejected=async(promise,code)=>{const result=await promise.catch(error=>error);
  assert.notEqual(result.execution?.state,'succeeded',JSON.stringify(result));
  assert.equal(result.code??result.execution?.errorCode,code,JSON.stringify(result));};
const fields={sku:'CAT-001',name:'Produit témoin',description:'Produit de démonstration',
  attributes:[{key:'color',value:'blue'}],categoryId:null,priceMinor:12345,currency:'EUR'};

test('catalog D1/R2 engine preserves published visibility, CAS, context and media links',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-catalog-integration'},r2Buckets:['BUCKET'],d1Persist:false,r2Persist:false});
    let client=null;
    try{
      const db=await runtime.getD1Database('DB'),bucket=await runtime.getR2Bucket('BUCKET');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic catalog integration password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'catalog@example.invalid',
        displayName:'Catalog owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'catalog@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'catalog@example.invalid',password,audience:'app'}));
      for(const permission of ['manage','view'])await db.prepare(
        `INSERT INTO "${ACCESS_TABLES.role_grants}" (role_id,permission_id) VALUES (?,?)`)
        .bind('administrator',`${moduleId}:${permission}`).run();
      const acl=createAuthorizationService(db,{permissions}),before=good(await acl.readPolicy(admin.token));
      const policy=structuredClone(before.policy);
      policy.roles.push({id:'catalog-reader',inherits:[],permissionIds:[`${moduleId}:view`],permissionOverrides:[]});
      if(!policy.memberships.some(row=>row.principalId===owner.principalId&&row.audience==='app'
        &&row.contextId==='application'))policy.memberships.push({principalId:owner.principalId,
          audience:'app',contextId:'application',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'app',contextId:'application',
        roleId:'catalog-reader'});
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const fileCatalog={compositionDigest:digest,categories:manifest.contracts.files.map(category=>({moduleId,
        category,audiences:['admin']}))};
      const engine=createOperationEngine({db,catalog,registry:registry(),permissions,
        files:{catalog:fileCatalog,bucket}});
      const invoke=(operationId,input,audience='admin',contextId='application')=>engine.invoke({
        credential:{kind:'session',token:audience==='admin'?admin.token:app.token},moduleId,operationId,
        contextId,audience,input});
      const parent=output(await invoke('category.create',{requestKey:'parent',name:'Maison',slug:'maison',
        position:0,parentId:null})).category;
      const child=output(await invoke('category.create',{requestKey:'child',name:'Cuisine',slug:'cuisine',
        position:1,parentId:parent.id})).category;
      assert.equal(child.parentId,parent.id);
      await rejected(invoke('category.create',{requestKey:'too-deep',name:'Desserts',slug:'desserts',
        position:2,parentId:child.id}),'conflict');
      const product=output(await invoke('product.create',{requestKey:'product',...fields,
        categoryId:child.id})).product;
      assert.equal(product.priceMinor,12345);
      assert.equal(product.currency,'EUR');
      await rejected(invoke('product.get',{id:product.id},'app'),'not_found');
      assert.deepEqual(output(await invoke('product.search',{limit:25},'app')).items,[]);
      await rejected(invoke('product.read',{id:product.id},'app'),'forbidden');
      await rejected(invoke('category.archive',{requestKey:'archive-child',id:child.id,
        revision:child.revision+1}),'conflict');
      const categoryAfterLink=output(await invoke('category.list',{limit:50})).items
        .find(item=>item.id===child.id);
      assert.equal(categoryAfterLink.revision,child.revision+1);
      await rejected(invoke('category.archive',{requestKey:'archive-linked',id:child.id,
        revision:categoryAfterLink.revision}),'conflict');
      await rejected(invoke('product.update',{requestKey:'stale',id:product.id,revision:2,
        ...fields}),'conflict');
      const published=output(await invoke('product.publish',{requestKey:'publish',id:product.id,
        revision:1})).product;
      assert.equal(published.status,'published');
      assert.equal(output(await invoke('product.get',{id:product.id},'app')).product.priceMinor,12345);
      const searched=output(await invoke('product.search',{limit:25,query:'cat-001'},'app'));
      assert.deepEqual(searched.items.map(item=>item.id),[product.id]);
      assert.equal(searched.nextCursor,null);
      const machines=createMachineAccountService(db,{permissions});
      const machine=(await machines.createService(admin.token,{displayName:'Catalog reader'})).principal;
      const existing=await acl.readPolicy(admin.token),machinePolicy=structuredClone(existing.policy);
      machinePolicy.roles.push({id:'catalog-machine-view',inherits:[],
        permissionIds:[`${moduleId}:view`],permissionOverrides:[]});
      machinePolicy.memberships.push({principalId:machine.id,audience:'app',
        contextId:'application',status:'active'});
      machinePolicy.assignments.push({principalId:machine.id,audience:'app',
        contextId:'application',roleId:'catalog-machine-view'});
      good(await acl.replacePolicy(admin.token,{expectedEpoch:existing.epoch,policy:machinePolicy}));
      const issued=await machines.issueToken(admin.token,{principalId:machine.id,
        label:'Catalog wire',ttlMs:60000,scopes:[{contextId:'application',audience:'app',
          permissionIds:[`${moduleId}:view`]}]});
      assert.equal(issued.ok,true,JSON.stringify(issued));
      const token=issued.token,registered=registry(),origin='https://catalog.example.invalid';
      const http=createOperationHttpTransport(compileHttpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog}),engine);
      const wire=(path)=>http.dispatch(new Request(origin+path,{headers:{authorization:`Bearer ${token}`,
        'x-creezio-context':'application'}}),{profile:'sites',bindings:{DB:db}},
        {CREEZIO_APP_ORIGIN:origin},'catalog-http');
      const response=await wire(`/api/app/catalog/product/get?id=${product.id}`);
      assert.equal(response.status,200,await response.clone().text());
      assert.equal(output(await response.json()).product.id,product.id);
      assert.equal(await wire('/api/app/catalog/product/list?limit=25'),null);
      const widgetCatalog=compileWidgetCatalog({composition,modules:[manifest],
        operationCatalog:registered.catalog,
        readAsset:(_id,relative)=>readFileSync(new URL(`../../extensions/common/catalog/${relative}`,
          import.meta.url),'utf8'),
        bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(
          `../../extensions/common/catalog/${reference.path}`,import.meta.url))],bundle:true,
          write:false,platform:'browser',format:'iife',globalName:'__creezioWidget',target:'es2022',
          minify:true,
          footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
      assert.equal(widgetCatalog.widgets.length,2);
      const mcp=createMcpHttpTransport(compileMcpBindings({composition,modules:[manifest],
        operationCatalog:registered.catalog,widgetCatalog}),registered,engine,{origin,
        resourceMetadataUrl:audience=>`${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
        authenticate:async(request,audience)=>{
          const bearer=request.headers.get('authorization')?.replace(/^Bearer /u,'');
          const checked=await machines.check(bearer,{contextId:'application',audience,
            actors:['machine'],requiredPermissionIds:[`${moduleId}:view`],purpose:'operation'});
          return checked.allowed?{credential:{kind:'api-token',token:bearer},contextId:'application'}:null;
        },canDiscover:async(identity,target)=>(await machines.check(identity.credential.token,{
          contextId:target.contextId,audience:target.audience,actors:target.actors,
          requiredPermissionIds:target.permissionIds,purpose:'operation'})).allowed});
      client=new Client({name:'catalog-native-transport',version:'1.0.0'});
      await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp/app'),{
        authProvider:{token:async()=>token},fetch:(input,init)=>mcp.dispatch(new Request(input,init),
          'app','catalog-mcp')}));
      const tools=(await client.listTools()).tools;
      assert.ok(tools.some(tool=>tool.name==='catalog_product_search'));
      assert.ok(!tools.some(tool=>tool.name==='catalog_product_list'));
      const listed=await client.callTool({name:'catalog_product_search',arguments:{limit:25}});
      assert.equal(listed.structuredContent.kind,'creezio.widget.render.v1');
      assert.deepEqual(listed.structuredContent.input.items.map(item=>item.id),[product.id]);
      const latest=await acl.readPolicy(admin.token),revoked=structuredClone(latest.policy);
      revoked.assignments=revoked.assignments.filter(item=>item.principalId!==machine.id);
      good(await acl.replacePolicy(admin.token,{expectedEpoch:latest.epoch,policy:revoked}));
      assert.equal((await wire('/api/app/catalog/product/search?limit=25')).status,403);
      await assert.rejects(client.callTool({name:'catalog_product_search',arguments:{limit:25}}));
      await rejected(invoke('product.get',{id:product.id},'app','other-context'),'forbidden');
      const data=createDataAccess(db,{catalog,permissions});
      const lease=await data.authorize({kind:'session',token:admin.token},{contextId:'application',
        audience:'admin',actors:['user'],requiredPermissionIds:[`${moduleId}:manage`],
        purpose:'operation'},{moduleId});
      const category=manifest.contracts.files[0];
      const ownerId=await fileOwnerId(owner.principalId,'admin',category.ownerScope);
      const files=createFileService({data,catalog,moduleId,category,bucket,ownerId});
      const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9n8WcAAAAASUVORK5CYII=','base64'));
      const staged=await files.stage(lease,{ownerId,intentId:'catalog-image',generation:'1',
        filename:'item.png',contentType:'image/png',bytes});
      const linked=output(await invoke('media.link',{requestKey:'media-link',productId:product.id,
        revision:2,staged}));
      assert.equal(linked.media.fileId,staged.fileId);
      assert.equal(output(await invoke('media.list',{productId:product.id},'app')).items[0].fileId,staged.fileId);
      await rejected(invoke('media.link',{requestKey:'media-stale',productId:product.id,
        revision:2,staged}),'conflict');
      const unlinked=output(await invoke('media.unlink',{requestKey:'media-unlink',productId:product.id,
        revision:3,fileId:staged.fileId}));
      assert.equal(unlinked.removed,true);
      assert.deepEqual(output(await invoke('media.list',{productId:product.id},'app')).items,[]);
      const archived=output(await invoke('product.archive',{requestKey:'archive',id:product.id,
        revision:4})).product;
      assert.equal(archived.status,'archived');
      await rejected(invoke('product.get',{id:product.id},'app'),'not_found');
      assert.deepEqual(output(await invoke('product.search',{limit:25},'app')).items,[]);
      await rejected(invoke('media.list',{productId:product.id},'app'),'not_found');
      const seed=Array.from({length:520},(_,index)=>{
        const number=String(index).padStart(4,'0');
        return db.prepare(`INSERT INTO "${generated.tables.product}"
          (context_id,id,sku,name,description,attributes,category_id,price_minor,currency,status,
          revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('application',
          `seed-${number}`,`SEED-${number}`,index===0?`needle-unique ${'&<'.repeat(60)}`:
            `Escaped ${'&<'.repeat(60)} ${number}`,'','[]',null,index,'EUR','published',1,
          '2026-01-01T00:00:00.000Z',index===0?'2026-01-01T00:00:00.000Z':
            '2026-01-02T00:00:00.000Z');
      });
      await db.batch(seed);
      const far=output(await invoke('product.search',{limit:25,query:'needle-unique'},'app'));
      assert.equal(far.scanned,500);
      assert.equal(far.complete,false);
      assert.deepEqual(far.items,[]);
      assert.ok(far.nextCursor);
      const tail=output(await invoke('product.search',{limit:25,query:'needle-unique',
        cursor:far.nextCursor},'app'));
      assert.deepEqual(tail.items.map(item=>item.sku),['SEED-0000']);
      assert.equal(tail.complete,true);
      assert.ok(Buffer.byteLength(JSON.stringify(tail))<65536);
      const raw=await db.prepare(`SELECT price_minor,category_id,status FROM "${generated.tables.product}"
        WHERE context_id=? AND id=?`).bind('application',product.id).first();
      assert.equal(raw.price_minor,12345);
      assert.equal(raw.status,'archived');
    }finally{if(client)await client.close();await runtime.dispose();}
  });
