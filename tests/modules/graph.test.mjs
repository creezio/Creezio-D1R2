import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogDetail} from '../../extensions/native/modules-settings/module/service.ts';

const origin=id=>`https://example.invalid/${id}`;
function module(id,dependencies=[]) {
  return {identity:{id,title:id,origin:origin(id),version:'1.0.0'},description:'Graph fixture',
    dependencies,contracts:{settings:[]}};
}
const edge=(moduleId,optional=false)=>({moduleId,origin:origin(moduleId),versionRange:'^1.0.0',optional});
function context(descriptors,{disabled=[],integrations={}}={}) {
  const selected={schemaVersion:'1.0.0',modules:descriptors.map(descriptor=>({
    moduleId:descriptor.identity.id,enabled:!disabled.includes(descriptor.identity.id),
    integrations:descriptor.dependencies.filter(item=>item.optional).map(item=>({moduleId:item.moduleId,
      enabled:integrations[`${descriptor.identity.id}:${item.moduleId}`]===true})),configuration:[]}))};
  return {hostInventory:{current:{composition:selected,lock:{},descriptors},
    inventory:{schemaVersion:1,candidates:[],digest:`sha256-${'0'.repeat(64)}`}}};
}
const detail=(moduleId,ctx)=>catalogDetail({moduleId},ctx).then(result=>result.output);

test('catalog detail preserves both diamond paths, inverse paths and inactive third-party optional integration',async()=>{
  const descriptors=[
    module('merchant.cart',[edge('merchant.catalogue'),edge('merchant.prices')]),
    module('merchant.catalogue',[edge('vendor.stock')]),
    module('merchant.prices',[edge('vendor.stock')]),
    module('vendor.stock',[edge('tiers.tax',true)]),
    module('tiers.tax'),
  ];
  const ctx=context(descriptors);
  const cart=await detail('merchant.cart',ctx);
  assert.deepEqual(cart.dependsOn.filter(item=>item.moduleId==='vendor.stock').map(item=>item.via),
    [['merchant.catalogue'],['merchant.prices']]);
  assert.deepEqual(cart.optionalIntegrations.filter(item=>item.moduleId==='tiers.tax')
    .map(item=>({via:item.via,required:item.required,active:item.active})),[
      {via:['merchant.catalogue','vendor.stock'],required:false,active:false},
      {via:['merchant.prices','vendor.stock'],required:false,active:false},
    ]);
  const stock=await detail('vendor.stock',ctx);
  assert.deepEqual(stock.usedBy.filter(item=>item.moduleId==='merchant.cart').map(item=>item.via),
    [['merchant.catalogue'],['merchant.prices']]);
  assert.ok(stock.usedBy.every(item=>item.required&&item.active));
});

test('catalog detail refuses an active dependency cycle instead of hiding its closing edge',async()=>{
  const ctx=context([module('cycle.a',[edge('cycle.b')]),module('cycle.b',[edge('cycle.a')])]);
  await assert.rejects(detail('cycle.a',ctx),{code:'unsupported'});
});

test('an inactive optional cycle remains visible once without making a valid graph fail',async()=>{
  const ctx=context([module('cycle.a',[edge('cycle.b',true)]),
    module('cycle.b',[edge('cycle.a')])]);
  const output=await detail('cycle.a',ctx);
  assert.deepEqual(output.optionalIntegrations.map(item=>({moduleId:item.moduleId,via:item.via,active:item.active})),[
    {moduleId:'cycle.b',via:[],active:false},
    {moduleId:'cycle.a',via:['cycle.b'],active:false},
  ]);
});

test('catalog detail refuses more than 256 distinct dependency paths without truncating',async()=>{
  const descriptors=[];
  for (let level=0;level<9;level++) for (const side of ['a','b']) {
    const id=`layer.${level}.${side}`;
    const dependencies=level===8?[]:['a','b'].map(next=>edge(`layer.${level+1}.${next}`));
    descriptors.push(module(id,dependencies));
  }
  const ctx=context(descriptors);
  await assert.rejects(detail('layer.0.a',ctx),{code:'unsupported'});
});
