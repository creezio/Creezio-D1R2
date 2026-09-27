import type { OperationHttpBinding, OperationHttpExecution } from '../../core/operations/http-types.ts';
import { canonicalAccessOrigin, type AccessAudience, type AccessController, type AccessSession } from '../access/types.ts';

export type OperationClientResult = Readonly<{kind: 'execution'; execution: OperationHttpExecution}>
  | Readonly<{kind: 'rejected'; code: string; status: number}>
  | Readonly<{kind: 'unknown'; code: string; executionId?: string}>;
export interface OperationClientRequest {
  readonly bindingId: string;
  readonly contextId: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** Opaque server grant pointer, kept outside business input. */
  readonly approvalId?: string;
  /** A changed workspace projection invalidates an in-flight response. */
  readonly isCurrent?: () => boolean;
}
export type OperationClientStatusRequest = Readonly<{
  readonly bindingId: string;
  readonly contextId: string;
  readonly isCurrent?: () => boolean;
} & ({readonly executionId: string; readonly requestKey?: never}
  | {readonly requestKey: string; readonly executionId?: never})>;

import {id, bindingKey, safeCode, encodedRequestKey, exact, unknown, rejected, validateBinding, capture, requestParts, readJson, execution} from './protocol.ts';
export {OPERATION_CLIENT_LIMITS} from './protocol.ts';

const sameSession = (a: AccessSession | null, b: AccessSession | null) => !!a && !!b
  && a.id === b.id && a.principalId === b.principalId && a.audience === b.audience;

/** Same-origin session client. The binding, audience and route are static host data;
 * the caller chooses a binding ID and input, never a generic operation endpoint. */
export function createOperationClient(options: {origin: string; audience: AccessAudience; access: AccessController;
  bindings: readonly OperationHttpBinding[]; fetcher?: typeof fetch}) {
  const origin = canonicalAccessOrigin(options.origin), audience = options.audience;
  if (!origin || !['admin', 'app'].includes(audience) || options.access.origin !== origin
    || options.access.audience !== audience || !Array.isArray(options.bindings) || options.bindings.length > 1000) throw new TypeError('Invalid operation client configuration.');
  const bindings = new Map<string, OperationHttpBinding>();
  for (const binding of options.bindings) {
    validateBinding(binding, audience);
    const key = `${binding.contributorModuleId}:${binding.id}`;
    if (bindings.has(key)) throw new TypeError('Duplicate operation HTTP binding.');
    bindings.set(key, structuredClone(binding));
  }
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  if (typeof fetcher !== 'function') throw new TypeError('Invalid operation fetcher.');
  return Object.freeze({origin, audience, async invoke(request: OperationClientRequest): Promise<OperationClientResult> {
    if (!request || !bindingKey(request.bindingId) || !id(request.contextId)) return rejected('invalid_input');
    const binding = bindings.get(request.bindingId);
    if (!binding) return rejected('not_found');
    if (binding.context === 'application' && request.contextId !== 'application') return rejected('invalid_input');
    const input = capture(request.input), before = options.access.getSnapshot();
    if (!input) return rejected('invalid_input');
    if (before.phase !== 'authenticated' || before.pending || !before.session) return rejected('unauthorized');
    if (request.isCurrent && !request.isCurrent()) return rejected('stale');
    const parts = requestParts(origin, binding, request.contextId, input, request.approvalId);
    if (!parts) return rejected('invalid_input');
    const mutation = binding.method !== 'GET';
    try {
      const response = await fetcher(parts.url, {method: binding.method, headers: parts.headers,
        ...(parts.body === undefined ? {} : {body: parts.body}), credentials: 'same-origin', mode: 'same-origin',
        redirect: 'error', cache: 'no-store'});
      if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
        return unknown('invalid_response');
      const value = await readJson(response);
      const after = options.access.getSnapshot();
      if (after.phase !== 'authenticated' || after.pending || !sameSession(before.session, after.session)
        || request.isCurrent && !request.isCurrent()) return unknown('stale');
      if (response.status === 202 && exact(value, ['error', 'requestId']) && exact(value.error, ['code'])
        && safeCode(value.error.code) && typeof value.requestId === 'string' && value.requestId.length <= 128)
        return unknown(value.error.code);
      if (response.status >= 200 && response.status < 300) {
        if (!exact(value, ['execution'])) return unknown('invalid_response');
        const result = execution(value.execution);
        if (!result) return unknown('invalid_response');
        return result.state === 'unknown' ? Object.freeze({kind: 'unknown', code: result.errorCode ?? 'unknown', executionId: result.id})
          : Object.freeze({kind: 'execution', execution: result});
      }
      if (exact(value, ['error', 'requestId']) && exact(value.error, ['code']) && safeCode(value.error.code)
        && typeof value.requestId === 'string' && value.requestId.length <= 128) {
        if (response.status === 501 && ['unsupported', 'capability_unavailable'].includes(value.error.code))
          return rejected(value.error.code, response.status);
        if (response.status >= 400 && response.status < 500)
          return response.status === 408 || response.status === 499 ? unknown('outcome_unknown') : rejected(value.error.code, response.status);
      }
      return unknown('unavailable');
    } catch { return unknown(mutation ? 'outcome_unknown' : 'unavailable'); }
  }, async status(request: OperationClientStatusRequest): Promise<OperationClientResult> {
    if (!request || !bindingKey(request.bindingId) || !id(request.contextId)) return rejected('invalid_input');
    const byId = Object.hasOwn(request, 'executionId'), byKey = Object.hasOwn(request, 'requestKey');
    if (byId === byKey) return rejected('invalid_input');
    const encodedKey = byKey ? encodedRequestKey(request.requestKey) : null;
    if (byId && !id(request.executionId) || byKey && !encodedKey)
      return rejected('invalid_input');
    const binding = bindings.get(request.bindingId);
    if (!binding) return rejected('not_found');
    if (binding.context === 'application' && request.contextId !== 'application') return rejected('invalid_input');
    const before = options.access.getSnapshot();
    if (before.phase !== 'authenticated' || before.pending || !before.session) return rejected('unauthorized');
    if (request.isCurrent && !request.isCurrent()) return rejected('stale');
    try {
      const prefix = byKey ? 'lookup' : 'status';
      const url = `${origin}/api/operations/${prefix}/${encodeURIComponent(binding.contributorModuleId)}/${encodeURIComponent(binding.id)}`
        + (byId ? `/${encodeURIComponent(request.executionId!)}` : '');
      const response = await fetcher(url, {method: 'GET', headers: {'accept': 'application/json',
        'x-creezio-context': request.contextId, ...(byKey ? {'x-creezio-request-key': encodedKey!} : {})},
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store'});
      if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
        return unknown('invalid_response');
      const value = await readJson(response);
      const after = options.access.getSnapshot();
      if (after.phase !== 'authenticated' || after.pending || !sameSession(before.session, after.session)
        || request.isCurrent && !request.isCurrent()) return unknown('stale');
      if (response.status === 200 || byKey && response.status === 202) {
        if (!exact(value, ['execution'])) return unknown('invalid_response');
        const result = execution(value.execution);
        if (!result) return unknown('invalid_response');
        return result.state === 'unknown' ? Object.freeze({kind: 'unknown', code: result.errorCode ?? 'unknown', executionId: result.id})
          : Object.freeze({kind: 'execution', execution: result});
      }
      if (exact(value, ['error', 'requestId']) && exact(value.error, ['code']) && safeCode(value.error.code)
        && typeof value.requestId === 'string' && value.requestId.length <= 128 && response.status >= 400 && response.status < 500)
        return byKey && response.status === 404 ? unknown('execution_not_observed') : rejected(value.error.code, response.status);
      return unknown('unavailable');
    } catch { return unknown('unavailable'); }
  }});
}
export type OperationClient = ReturnType<typeof createOperationClient>;
