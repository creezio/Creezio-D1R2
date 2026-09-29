import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {productSearch,productUpdate} from '../../module/service.ts';

function product(index){return {id:`p-${String(index).padStart(4,'0')}`,sku:`P-${String(index).padStart(4,'0')}`,
  name:`<script>${'&'.repeat(130)}</script> ${index}`,category_id:null,price_minor:index,
  currency:'EUR',status:index%3===0?'draft':'published',revision:1,
  updated_at:'2026-09-28T12:00:00.000Z'};}
function harness(rows){
  const calls=[];
  return {calls,context:{contextId:'context-one',audience:'app',data:{list:async(_model,options)=>{
    calls.push(options);const offset=options.after?rows.findIndex(row=>row.id===options.after.id)+1:0;
    const items=rows.slice(offset,offset+options.limit);return {items,
      nextAfter:offset+options.limit<rows.length?{updated_at:items.at(-1).updated_at,id:items.at(-1).id}:null};
  }}}};
}
test('D1 models and public port preserve context and integer prices',()=>{
  assert.deepEqual(manifest.contracts.models.filter(model=>['category','product','product_media'].includes(model.id))
    .map(model=>model.primaryKey[0]),['context_id','context_id','context_id']);
  assert.equal(manifest.contracts.publicContracts[0].id,'catalog.products');
  assert.equal(manifest.contracts.publicContracts[0].version,'1.0.0');
  const field=manifest.contracts.models.find(model=>model.id==='product').fields
    .find(field=>field.id==='price_minor');
  assert.equal(field.type,'integer');
  const metadata=manifest.contracts.models.find(model=>model.id==='file_metadata');
  assert.ok(metadata.fields.every(field=>field.protected));
  assert.ok(metadata.permissions.some(permission=>permission.id==='view'));
  const view=manifest.contracts.permissions.find(permission=>permission.id==='view');
  for(const resource of ['product','product_media','file_metadata'])
    assert.ok(view.resources.some(item=>item.kind==='model'&&item.id===resource),resource);
  assert.ok(view.resources.some(item=>item.kind==='file'&&item.id==='images'));
  const file=manifest.contracts.files.find(item=>item.id==='images');
  assert.deepEqual(file.permissions.map(item=>item.id),['manage']);
  assert.deepEqual(file.linkedRead,{audiences:['app'],
    permission:{moduleId:'creezio.catalog',kind:'permission',id:'view'},
    linkModel:{moduleId:'creezio.catalog',kind:'model',id:'product_media'},
    parentRelation:'product',referenceFields:{fileId:'file_id',intentId:'intent_id',
      generation:'generation',digest:'digest'},when:{field:'status',equals:'published'},
    mcpImage:{toolName:'catalog_linked_image_read',widgetIds:['product-list','product-detail']}});
});
test('published search pages through 520 escaped rows without loss or oversized output',async()=>{
  const rows=Array.from({length:520},(_,i)=>product(i));
  const {calls,context}=harness(rows),seen=[];
  let cursor=null;
  for(let page=0;page<30;page++){
    const result=await productSearch({limit:25,...(cursor?{cursor}:{})},context);
    seen.push(...result.output.items.map(item=>item.id));
    assert.ok(Buffer.byteLength(JSON.stringify(result.output))<65536);
    assert.ok(result.output.scanned<=500);
    cursor=result.output.nextCursor;
    if(!cursor)break;
  }
  assert.deepEqual(seen,rows.filter(row=>row.status==='published').map(row=>row.id));
  assert.equal(cursor,null);
  assert.ok(calls.every(call=>call.limit===50&&call.fields.length===9));
  const first=await productSearch({limit:1},context);
  await assert.rejects(productSearch({limit:1,cursor:first.output.nextCursor,query:'other'},context),
    {code:'invalid_input'});
  await assert.rejects(productSearch({limit:1,cursor:first.output.nextCursor},
    {...context,contextId:'context-two'}),{code:'invalid_input'});
});
test('product edit compares product and linked category revisions independently',async()=>{
  const old={...product(1),description:'',attributes:[]},category={id:'category-one',revision:9,archived_at:null};
  const plans=[];
  const context={data:{get:async(model)=>model==='product'?old:category,
    planGet:(model,input)=>({type:'get',model,input}),
    planPatch:(model,input)=>{plans.push({model,input});return {type:'patch',model,input};}}};
  const result=await productUpdate({id:old.id,revision:1,sku:old.sku,name:old.name,
    description:'',attributes:[],categoryId:category.id,priceMinor:123,currency:'EUR'},context);
  assert.equal(result.output.product.priceMinor,123);
  assert.deepEqual(plans.map(plan=>[plan.model,plan.input.compare.expected]),
    [['category',9],['product',1]]);
});
