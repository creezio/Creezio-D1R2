import type {OperationHttpBinding} from '../../core/operations/http-types.ts';
import {canonicalAccessOrigin} from '../access/types.ts';
import type {OperationClientRequest, OperationClientResult, OperationClientStatusRequest} from '../operations/client.ts';
import {OPERATION_CLIENT_LIMITS, id, bindingKey, safeCode, encodedRequestKey, exact, unknown, rejected,
  validateBinding, capture, requestParts, readJson, execution} from '../operations/protocol.ts';

export interface HeadlessCredential {
  readonly kind: 'api-token' | 'oauth';
  readonly token: string;
}
export interface HeadlessClientOptions {
  readonly origin: string;
  readonly bindings: readonly OperationHttpBinding[];
  /** Supplied by the caller's secret store. Never embed an application API key in a browser bundle. */
  readonly credential: () => HeadlessCredential | null;
  readonly fetcher?: typeof fetch;
}
function captureCredential(read: HeadlessClientOptions['credential']): HeadlessCredential | null {
  try {
    const value = read();
    const kind = value?.kind, token = value?.token;
    return (kind === 'api-token' || kind === 'oauth') && typeof token === 'string'
      && /^[A-Za-z0-9._~-]{16,4096}$/.test(token)
      ? Object.freeze({kind, token}) : null;
  } catch { return null; }
}

/** External application client using the same declared HTTP bindings as the native front.
 * Credentials stay with the caller; no cookie, GPT identity, redirect, storage or automatic retry.
 * Cross-origin browser access still depends on the host policy; use a server/BFF when needed. */
export function createHeadlessOperationClient(options: HeadlessClientOptions) {
  const origin = canonicalAccessOrigin(options.origin);
  if (!origin || typeof options.credential !== 'function' || !Array.isArray(options.bindings)
    || options.bindings.length > 1000) throw new TypeError('Invalid headless client configuration.');
  const readCredential = options.credential, fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  if (typeof fetcher !== 'function') throw new TypeError('Invalid headless fetcher.');
  const bindings = new Map<string, OperationHttpBinding>();
  for (const binding of options.bindings) {
    const authentication = binding.auth?.find((kind: OperationHttpBinding['auth'][number]) => kind === 'api-token' || kind === 'oauth');
    if (!authentication) throw new TypeError('Headless bindings require API token or OAuth authentication.');
    validateBinding(binding, 'app', authentication);
    const key = `${binding.contributorModuleId}:${binding.id}`;
    if (bindings.has(key)) throw new TypeError('Duplicate headless binding.');
    bindings.set(key, structuredClone(binding));
  }
  function fresh(before: HeadlessCredential, isCurrent?: () => boolean) {
    const after = captureCredential(readCredential);
    try { return !!after && after.kind === before.kind && after.token === before.token && (isCurrent?.() ?? true); }
    catch { return false; }
  }
  async function send(url: string, init: RequestInit, before: HeadlessCredential, isCurrent: (() => boolean) | undefined,
    mode: 'invoke' | 'status' | 'lookup'): Promise<OperationClientResult> {
    const mutation = init.method !== 'GET', abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), OPERATION_CLIENT_LIMITS.readDeadlineMs);
    try {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${before.token}`);
      const response = await fetcher(url, {...init, headers, signal: abort.signal, credentials: 'omit', redirect: 'error', cache: 'no-store'});
      if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
        return unknown('invalid_response');
      const value = await readJson(response);
      if (!fresh(before, isCurrent)) return unknown('stale');
      if (mode === 'invoke' && response.status === 202 && exact(value, ['error', 'requestId'])
        && exact(value.error, ['code']) && safeCode(value.error.code) && id(value.requestId)) return unknown(value.error.code);
      if (response.status >= 200 && response.status < 300) {
        if (!exact(value, ['execution'])) return unknown('invalid_response');
        const result = execution(value.execution);
        if (!result) return unknown('invalid_response');
        return result.state === 'unknown' ? Object.freeze({kind: 'unknown', code: result.errorCode ?? 'unknown', executionId: result.id})
          : Object.freeze({kind: 'execution', execution: result});
      }
      if (exact(value, ['error', 'requestId']) && exact(value.error, ['code']) && safeCode(value.error.code) && id(value.requestId)) {
        if (response.status === 501 && ['unsupported', 'capability_unavailable'].includes(value.error.code))
          return rejected(value.error.code, response.status);
        if (response.status >= 400 && response.status < 500) {
          if (mode === 'lookup' && response.status === 404) return unknown('execution_not_observed');
          if (response.status === 408 || response.status === 499) return unknown('outcome_unknown');
          return rejected(value.error.code, response.status);
        }
      }
      return unknown('unavailable');
    } catch { return unknown(mutation ? 'outcome_unknown' : 'unavailable'); }
    finally { clearTimeout(timer); }
  }
  function prepare(request: OperationClientRequest | OperationClientStatusRequest) {
    if (!request || !bindingKey(request.bindingId) || !id(request.contextId)) return {error: rejected('invalid_input')} as const;
    const binding = bindings.get(request.bindingId);
    if (!binding) return {error: rejected('not_found')} as const;
    if (binding.context === 'application' && request.contextId !== 'application') return {error: rejected('invalid_input')} as const;
    const credential = captureCredential(readCredential);
    if (!credential) return {error: rejected('unauthorized')} as const;
    if (!binding.auth.includes(credential.kind)) return {error: rejected('authentication_required')} as const;
    if (!fresh(credential, request.isCurrent)) return {error: rejected('stale')} as const;
    return {binding, credential} as const;
  }
  return Object.freeze({origin, audience: 'app' as const,
    async invoke(request: OperationClientRequest): Promise<OperationClientResult> {
      const ready = prepare(request);
      if (ready.error) return ready.error;
      const input = capture(request.input);
      const parts = input && requestParts(origin, ready.binding, request.contextId, input);
      if (!parts) return rejected('invalid_input');
      return send(parts.url, {method: ready.binding.method, headers: parts.headers, ...(parts.body === undefined ? {} : {body: parts.body})},
        ready.credential, request.isCurrent, 'invoke');
    },
    async status(request: OperationClientStatusRequest): Promise<OperationClientResult> {
      const ready = prepare(request);
      if (ready.error) return ready.error;
      const byId = Object.hasOwn(request, 'executionId'), byKey = Object.hasOwn(request, 'requestKey');
      const key = byKey ? encodedRequestKey(request.requestKey) : null;
      if (byId === byKey || byId && !id(request.executionId) || byKey && !key) return rejected('invalid_input');
      const url = `${origin}/api/operations/${byKey ? 'lookup' : 'status'}/${encodeURIComponent(ready.binding.contributorModuleId)}/${encodeURIComponent(ready.binding.id)}`
        + (byId ? `/${encodeURIComponent(request.executionId!)}` : '');
      return send(url, {method: 'GET', headers: {'accept': 'application/json', 'x-creezio-context': request.contextId,
        ...(byKey ? {'x-creezio-request-key': key!} : {})}}, ready.credential, request.isCurrent, byKey ? 'lookup' : 'status');
    },
  });
}
export type HeadlessOperationClient = ReturnType<typeof createHeadlessOperationClient>;
