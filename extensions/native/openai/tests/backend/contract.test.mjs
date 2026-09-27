import test from 'node:test';
import assert from 'node:assert/strict';
import {configRead,configSet,configKeySet,modelsList} from '../../module/service.ts';
import {createOpenAITransport} from '../../module/transport.ts';
import {ProviderTransportError} from '../../../../../sdk/providers/errors.ts';

const configuration={id:'openai.responses.v1',model_id:'model-a',api_key_ref:'creezio-secret:v1:00000000-0000-4000-8000-000000000001',
  secret_version:1,enabled:true,revision:3,updated_at:'2026-09-27T00:00:00.000Z'};
function context(row=configuration){
  const plans=[],calls=[];
  return {plans,calls,providerAvailability:{providerId:'openai.responses.v1',state:'ready',modelIds:['model-a','model-b']},
    data:{async get(name){assert.equal(name,'provider_config');return row;},
      planPatch(name,args){calls.push({name,args});const plan={kind:'data-plan',number:plans.length};plans.push(plan);return plan;},
      planCreate(name,args){calls.push({name,args});const plan={kind:'data-plan',number:plans.length};plans.push(plan);return plan;}},
    providerSecrets:{async prepareReplace(args){calls.push({secret:args});return {plan:{kind:'data-plan',number:99},
      reference:args.reference,version:2};},async preparePut(args){calls.push({secret:args});return {plan:{kind:'data-plan',number:99},
      reference:'creezio-secret:v1:00000000-0000-4000-8000-000000000002',version:1};}}};
}

test('configuration reads expose only state and authorized model IDs',async()=>{
  const c=context();
  const read=await configRead({},c);
  assert.deepEqual(read.output.config,{providerId:'openai.responses.v1',enabled:true,modelId:'model-a',state:'ready',revision:3});
  assert.doesNotMatch(JSON.stringify(read),/creezio-secret/);
  const page=await modelsList({limit:1},c);
  assert.deepEqual(page.output,{items:[{id:'model-a'}],nextCursor:'model-a'});
  assert.deepEqual((await modelsList({limit:1,cursor:'model-a'},c)).output,{items:[{id:'model-b'}],nextCursor:null});
  const disabled=context({...configuration,enabled:false});
  assert.deepEqual((await configRead({},disabled)).output.config,{providerId:'openai.responses.v1',
    enabled:false,modelId:'model-a',state:'ready',revision:3});
});

test('key rotation returns one atomic secret plan and one CAS configuration plan',async()=>{
  const c=context();
  const result=await configKeySet({requestKey:'rotate',apiKey:'synthetic-secret-value',modelId:'model-b',
    enabled:true,revision:3},c);
  assert.equal(result.plans.length,2);
  assert.equal(c.calls[0].secret.providerId,'openai.responses.v1');
  assert.equal(c.calls[0].secret.expectedVersion,1);
  assert.equal(c.calls[1].args.compare.expected,3);
  assert.equal(c.calls[1].args.values.secret_version,2);
  assert.equal(result.output.config.modelId,'model-b');
  assert.doesNotMatch(JSON.stringify(result),/synthetic-secret-value|creezio-secret/);
});

test('model changes accept a valid exact ID and keep configuration CAS',async()=>{
  const c=context();
  await assert.rejects(configSet({requestKey:'bad',modelId:'model id with spaces',enabled:true,revision:3},c));
  await assert.rejects(configSet({requestKey:'stale',modelId:'model-b',enabled:true,revision:2},c));
  const changed=await configSet({requestKey:'good',modelId:'new-exact-model',enabled:true,revision:3},c);
  assert.equal(changed.plans.length,1);
  assert.equal(changed.output.config.revision,4);
  assert.equal(changed.output.config.modelId,'new-exact-model');
});

test('Responses transport checkpoints response.created before consuming subsequent events',async()=>{
  let calls=0;
  const frames=[
    {type:'response.created',sequence_number:0,response:{id:'resp_test'}},
    {type:'response.output_text.delta',sequence_number:1,delta:'Bonjour'},
    {type:'response.completed',sequence_number:2,response:{usage:{input_tokens:4,output_tokens:2}}}];
  const http={async request(input){calls++;assert.equal(input.resource,'responses');
    assert.equal(input.body.background,true);assert.equal(input.body.stream,true);assert.equal(input.body.store,false);
    assert.equal(input.body.parallel_tool_calls,false);
    return new Response(frames.map(item=>`data: ${JSON.stringify(item)}\n\n`).join(''),{
      status:200,headers:{'content-type':'text/event-stream'}});}};
  const transport=createOpenAITransport(http);
  const opened=await transport.create({turnId:'turn',modelId:'model-a',inputItems:[{role:'user',content:'Bonjour'}],
    tools:[],limits:{maxInputBytes:1000,maxOutputBytes:1000,maxOutputTokens:20,maxToolCalls:0,deadlineMs:1000}},
  new AbortController().signal);
  assert.deepEqual(opened.receipt,{responseId:'resp_test',cursor:0});
  assert.equal(calls,1);
  const events=[];for await(const event of opened.events)events.push(event);
  assert.deepEqual(events,[{cursor:1,kind:'text_delta',text:'Bonjour'},
    {cursor:2,kind:'usage',inputTokens:4,outputTokens:2},{cursor:2,kind:'terminal',state:'succeeded'}]);
});

test('Responses transport preserves optional tool schemas and explicit strict mode',async()=>{
  const listSchema={type:'object',properties:{limit:{type:'integer'},cursor:{type:'string'}},
    required:['limit'],additionalProperties:false};
  const readSchema={type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false};
  const tools=[{bindingId:'requests:request.list',name:'purchase_request_list',description:'List requests',
    parameters:listSchema,schemaDigest:'sha256-'+'a'.repeat(64),strict:false},
  {bindingId:'requests:request.get',name:'purchase_request_get',description:'Read request',
    parameters:readSchema,schemaDigest:'sha256-'+'b'.repeat(64)}];
  const http={async request(input){
    assert.equal(input.resource,'responses');
    assert.deepEqual(input.body.tools.map(tool=>({name:tool.name,strict:tool.strict,parameters:tool.parameters})),[
      {name:'purchase_request_list',strict:false,parameters:listSchema},
      {name:'purchase_request_get',strict:true,parameters:readSchema}]);
    assert.deepEqual(listSchema.required,['limit']);
    return new Response(`data: ${JSON.stringify({type:'response.created',sequence_number:0,
      response:{id:'resp_optional_tool'}})}\n\n`,{status:200,headers:{'content-type':'text/event-stream'}});
  }};
  const opened=await createOpenAITransport(http).create({turnId:'turn',modelId:'model-a',inputItems:[],tools,
    limits:{maxInputBytes:1000,maxOutputBytes:1000,maxOutputTokens:20,maxToolCalls:2,deadlineMs:1000}},
  new AbortController().signal);
  assert.equal(opened.receipt.responseId,'resp_optional_tool');
});

test('resume preserves event cursor across split CRLF chunks and never creates a response',async()=>{
  const body='data: '+JSON.stringify({type:'response.output_text.delta',sequence_number:8,delta:'repris'})+'\r\n\r\n';
  const bytes=new TextEncoder().encode(body),split=bytes.indexOf(13)+1;
  const http={async request(input){assert.deepEqual({method:input.method,resource:input.resource,
    responseId:input.responseId,afterCursor:input.afterCursor},
  {method:'GET',resource:'response-stream',responseId:'resp_known',afterCursor:7});
    return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,split));
      controller.enqueue(bytes.slice(split));controller.close();}}),
    {headers:{'content-type':'text/event-stream'}});}};
  const events=[];
  for await(const event of createOpenAITransport(http).resume('resp_known',7,new AbortController().signal))
    events.push(event);
  assert.deepEqual(events,[{cursor:8,kind:'text_delta',text:'repris'}]);
});

test('status recovers final text, tool call, usage and terminal from an existing response',async()=>{
  const http={async request(input){assert.equal(input.resource,'response');assert.equal(input.responseId,'resp_known');
    return Response.json({id:'resp_known',status:'completed',output:[
      {type:'message',content:[{type:'output_text',text:'Réponse retrouvée'}]},
      {type:'function_call',call_id:'call_1',name:'catalog.read',arguments:'{"id":"one"}'}],
    usage:{input_tokens:5,output_tokens:3}});}};
  assert.deepEqual(await createOpenAITransport(http).status('resp_known',new AbortController().signal),{
    responseId:'resp_known',state:'succeeded',cursor:null,events:[
      {cursor:0,kind:'text_delta',text:'Réponse retrouvée'},
      {cursor:0,kind:'function_call',callId:'call_1',name:'catalog.read',arguments:{id:'one'}},
      {cursor:0,kind:'usage',inputTokens:5,outputTokens:3},
      {cursor:0,kind:'terminal',state:'succeeded'}]});
});

test('incomplete status is a terminal failure during recovery',async()=>{
  const http={async request(){return Response.json({id:'resp_incomplete',status:'incomplete',output:[]});}};
  const snapshot=await createOpenAITransport(http).status('resp_incomplete',new AbortController().signal);
  assert.equal(snapshot.state,'failed');
  assert.deepEqual(snapshot.events,[{cursor:0,kind:'terminal',state:'failed',errorCode:'incomplete'}]);
});

test('confirmed HTTP rejection differs from a lost creation acknowledgement',async()=>{
  const input={turnId:'turn',modelId:'model-a',inputItems:[{role:'user',content:'Bonjour'}],tools:[],
    limits:{maxInputBytes:1000,maxOutputBytes:1000,maxOutputTokens:20,maxToolCalls:0,deadlineMs:1000}};
  for(const [status,outcome,code] of [[400,'rejected','provider_rejected'],
    [429,'rejected','provider_rate_limited'],[503,'unknown','provider_unavailable']]){
    const transport=createOpenAITransport({async request(){return new Response('private provider detail',{status});}});
    await assert.rejects(transport.create(input,new AbortController().signal),error=>
      error instanceof ProviderTransportError&&error.outcome===outcome&&error.code===code
      &&!error.message.includes('private provider detail'));
  }
  const network=createOpenAITransport({async request(){throw new TypeError('network interrupted');}});
  await assert.rejects(network.create(input,new AbortController().signal),error=>
    !(error instanceof ProviderTransportError));
});
