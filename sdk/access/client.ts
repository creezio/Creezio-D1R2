import { accessFields, canonicalAccessOrigin, copyAccessCredentials, copyAccessSession, isAccessAudience,
  type AccessAudience, type AccessCredentials, type AccessErrorCode, type AccessMutationResult,
  type AccessSessionResult, type AccessTransport } from './types.ts';

export const ACCESS_CLIENT_LIMITS = Object.freeze({responseBytes: 16_384, readDeadlineMs: 15_000});
const unavailable = (error: AccessErrorCode = 'unavailable'): AccessSessionResult => Object.freeze({kind: 'unavailable', error});
const failed = (error: AccessErrorCode): AccessMutationResult => Object.freeze({ok: false, error});
class InvalidResponse extends Error { constructor() { super('Invalid native access response.'); } }

/** Response headers (and Set-Cookie) have already arrived before this bounded body read.
 * Cancelling this reader is not a claim to undo an HTTP mutation or its cookies.
 */
async function responseJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new InvalidResponse();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { try { void reader.cancel().catch(() => {}); } catch { /* no diagnostics or wait */ } };
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { cancel(); reject(new InvalidResponse()); }, ACCESS_CLIENT_LIMITS.readDeadlineMs); });
  const read = async () => {
    let bytes = 0, chunks = 0, text = '';
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || ++chunks > ACCESS_CLIENT_LIMITS.responseBytes + 1) throw new InvalidResponse();
      bytes += part.value.byteLength;
      if (bytes > ACCESS_CLIENT_LIMITS.responseBytes) throw new InvalidResponse();
      text += decoder.decode(part.value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  };
  try { return await Promise.race([read(), timeout]); }
  catch { cancel(); throw new InvalidResponse(); }
  finally { clearTimeout(timer); try { reader.releaseLock(); } catch { /* producer may still be pending */ } }
}
function responseError(status: number, body: unknown): AccessErrorCode {
  const envelope = accessFields(body, ['error', 'requestId']);
  const error = envelope && accessFields(envelope.error, ['code']);
  if (!error || typeof error.code !== 'string' || typeof envelope?.requestId !== 'string'
    || envelope.requestId.length > 128) return 'invalid_response';
  if (status === 400 && error.code === 'invalid_input') return 'invalid_input';
  if (status === 401 && error.code === 'invalid_credentials') return 'invalid_credentials';
  if (status === 429 && error.code === 'rate_limited') return 'rate_limited';
  if (status >= 500 || status === 404 || status === 408 || status === 499) return 'unavailable';
  return 'request_rejected';
}

/** Fixed same-origin endpoints. No token/cookie reads, storage, provider or router imports. */
export function createAccessClient(options: {origin: string; audience: AccessAudience; fetcher?: typeof fetch}): AccessTransport {
  const origin = canonicalAccessOrigin(options.origin), audience = options.audience;
  if (!origin || !isAccessAudience(audience)) throw new Error('Invalid native access client configuration.');
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  if (typeof fetcher !== 'function') throw new Error('Invalid native access client configuration.');
  const endpoint = (operation: string) => `${origin}/api/access/${audience}/${operation}`;
  const base = {credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store'} as const;
  function checkResponse(response: Response) {
    if (!(response instanceof Response) || response.redirected
      || response.url && new URL(response.url).origin !== origin) throw new InvalidResponse();
  }
  async function mutation(operation: 'login' | 'logout', body: unknown): Promise<AccessMutationResult> {
    try {
      // No abort/deadline on an emitted POST: a caller must keep its coordination
      // lock until it settles. A browser unload remains outside this guarantee.
      const response = await fetcher(endpoint(operation), {...base, method: 'POST',
        headers: {'accept': 'application/json', 'content-type': 'application/json', 'x-creezio-request': '1'}, body: JSON.stringify(body)});
      checkResponse(response);
      const value = await responseJson(response);
      if (response.status !== 200) return failed(responseError(response.status, value));
      if (operation === 'logout') {
        if (accessFields(value, ['ok'])?.ok !== true) return failed('invalid_response');
      } else {
        const session = accessFields(value, ['session']);
        if (!session || !copyAccessSession(session.session, audience)) return failed('invalid_response');
      }
      // The POST identity is deliberately discarded; the controller reconciles by GET.
      return Object.freeze({ok: true});
    } catch (error) { return failed(error instanceof InvalidResponse ? 'invalid_response' : 'unavailable'); }
  }
  return Object.freeze({origin, audience,
    async readSession(options: {signal?: AbortSignal} = {}): Promise<AccessSessionResult> {
      const controller = new AbortController(), abort = () => controller.abort();
      if (options.signal?.aborted) return unavailable();
      options.signal?.addEventListener('abort', abort, {once: true});
      const timer = setTimeout(abort, ACCESS_CLIENT_LIMITS.readDeadlineMs);
      try {
        const response = await fetcher(endpoint('session'), {...base, method: 'GET', headers: {'accept': 'application/json'}, signal: controller.signal});
        checkResponse(response);
        const body = await responseJson(response);
        if (controller.signal.aborted) return unavailable();
        if (response.status === 401) {
          const envelope = accessFields(body, ['error', 'requestId']), error = envelope && accessFields(envelope.error, ['code']);
          return error?.code === 'authentication_required' && typeof envelope?.requestId === 'string' && envelope.requestId.length <= 128
            ? Object.freeze({kind: 'anonymous'}) : unavailable('invalid_response');
        }
        if (response.status !== 200) return unavailable(responseError(response.status, body));
        const envelope = accessFields(body, ['session']), session = envelope && copyAccessSession(envelope.session, audience);
        return session ? Object.freeze({kind: 'authenticated', session}) : unavailable('invalid_response');
      } catch (error) { return unavailable(error instanceof InvalidResponse ? 'invalid_response' : 'unavailable'); }
      finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
    },
    async login(value: AccessCredentials) {
      const credentials = copyAccessCredentials(value);
      return credentials ? mutation('login', credentials) : failed('invalid_input');
    },
    async logout() { return mutation('logout', {}); },
  });
}
