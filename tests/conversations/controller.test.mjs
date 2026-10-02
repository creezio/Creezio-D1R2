import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationsController} from '../../sdk/conversations/controller.ts';

const summary=(id,title=id)=>({id,title,mode:'chat',updatedAt:'2026-09-27T00:00:00.000Z',archivedAt:null,revision:1});
const message=id=>({id,conversationId:'thread',role:'user',body:id,createdAt:'2026-09-27T00:00:00.000Z',revision:1});
const execution=output=>({kind:'execution',execution:{id:'execution',state:'succeeded',output,errorCode:null}});
const waiting=output=>({kind:'execution',execution:{id:'execution',state:'waiting',output,errorCode:null}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function access(){
  let state={phase:'authenticated',session:{id:'session',principalId:'alice',audience:'app'},pending:null};
  const listeners=new Set();
  return {audience:'app',origin:'http://localhost',getSnapshot:()=>state,
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    refresh:async()=>{},set(next){state=next;for(const listener of listeners)listener();}};
}

test('a recovered query clears only its own error, never an uncertain mutation',async()=>{
  const a=access();let eventFails=true;
  const client={invoke:async({bindingId})=>{
    if(bindingId.endsWith('event.list'))return eventFails
      ?{kind:'execution',execution:{id:'execution',state:'failed',output:null,errorCode:'invalid_input'}}
      :execution({items:[],nextSequence:null});
    if(bindingId.endsWith('conversation.create'))return {kind:'unknown',code:'outcome_unknown'};
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  assert.equal(await controller.readEvents('thread','turn'),null);
  assert.equal(controller.getSnapshot().error,'invalid_input');
  eventFails=false;
  assert.deepEqual(await controller.readEvents('thread','turn'),{items:[],nextSequence:null});
  assert.equal(controller.getSnapshot().error,null);
  assert.equal((await controller.create({mode:'chat'})).kind,'unknown');
  assert.equal(controller.getSnapshot().error,'outcome_unknown');
  await controller.readEvents('thread','turn');
  assert.equal(controller.getSnapshot().error,'outcome_unknown');
  assert.ok(controller.getSnapshot().unknown);
  controller.dispose();
});

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

test('draft waits for a scoped read and keeps a local edit through a refused reread',async()=>{
  const a=access(), first=deferred();let reads=0,writes=0;
  const client={invoke:({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return Promise.resolve(execution({
      conversation:summary(input.conversationId),provider:'no_provider'}));
    if(bindingId.endsWith('message.list'))return Promise.resolve(execution({items:[],nextCursor:null}));
    if(bindingId.endsWith('draft.read')){
      reads++;
      if(input.conversationId==='other')return Promise.resolve(execution({
        conversationId:'other',text:'Autre',updatedAt:null,revision:1}));
      return reads===1?first.promise:Promise.resolve(reads===2
        ?{kind:'execution',execution:{id:'execution',state:'failed',output:null,errorCode:'unavailable'}}
        :execution({conversationId:'thread',text:'Serveur',updatedAt:null,revision:2}));
    }
    if(bindingId.endsWith('draft.save')){
      writes++;assert.equal(input.revision,2);assert.equal(input.text,'Local');
      return Promise.resolve(execution({conversationId:'thread',text:'Local',updatedAt:null,revision:3}));
    }
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  const opening=controller.open('thread');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(controller.getSnapshot().selected?.id,'thread');
  assert.equal(controller.getSnapshot().draft,null);
  controller.setDraft('thread','Trop tôt');
  assert.equal((await controller.saveDraft('thread','Trop tôt')).kind,'rejected');
  assert.equal((await controller.startTurn('thread','Trop tôt','chosen-model')).kind,'rejected');
  assert.equal(writes,0);
  first.resolve(execution({conversationId:'thread',text:'Serveur',updatedAt:null,revision:2}));
  await opening;
  assert.equal(controller.getSnapshot().draft?.revision,2);
  controller.setDraft('thread','Local');
  await controller.open('thread');
  assert.equal(controller.getSnapshot().draft,null);
  assert.equal((await controller.saveDraft('thread')).kind,'rejected');
  assert.equal((await controller.startTurn('thread','Local','chosen-model')).kind,'rejected');
  assert.equal(writes,0);
  await controller.open('thread');
  assert.equal(controller.getSnapshot().draft?.text,'Local');
  assert.equal(controller.getSnapshot().draft?.revision,2);
  await controller.open('other');
  assert.equal(controller.getSnapshot().draft?.text,'Autre');
  await controller.open('thread');
  assert.equal(controller.getSnapshot().draft?.text,'Local');
  assert.equal((await controller.saveDraft('thread')).kind,'ok');
  assert.equal(writes,1);
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

test('an interrupted selected conversation resumes its draft and messages when access or activity returns',async()=>{
  for(const interruption of ['access','activity']){
    const a=access(), firstDraft=deferred();let draftReads=0,commands=0;
    const client={invoke:({bindingId,input})=>{
      if(bindingId.endsWith('conversation.read'))return Promise.resolve(execution({
        conversation:summary(input.conversationId),provider:'no_provider'}));
      if(bindingId.endsWith('message.list'))return Promise.resolve(execution({
        items:[message('saved-message')],nextCursor:null}));
      if(bindingId.endsWith('draft.read'))return ++draftReads===1?firstDraft.promise:
        Promise.resolve(execution({conversationId:input.conversationId,text:'Brouillon conservé',
          updatedAt:null,revision:2}));
      commands++;throw new Error(bindingId);
    }};
    const controller=createConversationsController({access:a,client,audience:'app',
      contextId:'application',active:true});
    const opening=controller.open('thread');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(controller.getSnapshot().selected?.title,'thread');
    assert.equal(controller.getSnapshot().draft,null);
    if(interruption==='access'){
      a.set({phase:'loading',session:null,pending:null});
      a.set({phase:'authenticated',session:{id:'session',principalId:'alice',audience:'app'},pending:null});
    }else{controller.setActive(false);controller.setActive(true);}
    firstDraft.resolve(execution({conversationId:'thread',text:'Ancien résultat',updatedAt:null,revision:1}));
    await opening;
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(controller.getSnapshot().phase,'ready');
    assert.equal(controller.getSnapshot().selected?.id,'thread');
    assert.equal(controller.getSnapshot().draft?.text,'Brouillon conservé');
    assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),['saved-message']);
    assert.equal(draftReads,2);
    assert.equal(commands,0);
    controller.dispose();
  }
});

test('a new selection wins over a queued restoration after access returns',async()=>{
  const a=access(), oldDraft=deferred();
  const client={invoke:({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return Promise.resolve(execution({
      conversation:summary(input.conversationId),provider:'no_provider'}));
    if(bindingId.endsWith('message.list'))return Promise.resolve(execution({items:[],nextCursor:null}));
    if(bindingId.endsWith('draft.read'))return input.conversationId==='old'?oldDraft.promise:
      Promise.resolve(execution({conversationId:'new',text:'Nouveau brouillon',updatedAt:null,revision:1}));
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',
    contextId:'application',active:true});
  const interrupted=controller.open('old');
  await new Promise(resolve=>setImmediate(resolve));
  a.set({phase:'loading',session:null,pending:null});
  a.set({phase:'authenticated',session:{id:'session',principalId:'alice',audience:'app'},pending:null});
  const selected=controller.open('new');
  await selected;
  oldDraft.resolve(execution({conversationId:'old',text:'Ancien brouillon',updatedAt:null,revision:1}));
  await interrupted;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(controller.getSnapshot().selected?.id,'new');
  assert.equal(controller.getSnapshot().draft?.text,'Nouveau brouillon');
  controller.dispose();
});

test('message pages open on the newest messages and prepend older messages once',async()=>{
  const a=access(), pages=[
    {items:[message('m4')],nextCursor:'older-1'},
    {items:[message('m3')],nextCursor:'older-2'},
    {items:[message('m2')],nextCursor:'older-3'},
    {items:[message('m1')],nextCursor:null}];
  const client={invoke:async({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:summary('thread'),provider:'no_provider'});
    if(bindingId.endsWith('message.list'))return execution(pages[input.cursor==='older-3'?3:
      input.cursor==='older-2'?2:input.cursor==='older-1'?1:0]);
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:'',updatedAt:null,revision:0});
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),['m4']);
  await controller.loadMoreMessages();
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

test('turn start is one mutation; host drive uses scoped session and passive reads restore progress',async()=>{
  const a=access();let starts=0,drives=0,stored=[],draftText='Salut',draftRevision=1;
  const turn={id:'turn-1',conversationId:'thread',state:'queued',providerId:'openai.responses.v1',
    updatedAt:'2026-09-27T00:00:00.000Z',lastSequence:1,errorCode:null,revision:1};
  const client={invoke:async({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:summary('thread'),provider:'configured'});
    if(bindingId.endsWith('message.list'))return execution({items:[...stored].reverse(),nextCursor:null});
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:draftText,updatedAt:null,revision:draftRevision});
    if(bindingId.endsWith('turn.start')){starts++;assert.equal(input.modelId,'chosen-model');
      assert.equal(input.draftRevision,1);assert.equal(input.revision,1);
      const user={...message(input.messageId),body:input.body};stored=[user];draftText='';draftRevision=2;
      return waiting({message:user,turn});}
    if(bindingId.endsWith('turn.read'))return execution({turn});
    if(bindingId.endsWith('event.list'))return execution({items:[{turnId:'turn-1',sequence:1,kind:'queued',payload:{},
      createdAt:'2026-09-27T00:00:00.000Z'}],nextSequence:null});
    throw new Error(bindingId);
  }};
  const driveFetch=async(url,init)=>{drives++;assert.match(url,/\/api\/operations\/turns\/turn-1\/drive$/);
    assert.equal(init.headers['x-creezio-context'],'application');
    assert.equal(init.headers['x-creezio-audience'],'app');
    assert.equal(init.headers['x-creezio-request'],'1');
    assert.equal(init.credentials,'same-origin');
    assert.deepEqual(JSON.parse(init.body),{conversationId:'thread'});
    return Response.json({turn});};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',
    active:true,driveFetch});
  await controller.open('thread');controller.setDraft('thread','Salut');
  const started=await controller.startTurn('thread','Salut','chosen-model');
  assert.equal(started.kind,'ok');assert.equal(starts,1);
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.body),['Salut']);
  assert.equal(controller.getSnapshot().draft.text,'');
  assert.equal(controller.getSnapshot().activeTurn.id,'turn-1');
  assert.equal(controller.getSnapshot().turnEvents[0].kind,'queued');
  assert.equal((await controller.driveTurn('thread','turn-1')).kind,'ok');
  assert.equal(drives,1);assert.equal(starts,1);
  controller.dispose();
});

test('terminal turn rereads the conversation revision and final assistant message',async()=>{
  const a=access();let revision=2,messageLists=0;
  const earlier={...message('earlier'),role:'assistant',body:'Réponse précédente'};
  const sent={...message('sent'),body:'Question modifiée',revision:2};
  const assistant={...message('turn-1'),role:'assistant',body:'Réponse complète'};
  const finished={id:'turn-1',conversationId:'thread',state:'succeeded',providerId:'openai.responses.v1',
    updatedAt:'2026-09-27T00:00:02.000Z',lastSequence:3,errorCode:null,revision:3};
  const client={invoke:async({bindingId})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:{...summary('thread'),revision},provider:'configured'});
    if(bindingId.endsWith('message.list'))return execution(++messageLists===1
      ?{items:[earlier],nextCursor:null}
      :messageLists===2?{items:[assistant],nextCursor:'recent'}
        :{items:[{...sent,body:'Question ancienne',revision:1}],nextCursor:null});
    if(bindingId.endsWith('message.add'))return execution({message:sent});
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:'',updatedAt:null,revision:1});
    if(bindingId.endsWith('turn.read')){revision=3;return execution({turn:finished});}
    if(bindingId.endsWith('event.list'))return execution({items:[
      {turnId:'turn-1',sequence:3,kind:'completed',payload:{messageId:'turn-1'},createdAt:''}],nextSequence:null});
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');
  assert.equal((await controller.addMessage('thread',sent.body)).kind,'ok');
  const state=await controller.refreshTurn('thread','turn-1');
  assert.equal(state.state,'succeeded');
  assert.equal(controller.getSnapshot().selected.revision,3);
  assert.deepEqual(controller.getSnapshot().messages.map(row=>row.body),
    ['Réponse précédente','Question modifiée','Réponse complète']);
  assert.equal(controller.getSnapshot().messagesNextCursor,null);
  controller.dispose();
});

test('reload and terminal refresh retain a tool widget between user and assistant',async()=>{
  const a=access();
  const digest=`sha256-${'a'.repeat(64)}`;
  const older={...message('older'),role:'assistant'};
  const user=message('turn-user');
  const widget={...message('turn-widget'),role:'tool',body:'Widget interactif',content:{
    kind:'creezio.widget-message',schemaVersion:1,instances:[{instanceId:'widget-1',
      instanceRevision:1,moduleId:'example.widgets-witness',widgetId:'record',widgetVersion:'1.0.0',
      resourceUri:`ui://creezio/example.widgets-witness/record/1.0.0/${digest}.html`,
      resourceDigest:digest,state:{}}]}};
  const assistant={...message('turn-assistant'),role:'assistant',body:'Réponse finale'};
  const finished={id:'turn-1',conversationId:'thread',state:'succeeded',providerId:'openai.responses.v1',
    updatedAt:'2026-09-27T00:00:02.000Z',lastSequence:3,errorCode:null,revision:3};
  const pages=new Map([[undefined,{items:[assistant],nextCursor:'c-widget'}],
    ['c-widget',{items:[widget],nextCursor:'c-user'}],
    ['c-user',{items:[user],nextCursor:'c-older'}],
    ['c-older',{items:[older],nextCursor:null}]]);
  let reads=0;
  const client={invoke:async({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:summary('thread'),provider:'configured'});
    if(bindingId.endsWith('message.list')){reads++;return execution(pages.get(input.cursor));}
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:'',updatedAt:null,revision:0});
    if(bindingId.endsWith('turn.read'))return execution({turn:finished});
    if(bindingId.endsWith('event.list'))return execution({items:[],nextSequence:null});
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),
    ['turn-user','turn-widget','turn-assistant']);
  await controller.refreshTurn('thread','turn-1');
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),
    ['turn-user','turn-widget','turn-assistant']);
  assert.deepEqual(controller.getSnapshot().messages[1].content,widget.content);
  assert.equal(controller.getSnapshot().messagesNextCursor,'c-older');
  await controller.loadMoreMessages();
  assert.deepEqual(controller.getSnapshot().messages.map(item=>item.id),
    ['older','turn-user','turn-widget','turn-assistant']);
  assert.equal(controller.getSnapshot().messagesNextCursor,null);
  assert.equal(reads,7);
  controller.dispose();
});

test('two consecutive turns retain both exchanges without reopening the conversation',async()=>{
  const a=access();let revision=1,turns=0,reads=0,latestAssistant=null;
  const turnReads=new Map();
  const client={invoke:async({bindingId,input})=>{
    if(bindingId.endsWith('conversation.read')){reads++;return execution({conversation:{...summary('thread'),revision},provider:'configured'});}
    if(bindingId.endsWith('message.list'))return execution({items:latestAssistant?[latestAssistant]:[],nextCursor:null});
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:'',updatedAt:null,revision:0});
    if(bindingId.endsWith('turn.start')){
      assert.equal(input.revision,revision);
      const number=++turns;revision++;
      return execution({message:{...message(input.messageId),body:input.body},turn:{id:`turn-${number}`,
        conversationId:'thread',state:'queued',providerId:'openai.responses.v1',
        updatedAt:'2026-09-27T00:00:00.000Z',lastSequence:1,errorCode:null,revision:1}});
    }
    if(bindingId.endsWith('turn.read')){
      const count=(turnReads.get(input.turnId)??0)+1;turnReads.set(input.turnId,count);
      if(count===2){revision++;
        latestAssistant={...message(input.turnId),role:'assistant',body:`Réponse ${turns}`};}
      return execution({turn:{id:input.turnId,conversationId:'thread',state:count===1?'queued':'succeeded',
        providerId:'openai.responses.v1',updatedAt:'2026-09-27T00:00:01.000Z',
        lastSequence:count,errorCode:null,revision:count}});
    }
    if(bindingId.endsWith('event.list'))return execution({items:[],nextSequence:null});
    throw new Error(bindingId);
  }};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');
  for(const number of [1,2]){
    const result=await controller.startTurn('thread',`Question ${number}`,'gpt-test');
    assert.equal(result.kind,'ok');
    assert.deepEqual(controller.getSnapshot().messages.map(row=>row.body),number===1
      ?['Question 1']:['Question 1','Réponse 1','Question 2']);
    await controller.refreshTurn('thread',result.value.turn.id);
  }
  assert.deepEqual(controller.getSnapshot().messages.map(row=>row.body),
    ['Question 1','Réponse 1','Question 2','Réponse 2']);
  assert.equal(controller.getSnapshot().selected.revision,5);
  assert.equal(reads,3);
  controller.dispose();
});

test('lost turn.start response is reconciled by request key without a second start',async()=>{
  const a=access();let starts=0,revision=1,stored=[];
  const turn={id:'turn-unknown',conversationId:'thread',state:'queued',providerId:'openai.responses.v1',
    updatedAt:'2026-09-27T00:00:00.000Z',lastSequence:1,errorCode:null,revision:1};
  const sent={...message('user-unknown'),body:'Une question'};
  const client={invoke:async({bindingId})=>{
    if(bindingId.endsWith('conversation.read'))return execution({conversation:{...summary('thread'),revision},provider:'configured'});
    if(bindingId.endsWith('conversation.list'))return execution({items:[{...summary('thread'),revision}],nextCursor:null});
    if(bindingId.endsWith('message.list'))return execution({items:[...stored],nextCursor:null});
    if(bindingId.endsWith('draft.read'))return execution({conversationId:'thread',text:revision===1?'Une question':'',updatedAt:null,
      revision:revision===1?0:1});
    if(bindingId.endsWith('turn.start')){starts++;revision=2;stored=[sent];return {kind:'unknown',code:'outcome_unknown'};}
    if(bindingId.endsWith('turn.read'))return execution({turn});
    if(bindingId.endsWith('event.list'))return execution({items:[{turnId:turn.id,sequence:1,kind:'queued',
      payload:{modelId:'configured'},createdAt:''}],nextSequence:null});
    throw new Error(bindingId);
  },status:async()=>waiting({message:sent,turn})};
  const controller=createConversationsController({access:a,client,audience:'app',contextId:'application',active:true});
  await controller.open('thread');controller.setDraft('thread','Une question');
  assert.equal((await controller.startTurn('thread','Une question','configured')).kind,'unknown');
  assert.equal(controller.getSnapshot().unknown?.bindingId,'creezio.conversations:app.turn.start');
  assert.equal((await controller.startTurn('thread','Une question','configured')).kind,'rejected');
  await controller.reconcileUnknown();
  assert.equal(starts,1);
  assert.equal(controller.getSnapshot().unknown,null);
  assert.equal(controller.getSnapshot().activeTurn?.id,turn.id);
  assert.equal(controller.getSnapshot().selected?.revision,2);
  controller.dispose();
});
