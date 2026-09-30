import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {readWebhookBody,verifyStripeWebhook,verifyStandardWebhook} from '../../core/connectors/webhooks.ts';
import {createWebhookProofAuthority} from '../../core/connectors/webhook-proof.ts';
import {createSignedWebhookBridge} from '../../core/connectors/webhook-http.ts';
import {createVaultedWebhookResolver} from '../../core/connectors/webhook-resolver.ts';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';
import {stripeConnectorDescriptor} from '../../extensions/connectors/stripe/module/storage.ts';
import {stripeWebhookInput} from '../../extensions/connectors/stripe/module/webhook.ts';

const bytes=value=>new TextEncoder().encode(value);
const sign=(secret,value)=>createHmac('sha256',secret).update(value).digest('hex');
test('Stripe raw-body HMAC accepts rotation and rejects tampering, stale time and live payload',async()=>{
  const now=Date.now(),stamp=String(Math.floor(now/1000));
  const body=bytes('{"id":"evt_1","object":"event","livemode":false}');
  const secret='whsec_'+randomBytes(24).toString('base64url');
  const signature=`t=${stamp},v1=${sign(secret,Buffer.concat([Buffer.from(`${stamp}.`),body]))}`;
  assert.equal(await verifyStripeWebhook({body,signature,secrets:['whsec_previous0123456789',secret],nowMs:now}),true);
  assert.equal(await verifyStripeWebhook({body:bytes('{}'),signature,secrets:[secret],nowMs:now}),false);
  assert.equal(await verifyStripeWebhook({body,signature,secrets:[secret],nowMs:now+600_000}),false);
  assert.equal(await verifyStripeWebhook({body,signature:'t=1,v1=bad',secrets:[secret],nowMs:now}),false);
});
test('Standard Webhooks binds ID, timestamp and exact payload across rotated signatures',async()=>{
  const now=Date.now(),stamp=String(Math.floor(now/1000)),id='msg_123',body=bytes('{"ok":true}');
  const raw=randomBytes(32),secret=`whsec_${raw.toString('base64')}`;
  const signature=`v1,${createHmac('sha256',raw).update(Buffer.concat([Buffer.from(`${id}.${stamp}.`),body])).digest('base64')}`;
  assert.equal(await verifyStandardWebhook({body,id,timestamp:stamp,signature:`v1,AAAA ${signature}`,
    secrets:[secret],nowMs:now}),true);
  assert.equal(await verifyStandardWebhook({body,id:'msg_other',timestamp:stamp,signature,
    secrets:[secret],nowMs:now}),false);
});
test('Resend bridge reads Svix headers and rejects altered bytes before invocation',async()=>{
  const proof=createWebhookProofAuthority(),stamp=String(Math.floor(Date.now()/1000)),id='msg_resend_1';
  const raw=randomBytes(32),secret=`whsec_${raw.toString('base64')}`;
  const body=bytes(JSON.stringify({type:'email.delivered',data:{email_id:'email-1'}}));
  const signature=`v1,${createHmac('sha256',raw).update(Buffer.concat([
    Buffer.from(`${id}.${stamp}.`),body])).digest('base64')}`;
  let calls=0;
  const bridge=createSignedWebhookBridge({proof,resolve:async()=>({scheme:'resend',
    contextId:'application',serviceToken:'synthetic-service',secrets:[secret],guards:[],
    map:(_event,eventId)=>({requestKey:eventId})}),engine:{async invoke(){calls++;
      return {execution:{state:'succeeded'}};}}});
  const binding={moduleId:'creezio.resend',operationId:'event.receive',audience:'admin',
    auth:['webhook-signature']};
  const deliver=payload=>bridge.dispatch(new Request('https://example.test/api/webhooks/resend',{
    method:'POST',headers:{'content-type':'application/json','svix-id':id,
      'svix-timestamp':stamp,'svix-signature':signature},body:payload}),binding);
  assert.equal((await deliver(body)).status,204);
  assert.equal((await deliver(bytes(JSON.stringify({type:'email.bounced',data:{email_id:'email-1'}})))).status,401);
  assert.equal(calls,1);
});
test('webhook body reader rejects oversized chunked streams without Content-Length and aborts a stalled stream',async()=>{
  let cancelled=false;
  const oversized=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(200_000));
    controller.enqueue(new Uint8Array(100_000));},cancel(){cancelled=true;}});
  const request=new Request('https://example.test/api/webhooks/stripe',{method:'POST',
    body:oversized,duplex:'half'});
  assert.equal(request.headers.has('content-length'),false);
  assert.equal(await readWebhookBody(request),null);
  assert.equal(cancelled,true);
  const abort=new AbortController();
  const stalled=new Request('https://example.test/api/webhooks/stripe',{method:'POST',
    body:new ReadableStream({start(){}}),duplex:'half',signal:abort.signal});
  const pending=readWebhookBody(stalled);
  setTimeout(()=>abort.abort(),5);
  assert.equal(await pending,null);
});
test('signed bridge issues a one-use proof bound to a test Stripe event and service token',async()=>{
  const proof=createWebhookProofAuthority(),now=String(Math.floor(Date.now()/1000));
  const secret='whsec_'+randomBytes(24).toString('base64url');
  const body=bytes(JSON.stringify({id:'evt_test_1',object:'event',type:'checkout.session.completed',
    livemode:false,data:{object:{id:'cs_test_1',object:'checkout.session',mode:'payment',
      status:'complete',payment_status:'paid',metadata:{private:'hidden'}}}}));
  const signature=`t=${now},v1=${sign(secret,Buffer.concat([Buffer.from(`${now}.`),body]))}`;
  let invoked=0;
  const bridge=createSignedWebhookBridge({proof,resolve:async()=>({scheme:'stripe',
    contextId:'application',serviceToken:'service-token',secrets:[secret],
    guards:[{moduleId:'creezio.stripe',modelId:'connector_config',key:{id:'stripe.api.v1'},
      where:{revision:1},fields:['id','revision']}],map:stripeWebhookInput}),
    engine:{async invoke(request){invoked++;
      assert.equal((await proof.consume(request.webhookProof,request))?.length,1);
      assert.equal(await proof.consume(request.webhookProof,request),null);
      assert.equal(request.input.eventId,'evt_test_1');
      assert.doesNotMatch(JSON.stringify(request.input),/private|hidden/u);
      return {execution:{state:'succeeded'}};}}});
  const binding={moduleId:'creezio.stripe',operationId:'event.receive',audience:'admin',
    auth:['webhook-signature']};
  const request=new Request('https://example.test/api/webhooks/stripe',{method:'POST',body,
    headers:{'content-type':'application/json','stripe-signature':signature}});
  assert.equal((await bridge.dispatch(request,binding)).status,204);
  assert.equal(invoked,1);
  assert.equal((await bridge.dispatch(new Request('https://example.test/api/webhooks/stripe',
    {method:'POST',body,headers:{'content-type':'application/json','stripe-signature':'t=1,v1=bad'}}),binding)).status,401);
  assert.equal(invoked,1);
});
test('resolver finds only the declared context vault references and a real native API token',async()=>{
  const token=(await issueOpaqueToken('api-token')).token;
  const signingRef='creezio-secret:v1:12345678-1234-4123-8123-123456789abc';
  const serviceRef='creezio-secret:v1:87654321-1234-4123-8123-123456789abc';
  const config={revision:4,enabled:1,connection_id:'connection-a',
    webhook_key_ref:signingRef,webhook_secret_version:1,
    webhook_previous_key_ref:null,webhook_previous_secret_version:null,
    webhook_service_token_ref:serviceRef,webhook_service_token_version:1};
  let contextSeen=[];
  const db={prepare:(sql)=>({bind:(...values)=>({first:async()=>{
    contextSeen.push(values[0]);
    if(sql.includes('FROM "config_table"'))return sql.includes('SELECT "revision" FROM')
      ?{revision:config.revision}:config;
    if(sql.includes('FROM "vault_table"'))return {id:values[1],version:1,state:'active',
      binding_id:'stripe.api.v1',ciphertext:'v1.key.blob',key_id:'key'};
    return null;
  }})})};
  const catalog={modules:[{moduleId:'creezio.stripe',enabled:true,models:[
    {modelId:'connector_config',table:'config_table'},
    {modelId:'connector_secret',table:'vault_table'}]}]};
  const resolver=createVaultedWebhookResolver({db,catalog,keyring:{activeKeyId:'key',
    async open(scope){return scope.reference===signingRef?'whsec_123456789012345678901234':token;}},
    contextId:'application',connectors:[stripeConnectorDescriptor],
    mappings:[{moduleId:'creezio.stripe',operationId:'event.receive',path:'/api/webhooks/stripe',
      map:stripeWebhookInput}]});
  const binding={moduleId:'creezio.stripe',operationId:'event.receive',
    path:'/api/webhooks/stripe',audience:'admin',auth:['webhook-signature']};
  const resolved=await resolver(binding);
  assert.equal(resolved?.serviceToken,token);
  assert.deepEqual(resolved?.secrets,['whsec_123456789012345678901234']);
  assert.ok(contextSeen.every(value=>value==='application'));
  config.revision++;
  assert.equal((await resolver(binding))?.contextId,'application');
  assert.equal(await resolver({...binding,path:'/api/webhooks/other'}),null);
});
