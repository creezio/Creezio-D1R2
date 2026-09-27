import type {JsonValue} from '../../../../core/data/types.ts';
import type {ProviderCreateInput,ProviderEvent,ProviderHttpPort,ProviderSnapshot,
  ProviderTransport} from '../../../../sdk/providers/types.ts';
import {ProviderTransportError} from '../../../../sdk/providers/errors.ts';

type ObjectValue=Record<string,unknown>;
const object=(value:unknown):ObjectValue|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:null;
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const safeId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128
  &&/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const MAX_EVENT_BYTES=262_144;
const MAX_JSON_BYTES=262_144;

async function* sse(response:Response):AsyncGenerator<ObjectValue> {
  if(!response.ok||!response.body||!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type')??''))
    throw new Error('provider_unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let buffer='', bytes=0;
  try{
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>MAX_EVENT_BYTES*256)throw new Error('provider_limit');
      buffer+=decoder.decode(chunk.value,{stream:true});
      buffer=buffer.replaceAll('\r\n','\n');
      if(buffer.length>MAX_EVENT_BYTES*2)throw new Error('provider_limit');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        if(frame.length>MAX_EVENT_BYTES)throw new Error('provider_limit');
        const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!data||data==='[DONE]')continue;
        const parsed=object(JSON.parse(data));
        if(parsed)yield parsed;
      }
    }
    buffer+=decoder.decode();
    if(buffer.trim())throw new Error('provider_invalid_response');
  }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}

function cursor(value:ObjectValue):number {
  if(!positive(value.sequence_number))throw new Error('provider_invalid_response');
  return value.sequence_number;
}
function normalize(value:ObjectValue):ProviderEvent[] {
  const sequence=cursor(value),type=value.type,events:ProviderEvent[]=[];
  if(type==='response.output_text.delta'){
    if(typeof value.delta!=='string')throw new Error('provider_invalid_response');
    events.push({cursor:sequence,kind:'text_delta',text:value.delta});
  }else if(type==='response.output_item.done'){
    const item=object(value.item);
    if(item?.type==='function_call'){
      if(!safeId(item.call_id)||!safeId(item.name)||typeof item.arguments!=='string'
        ||item.arguments.length>MAX_EVENT_BYTES)throw new Error('provider_invalid_response');
      events.push({cursor:sequence,kind:'function_call',callId:item.call_id,name:item.name,
        arguments:JSON.parse(item.arguments) as JsonValue});
    }
  }else if(type==='response.completed'||type==='response.failed'||type==='response.incomplete'){
    const response=object(value.response),usage=object(response?.usage);
    if(usage&&positive(usage.input_tokens)&&positive(usage.output_tokens))
      events.push({cursor:sequence,kind:'usage',inputTokens:usage.input_tokens,outputTokens:usage.output_tokens});
    events.push({cursor:sequence,kind:'terminal',state:type==='response.completed'?'succeeded':'failed',
      ...(type==='response.completed'?{}:{errorCode:type==='response.incomplete'?'incomplete':'provider_failed'})});
  }else if(type==='error')events.push({cursor:sequence,kind:'terminal',state:'failed',errorCode:'provider_error'});
  return events;
}
async function json(response:Response):Promise<ObjectValue> {
  if(!response.ok||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))
    throw new Error('provider_unavailable');
  const body=await response.text();
  if(new TextEncoder().encode(body).length>MAX_JSON_BYTES)throw new Error('provider_limit');
  const value=object(JSON.parse(body));
  if(!value)throw new Error('provider_invalid_response');
  return value;
}
function snapshot(response:ObjectValue):ProviderSnapshot {
  if(!safeId(response.id))throw new Error('provider_invalid_response');
  const state=response.status==='completed'?'succeeded':response.status==='failed'||response.status==='incomplete'?'failed':
    response.status==='cancelled'?'cancelled':response.status==='queued'?'queued':
      response.status==='in_progress'?'running':'unknown';
  const events:ProviderEvent[]=[],usage=object(response.usage);
  if(!Array.isArray(response.output)){
    if(state==='succeeded')throw new Error('provider_invalid_response');
  }else for(const raw of response.output){
    const item=object(raw);
    if(item?.type==='message'&&Array.isArray(item.content))for(const rawPart of item.content){
      const part=object(rawPart);
      if(part?.type==='output_text'&&typeof part.text==='string')
        events.push({cursor:0,kind:'text_delta',text:part.text});
    }
    if(item?.type==='function_call'){
      if(!safeId(item.call_id)||!safeId(item.name)||typeof item.arguments!=='string'
        ||item.arguments.length>MAX_EVENT_BYTES)throw new Error('provider_invalid_response');
      events.push({cursor:0,kind:'function_call',callId:item.call_id,name:item.name,
        arguments:JSON.parse(item.arguments) as JsonValue});
    }
  }
  if(usage&&positive(usage.input_tokens)&&positive(usage.output_tokens))
    events.push({cursor:0,kind:'usage',inputTokens:usage.input_tokens,outputTokens:usage.output_tokens});
  if(state==='succeeded'||state==='failed'||state==='cancelled')
    events.push({cursor:0,kind:'terminal',state,
      ...(response.status==='incomplete'?{errorCode:'incomplete'}:{})});
  return {responseId:response.id,state,cursor:null,events};
}

/** Fixed-endpoint host port supplies authorization. No API key enters this adapter. */
export function createOpenAITransport(http:ProviderHttpPort):ProviderTransport {
  return Object.freeze({
    async create(input:ProviderCreateInput,signal:AbortSignal){
      if(!safeId(input.turnId)||!safeId(input.modelId)||input.limits.maxOutputTokens<1)throw new Error('provider_invalid_input');
      const tools=input.tools.map(tool=>({type:'function',name:tool.name,description:tool.description,
        parameters:tool.parameters,strict:tool.strict??true}));
      const body:JsonValue={model:input.modelId,input:[...input.inputItems],tools,
        max_output_tokens:input.limits.maxOutputTokens,parallel_tool_calls:false,
        background:true,stream:true,store:false};
      const response=await http.request({method:'POST',resource:'responses',body,signal});
      if(!response.ok){
        if(response.status===429)throw new ProviderTransportError('rejected','provider_rate_limited');
        if(response.status>=400&&response.status<500)throw new ProviderTransportError('rejected','provider_rejected');
        throw new ProviderTransportError('unknown','provider_unavailable');
      }
      const frames=sse(response),iterator=frames[Symbol.asyncIterator]();
      let first;
      try{first=await iterator.next();}catch(error){await iterator.return?.(undefined);throw error;}
      const value=first.value,responseData=object(value?.response);
      if(first.done||value?.type!=='response.created'||!responseData||!safeId(responseData.id)){
        await iterator.return?.(undefined);throw new Error('provider_invalid_response');
      }
      const receipt={responseId:responseData.id,cursor:cursor(value)};
      const events:AsyncIterable<ProviderEvent>={async *[Symbol.asyncIterator](){
        try{for(let next=await iterator.next();!next.done;next=await iterator.next())
          for(const event of normalize(next.value))yield event;
        }finally{await iterator.return?.(undefined);}
      }};
      return {receipt,events};
    },
    async *resume(responseId:string,afterCursor:number,signal:AbortSignal){
      if(!safeId(responseId)||!positive(afterCursor))throw new Error('provider_invalid_input');
      const response=await http.request({method:'GET',resource:'response-stream',responseId,afterCursor,signal});
      for await(const frame of sse(response))for(const event of normalize(frame))yield event;
    },
    async status(responseId:string,signal:AbortSignal){
      if(!safeId(responseId))throw new Error('provider_invalid_input');
      return snapshot(await json(await http.request({method:'GET',resource:'response',responseId,signal})));
    },
    async cancel(responseId:string,signal:AbortSignal){
      if(!safeId(responseId))throw new Error('provider_invalid_input');
      return snapshot(await json(await http.request({method:'POST',resource:'response-cancel',responseId,signal})));
    }
  });
}
