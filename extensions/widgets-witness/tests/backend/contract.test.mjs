import test from 'node:test';
import assert from 'node:assert/strict';
import {read_record,rename_record} from '../../module/operations.ts';
/** Only a caller-owned authorized synthetic DataPort can seed demo rows. */
async function seedWitnessRecords(port){
  if(!port||typeof port.create!=='function')throw new TypeError('Authorized DataPort required');
  for(const [id,title] of [['alpha','Fiche Alpha'],['beta','Fiche Bêta']])
    await port.create('record',{values:{id,title,revision:0}});
}

test('read handler uses only the bounded DataPort',async()=>{
  const calls=[];
  const data={get:async (model,query)=>{calls.push([model,query]);return {id:'alpha',title:'Alpha',revision:0};}};
  assert.deepEqual(await read_record({id:'alpha'},{data}),{output:{id:'alpha',title:'Alpha',revision:0}});
  assert.deepEqual(calls,[['record',{key:{id:'alpha'}}]]);
});

test('rename emits a versioned plan, without direct SQL or immediate write',()=>{
  let plan;
  const data={planPatch:(model,input)=>{plan={model,input};return {kind:'synthetic-plan'};}};
  const result=rename_record({id:'beta',title:'New title',revision:3,request_key:'k'}, {data});
  assert.deepEqual(result.output,{id:'beta',title:'New title',revision:4});
  assert.deepEqual(plan,{model:'record',input:{key:{id:'beta'},values:{title:'New title'},
    compare:{field:'revision',expected:3}}});
  assert.deepEqual(result.plans,[{kind:'synthetic-plan'}]);
});

test('synthetic seed creates exactly two records through a caller-owned authorized port',async()=>{
  const created=[];
  await seedWitnessRecords({create:async(model,input)=>created.push({model,input})});
  assert.deepEqual(created.map(entry=>entry.input.values.id),['alpha','beta']);
  assert.ok(created.every(entry=>entry.model==='record'&&entry.input.values.revision===0));
  await assert.rejects(seedWitnessRecords({}),TypeError);
});
