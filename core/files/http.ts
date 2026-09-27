import {createDataAccess} from '../data/service.ts';
import {DataAccessError, type DataCredential, type RuntimeDataCatalog} from '../data/types.ts';
import type {AuthorizationActor, AuthorizationAudience, PermissionDefinition} from '../authorization/types.ts';
import type {RuntimeEnvironment} from '../runtime/environment.ts';
import {AccessHttpError, HTTP_POLICY, readAccessCookie, resolveAccessHttpConfiguration} from '../identity/http-policy.ts';
import {oauthResource} from '../oauth/protocol.ts';
import {createD1IdentityStore} from '../identity/d1-store.ts';
import {identityAdmissionKey} from '../identity/input.ts';
import {FileError, FILE_POLICY} from './mapping.ts';
import {fileOwnerId, resolveFileCategory, type RuntimeFileCatalog} from './catalog.ts';
import {createFileService, type FileBucket, type StagedFile} from './service.ts';

const encoder = new TextEncoder();
const id = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const fail = (code: string, status: number): never => {throw new AccessHttpError(code, status);};
function value(raw: string | null, maximum = 128): string {
  if (!raw || !raw.isWellFormed() || encoder.encode(raw).length > maximum || /[\u0000-\u001f\u007f]/.test(raw)) return fail('invalid_input',400);
  return raw;
}
function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','x-creezio-request-id':requestId}});
}
function reference(url: URL): StagedFile {
  const names = ['fileId','intentId','generation','digest'];
  if ([...url.searchParams.keys()].some(name => !names.includes(name)) || names.some(name => url.searchParams.getAll(name).length !== 1)) fail('invalid_input',400);
  return {fileId:value(url.searchParams.get('fileId')),intentId:value(url.searchParams.get('intentId')),
    generation:value(url.searchParams.get('generation')),digest:value(url.searchParams.get('digest'))};
}
function checks(request: Request, origin: string): void {
  let size = 0;
  for (const [key,val] of request.headers) size += encoder.encode(key).length + encoder.encode(val).length + 4;
  if (size > HTTP_POLICY.maxHeaderBytes) fail('headers_too_large',431);
  if (new URL(request.url).origin !== origin || request.headers.has('origin') && request.headers.get('origin') !== origin
    || request.headers.has('sec-fetch-site') && !['same-origin','none'].includes(request.headers.get('sec-fetch-site')!)) fail('origin_denied',403);
  if (request.method !== 'GET' && (request.headers.get('x-creezio-request') !== '1'
    || !request.headers.has('authorization') && request.headers.get('origin') !== origin)) fail('origin_denied',403);
  if (request.headers.has('content-encoding')) fail('invalid_input',400);
  if (request.method !== 'PUT' && request.body !== null) fail('body_not_allowed',400);
}
async function body(request: Request, maximum: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maximum)) fail('body_too_large',413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let total = 0;
  const chunks: Uint8Array[] = [];
  let reject: (reason: Error) => void = () => {};
  const cancelled = new Promise<never>((_,no) => {reject=no;});
  void cancelled.catch(()=>{});
  const stop = () => {reject(new AccessHttpError('request_cancelled',499)); void reader.cancel().catch(()=>{});};
  const timer = setTimeout(() => {reject(new AccessHttpError('body_timeout',408)); void reader.cancel().catch(()=>{});},10000);
  request.signal.addEventListener('abort',stop,{once:true});
  try {
    if (request.signal.aborted) stop();
    while (true) {
      const result = await Promise.race([reader.read(),cancelled]);
      if (result.done) break;
      if (!(result.value instanceof Uint8Array) || chunks.length >= FILE_POLICY.maximumChunks || result.value.byteLength > maximum-total) fail('body_too_large',413);
      total+=result.value.byteLength; chunks.push(result.value);
    }
    if (request.signal.aborted) fail('request_cancelled',499);
    if (length !== null && Number(length) !== total) fail('invalid_input',400);
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
    return bytes;
  } catch (error) {void reader.cancel().catch(()=>{});throw error;}
  finally {clearTimeout(timer);request.signal.removeEventListener('abort',stop);reader.releaseLock();}
}

/** Private binary transport shared by modules. It stages content; only an operation can publish it. */
export async function dispatchFileHttp(request: Request, environment: RuntimeEnvironment, rawEnvironment: unknown,
  requestId: string, options: {catalog: RuntimeDataCatalog; files: RuntimeFileCatalog; permissions: readonly PermissionDefinition[]}): Promise<Response> {
  const url = new URL(request.url), match = /^\/api\/files\/(admin|app)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!match || !id.test(match[2]!) || !id.test(match[3]!)) return json({error:{code:'not_found'},requestId},404,requestId);
  const audience = match[1] as AuthorizationAudience, moduleId=match[2]!, categoryId=match[3]!;
  const configuration = resolveAccessHttpConfiguration(rawEnvironment,environment.profile);
  if (!configuration) return json({error:{code:'runtime_unavailable'},requestId},503,requestId);
  if (!['PUT','GET','DELETE'].includes(request.method)) return json({error:{code:'method_not_allowed'},requestId},405,requestId);
  let data: ReturnType<typeof createDataAccess> | undefined;
  let lease: Awaited<ReturnType<ReturnType<typeof createDataAccess>['authorize']>> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let mutating = false;
  try {
    checks(request,configuration.origin);
    const category = resolveFileCategory(options.catalog,options.files,moduleId,categoryId,audience);
    let credential: DataCredential;
    if (request.headers.has('authorization')) {
      const token = /^Bearer (cz1([ao])_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')!);
      if (!token) return fail('authentication_required',401);
      credential=token[2]==='o'?{kind:'oauth',token:token[1],resource:oauthResource(configuration.origin,audience)}:{kind:'api-token',token:token[1]};
    } else {
      const token = readAccessCookie(request,configuration,audience);
      if (!token) fail('authentication_required',401);
      credential={kind:'session',token};
    }
    const contextId=value(request.headers.get('x-creezio-context'));
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(contextId)) fail('invalid_context',400);
    const store=createD1IdentityStore(environment.bindings.DB), domain=`${moduleId}:${categoryId}:${audience}`;
    for (const [kind,key,limit] of [['global',domain,120],['credential',`${domain}:${credential.token}`,30]] as const) {
      const admitted=await store.consumeThrottle({key:await identityAdmissionKey(`files-${kind}`,key),limit,windowMs:60000});
      if (!admitted.allowed) fail('rate_limited',429);
    }
    data=createDataAccess(environment.bindings.DB,{catalog:options.catalog,permissions:options.permissions});
    const actors: AuthorizationActor[] = ['user','machine','delegated-user'];
    lease=await data.authorize(credential,{contextId,audience,actors,requiredPermissionIds:category.permissions.map(p=>`${moduleId}:${p.id}`),purpose:'operation'},{moduleId});
    const ownerId=await fileOwnerId(data.describeLease(lease).principalId,audience);
    const files=createFileService({data,catalog:options.catalog,moduleId,category,bucket:environment.bindings.BUCKET as unknown as FileBucket,ownerId});
    const currentLease=lease;
    const execute=async (): Promise<Response> => {
      if (request.method==='PUT') {
        if (url.search) fail('invalid_input',400);
        const intent=value(request.headers.get('x-creezio-file-intent'));
        const generation=value(request.headers.get('x-creezio-file-generation'));
        let filename: string;
        try {filename=decodeURIComponent(value(request.headers.get('x-creezio-file-name'),2048));} catch {return fail('invalid_input',400);}
        const contentType=value(request.headers.get('content-type'));
        if (!category.mimeTypes.includes(contentType)) fail('invalid_input',400);
        const bytes=await body(request,Math.min(category.maxBytes,FILE_POLICY.maximumBytes));
        // Scope the caller's retry ID: another owner cannot reserve or discover the same intention.
        const digest=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify([ownerId,intent])));
        const intentId=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        if (request.signal.aborted) fail('request_cancelled',499);
        mutating=true;
        const ref=await files.stage(currentLease,{ownerId,intentId,generation,filename,contentType,bytes});
        return json({reference:ref,filename:filename.replace(/[\\/]/g,'_'),contentType,byteSize:bytes.length},201,requestId);
      }
      const ref=reference(url);
      if (request.method==='DELETE') {mutating=true;return json(await files.abandon(currentLease,ref),200,requestId);}
      const result=await files.readPrivate(currentLease,ref);
      return new Response(new Uint8Array(result.bytes),{status:200,headers:{...result.headers,'x-creezio-request-id':requestId}});
    };
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AccessHttpError(mutating?'unknown':'operation_timeout',mutating?202:504)),25000);});
    return await Promise.race([execute(),deadline]);
  } catch(error) {
    const code=error instanceof AccessHttpError?error.code:error instanceof DataAccessError
      ?(['unauthorized','forbidden'].includes(error.code)?error.code:'unavailable'):error instanceof FileError?error.code:'unavailable';
    const status=error instanceof AccessHttpError?error.status:({unauthorized:401,forbidden:403,not_found:404,conflict:409,invalid_input:400,unsupported:501}[code]??503);
    return json({error:{code},requestId},status,requestId);
  } finally {if(timer)clearTimeout(timer);if(lease)data?.dispose(lease);}
}
