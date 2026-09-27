import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationsController} from '../../sdk/conversations/controller.ts';

const summary=(id,title=id)=>({id,title,mode:'chat',updatedAt:'2026-09-27T00:00:00.000Z',archivedAt:null,revision:1});
const message=id=>({id,conversationId:'thread',role:'user',body:id,createdAt:'2026-09-27T00:00:00.000Z',revision:1});
const execution=output=>({kind:'execution',execution:{id:'execution',state:'succeeded',output,errorCode:null}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function access(){
  let state={phase:'authenticated',session:{id:'session',principalId:'alice',audience:'app'},pending:null};
  const listeners=new Set();
  return {audience:'app',origin:'http://localhost',getSnapshot:()=>state,
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    refresh:async()=>{},set(next){state=next;for(const listener of listeners)listener();}};
}

test('old search and old selected conversation cannot replace newer responses',async()=>{
  const a=access(), first=deferred(), selected=deferred();
  let searches=0;
  const client={invoke:({bindingId,input})=>{
    if(bindingId.endsWith('conversation.search'))return ++searches===1?first.promise:
      Promise.resolve(execution({items:[summary('fresh')],nextCursor:null}));
    if(bindingId.endsWith('conversation.read'))return input.conversationId==='old'?selected.promise:
      Promise.resolve(execution({conversation:summary('new'),provider:'no_provider'}));
    if(bindingId.endsWith('message.list'))return Promise.resolve(execution({items:[],nextCursor:null}));
    if(bindingId.endsWith('draft.read'))return Promise.resolve(execution({conversationId:input.conversationId,text:'',updatedAt:null,revision:0}));
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  const oldSearch=controller.search({query:'old'}),newSearch=controller.search({query:'new'});
  await newSearch;
  first.resolve(execution({items:[summary('stale')],nextCursor:null}));await oldSearch;
  assert.deepEqual(controller.getSnapshot().conversations.map(item=>item.id),['fresh']);
  const oldOpen=controller.open('old'),newOpen=controller.open('new');await newOpen;
  selected.resolve(execution({conversation:summary('old'),provider:'no_provider'}));await oldOpen;
  assert.equal(controller.getSnapshot().selected.id,'new');
  controller.dispose();
});

test('draft edits during save survive with the fresh server revision',async()=>{
  const a=access(), save=deferred();
  const client={invoke:({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return Promise.resolve(execution({conversation:summary('thread'),provider:'no_provider'}));
    if(bindingId.endsWith('message.list'))return Promise.resolve(execution({items:[],nextCursor:null}));
    if(bindingId.endsWith('draft.read'))return Promise.resolve(execution({conversationId:'thread',text:'',updatedAt:null,revision:0}));
    if(bindingId.endsWith('draft.save')){assert.equal(input.text,'old');return save.promise;}
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');controller.setDraft('thread','old');
  const pending=controller.saveDraft('thread');controller.setDraft('thread','new');
  save.resolve(execution({conversationId:'thread',text:'old',updatedAt:'2026-09-27T00:00:00.000Z',revision:1}));
  assert.equal((await pending).kind,'ok');
  assert.equal(controller.getSnapshot().draft.text,'new');
  assert.equal(controller.getSnapshot().draft.revision,1);
  controller.dispose();
});

test('unknown command blocks replay and inactive panels cannot issue operations',async()=>{
  const a=access();let calls=0;
  const client={invoke:async()=>{calls++;return {kind:'unknown',code:'outcome_unknown'};},
    status:async()=>execution({conversation:summary('resolved')})};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  assert.equal((await controller.create({mode:'chat'})).kind,'unknown');
  const second=await controller.create({mode:'chat'});
  assert.deepEqual(second,{kind:'rejected',code:'pending_resolution'});
  assert.equal(calls,1);
  await controller.reconcileUnknown();
  assert.equal(controller.getSnapshot().unknown,null);
  const callsAfterReconciliation=calls;
  controller.setActive(false);
  assert.equal((await controller.create({mode:'chat'})).kind,'rejected');
  assert.equal(calls,callsAfterReconciliation);
  controller.dispose();
});

test('selected conversation is restored only after a scoped server read and cleared on logout',async()=>{
  const previous=globalThis.sessionStorage,values=new Map();
  globalThis.sessionStorage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,
    getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  try{
    const a=access();let reads=0;
    const client={invoke:async({bindingId,input})=>{
      if(bindingId.endsWith('conversation.read')){reads++;return execution({conversation:summary(input.conversationId),provider:'no_provider'});}
      if(bindingId.endsWith('message.list'))return execution({items:[],nextCursor:null});
      if(bindingId.endsWith('draft.read'))return execution({conversationId:input.conversationId,text:'',updatedAt:null,revision:0});
      throw new Error(bindingId);
    }};
    const first=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
    await first.open('remembered');first.dispose();
    const second=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(second.getSnapshot().selected?.id,'remembered');
    assert.equal(reads,2);
    a.set({phase:'anonymous',session:null,pending:null});
    assert.equal(second.getSnapshot().selected,null);
    assert.equal(values.size,0);
    second.dispose();
  }finally{if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous;}
});

test('message pages open on the newest messages and prepend older messages once',async()=>{
  const a=access(), pages=[
    {items:[message('m4'),message('m3')],nextCursor:'older-1'},
    {items:[message('m3'),message('m2')],nextCursor:'older-2'},
    {items:[message('m1')],nextCursor:null}];
  const client={invoke:async({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:summary('thread'),provider:'no_provider'});
    if(bindingId.endsWith('message.list'))return execution(pages[input.cursor==='older-2'?2:input.cursor==='older-1'?1:0]);
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:'',updatedAt:null,revision:0});
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),['m3','m4']);
  await controller.loadMoreMessages();
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),['m2','m3','m4']);
  await controller.loadMoreMessages();
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),['m1','m2','m3','m4']);
  assert.equal(controller.getSnapshot().messagesNextCursor,null);
  controller.dispose();
});

test('confirmed lost message response reloads recent messages and conversation revision without replay',async()=>{
  const a=access();let messageAdds=0,revision=1,stored=[];
  const client={invoke:async({bindingId})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:{...summary('thread'),revision},provider:'no_provider'});
    if(bindingId.endsWith('conversation.list'))return execution({items:[{...summary('thread'),revision}],nextCursor:null});
    if(bindingId.endsWith('message.list'))return execution({items:[...stored].reverse(),nextCursor:null});
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:'',updatedAt:null,revision:0});
    if(bindingId.endsWith('message.add')){messageAdds++;stored=[message('persisted')];revision=2;
      return {kind:'unknown',code:'outcome_unknown'};}
    throw new Error(bindingId);
  },status:async()=>execution({message:message('persisted')})};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');
  assert.equal((await controller.addMessage('thread','persisted')).kind,'unknown');
  await controller.reconcileUnknown();
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),['persisted']);
  assert.equal(controller.getSnapshot().selected.revision,2);
  assert.equal(messageAdds,1);
  controller.dispose();
});

test('confirmed lost draft response reloads server revision and keeps a newer local edit',async()=>{
  const a=access();let draftWrites=0,revision=0,text='';
  const client={invoke:async({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:summary('thread'),provider:'no_provider'});
    if(bindingId.endsWith('conversation.list'))return execution({items:[summary('thread')],nextCursor:null});
    if(bindingId.endsWith('message.list'))return execution({items:[],nextCursor:null});
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text,updatedAt:null,revision});
    if(bindingId.endsWith('draft.save')){draftWrites++;assert.equal(input.revision,revision);
      text=input.text;revision++;return draftWrites===1?{kind:'unknown',code:'outcome_unknown'}:
        execution({conversationId:'thread',text,updatedAt:'2026-09-27T00:00:00.000Z',revision});}
    throw new Error(bindingId);
  },status:async()=>execution({conversationId:'thread',text:'old',updatedAt:'2026-09-27T00:00:00.000Z',revision:1})};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');controller.setDraft('thread','old');
  assert.equal((await controller.saveDraft('thread')).kind,'unknown');
  controller.setDraft('thread','new');
  await controller.reconcileUnknown();
  assert.equal(controller.getSnapshot().draft.text,'new');
  assert.equal(controller.getSnapshot().draft.revision,1);
  assert.equal((await controller.saveDraft('thread')).kind,'ok');
  assert.equal(draftWrites,2);
  controller.dispose();
});
