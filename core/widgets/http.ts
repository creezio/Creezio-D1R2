import {AccessHttpError, HTTP_POLICY, readAccessCookie, readAccessJson, validateAccessHttpRequest, resolveAccessHttpConfiguration} from '../identity/http-policy.ts';
import {createD1IdentityStore} from '../identity/d1-store.ts';
import {identityAdmissionKey} from '../identity/input.ts';
import {OperationError} from '../operations/types.ts';
import type {WidgetApprovalService} from './approval.ts';
import {createNativeAuthorizationResolver} from '../authorization/resolver.ts';
import {authorize} from '../authorization/authorize.ts';
import {policySnapshot} from '../authorization/policy.ts';
import type {PermissionDefinition} from '../authorization/types.ts';
import type {RuntimeEnvironment} from '../runtime/environment.ts';
import type {CompiledWidgetCatalog, WidgetCatalogEntry} from '../../sdk/widgets/catalog.ts';

const encoder = new TextEncoder();
const routePattern = /^\/api\/widgets\/(admin|app)\/(catalog|resource|approvals)(?:\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})(\/decide)?)?$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const reject = (code: string, status: number): never => {throw new AccessHttpError(code, status);};
const headers = (requestId: string) => ({'content-type':'application/json; charset=utf-8', 'cache-control':'no-store',
  'x-content-type-options':'nosniff', 'x-creezio-request-id':requestId});
function json(value: unknown, requestId: string, limit: number): Response {
  const body = JSON.stringify(value);
  if (encoder.encode(body).length > limit) reject('response_too_large', 413);
  return new Response(body, {headers:headers(requestId)});
}
function failure(code: string, status: number, requestId: string, head = false): Response {
  return new Response(head ? null : JSON.stringify({error:{code}, requestId}), {status, headers:headers(requestId)});
}

/** Deployment-owned distinct origin; no origin supplied by a widget or a request. */
export function widgetSandboxOrigin(raw: unknown, profile: RuntimeEnvironment['profile'], appOrigin: string): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'CREEZIO_WIDGET_SANDBOX_ORIGIN');
  const value: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (typeof value !== 'string' || value.length > 2048 || value === appOrigin) return null;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' || profile === 'local' && url.protocol === 'http:'
      && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) ? value : null;
  } catch {return null;}
}

/** Native browser projection. HTML is fetched separately, after the same fresh ACL resolution. */
export async function dispatchWidgetHttp(request: Request, environment: RuntimeEnvironment, rawEnvironment: unknown,
  requestId: string, options: {permissions: readonly PermissionDefinition[]; catalog: CompiledWidgetCatalog;
    approvals?:WidgetApprovalService}): Promise<Response | null> {
  const url = new URL(request.url), route = routePattern.exec(url.pathname);
  if (!route) return null;
  const approvalRoute = route[2] === 'approvals', approvalId = route[3], decision = !!route[4];
  if (!approvalRoute && approvalId) return null;
  const mutation = approvalRoute && (!approvalId || decision), method = mutation ? 'POST' : 'GET';
  if (request.method !== method) {
    const response = failure('method_not_allowed',405,requestId,request.method === 'HEAD');
    response.headers.set('allow',method); return response;
  }
  const configuration = resolveAccessHttpConfiguration(rawEnvironment, environment.profile);
  if (!configuration) return failure('runtime_unavailable',503,requestId);
  try {
    let headerBytes = 0;
    for (const [name,value] of request.headers) {
      headerBytes += encoder.encode(name).length + encoder.encode(value).length + 4;
      if (headerBytes > HTTP_POLICY.maxHeaderBytes) reject('headers_too_large',431);
    }
    if (url.origin !== configuration.origin || request.headers.has('origin') && request.headers.get('origin') !== configuration.origin)
      reject('origin_denied',403);
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') reject('origin_denied',403);
    if (approvalRoute) validateAccessHttpRequest(request,configuration,{mutation});
    else if (request.body !== null || request.headers.has('content-encoding')) reject('body_not_allowed',400);
    if (route[2] !== 'resource' ? !!url.search : [...url.searchParams].length !== 1 || !url.searchParams.has('uri'))
      reject('invalid_query',400);
    const uri = route[2] === 'resource' ? url.searchParams.get('uri')! : null;
    if (uri !== null && (!uri || uri.length > 1024 || !uri.isWellFormed())) reject('invalid_input',400);
    if (request.headers.has('authorization')) reject('authentication_required',401);
    const audience = route[1] as 'admin' | 'app', token = readAccessCookie(request, configuration, audience);
    if (!token) return failure('authentication_required',401,requestId);
    const contextId = request.headers.get('x-creezio-context') ?? 'application';
    if (!idPattern.test(contextId)) reject('invalid_context',400);
    if (approvalRoute) {
      if (!options.approvals) reject('runtime_unavailable',503);
      const admission = await createD1IdentityStore(environment.bindings.DB).consumeThrottle({
        key:await identityAdmissionKey('widget-approval-http',`${audience}:${contextId}:${token}`),limit:60,windowMs:60000});
      if (!admission.allowed) reject('rate_limited',429);
      const credential = {kind:'session' as const,token};
      const scope = {credential,audience,contextId};
      if (!mutation) return json(await options.approvals!.preview({...scope,approvalId}),requestId,32768);
      const body = await readAccessJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) reject('invalid_input',400);
      const input = body as Record<string,unknown>, keys = Object.keys(input);
      if (decision) {
        if (keys.length !== 2 || !keys.includes('decision') || !keys.includes('csrfNonce')
          || input.decision !== 'approve' && input.decision !== 'reject' || typeof input.csrfNonce !== 'string') reject('invalid_input',400);
        return json(await options.approvals!.decide({...scope,approvalId,decision:input.decision as 'approve'|'reject',
          csrfNonce:input.csrfNonce as string}),requestId,32768);
      }
      if (keys.length !== 3 || !keys.includes('moduleId') || !keys.includes('operationId') || !keys.includes('input')
        || typeof input.moduleId !== 'string' || typeof input.operationId !== 'string'
        || !idPattern.test(input.moduleId) || !idPattern.test(input.operationId)) reject('invalid_input',400);
      return json(await options.approvals!.request({...scope,moduleId:input.moduleId as string,
        operationId:input.operationId as string,input:input.input}),requestId,32768);
    }
    const resolver = createNativeAuthorizationResolver(environment.bindings.DB,{permissions:options.permissions});
    const state = await resolver.resolve(token, audience);
    if (!state) return failure('authentication_required',401,requestId);
    const snapshot = policySnapshot(state.policy,resolver.permissions,state.session);
    const canRead = (permissions: readonly string[]) => authorize(snapshot,{contextId,audience,actors:['user'],
      requiredPermissionIds:permissions,purpose:'operation'},state.nowMs).allowed;
    if (!canRead([])) reject('forbidden',403);
    const allowed = (entry: WidgetCatalogEntry) => entry.audiences.includes(audience) && canRead(entry.permissions);
    const widgets = options.catalog.widgets.filter(allowed);
    const resourceUris = new Set(widgets.map(entry => entry.resourceUri));
    const resources = options.catalog.resources.filter(resource => resource.audiences.includes(audience) && resourceUris.has(resource.uri));
    if (uri !== null) {
      const resource = resources.find(entry => entry.uri === uri);
      if (!resource) return failure('not_found',404,requestId);
      // JSON escaping can expand a 1 MiB UTF-8 resource to six times its size.
      return json({resource},requestId,6 * 1048576 + 32768);
    }
    const sandboxOrigin = widgetSandboxOrigin(rawEnvironment,environment.profile,configuration.origin);
    if (!sandboxOrigin) reject('widget_sandbox_unavailable',503);
    return json({sandboxOrigin,sessionId:state.session.id,principalId:state.session.principalId,audience,contextId,epoch:state.epoch,
      widgets,resources:resources.map(({text:_text,...metadata}) => metadata)},requestId,262144);
  } catch (error) {
    if (error instanceof OperationError) {
      const status = {invalid_input:400,unauthorized:401,forbidden:403,not_found:404,conflict:409,rate_limited:429,
        approval_required:428,unsupported:501,unknown:202}[error.code as string] ?? 503;
      return failure(error.code,status,requestId);
    }
    return error instanceof AccessHttpError ? failure(error.code,error.status,requestId) : failure('service_unavailable',503,requestId);
  }
}
