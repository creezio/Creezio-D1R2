import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {generateD1Schema} from '../../../../../scripts/data/d1-schema.mjs';
import {attachmentList,conversationSearch,draftSave,messageList,widgetRenderRead,
  widgetContextReplace,widgetContextRead,turnStart} from '../../module/service.ts';

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

test('historical render query obtains only a scoped native message and never trusts a client execution pointer',async()=>{
  const stored={kind:'creezio.widget-message',schemaVersion:1,instances:[{instanceId:'instance_1'}]};
  const reads=[],calls=[];
  const context={principalId:'owner_1',audience:'app',contextId:'application',data:{
    get:async(model,args)=>{
      reads.push({model,args});
      return model==='conversation'?{id:'conversation_1',revision:1,archived_at:null}
        :{id:'message_1',role:'tool',content:stored};
    }},widgets:{readHistory:async(content,instanceId)=>{calls.push({content,instanceId});return {output:{id:'request_1'}};}}};
  const result=await widgetRenderRead({conversationId:'conversation_1',messageId:'message_1',
    instanceId:'instance_1',executionId:'client_forged',operationDigest:'client_forged'},context);
  assert.deepEqual(result,{output:{instanceId:'instance_1',output:{id:'request_1'}}});
  assert.deepEqual(reads.map(item=>item.args.key),[
    {owner_id:'owner_1',audience:'app',id:'conversation_1'},
    {owner_id:'owner_1',audience:'app',conversation_id:'conversation_1',id:'message_1'}]);
  assert.deepEqual(calls,[{content:stored,instanceId:'instance_1'}]);
  context.widgets.readHistory=async()=>null;
  await assert.rejects(widgetRenderRead({conversationId:'conversation_1',messageId:'message_1',instanceId:'instance_1'},context),
    {code:'not_found'});
  context.data.get=async model=>model==='conversation'?{id:'conversation_1'}:null;
  await assert.rejects(widgetRenderRead({conversationId:'conversation_1',messageId:'other',instanceId:'instance_1'},context),
    {code:'not_found'});
});

test('compatible historical context keeps the stored widget version across selection and the next turn',async()=>{
  for(const rendered of [true,false]){
    const instance={instanceId:'instance_1',instanceRevision:1,moduleId:'example.purchase',widgetId:'card',
      widgetVersion:'1.1.0',resourceUri:'ui://current',resourceDigest:'sha256-'+ 'b'.repeat(64),state:{},
      ...(rendered?{renderExecution:{moduleId:'example.purchase',operationId:'request.get',
        operationDigest:'sha256-'+'a'.repeat(64),executionId:'execution_1'}}:{})};
    const original={...instance,widgetVersion:'1.0.0',resourceUri:'ui://old'};
    const content={kind:'creezio.widget-message',schemaVersion:1,instances:[original]};
    const planned=[];
    let historyReads=0;
    const context={principalId:'owner_1',actorPrincipalId:'owner_1',audience:'app',contextId:'application',
      data:{get:async model=>model==='conversation'?{id:'conversation_1',archived_at:null}
        :model==='message'?{id:'message_1',role:'tool',content}:null,
      planGet:(model,args)=>{planned.push({model,args});return {kind:'guard'};},
      planCreate:(model,args)=>{planned.push({model,args});return {kind:'create'};}},
      widgets:{projectSnapshot:()=>null,projectHistory:()=>({kind:'creezio.widget-message',schemaVersion:1,instances:[instance]}),
        readHistory:async()=>{historyReads++;return {output:{id:'request_1'}};},
        contextValue:(_instance,_actionId,value)=>value,
        contextAction:()=>({namespace:'module-instance',expiresAfterSeconds:300,value:{selectedId:'request_1'}})}};
    await widgetContextReplace({conversationId:'conversation_1',messageId:'message_1',instanceId:'instance_1',
      instanceRevision:1,actionId:'select',expectedRevision:0,input:{selectedId:'request_1'}},context);
    assert.equal(planned.find(item=>item.model==='widget_context').args.values.widget_version,'1.0.0');
    assert.equal(historyReads,rendered?1:0);
    context.data.get=async model=>model==='conversation'?{id:'conversation_1'}
      :model==='message'?{id:'message_1',role:'tool',content}
      :{action_id:'select',message_id:'message_1',instance_id:'instance_1',revision:1,
        value:{selectedId:'request_1'},expires_at:'2026-09-28T23:00:00Z',removed_at:null};
    const read=await widgetContextRead({conversationId:'conversation_1',messageId:'message_1',
      instanceId:'instance_1',instanceRevision:1,actionId:'select'},context);
    assert.equal(read.output.context.instanceId,'instance_1');
    assert.equal(historyReads,rendered?2:0);
    context.providerAvailability={providerId:'openai.responses.v1',state:'ready',modelIds:['model_1']};
    context.data.get=async model=>model==='conversation'?{id:'conversation_1',revision:1,
      active_turn_id:null,archived_at:null}:model==='message'?{id:'message_1',role:'tool',content}:null;
    context.data.list=async()=>({items:[{instance_id:'instance_1',widget_module_id:'example.purchase',
      widget_id:'card',widget_version:'1.0.0',message_id:'message_1',action_id:'select',revision:1,
      value:{selectedId:'request_1'},expires_at:'2099-09-28T23:00:00Z',removed_at:null}],nextAfter:null});
    context.data.planPatch=(model,args)=>{planned.push({model,args});return {kind:'patch'};};
    await turnStart({conversationId:'conversation_1',messageId:'user_message_1',modelId:'model_1',
      body:'Continue',revision:1,draftRevision:0},context);
    assert.equal(planned.find(item=>item.model==='turn').args.values.widget_context_snapshot[0].widgetVersion,'1.0.0');
    // A renderer update can retire the action or narrow its retained fields. The
    // persisted row stays intact, but a fresh turn must not inject its stale value.
    planned.length=0;
    context.widgets.contextValue=()=>null;
    await turnStart({conversationId:'conversation_1',messageId:'user_message_2',modelId:'model_1',
      body:'Continue',revision:1,draftRevision:0},context);
    assert.deepEqual(planned.find(item=>item.model==='turn').args.values.widget_context_snapshot,[]);
  }
});
