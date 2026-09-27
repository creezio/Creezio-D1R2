import type {OperationHttpBinding, OperationHttpExecution} from '../../core/operations/http-types.ts';
import type {AccessAudience} from '../access/types.ts';
import type {OperationClientResult} from './client.ts';

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
const unknown = (code: string): OperationClientResult => Object.freeze({kind: 'unknown', code});
const rejected = (code: string, status = 0): OperationClientResult => Object.freeze({kind: 'rejected', code, status});
const codecs = ['string', 'integer', 'number', 'boolean'];

function validateBinding(binding: OperationHttpBinding, audience: AccessAudience, authentication: 'session' | 'api-token' | 'oauth' = 'session') {
  if (!binding || !id(binding.id) || !id(binding.contributorModuleId) || !id(binding.moduleId) || !id(binding.operationId)
    || binding.audience !== audience || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(binding.method)
    || !/^\/api\/[A-Za-z0-9/_{}.-]*$/.test(binding.path) || binding.path.includes('..')
    || !Array.isArray(binding.auth) || !binding.auth.includes(authentication) || !Array.isArray(binding.parameters)
    || binding.parameters.length > 1000 || !['application', 'required'].includes(binding.context)) throw new TypeError('Invalid operation HTTP binding.');
  const names = new Set<string>(), fields = new Set<string>();
  for (const parameter of binding.parameters) {
    if (!id(parameter.name) || !id(parameter.inputField) || !['path', 'query', 'header'].includes(parameter.in)
      || typeof parameter.required !== 'boolean' || !codecs.includes(parameter.codec)
      || names.has(`${parameter.in}:${parameter.name}`)
      || fields.has(parameter.inputField)) throw new TypeError('Invalid operation HTTP parameter.');
    names.add(`${parameter.in}:${parameter.name}`); fields.add(parameter.inputField);
    if (parameter.in === 'header' && (!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(parameter.name)
      || ['authorization', 'cookie', 'origin', 'host', 'content-type', 'accept', 'x-creezio-context', 'x-creezio-request', 'x-creezio-request-key', 'x-creezio-approval-id'].includes(parameter.name.toLowerCase())))
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
function requestParts(origin: string, binding: OperationHttpBinding, contextId: string, input: Record<string, unknown>, approvalId?: string) {
  if (approvalId !== undefined && (!id(approvalId) || approvalId.length > 128)) return null;
  const fields = new Set<string>(); let path = binding.path;
  const url = new URL(path, origin);
  const headers = new Headers({'accept': 'application/json', 'x-creezio-context': contextId});
  if (approvalId) headers.set('x-creezio-approval-id', approvalId);
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

export {id, bindingKey, safeCode, encodedRequestKey, exact, unknown, rejected, validateBinding, capture, requestParts, readJson, execution};
