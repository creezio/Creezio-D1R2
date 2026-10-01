import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {configRead,configSet,configKeySet,configKeyRevoke,domainList,deliveryReadiness,
  eventStatus,receivedRead} from '../../module/service.ts';
import {resendConnectorDescriptor,RESEND_ORIGIN} from '../../module/storage.ts';

const row={id:'resend.api.v1',origin:RESEND_ORIGIN,from_address:'sender@example.test',
  key_ref:'creezio-secret:v1:00000000-0000-4000-8000-000000000001',secret_version:1,
  enabled:true,revision:4,updated_at:'2026-09-30T00:00:00.000Z'};
function harness(initial=row,response={data:[]}){
  const calls=[];
  return {calls,context:{signal:new AbortController().signal,
    data:{async get(name){assert.equal(name,'connector_config');return initial;},
      planPatch(name,args){calls.push({name,args});return {kind:'plan'};},
      planCreate(name,args){calls.push({name,args});return {kind:'plan'};}},
    providerSecrets:{async preparePut(args){calls.push({secret:args});return {plan:{kind:'secret-plan'},
      reference:'creezio-secret:v1:00000000-0000-4000-8000-000000000002',version:1};},
      async prepareReplace(args){calls.push({secret:args});return {plan:{kind:'secret-plan'},
        reference:args.reference,version:2};},async prepareRevoke(args){calls.push({revoke:args});
        return {plan:{kind:'secret-plan'},version:2};}},
    connector:{async request(args){calls.push({request:args});return {kind:'ok',status:200,body:response};}}}};
}
test('Resend descriptor pins GET/POST routes, payload size and host-generated idempotency',()=>{
  assert.deepEqual(manifest.contracts.models.map(model=>model.primaryKey),
    [['context_id','id'],['context_id','id'],['context_id','id']]);
  assert.equal(resendConnectorDescriptor.fixedOrigin,RESEND_ORIGIN);
  assert.deepEqual(resendConnectorDescriptor.auth,{kind:'bearer'});
  assert.deepEqual(resendConnectorDescriptor.resources.map(item=>[item.id,item.method,item.path]),[
    ['domains','GET','/domains'],['email.received','GET','/emails/receiving/{id}'],
    ['email.send','POST','/emails']]);
  const send=resendConnectorDescriptor.resources[2];
  assert.equal(send.idempotencyHeader,'Idempotency-Key');
  assert.equal(send.body.encoding,'json');
  assert.deepEqual(send.body.fields.map(item=>item.wireName),
    ['from','to','cc','bcc','reply_to','subject','text','html']);
  assert.ok(send.body.fields.every(item=>item.maxBytes<=65_536));
  assert.deepEqual(send.attachments,{wireName:'attachments',maxItems:50,maxBytes:10*1024*1024});
  assert.equal(resendConnectorDescriptor.webhook.scheme,'resend');
  assert.deepEqual(manifest.contracts.connectors,[resendConnectorDescriptor]);
});
test('configuration fixes origin, validates sender, and stores key only through vault plans',async()=>{
  const empty=harness(null);
  const created=await configSet({from:'new@example.test',enabled:false,revision:0},empty.context);
  assert.equal(empty.calls[0].args.values.origin,RESEND_ORIGIN);
  assert.equal(created.output.config.revision,1);
  await assert.rejects(configSet({from:'x\r\nBcc:a@example.test',enabled:false,revision:0},empty.context),
    {code:'invalid_input'});
  await assert.rejects(configSet({from:'sender@example.test',enabled:true,revision:3},harness(row).context),
    {code:'conflict'});
  await assert.rejects(configSet({from:'sender@example.test',enabled:true,revision:0},empty.context),
    {code:'invalid_input'});
  const rotated=harness(row),secret='synthetic-secret-only';
  const changed=await configKeySet({apiKey:secret,revision:4},rotated.context);
  assert.equal(changed.plans.length,2);
  assert.equal(rotated.calls[0].secret.providerId,'resend.api.v1');
  assert.equal(rotated.calls[1].args.compare.expected,4);
  assert.doesNotMatch(JSON.stringify(changed),/synthetic-secret-only|creezio-secret/u);
  const revoked=harness(row),after=await configKeyRevoke({revision:4},revoked.context);
  assert.equal(after.output.config.enabled,false);assert.equal(after.output.config.hasKey,false);
  assert.equal(after.plans.length,2);
  assert.doesNotMatch(JSON.stringify(await configRead({},harness(row).context)),/creezio-secret/u);
});
test('domain GET projects bounded metadata, never provider internals',async()=>{
  const h=harness(row,{data:[{id:'dom_1',name:'example.test',status:'verified',
    signingKey:'private',records:[{value:'private'}]}]});
  const output=(await domainList({},h.context)).output;
  assert.deepEqual(output,{domains:[{id:'dom_1',name:'example.test',status:'verified'}]});
  assert.equal(h.calls[0].request.resource,'domains');
  assert.doesNotMatch(JSON.stringify(output),/private|signingKey/u);
  const denied=harness();denied.context.connector.request=async()=>({kind:'error',code:'remote_auth',status:401});
  await assert.rejects(domainList({},denied.context),{code:'unavailable'});
  const malformed=harness(row,{data:[{id:'bad',name:'n'}]});
  await assert.rejects(domainList({},malformed.context),{code:'unavailable'});
});
test('readiness is scoped, non-secret, and revocation removes eligibility',async()=>{
  const ready=(await deliveryReadiness({},harness(row).context)).output;
  assert.deepEqual(ready,{state:'ready',from:'sender@example.test',configRevision:4});
  assert.doesNotMatch(JSON.stringify(ready),/creezio-secret|apiKey/u);
  const revoked=(await deliveryReadiness({},harness({...row,key_ref:null,enabled:false}).context)).output;
  assert.deepEqual(revoked,{state:'unavailable',from:null,configRevision:4});
  assert.deepEqual((await deliveryReadiness({},harness(null).context)).output,
    {state:'missing',from:null,configRevision:0});
});
test('signed event status and received fetch stay within the active connection',async()=>{
  const active={...row,connection_id:'connection-one'};
  const h=harness(active,{id:'mail-one',to:['sender@example.test'],from:'peer@example.test',
    subject:'Hello',text:'Line one\nLine two',html:'<p>Hello</p>',
    created_at:'2026-09-30T10:00:00.000Z',attachments:[]});
  h.context.data.list=async(_model,args)=>{
    assert.equal(args.where.connection_id,'connection-one');
    return {items:[{id:'evt-one',event_type:'email.delivered',occurred_at:'2026-09-30T10:01:00.000Z'},
      {id:'evt-two',event_type:'email.received',occurred_at:'2026-09-30T10:00:00.000Z'}],
      nextAfter:null};
  };
  assert.equal((await eventStatus({emailId:'mail-one'},h.context)).output.kind,'delivered');
  const failed=harness(active);
  failed.context.data.list=async(_model,args)=>{
    assert.equal(args.where.connection_id,'connection-one');
    return {items:[{id:'evt-sent',event_type:'email.sent',occurred_at:'2026-09-30T10:03:00.000Z'},
      {id:'evt-failed',event_type:'email.failed',occurred_at:'2026-09-30T10:02:00.000Z'},
      {id:'evt-old',event_type:'email.delivered',occurred_at:'2026-09-30T10:01:00.000Z'}],
      nextAfter:null};
  };
  assert.deepEqual((await eventStatus({emailId:'mail-one'},failed.context)).output,
    {kind:'failed',eventId:'evt-failed',occurredAt:'2026-09-30T10:02:00.000Z'});
  const received=(await receivedRead({emailId:'mail-one'},h.context)).output;
  assert.equal(received.text,'Line one\nLine two');
  assert.equal(received.attachmentCount,0);
  assert.deepEqual(received.attachments,[]);
  assert.equal(received.connectionId,'connection-one');
  assert.equal(received.configRevision,4);
  assert.deepEqual(h.calls.at(-1).request,{resource:'email.received',id:'mail-one',
    sourceProof:{connectionId:'connection-one',configRevision:4},signal:h.context.signal});
  const missing=harness(active);
  missing.context.data.list=async()=>({items:[],nextAfter:null});
  await assert.rejects(receivedRead({emailId:'mail-one'},missing.context),{code:'not_found'});
  assert.equal(missing.calls.some(call=>call.request),false);
});
