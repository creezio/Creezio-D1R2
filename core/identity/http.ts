import { createAccountService } from './accounts.ts';
import type { NativeSession } from './d1-store.ts';
import { AccessHttpError, resolveAccessHttpConfiguration, validateAccessHttpRequest, readAccessJson,
  readAccessCookie, serializeAccessCookie, clearAccessCookie } from './http-policy.ts';
import { identityInputFields } from './input.ts';
import type { RuntimeEnvironment } from '../runtime/environment.ts';
import type { RuntimeNativeAccess } from '../runtime/types.ts';
import type {NativeLogoutResult} from '../storage-authority/native-session.ts';

export const ACCESS_HTTP_OPERATION_DEADLINE_MS = 30_000;
type Audience = 'admin' | 'app';

function json(body: unknown, status: number, requestId: string, head: boolean, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-creezio-request-id', requestId);
  return new Response(head ? null : JSON.stringify(body), {status, headers});
}
function failure(code: string, status: number, requestId: string, head: boolean, extra?: HeadersInit): Response {
  return json({error: {code}, requestId}, status, requestId, head, extra);
}
function publicSession(session: NativeSession) {
  return {id: session.id, principalId: session.principalId, displayName: session.displayName,
    audience: session.audience, createdAtMs: session.createdAtMs, expiresAtMs: session.expiresAtMs};
}

/** Bounds response completion, not synchronous KDF CPU or a D1 commit already in flight.
 * Late results are never adopted, retried or exposed as cookies. A timeout is not proof of no effect.
 */
async function bounded<T>(request: Request, operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + ACCESS_HTTP_OPERATION_DEADLINE_MS;
  let cancelled: AccessHttpError | undefined;
  let rejectCancellation: (error: AccessHttpError) => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const cancel = (error: AccessHttpError) => { if (!cancelled) { cancelled = error; rejectCancellation(error); } };
  const onAbort = () => cancel(new AccessHttpError('request_cancelled', 499));
  if (request.signal.aborted) onAbort(); else request.signal.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => cancel(new AccessHttpError('operation_timeout', 504)), ACCESS_HTTP_OPERATION_DEADLINE_MS);
  try {
    const result = await Promise.race([cancellation, Promise.resolve().then(() => {
      if (cancelled) throw cancelled;
      return operation();
    })]);
    if (request.signal.aborted) throw new AccessHttpError('request_cancelled', 499);
    if (Date.now() >= deadline) throw new AccessHttpError('operation_timeout', 504);
    return result;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', onAbort);
  }
}

/** Native authentication handshake, not a public module mutation or an authorization bypass.
 * Host-only adapter: bindings and credentials never enter a module handler context.
 */
export async function dispatchAccessHttp(request: Request, environment: RuntimeEnvironment, rawEnvironment: unknown,
  nativeAccess: RuntimeNativeAccess, requestId: string, path: string,
  routedLogout?: (token:string,audience:Audience)=>Promise<NativeLogoutResult>): Promise<Response> {
  const head = request.method === 'HEAD';
  const match = /^\/api\/access\/(admin|app)\/(login|session|logout)$/.exec(path);
  if (!match) return failure('not_found', 404, requestId, head);
  const audience = match[1] as Audience, operation = match[2];
  if (!nativeAccess[audience]) return failure('not_found', 404, requestId, head);
  const method = operation === 'session' ? 'GET' : 'POST';
  if (request.method !== method) return failure('method_not_allowed', 405, requestId, head, {allow: method});
  const configuration = resolveAccessHttpConfiguration(rawEnvironment, environment.profile);
  if (!configuration) return failure('runtime_unavailable', 503, requestId, head);
  try {
    validateAccessHttpRequest(request, configuration, {mutation: method === 'POST'});
    // Reject alternate encodings and trailing slash aliases on credential endpoints.
    if (new URL(request.url).pathname !== path) throw new AccessHttpError('invalid_path', 400);
    const service = createAccountService(environment.bindings.DB);
    if (operation === 'login') {
      const result = await bounded(request, async () => {
        const body = await readAccessJson(request);
        if (!identityInputFields(body, ['loginIdentifier', 'password'])) throw new AccessHttpError('invalid_input', 400);
        if (request.signal.aborted) throw new AccessHttpError('request_cancelled', 499);
        return service.login({loginIdentifier: body.loginIdentifier, password: body.password, audience});
      });
      if (!result.ok) {
        const status = result.code === 'rate_limited' ? 429 : result.code === 'invalid_input' ? 400 : 401;
        return failure(result.code, status, requestId, head, status === 429 ? {'retry-after': '60'} : undefined);
      }
      return json({session: publicSession(result.session)}, 200, requestId, head,
        {'set-cookie': serializeAccessCookie(configuration, audience, result.token, result.session.expiresAtMs)});
    }
    if (operation === 'session') {
      let token: string | null;
      try { token = readAccessCookie(request, configuration, audience); }
      catch (error) { if (!(error instanceof AccessHttpError) || error.status !== 401) throw error; token = null; }
      const session = token ? await bounded(request, () => service.session(token, audience)) : null;
      return session
        ? json({session: publicSession(session)}, 200, requestId, head)
        // A delayed GET refusal must not clear a newer login cookie. Browsers
        // apply Set-Cookie independently of a UI's stale-response protection.
        : failure('authentication_required', 401, requestId, head);
    }
    await bounded(request, async () => {
      const body = await readAccessJson(request);
      if (!identityInputFields(body, [])) throw new AccessHttpError('invalid_input', 400);
      if (request.signal.aborted) throw new AccessHttpError('request_cancelled', 499);
      let token: string | null;
      try { token = readAccessCookie(request, configuration, audience); }
      catch (error) { if (!(error instanceof AccessHttpError) || error.status !== 401) throw error; token = null; }
      // Absence or an already invalid credential is deliberately indistinguishable.
      // Storage failures propagate and never produce a successful logout response.
      if (token) {
        if (environment.storageAuthority?.inventory.length && !routedLogout)
          throw new AccessHttpError('storage_revocation_unavailable',503);
        if (routedLogout) {
          const outcome=await routedLogout(token,audience);
          if(outcome.state==='pending')throw new AccessHttpError('storage_revocation_pending',503);
          if(outcome.state!=='revoked'&&outcome.state!=='not_found')
            throw new AccessHttpError('storage_revocation_unavailable',503);
        }else await service.logout(token,audience);
      }
    });
    return json({ok: true}, 200, requestId, head, {'set-cookie': clearAccessCookie(configuration, audience)});
  } catch (error) {
    if (error instanceof AccessHttpError) return failure(error.code, error.status, requestId, head);
    return failure('service_unavailable', 503, requestId, head);
  }
}
