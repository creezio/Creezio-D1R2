import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';

const ROOT='/api/local-delivery';
const NATIVE='creezio-local-admin';
const CAP='creezio-local-delivery';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST=/^sha256-[a-f0-9]{64}$/;
const TOKEN=/^cz1s_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const MAX_BODY=1_048_576;
const encoder=new TextEncoder();
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&ID.test(value);
const digest=value=>typeof value==='string'&&DIGEST.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const error=(code,status)=>Object.assign(new Error(code),{code,status});

function cookie(header,name){
  if(typeof header!=='string'||header.length>8192)throw error('authentication_required',401);
  let found=null;
  for(const part of header.split(';')){
    const item=part.trim(),split=item.indexOf('='),key=split<0?item:item.slice(0,split).trim();
    if(key!==name)continue;
    if(found!==null||split<0)throw error('invalid_cookie',401);
    found=item.slice(split+1);
  }
  return found;
}
function safeValue(value){
  const text=JSON.stringify(value);
  if(typeof text!=='string'||encoder.encode(text).length>MAX_BODY)throw error('invalid_response',503);
  return JSON.parse(text);
}
function validInspection(value){return exact(value,['hostProfile','target','configuration','preparation','activeTransferId','secretConnections'])
  &&['docker-local','other'].includes(value.hostProfile)
  &&(value.target===null||exact(value.target,['accountId','workerName'])
    &&['accountId','workerName'].every(key=>typeof value.target[key]==='string'
      &&value.target[key].length>0&&value.target[key].length<=128))
  &&['unknown','needed','ready'].includes(value.configuration)
  &&['unknown','needed','ready'].includes(value.preparation)
  &&(value.activeTransferId===null||id(value.activeTransferId))
  &&Array.isArray(value.secretConnections)&&value.secretConnections.length<=1000
  &&value.secretConnections.every(item=>exact(item,['contextId','reference','bindingId','label'])
    &&id(item.contextId)&&id(item.bindingId)
    &&typeof item.reference==='string'&&/^creezio-secret:v1:[a-f0-9-]{36}$/.test(item.reference)
    &&typeof item.label==='string'&&item.label.length<=256);}
function validSummary(value){return exact(value,['title','details','warnings'])
  &&typeof value.title==='string'&&value.title.length<=256
  &&Array.isArray(value.details)&&value.details.length<=32
  &&value.details.every(item=>typeof item==='string'&&item.length<=512)
  &&Array.isArray(value.warnings)&&value.warnings.length<=32
  &&value.warnings.every(item=>typeof item==='string'&&item.length<=512);}
function validPrepared(value){return exact(value,['transferId','planDigest','summary'])
  &&id(value.transferId)&&digest(value.planDigest)&&validSummary(value.summary);}
function validTransfer(value){return exact(value,['transferId','planDigest','phase','summary','finalUrl','registryStatus'])
  &&id(value.transferId)&&digest(value.planDigest)
  &&['prepared','starting','capturing','captured','schema-ready','d1-copying','r2-copying','secrets-ready',
    'verified','delivery-unknown','delivered'].includes(value.phase)
  &&(value.phase==='prepared'?validSummary(value.summary)
    :value.summary===null||validSummary(value.summary))
  &&(value.finalUrl===null||typeof value.finalUrl==='string'&&value.finalUrl.length<=2048)
  &&['pending','effective','unknown'].includes(value.registryStatus);}
function validUpdateInspection(value){return exact(value,
  ['kind','readiness','currentPublicationId','activeUpdateId','target'])
  &&value.kind==='update'&&['needed','ready'].includes(value.readiness)
  &&(value.currentPublicationId===null||id(value.currentPublicationId))
  &&(value.activeUpdateId===null||id(value.activeUpdateId))
  &&(value.target===null||exact(value.target,['accountId','workerName'])
    &&['accountId','workerName'].every(key=>typeof value.target[key]==='string'
      &&value.target[key].length>0&&value.target[key].length<=128));}
function validUpdatePrepared(value){return exact(value,['kind','updateId','planDigest','summary'])
  &&value.kind==='update'&&id(value.updateId)&&digest(value.planDigest)
  &&validSummary(value.summary);}
function validDiagnostic(value){return exact(value,['phase','reason','exitCode','apiCodes',
    ...(value?.validationIssue===undefined?[]:['validationIssue'])])
  &&['wrangler','post-upload','unknown'].includes(value.phase)
  &&['spawn_error','exit_nonzero','output_limit','timeout','inspection_failed','unavailable'].includes(value.reason)
  &&(value.exitCode===null||Number.isInteger(value.exitCode)&&value.exitCode>=0&&value.exitCode<=255)
  &&Array.isArray(value.apiCodes)&&value.apiCodes.length<=4
  &&value.apiCodes.every(code=>Number.isInteger(code)&&code>=1000&&code<=999999)
  &&(value.validationIssue===undefined||value.apiCodes.includes(10021)
    &&['startup_cpu_limit','startup_memory_limit','syntax_error','unsupported_handler',
      'unknown_validation'].includes(value.validationIssue));}
function validUpdateStatus(value){return exact(value,
  ['kind','updateId','planDigest','phase','summary','finalUrl','registryStatus',
    ...(value?.diagnostic===undefined?[]:['diagnostic']),
    ...(value?.retryEligible===undefined?[]:['retryEligible'])])
  &&value.kind==='update'&&id(value.updateId)&&digest(value.planDigest)
  &&['prepared','building','built','preflight','schema-applying','schema-ready',
    'publishing','delivery-unknown','rejected','delivered'].includes(value.phase)
  &&(value.summary===null||validSummary(value.summary))
  &&(value.phase!=='prepared'||validSummary(value.summary))
  &&(value.finalUrl===null||typeof value.finalUrl==='string'
    &&value.finalUrl.length<=2048&&/^https:\/\//.test(value.finalUrl))
  &&['pending','unknown','effective'].includes(value.registryStatus)
  &&(value.retryEligible===undefined||typeof value.retryEligible==='boolean')
  &&(value.diagnostic===undefined||validDiagnostic(value.diagnostic));}
function validConfigure(value){
  if(!exact(value,['target','credentials'])||!exact(value.target,
    ['accountId','workerName'])
    ||!exact(value.credentials,['apiToken']))return false;
  if(typeof value.credentials.apiToken!=='string'||value.credentials.apiToken.length<1
    ||value.credentials.apiToken.length>4096)return false;
  for(const field of ['accountId','workerName'])
    if(typeof value.target[field]!=='string'||value.target[field].length<1
      ||value.target[field].length>128)return false;
  return true;
}
function validSelections(value){
  return exact(value,['secretSelections'])&&Array.isArray(value.secretSelections)
    &&value.secretSelections.length<=1000&&value.secretSelections.every(item=>
      exact(item,['contextId','reference','bindingId','mode'])
      &&id(item.contextId)&&id(item.bindingId)
      &&typeof item.reference==='string'&&/^creezio-secret:v1:[a-f0-9-]{36}$/.test(item.reference)
      &&['rewrap','disable'].includes(item.mode))
    &&new Set(value.secretSelections.map(item=>`${item.contextId}\0${item.reference}`)).size
      ===value.secretSelections.length;
}
function validateBody(kind,value){
  if(kind==='configure')return validConfigure(value);
  if(kind==='prepare')return validSelections(value);
  if(kind==='start'||kind==='reconcile')return exact(value,['transferId','planDigest'])
    &&id(value.transferId)&&digest(value.planDigest);
  return exact(value,[]);
}
function bodyOf(request){
  if(request.headers['content-encoding'])throw error('unsupported_content_encoding',415);
  const type=request.headers['content-type'];
  if(typeof type!=='string'||!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(type))
    throw error('unsupported_media_type',415);
  const length=request.headers['content-length'];
  if(length!==undefined&&(typeof length!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(length)
    ||Number(length)>MAX_BODY))
    throw error('body_too_large',413);
  return (async()=>{
    const chunks=[];let size=0;
    for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY)throw error('body_too_large',413);
      chunks.push(chunk);}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks)));}
    catch{throw error('invalid_json',400);}
  })();
}
function send(response,status,payload,origin,headers={}){
  const json=JSON.stringify(payload);
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','access-control-allow-origin':origin,
    'access-control-allow-credentials':'true','vary':'Origin',...headers});
  response.end(json);
}
function sanitizedFailure(cause){
  const code=typeof cause?.code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(cause.code)
    ?cause.code:'service_unavailable';
  const status=Number.isInteger(cause?.status)&&cause.status>=400&&cause.status<=599?cause.status:503;
  return {code,status};
}

/** One loopback operator. Its capabilities are process-local and expire with the native session. */
export function createLocalDeliveryServer({config,port,operations,fetcher=fetch}){
  if(!config||typeof config.origin!=='string'||typeof operations!=='object'||!operations
    ||typeof fetcher!=='function'||!Number.isInteger(port)||port<1024||port>65535)
    throw error('invalid_configuration',500);
  const app=new URL(config.origin),operatorOrigin=`http://127.0.0.1:${port}`;
  if(app.origin!==config.origin||app.protocol!=='http:'||app.hostname!=='127.0.0.1'
    ||app.port===String(port)||config.operatorOrigin!==undefined&&config.operatorOrigin!==operatorOrigin)
    throw error('invalid_configuration',500);
  for(const kind of ['configure','prepare','start','status','reconcile'])
    if(typeof operations[kind]!=='function')throw error('invalid_configuration',500);
  const grants=new Map(),jobs=new Map();
  function prune(){
    const now=Date.now();
    for(const [key,grant] of grants)if(grant.expiresAtMs<=now)grants.delete(key);
    for(const [key,job] of jobs)if(!grants.has(job.grantId))jobs.delete(key);
  }
  async function authorize(nativeCookie){
    let response;
    try{response=await fetcher(`${config.origin}/api/delivery/admin/authorization`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),
      headers:{origin:config.origin,'x-creezio-request':'1','content-type':'application/json',cookie:nativeCookie},
      body:'{}'});}catch{throw error('authorization_unavailable',503);}
    if(!response||typeof response.status!=='number')throw error('authorization_unavailable',503);
    if(response.status===401||response.status===403)throw error('authorization_denied',response.status);
    if(response.status!==200)throw error('authorization_unavailable',503);
    let data;try{const text=await response.text();if(encoder.encode(text).length>4096)throw 0;data=JSON.parse(text);}
    catch{throw error('authorization_unavailable',503);}
    if(!exact(data,['principalId','sessionId','expiresAtMs','epoch','operatorOrigin'])
      ||!id(data.principalId)||!id(data.sessionId)
      ||!Number.isSafeInteger(data.expiresAtMs)||data.expiresAtMs<=Date.now()
      ||!Number.isSafeInteger(data.epoch)||data.epoch<1||data.operatorOrigin!==operatorOrigin)
      throw error('authorization_unavailable',503);
    return data;
  }
  async function readConnections(nativeCookie){
    let response;
    try{response=await fetcher(`${config.origin}/api/delivery/admin/connections`,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(10_000),
      headers:{origin:config.origin,cookie:nativeCookie}});}
    catch{throw error('source_unavailable',503);}
    if(response?.status!==200)throw error('source_unavailable',503);
    let data;
    try{const text=await response.text();if(encoder.encode(text).length>MAX_BODY)throw 0;
      data=JSON.parse(text);}catch{throw error('source_unavailable',503);}
    if(!exact(data,['secretConnections'])||!Array.isArray(data.secretConnections)
      ||data.secretConnections.length>1000
      ||data.secretConnections.some(item=>!exact(item,['contextId','reference','bindingId','label'])
        ||!id(item.contextId)||!id(item.bindingId)
        ||typeof item.reference!=='string'||!/^creezio-secret:v1:[a-f0-9-]{36}$/.test(item.reference)
        ||typeof item.label!=='string'||item.label.length>256))
      throw error('source_unavailable',503);
    return data.secretConnections;
  }
  function credentials(request){
    const all=request.headers.cookie,native=cookie(all,NATIVE),cap=cookie(all,CAP);
    if(!native||!TOKEN.test(native)||!cap||!/^[A-Za-z0-9_-]{43}$/.test(cap))
      throw error('authentication_required',401);
    const grant=grants.get(hash(cap));
    if(!grant||grant.nativeHash!==hash(native)||grant.expiresAtMs<=Date.now())
      throw error('authentication_required',401);
    return {grant,nativeCookie:`${NATIVE}=${native}`};
  }
  async function fresh(grant,nativeCookie){
    const checked=await authorize(nativeCookie);
    if(checked.principalId!==grant.principalId||checked.sessionId!==grant.sessionId
      ||checked.epoch!==grant.epoch||checked.expiresAtMs<grant.expiresAtMs)
      throw error('authorization_denied',403);
  }
  function started(grant,transferId,planDigest){
    return grant.started?.transferId===transferId&&grant.started.planDigest===planDigest;
  }
  async function freshOrStarted(grant,nativeCookie,transferId,planDigest){
    try{await fresh(grant,nativeCookie);}
    catch(cause){
      if(cause?.code!=='authorization_unavailable'||!started(grant,transferId,planDigest))throw cause;
    }
  }
  function updateStarted(grant,updateId,planDigest){
    return grant.updateStarted?.updateId===updateId&&grant.updateStarted.planDigest===planDigest;
  }
  async function freshOrUpdateStarted(grant,nativeCookie,updateId,planDigest){
    try{await fresh(grant,nativeCookie);}
    catch(cause){
      if(cause?.code!=='authorization_unavailable'||!updateStarted(grant,updateId,planDigest))throw cause;
    }
  }
  function jobKey(grant,kind,input){return `${grant.id}:${kind}:${hash(JSON.stringify(input))}`;}
  function launch(grant,kind,input,nativeCookie=null,secretConnections=null){
    const key=jobKey(grant,kind,input),existing=jobs.get(key);
    if(existing)return existing;
    if(jobs.size>=1024)throw error('rate_limited',429);
    const job={id:randomBytes(16).toString('base64url'),grantId:grant.id,kind,
      state:'running',value:null,code:null,status:null,
      transferId:input.transferId??null,updateId:input.updateId??null};
    grant.activeJob=job.id;
    jobs.set(key,job);jobs.set(job.id,job);
    queueMicrotask(async()=>{
      try{
        const value=await operations[kind](input,{principalId:grant.principalId,sessionId:grant.sessionId,
          epoch:grant.epoch,transferId:grant.prepared?.transferId??null,
          updateId:grant.updatePrepared?.updateId??null,
          ...(nativeCookie?{nativeCookie,secretConnections}:{})});
        if(kind==='prepare'){
          if(!validPrepared(value))throw error('invalid_response',503);
          grant.prepared={transferId:value.transferId,planDigest:value.planDigest};
        }else if(kind==='prepareUpdate'){
          if(!validUpdatePrepared(value))throw error('invalid_response',503);
          grant.updatePrepared={updateId:value.updateId,planDigest:value.planDigest};
        }else if(kind==='configure'&&!validInspection(value)
          ||(kind==='start'||kind==='reconcile')&&(!validTransfer(value)
            ||value.transferId!==input.transferId||value.planDigest!==input.planDigest)
          ||(kind==='startUpdate'||kind==='reconcileUpdate'||kind==='retryUpdate'
            ||kind==='rejectUpdate')&&(!validUpdateStatus(value)
            ||value.updateId!==input.updateId||value.planDigest!==input.planDigest))
          throw error('invalid_response',503);
        job.value=safeValue(value);job.state='done';
      }catch(cause){const failure=sanitizedFailure(cause);
        job.code=failure.code;job.status=failure.status;job.state='failed';}
      finally{if(grant.activeJob===job.id)grant.activeJob=null;}
    });
    return job;
  }
  function jobResult(job){return job.state==='running'?{status:202,body:{ok:true,pending:true,jobId:job.id}}
    :job.state==='done'?{status:200,body:{ok:true,value:job.value}}
    :{status:job.status??503,body:{ok:false,code:job.code}};}
  const server=createServer(async(request,response)=>{
    const requestOrigin=request.headers.origin;
    try{
      prune();
      let headerBytes=0;
      for(const [name,value] of Object.entries(request.headers)){
        headerBytes+=encoder.encode(name).length+encoder.encode(String(value)).length+4;
        if(headerBytes>8192)throw error('headers_too_large',431);
      }
      if(request.headers.host!==`127.0.0.1:${port}`||requestOrigin!==config.origin)
        throw error('origin_denied',403);
      if(request.headers['sec-fetch-site']&& !['same-origin','same-site','none'].includes(request.headers['sec-fetch-site']))
        throw error('origin_denied',403);
      const url=new URL(request.url,operatorOrigin);
      if(url.origin!==operatorOrigin||!url.pathname.startsWith(`${ROOT}/`))throw error('not_found',404);
      if(request.method==='OPTIONS'){
        if(request.headers['access-control-request-method']!=='GET'
          &&request.headers['access-control-request-method']!=='POST')throw error('method_not_allowed',405);
        response.writeHead(204,{'access-control-allow-origin':config.origin,
          'access-control-allow-credentials':'true','access-control-allow-methods':'GET, POST, OPTIONS',
          'access-control-allow-headers':'content-type, x-creezio-request','vary':'Origin',
          'cache-control':'no-store'});response.end();return;
      }
      if(request.method==='POST'&&request.headers['x-creezio-request']!=='1')throw error('request_header_required',403);
      const route=url.pathname.slice(ROOT.length+1);
      if(route==='session'&&request.method==='POST'){
        if(url.search)throw error('invalid_query',400);
        const body=await bodyOf(request);if(!exact(body,[]))throw error('invalid_input',400);
        const native=cookie(request.headers.cookie,NATIVE);
        if(!native||!TOKEN.test(native))throw error('authentication_required',401);
        const auth=await authorize(`${NATIVE}=${native}`),old=cookie(request.headers.cookie,CAP),
          prior=old?grants.get(hash(old)):null;
        if(prior&&prior.nativeHash===hash(native)&&prior.principalId===auth.principalId
          &&prior.sessionId===auth.sessionId&&prior.epoch===auth.epoch
          &&prior.expiresAtMs>Date.now()&&auth.expiresAtMs>=prior.expiresAtMs){
          send(response,200,{ok:true,value:{principalId:auth.principalId,sessionId:auth.sessionId,
            expiresAtMs:prior.expiresAtMs,epoch:auth.epoch,operatorOrigin}},config.origin);return;
        }
        if(old)grants.delete(hash(old));
        if(grants.size>=64)throw error('rate_limited',429);
        const cap=randomBytes(32).toString('base64url'),expiresAtMs=Math.min(auth.expiresAtMs,Date.now()+3_600_000);
        const grant={id:hash(cap),nativeHash:hash(native),principalId:auth.principalId,
          sessionId:auth.sessionId,epoch:auth.epoch,expiresAtMs,prepared:null,started:null,
          updatePrepared:null,updateStarted:null,activeJob:null};
        grants.set(grant.id,grant);
        send(response,200,{ok:true,value:{principalId:auth.principalId,sessionId:auth.sessionId,
          expiresAtMs,epoch:auth.epoch,operatorOrigin}},config.origin,
        {'set-cookie':`${CAP}=${cap}; Path=${ROOT}; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1,Math.floor((expiresAtMs-Date.now())/1000))}`});
        return;
      }
      if(route==='logout'&&request.method==='POST'){
        if(url.search)throw error('invalid_query',400);
        const body=await bodyOf(request);if(!exact(body,[]))throw error('invalid_input',400);
        const {grant}=credentials(request);grants.delete(grant.id);
        send(response,200,{ok:true,value:null},config.origin,
          {'set-cookie':`${CAP}=; Path=${ROOT}; HttpOnly; SameSite=Strict; Max-Age=0`});return;
      }
      const {grant,nativeCookie}=credentials(request);
      if(route==='update/inspect'&&request.method==='GET'){
        if(url.search||request.headers['content-length'])throw error('invalid_query',400);
        if(typeof operations.inspectUpdate!=='function')throw error('service_unavailable',503);
        await fresh(grant,nativeCookie);
        const value=await operations.inspectUpdate({principalId:grant.principalId,
          sessionId:grant.sessionId,epoch:grant.epoch,nativeCookie});
        if(!validUpdateInspection(value))throw error('invalid_response',503);
        send(response,200,{ok:true,value:safeValue(value)},config.origin);return;
      }
      if(route==='update/status'&&request.method==='GET'){
        if(typeof operations.statusUpdate!=='function')throw error('service_unavailable',503);
        if([...url.searchParams].length!==1||!id(url.searchParams.get('updateId')))
          throw error('invalid_query',400);
        const updateId=url.searchParams.get('updateId');
        if(grant.updatePrepared?.updateId===updateId)
          await freshOrUpdateStarted(grant,nativeCookie,updateId,grant.updatePrepared.planDigest);
        else await fresh(grant,nativeCookie);
        const value=await operations.statusUpdate(updateId,{principalId:grant.principalId,
          sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
        if(!validUpdateStatus(value)||value.updateId!==updateId)throw error('forbidden',403);
        if(grant.updatePrepared&&(grant.updatePrepared.updateId!==updateId
          ||grant.updatePrepared.planDigest!==value.planDigest))throw error('forbidden',403);
        grant.updatePrepared={updateId,planDigest:value.planDigest};
        if(value.phase!=='prepared')grant.updateStarted={...grant.updatePrepared};
        send(response,200,{ok:true,value:safeValue(value)},config.origin);return;
      }
      if(['update/prepare','update/start','update/reconcile','update/retry','update/reject'].includes(route)&&request.method==='POST'){
        if(url.search)throw error('invalid_query',400);
        const kind=route==='update/prepare'?'prepareUpdate'
          :route==='update/start'?'startUpdate':route==='update/retry'?'retryUpdate'
          :route==='update/reject'?'rejectUpdate':'reconcileUpdate';
        if(typeof operations[kind]!=='function'||typeof operations.statusUpdate!=='function')
          throw error('service_unavailable',503);
        const body=await bodyOf(request);
        const validBody=route==='update/prepare'?exact(body,[]):
          exact(body,['updateId','planDigest'])&&id(body.updateId)&&digest(body.planDigest);
        if(!validBody)
          throw error('invalid_input',400);
        if(kind==='reconcileUpdate'&&updateStarted(grant,body.updateId,body.planDigest))
          await freshOrUpdateStarted(grant,nativeCookie,body.updateId,body.planDigest);
        else await fresh(grant,nativeCookie);
        if(route!=='update/prepare'){
          if(!grant.updatePrepared||grant.updatePrepared.updateId!==body.updateId
            ||grant.updatePrepared.planDigest!==body.planDigest)throw error('forbidden',403);
          if((route==='update/reconcile'||route==='update/retry'||route==='update/reject')&&(!grant.updateStarted
            ||grant.updateStarted.updateId!==body.updateId
            ||grant.updateStarted.planDigest!==body.planDigest)){
            const owned=await operations.statusUpdate(body.updateId,{principalId:grant.principalId,
              sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
            if(!validUpdateStatus(owned)||owned.updateId!==body.updateId
              ||owned.planDigest!==body.planDigest)throw error('forbidden',403);
            if(owned.phase==='prepared')throw error('update_not_started',409);
            grant.updateStarted={updateId:body.updateId,planDigest:body.planDigest};
          }
        }
        const key=jobKey(grant,kind,body);let existing=jobs.get(key);
        if(kind==='startUpdate'&&existing?.state==='failed'){
          const owned=await operations.statusUpdate(body.updateId,{principalId:grant.principalId,
            sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
          if(!validUpdateStatus(owned)||owned.updateId!==body.updateId
            ||owned.planDigest!==body.planDigest)throw error('forbidden',403);
          if(owned.phase==='prepared'){
            if(jobs.get(key)===existing){jobs.delete(key);existing=null;}
            else existing=jobs.get(key);
          }
        }
        if(kind==='prepareUpdate'&&existing?.state==='failed'){
          if(jobs.get(key)===existing){jobs.delete(key);existing=null;}
          else existing=jobs.get(key);
        }
        if(kind==='prepareUpdate'&&existing?.state==='done'){
          const previous=grant.updatePrepared;
          if(!previous||!validUpdatePrepared(existing.value)
            ||previous.updateId!==existing.value.updateId
            ||previous.planDigest!==existing.value.planDigest)
            throw error('invalid_state',409);
          const owned=await operations.statusUpdate(previous.updateId,{principalId:grant.principalId,
            sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
          if(!validUpdateStatus(owned)||owned.updateId!==previous.updateId
            ||owned.planDigest!==previous.planDigest)throw error('forbidden',403);
          if(owned.phase==='rejected'||owned.phase==='delivered'&&owned.registryStatus==='effective'){
            if(jobs.get(key)===existing){jobs.delete(key);existing=null;
              grant.updatePrepared=null;grant.updateStarted=null;}
            else existing=jobs.get(key);
          }else if(owned.phase!=='prepared')throw error('update_in_progress',409);
        }
        if(existing&&(!['reconcileUpdate','retryUpdate','rejectUpdate'].includes(kind)||existing.state==='running')){
          const output=jobResult(existing);send(response,output.status,output.body,config.origin);return;
        }
        if(grant.activeJob){const active=jobs.get(grant.activeJob);
          if(active!==existing)throw error('in_flight',409);}
        if(existing&&['reconcileUpdate','retryUpdate','rejectUpdate'].includes(kind))jobs.delete(key);
        if(kind==='startUpdate')grant.updateStarted={updateId:body.updateId,planDigest:body.planDigest};
        const job=launch(grant,kind,body,kind==='prepareUpdate'?nativeCookie:null),
          output=jobResult(job);
        send(response,output.status,output.body,config.origin);return;
      }
      if(route==='resume'&&request.method==='POST'){
        if(url.search)throw error('invalid_query',400);
        const body=await bodyOf(request);if(!validateBody('start',body))throw error('invalid_input',400);
        await fresh(grant,nativeCookie);
        if(grant.prepared&&(grant.prepared.transferId!==body.transferId
          ||grant.prepared.planDigest!==body.planDigest))throw error('forbidden',403);
        const value=await operations.status(body.transferId,{principalId:grant.principalId,
          sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
        if(!validTransfer(value)||value.transferId!==body.transferId
          ||value.planDigest!==body.planDigest)throw error('forbidden',403);
        grant.prepared={transferId:body.transferId,planDigest:body.planDigest};
        if(value.phase!=='prepared')grant.started={...grant.prepared};
        send(response,200,{ok:true,value:safeValue(value)},config.origin);return;
      }
      if(route.startsWith('jobs/')&&request.method==='GET'){
        if(url.search||request.headers['content-length'])throw error('invalid_query',400);
        const job=jobs.get(route.slice(5));if(!job||job.grantId!==grant.id)throw error('not_found',404);
        const output=jobResult(job);send(response,output.status,output.body,config.origin);return;
      }
      if(route==='inspect'&&request.method==='GET'){
        if(url.search||request.headers['content-length'])throw error('invalid_query',400);
        await fresh(grant,nativeCookie);
        if(typeof operations.inspect!=='function')throw error('service_unavailable',503);
        const value=await operations.inspect({principalId:grant.principalId,
          sessionId:grant.sessionId,epoch:grant.epoch,nativeCookie,
          secretConnections:await readConnections(nativeCookie)});
        if(!validInspection(value))throw error('invalid_response',503);
        send(response,200,{ok:true,value:safeValue(value)},config.origin);return;
      }
      if(route==='status'&&request.method==='GET'){
        if([...url.searchParams].length!==1||!id(url.searchParams.get('transferId')))
          throw error('invalid_query',400);
        const transferId=url.searchParams.get('transferId');
        if(!grant.prepared){
          await fresh(grant,nativeCookie);
          const owned=await operations.status(transferId,{principalId:grant.principalId,
            sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
          if(!validTransfer(owned)||owned.transferId!==transferId)throw error('forbidden',403);
          grant.prepared={transferId,planDigest:owned.planDigest};
          if(owned.phase!=='prepared')grant.started={...grant.prepared};
          send(response,200,{ok:true,value:safeValue(owned)},config.origin);return;
        }
        if(grant.prepared.transferId!==transferId)throw error('forbidden',403);
        await freshOrStarted(grant,nativeCookie,transferId,grant.prepared.planDigest);
        const value=await operations.status(transferId,{principalId:grant.principalId,
          sessionId:grant.sessionId,epoch:grant.epoch});
        if(!validTransfer(value)||value.transferId!==transferId
          ||value.planDigest!==grant.prepared.planDigest)throw error('invalid_response',503);
        if(value.phase!=='prepared')grant.started={...grant.prepared};
        send(response,200,{ok:true,value:safeValue(value)},config.origin);return;
      }
      if(['configure','prepare','start','reconcile'].includes(route)&&request.method==='POST'){
        if(url.search)throw error('invalid_query',400);
        const body=await bodyOf(request);if(!validateBody(route,body))throw error('invalid_input',400);
        if((route==='start'||route==='reconcile')&&(!grant.prepared||grant.prepared.transferId!==body.transferId
          ||grant.prepared.planDigest!==body.planDigest))throw error('forbidden',403);
        if(route==='reconcile'&&!started(grant,body.transferId,body.planDigest)){
          await fresh(grant,nativeCookie);
          const owned=await operations.status(body.transferId,{principalId:grant.principalId,
            sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
          if(!validTransfer(owned)||owned.transferId!==body.transferId
            ||owned.planDigest!==body.planDigest)throw error('forbidden',403);
          if(owned.phase==='prepared')throw error('transfer_not_started',409);
          grant.started={transferId:body.transferId,planDigest:body.planDigest};
        }
        if(route==='reconcile'||route==='start'&&started(grant,body.transferId,body.planDigest))
          await freshOrStarted(grant,nativeCookie,body.transferId,body.planDigest);
        const key=jobKey(grant,route,body);let existing=jobs.get(key);
        if(route==='start'&&existing?.state==='failed'){
          // Retry only if the exact source journal still confirms no durable start.
          await fresh(grant,nativeCookie);
          const owned=await operations.status(body.transferId,{principalId:grant.principalId,
            sessionId:grant.sessionId,epoch:grant.epoch,requireOwnership:true});
          if(!validTransfer(owned)||owned.transferId!==body.transferId
            ||owned.planDigest!==body.planDigest)throw error('forbidden',403);
          if(owned.phase==='prepared'){
            if(jobs.get(key)===existing){jobs.delete(key);existing=null;}
            else existing=jobs.get(key);
          }
        }
        if(route==='prepare'&&existing?.state==='failed'){
          // The pipeline owns the durable intent and checks its exact owner and
          // selections before resuming provisioning. A retry needs a fresh ACL.
          await fresh(grant,nativeCookie);
          if(jobs.get(key)===existing){jobs.delete(key);existing=null;}
          else existing=jobs.get(key);
        }
        if(existing&&(route==='start'||route==='reconcile'&&existing.state==='running')){
          const output=jobResult(existing);send(response,output.status,output.body,config.origin);return;
        }
        if(route==='configure'||route==='prepare'||route==='start'&&!started(grant,body.transferId,body.planDigest)){
          if(route==='prepare'&&grant.prepared&&!existing)
            throw error('transfer_in_progress',409);
          await fresh(grant,nativeCookie);
        }
        if(existing&&route!=='reconcile'){
          const output=jobResult(existing);send(response,output.status,output.body,config.origin);return;
        }
        if(grant.activeJob){
          const active=jobs.get(grant.activeJob),same=active&&active===jobs.get(jobKey(grant,route,body));
          if(!same)throw error('in_flight',409);
        }
        if(existing&&route==='reconcile')jobs.delete(key);
        if(route==='start')grant.started={transferId:body.transferId,planDigest:body.planDigest};
        const metadata=route==='configure'||route==='prepare'
          ?await readConnections(nativeCookie):null;
        const job=launch(grant,route,body,
          route==='configure'||route==='prepare'?nativeCookie:null,metadata),output=jobResult(job);
        send(response,output.status,output.body,config.origin);return;
      }
      throw error('not_found',404);
    }catch(cause){const failure=sanitizedFailure(cause);
      send(response,failure.status,{ok:false,code:failure.code},config.origin);}
  });
  server.requestTimeout=10_000;server.headersTimeout=10_000;server.maxHeadersCount=64;
  return Object.freeze({server,origin:operatorOrigin,
    async listen(){if(server.listening)return;await new Promise((resolve,reject)=>{
      server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});},
    async close(){if(!server.listening)return;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      grants.clear();jobs.clear();}});
}
