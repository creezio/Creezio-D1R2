/** Host-only signature verification. Modules receive bounded, verified data, never signing secrets. */
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_BODY=262_144;
const equal=(left:Uint8Array,right:Uint8Array)=>{
  if(left.length!==right.length)return false;
  let difference=0;
  for(let index=0;index<left.length;index++)difference|=left[index]^right[index];
  return difference===0;
};
const hex=(value:string)=>{
  if(!/^[a-f0-9]{64}$/iu.test(value))return null;
  return Uint8Array.from(value.match(/../gu)!,item=>Number.parseInt(item,16));
};
const base64=(value:string)=>{
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))return null;
  try{return Uint8Array.from(atob(value),char=>char.charCodeAt(0));}catch{return null;}
};
const mac=async(secret:Uint8Array,message:Uint8Array)=>{
  const key=await crypto.subtle.importKey('raw',new Uint8Array(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC',key,new Uint8Array(message)));
};
const stamp=(value:string,nowMs:number)=>{
  if(!/^[1-9][0-9]{9,11}$/u.test(value))return false;
  const seconds=Number(value);
  return Number.isSafeInteger(seconds)&&Math.abs(nowMs-seconds*1000)<=300_000;
};
const bodyBytes=(body:Uint8Array)=>body instanceof Uint8Array&&body.length>0&&body.length<=MAX_BODY;
export async function verifyStripeWebhook(input:Readonly<{body:Uint8Array;signature:string|null;
  secrets:readonly string[];nowMs?:number}>):Promise<boolean>{
  if(!bodyBytes(input.body)||!input.signature||input.signature.length>4096
    ||!input.secrets.length||input.secrets.length>3)return false;
  const parts=input.signature.split(',').map(part=>part.trim());
  const timestamps=parts.filter(part=>part.startsWith('t=')).map(part=>part.slice(2));
  const signatures=parts.filter(part=>part.startsWith('v1=')).map(part=>hex(part.slice(3))).filter(Boolean) as Uint8Array[];
  if(timestamps.length!==1||!stamp(timestamps[0],input.nowMs??Date.now())
    ||!signatures.length||signatures.length>8)return false;
  const message=new Uint8Array([...encoder.encode(`${timestamps[0]}.`),...input.body]);
  let matched=false;
  for(const secret of input.secrets){
    if(!/^whsec_[A-Za-z0-9_+\-/=]{16,512}$/u.test(secret))continue;
    const expected=await mac(encoder.encode(secret),message);
    for(const signature of signatures)matched=equal(expected,signature)||matched;
  }
  return matched;
}
export async function verifyStandardWebhook(input:Readonly<{body:Uint8Array;id:string|null;
  timestamp:string|null;signature:string|null;secrets:readonly string[];nowMs?:number}>):Promise<boolean>{
  if(!bodyBytes(input.body)||!input.id||!/^[A-Za-z0-9_-]{1,128}$/u.test(input.id)
    ||!input.timestamp||!stamp(input.timestamp,input.nowMs??Date.now())
    ||!input.signature||input.signature.length>4096||!input.secrets.length||input.secrets.length>3)return false;
  const signatures=input.signature.split(' ').filter(part=>part.startsWith('v1,'))
    .map(part=>base64(part.slice(3))).filter(Boolean) as Uint8Array[];
  if(!signatures.length||signatures.length>8)return false;
  const message=new Uint8Array([...encoder.encode(`${input.id}.${input.timestamp}.`),...input.body]);
  let matched=false;
  for(const secret of input.secrets){
    if(!secret.startsWith('whsec_'))continue;
    const key=base64(secret.slice(6));
    if(!key||key.length<24)continue;
    const expected=await mac(key,message);
    for(const signature of signatures)matched=equal(expected,signature)||matched;
  }
  return matched;
}
export async function readWebhookBody(request:Request):Promise<Uint8Array|null>{
  if(request.headers.has('content-encoding'))return null;
  const declared=request.headers.get('content-length');
  if(declared&&(!/^\d{1,6}$/u.test(declared)||Number(declared)>MAX_BODY))return null;
  if(!request.body)return null;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let size=0,stop:()=>void=()=>{};
  const aborted=new Promise<never>((_,reject)=>{stop=()=>reject(new Error('Webhook body interrupted'));});
  const cancel=()=>{stop();void reader.cancel().catch(()=>{});};
  const timer=setTimeout(cancel,10_000);
  request.signal.addEventListener('abort',cancel,{once:true});
  try{
    for(;;){
      const chunk=await Promise.race([reader.read(),aborted]);
      if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>MAX_BODY){void reader.cancel().catch(()=>{});return null;}
      chunks.push(chunk.value);
    }
    if(size===0)return null;
    const bytes=new Uint8Array(size);
    let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return bytes;
  }catch{return null;}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);
    try{reader.releaseLock();}catch{/* A cancelled stream can settle its pending read later. */}}
}
export function parseWebhookJson(body:Uint8Array):Record<string,unknown>|null{
  try{
    const parsed:unknown=JSON.parse(decoder.decode(body));
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)
      ?parsed as Record<string,unknown>:null;
  }catch{return null;}
}
export async function webhookBodyDigest(body:Uint8Array):Promise<string>{
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(body)));
  return [...hash].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
