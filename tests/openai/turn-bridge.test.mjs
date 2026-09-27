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
          yield {cursor:2,kind:'terminal',state:'succeeded'};})()};},
      async *resume(){throw new Error('Unexpected resume');},
      async status(){throw new Error('Unexpected status');},async cancel(){throw new Error('Unexpected cancel');}
    },'model-a')};
    const bridge=createTurnBridge({db,catalog,permissions,provider,registry:reg,toolCatalog:[]});
    const driveRequest={credential,contextId:'application',audience:'admin',conversationId,turnId,
      signal:new AbortController().signal};
    const first=await bridge.drive(driveRequest);
    assert.equal(first.turn.state,'succeeded');
    assert.equal(creates,1);
    const messages=await invoke('message.list',{conversationId,limit:50});
    assert.equal(messages.execution.output.items.filter(item=>item.role==='assistant').length,1);
    assert.equal(messages.execution.output.items.find(item=>item.role==='assistant').body,'Hi');
    assert.equal((await bridge.drive(driveRequest)).turn.state,'succeeded');
    assert.equal(creates,1);

    const second=await invoke('conversation.create',{requestKey:'create-two',mode:'chat',title:'Two'});
    const secondId=second.execution.output.conversation.id;
    const queued=await invoke('turn.start',{requestKey:'start-two',conversationId:secondId,messageId:'user-two',
      body:'Again',modelId:'model-a',revision:1,draftRevision:0});
    const unknownId=queued.execution.output.turn.id;
    let uncertainCreates=0;
    const uncertain=createTurnBridge({db,catalog,permissions,registry:reg,toolCatalog:[],
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
          })()};
        }
        continued=input.inputItems;
        return {receipt:{responseId:`resp_${label}_2`,cursor:0},events:(async function*(){
          yield {cursor:1,kind:'text_delta',text:'Read complete'};
          yield {cursor:2,kind:'terminal',state:'succeeded'};
        })()};
      },async *resume(){throw new Error('Unexpected resume');},
      async status(){throw new Error('Unexpected status');},async cancel(){throw new Error('Unexpected cancel');}},'model-a')};
      const toolBridge=createTurnBridge({db,catalog,permissions,provider:toolProvider,registry:reg,
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
    const preflightRequest=await newTurn('preflight');
    const preflight=createTurnBridge({db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async()=>{throw new Error('configuration became unavailable');}}});
    assert.equal((await preflight.drive(preflightRequest)).turn.state,'failed');
    assert.equal((await invoke('conversation.read',{conversationId:preflightRequest.conversationId}))
      .execution.output.conversation.revision,3);

    const rejectedRequest=await newTurn('rejected');
    const rejected=createTurnBridge({db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({async create(){
        throw new ProviderTransportError('rejected','provider_rejected');}},'model-a')}});
    const rejectedTurn=await rejected.drive(rejectedRequest);
    assert.equal(rejectedTurn.turn.state,'failed');
    assert.equal(rejectedTurn.turn.errorCode,'provider_rejected');

    const eofRequest=await newTurn('eof');
    let statuses=0;
    const eof=createTurnBridge({db,catalog,permissions,registry:reg,toolCatalog:[],
      provider:{withTransport:async(_request,callback)=>callback({
        async create(){return {receipt:{responseId:'resp_eof',cursor:0},events:(async function*(){
          yield {cursor:1,kind:'text_delta',text:'Final'};
        })()};},
        async status(){statuses++;return {responseId:'resp_eof',state:'succeeded',cursor:null,
          events:[{cursor:0,kind:'text_delta',text:'Final answer'},
            {cursor:0,kind:'terminal',state:'succeeded'}]};}
      },'model-a')}});
    assert.equal((await eof.drive(eofRequest)).turn.state,'succeeded');
    assert.equal(statuses,1);
    const eofMessages=await invoke('message.list',{conversationId:eofRequest.conversationId,limit:50});
    assert.equal(eofMessages.execution.output.items.find(item=>item.role==='assistant').body,'Final answer');

    const cancelRequest=await newTurn('cancel');
    let cancelCalls=0;
    const cancelled=createTurnBridge({db,catalog,permissions,registry:reg,toolCatalog:[],
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

    for(const state of ['failed','cancelled']){
      const terminalRequest=await newTurn(`terminal-${state}`);
      let toolContinued=false;
      const terminalBridge=createTurnBridge({db,catalog,permissions,registry:reg,toolCatalog:[],
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

    const historyRequest=await newTurn('history',18,'Newest prompt');
    let capturedHistory;
    const historyBridge=createTurnBridge({db,catalog,permissions,registry:reg,toolCatalog:[],
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
    const pendingBridge=createTurnBridge({db,catalog,permissions,registry:reg,
      toolCatalog:[{moduleId:id,operationId:'draft.read',inputSchema:pendingSchema,
        schemaDigest:`sha256-${'f'.repeat(64)}`,audiences:['admin']}],
      provider:{withTransport:async(_request,callback)=>callback({async create(input){
        pendingCreates++;
        if(pendingCreates===1){const name=input.tools.find(item=>item.bindingId===`${id}:draft.read`)?.name;
          assert.ok(name);
          return {receipt:{responseId:'resp_pending_1',cursor:0},events:(async function*(){
            yield {cursor:1,kind:'function_call',callId:'call_pending',name,
              arguments:{conversationId:pendingRequest.conversationId}};
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
    await db.prepare(`UPDATE "${OPERATION_TABLES.outbox}" SET claim_expires_at_ms=0 WHERE intent_id=?`)
      .bind(pendingRequest.turnId).run();
    assert.equal((await pendingBridge.drive(pendingRequest)).turn.state,'running');
    assert.equal(await toolReads(),readsBefore+1);
    assert.equal((await pendingBridge.drive(pendingRequest)).turn.state,'succeeded');
    assert.equal(pendingCreates,2);
  }finally{await runtime.dispose();}
});
