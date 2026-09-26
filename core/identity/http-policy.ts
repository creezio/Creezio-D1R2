import { isRuntimeProfile, type RuntimeProfile } from '../../adapters/runtime-profiles.ts';

export const HTTP_POLICY = Object.freeze({ maxHeaderBytes: 8192, maxBodyBytes: 16384, bodyDeadlineMs: 10000 });
export interface AccessHttpConfiguration {
  readonly origin: string;
  readonly secureCookies: boolean;
  readonly cookieNames: Readonly<{ admin: string; app: string }>;
  /** No visitor-address provenance has been qualified for these adapters. */
  readonly networkIdentity: 'unavailable';
}
export class AccessHttpError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super('Native access request rejected.');
    this.name = 'AccessHttpError'; this.code = code; this.status = status;
  }
}
type Audience = 'admin' | 'app';
const encoder = new TextEncoder();
const fail = (code: string, status: number): never => { throw new AccessHttpError(code, status); };
const cookieNames = (secure: boolean) => Object.freeze(secure
  ? { admin: '__Host-creezio-admin', app: '__Host-creezio-app' }
  : { admin: 'creezio-local-admin', app: 'creezio-local-app' });

/** A deployment value, never inferred from a request, proxy or GPT header. */
export function resolveAccessHttpConfiguration(environment: unknown, profile: RuntimeProfile): AccessHttpConfiguration | null {
  try {
    if (!isRuntimeProfile(profile) || !environment || typeof environment !== 'object') return null;
    const descriptor = Object.getOwnPropertyDescriptor(environment, 'CREEZIO_APP_ORIGIN');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    const value = descriptor.value;
    if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value) return null;
    const parsed = new URL(value);
    if (value !== parsed.origin || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    const secure = parsed.protocol === 'https:';
    if (!secure && !(profile === 'local' && parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) return null;
    return Object.freeze({ origin: parsed.origin, secureCookies: secure, cookieNames: cookieNames(secure), networkIdentity: 'unavailable' });
  } catch { return null; }
}

function validateHeaderSize(request: Request): void {
  let bytes = 0;
  for (const [name, value] of request.headers) {
    // Include separators and short-circuit before encoding a visibly huge value.
    if (name.length + value.length + 4 > HTTP_POLICY.maxHeaderBytes) fail('headers_too_large', 431);
    bytes += encoder.encode(name).byteLength + encoder.encode(value).byteLength + 4;
    if (bytes > HTTP_POLICY.maxHeaderBytes) fail('headers_too_large', 431);
  }
}
function validateJsonMetadata(request: Request): void {
  const contentType = request.headers.get('content-type');
  if (!contentType || contentType.match(/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i)?.[0] !== contentType) fail('unsupported_media_type', 415);
  if (request.headers.has('content-encoding')) fail('unsupported_content_encoding', 415);
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (length.match(/^(?:0|[1-9][0-9]*)$/)?.[0] !== length) fail('invalid_content_length', 400);
    if (length.length > 5 || Number(length) > HTTP_POLICY.maxBodyBytes) fail('body_too_large', 413);
  }
}

/** Transport checks only. Success grants neither an identity nor an operation. */
export function validateAccessHttpRequest(request: Request, configuration: AccessHttpConfiguration,
  options: { readonly mutation: boolean }): void {
  validateHeaderSize(request);
  const url = new URL(request.url);
  if (url.origin !== configuration.origin) fail('origin_denied', 403);
  if (url.search) fail('query_not_allowed', 400);
  if (request.method !== (options.mutation ? 'POST' : 'GET')) fail('method_not_allowed', 405);
  const origin = request.headers.get('origin');
  if ((options.mutation && origin !== configuration.origin) || (origin !== null && origin !== configuration.origin)) fail('origin_denied', 403);
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') fail('origin_denied', 403);
  if (options.mutation) {
    if (request.headers.get('x-creezio-request') !== '1') fail('request_header_required', 403);
    validateJsonMetadata(request);
  } else if (request.body !== null || request.headers.has('content-encoding')) {
    fail('body_not_allowed', 400);
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  // Cancellation is best-effort: a producer may never settle its cancel promise.
  try { void reader.cancel().catch(() => {}); } catch { /* No secret-bearing producer error escapes. */ }
}

/** A fixed reception deadline, not a preemption promise for KDF or later commits. */
export async function readAccessJson(request: Request): Promise<unknown> {
  validateHeaderSize(request); validateJsonMetadata(request);
  const body = request.body;
  if (request.bodyUsed || body === null) throw new AccessHttpError('invalid_json', 400);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = body.getReader(); } catch { return fail('invalid_body', 400); }
  let cancelled: AccessHttpError | undefined;
  let rejectCancellation: (reason: AccessHttpError) => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  // An already-aborted request can reject before the first read is scheduled.
  void cancellation.catch(() => {});
  const cancel = (code: string, status: number) => {
    if (cancelled) return;
    cancelled = new AccessHttpError(code, status); cancelReader(reader); rejectCancellation(cancelled);
  };
  const onAbort = () => cancel('request_cancelled', 499);
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) onAbort();
  const timer = setTimeout(() => cancel('body_timeout', 408), HTTP_POLICY.bodyDeadlineMs);
  async function consume(): Promise<unknown> {
    // Preserve a BOM so JSON.parse rejects it, instead of silently changing bytes.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let bytes = 0, chunks = 0, text = '';
    for (;;) {
      if (cancelled) throw cancelled;
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await reader.read(); } catch { throw cancelled ?? new AccessHttpError('invalid_body', 400); }
      if (cancelled) throw cancelled;
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) fail('invalid_body', 400);
      // Also bound an artificial producer yielding an endless sequence of empty
      // chunks; byte limits alone would not stop microtask starvation.
      if (++chunks > HTTP_POLICY.maxBodyBytes + 1) fail('invalid_body', 400);
      bytes += part.value.byteLength;
      if (bytes > HTTP_POLICY.maxBodyBytes) fail('body_too_large', 413);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    if (cancelled) throw cancelled;
    return JSON.parse(text);
  }
  try { return await Promise.race([consume(), cancellation]); }
  catch (error) {
    cancelReader(reader);
    if (error instanceof AccessHttpError) throw error;
    throw new AccessHttpError('invalid_json', 400);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* A cancelled pending read may still own the lock. */ }
  }
}

function selectedCookie(configuration: AccessHttpConfiguration, audience: Audience): string {
  if (audience !== 'admin' && audience !== 'app') return fail('invalid_http_configuration', 503);
  if (typeof configuration.secureCookies !== 'boolean') return fail('invalid_http_configuration', 503);
  const expected = cookieNames(configuration.secureCookies)[audience];
  if (configuration.cookieNames[audience] !== expected) return fail('invalid_http_configuration', 503);
  return expected;
}
/** The service still verifies purpose-bound canonical encoding before hashing. */
function sessionToken(value: unknown): value is string {
  // A 32-byte value has 43 base64url characters; its final two bits are zero.
  return typeof value === 'string' && value.match(/^cz1s_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/)?.[0] === value;
}

export function readAccessCookie(request: Request, configuration: AccessHttpConfiguration, audience: Audience): string | null {
  const selected = selectedCookie(configuration, audience), header = request.headers.get('cookie');
  if (header === null) return null;
  if (header.length > HTTP_POLICY.maxHeaderBytes || encoder.encode(header).byteLength > HTTP_POLICY.maxHeaderBytes) fail('headers_too_large', 431);
  let found: string | null = null;
  for (const part of header.split(';')) {
    const item = part.trim(), split = item.indexOf('='), name = split < 0 ? item : item.slice(0, split).trim();
    if (name !== selected) continue;
    if (found !== null || split < 0) fail('invalid_cookie', 401);
    const value = item.slice(split + 1);
    if (!sessionToken(value)) fail('invalid_cookie', 401);
    found = value;
  }
  return found;
}

export function serializeAccessCookie(configuration: AccessHttpConfiguration, audience: Audience, token: string, expiresAtMs: number): string {
  const name = selectedCookie(configuration, audience);
  if (!sessionToken(token) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs < 1 || expiresAtMs > 8640000000000000) fail('invalid_cookie', 503);
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict${configuration.secureCookies ? '; Secure' : ''}; Expires=${new Date(expiresAtMs).toUTCString()}`;
}
export function clearAccessCookie(configuration: AccessHttpConfiguration, audience: Audience): string {
  const name = selectedCookie(configuration, audience);
  return `${name}=; Path=/; HttpOnly; SameSite=Strict${configuration.secureCookies ? '; Secure' : ''}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
