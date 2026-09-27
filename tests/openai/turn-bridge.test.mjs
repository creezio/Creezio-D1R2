import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID,OPERATION_TABLES} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createTurnBridge} from '../../core/conversations/turn-bridge.ts';
import {ProviderTransportError} from '../../sdk/providers/errors.ts';
import * as handlers from '../../extensions/native/conversations/module/operations.ts';

const manifest=JSON.parse(readFileSync(new URL('../../extensions/native/conversations/module/manifest.json',import.meta.url),'utf8'));
const accessModels=JSON.parse(readFileSync(new URL('../../extensions/native/access/module/models.json',import.meta.url),'utf8'));
const id=manifest.identity.id,digest=`sha256-${'d'.repeat(64)}`;
const schema=generateD1Schema(id,manifest.contracts.models);
const access=generateD1Schema('creezio.access',accessModels);
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const use=manifest.contracts.permissions.find(item=>item.id==='use');
const permissions=[{id:`${id}:use`,audiences:use.audiences,actors:use.actors}];
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId:id,version:manifest.identity.version,
  enabled:true,permissions:[use],models:manifest.contracts.models.map(model=>({modelId:model.id,
    table:schema.tables[model.id],model}))}]};
function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,coerceTypes:false,removeAdditional:false}));
  const validators={},names=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:[{
    moduleId:id,version:manifest.identity.version,enabled:true,
    schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]},
    validators,handlers:Object.fromEntries(manifest.contracts.operations.map(op=>[
      `${id}:${op.id}`,handlers[op.handler.export]]))});
}

test('client drive persists one confirmed assistant and never recreates an unknown provider response',{timeout:90000},async()=>{
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-turn-bridge'},d1Persist:false});
  try{
    const db=await runtime.getD1Database('DB');
    await db.batch([...access.statements,...technical.statements,...schema.statements].map(sql=>db.prepare(sql)));
    const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
    const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'bridge@example.invalid',
      displayName:'Bridge user',password:'Synthetic bridge password'});
    assert.equal(owner.ok,true);
    const login=await accounts.login({loginIdentifier:'bridge@example.invalid',password:'Synthetic bridge password',audience:'admin'});
    assert.equal(login.ok,true);
    const acl=createAuthorizationService(db,{permissions}),before=await acl.readPolicy(login.token);
    assert.equal(before.ok,true);
    const policy=structuredClone(before.policy);
    policy.roles.push({id:'bridge-role',inherits:[],permissionIds:[`${id}:use`],permissionOverrides:[]});
    if(!policy.contexts.some(row=>row.id==='application'))policy.contexts.push({id:'application',status:'active'});
    if(!policy.memberships.some(row=>row.principalId===owner.principalId&&row.audience==='admin'
      &&row.contextId==='application'))policy.memberships.push({principalId:owner.principalId,
        audience:'admin',contextId:'application',status:'active'});
    policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId:'application',roleId:'bridge-role'});
    assert.equal((await acl.replacePolicy(login.token,{expectedEpoch:before.epoch,policy})).ok,true);
    const reg=registry(),engine=createOperationEngine({db,catalog,registry:reg,permissions,
      providerAvailability:async(_request,providerId)=>({providerId,state:'ready',modelIds:['model-a']})});
    const credential={kind:'session',token:login.token};
    const invoke=(operationId,input)=>engine.invoke({credential,moduleId:id,operationId,contextId:'application',
      audience:'admin',input});
    const created=await invoke('conversation.create',{requestKey:'create-one',mode:'chat',title:'One'});
    assert.equal(created.execution.state,'succeeded');
    const conversationId=created.execution.output.conversation.id;
    const started=await invoke('turn.start',{requestKey:'start-one',conversationId,messageId:'user-one',
      body:'Hello',modelId:'model-a',revision:1,draftRevision:0});
    assert.equal(started.execution.state,'waiting');
    const turnId=started.execution.output.turn.id;
    let creates=0;
    const provider={withTransport:async(_request,callback)=>callback({
      async create(){creates++;return {receipt:{responseId:'resp_one',cursor:0},
        events:(async function*(){yield {cursor:1,kind:'text_delta',text:'Hi'};
          yield {cursor:2,kind:'usage',inputTokens:3,outputTokens:4};
          yield {cursor:2,kind:'terminal',state:'succeeded'};})()};},
      async *resume(){throw new Error('Unexpected resume');},
      async status(){throw new Error('Unexpected status');},async cancel(){throw new Error('Unexpected cancel');}
    },'model-a')};
    const bridge=createTurnBridge({engine,db,catalog,permissions,provider,registry:reg,toolCatalog:[]});
    const driveRequest={credential,contextId:'application',audience:'admin',conversationId,turnId,
      signal:new AbortController().signal};
    const first=await bridge.drive(driveRequest);
    assert.equal(first.turn.state,'succeeded');
    assert.equal(creates,1);
    const messages=await invoke('message.list',{conversationId,limit:50});
    assert.equal(messages.execution.output.items.filter(item=>item.role==='assistant').length,1);
    assert.equal(messages.execution.output.items.find(item=>item.role==='assistant').body,'Hi');
    const firstEvents=await invoke('event.list',{conversationId,turnId,limit:50,afterSequence:0});
    assert.deepEqual({...firstEvents.execution.output.items.find(item=>item.kind==='completed').payload.usage},
      {inputTokens:3,outputTokens:4});
    assert.equal((await bridge.drive(driveRequest)).turn.state,'succeeded');
    assert.equal(creates,1);

    const second=await invoke('conversation.create',{requestKey:'create-two',mode:'chat',title:'Two'});
    const secondId=second.execution.output.conversation.id;
    const queued=await invoke('turn.start',{requestKey:'start-two',conversationId:secondId,messageId:'user-two',
      body:'Again',modelId:'model-a',revision:1,draftRevision:0});
    const unknownId=queued.execution.output.turn.id;
    let uncertainCreates=0;
    const uncertain=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({async create(){uncertainCreates++;throw new Error('lost ack');}},'model-a')}});
    const unknownRequest={...driveRequest,conversationId:secondId,turnId:unknownId};
    assert.equal((await uncertain.drive(unknownRequest)).turn.state,'unknown');
    assert.equal((await uncertain.drive(unknownRequest)).turn.state,'unknown');
    assert.equal(uncertainCreates,1);

    for(const [label,allowed] of [['allowed',true],['denied',false]]){
      const newConversation=await invoke('conversation.create',{requestKey:`create-${label}`,
        mode:'chat',title:label});
      const toolConversationId=newConversation.execution.output.conversation.id;
      const newTurn=await invoke('turn.start',{requestKey:`start-${label}`,conversationId:toolConversationId,
        messageId:`user-${label}`,body:'Read this thread',modelId:'model-a',revision:1,draftRevision:0});
      const toolTurnId=newTurn.execution.output.turn.id;
      const projectedSchema=manifest.contracts.schemas.find(item=>item.id===manifest.contracts.operations
        .find(item=>item.id==='draft.read').input.schemaId).schema;
      let calls=0,continued;
      const toolProvider={withTransport:async(_request,callback)=>callback({async create(input){
        calls++;
        if(calls===1){
          const name=allowed?input.tools.find(item=>item.bindingId===`${id}:draft.read`)?.name:'t_denied';
          assert.ok(name);
          return {receipt:{responseId:`resp_${label}_1`,cursor:0},events:(async function*(){
            yield {cursor:1,kind:'function_call',callId:`call_${label}`,name,
              arguments:{conversationId:toolConversationId}};
            if(allowed)yield {cursor:2,kind:'usage',inputTokens:7,outputTokens:8};
            yield {cursor:2,kind:'terminal',state:'succeeded'};
          })()};
        }
        continued=input.inputItems;
        return {receipt:{responseId:`resp_${label}_2`,cursor:0},events:(async function*(){
          yield {cursor:1,kind:'text_delta',text:'Read complete'};
          yield {cursor:2,kind:'usage',inputTokens:13,outputTokens:14};
          yield {cursor:2,kind:'terminal',state:'succeeded'};
        })()};
      },async *resume(){throw new Error('Unexpected resume');},
      async status(){throw new Error('Unexpected status');},async cancel(){throw new Error('Unexpected cancel');}},'model-a')};
      const toolBridge=createTurnBridge({engine,db,catalog,permissions,provider:toolProvider,registry:reg,
        toolCatalog:[{moduleId:id,operationId:'draft.read',inputSchema:projectedSchema,
          schemaDigest:`sha256-${'e'.repeat(64)}`,audiences:['admin']}]});
      const toolRequest={...driveRequest,conversationId:toolConversationId,turnId:toolTurnId};
      assert.equal((await toolBridge.drive(toolRequest)).turn.state,'running');
      assert.equal((await toolBridge.drive(toolRequest)).turn.state,'succeeded');
      assert.equal(calls,2);
      const output=continued.find(item=>item.type==='function_call_output');
      assert.ok(output);
      const parsed=JSON.parse(output.output);
      if(allowed)assert.equal(parsed.output.conversationId,toolConversationId);
      else assert.equal(parsed.error,'forbidden');
      const finalMessages=await invoke('message.list',{conversationId:toolConversationId,limit:50});
      assert.equal(finalMessages.execution.output.items.filter(item=>item.role==='assistant').length,1);
      const toolEvents=await invoke('event.list',{conversationId:toolConversationId,
        turnId:toolTurnId,limit:50,afterSequence:0});
      const firstUsage=toolEvents.execution.output.items.find(item=>item.kind==='tool_result').payload.usage;
      if(allowed)assert.deepEqual({...firstUsage},{inputTokens:7,outputTokens:8});
      else assert.equal(firstUsage,undefined);
      assert.deepEqual({...toolEvents.execution.output.items.find(item=>item.kind==='completed').payload.usage},
        {inputTokens:13,outputTokens:14});
    }
    const newTurn=async(label,revision=1,body='Question')=>{
      const conversation=await invoke('conversation.create',{requestKey:`create-${label}`,mode:'chat',title:label});
      const conversationId=conversation.execution.output.conversation.id;
      if(revision>1)for(let n=1;n<revision;n++){
        const added=await invoke('message.add',{requestKey:`history-${label}-${n}`,conversationId,
          id:`history-${label}-${n}`,body:'漢'.repeat(16_000),revision:n});
        assert.equal(added.execution.state,'succeeded');
      }
      const turn=await invoke('turn.start',{requestKey:`start-${label}`,conversationId,
        messageId:`user-${label}`,body,modelId:'model-a',revision,draftRevision:0});
      assert.equal(turn.execution.state,'waiting');
      return {...driveRequest,conversationId,turnId:turn.execution.output.turn.id};
    };
    const readSchema=manifest.contracts.schemas.find(item=>item.id===manifest.contracts.operations
      .find(item=>item.id==='draft.read').input.schemaId).schema;
    const widgetEntry=(widgetId,toolName)=>({moduleId:id,widgetId,version:'1.0.0',
      resourceDigest:digest,resourceUri:`ui://creezio/${id}/${widgetId}/1.0.0/${digest}.html`,
      audiences:['admin'],permissions:[],actions:[],renderTools:[{toolName,operationModuleId:id,
        operationId:'draft.read',operationDigest:digest,audiences:['admin']}]});
    const widgets={catalog:{widgets:[widgetEntry('card','witness_card_read'),
      widgetEntry('picker','witness_picker_read')],resources:[]},validators:new Map([
      [`${id}\u0000card\u00001.0.0`,{state:()=>true,input:()=>true,actionInputs:new Map()}],
      [`${id}\u0000picker\u00001.0.0`,{state:()=>true,input:()=>true,actionInputs:new Map()}]])};
    const widgetEngine=createOperationEngine({db,catalog,registry:reg,permissions,widgets});
    const widgetInvoke=(operationId,input)=>widgetEngine.invoke({credential,moduleId:id,operationId,
      contextId:'application',audience:'admin',input});
    const widgetTools=['card','picker'].map(widgetId=>({moduleId:id,operationId:'draft.read',
      inputSchema:readSchema,schemaDigest:digest,audiences:['admin'],widget:{moduleId:id,widgetId,
        version:'1.0.0',resourceDigest:digest,toolName:`witness_${widgetId}_read`,operationDigest:digest}}));
    const multiRequest=await newTurn('two-widgets');
    const multiInputs=[];
    const multiBridge=createTurnBridge({engine:widgetEngine,db,catalog,permissions,registry:reg,widgets,toolCatalog:widgetTools,
      provider:{withTransport:async(_request,callback)=>callback({async create(input){
        multiInputs.push(input);
        const index=multiInputs.length;
        if(index<=2)return {receipt:{responseId:`resp_multi_${index}`,cursor:0},events:(async function*(){
          yield {cursor:1,kind:'function_call',callId:`call_multi_${index}`,
            name:index===1?'witness_card_read':'witness_picker_read',
            arguments:{conversationId:multiRequest.conversationId}};
          yield {cursor:2,kind:'terminal',state:'succeeded'};
        })()};
        return {receipt:{responseId:'resp_multi_final',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'text_delta',text:'Deux widgets prêts'};
          yield {cursor:2,kind:'terminal',state:'succeeded'};
        })()};
      },async *resume(){throw new Error('Unexpected resume');},
      async status(){throw new Error('Unexpected status');}},'model-a')}});
    assert.equal((await multiBridge.drive(multiRequest)).turn.state,'running');
    assert.equal((await multiBridge.drive(multiRequest)).turn.state,'running');
    assert.equal((await multiBridge.drive(multiRequest)).turn.state,'succeeded');
    assert.equal((await multiBridge.drive(multiRequest)).turn.state,'succeeded');
    assert.equal(multiInputs.length,3);
    assert.deepEqual(multiInputs.map(input=>input.inputItems.filter(item=>item.type==='function_call').length),[0,1,2]);
    assert.deepEqual(multiInputs.map(input=>input.inputItems.filter(item=>item.type==='function_call_output').length),[0,1,2]);
    assert.ok(multiInputs.every(input=>input.limits.maxToolCalls===1));
    const multiMessages=[];let multiCursor;
    for(let page=0;page<5;page++){
      const listed=await widgetInvoke('message.list',{conversationId:multiRequest.conversationId,limit:50,
        ...(multiCursor?{cursor:multiCursor}:{})});
      assert.equal(listed.execution.state,'succeeded');
      multiMessages.push(...listed.execution.output.items);
      multiCursor=listed.execution.output.nextCursor;
      if(!multiCursor)break;
    }
    const renderedMessages=multiMessages.filter(item=>item.role==='tool').reverse();
    assert.deepEqual(renderedMessages.map(item=>item.content.instances[0].widgetId),['card','picker']);
    assert.ok(renderedMessages.every(item=>item.content.instances[0].renderExecution.operationId==='draft.read'));

    const limitRequest=await newTurn('four-tool-limit');
    const limitInputs=[];
    const limitBridge=createTurnBridge({engine:widgetEngine,db,catalog,permissions,registry:reg,toolCatalog:widgetTools,
      widgets,provider:{withTransport:async(_request,callback)=>callback({async create(input){
        limitInputs.push(input);const index=limitInputs.length;
        return {receipt:{responseId:`resp_limit_${index}`,cursor:0},events:(async function*(){
          yield {cursor:1,kind:'function_call',callId:`call_limit_${index}`,
            name:'witness_card_read',arguments:{conversationId:limitRequest.conversationId}};
          yield {cursor:2,kind:'terminal',state:'succeeded'};
        })()};
      },async *resume(){throw new Error('Unexpected resume');},
      async status(){throw new Error('Unexpected status');}},'model-a')}});
    for(let index=0;index<4;index++)assert.equal((await limitBridge.drive(limitRequest)).turn.state,'running');
    const limited=await limitBridge.drive(limitRequest);
    assert.equal(limited.turn.state,'failed');
    assert.equal(limited.turn.errorCode,'tool_limit');
    assert.equal(limitInputs.length,5);
    assert.deepEqual(limitInputs.map(input=>input.limits.maxToolCalls),[1,1,1,1,0]);
    assert.equal(limitInputs[4].tools.length,0);
    assert.equal((await limitBridge.drive(limitRequest)).turn.state,'failed');
    assert.equal(limitInputs.length,5);
    const limitEvents=await invoke('event.list',{conversationId:limitRequest.conversationId,
      turnId:limitRequest.turnId,limit:50,afterSequence:0});
    assert.equal(limitEvents.execution.output.items.filter(item=>item.kind==='tool_result').length,4);

    const preflightRequest=await newTurn('preflight');
    const preflight=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async()=>{throw new Error('configuration became unavailable');}}});
    assert.equal((await preflight.drive(preflightRequest)).turn.state,'failed');
    assert.equal((await invoke('conversation.read',{conversationId:preflightRequest.conversationId}))
      .execution.output.conversation.revision,3);

    const rejectedRequest=await newTurn('rejected');
    const rejected=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({async create(){
        throw new ProviderTransportError('rejected','provider_rejected');}},'model-a')}});
    const rejectedTurn=await rejected.drive(rejectedRequest);
    assert.equal(rejectedTurn.turn.state,'failed');
    assert.equal(rejectedTurn.turn.errorCode,'provider_rejected');

    const uncertainCancelRequest=await newTurn('cancel-create-uncertain');
    let uncertainCancelCreates=0;
    const uncertainCancelBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({async create(){
        uncertainCancelCreates++;
        const read=await invoke('turn.read',{conversationId:uncertainCancelRequest.conversationId,
          turnId:uncertainCancelRequest.turnId});
        const cancelled=await invoke('turn.cancel',{requestKey:'cancel-create-uncertain',
          conversationId:uncertainCancelRequest.conversationId,turnId:uncertainCancelRequest.turnId,
          revision:read.execution.output.turn.revision});
        assert.equal(cancelled.execution.state,'succeeded');
        throw new Error('lost create acknowledgement');
      }},'model-a')}});
    const uncertainCancelled=await uncertainCancelBridge.drive(uncertainCancelRequest);
    assert.equal(uncertainCancelled.turn.state,'unknown');
    assert.equal(uncertainCancelled.turn.errorCode,'provider_unknown');
    assert.equal((await uncertainCancelBridge.drive(uncertainCancelRequest)).turn.state,'unknown');
    assert.equal(uncertainCancelCreates,1);
    const uncertainCancelEvents=await invoke('event.list',{
      conversationId:uncertainCancelRequest.conversationId,turnId:uncertainCancelRequest.turnId,
      limit:50,afterSequence:0});
    assert.deepEqual({...uncertainCancelEvents.execution.output.items.find(item=>item.kind==='unknown')?.payload},
      {cancelRequested:true});

    const lateCancelRequest=await newTurn('cancel-after-unknown');
    let lateCancelCreates=0;
    const lateCancelBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({async create(){
        lateCancelCreates++;throw new Error('lost create acknowledgement');
      }},'model-a')}});
    const lateUnknown=await lateCancelBridge.drive(lateCancelRequest);
    assert.equal(lateUnknown.turn.state,'unknown');
    const lateCancelled=await invoke('turn.cancel',{requestKey:'cancel-after-unknown',
      conversationId:lateCancelRequest.conversationId,turnId:lateCancelRequest.turnId,
      revision:lateUnknown.turn.revision});
    assert.equal(lateCancelled.execution.state,'succeeded');
    const lateReconciled=await lateCancelBridge.drive(lateCancelRequest);
    assert.equal(lateReconciled.turn.state,'unknown');
    assert.equal(lateReconciled.turn.errorCode,'provider_unknown');
    assert.equal(lateCancelCreates,1);
    const lateCancelEvents=await invoke('event.list',{conversationId:lateCancelRequest.conversationId,
      turnId:lateCancelRequest.turnId,limit:50,afterSequence:0});
    assert.equal(lateCancelEvents.execution.output.items.filter(item=>item.kind==='unknown').length,2);
    assert.deepEqual({...lateCancelEvents.execution.output.items.findLast(item=>item.kind==='unknown').payload},
      {cancelRequested:true});

    const casCancelRequest=await newTurn('cancel-before-unknown-cas');
    const casPrepared=new WeakMap();
    let injectCasCancel=true,casCreates=0;
    const casDb=new Proxy(db,{get(target,key){
      if(key==='prepare')return sql=>new Proxy(target.prepare(sql),{get(statement,method){
        if(method==='bind')return (...values)=>{const bound=statement.bind(...values);
          casPrepared.set(bound,{sql,values});return bound;};
        const value=statement[method];return typeof value==='function'?value.bind(statement):value;
      }});
      if(key==='batch')return async statements=>{
        if(injectCasCancel&&statements.some(statement=>
          casPrepared.get(statement)?.values.includes('provider_unknown'))){
          injectCasCancel=false;
          const read=await invoke('turn.read',{conversationId:casCancelRequest.conversationId,
            turnId:casCancelRequest.turnId});
          const cancelled=await invoke('turn.cancel',{requestKey:'cancel-before-unknown-cas',
            conversationId:casCancelRequest.conversationId,turnId:casCancelRequest.turnId,
            revision:read.execution.output.turn.revision});
          assert.equal(cancelled.execution.state,'succeeded');
        }
        return target.batch(statements);
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    const casCancelBridge=createTurnBridge({engine,db:casDb,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({async create(){
        casCreates++;throw new Error('lost create acknowledgement');
      }},'model-a')}});
    assert.equal((await casCancelBridge.drive(casCancelRequest)).turn.state,'cancel_requested');
    assert.equal(injectCasCancel,false);
    const casReconciled=await casCancelBridge.drive(casCancelRequest);
    assert.equal(casReconciled.turn.state,'unknown');
    assert.equal(casReconciled.turn.errorCode,'provider_unknown');
    assert.equal(casCreates,1);
    const casCancelEvents=await invoke('event.list',{conversationId:casCancelRequest.conversationId,
      turnId:casCancelRequest.turnId,limit:50,afterSequence:0});
    assert.deepEqual({...casCancelEvents.execution.output.items.find(item=>item.kind==='unknown')?.payload},
      {cancelRequested:true});

    const eofRequest=await newTurn('eof');
    let statuses=0;
    const eof=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({
        async create(){return {receipt:{responseId:'resp_eof',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'text_delta',text:'Final'};
        })()};},
        async status(){statuses++;return {responseId:'resp_eof',state:'succeeded',cursor:null,
          events:[{cursor:0,kind:'text_delta',text:'Final answer'},
            {cursor:0,kind:'usage',inputTokens:9,outputTokens:5},
            {cursor:0,kind:'terminal',state:'succeeded'}]};}
      },'model-a')}});
    assert.equal((await eof.drive(eofRequest)).turn.state,'succeeded');
    assert.equal(statuses,1);
    const eofMessages=await invoke('message.list',{conversationId:eofRequest.conversationId,limit:50});
    assert.equal(eofMessages.execution.output.items.find(item=>item.role==='assistant').body,'Final answer');
    const eofEvents=await invoke('event.list',{conversationId:eofRequest.conversationId,
      turnId:eofRequest.turnId,limit:50,afterSequence:0});
    assert.deepEqual({...eofEvents.execution.output.items.find(item=>item.kind==='completed').payload.usage},
      {inputTokens:9,outputTokens:5});

    const cancelRequest=await newTurn('cancel');
    let cancelCalls=0;
    const cancelled=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({
        async create(){return {receipt:{responseId:'resp_cancel',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'text_delta',text:'Already '};
        })()};},
        async status(){return {responseId:'resp_cancel',state:'queued',cursor:null,events:[]};},
        async cancel(){cancelCalls++;return {responseId:'resp_cancel',state:'succeeded',cursor:null,
          events:[{cursor:0,kind:'text_delta',text:'Already done'},
            {cursor:0,kind:'terminal',state:'succeeded'}]};}
      },'model-a')}});
    const running=await cancelled.drive(cancelRequest);
    assert.equal(running.turn.state,'running');
    const requested=await invoke('turn.cancel',{requestKey:'cancel-known',conversationId:cancelRequest.conversationId,
      turnId:cancelRequest.turnId,revision:running.turn.revision});
    assert.equal(requested.execution.state,'succeeded');
    await db.prepare(`UPDATE "${OPERATION_TABLES.outbox}" SET claim_expires_at_ms=0 WHERE intent_id=?`)
      .bind(cancelRequest.turnId).run();
    assert.equal((await cancelled.drive(cancelRequest)).turn.state,'succeeded');
    assert.equal(cancelCalls,1);
    const cancelMessages=await invoke('message.list',{conversationId:cancelRequest.conversationId,limit:50});
    assert.equal(cancelMessages.execution.output.items.find(item=>item.role==='assistant').body,'Already done');
    const cancelEvents=await invoke('event.list',{conversationId:cancelRequest.conversationId,
      turnId:cancelRequest.turnId,limit:50,afterSequence:0});
    assert.equal(cancelEvents.execution.state,'succeeded',JSON.stringify(cancelEvents));
    assert.deepEqual(cancelEvents.execution.output.items.filter(item=>item.kind==='text_delta')
      .map(item=>item.payload.text),['Already ','done']);

    const pendingCancelRequest=await newTurn('cancel-pending-tool');
    const pendingPrepared=new WeakMap();
    let injectPendingCancel=true;
    const pendingDb=new Proxy(db,{get(target,key){
      if(key==='prepare')return sql=>new Proxy(target.prepare(sql),{get(statement,method){
        if(method==='bind')return (...values)=>{const bound=statement.bind(...values);
          pendingPrepared.set(bound,{sql,values});return bound;};
        const value=statement[method];return typeof value==='function'?value.bind(statement):value;
      }});
      if(key==='batch')return async statements=>{
        const checkpoint=injectPendingCancel&&statements.some(statement=>
          pendingPrepared.get(statement)?.values.some(value=>
            typeof value==='string'&&value.includes('"pendingTool"')));
        const result=await target.batch(statements);
        if(checkpoint){
          injectPendingCancel=false;
          const read=await invoke('turn.read',{conversationId:pendingCancelRequest.conversationId,
            turnId:pendingCancelRequest.turnId});
          const cancelled=await invoke('turn.cancel',{requestKey:'cancel-pending-tool',
            conversationId:pendingCancelRequest.conversationId,turnId:pendingCancelRequest.turnId,
            revision:read.execution.output.turn.revision});
          assert.equal(cancelled.execution.state,'succeeded');
        }
        return result;
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    let pendingCancelCreates=0,pendingCancels=0;
    const pendingCancelBridge=createTurnBridge({engine,db:pendingDb,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({
        async create(){pendingCancelCreates++;return {receipt:{responseId:'resp_pending_cancel',cursor:0},
          events:(async function*(){
            yield {cursor:1,kind:'function_call',callId:'call_pending',name:'t_denied',arguments:{}};
            yield {cursor:2,kind:'terminal',state:'succeeded'};
          })()};},
        async cancel(){pendingCancels++;return pendingCancels===1
          ?{responseId:'resp_pending_cancel',state:'running',cursor:null,events:[]}
          :{responseId:'resp_pending_cancel',state:'cancelled',cursor:null,
            events:[{cursor:0,kind:'terminal',state:'cancelled'}]};}
      },'model-a')}});
    assert.equal((await pendingCancelBridge.drive(pendingCancelRequest)).turn.state,'cancel_requested');
    assert.equal(injectPendingCancel,false);
    await db.prepare(`UPDATE "${OPERATION_TABLES.outbox}" SET claim_expires_at_ms=0 WHERE intent_id=?`)
      .bind(pendingCancelRequest.turnId).run();
    assert.equal((await pendingCancelBridge.drive(pendingCancelRequest)).turn.state,'cancelled');
    assert.equal(pendingCancelCreates,1);
    assert.equal(pendingCancels,2);
    const pendingCancelEvents=await invoke('event.list',{conversationId:pendingCancelRequest.conversationId,
      turnId:pendingCancelRequest.turnId,limit:50,afterSequence:0});
    assert.equal(pendingCancelEvents.execution.output.items.some(item=>item.kind==='tool_result'),false);

    for(const state of ['failed','cancelled']){
      const terminalRequest=await newTurn(`terminal-${state}`);
      let toolContinued=false;
      const terminalBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
        provider:{withTransport:async(_request,callback)=>callback({
          async create(){return {receipt:{responseId:`resp_terminal_${state}`,cursor:0},
            events:(async function*(){})()};},
          async status(){return {responseId:`resp_terminal_${state}`,state,cursor:null,events:[
            {cursor:0,kind:'function_call',callId:`call_${state}`,name:'t_read',arguments:{}},
            {cursor:0,kind:'terminal',state}]};},
          async *resume(){toolContinued=true;throw new Error('Unexpected resume');}
        },'model-a')}});
      assert.equal((await terminalBridge.drive(terminalRequest)).turn.state,state);
      assert.equal(toolContinued,false);
      const terminalEvents=await invoke('event.list',{conversationId:terminalRequest.conversationId,
        turnId:terminalRequest.turnId,limit:50,afterSequence:0});
      assert.ok(terminalEvents.execution.output.items.some(item=>item.kind===state));
      assert.equal(terminalEvents.execution.output.items.some(item=>item.kind==='tool_result'),false);
    }

    const beforeReadRequest=await newTurn('cancel-before-read');
    let beforeReadCancels=0;
    const beforeReadBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({
        async create(){return {receipt:{responseId:'resp_cancel_before',cursor:0},events:(async function*(){
          const read=await invoke('turn.read',{conversationId:beforeReadRequest.conversationId,
            turnId:beforeReadRequest.turnId});
          const cancelled=await invoke('turn.cancel',{requestKey:'cancel-before-progress',
            conversationId:beforeReadRequest.conversationId,turnId:beforeReadRequest.turnId,
            revision:read.execution.output.turn.revision});
          assert.equal(cancelled.execution.state,'succeeded');
          yield {cursor:1,kind:'text_delta',text:'Must not appear'};
        })()};},
        async cancel(){beforeReadCancels++;return {responseId:'resp_cancel_before',state:'cancelled',
          cursor:null,events:[{cursor:0,kind:'terminal',state:'cancelled'}]};}
      },'model-a')}});
    assert.equal((await beforeReadBridge.drive(beforeReadRequest)).turn.state,'cancelled');
    assert.equal(beforeReadCancels,1);
    const beforeReadEvents=await invoke('event.list',{conversationId:beforeReadRequest.conversationId,
      turnId:beforeReadRequest.turnId,limit:50,afterSequence:0});
    assert.equal(beforeReadEvents.execution.output.items.some(item=>item.kind==='text_delta'),false);

    const afterReadRequest=await newTurn('cancel-after-read');
    let afterReadCancels=0,injectCancel=true;
    const prepared=new WeakMap();
    const delayedDb=new Proxy(db,{get(target,key){
      if(key==='prepare')return sql=>new Proxy(target.prepare(sql),{get(statement,method){
        if(method==='bind')return (...values)=>{const bound=statement.bind(...values);
          prepared.set(bound,{sql,values});return bound;};
        const value=statement[method];return typeof value==='function'?value.bind(statement):value;
      }});
      if(key==='batch')return async statements=>{
        if(injectCancel&&statements.some(statement=>prepared.get(statement)?.values.includes('text_delta'))){
          injectCancel=false;
          const read=await invoke('turn.read',{conversationId:afterReadRequest.conversationId,
            turnId:afterReadRequest.turnId});
          const cancelled=await invoke('turn.cancel',{requestKey:'cancel-after-progress-read',
            conversationId:afterReadRequest.conversationId,turnId:afterReadRequest.turnId,
            revision:read.execution.output.turn.revision});
          assert.equal(cancelled.execution.state,'succeeded');
        }
        return target.batch(statements);
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    const afterReadBridge=createTurnBridge({engine,db:delayedDb,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({
        async create(){return {receipt:{responseId:'resp_cancel_after',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'text_delta',text:'Must not appear'};
        })()};},
        async cancel(){afterReadCancels++;return {responseId:'resp_cancel_after',state:'cancelled',
          cursor:null,events:[{cursor:0,kind:'terminal',state:'cancelled'}]};}
      },'model-a')}});
    assert.equal((await afterReadBridge.drive(afterReadRequest)).turn.state,'cancelled');
    assert.equal(injectCancel,false);
    assert.equal(afterReadCancels,1);
    const afterReadEvents=await invoke('event.list',{conversationId:afterReadRequest.conversationId,
      turnId:afterReadRequest.turnId,limit:50,afterSequence:0});
    assert.equal(afterReadEvents.execution.output.items.some(item=>item.kind==='text_delta'),false);

    const switchedRequest=await newTurn('model-switched');
    let currentModel='model-a',switchCreates=0,switchResumes=0;
    const switchedBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({
        async create(){switchCreates++;return {receipt:{responseId:'resp_model_switched',cursor:0},
          events:(async function*(){})()};},
        async status(){return {responseId:'resp_model_switched',state:'running',cursor:null,events:[]};},
        async *resume(){switchResumes++;yield {cursor:1,kind:'terminal',state:'succeeded'};}
      },currentModel)}});
    assert.equal((await switchedBridge.drive(switchedRequest)).turn.state,'running');
    currentModel='model-b';
    await db.prepare(`UPDATE "${OPERATION_TABLES.outbox}" SET claim_expires_at_ms=0 WHERE intent_id=?`)
      .bind(switchedRequest.turnId).run();
    assert.equal((await switchedBridge.drive(switchedRequest)).turn.state,'succeeded');
    assert.equal(switchCreates,1);
    assert.equal(switchResumes,1);

    const diagnosticRequest=await newTurn('tool-diagnostics');
    const diagnosticsBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,
      toolCatalog:[{moduleId:id,operationId:'draft.read',inputSchema:{type:'object',properties:{},
        required:[],additionalProperties:true},schemaDigest:`sha256-${'a'.repeat(64)}`,audiences:['admin']}],
      provider:{withTransport:async(_request,callback)=>callback({async create(){return {
        receipt:{responseId:'resp_diagnostics',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'terminal',state:'succeeded'};})()};}},'model-a')}});
    assert.equal((await diagnosticsBridge.drive(diagnosticRequest)).turn.state,'succeeded');
    const diagnosticEvents=await invoke('event.list',{conversationId:diagnosticRequest.conversationId,
      turnId:diagnosticRequest.turnId,limit:50,afterSequence:0});
    const diagnosticPayload=diagnosticEvents.execution.output.items.find(item=>item.kind==='started').payload;
    assert.deepEqual(diagnosticPayload.toolDiagnostics.map(item=>({...item})),
      [{code:'unsupported_schema',count:1}]);
    assert.doesNotMatch(JSON.stringify(diagnosticPayload),/draft\.read/);

    const historyRequest=await newTurn('history',18,'Newest prompt');
    let capturedHistory;
    const historyBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({async create(input){capturedHistory=input.inputItems;
        return {receipt:{responseId:'resp_history',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'terminal',state:'succeeded'};})()};}},'model-a')}});
    assert.equal((await historyBridge.drive(historyRequest)).turn.state,'succeeded');
    assert.equal(capturedHistory.at(-1).content,'Newest prompt');
    assert.ok(capturedHistory.length<=3);

    const pendingRequest=await newTurn('pending');
    const pendingSchema=manifest.contracts.schemas.find(item=>item.id===manifest.contracts.operations
      .find(item=>item.id==='draft.read').input.schemaId).schema;
    const toolReads=async()=>Number((await db.prepare(`SELECT count(*) AS n FROM "${OPERATION_TABLES.executions}"
      WHERE operation_id='draft.read'`).first()).n);
    const readsBefore=await toolReads();
    let pendingCreates=0;
    const pendingBridge=createTurnBridge({engine,db,catalog,permissions,registry:reg,
      toolCatalog:[{moduleId:id,operationId:'draft.read',inputSchema:pendingSchema,
        schemaDigest:`sha256-${'f'.repeat(64)}`,audiences:['admin']}],
      provider:{withTransport:async(_request,callback)=>callback({async create(input){
        pendingCreates++;
        if(pendingCreates===1){const name=input.tools.find(item=>item.bindingId===`${id}:draft.read`)?.name;
          assert.ok(name);
          return {receipt:{responseId:'resp_pending_1',cursor:0},events:(async function*(){
            yield {cursor:1,kind:'function_call',callId:'call_pending',name,
              arguments:{conversationId:pendingRequest.conversationId}};
            yield {cursor:2,kind:'usage',inputTokens:11,outputTokens:12};
            yield {cursor:2,kind:'terminal',state:'succeeded'};
          })()};}
        return {receipt:{responseId:'resp_pending_2',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'terminal',state:'succeeded'};})()};
      },async *resume(){throw new Error('Unexpected resume');},
      async status(){throw new Error('Unexpected status');}},'model-a')}});
    await db.prepare(`CREATE TRIGGER reject_tool_append BEFORE INSERT ON "${OPERATION_TABLES.outbox}"
      WHEN NEW.intent_id <> '${pendingRequest.turnId}' BEGIN SELECT RAISE(ABORT,'test append failure'); END`).run();
    try{await pendingBridge.drive(pendingRequest);}finally{await db.prepare('DROP TRIGGER reject_tool_append').run();}
    assert.equal(await toolReads(),readsBefore+1);
    const receipt=await db.prepare(`SELECT receipt FROM "${OPERATION_TABLES.outbox}" WHERE intent_id=?`)
      .bind(pendingRequest.turnId).first();
    assert.equal(JSON.parse(receipt.receipt).pendingTool.callId,'call_pending');
    assert.deepEqual(JSON.parse(receipt.receipt).pendingTool.usage,{inputTokens:11,outputTokens:12});
    await db.prepare(`UPDATE "${OPERATION_TABLES.outbox}" SET claim_expires_at_ms=0 WHERE intent_id=?`)
      .bind(pendingRequest.turnId).run();
    assert.equal((await pendingBridge.drive(pendingRequest)).turn.state,'running');
    assert.equal(await toolReads(),readsBefore+1);
    assert.equal((await pendingBridge.drive(pendingRequest)).turn.state,'succeeded');
    assert.equal(pendingCreates,2);
    const pendingEvents=await invoke('event.list',{conversationId:pendingRequest.conversationId,
      turnId:pendingRequest.turnId,limit:50,afterSequence:0});
    assert.deepEqual({...pendingEvents.execution.output.items.find(item=>item.kind==='tool_result').payload.usage},
      {inputTokens:11,outputTokens:12});

    // The bridge must use the fully configured host engine for another native
    // module. Projection still enforces its permission before any tool invoke.
    const settingsId='creezio.modules-settings',manage=`${settingsId}:manage`;
    const hostPermissions=[...permissions,{id:manage,audiences:['admin'],actors:['user','delegated-user']}];
    const hostCatalog={...catalog,modules:[...catalog.modules,{moduleId:settingsId,version:'0.0.0',
      enabled:true,permissions:[],models:[]}]};
    const detail={moduleId:settingsId,declaration:{id:'catalog.detail',title:'Détail du module',kind:'query',
      approval:{mode:'none'},effects:{reads:[],writes:[],emits:[],calls:[],providers:[]},
      audiences:['admin'],actors:['user','delegated-user'],permissions:[{moduleId:settingsId,id:'manage'}]},
      contractDigest:digest,validateInput:value=>typeof value?.moduleId==='string'};
    const hostRegistry={compositionDigest:digest,resolve:(moduleId,operationId)=>moduleId===settingsId
      &&operationId==='catalog.detail'?detail:reg.resolve(moduleId,operationId)};
    let hostCalls=0;
    const hostEngine={async invoke(request){
      assert.equal(request.moduleId,settingsId);assert.equal(request.operationId,'catalog.detail');hostCalls++;
      return {execution:{id:`host-detail-${hostCalls}`,state:'succeeded',
        output:{module:{moduleId:request.input.moduleId}},errorCode:null},replayed:false};
    }};
    const hostTool={moduleId:settingsId,operationId:'catalog.detail',
      inputSchema:{type:'object',properties:{moduleId:{type:'string'}},required:['moduleId'],additionalProperties:false},
      schemaDigest:digest,audiences:['admin']};
    const allowedRequest=await newTurn('host-detail-allowed');
    const deniedRequest=await newTurn('host-detail-denied');
    const hostAcl=createAuthorizationService(db,{permissions:hostPermissions});
    const hostBefore=await hostAcl.readPolicy(login.token);assert.equal(hostBefore.ok,true);
    const hostPolicy=structuredClone(hostBefore.policy);
    hostPolicy.roles.find(role=>role.id==='bridge-role').permissionIds.push(manage);
    assert.equal((await hostAcl.replacePolicy(login.token,{expectedEpoch:hostBefore.epoch,policy:hostPolicy})).ok,true);
    let hostToolName;
    const driveHost=async(request,allowed)=>{
      let calls=0,continued;
      const hostProvider={withTransport:async(_request,callback)=>callback({async create(input){
        calls++;
        if(calls===1){
          if(allowed){hostToolName=input.tools.find(item=>item.bindingId===`${settingsId}:catalog.detail`)?.name;
            assert.ok(hostToolName);}
          else assert.equal(input.tools.length,0);
          return {receipt:{responseId:`host_${allowed?'allowed':'denied'}_1`,cursor:0},
            events:(async function*(){yield {cursor:1,kind:'function_call',callId:`host_call_${allowed?'allowed':'denied'}`,
              name:hostToolName,arguments:{moduleId:settingsId}};
              yield {cursor:2,kind:'terminal',state:'succeeded'};})()};
        }
        continued=input.inputItems;
        return {receipt:{responseId:`host_${allowed?'allowed':'denied'}_2`,cursor:0},
          events:(async function*(){yield {cursor:1,kind:'terminal',state:'succeeded'};})()};
      },async *resume(){throw new Error('Unexpected resume');},async status(){throw new Error('Unexpected status');}},'model-a')};
      const hostBridge=createTurnBridge({engine:hostEngine,db,catalog:hostCatalog,permissions:hostPermissions,
        provider:hostProvider,registry:hostRegistry,toolCatalog:[hostTool]});
      assert.equal((await hostBridge.drive(request)).turn.state,'running');
      assert.equal((await hostBridge.drive(request)).turn.state,'succeeded');
      return JSON.parse(continued.find(item=>item.type==='function_call_output').output);
    };
    assert.deepEqual((await driveHost(allowedRequest,true)).output,{module:{moduleId:settingsId}});
    assert.equal(hostCalls,1);
    const hostCurrent=await hostAcl.readPolicy(login.token);assert.equal(hostCurrent.ok,true);
    const revokedPolicy=structuredClone(hostCurrent.policy);
    revokedPolicy.roles.find(role=>role.id==='bridge-role').permissionIds=
      revokedPolicy.roles.find(role=>role.id==='bridge-role').permissionIds.filter(id=>id!==manage);
    assert.equal((await hostAcl.replacePolicy(login.token,{expectedEpoch:hostCurrent.epoch,policy:revokedPolicy})).ok,true);
    assert.equal((await driveHost(deniedRequest,false)).error,'forbidden');
    assert.equal(hostCalls,1);
  }finally{await runtime.dispose();}
});
