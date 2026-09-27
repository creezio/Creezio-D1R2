import type {AccessController} from '../../sdk/access/types.ts';
import type {DeliveryInspection, DeliveryPrepared, DeliveryResult, DeliveryTransferStatus,
  DeliveryUpdateInspection, DeliveryUpdatePrepared, DeliveryUpdateStatus,
  DeliveryTransport} from '../../sdk/delivery/transport.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, keys: string[]): value is ObjectValue => object(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;
const fail = <T>(code: string): DeliveryResult<T> => ({ok:false,code});
function summary(value: unknown) {
  return exact(value,['title','details','warnings']) && text(value.title,256)
    && ['details','warnings'].every(key => Array.isArray(value[key]) && value[key].length <= 32
      && value[key].every((item: unknown) => text(item,512)));
}
function inspection(value: unknown): value is DeliveryInspection {
  return exact(value,['hostProfile','target','configuration','preparation','activeTransferId','secretConnections'])
    && ['docker-local','other'].includes(String(value.hostProfile))
    && (value.target === null || exact(value.target,['accountId','workerName'])
      && text(value.target.accountId,128) && text(value.target.workerName,128))
    && ['unknown','needed','ready'].includes(String(value.configuration))
    && ['unknown','needed','ready'].includes(String(value.preparation))
    && (value.activeTransferId === null || id(value.activeTransferId))
    && Array.isArray(value.secretConnections) && value.secretConnections.length <= 1000
    && value.secretConnections.every(item => exact(item,['contextId','reference','bindingId','label'])
      && id(item.contextId) && id(item.bindingId) && text(item.label,256)
      && typeof item.reference === 'string' && /^creezio-secret:v1:[a-f0-9-]{36}$/.test(item.reference));
}
function prepared(value: unknown): value is DeliveryPrepared {
  return exact(value,['transferId','planDigest','summary']) && id(value.transferId)
    && digest(value.planDigest) && summary(value.summary);
}
function transfer(value: unknown): value is DeliveryTransferStatus {
  return exact(value,['transferId','planDigest','phase','summary','finalUrl','registryStatus'])
    && id(value.transferId) && digest(value.planDigest)
    && ['prepared','starting','capturing','captured','schema-ready','d1-copying','r2-copying',
      'secrets-ready','verified','delivery-unknown','delivered'].includes(String(value.phase))
    && (value.phase === 'prepared' ? summary(value.summary) : value.summary === null || summary(value.summary))
    && (value.finalUrl === null || text(value.finalUrl,2048) && /^https:\/\//.test(value.finalUrl))
    && ['pending','effective','unknown'].includes(String(value.registryStatus));
}
function updateInspection(value: unknown): value is DeliveryUpdateInspection {
  return exact(value,['kind','readiness','currentPublicationId','activeUpdateId','target'])
    && value.kind === 'update' && ['needed','ready'].includes(String(value.readiness))
    && (value.currentPublicationId === null || id(value.currentPublicationId))
    && (value.activeUpdateId === null || id(value.activeUpdateId))
    && (value.target === null || exact(value.target,['accountId','workerName'])
      && text(value.target.accountId,128) && text(value.target.workerName,128));
}
function updatePrepared(value: unknown): value is DeliveryUpdatePrepared {
  return exact(value,['kind','updateId','planDigest','summary']) && value.kind === 'update'
    && id(value.updateId) && digest(value.planDigest) && summary(value.summary);
}
function updateStatus(value: unknown): value is DeliveryUpdateStatus {
  return exact(value,['kind','updateId','planDigest','phase','summary','finalUrl','registryStatus'])
    && value.kind === 'update' && id(value.updateId) && digest(value.planDigest)
    && ['prepared','building','built','preflight','schema-applying','schema-ready',
      'publishing','delivery-unknown','delivered'].includes(String(value.phase))
    && (value.summary === null || summary(value.summary))
    && (value.phase !== 'prepared' || summary(value.summary))
    && (value.finalUrl === null || text(value.finalUrl,2048) && /^https:\/\//.test(value.finalUrl))
    && ['pending','effective','unknown'].includes(String(value.registryStatus));
}
async function json(response: Response): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('invalid_response');
  const reader = response.body?.getReader(); if (!reader) throw new Error('invalid_response');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length; if (length > 1024*1024) throw new Error('invalid_response');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.length;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Browser adapter only. Credentials go once to the loopback operator; no mutation is retried. */
export function createLocalDeliveryTransport({access,fetcher=fetch,pollMs=1000,deadlineMs=900_000}: {
  access: AccessController; fetcher?: typeof fetch; pollMs?: number; deadlineMs?: number;
}): DeliveryTransport & {dispose():void} {
  let operator: string | null = null, connecting: Promise<DeliveryResult<string>> | null = null;
  let disposed = false, epoch = 0;
  const aborts = new Set<AbortController>();
  const identity = () => {
    const state=access.getSnapshot();
    return access.audience === 'admin' && state.phase === 'authenticated' && !state.pending ? state.session?.id ?? null : null;
  };
  let session = identity();
  const reset = () => {epoch++;operator=null;connecting=null;for(const abort of aborts)abort.abort();aborts.clear();};
  const unsubscribe=access.subscribe(() => {const next=identity();if(next!==session){session=next;reset();}});
  async function request(url: string, body?: unknown) {
    const abort=new AbortController();aborts.add(abort);
    const timer=setTimeout(() => abort.abort(),15_000);
    try {
      const response=await fetcher(url,{method:body===undefined?'GET':'POST',credentials:'include',
        redirect:'error',cache:'no-store',signal:abort.signal,
        headers:body===undefined?{}:{'content-type':'application/json','x-creezio-request':'1'},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:response.status,data:await json(response)};
    } finally {clearTimeout(timer);aborts.delete(abort);}
  }
  async function connect(): Promise<DeliveryResult<string>> {
    if(disposed||!session)return fail('unauthorized');
    if(operator)return {ok:true,value:operator};
    if(connecting)return connecting;
    const current=epoch;
    connecting=(async():Promise<DeliveryResult<string>> => {
      try {
        const app=new URL(access.origin);
        if(app.protocol!=='http:'||app.hostname!=='127.0.0.1')return fail('unsupported_host');
        const authorization=await request(`${app.origin}/api/delivery/admin/authorization`,{});
        if(authorization.status!==200||!object(authorization.data)||typeof authorization.data.operatorOrigin!=='string')
          return fail(authorization.status===403?'forbidden':'unavailable');
        const target=new URL(authorization.data.operatorOrigin);
        if(target.origin!==authorization.data.operatorOrigin||target.protocol!=='http:'
          ||target.hostname!=='127.0.0.1'||!target.port||Number(target.port)<1024
          ||target.origin===app.origin)return fail('invalid_response');
        const opened=await request(`${target.origin}/api/local-delivery/session`,{});
        if(opened.status!==200||!exact(opened.data,['ok','value'])||opened.data.ok!==true
          ||!object(opened.data.value)||opened.data.value.operatorOrigin!==target.origin
          ||opened.data.value.sessionId!==session)return fail('unavailable');
        if(disposed||current!==epoch)return fail('stale');
        operator=target.origin;return {ok:true,value:operator};
      } catch {return fail('unavailable');}
      finally {if(current===epoch)connecting=null;}
    })();
    return connecting;
  }
  async function call<T>(route:string,body:unknown|undefined,validate:(value:unknown)=>value is T):Promise<DeliveryResult<T>> {
    const ready=await connect();if(!ready.ok)return ready;
    const current=epoch,started=Date.now();
    try {
      let output=await request(`${ready.value}/api/local-delivery/${route}`,body);
      if(output.status===401){
        operator=null;
        // A fresh capability may recover a passive read, never replay a command.
        if(body===undefined){
          const rebound=await connect();if(!rebound.ok)return rebound;
          output=await request(`${rebound.value}/api/local-delivery/${route}`);
        }
      }
      let jobId:string|null=null;
      while(output.status===202){
        if(!exact(output.data,['ok','pending','jobId'])||output.data.ok!==true||output.data.pending!==true
          ||typeof output.data.jobId!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(output.data.jobId)
          ||jobId!==null&&output.data.jobId!==jobId)return fail('invalid_response');
        jobId=output.data.jobId;
        if(disposed||epoch!==current)return fail('stale');
        if(route==='start'&&exact(body,['transferId','planDigest'])&&id(body.transferId)&&digest(body.planDigest)){
          const accepted={transferId:body.transferId,planDigest:body.planDigest,phase:'starting',summary:null,
            finalUrl:null,registryStatus:'pending'};
          return validate(accepted)?{ok:true,value:accepted}:fail('invalid_response');
        }
        if(route==='update/start'&&exact(body,['updateId','planDigest'])
          &&id(body.updateId)&&digest(body.planDigest)){
          const accepted={kind:'update',updateId:body.updateId,planDigest:body.planDigest,
            phase:'building',summary:null,finalUrl:null,registryStatus:'pending'};
          return validate(accepted)?{ok:true,value:accepted}:fail('invalid_response');
        }
        if(Date.now()-started>=deadlineMs)return fail('outcome_unknown');
        await new Promise(resolve => setTimeout(resolve,pollMs));
        if(disposed||epoch!==current)return fail('stale');
        output=await request(`${ready.value}/api/local-delivery/jobs/${jobId}`);
        if(output.status===401)operator=null;
      }
      if(disposed||epoch!==current)return fail('stale');
      if(exact(output.data,['ok','code'])&&output.data.ok===false
        &&typeof output.data.code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(output.data.code))return fail(output.data.code);
      return output.status===200&&exact(output.data,['ok','value'])&&output.data.ok===true&&validate(output.data.value)
        ?{ok:true,value:output.data.value}:fail('invalid_response');
    } catch {return fail(body===undefined?'unavailable':'outcome_unknown');}
  }
  const transport:DeliveryTransport & {dispose():void}={
    inspect:()=>call('inspect',undefined,inspection),
    configure:input=>call('configure',input,inspection),
    prepare:input=>call('prepare',input,prepared),
    start:input=>call('start',input,transfer),
    status:transferId=>id(transferId)?call(`status?transferId=${encodeURIComponent(transferId)}`,undefined,transfer)
      :Promise.resolve(fail('invalid_input')),
    reconcile:input=>call('reconcile',input,transfer),
    inspectUpdate:()=>call('update/inspect',undefined,updateInspection),
    prepareUpdate:()=>call('update/prepare',{},updatePrepared),
    startUpdate:input=>call('update/start',input,updateStatus),
    statusUpdate:updateId=>id(updateId)
      ?call(`update/status?updateId=${encodeURIComponent(updateId)}`,undefined,updateStatus)
      :Promise.resolve(fail('invalid_input')),
    reconcileUpdate:input=>call('update/reconcile',input,updateStatus),
    dispose(){disposed=true;unsubscribe();reset();},
  };
  return Object.freeze(transport);
}
