import { AccessHttpError, HTTP_POLICY, readAccessCookie, resolveAccessHttpConfiguration } from '../identity/http-policy.ts';
import type { RuntimeEnvironment } from '../runtime/environment.ts';
import type { PermissionDefinition } from '../authorization/types.ts';
import { createWorkspaceAuthorizationService, type WorkspaceAuthorizationCatalog } from './authorization.ts';

const pathPattern = /^\/api\/workspace\/(admin|app)\/projection$/;
const encoder = new TextEncoder();
function json(body: unknown, status: number, requestId: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-creezio-request-id', requestId);
  return new Response(JSON.stringify(body), {status, headers});
}
const failure = (code: string, status: number, requestId: string, extra?: HeadersInit) =>
  json({error: {code}, requestId}, status, requestId, extra);

/** Host projection for a native session. Every read resolves the current D1 policy. */
export async function dispatchWorkspaceHttp(request: Request, environment: RuntimeEnvironment, rawEnvironment: unknown,
  requestId: string, options: {readonly permissions: readonly PermissionDefinition[]; readonly catalog: WorkspaceAuthorizationCatalog}): Promise<Response | null> {
  const url = new URL(request.url), route = pathPattern.exec(url.pathname);
  if (!route) return null;
  if (request.method !== 'GET') {
    const response = failure('method_not_allowed', 405, requestId, {allow: 'GET'});
    return request.method === 'HEAD' ? new Response(null, {status: response.status, headers: response.headers}) : response;
  }
  const configuration = resolveAccessHttpConfiguration(rawEnvironment, environment.profile);
  if (!configuration) return failure('runtime_unavailable', 503, requestId);
  try {
    let bytes = 0;
    for (const [name, value] of request.headers) {
      bytes += encoder.encode(name).length + encoder.encode(value).length + 4;
      if (bytes > HTTP_POLICY.maxHeaderBytes) throw new AccessHttpError('headers_too_large', 431);
    }
    if (url.origin !== configuration.origin || url.search || request.body !== null || request.headers.has('content-encoding'))
      throw new AccessHttpError('invalid_request', 400);
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== configuration.origin) throw new AccessHttpError('origin_denied', 403);
    const site = request.headers.get('sec-fetch-site');
    if (site !== null && site !== 'same-origin' && site !== 'none') throw new AccessHttpError('origin_denied', 403);
    // A machine token cannot silently become a browser workspace session.
    if (request.headers.has('authorization')) throw new AccessHttpError('authentication_required', 401);
    const audience = route[1] as 'admin' | 'app', token = readAccessCookie(request, configuration, audience);
    if (!token) throw new AccessHttpError('authentication_required', 401);
    const context = request.headers.get('x-creezio-context') ?? 'application';
    if (!context || context.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context))
      throw new AccessHttpError('invalid_context', 400);
    const service = createWorkspaceAuthorizationService(environment.bindings.DB, options);
    const result = await service.read(token, audience, context);
    if (!result.ok) return failure(result.error === 'invalid_input' ? 'invalid_context' : result.error === 'unavailable' ? 'service_unavailable' : 'authentication_required',
      result.error === 'invalid_input' ? 400 : result.error === 'unavailable' ? 503 : 401, requestId);
    const value = result.projection;
    return json({projection: value}, 200, requestId);
  } catch (error) {
    return error instanceof AccessHttpError ? failure(error.code, error.status, requestId) : failure('service_unavailable', 503, requestId);
  }
}
