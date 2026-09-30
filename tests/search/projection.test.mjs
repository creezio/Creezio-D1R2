import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureSearchProjectionSource,compileSearchProjectionSources,createSearchProjectionHost,
  projectionIndexUid,sourceFromSearchContract}
  from '../../core/search/projection.ts';

const manifest=JSON.parse(readFileSync(new URL('../../extensions/common/catalog/module/manifest.json',import.meta.url)));
const catalog={schemaVersion:1,compositionDigest:'test',modules:[{moduleId:'creezio.catalog',version:'0.1.2',enabled:true,
  models:manifest.contracts.models.map(model=>({modelId:model.id,table:`catalog_${model.id}`,model})),
  permissions:manifest.contracts.permissions}]};
const source={id:'creezio.catalog:catalog-products',moduleId:'creezio.catalog',modelId:'product',permissionId:'view',
  projectionVersion:'1.0.0',orderIndexId:'by-updated',idField:'id',revisionField:'revision',
  visibilityField:'status',visibleValue:'published',fields:['id','name','description','category_id',
    'price_minor','currency','status','revision','updated_at'],facets:['category_id']};
const published={id:'p1',name:'Shown',description:'Description',category_id:null,price_minor:1299,
  currency:'EUR',status:'published',revision:3,updated_at:'2026-09-30T00:00:00.000Z'};
const archived={...published,id:'p2',status:'archived',revision:4,
  updated_at:'2026-09-30T00:00:01.000Z'};
function harness(rows=[published,archived]){
  const checks=[],reads=[];
  const data={async authorize(_credential,target,owner){checks.push({target,owner});return {kind:'data-lease'};},
    dispose(){},forModule(_lease,moduleId){assert.equal(moduleId,'creezio.catalog');return {
      async list(modelId,input){reads.push({modelId,input});const after=input.after;
        const eligible=after?rows.filter(row=>row.updated_at>after.updated_at
          ||row.updated_at===after.updated_at&&row.id>after.id):rows;
        const items=eligible.slice(0,input.limit);
        const nextAfter=eligible.length>input.limit?{updated_at:items.at(-1).updated_at,id:items.at(-1).id}:null;
        return {items,nextAfter};},
      async get(modelId,input){reads.push({modelId,input});return rows.find(row=>row.id===input.key.id)??null;}
    };}};
  const host=createSearchProjectionHost({data,catalog,sources:[source]});
  const scope={credential:{kind:'session',token:'test'},contextId:'application',audience:'app',
    actors:['user'],ensureActive(){}};
  return {port:host.port(scope),checks,reads};
}
test('compiled source permits only declared public catalog product fields and read permission',()=>{
  assert.deepEqual(captureSearchProjectionSource(source,catalog).fields,source.fields);
  assert.throws(()=>captureSearchProjectionSource({...source,fields:['object_key']},catalog));
  assert.throws(()=>captureSearchProjectionSource({...source,permissionId:'manage-unknown'},catalog));
  assert.throws(()=>captureSearchProjectionSource({...source,orderIndexId:'by-category'},catalog));
  const declaration={id:'catalog-products',model:{moduleId:'creezio.catalog',kind:'model',id:'product'},
    fields:source.fields,facets:['category_id'],permissions:[{moduleId:'creezio.catalog',kind:'permission',id:'view'}],
    context:'required',engine:'provider',provider:'meili.api.v1',projectionVersion:'1.0.0',
    projection:{orderIndexId:'by-updated',idField:'id',revisionField:'revision',
      visibilityField:'status',visibleValue:'published'},
    filterBeforeCount:true,resumable:true};
  assert.deepEqual(sourceFromSearchContract(declaration,catalog).fields,source.fields);
  assert.deepEqual(compileSearchProjectionSources(manifest.contracts.search,catalog),[source]);
  assert.throws(()=>compileSearchProjectionSources([declaration,declaration],catalog));
  assert.throws(()=>compileSearchProjectionSources([{...declaration,projection:null}],catalog));
  assert.throws(()=>sourceFromSearchContract({...declaration,filterBeforeCount:false},catalog));
  assert.throws(()=>sourceFromSearchContract({...declaration,facets:['object_key']},catalog));
});
test('context and generation produce stable isolated provider index UIDs',async()=>{
  const first=await projectionIndexUid(source,'context-a','g1');
  assert.match(first,/^cz_[a-f0-9]{48}$/u);
  assert.equal(first,await projectionIndexUid(source,'context-a','g1'));
  assert.notEqual(first,await projectionIndexUid(source,'context-b','g1'));
  assert.notEqual(first,await projectionIndexUid(source,'context-a','g2'));
  await assert.rejects(projectionIndexUid(source,'context-a','bad/path'));
});
test('page carries tombstone, bounded cursor and fresh owner permission; hits are re-read',async()=>{
  const {port,checks,reads}=harness();
  const first=await port.page({source:source.id,limit:1});
  assert.equal(first.items.length,1);assert.equal(first.items[0].fields.name,'Shown');
  assert.ok(first.nextCursor);
  assert.equal(first.afterEach[0],first.nextCursor);
  const second=await port.page({source:source.id,limit:1,cursor:first.nextCursor});
  assert.deepEqual(second.items,[{id:'p2',revision:4,deleted:true}]);
  assert.equal(second.nextCursor,null);
  assert.equal(second.afterEach.length,1);
  assert.deepEqual(await port.reauthorize({source:source.id,ids:['p1','p2','missing']}),
    [first.items[0]]);
  assert.ok(checks.every(({target,owner})=>target.contextId==='application'
    &&target.audience==='app'&&target.requiredPermissionIds.join(',')==='creezio.catalog:view'
    &&owner.moduleId==='creezio.catalog'));
  assert.equal(reads[0].input.order.indexId,'by-updated');
  assert.deepEqual(port.facets(source.id),['category_id']);
  await assert.rejects(port.page({source:source.id,limit:1,
    cursor:first.nextCursor.replace('application','other')}));
  await assert.rejects(port.page({source:source.id,limit:51}));
  await assert.rejects(port.reauthorize({source:source.id,ids:['p1','p1']}));
});
test('permission loss during source read suppresses the entire projected page',async()=>{
  let checks=0;
  const data={async authorize(){if(++checks===2)throw new Error('revoked');return {kind:'data-lease'};},
    dispose(){},forModule(){return {async list(){return {items:[published],nextAfter:null};}};}};
  const port=createSearchProjectionHost({data,catalog,sources:[source]}).port({
    credential:{kind:'session',token:'test'},contextId:'application',audience:'app',actors:['user'],ensureActive(){}});
  await assert.rejects(port.page({source:source.id,limit:1}),/revoked/u);
  assert.equal(checks,2);
});
test('same local search ID in two owners stays distinct and a custom key resumes correctly',async()=>{
  const secondModel=structuredClone(manifest.contracts.models.find(item=>item.id==='product'));
  secondModel.fields.find(field=>field.id==='id').id='uid';
  secondModel.primaryKey=['context_id','uid'];
  secondModel.indexes.find(index=>index.id==='by-updated').fields=['context_id','updated_at','uid'];
  secondModel.permissions=secondModel.permissions.map(ref=>({...ref,moduleId:'vendor.inventory'}));
  const secondPermission=structuredClone(manifest.contracts.permissions.find(item=>item.id==='view'));
  secondPermission.resources=secondPermission.resources.map(ref=>({...ref,moduleId:'vendor.inventory'}));
  const secondCatalog={...catalog,modules:[...catalog.modules,{moduleId:'vendor.inventory',version:'1.0.0',
    enabled:true,models:[{modelId:'product',table:'inventory_product',model:secondModel}],
    permissions:[secondPermission]}]};
  const first=manifest.contracts.search[0];
  const second={...first,model:{...first.model,moduleId:'vendor.inventory'},
    permissions:[{...first.permissions[0],moduleId:'vendor.inventory'}],
    projection:{...first.projection,idField:'uid'},fields:first.fields.map(id=>id==='id'?'uid':id)};
  const compiled=compileSearchProjectionSources([first,second],secondCatalog);
  assert.deepEqual(compiled.map(item=>item.id),
    ['creezio.catalog:catalog-products','vendor.inventory:catalog-products']);
  const calls=[],row={...published,uid:'v1'};delete row.id;
  const data={async authorize(){return {};},dispose(){},forModule(_lease,moduleId){
    assert.equal(moduleId,'vendor.inventory');return {async list(_model,options){calls.push(options);
      return {items:options.after?[]:[row],nextAfter:options.after?null:{updated_at:row.updated_at,uid:'v1'}};}};}};
  const port=createSearchProjectionHost({data,catalog:secondCatalog,sources:[compiled[1]]}).port({
    credential:{kind:'session',token:'test'},contextId:'application',audience:'app',
    actors:['user'],ensureActive(){}});
  const page=await port.page({source:compiled[1].id,limit:1});
  await port.page({source:compiled[1].id,limit:1,cursor:page.nextCursor});
  assert.equal(calls[1].after.uid,'v1');
  assert.equal(calls[1].after.id,undefined);
});
