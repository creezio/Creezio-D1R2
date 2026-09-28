import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {createDataAccess} from '../../core/data/service.ts';
import {createFileService} from '../../core/files/service.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';
import * as handlers from '../../extensions/native/pages-navigation/module/operations.ts';

const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const manifest=json('../../extensions/native/pages-navigation/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'7'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(permission=>({id:`${moduleId}:${permission.id}`,
  audiences:permission.audiences,actors:permission.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
  version:manifest.identity.version,enabled:true,permissions:manifest.contracts.permissions,
  models:manifest.contracts.models.map(model=>({modelId:model.id,table:generated.tables[model.id],model}))}]};
function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},names=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]},
  validators,handlers:Object.fromEntries(manifest.contracts.operations.map(op=>[
    `${moduleId}:${op.id}`,handlers[op.handler.export]]))});
}
const good=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};
const output=result=>{assert.equal(result.execution?.state,'succeeded',JSON.stringify(result));return result.execution.output;};
const rejected=async(promise,code)=>{const result=await promise.catch(error=>error);
  assert.equal(result.code??result.execution?.errorCode,code,JSON.stringify(result));};

test('D1 operation engine keeps drafts, published snapshots and access boundaries',{timeout:90000},async()=>{
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-pages-navigation-integration'},r2Buckets:['BUCKET'],d1Persist:false,r2Persist:false});
  try{
    const db=await runtime.getD1Database('DB'),bucket=await runtime.getR2Bucket('BUCKET');
    await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
    const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
    const password='Synthetic pages-navigation integration password';
    const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'pages-owner@example.invalid',
      displayName:'Page owner',password}));
    const admin=good(await accounts.login({loginIdentifier:'pages-owner@example.invalid',password,audience:'admin'}));
    const app=good(await accounts.login({loginIdentifier:'pages-owner@example.invalid',password,audience:'app'}));
    const machines=createMachineAccountService(db,{permissions});
    const machine=good(await machines.createService(admin.token,{displayName:'Editorial API client'})).principal;
    const acl=createAuthorizationService(db,{permissions}),before=good(await acl.readPolicy(admin.token));
    const policy=structuredClone(before.policy);
    policy.roles.push({id:'pages-editor',inherits:[],permissionIds:[`${moduleId}:edit`,`${moduleId}:view`],
      permissionOverrides:[]});
    for(const principalId of [owner.principalId,machine.id])for(const audience of ['admin','app']){
      if(!policy.memberships.some(row=>row.principalId===principalId&&row.audience===audience
        &&row.contextId==='application'))policy.memberships.push({principalId,
          audience,contextId:'application',status:'active'});
      policy.assignments.push({principalId,audience,contextId:'application',roleId:'pages-editor'});
    }
    good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
    const appToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'Editorial app read',
      ttlMs:60000,scopes:[{contextId:'application',audience:'app',permissionIds:[`${moduleId}:view`]}]})).token;
    const adminToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'Editorial admin edit',
      ttlMs:60000,scopes:[{contextId:'application',audience:'admin',permissionIds:[`${moduleId}:edit`]}]})).token;
    const fileCatalog={compositionDigest:digest,categories:manifest.contracts.files.map(category=>({moduleId,
      category,audiences:['admin']}))};
    const registered=registry();
    const engine=createOperationEngine({db,catalog,registry:registered,permissions,files:{catalog:fileCatalog,bucket}});
    const invoke=(operationId,input,audience='admin')=>engine.invoke({credential:{kind:'session',
      token:audience==='admin'?admin.token:app.token},moduleId,operationId,contextId:'application',audience,input});
    const invokeMachine=(operationId,input,audience='app',token=appToken)=>engine.invoke({credential:{kind:'api-token',
      token},moduleId,operationId,contextId:'application',audience,input});
    const created=output(await invoke('page.create',{requestKey:'page-create',id:'home',slug:'/',title:'Accueil'})).page;
    assert.equal(created.revision,1);
    assert.equal(output(await invoke('page.create',{requestKey:'page-create',id:'home',slug:'/',title:'Accueil'})).page.id,'home');
    const content={sections:[{id:'hero',kind:'hero',position:0,enabled:true,content:{title:'Bienvenue'}}],
      settings:{brandName:'Creezio'},seo:{title:'Accueil'}};
    const saved=output(await invoke('page.save',{requestKey:'page-save',pageId:'home',revision:1,
      slug:'/',title:'Accueil V1',...content})).page;
    assert.equal(saved.revision,2);
    await rejected(invoke('page.save',{requestKey:'page-stale',pageId:'home',revision:1,
      slug:'/',title:'Perdu',...content}),'conflict');
    await rejected(invoke('page.published.read',{pageId:'home'},'app'),'not_found');
    const published=output(await invoke('page.publish',{requestKey:'page-publish',pageId:'home',revision:2})).page;
    assert.equal(published.title,'Accueil V1');
    assert.equal(output(await invoke('page.published.read',{pageId:'home'},'app')).page.title,'Accueil V1');
    assert.equal(output(await invoke('page.published.list',{limit:50},'app')).items[0].title,'Accueil V1');
    assert.equal(output(await invokeMachine('page.published.read',{pageId:'home'})).page.title,'Accueil V1');
    await rejected(invokeMachine('page.read',{pageId:'home'}),'forbidden');
    await rejected(invokeMachine('page.published.read',{pageId:'home'},'admin',appToken),'unauthorized');
    const machinePage=output(await invokeMachine('page.create',{requestKey:'machine-page',id:'machine',
      slug:'/machine',title:'Machine'},'admin',adminToken)).page;
    assert.equal(machinePage.id,'machine');
    const firstPage=output(await invoke('page.published.list',{limit:1},'app'));
    assert.deepEqual(firstPage.items,[]);
    assert.equal(typeof firstPage.nextCursor,'string');
    const secondPage=output(await invoke('page.published.list',{limit:1,cursor:firstPage.nextCursor},'app'));
    assert.equal(secondPage.items[0].id,'home');
    const bindings=compileHttpBindings({composition:{modules:[{moduleId,enabled:true}],
      exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}},modules:[manifest],
      operationCatalog:registered.catalog});
    const http=createOperationHttpTransport(bindings,engine),origin='https://pages.example.invalid';
    const request=(path,token)=>new Request(`${origin}${path}`,{headers:{authorization:`Bearer ${token}`,
      'x-creezio-context':'application'}});
    const dispatch=input=>http.dispatch(input,{profile:'sites',bindings:{DB:db,BUCKET:bucket}},
      {CREEZIO_APP_ORIGIN:origin},'pages-navigation-integration');
    const machineHttp=await dispatch(request('/api/app/pages-navigation/page/published/read?page_id=home',appToken));
    assert.equal(machineHttp.status,200,await machineHttp.clone().text());
    assert.equal((await machineHttp.json()).execution.output.page.title,'Accueil V1');
    const wrongAudience=await dispatch(request('/api/admin/pages-navigation/page/read?page_id=home',appToken));
    assert.equal(wrongAudience.status,401);
    await rejected(invoke('page.read',{pageId:'home'},'app'),'forbidden');
    const changed=output(await invoke('page.save',{requestKey:'page-save-2',pageId:'home',revision:3,
      slug:'/',title:'Brouillon V2',...content})).page;
    assert.equal(changed.revision,4);
    assert.equal(output(await invoke('page.published.read',{pageId:'home'},'app')).page.title,'Accueil V1');
    const reset=output(await invoke('page.reset',{requestKey:'page-reset',pageId:'home',revision:4})).page;
    assert.equal(reset.title,'Accueil V1');
    assert.equal(output(await invoke('page.published.read',{pageId:'home'},'app')).page.title,'Accueil V1');
    const item={id:'home',label:'Accueil',href:'/',icon:'Home',group:'brand',order:0,hidden:false};
    const nav=output(await invoke('navigation.save',{requestKey:'nav-save',revision:0,items:[item]})).navigation;
    assert.equal(nav.revision,1);
    output(await invoke('navigation.publish',{requestKey:'nav-publish',revision:1}));
    assert.equal(output(await invoke('navigation.published',{},'app')).navigation.items[0].label,'Accueil');
    const data=createDataAccess(db,{catalog,permissions});
    const lease=await data.authorize({kind:'session',token:admin.token},{contextId:'application',audience:'admin',
      actors:['user'],requiredPermissionIds:[`${moduleId}:edit`],purpose:'operation'},{moduleId});
    const category=manifest.contracts.files[0];
    const ownerId=await fileOwnerId(owner.principalId,'admin',category.ownerScope);
    const files=createFileService({data,catalog,moduleId,category,bucket,ownerId});
    const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9n8WcAAAAASUVORK5CYII=','base64'));
    const staged=await files.stage(lease,{ownerId,intentId:'page-logo',generation:'1',filename:'logo.png',
      contentType:'image/png',bytes});
    const linked=output(await invoke('media.link',{requestKey:'media-link',pageId:'home',revision:5,staged}));
    assert.equal(linked.media.fileId,staged.fileId);
    assert.equal(output(await invoke('media.list',{pageId:'home',limit:10})).items[0].fileId,staged.fileId);
    await rejected(invoke('media.list',{pageId:'home',limit:10},'app'),'forbidden');
    const detached=output(await invoke('media.unlink',{requestKey:'media-unlink',pageId:'home',revision:6,
      fileId:staged.fileId}));
    assert.equal(detached.removed,true);
    assert.deepEqual(output(await invoke('media.list',{pageId:'home',limit:10})).items,[]);
    const latest=good(await acl.readPolicy(admin.token)),revoked=structuredClone(latest.policy);
    revoked.assignments=revoked.assignments.filter(row=>row.principalId!==machine.id);
    good(await acl.replacePolicy(admin.token,{expectedEpoch:latest.epoch,policy:revoked}));
    await rejected(invokeMachine('page.published.read',{pageId:'home'}),'forbidden');
    const revokedHttp=await dispatch(request('/api/app/pages-navigation/page/published/read?page_id=home',appToken));
    assert.equal(revokedHttp.status,403);
  }finally{await runtime.dispose();}
});
