import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';
import {attachmentList,conversationSearch,draftSave,messageList} from '../../module/service.ts';

test('conversation children retain context, owner and audience in their foreign keys',()=>{
  const models=JSON.parse(read('module/models.json'));
  assert.deepEqual(manifest.contracts.models,models);
  const parent=models.find(item=>item.id==='conversation');
  assert.deepEqual(parent.primaryKey,['context_id','owner_id','audience','id']);
  for(const child of models.filter(item=>['message','draft','turn','event','conversation_attachment'].includes(item.id))){
    const link=child.relations.find(item=>item.target.id==='conversation');
    assert.deepEqual(link.fields.slice(0,3),['context_id','owner_id','audience']);
    assert.deepEqual(link.targetFields,parent.primaryKey);
  }
  const ddl=generateD1Schema(manifest.identity.id,models).sql;
  assert.match(ddl,/FOREIGN KEY/);
  assert.match(ddl,/FOREIGN KEY \("context_id", "owner_id", "audience", "conversation_id"\)/);
});

test('search returns continuation when a bounded title page has no match',async()=>{
  const calls=[];
  const context={principalId:'alice',audience:'app',contextId:'application',
    data:{list:async(model,args)=>{calls.push({model,args});return {items:[{id:'one',title:'Sans résultat',mode:'chat',
      updated_at:'2026-09-27T00:00:00.000Z',archived_at:null,revision:1}],
      nextAfter:{owner_id:'alice',audience:'app',updated_at:'2026-09-27T00:00:00.000Z',id:'one'}};}}};
  const result=await conversationSearch({limit:1,query:'introuvable'},context);
  assert.deepEqual(result.output.items,[]);
  assert.equal(typeof result.output.nextCursor,'string');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].args.where,{owner_id:'alice',audience:'app'});
  assert.deepEqual(calls[0].args.order,{indexId:'recent',direction:'desc'});
});

test('draft save includes a fresh non-archived parent guard in its batch',async()=>{
  const planned=[];
  const context={principalId:'alice',audience:'admin',contextId:'application',
    data:{get:async model=>model==='conversation'?{id:'thread',title:'Thread',mode:'work',archived_at:null,revision:1}:null,
      planGet:(model,args)=>{planned.push({model,args});return {kind:'data-plan'};},
      planCreate:(model,args)=>{planned.push({model,args});return {kind:'data-plan'};}}};
  const result=await draftSave({requestKey:'one',conversationId:'thread',text:'brouillon',revision:0},context);
  assert.equal(result.plans.length,2);
  assert.equal(planned[0].model,'conversation');
  assert.deepEqual(planned[0].args.where,{archived_at:null});
  assert.deepEqual(planned[1].args.values.owner_id,'alice');
});

test('message pagination stays under the data result budget for maximal UTF-8 bodies',async()=>{
  const calls=[];
  const parent={id:'thread',title:'Thread',mode:'chat',archived_at:null,revision:1};
  const context={principalId:'alice',audience:'app',contextId:'application',data:{
    get:async()=>parent,
    list:async(_model,args)=>{calls.push(args);return {items:[],nextAfter:null};}}};
  await messageList({conversationId:'thread',limit:50},context);
  assert.equal(calls[0].limit,1);
  assert.deepEqual(calls[0].where,{owner_id:'alice',audience:'app',conversation_id:'thread'});
  assert.deepEqual(calls[0].order,{indexId:'chronology',direction:'desc'});
});

test('attachment list scopes rows and returns a reusable private file reference',async()=>{
  const calls=[];
  const context={principalId:'alice',audience:'admin',contextId:'application',data:{
    get:async()=>({id:'thread',revision:1,archived_at:null}),
    list:async(_model,args)=>{calls.push(args);return {items:[{conversation_id:'thread',file_id:'file-one',
      filename:'note.txt',content_type:'text/plain',byte_size:8,created_at:'2026-09-27T00:00:00.000Z',
      intent_id:'intent-one',generation:'generation-one',digest:'a'.repeat(64)}],nextAfter:null};}}};
  const result=await attachmentList({conversationId:'thread',limit:25},context);
  assert.deepEqual(calls[0].where,{owner_id:'alice',audience:'admin',conversation_id:'thread'});
  assert.deepEqual(calls[0].order,{indexId:'by-conversation',direction:'asc'});
  assert.deepEqual(result.output.items[0].reference,{fileId:'file-one',intentId:'intent-one',
    generation:'generation-one',digest:'a'.repeat(64)});
});
