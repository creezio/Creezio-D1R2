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
import {dispatchFileHttp} from '../../core/files/http.ts';
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
    policy.roles.push({id:'pages-editor',inherits:[],permissionIds:[`${moduleId}:edit`,`${moduleId}:view`,
      `${moduleId}:sidebar.read`],
      permissionOverrides:[]});
    policy.roles.push({id:'pages-sidebar-admin',inherits:['pages-editor'],
      permissionIds:[`${moduleId}:sidebar.manage`],permissionOverrides:[]});
    for(const principalId of [owner.principalId,machine.id])for(const audience of ['admin','app']){
      if(!policy.memberships.some(row=>row.principalId===principalId&&row.audience===audience
        &&row.contextId==='application'))policy.memberships.push({principalId,
          audience,contextId:'application',status:'active'});
      policy.assignments.push({principalId,audience,contextId:'application',
        roleId:audience==='admin'?'pages-sidebar-admin':'pages-editor'});
    }
    good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
    const appToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'Editorial app read',
      ttlMs:60000,scopes:[{contextId:'application',audience:'app',
        permissionIds:[`${moduleId}:view`,`${moduleId}:sidebar.read`]}]})).token;
    const adminToken=good(await machines.issueToken(admin.token,{principalId:machine.id,label:'Editorial admin edit',
      ttlMs:60000,scopes:[{contextId:'application',audience:'admin',
        permissionIds:[`${moduleId}:edit`,`${moduleId}:sidebar.manage`]}]})).token;
    const fileCatalog={compositionDigest:digest,categories:manifest.contracts.files.map(category=>({moduleId,
      category,audiences:['admin','app']}))};
    const registered=registry();
    const workspaceCatalog={compositionDigest:digest,views:[
      {id:`${moduleId}:editor`,surfaces:['workspace'],audiences:['admin'],
        permissions:[{moduleId,kind:'permission',id:'sidebar.manage'}]},
      {id:`${moduleId}:reader`,surfaces:['workspace'],audiences:['admin','app'],
        permissions:[{moduleId,kind:'permission',id:'sidebar.read'}]}],navigation:[
      {id:`${moduleId}:editor-link`,viewId:`${moduleId}:editor`,surfaces:['workspace'],audiences:['admin'],
        permissions:[{moduleId,kind:'permission',id:'sidebar.manage'}]},
      {id:`${moduleId}:reader-link`,viewId:`${moduleId}:reader`,surfaces:['workspace'],
        audiences:['admin','app'],permissions:[{moduleId,kind:'permission',id:'sidebar.read'}]}]};
    const workspaceNavigationCatalog={compositionDigest:digest,entries:[
      {id:`${moduleId}:editor-link`,moduleId,viewId:`${moduleId}:editor`,title:'Éditeur',
        order:10,route:'/editor',audiences:['admin'],permissionIds:[`${moduleId}:sidebar.manage`]},
      {id:`${moduleId}:reader-link`,moduleId,viewId:`${moduleId}:reader`,title:'Lecture',
        order:20,route:'/reader',audiences:['admin','app'],permissionIds:[`${moduleId}:sidebar.read`]}]};
    const engine=createOperationEngine({db,catalog,registry:registered,permissions,files:{catalog:fileCatalog,bucket},
      workspaceCatalog,workspaceNavigationCatalog});
    const invoke=(operationId,input,audience='admin')=>engine.invoke({credential:{kind:'session',
      token:audience==='admin'?admin.token:app.token},moduleId,operationId,contextId:'application',audience,input});
    const invokeMachine=(operationId,input,audience='app',token=appToken)=>engine.invoke({credential:{kind:'api-token',
      token},moduleId,operationId,contextId:'application',audience,input});
    const firstSidebar=output(await invoke('sidebar.catalog',{}));
    assert.deepEqual(firstSidebar.entries.map(entry=>entry.id),
      [`${moduleId}:editor-link`,`${moduleId}:reader-link`]);
    assert.equal(firstSidebar.entries[0].route,'/editor');
    const appSidebar=output(await invoke('sidebar.resolved',{},'app'));
    assert.deepEqual(appSidebar.items.map(item=>item.id),[`${moduleId}:reader-link`]);
    assert.match(appSidebar.sessionId,/^[a-f0-9-]{36}$/u);
    const savedSidebar=output(await invoke('sidebar.save',{requestKey:'sidebar-save-one',expectedRevision:0,
      edits:[{id:`${moduleId}:reader-link`,hidden:true,title:'Lecture adaptée',order:2}],resetIds:[]}));
    assert.equal(savedSidebar.revision,1);
    assert.deepEqual(output(await invoke('sidebar.resolved',{},'app')).items,[]);
    assert.deepEqual(output(await invokeMachine('sidebar.catalog',{},'admin',adminToken))
      .entries.map(entry=>entry.id),[`${moduleId}:editor-link`],
      'an admin token lacking the entry permission cannot inspect its route');
    await rejected(invokeMachine('sidebar.save',{requestKey:'sidebar-reset-no-entry-right',
      expectedRevision:1,edits:[],resetIds:[`${moduleId}:reader-link`]},'admin',adminToken),
    'invalid_input');
    await rejected(invoke('sidebar.save',{requestKey:'sidebar-stale',expectedRevision:0,
      edits:[],resetIds:[]}), 'conflict');
    await rejected(invoke('sidebar.save',{requestKey:'sidebar-forbidden',expectedRevision:1,
      edits:[],resetIds:[]},'app'),'forbidden');
    const sidebarRow=await db.prepare(`SELECT overrides FROM "${generated.tables.sidebar_overrides}"
      WHERE context_id=? AND id=?`).bind('application','workspace').first();
    assert.equal(JSON.stringify(sidebarRow).includes('/reader'),false);
    assert.equal(JSON.stringify(sidebarRow).includes('sidebar.read'),false);
    output(await invoke('sidebar.save',{requestKey:'sidebar-reset',expectedRevision:1,
      edits:[],resetIds:[`${moduleId}:reader-link`]}));
    assert.deepEqual(output(await invoke('sidebar.resolved',{},'app')).items.map(item=>item.title),['Lecture']);
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
    assert.equal(output(await invoke('page.visibility',{pageId:'home'})).visibility,'protected');
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${generated.tables.public_page}"`).first()).n,0,
      'the existing protected publish must not expose an anonymous page');
    assert.equal(output(await invoke('page.published.read',{pageId:'home'},'app')).page.title,'Accueil V1');
    const resolved=output(await invoke('page.published.resolve',{slug:'/'},'app'));
    assert.equal(resolved.pageId,'home');assert.equal(resolved.slug,'/');
    await rejected(invoke('page.published.resolve',{slug:'/machine'},'app'),'not_found');
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
    const sidebarHttp=await dispatch(request('/api/app/pages-navigation/sidebar/resolved',appToken));
    assert.equal(sidebarHttp.status,200,await sidebarHttp.clone().text());
    assert.deepEqual((await sidebarHttp.json()).execution.output.items.map(item=>item.id),
      [`${moduleId}:reader-link`]);
    const sidebarDenied=await dispatch(request('/api/admin/pages-navigation/sidebar/catalog',appToken));
    assert.equal(sidebarDenied.status,401);
    const resolvedHttp=await dispatch(request('/api/app/pages-navigation/page/published/resolve?slug=%2F',appToken));
    assert.equal(resolvedHttp.status,200,await resolvedHttp.clone().text());
    assert.equal((await resolvedHttp.json()).execution.output.pageId,'home');
    const wrongAudience=await dispatch(request('/api/admin/pages-navigation/page/read?page_id=home',appToken));
    assert.equal(wrongAudience.status,401);
    await rejected(invoke('page.read',{pageId:'home'},'app'),'forbidden');
    const changed=output(await invoke('page.save',{requestKey:'page-save-2',pageId:'home',revision:3,
      slug:'/',title:'Brouillon V2',...content})).page;
    assert.equal(changed.revision,4);
    assert.equal(output(await invoke('page.published.read',{pageId:'home'},'app')).page.title,'Accueil V1');
    assert.equal(output(await invoke('page.published.resolve',{slug:'/'},'app')).pageId,'home',
      'changing the draft does not change the published URL');
    const reset=output(await invoke('page.reset',{requestKey:'page-reset',pageId:'home',revision:4})).page;
    assert.equal(reset.title,'Accueil V1');
    assert.equal(output(await invoke('page.published.read',{pageId:'home'},'app')).page.title,'Accueil V1');
    const item={id:'home',label:'Accueil',href:'/',icon:'Home',group:'brand',order:0,hidden:false};
    const nav=output(await invoke('navigation.save',{requestKey:'nav-save',revision:0,items:[item]})).navigation;
    assert.equal(nav.revision,1);
    output(await invoke('navigation.publish',{requestKey:'nav-publish',revision:1}));
    assert.equal(output(await invoke('navigation.published',{},'app')).navigation.items[0].label,'Accueil');
    // Seed a bounded published catalog so the real engine spends 1 navigation read,
    // 100 indexed slug reads and 1 CAS patch at the declared maxItems boundary.
    const at='2026-09-28T00:00:00.000Z';
    const pageSql=`INSERT INTO "${generated.tables.page}" (context_id,created_at,draft_sections,draft_seo,
      draft_settings,id,published_at,published_revision,published_sections,published_seo,
      published_settings,published_slug,published_title,revision,slug,title,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const pages=Array.from({length:99},(_,index)=>{
      const slug=`/page-${index+1}`;
      return db.prepare(pageSql).bind('application',at,'[]','{}','{}',`bulk-${index+1}`,at,1,
        '[]','{}','{}',slug,`Page ${index+1}`,1,slug,`Page ${index+1}`,at);
    });
    await db.batch(pages);
    const linkedNavigation=[{...item,pageSlug:'/'},...Array.from({length:99},(_,index)=>({
      id:`bulk-${index+1}`,label:`Page ${index+1}`,href:`/page-${index+1}`,
      pageSlug:`/page-${index+1}`,icon:'',group:'',order:index+1,hidden:false}))];
    await db.prepare(`UPDATE "${generated.tables.navigation}" SET draft_items=?,revision=2
      WHERE context_id='application' AND id='primary'`).bind(JSON.stringify(linkedNavigation)).run();
    const fullNavigation=output(await invoke('navigation.publish',
      {requestKey:'nav-publish-boundary',revision:2})).navigation;
    assert.equal(fullNavigation.items.length,100);
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
    assert.deepEqual(output(await invoke('media.list',{pageId:'home',limit:50})).items.map(item=>item.fileId),
      [staged.fileId],'the declared page limit reserves one parent read plus 50 media reads');
    await rejected(invoke('media.list',{pageId:'home',limit:10},'app'),'forbidden');
    assert.deepEqual(output(await invoke('media.published.list',{pageId:'home'},'app')).items,[],
      'a draft upload is not part of the previous publication');
    const withImage={...content,sections:[{id:'hero',kind:'hero',position:0,enabled:true,
      content:{title:'Bienvenue',imageFileId:staged.fileId}}]};
    const edited=output(await invoke('page.save',{requestKey:'image-draft',pageId:'home',revision:6,
      slug:'/',title:'Accueil V1',...withImage})).page;
    const snapshot=output(await invoke('page.publish',{requestKey:'image-publish',pageId:'home',
      revision:edited.revision,visibility:'public'})).page;
    assert.equal(snapshot.sections[0].content.imageFileId,staged.fileId);
    const publicMarker=await db.prepare(`SELECT published_revision FROM "${generated.tables.public_page}"
      WHERE context_id=? AND page_id=?`).bind('application','home').first();
    assert.equal(publicMarker.published_revision,snapshot.publishedRevision);
    assert.equal(output(await invoke('page.visibility',{pageId:'home'})).slug,'/');
    assert.deepEqual(output(await invoke('media.published.list',{pageId:'home'},'app'))
      .items.map(item=>item.fileId),[staged.fileId]);
    const imageRequest=(reference,recordId='home',contextId='application')=>{
      const query=new URLSearchParams({...reference,recordId});
      return dispatchFileHttp(new Request(`${origin}/api/files/app/${moduleId}/media?${query}`,{
        headers:{authorization:`Bearer ${appToken}`,'x-creezio-context':contextId}}),
      {profile:'sites',bindings:{DB:db,BUCKET:bucket}},{CREEZIO_APP_ORIGIN:origin},
      'pages-image',{catalog,files:fileCatalog,permissions});
    };
    const shown=await imageRequest(staged);
    assert.equal(shown.status,200,await shown.clone().text());
    assert.deepEqual(new Uint8Array(await shown.arrayBuffer()),bytes);
    output(await invoke('media.link',{requestKey:'unpublished-page-media',pageId:'machine',revision:1,staged}));
    assert.equal((await imageRequest(staged,'machine')).status,404);
    assert.equal((await imageRequest({...staged,digest:'0'.repeat(64)})).status,404);
    assert.equal((await imageRequest(staged,'home','other-context')).status,401);
    const newer=await files.stage(lease,{ownerId,intentId:'draft-only',generation:'1',filename:'new.png',
      contentType:'image/png',bytes});
    const afterPublish=output(await invoke('page.read',{pageId:'home'})).page;
    output(await invoke('media.link',{requestKey:'new-draft-media',pageId:'home',
      revision:afterPublish.revision,staged:newer}));
    assert.deepEqual(output(await invoke('media.published.list',{pageId:'home'},'app'))
      .items.map(item=>item.fileId),[staged.fileId]);
    assert.equal((await imageRequest(newer)).status,404,'draft-only bytes remain private');
    const withNewMedia=output(await invoke('page.read',{pageId:'home'})).page;
    output(await invoke('media.unlink',{requestKey:'detach-draft-published',pageId:'home',
      revision:withNewMedia.revision,fileId:staged.fileId}));
    assert.equal((await imageRequest(staged)).status,200,
      'detaching a draft does not revoke its published snapshot');
    const beforeReset=output(await invoke('page.read',{pageId:'home'})).page;
    const restored=output(await invoke('page.reset',{requestKey:'restore-image',pageId:'home',
      revision:beforeReset.revision})).page;
    assert.equal(restored.sections[0].content.imageFileId,staged.fileId);
    assert.ok(output(await invoke('media.list',{pageId:'home',limit:10})).items
      .some(item=>item.fileId===staged.fileId),'reset restores the selected draft link without copying R2');
    const replacement=output(await invoke('page.save',{requestKey:'replace-image-draft',pageId:'home',
      revision:restored.revision,slug:'/',title:'Accueil V2',sections:[{...withImage.sections[0],
        content:{title:'Bienvenue',imageFileId:newer.fileId}}],settings:withImage.settings,seo:withImage.seo})).page;
    const race=await Promise.allSettled(['replace-image-a','replace-image-b'].map(requestKey=>
      invoke('page.publish',{requestKey,pageId:'home',revision:replacement.revision})));
    assert.equal(race.filter(result=>result.status==='fulfilled'&&result.value.execution?.state==='succeeded').length,1,
      'the same page revision may publish only one media snapshot');
    const receipts=await Promise.all(['replace-image-a','replace-image-b'].map(requestKey=>
      engine.lookup({credential:{kind:'session',token:admin.token},moduleId,operationId:'page.publish',
        contextId:'application',audience:'admin',requestKey})));
    assert.equal(receipts.filter(result=>result?.state==='succeeded').length,1,
      'unknown acknowledgements must be read by key, never replayed');
    assert.equal(await db.prepare(`SELECT page_id FROM "${generated.tables.public_page}"
      WHERE context_id=? AND page_id=?`).bind('application','home').first(),null,
      'a protected republish revokes the previous anonymous revision atomically');
    assert.equal(output(await invoke('page.visibility',{pageId:'home'})).visibility,'protected');
    assert.deepEqual(output(await invoke('media.published.list',{pageId:'home'},'app'))
      .items.map(item=>item.fileId),[newer.fileId]);
    assert.equal((await imageRequest(staged)).status,404,'replaced snapshot refuses the old reference');
    assert.equal((await imageRequest(newer)).status,200);
    const latest=good(await acl.readPolicy(admin.token)),revoked=structuredClone(latest.policy);
    revoked.assignments=revoked.assignments.filter(row=>row.principalId!==machine.id);
    good(await acl.replacePolicy(admin.token,{expectedEpoch:latest.epoch,policy:revoked}));
    await rejected(invokeMachine('page.published.read',{pageId:'home'}),'forbidden');
    const revokedHttp=await dispatch(request('/api/app/pages-navigation/page/published/read?page_id=home',appToken));
    assert.equal(revokedHttp.status,403);
  }finally{await runtime.dispose();}
});
