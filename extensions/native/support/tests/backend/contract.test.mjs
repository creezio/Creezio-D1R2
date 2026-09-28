import test from 'node:test';
import assert from 'node:assert/strict';
import {ticketCreate,ticketRead,ticketList,ticketClaim,ticketStatus,ticketResolve,
  messageCustomer,messageReply,messageList,transportStatus} from '../../module/service.ts';
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
