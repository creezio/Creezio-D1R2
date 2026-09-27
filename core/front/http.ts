import { AccessHttpError, HTTP_POLICY, readAccessCookie, resolveAccessHttpConfiguration } from '../identity/http-policy.ts';
import type { RuntimeEnvironment } from '../runtime/environment.ts';
import type { PermissionDefinition } from '../authorization/types.ts';
import { createFrontAuthorizationService, type FrontAuthorizationCatalog } from './authorization.ts';

const encoder = new TextEncoder();
const path = '/api/front/projection';
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

/** Browser-only front projection for one fresh native app session and context. */
export async function dispatchFrontHttp(request: Request, environment: RuntimeEnvironment, rawEnvironment: unknown,
  requestId: string, options: {readonly permissions: readonly PermissionDefinition[];
    readonly catalog: FrontAuthorizationCatalog}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== path) return null;
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
    if (request.headers.has('authorization')) throw new AccessHttpError('authentication_required', 401);
    const token = readAccessCookie(request, configuration, 'app');
    if (!token) throw new AccessHttpError('authentication_required', 401);
    const context = request.headers.get('x-creezio-context') ?? 'application';
    if (!context || context.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(context))
      throw new AccessHttpError('invalid_context', 400);
    const service = createFrontAuthorizationService(environment.bindings.DB, options);
    const result = await service.read(token, context);
    if (!result.ok) return failure(result.error === 'invalid_input' ? 'invalid_context' : result.error === 'unavailable' ? 'service_unavailable' : 'authentication_required',
      result.error === 'invalid_input' ? 400 : result.error === 'unavailable' ? 503 : 401, requestId);
    return json({projection: result.projection}, 200, requestId);
  } catch (error) {
    return error instanceof AccessHttpError ? failure(error.code, error.status, requestId) : failure('service_unavailable', 503, requestId);
  }
}
