import type { PermissionDefinition } from '../authorization/types.ts';
import { resolveAccessHttpConfiguration, readAccessCookie } from '../identity/http-policy.ts';
import { createD1IdentityStore } from '../identity/d1-store.ts';
import { identityAdmissionKey } from '../identity/input.ts';
import type { RuntimeEnvironment } from '../runtime/environment.ts';
import type { RuntimeNativeAccess } from '../runtime/types.ts';
import { OAuthProtocolError, oauthAuthorizationServerMetadata, oauthProtectedResourceMetadata,
  type OAuthAudience } from './protocol.ts';
import { createOAuthService } from './service.ts';
import type {StorageMutationPort} from '../storage-authority/native-mutation.ts';

const MAX_BODY = 16_384;
export const OAUTH_HTTP_BODY_DEADLINE_MS = 10_000;
function json(body: unknown, status: number, requestId: string, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type','application/json; charset=utf-8');
  responseHeaders.set('cache-control','no-store');
  responseHeaders.set('x-content-type-options','nosniff');
  responseHeaders.set('x-creezio-request-id',requestId);
  return new Response(JSON.stringify(body),{status,headers:responseHeaders});
}
function redirect(uri: string, requestId: string): Response {
  return new Response(null,{status:303,headers:{location:uri,'cache-control':'no-store',
    'referrer-policy':'no-referrer','x-creezio-request-id':requestId}});
}
function error(code: string, status: number, requestId: string, tokenEndpoint = false, audience?: OAuthAudience) {
  return tokenEndpoint ? json({error:code},status,requestId)
    : json({error:{code},...(audience ? {audience} : {})},status,requestId);
}
function checkRequest(request: Request, origin: string, requireOrigin: boolean): void {
  if (new URL(request.url).origin !== origin) throw new OAuthProtocolError('origin_denied',403);
  if (requireOrigin && request.headers.get('origin') !== origin) throw new OAuthProtocolError('origin_denied',403);
  const site = request.headers.get('sec-fetch-site');
  if (requireOrigin && site !== null && site !== 'same-origin' && site !== 'none')
    throw new OAuthProtocolError('origin_denied',403);
  if (request.url.length > 8192) throw new OAuthProtocolError('invalid_request',414);
}
async function bodyBytes(request: Request): Promise<string> {
  if (!request.body || request.bodyUsed || request.headers.has('content-encoding'))
    throw new OAuthProtocolError('invalid_request');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length)>MAX_BODY))
    throw new OAuthProtocolError('invalid_request',413);
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  let bytes = 0, chunks = 0, result = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancellationError: OAuthProtocolError | null = null;
  let rejectCancellation: (reason: OAuthProtocolError) => void = () => {};
  const cancellation = new Promise<never>((_resolve,reject) => { rejectCancellation = reject; });
  // An already-aborted request can reject before the first reader race is attached.
  void cancellation.catch(() => {});
  const cancel = (code: string, status: number) => {
    if (cancellationError) return;
    cancellationError = new OAuthProtocolError(code,status);
    rejectCancellation(cancellationError);
    void reader.cancel().catch(()=>{});
  };
  const onAbort = () => cancel('request_cancelled',499);
  request.signal.addEventListener('abort',onAbort,{once:true});
  if (request.signal.aborted) onAbort();
  timer = setTimeout(() => {
    cancel('body_timeout',408);
  },OAUTH_HTTP_BODY_DEADLINE_MS);
  try {
    for (;;) {
      if (cancellationError) throw cancellationError;
      const next = await Promise.race([reader.read(),cancellation]);
      if (cancellationError) throw cancellationError;
      if (next.done) break;
      if (++chunks > MAX_BODY || (bytes += next.value.byteLength) > MAX_BODY)
        throw new OAuthProtocolError('invalid_request',413);
      result += decoder.decode(next.value,{stream:true});
    }
    result += decoder.decode();
    return result;
  } catch (failure) {
    void reader.cancel().catch(()=>{});
    if (failure instanceof OAuthProtocolError) throw failure;
    throw new OAuthProtocolError('invalid_request');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort',onAbort);
    try { reader.releaseLock(); } catch { /* cancelled read */ }
  }
}
async function form(request: Request) {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? ''))
    throw new OAuthProtocolError('unsupported_media_type',415);
  return new URLSearchParams(await bodyBytes(request));
}
function one(form: URLSearchParams, key: string, max = 2048): string {
  const values = form.getAll(key);
  if (values.length !== 1 || values[0].length > max) throw new OAuthProtocolError('invalid_request');
  return values[0];
}
async function nativeSessionToken(request: Request, rawEnvironment: unknown,
  environment: RuntimeEnvironment, audience: OAuthAudience): Promise<string | null> {
  const configuration = resolveAccessHttpConfiguration(rawEnvironment,environment.profile);
  if (!configuration) throw new OAuthProtocolError('temporarily_unavailable',503);
  try { return readAccessCookie(request,configuration,audience); }
  catch { return null; }
}

/** The host routes OAuth before module APIs; no module receives credentials or cookies. */
export async function dispatchOAuthHttp(request: Request, environment: RuntimeEnvironment,
  rawEnvironment: unknown, permissions: readonly PermissionDefinition[], requestId: string,
  path: string, enabledAudiences: RuntimeNativeAccess,
  permissionTitles?: Readonly<Record<string,string>>,
  storageMutation?:StorageMutationPort): Promise<Response | null> {
  const resource = /^\/\.well-known\/oauth-protected-resource\/mcp\/(admin|app)$/.exec(path);
  const authMetadata = path === '/.well-known/oauth-authorization-server';
  const authorize = path === '/oauth/authorize';
  const token = path === '/oauth/token', register = path === '/oauth/register', revoke = path === '/oauth/revoke';
  const preview = /^\/oauth\/consent\/([A-Za-z0-9._:-]+)\/preview$/.exec(path);
  const consent = /^\/oauth\/consent\/([A-Za-z0-9._:-]+)$/.exec(path);
  if (!resource && !authMetadata && !authorize && !token && !register && !revoke && !preview
    && !(consent && request.method === 'POST')) return null;
  const configuration = resolveAccessHttpConfiguration(rawEnvironment,environment.profile);
  if (!configuration) return error('temporarily_unavailable',503,requestId,token || revoke);
  if (!enabledAudiences || !enabledAudiences.admin && !enabledAudiences.app)
    return error('not_found',404,requestId,token || revoke || register);
  if(storageMutation&&!environment.storageAuthority?.storageMutation
    ||environment.storageAuthority?.storageMutation&&(token||revoke)&&!storageMutation)
    return error('temporarily_unavailable',503,requestId,token||revoke);
  const origin = configuration.origin;
  try {
    checkRequest(request,origin,Boolean(consent));
    const service = createOAuthService(environment.bindings.DB,{issuer:origin,permissions,
      enabledAudiences,permissionTitles,...(storageMutation?{storageMutation}:{})});
    if (resource || authMetadata) {
      if (request.method !== 'GET') return error('method_not_allowed',405,requestId);
      if (new URL(request.url).search) return error('invalid_request',400,requestId);
      if (resource && !enabledAudiences[resource[1] as OAuthAudience]
        || authMetadata && !enabledAudiences.admin && !enabledAudiences.app)
        return error('not_found',404,requestId);
      return json(resource ? oauthProtectedResourceMetadata(origin,resource[1] as OAuthAudience,
        service.advertisedScopes(resource[1] as OAuthAudience))
        : oauthAuthorizationServerMetadata(origin,[...new Set([
          ...service.advertisedScopes('admin'),...service.advertisedScopes('app')])]),200,requestId);
    }
    if (authorize) {
      if (request.method !== 'GET') return error('method_not_allowed',405,requestId);
      const params = new URL(request.url).searchParams;
      try {
        const result = await service.authorize(params);
        return redirect(`${origin}${result.consentPath}`,requestId);
      } catch (failure) {
        if (failure instanceof OAuthProtocolError) {
          const safe = await service.authorizationErrorRedirect(params,failure.code);
          if (safe) return redirect(safe,requestId);
        }
        throw failure;
      }
    }
    if (preview) {
      if (request.method !== 'GET') return error('method_not_allowed',405,requestId);
      const audience = await service.requestAudience(preview[1]);
      const sessionToken = await nativeSessionToken(request,rawEnvironment,environment,audience);
      if (!sessionToken) return error('authentication_required',401,requestId,false,audience);
      try { return json(await service.preview(preview[1],sessionToken),200,requestId); }
      catch (failure) {
        if (failure instanceof OAuthProtocolError && failure.code === 'authentication_required')
          return error('authentication_required',401,requestId,false,audience);
        throw failure;
      }
    }
    if (consent) {
      if (request.method !== 'POST') return error('method_not_allowed',405,requestId);
      const audience = await service.requestAudience(consent[1]);
      const sessionToken = await nativeSessionToken(request,rawEnvironment,environment,audience);
      if (!sessionToken) return error('authentication_required',401,requestId,false,audience);
      const fields = await form(request);
      const decision = one(fields,'decision',8);
      const result = await service.decide({requestId:consent[1],sessionToken,
        csrfToken:one(fields,'csrfToken',128),decision:decision as 'approve'|'deny',
        permissionIds:fields.getAll('permissionIds')});
      return redirect(result.redirectUri,requestId);
    }
    if (register) {
      if (request.method !== 'POST') return error('method_not_allowed',405,requestId,true);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? ''))
        return error('unsupported_media_type',415,requestId,true);
      const admission = createD1IdentityStore(environment.bindings.DB);
      const allowed = await admission.consumeThrottle({key:await identityAdmissionKey('oauth-dcr'),
        limit:30,windowMs:60 * 60_000});
      if (!allowed.allowed) return error('rate_limited',429,requestId,true);
      let body: unknown;
      try { body = JSON.parse(await bodyBytes(request)); }
      catch (failure) {
        if (failure instanceof OAuthProtocolError) throw failure;
        if (failure instanceof SyntaxError) return error('invalid_client_metadata',400,requestId,true);
        throw failure;
      }
      return json(await service.registerDcr(body),201,requestId);
    }
    if (token || revoke) {
      if (request.method !== 'POST') return error('method_not_allowed',405,requestId,true);
      const fields = await form(request);
      if (fields.has('client_secret') || request.headers.has('authorization'))
        return error('invalid_client',401,requestId,true);
      const clientId = one(fields,'client_id',128);
      if (revoke) {
        await service.revokeToken(clientId,one(fields,'token',128));
        return new Response(null,{status:200,headers:{'cache-control':'no-store',
          'x-creezio-request-id':requestId}});
      }
      const grantType = one(fields,'grant_type',64);
      if (grantType === 'authorization_code') {
        const result = await service.exchangeCode({clientId,code:one(fields,'code',128),
          redirectUri:one(fields,'redirect_uri'),resource:one(fields,'resource'),
          codeVerifier:one(fields,'code_verifier',128)});
        return json(result,200,requestId,{'pragma':'no-cache'});
      }
      if (grantType === 'refresh_token') {
        const result = await service.refresh({clientId,refreshToken:one(fields,'refresh_token',128),
          resource:one(fields,'resource')});
        return json(result,200,requestId,{'pragma':'no-cache'});
      }
      return error('unsupported_grant_type',400,requestId,true);
    }
    return null;
  } catch (failure) {
    if (failure instanceof OAuthProtocolError)
      return error(failure.code,failure.status,requestId,token || revoke || register);
    return error('temporarily_unavailable',503,requestId,token || revoke || register);
  }
}
