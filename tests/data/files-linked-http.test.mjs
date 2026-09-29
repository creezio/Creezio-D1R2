import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createDataAccess} from '../../core/data/service.ts';
import {dispatchFileHttp} from '../../core/files/http.ts';
import {createFileService} from '../../core/files/service.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';

const origin='http://127.0.0.1:8787',moduleId='creezio.catalog';
const read=url=>JSON.parse(readFileSync(new URL(url,import.meta.url),'utf8'));
const manifest=read('../../extensions/common/catalog/module/manifest.json');
const accessSchema=generateD1Schema('creezio.access',read('../../extensions/native/access/module/models.json'));
const ref=(kind,id)=>({moduleId,kind,id});
const policy={audiences:['app'],permission:ref('permission','view'),linkModel:ref('model','product_media'),
  parentRelation:'product',referenceFields:{fileId:'file_id',intentId:'intent_id',
    generation:'generation',digest:'digest'},when:{field:'status',equals:'published'}};
const category={...manifest.contracts.files[0],linkedRead:policy};
const models=structuredClone(manifest.contracts.models);
const metadataPermissions=models.find(item=>item.id==='file_metadata').permissions;
if(!metadataPermissions.some(item=>item.moduleId===moduleId&&item.kind==='permission'&&item.id==='view'))
  metadataPermissions.push(ref('permission','view'));
const definitions=structuredClone(manifest.contracts.permissions);
const viewResources=definitions.find(item=>item.id==='view').resources;
for(const addition of [ref('model','file_metadata'),ref('file','images')])
  if(!viewResources.some(item=>item.moduleId===addition.moduleId&&item.kind===addition.kind&&item.id===addition.id))
    viewResources.push(addition);
const schema=generateD1Schema(moduleId,models),digest=`sha256-${'6'.repeat(64)}`;
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:definitions,models:models.map(model=>({modelId:model.id,table:schema.tables[model.id],model}))}]};
const permissions=definitions.map(item=>({id:`${moduleId}:${item.id}`,audiences:item.audiences,actors:item.actors}));
const fileCatalog={compositionDigest:digest,categories:[{moduleId,category,audiences:['admin','app']}]};
const bytes=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9n8WcAAAAASUVORK5CYII=','base64'));
const ok=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const check=async(response,status,code)=>{assert.equal(response.status,status);
  if(code)assert.equal((await response.json()).error.code,code);return response;};

test('linked file GET reads only a published exact link for a different authorized principal',
  {timeout:90000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-linked-files'},r2Buckets:['BUCKET'],d1Persist:false,r2Persist:false});
    try{
      const db=await runtime.getD1Database('DB'),bucket=await runtime.getR2Bucket('BUCKET');
      await db.batch([...accessSchema.statements,...schema.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const owner=ok(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'linked-owner@example.invalid',
        displayName:'Owner',password:'Synthetic linked owner password'}));
      const admin=ok(await accounts.login({loginIdentifier:'linked-owner@example.invalid',
        password:'Synthetic linked owner password',audience:'admin'}));
      for(const id of ['manage','view'])await db.prepare(`INSERT INTO "${ACCESS_TABLES.role_grants}"
        (role_id,permission_id) VALUES (?,?)`).bind('administrator',`${moduleId}:${id}`).run();
      const acl=createAuthorizationService(db,{permissions}),initial=ok(await acl.readPolicy(admin.token));
      const lifecycle=createAccountLifecycleService(db,{permissions});
      const invitation=ok(await lifecycle.issueInvitation(admin.token,{loginIdentifier:'linked-peer@example.invalid',
        displayName:'Peer'}));
      const peer=ok(await lifecycle.redeem({token:invitation.token,purpose:'invitation',
        password:'Synthetic linked peer password'}));
      const access=structuredClone(initial.policy);
      access.roles.push({id:'catalog-image-reader',inherits:[],permissionIds:[`${moduleId}:view`],permissionOverrides:[]});
      access.memberships.push({principalId:peer.principalId,contextId:'application',audience:'app',status:'active'});
      access.assignments.push({principalId:peer.principalId,contextId:'application',audience:'app',roleId:'catalog-image-reader'});
      ok(await acl.replacePolicy(admin.token,{expectedEpoch:initial.epoch,policy:access}));
      const app=ok(await accounts.login({loginIdentifier:'linked-peer@example.invalid',
        password:'Synthetic linked peer password',audience:'app'}));
      const data=createDataAccess(db,{catalog,permissions});
      const lease=await data.authorize({kind:'session',token:admin.token},{contextId:'application',audience:'admin',
        actors:['user'],requiredPermissionIds:[`${moduleId}:manage`],purpose:'operation'},{moduleId});
      const ownerId=await fileOwnerId(owner.principalId,'admin',category.ownerScope);
      const files=createFileService({data,catalog,moduleId,category,bucket,ownerId});
      const staged=await files.stage(lease,{ownerId,intentId:'published-image',generation:'1',
        filename:'product.png',contentType:'image/png',bytes});
      await data.commitBatch(lease,[await files.publicationProof(lease,staged)]);
      const business=data.forModule(lease,moduleId),now='2026-09-29T00:00:00.000Z';
      const createProduct=async(id,status)=>business.create('product',{values:{id,sku:id,name:id,
        description:'',attributes:[],category_id:null,price_minor:1299,currency:'EUR',status,
        revision:1,created_at:now,updated_at:now}});
      await createProduct('published-one','published');await createProduct('draft-one','draft');
      await createProduct('archived-one','archived');
      const link=async productId=>business.create('product_media',{values:{product_id:productId,
        file_id:staged.fileId,filename:'product.png',content_type:'image/png',byte_size:bytes.length,
        digest:staged.digest,intent_id:staged.intentId,generation:staged.generation,created_at:now}});
      for(const id of ['published-one','draft-one','archived-one'])await link(id);
      const path=`${origin}/api/files/app/${moduleId}/images`;
      const query=(recordId,reference=staged)=>'?'+new URLSearchParams({...reference,...(recordId?{recordId}:{})});
      const request=(recordId,reference=staged,contextId='application',method='GET')=>new Request(path+query(recordId,reference),
        {method,headers:{cookie:`creezio-local-app=${app.token}`,'x-creezio-context':contextId,
          ...(method==='GET'?{}:{origin,'x-creezio-request':'1'})}});
      const dispatch=(value,usedBucket=bucket)=>dispatchFileHttp(value,{profile:'local',bindings:{DB:db,BUCKET:usedBucket}},
        {CREEZIO_APP_ORIGIN:origin},'linked-test',{catalog,files:fileCatalog,permissions});
      await check(await dispatch(request(null)),403,'forbidden');
      const good=await dispatch(request('published-one'));
      assert.equal(good.status,200);assert.deepEqual(new Uint8Array(await good.arrayBuffer()),bytes);
      assert.equal(good.headers.get('content-type'),'application/octet-stream');
      assert.equal(good.headers.get('cache-control'),'private, no-store');
      assert.match(good.headers.get('content-disposition'),/^attachment;/);
      const protectedCatalog=structuredClone(catalog);
      for(const entry of protectedCatalog.modules[0].models){
        const proofFields=entry.modelId==='product_media'
          ?['product_id','file_id','intent_id','generation','digest']
          :entry.modelId==='product'?['id','status']:[];
        for(const field of entry.model.fields)if(proofFields.includes(field.id))field.protected=true;
      }
      const protectedData=createDataAccess(db,{catalog:protectedCatalog,permissions});
      const protectedLease=await protectedData.authorize({kind:'session',token:app.token},
        {contextId:'application',audience:'app',actors:['user'],
          requiredPermissionIds:[`${moduleId}:view`],purpose:'operation'},{moduleId});
      assert.throws(()=>protectedData.forModule(protectedLease,moduleId).planGet('product',
        {key:{id:'published-one'},fields:['status']}),error=>error.code==='forbidden');
      protectedData.dispose(protectedLease);
      const protectedRead=await dispatchFileHttp(request('published-one'),
        {profile:'local',bindings:{DB:db,BUCKET:bucket}},{CREEZIO_APP_ORIGIN:origin},'protected-linked-test',
        {catalog:protectedCatalog,files:fileCatalog,permissions});
      assert.equal(protectedRead.status,200,'host proof can use protected fields without exposing them');
      assert.deepEqual(new Uint8Array(await protectedRead.arrayBuffer()),bytes);
      for(const id of ['draft-one','archived-one','missing-one'])
        await check(await dispatch(request(id)),404,'not_found');
      await check(await dispatch(request('published-one',{...staged,generation:'wrong'})),404,'not_found');
      await check(await dispatch(request('published-one',staged,'other')),403,'forbidden');
      await check(await dispatch(request('published-one',staged,'application','DELETE')),404,'not_found');
      let entered,release;
      const waiting=new Promise(resolve=>{entered=resolve;});
      const deferredBucket={get:async key=>{entered();await new Promise(resolve=>{release=resolve;});return bucket.get(key);},
        put:(...args)=>bucket.put(...args),delete:(...args)=>bucket.delete(...args)};
      const racing=dispatch(request('published-one'),deferredBucket);await waiting;
      await business.delete('product_media',{key:{product_id:'published-one',file_id:staged.fileId}});
      release();await check(await racing,404,'not_found');
      await check(await dispatch(request('published-one')),404,'not_found');
      await link('published-one');
      let enteredAgain,resumeAgain;
      const waitingAgain=new Promise(resolve=>{enteredAgain=resolve;});
      const deferredAgain={get:async key=>{enteredAgain();await new Promise(resolve=>{resumeAgain=resolve;});return bucket.get(key);},
        put:(...args)=>bucket.put(...args),delete:(...args)=>bucket.delete(...args)};
      const revokedRead=dispatch(request('published-one'),deferredAgain);await waitingAgain;
      const latest=ok(await acl.readPolicy(admin.token)),withoutPeer=structuredClone(latest.policy);
      withoutPeer.assignments=withoutPeer.assignments.filter(item=>item.principalId!==peer.principalId);
      ok(await acl.replacePolicy(admin.token,{expectedEpoch:latest.epoch,policy:withoutPeer}));
      resumeAgain();
      const revokedResponse=await revokedRead;
      assert.notEqual(revokedResponse.status,200,'a revoked reader must receive no bytes after R2 starts');
      await check(await dispatch(request('published-one')),403,'forbidden');
      data.dispose(lease);
    }finally{await runtime.dispose();}
  });
