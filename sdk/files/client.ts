import {canonicalAccessOrigin, type AccessController} from '../access/types.ts';
import type {StagedFileReference} from './types.ts';

export type FileClientResult<T> = Readonly<{kind:'ready';value:T}> | Readonly<{kind:'rejected'|'unknown';code:string}>;
export interface UploadedFile {readonly reference:StagedFileReference;readonly filename:string;readonly contentType:string;readonly byteSize:number}
const maximum=10*1024*1024;
const id=(value:string)=>/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value)&&value.length<=128;
function ref(value:unknown):value is StagedFileReference {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const r=value as Record<string,unknown>;
  return Object.keys(r).sort().join(',')==='digest,fileId,generation,intentId'&&typeof r.fileId==='string'&&/^f1_[a-f0-9]{64}$/.test(r.fileId)
    &&typeof r.digest==='string'&&/^[a-f0-9]{64}$/.test(r.digest)&&['intentId','generation'].every(key=>typeof r[key]==='string'&&(r[key] as string).length>0&&(r[key] as string).length<=128&&!/[\u0000-\u001f\u007f]/.test(r[key] as string));
}
async function read(response:Response,limit:number):Promise<Uint8Array> {
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>limit)){void response.body?.cancel();throw new Error('invalid_response');}
  if(!response.body)return new Uint8Array();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const item=await reader.read();if(item.done)break;if(chunks.length>=16384||item.value.length>limit-size)throw new Error('invalid_response');size+=item.value.length;chunks.push(item.value);}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
  }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}

/** Native same-origin file transport. No bearer token or object URL is persisted. */
export function createFileClient(options:{access:AccessController;moduleId:string;categoryId:string;contextId:string;fetcher?:typeof fetch}) {
  const origin=canonicalAccessOrigin(options.access.origin),audience=options.access.audience;
  if(!origin||!['admin','app'].includes(audience)||!id(options.moduleId)||!id(options.categoryId)
    ||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.contextId))throw new Error('Invalid file client scope.');
  const url=`${origin}/api/files/${audience}/${options.moduleId}/${options.categoryId}`;
  const fetcher=options.fetcher??fetch;
  async function request<T>(method:'PUT'|'GET'|'DELETE',query:string,headers:Record<string,string>,body:Blob|undefined,
    decode:(response:Response,bytes:Uint8Array)=>T,isCurrent?:()=>boolean):Promise<FileClientResult<T>> {
    const before=options.access.getSnapshot();
    if(before.phase!=='authenticated'||before.pending||!before.session)return {kind:'rejected',code:'unauthorized'};
    if(isCurrent&&!isCurrent())return {kind:'rejected',code:'stale'};
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const current=()=>{const state=options.access.getSnapshot();return state.phase==='authenticated'&&!state.pending&&state.session?.id===before.session!.id
      &&state.session.principalId===before.session!.principalId&&state.session.audience===audience&&(!isCurrent||isCurrent());};
    let invalidated=false;
    const unsubscribe=options.access.subscribe(()=>{if(!current()){invalidated=true;abort.abort();}});
    let response:Response|undefined;
    try {
      const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();void response?.body?.cancel().catch(()=>{});reject(new Error('timeout'));},30000);});
      const run=async ():Promise<FileClientResult<T>>=>{
        response=await fetcher(url+query,{method,headers:{...headers,'x-creezio-context':options.contextId,...(method==='GET'?{}:{'x-creezio-request':'1'})},
          body,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:abort.signal});
        if(!(response instanceof Response)||response.redirected||response.url&&new URL(response.url).origin!==origin)throw new Error('invalid_response');
        const bytes=await read(response,method==='GET'&&response.status===200?maximum:16384);
        if(invalidated||!current())return {kind:'unknown',code:'stale'};
        if(response.status>=400&&response.status<500&&![408,499].includes(response.status)){
          let code='request_rejected';try{const result=JSON.parse(new TextDecoder().decode(bytes));if(typeof result.error?.code==='string'&&/^[a-z_]{1,64}$/.test(result.error.code))code=result.error.code;}catch{}
          return {kind:'rejected',code};
        }
        if(response.status!==(method==='PUT'?201:200))return {kind:'unknown',code:method==='GET'?'unavailable':'outcome_unknown'};
        return {kind:'ready',value:decode(response,bytes)};
      };
      return await Promise.race([run(),deadline]);
    }catch{return {kind:'unknown',code:invalidated||!current()?'stale':method==='GET'?'unavailable':'outcome_unknown'};}
    finally{if(timer)clearTimeout(timer);unsubscribe();abort.abort();}
  }
  const query=(reference:StagedFileReference)=>'?'+new URLSearchParams({...reference}).toString();
  async function download(reference:StagedFileReference,isCurrent?:()=>boolean,recordId?:string):Promise<FileClientResult<Blob>> {
    if(!ref(reference)||recordId!==undefined&&(typeof recordId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(recordId)))
      return {kind:'rejected',code:'invalid_input'};
    const suffix=recordId===undefined?'':`&recordId=${encodeURIComponent(recordId)}`;
    return request('GET',query(reference)+suffix,{},undefined,(response,bytes)=>{
      if(response.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase()!=='application/octet-stream')throw new Error('invalid_response');
      return new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'});
    },isCurrent);
  }
  return Object.freeze({
    async upload(input:{file:Blob;filename:string;intentId:string;generation?:string;isCurrent?:()=>boolean}):Promise<FileClientResult<UploadedFile>> {
      if(!(input.file instanceof Blob)||input.file.size>maximum||!input.filename||new TextEncoder().encode(input.filename).length>255
        ||/[\u0000-\u001f\u007f]/.test(input.filename)||!input.filename.isWellFormed()||!input.intentId||input.intentId.length>128)return {kind:'rejected',code:'invalid_input'};
      return request('PUT','',{'content-type':input.file.type||'application/octet-stream','x-creezio-file-name':encodeURIComponent(input.filename),
        'x-creezio-file-intent':input.intentId,'x-creezio-file-generation':input.generation??'1'},input.file,(_response,bytes)=>{
          const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
          if(!value||!ref(value.reference)||typeof value.filename!=='string'||value.filename.length>255||typeof value.contentType!=='string'
            ||!Number.isSafeInteger(value.byteSize)||value.byteSize!==input.file.size)throw new Error('invalid_response');
          return Object.freeze(value as UploadedFile);
        },input.isCurrent);
    },
    async download(reference:StagedFileReference,isCurrent?:()=>boolean):Promise<FileClientResult<Blob>> {
      return download(reference,isCurrent);
    },
    /** The server checks the declared link and record state; the reference alone grants no access. */
    async downloadLinked(reference:StagedFileReference,recordId:string,isCurrent?:()=>boolean):Promise<FileClientResult<Blob>> {
      if(typeof recordId!=='string'||!recordId)return {kind:'rejected',code:'invalid_input'};
      return download(reference,isCurrent,recordId);
    },
    async abandon(reference:StagedFileReference,isCurrent?:()=>boolean):Promise<FileClientResult<{state:'abandoned';cleanup:'delete_confirmed'|'pending'}>> {
      if(!ref(reference))return {kind:'rejected',code:'invalid_input'};
      return request('DELETE',query(reference),{},undefined,(_response,bytes)=>{
        const value=JSON.parse(new TextDecoder().decode(bytes));
        if(value?.state!=='abandoned'||!['delete_confirmed','pending'].includes(value.cleanup))throw new Error('invalid_response');return value;
      },isCurrent);
    },
  });
}
