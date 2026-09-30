import test from 'node:test';
import assert from 'node:assert/strict';
import {ticketCreate,ticketRead,ticketList,ticketClaim,ticketStatus,ticketResolve,
  messageCustomer,messageReply,messageList,transportStatus,
  referenceContactSearch,referenceContactRead,referenceMessageRead,
  referenceContactLink,referenceContactUnlink,referenceMessageLink,referenceMessageUnlink} from '../../module/service.ts';
import {manifest} from '../helpers.mjs';

const time='2026-09-28T00:00:00.000Z';
const ticket={context_id:'ctx',id:'ticket-a',requester_id:'customer',subject:'Une question',status:'ouvert',
  assigned_to:null,created_at:time,updated_at:time,last_message_at:null,last_preview:null,
  message_count:0,revision:1};
const message={context_id:'ctx',ticket_id:'ticket-a',id:'message-a',created_at:time,
  origin:'client',author_id:'customer',body:'Bonjour'};
function context(audience='app',principalId='customer',row=ticket){
  const calls=[];
  return {contextId:'ctx',audience,principalId,calls,data:{
    async get(model,input){calls.push(['get',model,input]);return model==='ticket'?row:null;},
    async list(model,input){calls.push(['list',model,input]);return {items:model==='message'?[message]:row?[row]:[],nextAfter:null};},
    planCreate(model,input){calls.push(['create',model,input]);return {kind:'data-plan',model,input};},
    planPatch(model,input){calls.push(['patch',model,input]);return {kind:'data-plan',model,input};}}};
}
test('models share one context across audiences and keep messages inside a ticket',()=>{
  const [t,m]=manifest.contracts.models;
  assert.deepEqual(t.primaryKey,['context_id','id']);
  assert.deepEqual(m.primaryKey,['context_id','ticket_id','id']);
  assert.deepEqual(m.relations[0].fields,['context_id','ticket_id']);
  const create=manifest.contracts.operations.find(op=>op.id==='ticket.create');
  const input=manifest.contracts.schemas.find(schema=>schema.id===create.input.schemaId).schema;
  assert.equal(Object.hasOwn(input.properties,'requesterId'),false,
    'the handler assigns requester_id from the authenticated principal');
});
test('app sees only its own tickets, admin sees the context queue',async()=>{
  await assert.rejects(ticketRead({id:'ticket-a'},context('app','other')),{code:'not_found'});
  assert.equal((await ticketRead({id:'ticket-a'},context('app','customer'))).output.item.id,'ticket-a');
  assert.equal((await ticketRead({id:'ticket-a'},context('admin','agent'))).output.item.id,'ticket-a');
  const app=context('app','customer');await ticketList({limit:5},app);
  assert.deepEqual(app.calls.find(call=>call[0]==='list')[2].where,{requester_id:'customer'});
  const admin=context('admin','agent');await ticketList({limit:5},admin);
  assert.deepEqual(admin.calls.find(call=>call[0]==='list')[2].where,{});
});
test('create stores the initial message atomically and reply CASes the ticket',async()=>{
  const app=context();
  const created=await ticketCreate({requestKey:'one',subject:'  Question  ',body:' Bonjour '},app);
  assert.equal(created.output.item.subject,'Question');
  assert.equal(created.output.item.messageCount,1);
  assert.deepEqual(created.plans.map(plan=>plan.model),['ticket','message']);
  await assert.rejects(ticketCreate({requestKey:'bad',subject:'   '},app),{code:'invalid_input'});
  const admin=context('admin','agent');
  const reply=await messageReply({requestKey:'reply',ticketId:'ticket-a',revision:1,body:'Réponse'},admin);
  assert.equal(reply.output.ticket.status,'repondu');
  assert.equal(reply.output.item.origin,'support');
  assert.deepEqual(reply.plans.map(plan=>plan.model),['message','ticket']);
  assert.equal(reply.plans[1].input.compare.expected,1);
  await assert.rejects(messageReply({ticketId:'ticket-a',revision:2,body:'Perdu'},admin),{code:'conflict'});
  assert.equal((await messageCustomer({ticketId:'ticket-a',revision:1,body:'Suite'},app)).output.ticket.status,'ouvert');
});
test('agent can claim only for self; status and customer resolution have guarded revisions',async()=>{
  const admin=context('admin','agent');
  const claim=await ticketClaim({id:'ticket-a',revision:1,claim:true},admin);
  assert.equal(claim.output.item.assignedTo,'agent');
  assert.equal(claim.plans[0].input.compare.expected,1);
  await assert.rejects(ticketClaim({id:'ticket-a',revision:1,claim:true},
    context('admin','other',{...ticket,assigned_to:'agent'})),{code:'conflict'});
  assert.equal((await ticketStatus({id:'ticket-a',revision:1,status:'ferme'},admin)).output.item.status,'ferme');
  await assert.rejects(ticketStatus({id:'ticket-a',revision:1,status:'wrong'},admin),{code:'invalid_input'});
  assert.equal((await ticketResolve({id:'ticket-a',revision:1},context())).output.item.status,'resolu');
});
test('message list rechecks ticket ownership; external mail stays unavailable',async()=>{
  await assert.rejects(messageList({ticketId:'ticket-a',limit:5},context('app','other')),{code:'not_found'});
  const result=await messageList({ticketId:'ticket-a',limit:5},context());
  assert.equal(result.output.items[0].body,'Bonjour');
  assert.deepEqual(transportStatus().output,{state:'unavailable',externalEmail:false});
});
test('optional reference lookups authorize the ticket before delegated read and project only public fields',async()=>{
  const app=context(),calls=[];
  app.operations={query:async request=>{calls.push(request);
    if(request.operationId==='contact.search')return {items:[{id:'contact-a',name:'Ada',email:'ada@example.test',
      companyId:null,notes:'private'}],nextCursor:null};
    if(request.operationId==='contact.read')return {item:{id:'contact-a',name:'Ada',email:'ada@example.test',
      companyId:null,notes:'private'}};
    return {message:{id:'message-a',boxId:'box-a',subject:'Hello',from:'ada@example.test',
      text:'Body',html:'<script>private</script>'}};}};
  const found=await referenceContactSearch({ticketId:'ticket-a',query:'Ada'},app);
  assert.deepEqual(found.output.items,[{id:'contact-a',name:'Ada',email:'ada@example.test',companyId:null}]);
  assert.deepEqual(calls[0],{moduleId:'creezio.crm',operationId:'contact.search',input:{limit:10,query:'Ada'}});
  assert.deepEqual((await referenceContactRead({ticketId:'ticket-a',contactId:'contact-a'},app)).output.item,
    found.output.items[0]);
  const message=(await referenceMessageRead({ticketId:'ticket-a',boxId:'box-a',messageId:'message-a'},app)).output.message;
  assert.deepEqual(message,{id:'message-a',boxId:'box-a',subject:'Hello',from:'ada@example.test',text:'Body'});
  const denied=context('app','other');denied.operations=app.operations;
  await assert.rejects(referenceContactSearch({ticketId:'ticket-a',query:'Ada'},denied),{code:'not_found'});
  assert.equal(calls.length,3,'a foreign ticket never reaches CRM or Messaging');
});
test('link and unlink persist opaque references with ticket CAS, surviving a fresh read',async()=>{
  const app=context();app.operations={query:async request=>request.moduleId==='creezio.crm'?
    {item:{id:'contact-a',name:'Ada',email:null,companyId:null}}:
    {message:{id:'message-a',boxId:'box-a',subject:'Hello',from:'',text:''}}};
  const linked=await referenceContactLink({ticketId:'ticket-a',revision:1,contactId:'contact-a'},app);
  assert.equal(linked.output.item.contactId,'contact-a');
  assert.equal(linked.plans[0].input.compare.expected,1);
  assert.deepEqual(linked.plans[0].input.values.contact_id,'contact-a');
  const after={...ticket,...linked.plans[0].input.values,revision:2};
  assert.equal((await ticketRead({id:'ticket-a'},context('app','customer',after))).output.item.contactId,'contact-a');
  await assert.rejects(referenceContactLink({ticketId:'ticket-a',revision:1,contactId:'contact-a'},
    context('app','customer',after)),{code:'conflict'});
  const removed=await referenceContactUnlink({ticketId:'ticket-a',revision:2},context('app','customer',after));
  assert.equal(removed.output.item.contactId,null);
  assert.equal(removed.plans[0].input.values.contact_id,null);
  const messageLink=await referenceMessageLink({ticketId:'ticket-a',revision:1,
    boxId:'box-a',messageId:'message-a'},app);
  assert.deepEqual([messageLink.output.item.messageBoxId,messageLink.output.item.messageId],['box-a','message-a']);
  const afterMessage={...ticket,...messageLink.plans[0].input.values,revision:2};
  assert.deepEqual((await ticketRead({id:'ticket-a'},context('app','customer',afterMessage))).output.item.messageId,'message-a');
  const messageUnlink=await referenceMessageUnlink({ticketId:'ticket-a',revision:2},context('app','customer',afterMessage));
  assert.equal(messageUnlink.output.item.messageId,null);
  assert.equal(messageUnlink.output.item.messageBoxId,null);
});
test('link refuses a foreign ticket or failed child query without issuing a write plan',async()=>{
  const forbidden=context('app','other');forbidden.operations={query:async()=>{throw new Error('must not run');}};
  await assert.rejects(referenceMessageLink({ticketId:'ticket-a',revision:1,
    boxId:'box-a',messageId:'message-a'},forbidden),{code:'not_found'});
  assert.equal(forbidden.calls.some(call=>call[0]==='patch'),false);
  const denied=context();denied.operations={query:async()=>{throw Object.assign(new Error('forbidden'),{code:'forbidden'});}};
  await assert.rejects(referenceContactLink({ticketId:'ticket-a',revision:1,contactId:'contact-a'},denied),
    {code:'forbidden'});
  assert.equal(denied.calls.some(call=>call[0]==='patch'),false);
});
