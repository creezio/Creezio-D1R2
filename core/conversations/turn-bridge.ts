import {createDataAccess} from '../data/service.ts';
import type {DataCredential,DataLease,DataRecord,JsonValue,PermissionDefinition,RuntimeDataCatalog} from '../data/types.ts';
import type {AuthorizationAudience} from '../authorization/types.ts';
import type {IdentityDatabase} from '../identity/d1-store.ts';
import {createOperationStore} from '../operations/store.ts';
import type {DeliveryClaim,OperationDelivery} from '../operations/store-types.ts';
import {OperationError} from '../operations/types.ts';
import {createOperationEngine} from '../operations/service.ts';
import type {OperationRegistry} from '../operations/registry.ts';
import {projectAuthorizedReadTools,type ProviderOperationSchema} from '../providers/tools.ts';
import type {ProviderEvent,ProviderTransport} from '../../sdk/providers/types.ts';
import {ProviderTransportError} from '../../sdk/providers/errors.ts';
import type {createOpenAiProviderHost} from '../providers/host.ts';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER='openai.responses.v1';
type Request={readonly credential:DataCredential;readonly contextId:string;readonly audience:AuthorizationAudience;
  readonly conversationId:string;readonly turnId:string;readonly signal:AbortSignal};
type Row=DataRecord;
const now=()=>new Date().toISOString();
const view=(row:Row)=>({id:row.id,conversationId:row.conversation_id,state:row.state,
  providerId:row.provider_id,updatedAt:row.updated_at,revision:row.revision,
  lastSequence:row.last_sequence,errorCode:row.error_code});

/** A client driven, request bounded step. Read routes never call this bridge. */
export function createTurnBridge(options:{readonly db:IdentityDatabase;readonly catalog:RuntimeDataCatalog;
  readonly permissions:readonly PermissionDefinition[];readonly provider:ReturnType<typeof createOpenAiProviderHost>;
  readonly registry:OperationRegistry;readonly toolCatalog:readonly ProviderOperationSchema[]}){
  const data=createDataAccess(options.db,{catalog:options.catalog,permissions:options.permissions});
  const store=createOperationStore({db:options.db,data});
  const engine=createOperationEngine({db:options.db,catalog:options.catalog,permissions:options.permissions,
    registry:options.registry});
  const authorize=(request:Request)=>data.authorize(request.credential,{
    contextId:request.contextId,audience:request.audience,actors:['user','delegated-user'],
    requiredPermissionIds:['creezio.conversations:use'],purpose:'operation'}, {moduleId:'creezio.conversations'});
  const scope=(lease:DataLease)=>{const identity=data.describeLease(lease);
    return {owner_id:identity.principalId,audience:identity.audience};};
  const port=(lease:DataLease)=>data.forModule(lease,'creezio.conversations');
  const parentKey=(lease:DataLease,id:string)=>({...scope(lease),id});
  const childKey=(lease:DataLease,conversationId:string,id:string)=>({...scope(lease),conversation_id:conversationId,id});
  const readTurn=async(lease:DataLease,request:Request)=>port(lease).get('turn',{
    key:childKey(lease,request.conversationId,request.turnId)});
  const readParent=async(lease:DataLease,request:Request)=>port(lease).get('conversation',{
    key:parentKey(lease,request.conversationId)});
  const checked=async(lease:DataLease,request:Request)=>{
    const [parent,turn]=await Promise.all([readParent(lease,request),readTurn(lease,request)]);
    if(!parent||!turn||turn.provider_id!==PROVIDER
      ||parent.active_turn_id!==request.turnId
        &&!['succeeded','failed','cancelled'].includes(String(turn.state)))
      throw new OperationError('not_found');
    if(parent.archived_at!==null&&!['succeeded','failed','cancelled'].includes(String(turn.state)))
      throw new OperationError('conflict');
    return {parent,turn};
  };
  async function change(lease:DataLease,request:Request,delivery:OperationDelivery,claim:DeliveryClaim,
    event:{cursor:number;kind:string;payload:JsonValue},changes:Record<string,JsonValue>,
    message?:{body:string},terminal=false,confirmedSnapshot=false){
    const {parent,turn}=await checked(lease,request),seq=Number(turn.last_sequence)+1,time=now();
    if(turn.state==='cancel_requested'&&!confirmedSnapshot)throw new OperationError('conflict');
    const p=port(lease),plans=[];
    const turnChanges={...changes,...(turn.state==='cancel_requested'&&!terminal?{state:'cancel_requested'}:{}),
      updated_at:time,last_sequence:seq};
    plans.push(p.planPatch('turn',{key:childKey(lease,request.conversationId,request.turnId),
      where:{state:turn.state},compare:{field:'revision',expected:Number(turn.revision)},values:turnChanges}));
    plans.push(p.planCreate('event',{values:{...scope(lease),conversation_id:request.conversationId,
      turn_id:request.turnId,sequence:seq,kind:event.kind,payload:event.payload,created_at:time}}));
    if(message){
      plans.push(p.planCreate('message',{values:{...scope(lease),conversation_id:request.conversationId,
        id:request.turnId,role:'assistant',body:message.body,content:null,created_at:time,revision:1}}));
    }
    if(terminal)plans.push(p.planPatch('conversation',{key:parentKey(lease,request.conversationId),
      where:{active_turn_id:request.turnId,archived_at:null},compare:{field:'revision',expected:Number(parent.revision)},
      values:{active_turn_id:null,updated_at:time}}));
    const retained=terminal?null:pendingTool(delivery);
    const checkpoint={providerReference:String((delivery.receipt as Row)?.providerReference),cursor:event.cursor,
      ...(retained?{pendingTool:retained}:{})};
    if(terminal)await store.settleDelivery(lease,claim,{state:changes.state==='failed'?'failed':'succeeded',
      receipt:checkpoint},plans);
    else await store.checkpointDelivery(lease,claim,checkpoint,plans);
    return await readTurn(lease,request);
  }
  const eventBody=async(lease:DataLease,request:Request)=>{
    let after:DataRecord|null=null;
    for(let index=0;index<32;index++){
      const page=await port(lease).list('event',{limit:1,where:{...scope(lease),
        conversation_id:request.conversationId,turn_id:request.turnId},after,
        order:{indexId:'by-turn',direction:'desc'}});
      const payload=page.items[0]?.payload;
      if(payload&&typeof payload==='object'&&!Array.isArray(payload)
        &&typeof (payload as Record<string,JsonValue>).body==='string')
        return String((payload as Record<string,JsonValue>).body);
      after=page.nextAfter;if(!after)return '';
    }
    throw new OperationError('invalid_output');
  };
  const history=async(lease:DataLease,request:Request)=>{
    const items:JsonValue[]=[];let bytes=0,after:DataRecord|null=null;
    for(let index=0;index<24;index++){
      // A one-row page keeps the DataAccess result below its 256 KiB guard even
      // when the newest messages contain the maximum 16k UTF-8 bodies.
      const page=await port(lease).list('message',{limit:1,
        where:{...scope(lease),conversation_id:request.conversationId},after,
        order:{indexId:'chronology',direction:'desc'}});
      const row=page.items[0];if(!row)break;
      if(['user','assistant'].includes(String(row.role))&&row.id!==request.turnId){
        const body=String(row.body??''),size=new TextEncoder().encode(body).length;
        if(bytes+size>32_000)break;
        bytes+=size;items.push({role:row.role,content:body});
      }
      after=page.nextAfter;if(!after)break;
    }
    return items.reverse();
  };
  const receipt=(delivery:OperationDelivery):{providerReference:string;cursor:number}|null=>{
    const value=delivery.receipt as Record<string,JsonValue>|null;
    return value&&typeof value==='object'&&!Array.isArray(value)
      &&typeof value.providerReference==='string'&&ID.test(value.providerReference)
      &&Number.isSafeInteger(value.cursor)&&Number(value.cursor)>=0
      ?{providerReference:value.providerReference,cursor:Number(value.cursor)}:null;
  };
  type Usage={inputTokens:number;outputTokens:number};
  type PendingTool={callId:string;name:string;arguments:JsonValue;result:JsonValue;usage?:Usage};
  const pendingTool=(delivery:OperationDelivery):PendingTool|null=>{
    const value=delivery.receipt as Record<string,JsonValue>|null;
    const pending=value?.pendingTool;
    if(!pending||typeof pending!=='object'||Array.isArray(pending))return null;
    const item=pending as Record<string,JsonValue>;
    const usage=item.usage as Record<string,JsonValue>|undefined;
    return typeof item.callId==='string'&&ID.test(item.callId)&&typeof item.name==='string'
      &&ID.test(item.name)&&Object.hasOwn(item,'arguments')&&Object.hasOwn(item,'result')
      &&(usage===undefined||usage&&typeof usage==='object'&&!Array.isArray(usage)
        &&Number.isSafeInteger(usage.inputTokens)&&Number(usage.inputTokens)>=0
        &&Number.isSafeInteger(usage.outputTokens)&&Number(usage.outputTokens)>=0)
      ?item as PendingTool:null;
  };
  const project=(request:Request)=>projectAuthorizedReadTools({catalog:options.toolCatalog,
    registry:options.registry,data,request});
  const invokeTool=async(request:Request,name:string,args:JsonValue):Promise<JsonValue>=>{
    const projected=await project(request),selected=projected.tools.find(item=>item.provider.name===name);
    if(!selected)return {error:'forbidden'};
    const operation=options.registry.resolve(selected.moduleId,selected.operationId);
    if(!operation.validateInput(args))return {error:'invalid_input'};
    try{
      const result=await engine.invoke({credential:request.credential,moduleId:selected.moduleId,
        operationId:selected.operationId,contextId:request.contextId,audience:request.audience,input:args,
        signal:request.signal});
      return result.execution.state==='succeeded'?{output:result.execution.output}:
        {error:result.execution.errorCode??'unknown'};
    }catch(error){return {error:error instanceof OperationError?error.code:'unavailable'};}
  };
  const prepareTool=async(request:Request,call:{callId:string;name:string;arguments:JsonValue},usage:Usage|null)=>{
    if(!ID.test(call.callId)||!ID.test(call.name))throw new OperationError('invalid_input');
    const args=JSON.stringify(call.arguments);
    if(new TextEncoder().encode(args).length>4_096)return null;
    let result=await invokeTool(request,call.name,call.arguments);
    if(new TextEncoder().encode(JSON.stringify(result)).length>8_192)
      result={error:'tool_output_too_large'};
    const tool:PendingTool={callId:call.callId,name:call.name,arguments:call.arguments,result,
      ...(usage?{usage}:{})};
    if(new TextEncoder().encode(JSON.stringify(tool)).length>12_000)return null;
    return tool;
  };
  const appendTool=async(lease:DataLease,request:Request,delivery:OperationDelivery,claim:DeliveryClaim,
    tool:PendingTool,modelId:string)=>{
    const turn=await readTurn(lease,request);
    if(!turn)throw new OperationError('not_found');
    if(turn.state==='cancel_requested')throw new OperationError('conflict');
    const prior=await history(lease,request),nextId=crypto.randomUUID();
    const inputItems:JsonValue[]=[...prior,
      {type:'function_call',call_id:tool.callId,name:tool.name,arguments:JSON.stringify(tool.arguments)},
      {type:'function_call_output',call_id:tool.callId,output:JSON.stringify(tool.result)}];
    if(new TextEncoder().encode(JSON.stringify(inputItems)).length>24_000)throw new OperationError('invalid_output');
    const time=now(),sequence=Number(turn.last_sequence)+1,p=port(lease);
    const plans=[p.planPatch('turn',{key:childKey(lease,request.conversationId,request.turnId),
      compare:{field:'revision',expected:Number(turn.revision)},values:{updated_at:time,last_sequence:sequence}}),
      p.planCreate('event',{values:{...scope(lease),conversation_id:request.conversationId,
        turn_id:request.turnId,sequence,kind:'tool_result',
        payload:{callId:tool.callId,state:Object.hasOwn(tool.result as object,'output')?'succeeded':'rejected',
          body:await eventBody(lease,request),...(tool.usage?{usage:tool.usage}:{})},created_at:time}})];
    await store.appendDelivery(lease,claim,{plans,intent:{id:nextId,provider:PROVIDER,
      providerIdempotencyKey:`${request.turnId}:${tool.callId}`,
      payload:{conversationId:request.conversationId,turnId:request.turnId,modelId,step:1,inputItems}}});
  };
  const cancelUnsent=async(lease:DataLease,request:Request,claim:DeliveryClaim)=>{
    const {turn,parent}=await checked(lease,request),time=now(),seq=Number(turn.last_sequence)+1,p=port(lease);
    if(turn.state!=='cancel_requested')throw new OperationError('conflict');
    await store.settleDelivery(lease,claim,{state:'succeeded'},[
      p.planPatch('turn',{key:childKey(lease,request.conversationId,request.turnId),
        compare:{field:'revision',expected:Number(turn.revision)},
        values:{state:'cancelled',updated_at:time,last_sequence:seq}}),
      p.planCreate('event',{values:{...scope(lease),conversation_id:request.conversationId,
        turn_id:request.turnId,sequence:seq,kind:'cancelled',payload:{},created_at:time}}),
      p.planPatch('conversation',{key:parentKey(lease,request.conversationId),
        where:{active_turn_id:request.turnId},compare:{field:'revision',expected:Number(parent.revision)},
        values:{active_turn_id:null,updated_at:time}})]);
  };
  const failUnsent=async(lease:DataLease,request:Request,claim:DeliveryClaim,code:string)=>{
    const {turn,parent}=await checked(lease,request),time=now(),seq=Number(turn.last_sequence)+1,p=port(lease);
    if(turn.state==='cancel_requested')return cancelUnsent(lease,request,claim);
    await store.settleDelivery(lease,claim,{state:'failed'},[
      p.planPatch('turn',{key:childKey(lease,request.conversationId,request.turnId),
        compare:{field:'revision',expected:Number(turn.revision)},
        values:{state:'failed',error_code:code,updated_at:time,last_sequence:seq}}),
      p.planCreate('event',{values:{...scope(lease),conversation_id:request.conversationId,
        turn_id:request.turnId,sequence:seq,kind:'failed',payload:{code},created_at:time}}),
      p.planPatch('conversation',{key:parentKey(lease,request.conversationId),
        where:{active_turn_id:request.turnId},compare:{field:'revision',expected:Number(parent.revision)},
        values:{active_turn_id:null,updated_at:time}})]);
  };
  async function projectNoReceiptUnknown(lease:DataLease,request:Request){
    const turn=await readTurn(lease,request);
    if(!turn||['succeeded','failed','cancelled','unknown'].includes(String(turn.state)))return;
    const seq=Number(turn.last_sequence)+1,time=now(),p=port(lease);
    await data.commitBatch(lease,[p.planPatch('turn',{key:childKey(lease,request.conversationId,request.turnId),
      where:{state:turn.state},compare:{field:'revision',expected:Number(turn.revision)},values:{state:'unknown',error_code:'provider_unknown',
        updated_at:time,last_sequence:seq}}),p.planCreate('event',{values:{...scope(lease),
          conversation_id:request.conversationId,turn_id:request.turnId,sequence:seq,kind:'unknown',
          payload:turn.state==='cancel_requested'?{cancelRequested:true}:{},created_at:time}})]);
  }
  async function markUnknown(lease:DataLease,request:Request,delivery:OperationDelivery,claim:DeliveryClaim){
    try{
      const handle=receipt(delivery);
      if(!handle)await projectNoReceiptUnknown(lease,request);
      else{
        const turn=await readTurn(lease,request);
        if(turn&&!['succeeded','failed','cancelled','unknown','cancel_requested'].includes(String(turn.state)))
          await change(lease,request,delivery,claim,{cursor:handle.cursor,kind:'unknown',payload:{body:await eventBody(lease,request)}},
            {state:'unknown',error_code:'provider_unknown'});
      }
    }catch{/* Retain the durable outbox uncertainty even if the UI projection cannot be updated. */}
    try{await store.settleDelivery(lease,claim,{state:'unknown'});}catch{}
  }
  return Object.freeze({async drive(request:Request){
    if(!ID.test(request.conversationId)||!ID.test(request.turnId))throw new OperationError('invalid_input');
    const lease=await authorize(request);
    try{
      const initial=await checked(lease,request);
      if(['succeeded','failed','cancelled'].includes(String(initial.turn.state)))return {turn:view(initial.turn)};
      const delivery=await store.findDelivery(lease,request.turnId);
      if(!delivery||delivery.provider!==PROVIDER)throw new OperationError('not_found');
      if(delivery.state==='succeeded'||delivery.state==='failed')return {turn:view((await readTurn(lease,request))!)};
      if(delivery.state==='unknown'&&!receipt(delivery)){
        try{await projectNoReceiptUnknown(lease,request);}catch{/* A concurrent turn update can be retried by the next drive. */}
        return {turn:view((await readTurn(lease,request))!)};
      }
      if(delivery.state!=='queued'&&!receipt(delivery))return {turn:view(initial.turn)};
      const acquired=delivery.state==='queued'
        ?await store.claimDelivery(lease,{executionId:delivery.executionId,outboxId:delivery.id,claimTtlMs:30_000})
        :await store.resumeKnownDelivery(lease,{executionId:delivery.executionId,outboxId:delivery.id,claimTtlMs:30_000});
      if(!acquired)return {turn:view((await readTurn(lease,request))!)};
      let current=acquired.delivery,attemptedCreate=false;
      try{
        const payload=current.payload as Record<string,JsonValue>|null;
        if(!payload||typeof payload!=='object'||Array.isArray(payload)
          ||payload.turnId!==request.turnId||payload.conversationId!==request.conversationId
          ||typeof payload.modelId!=='string'||!ID.test(payload.modelId))throw new OperationError('invalid_input');
        const step=payload.step===1?1:0;
        if(initial.turn.state==='cancel_requested'&&!receipt(current)){
          await cancelUnsent(lease,request,acquired.claim);
          return {turn:view((await readTurn(lease,request))!)};
        }
        const result=await options.provider.withTransport(request,async(transport:ProviderTransport,modelId:string)=>{
          const known=receipt(current);
          if(!known&&modelId!==payload.modelId)throw new OperationError('conflict');
          const requestedModel=String(payload.modelId);
          let observedUsage:Usage|null=null;
          const usagePayload=():Record<string,JsonValue>=>observedUsage
            ?{usage:{inputTokens:observedUsage.inputTokens,outputTokens:observedUsage.outputTokens}}:{};
          const diagnosticPayload=(diagnostics:readonly string[])=>{
            // Progress is visible to the caller. Do not reveal catalog entries that
            // failed authorization, or their schema/operation names.
            const allowed=new Set(['invalid_catalog','inactive','unsupported_schema','invalid_schema',
              'forbidden','collision','limit','unavailable']);
            const counts=new Map<string,number>();
            for(const item of diagnostics.slice(0,1000)){
              const suffix=item.slice(item.lastIndexOf(':')+1);
              const code=allowed.has(suffix)?suffix:'other';
              counts.set(code,(counts.get(code)??0)+1);
            }
            return {toolDiagnostics:[...counts].map(([code,count])=>({code,count})),
              toolDiagnosticsTruncated:diagnostics.length>1000};
          };
          const reconcileSnapshot=async(snapshot:Awaited<ReturnType<ProviderTransport['status']>>,
            streamError?:unknown):Promise<boolean|null>=>{
            if(!['succeeded','failed','cancelled'].includes(snapshot.state)){
              if(streamError)throw streamError;
              return null;
            }
            const handle=receipt(current);
            if(!handle||snapshot.responseId!==handle.providerReference)throw new OperationError('conflict');
            const snapshotUsage=snapshot.events.findLast(item=>item.kind==='usage');
            if(snapshotUsage?.kind==='usage')observedUsage={inputTokens:snapshotUsage.inputTokens,
              outputTokens:snapshotUsage.outputTokens};
            const call=snapshot.state==='succeeded'
              ?snapshot.events.find(item=>item.kind==='function_call'):undefined;
            if(call?.kind==='function_call'){
              if((await readTurn(lease,request))?.state==='cancel_requested'){
                await change(lease,request,current,acquired.claim,{cursor:handle.cursor+1,
                  kind:'cancelled',payload:usagePayload()},
                  {state:'cancelled',error_code:null},undefined,true,true);
                return true;
              }
              if(step!==0)throw new OperationError('conflict');
              const tool=await prepareTool(request,call,observedUsage);
              if(!tool){await change(lease,request,current,acquired.claim,{cursor:handle.cursor+1,
                kind:'failed',payload:{code:'tool_arguments_too_large'}},
                {state:'failed',error_code:'tool_arguments_too_large'},undefined,true);return true;}
              current=await store.checkpointDelivery(lease,acquired.claim,{providerReference:handle.providerReference,
                cursor:handle.cursor+1,pendingTool:tool});
              await appendTool(lease,request,current,acquired.claim,tool,requestedModel);
              return true;
            }
            if(snapshot.state==='succeeded'){
              const finalText=snapshot.events.filter(item=>item.kind==='text_delta')
                .map(item=>item.kind==='text_delta'?item.text:'').join('');
              const existing=await eventBody(lease,request);
              if(!finalText.startsWith(existing))throw streamError??new OperationError('conflict');
              const suffix=finalText.slice(existing.length);
              if(new TextEncoder().encode(finalText).length>16_000)throw new OperationError('invalid_output');
              let cursor=handle.cursor;
              if(suffix){cursor++;
                await change(lease,request,current,acquired.claim,{cursor,kind:'text_delta',payload:{text:suffix,body:finalText}},
                  {state:'running'},undefined,false,true);
                current=(await store.readDelivery(lease,{executionId:delivery.executionId,outboxId:delivery.id}))!;
              }
              await change(lease,request,current,acquired.claim,{cursor:cursor+1,kind:'completed',
                payload:{messageId:request.turnId,...usagePayload()}},{state:'succeeded',error_code:null},{body:finalText},true,true);
              return true;
            }
            await change(lease,request,current,acquired.claim,{cursor:handle.cursor+1,kind:snapshot.state,
              payload:snapshot.state==='cancelled'?usagePayload():{code:'provider_failed',...usagePayload()}},
              {state:snapshot.state,error_code:snapshot.state==='cancelled'?null:'provider_failed'},undefined,true,true);
            return true;
          };
          if(initial.turn.state==='cancel_requested'&&known){
            let snapshot;
            try{snapshot=await transport.cancel(known.providerReference,request.signal);}
            catch{snapshot=await transport.status(known.providerReference,request.signal);}
            return reconcileSnapshot(snapshot);
          }
          const pending=pendingTool(current);
          if(pending){
            if(step!==0)throw new OperationError('conflict');
            await appendTool(lease,request,current,acquired.claim,pending,requestedModel);
            return true;
          }
          let events:AsyncIterable<ProviderEvent>;
          if(known){
            if(initial.turn.state==='queued'){
              let diagnostics:readonly string[]=[];
              try{diagnostics=(await project(request)).diagnostics;}catch{diagnostics=['catalog:unavailable'];}
              await change(lease,request,current,acquired.claim,{cursor:known.cursor,kind:'started',
                payload:{body:'',...diagnosticPayload(diagnostics)}},
                {state:'running'});
              current=(await store.readDelivery(lease,{executionId:delivery.executionId,outboxId:delivery.id}))!;
            }
            events=transport.resume(known.providerReference,known.cursor,request.signal);
          }
          else{
            const projected=step===0?await project(request):null;
            const inputItems=step===1&&Array.isArray(payload.inputItems)
              ?payload.inputItems as JsonValue[]:await history(lease,request);
            if(step===1&&!Array.isArray(payload.inputItems))throw new OperationError('invalid_input');
            if((await readTurn(lease,request))?.state==='cancel_requested'){
              await cancelUnsent(lease,request,acquired.claim);
              return true;
            }
            attemptedCreate=true;
            const stream=await transport.create({turnId:request.turnId,modelId,inputItems,
              tools:projected?.tools.map(item=>item.provider)??[],
              limits:{maxInputBytes:32_000,maxOutputBytes:16_000,maxOutputTokens:4096,
                maxToolCalls:step===0?1:0,deadlineMs:25_000}},request.signal);
            current=await store.checkpointDelivery(lease,acquired.claim,{providerReference:stream.receipt.responseId,
              cursor:stream.receipt.cursor});
            const turn=await readTurn(lease,request);
            if(turn?.state==='queued'||turn?.state==='unknown'){
              // The progress row is started under the same durable provider cursor.
              await change(lease,request,current,acquired.claim,{cursor:stream.receipt.cursor,kind:'started',
                payload:{body:'',...diagnosticPayload(projected?.diagnostics??[])}},
                {state:'running'});
              current=(await store.readDelivery(lease,{executionId:delivery.executionId,outboxId:delivery.id}))!;
            }
            events=stream.events;
          }
          let pendingCall:Extract<ProviderEvent,{kind:'function_call'}>|null=null;
          try{for await(const event of events){
            if(request.signal.aborted)break;
            const handle=receipt(current);
            if(!handle||event.cursor<=handle.cursor)continue;
            const live=await readTurn(lease,request);
            if(live?.state==='cancel_requested'){
              let snapshot;
              try{snapshot=await transport.cancel(handle.providerReference,request.signal);}
              catch{snapshot=await transport.status(handle.providerReference,request.signal);}
              return reconcileSnapshot(snapshot);
            }
            if(event.kind==='usage'){
              observedUsage={inputTokens:event.inputTokens,outputTokens:event.outputTokens};
              continue;
            }
            if(event.kind==='function_call'){
              if(step!==0||pendingCall){
                await change(lease,request,current,acquired.claim,{cursor:event.cursor,kind:'failed',payload:{code:'tool_limit'}},
                  {state:'failed',error_code:'tool_limit'},undefined,true);
                return true;
              }
              // Do not run the tool before the provider response reaches its
              // terminal frame: usage arrives there, and an interrupted stream
              // can safely replay this uncheckpointed call.
              pendingCall=event;
              continue;
            }
            if(event.kind==='text_delta'){
              if(pendingCall)continue;
              const body=(await eventBody(lease,request))+event.text;
              if(new TextEncoder().encode(body).length>16_000)throw new OperationError('invalid_output');
              await change(lease,request,current,acquired.claim,{cursor:event.cursor,kind:'text_delta',payload:{text:event.text,body}},
                {state:'running'});
            }else if(event.kind==='terminal'){
              const state=event.state==='succeeded'?'succeeded':event.state==='cancelled'?'cancelled':'failed';
              if(state==='succeeded'&&pendingCall){
                const tool=await prepareTool(request,pendingCall,observedUsage);
                if(!tool){await change(lease,request,current,acquired.claim,{cursor:event.cursor,
                  kind:'failed',payload:{code:'tool_arguments_too_large',...usagePayload()}},
                  {state:'failed',error_code:'tool_arguments_too_large'},undefined,true);return true;}
                current=await store.checkpointDelivery(lease,acquired.claim,{providerReference:handle.providerReference,
                  cursor:event.cursor,pendingTool:tool});
                await appendTool(lease,request,current,acquired.claim,tool,requestedModel);
                return true;
              }
              const body=state==='succeeded'?await eventBody(lease,request):'';
              await change(lease,request,current,acquired.claim,{cursor:event.cursor,kind:state==='succeeded'?'completed':state,
                payload:state==='succeeded'?{messageId:request.turnId,...usagePayload()}
                  :{code:event.errorCode??'provider_failed',...usagePayload()}},
                {state,error_code:state==='succeeded'?null:event.errorCode??'provider_failed'},
                state==='succeeded'?{body}:undefined,true);
              return true;
            }
            current=(await store.readDelivery(lease,{executionId:delivery.executionId,outboxId:delivery.id}))!;
          }}catch(streamError){
            if(request.signal.aborted)throw streamError;
            const handle=receipt(current);
            if(!handle)throw streamError;
            const cancelled=(await readTurn(lease,request))?.state==='cancel_requested';
            let snapshot;
            if(cancelled){
              try{snapshot=await transport.cancel(handle.providerReference,request.signal);}
              catch{snapshot=await transport.status(handle.providerReference,request.signal);}
            }else snapshot=await transport.status(handle.providerReference,request.signal);
            return reconcileSnapshot(snapshot,streamError);
          }
          const handle=receipt(current);
          if(!handle)return null;
          return reconcileSnapshot(await transport.status(handle.providerReference,request.signal));
        });
        if(result===null){
          // The provider remains active. A later client drive resumes by the durable cursor after claim expiry.
          return {turn:view((await readTurn(lease,request))!)};
        }
        return {turn:view((await readTurn(lease,request))!)};
      }catch(error){
        if(!receipt(current)&&(!attemptedCreate
          ||error instanceof ProviderTransportError&&error.outcome==='rejected')){
          try{await failUnsent(lease,request,acquired.claim,
            error instanceof ProviderTransportError?error.code:
              error instanceof OperationError?error.code:'preflight_failed');}
          catch{await markUnknown(lease,request,current,acquired.claim);}
        }else await markUnknown(lease,request,current,acquired.claim);
        return {turn:view((await readTurn(lease,request))!)};
      }
    }finally{data.dispose(lease);}
  }});
}
