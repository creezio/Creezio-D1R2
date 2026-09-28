import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';
import {catalogDetail} from '../../module/service.ts';
test('private module plans use one revision head and preserve historical decisions',()=>{
  const models=JSON.parse(read('module/models.json'));
  assert.deepEqual(models,manifest.contracts.models);
  assert.deepEqual(models.map(model=>model.id),['head','plans','journal','plan-outcomes']);
  assert.ok(models.every(model=>!model.public&&model.scope==='application'));
  assert.deepEqual(models.find(model=>model.id==='journal').primaryKey,['revision']);
  assert.ok(generateD1Schema(manifest.identity.id,models).sql.includes('CREATE TABLE'));
  const accept=manifest.contracts.operations.find(op=>op.id==='plans.accept');
  assert.deepEqual(accept.effects.writes.map(ref=>ref.id),['head','plans','journal']);
  assert.equal(accept.idempotency.mode,'required');
  for(const id of ['plans.confirm-publication','plans.cancel-pending']){
    const transition=manifest.contracts.operations.find(op=>op.id===id);
    assert.deepEqual(transition.effects.writes.map(ref=>ref.id),['head','plan-outcomes']);
    assert.equal(transition.idempotency.mode,'required');
    assert.deepEqual(transition.audiences,['admin']);
  }
  assert.equal(manifest.lifecycle.deactivation,'preserve-data');
});

test('provider-backed settings absent from composition stay unverified without hiding ordinary missing settings',async()=>{
  const setting=(id,provider)=>({id,required:true,...(provider?{provider}:{})});
  const descriptor=(moduleId,settings)=>({identity:{id:moduleId,title:moduleId,version:'1.0.0'},
    dependencies:[],contracts:{settings}});
  const descriptors=[descriptor('vendor.runtime',[setting('key','vendor.api')]),
    descriptor('vendor.plain',[setting('region')]),
    descriptor('vendor.mixed',[setting('key','vendor.api'),setting('region')]),
    descriptor('vendor.supplied',[setting('key','vendor.api')])];
  const selections=descriptors.map(item=>({moduleId:item.identity.id,enabled:true,
    configuration:item.identity.id==='vendor.supplied'
      ?[{setting:{id:'key'}}]:[],integrations:[]}));
  const context={hostInventory:{current:{composition:{modules:selections},lock:{},descriptors},
    inventory:{candidates:[]}}};
  const status=async moduleId=>(await catalogDetail({moduleId},context)).output.module;
  assert.deepEqual([await status('vendor.runtime'),await status('vendor.plain'),
    await status('vendor.mixed'),await status('vendor.supplied')].map(item=>
    [item.configuration,item.operational]),[
      ['unknown','unknown'],['missing','unavailable'],
      ['missing','unavailable'],['ready','unknown']]);
});
