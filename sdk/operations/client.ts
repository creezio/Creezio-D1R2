import type { OperationHttpBinding, OperationHttpExecution } from '../../core/operations/http-types.ts';
import { canonicalAccessOrigin, type AccessAudience, type AccessController, type AccessSession } from '../access/types.ts';

export type OperationClientResult = Readonly<{kind: 'execution'; execution: OperationHttpExecution}>
  | Readonly<{kind: 'rejected'; code: string; status: number}>
  | Readonly<{kind: 'unknown'; code: string; executionId?: string}>;
export interface OperationClientRequest {
  readonly bindingId: string;
  readonly contextId: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** A changed workspace projection invalidates an in-flight response. */
  readonly isCurrent?: () => boolean;
}
export type OperationClientStatusRequest = Readonly<{
  readonly bindingId: string;
  readonly contextId: string;
  readonly isCurrent?: () => boolean;
} & ({readonly executionId: string; readonly requestKey?: never}
  | {readonly requestKey: string; readonly executionId?: never})>;

export const OPERATION_CLIENT_LIMITS = Object.freeze({responseBytes: 262_144 + 8192,
  readDeadlineMs: 30_000, requestKeyBytes: 512});
const encoder = new TextEncoder();
const id = (value: unknown): value is string => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const bindingKey = (value: unknown): value is string => typeof value === 'string' && value.length <= 257
  && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const safeCode = (value: unknown): value is string => typeof value === 'string' && value.length <= 128
  && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
function encodedRequestKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.length || value.length > OPERATION_CLIENT_LIMITS.requestKeyBytes
    || !value.isWellFormed()) return null;
  const bytes = encoder.encode(value);
  if (!bytes.length || bytes.byteLength > OPERATION_CLIENT_LIMITS.requestKeyBytes) return null;
  // Raw header values may trim whitespace or reject Unicode/control characters.
  // Base64url carries the exact key bytes without changing the engine's scope.
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
const own = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.value !== undefined);
const exact = (value: unknown, fields: readonly string[]): value is Record<string, unknown> => own(value)
  && Reflect.ownKeys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const sameSession = (a: AccessSession | null, b: AccessSession | null) => !!a && !!b
  && a.id === b.id && a.principalId === b.principalId && a.audience === b.audience;
const unknown = (code: string): OperationClientResult => Object.freeze({kind: 'unknown', code});
const rejected = (code: string, status = 0): OperationClientResult => Object.freeze({kind: 'rejected', code, status});
const codecs = ['string', 'integer', 'number', 'boolean'];

function validateBinding(binding: OperationHttpBinding, audience: AccessAudience) {
  if (!binding || !id(binding.id) || !id(binding.contributorModuleId) || !id(binding.moduleId) || !id(binding.operationId)
    || binding.audience !== audience || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(binding.method)
    || !/^\/api\/[A-Za-z0-9/_{}.-]*$/.test(binding.path) || binding.path.includes('..')
    || !Array.isArray(binding.auth) || !binding.auth.includes('session') || !Array.isArray(binding.parameters)
    || binding.parameters.length > 1000 || !['application', 'required'].includes(binding.context)) throw new TypeError('Invalid operation HTTP binding.');
  const names = new Set<string>(), fields = new Set<string>();
  for (const parameter of binding.parameters) {
    if (!id(parameter.name) || !id(parameter.inputField) || !['path', 'query', 'header'].includes(parameter.in)
      || typeof parameter.required !== 'boolean' || !codecs.includes(parameter.codec)
      || names.has(`${parameter.in}:${parameter.name}`)
      || fields.has(parameter.inputField)) throw new TypeError('Invalid operation HTTP parameter.');
    names.add(`${parameter.in}:${parameter.name}`); fields.add(parameter.inputField);
    if (parameter.in === 'header' && (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(parameter.name)
      || ['authorization', 'cookie', 'origin', 'host', 'content-type', 'accept', 'x-creezio-context', 'x-creezio-request'].includes(parameter.name.toLowerCase())))
      throw new TypeError('Reserved operation HTTP header.');
  }
  const placeholders = [...binding.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
  if (placeholders.length !== new Set(placeholders).size || placeholders.some(name => !binding.parameters.some(p => p.in === 'path' && p.name === name && p.required))
    || binding.parameters.some(p => p.in === 'path' && !placeholders.includes(p.name))) throw new TypeError('Invalid operation HTTP path parameters.');
}

function capture(input: unknown): Record<string, unknown> | null {
  try {
    if (!own(input) || Reflect.ownKeys(input).length > 1000) return null;
    const copy = structuredClone(input);
    if (!own(copy) || JSON.stringify(copy).length > 65_536) return null;
    return copy;
  } catch { return null; }
}
function primitive(value: unknown, codec: OperationHttpBinding['parameters'][number]['codec']): string | null {
  if (codec === 'string' && typeof value === 'string' && value.isWellFormed() && value.length <= 2048 && !/[\r\n]/.test(value)) return value;
  if (codec === 'integer' && typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (codec === 'number' && typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (codec === 'boolean' && typeof value === 'boolean') return String(value);
  return null;
}
function requestParts(origin: string, binding: OperationHttpBinding, contextId: string, input: Record<string, unknown>) {
  const fields = new Set<string>(); let path = binding.path;
  const url = new URL(path, origin);
  const headers = new Headers({'accept': 'application/json', 'x-creezio-context': contextId});
  if (binding.method !== 'GET') { headers.set('content-type', 'application/json'); headers.set('x-creezio-request', '1'); }
  for (const parameter of binding.parameters) {
    const value = Object.hasOwn(input, parameter.inputField) ? input[parameter.inputField] : undefined;
    fields.add(parameter.inputField);
    if (value === undefined || value === null) { if (parameter.required) return null; continue; }
    const encoded = primitive(value, parameter.codec); if (encoded === null) return null;
    if (parameter.in === 'path') path = path.replace(`{${parameter.name}}`, encodeURIComponent(encoded));
    else if (parameter.in === 'query') url.searchParams.set(parameter.name, encoded);
    else headers.set(parameter.name, encoded);
  }
  if (path.includes('{') || path.includes('}')) return null;
  url.pathname = path;
  if (url.origin !== origin) return null;
  const body: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(input)) if (!fields.has(key)) body[key] = value;
  if (binding.method === 'GET' && Object.keys(body).length) return null;
  return {url: url.href, headers, body: binding.method === 'GET' ? undefined : JSON.stringify(body)};
}

async function readJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error('invalid_response');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    try { void reader.cancel().catch(() => {}); } catch { /* cancellation cannot undo POST */ }
    reject(new Error('unavailable'));
  }, OPERATION_CLIENT_LIMITS.readDeadlineMs); });
  const read = async () => { let bytes = 0, text = '';
    while (true) {
      const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (bytes += part.value.byteLength) > OPERATION_CLIENT_LIMITS.responseBytes) throw new Error('invalid_response');
      text += decoder.decode(part.value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  };
  try { return await Promise.race([read(), timeout]); }
  finally { clearTimeout(timer); try { reader.releaseLock(); } catch { /* stalled producer */ } }
}
function execution(value: unknown): OperationHttpExecution | null {
  if (!exact(value, ['id', 'state', 'output', 'errorCode']) && !exact(value, ['id', 'state', 'output', 'errorCode', 'replayed'])) return null;
  if (!id(value.id) || !['running', 'waiting', 'succeeded', 'failed', 'unknown'].includes(String(value.state))
    || value.errorCode !== null && !safeCode(value.errorCode) || Object.hasOwn(value, 'replayed') && typeof value.replayed !== 'boolean') return null;
  try { return Object.freeze(structuredClone(value)) as unknown as OperationHttpExecution; } catch { return null; }
}

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
    const parts = requestParts(origin, binding, request.contextId, input);
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
