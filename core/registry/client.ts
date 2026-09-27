import type {
  RegistryArtifact, RegistryDeclarationRequest, RegistryDeclarationResult,
  RegistryPreflightRequest, RegistryPreflightResult
} from '../../sdk/registry/types.ts';

const MAX_RESPONSE_BYTES = 16_384;
const MAX_REQUEST_BYTES = 16_384;
const DEADLINE_MS = 10_000;
const encoder = new TextEncoder();
const digest = /^sha256-[0-9a-f]{64}$/;
const compositionDigest = /^sha256-[0-9a-f]{64}$/;
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const tokenPattern = /^cz1d_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const version = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const failureCodes = new Set(['invalid_input', 'authentication_required', 'forbidden', 'conflict',
  'not_found', 'rate_limited', 'configuration_unavailable', 'service_unavailable']);

export type RegistryClientErrorCode = 'invalid_configuration' | 'invalid_input' | 'unavailable'
  | 'invalid_response' | 'invalid_input_remote' | 'authentication_required' | 'forbidden'
  | 'conflict' | 'not_found' | 'rate_limited' | 'configuration_unavailable' | 'service_unavailable';

/** Error messages deliberately exclude request bodies, credentials and server text. */
export class RegistryClientError extends Error {
  readonly code: RegistryClientErrorCode;
  readonly status?: number;
  constructor(code: RegistryClientErrorCode, status?: number) {
    super(`Registry request failed (${code}).`);
    this.name = 'RegistryClientError'; this.code = code; this.status = status;
  }
}

function invalidInput(): never { throw new RegistryClientError('invalid_input'); }
function ownData(value: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidInput();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return invalidInput();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !allowed.includes(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))
    || required.some(key => !Object.hasOwn(descriptors, key))) return invalidInput();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function text(value: unknown, pattern: RegExp, limit: number): string {
  if (typeof value !== 'string' || value.length > limit || !value.isWellFormed() || !pattern.test(value)) return invalidInput();
  return value;
}
function artifact(value: unknown): RegistryArtifact {
  const data = ownData(value, ['sourceSha', 'artifactDigest', 'coreVersion', 'contractVersion', 'compositionDigest']);
  return Object.freeze({
    sourceSha: text(data.sourceSha, sha, 64), artifactDigest: text(data.artifactDigest, digest, 71),
    coreVersion: text(data.coreVersion, version, 64), contractVersion: text(data.contractVersion, version, 64),
    compositionDigest: text(data.compositionDigest, compositionDigest, 71)
  });
}
function url(value: unknown, allowLoopback: boolean): string {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value) return invalidInput();
  let parsed: URL;
  try { parsed = new URL(value); } catch { return invalidInput(); }
  const local = allowLoopback && parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local || parsed.username || parsed.password || parsed.hash) return invalidInput();
  return parsed.href;
}
function utc(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) return invalidInput();
  return value;
}
function boundedBody(value: unknown): string {
  const body = JSON.stringify(value);
  if (encoder.encode(body).byteLength > MAX_REQUEST_BYTES) return invalidInput();
  return body;
}

export function captureRegistryPreflight(value: unknown): RegistryPreflightRequest {
  const data = ownData(value, ['projectId', 'installationId', 'target', 'artifact']);
  if (data.target !== 'sites' && data.target !== 'cloudflare') return invalidInput();
  return Object.freeze({ projectId: text(data.projectId, id, 128), installationId: text(data.installationId, id, 128),
    target: data.target, artifact: artifact(data.artifact) });
}

export function captureRegistryDeclaration(value: unknown, allowLoopback = false): RegistryDeclarationRequest {
  const data = ownData(value, ['preflightId', 'requestKey', 'projectId', 'installationId', 'deploymentId',
    'url', 'repositoryUrl', 'artifact', 'publishedSha'],
  ['preflightId', 'requestKey', 'projectId', 'installationId', 'deploymentId', 'url', 'artifact']);
  return Object.freeze({
    preflightId: text(data.preflightId, id, 128), requestKey: text(data.requestKey, id, 128),
    projectId: text(data.projectId, id, 128), installationId: text(data.installationId, id, 128),
    deploymentId: text(data.deploymentId, id, 128), url: url(data.url, allowLoopback),
    ...(data.repositoryUrl === undefined ? {} : { repositoryUrl: url(data.repositoryUrl, false) }),
    ...(data.publishedSha === undefined ? {} : { publishedSha: text(data.publishedSha, sha, 64) }),
    artifact: artifact(data.artifact)
  });
}

export interface RegistryClient {
  preflight(request: RegistryPreflightRequest): Promise<RegistryPreflightResult>;
  declare(request: RegistryDeclarationRequest): Promise<RegistryDeclarationResult>;
}
export interface RegistryClientOptions {
  readonly origin: string;
  readonly installationToken: string;
  readonly allowLoopback?: boolean;
  readonly fetch?: typeof fetch;
}

function responseObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RegistryClientError('invalid_response');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(data, key)))
    throw new RegistryClientError('invalid_response');
  return data;
}
function validatePreflightResult(value: unknown, request: RegistryPreflightRequest): RegistryPreflightResult {
  try {
    const data = responseObject(value, ['preflightId', 'projectId', 'installationId', 'checkedAt', 'expiresAt']);
    const result = Object.freeze({ preflightId: text(data.preflightId, id, 128),
      projectId: text(data.projectId, id, 128), installationId: text(data.installationId, id, 128),
      checkedAt: utc(data.checkedAt), expiresAt: utc(data.expiresAt) });
    if (result.projectId !== request.projectId || result.installationId !== request.installationId
      || Date.parse(result.expiresAt) <= Date.parse(result.checkedAt)
      || Date.parse(result.expiresAt) - Date.parse(result.checkedAt) > 10 * 60_000) throw new Error();
    return result;
  } catch { throw new RegistryClientError('invalid_response'); }
}
function validateDeclarationResult(value: unknown, request: RegistryDeclarationRequest): RegistryDeclarationResult {
  try {
    const data = responseObject(value, ['projectId', 'installationId', 'deploymentId', 'declaredAt', 'replayed']);
    const result = Object.freeze({ projectId: text(data.projectId, id, 128),
      installationId: text(data.installationId, id, 128), deploymentId: text(data.deploymentId, id, 128),
      declaredAt: utc(data.declaredAt), replayed: data.replayed });
    if (result.projectId !== request.projectId || result.installationId !== request.installationId
      || result.deploymentId !== request.deploymentId || typeof result.replayed !== 'boolean') throw new Error();
    return result as RegistryDeclarationResult;
  } catch { throw new RegistryClientError('invalid_response'); }
}
async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.headers.get('content-type')?.match(/^application\/json(?:\s*;\s*charset=utf-8)?$/i)?.[0]
    !== response.headers.get('content-type') || !response.body)
    throw new RegistryClientError('invalid_response', response.status);
  // Fetch may decode the body while retaining its wire content-encoding header.
  // Bound the bytes returned by the stream, including after any decompression.
  const reader = response.body.getReader();
  const cancel = () => { try { void reader.cancel().catch(() => {}); } catch { /* best effort */ } };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  let bytes = 0, chunks = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || ++chunks > MAX_RESPONSE_BYTES + 1) throw new Error();
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error();
      parts.push(part.value);
    }
    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const part of parts) { combined.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(combined));
  } catch { throw new RegistryClientError('invalid_response', response.status); }
  finally { signal.removeEventListener('abort', cancel); cancel(); try { reader.releaseLock(); } catch { /* pending read */ } }
}

/** Server-side only; the token stays in this closure and is never returned or serialized. */
export function createRegistryClient(options: RegistryClientOptions): RegistryClient {
  if (typeof window !== 'undefined' || !options || typeof options !== 'object')
    throw new RegistryClientError('invalid_configuration');
  let parsed: URL;
  try { parsed = new URL(options.origin); } catch { throw new RegistryClientError('invalid_configuration'); }
  const loopback = options.allowLoopback === true && parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (options.origin !== parsed.origin || parsed.username || parsed.password || parsed.protocol !== 'https:' && !loopback
    || typeof options.installationToken !== 'string' || !tokenPattern.test(options.installationToken)
    || options.fetch !== undefined && typeof options.fetch !== 'function')
    throw new RegistryClientError('invalid_configuration');
  const base = parsed.origin, token = options.installationToken, fetcher = options.fetch ?? fetch;
  const allowLoopbackDelivery = options.allowLoopback === true;

  async function post(path: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new RegistryClientError('unavailable')); }, DEADLINE_MS);
    });
    let response: Response;
    try {
      response = await Promise.race([fetcher(`${base}${path}`, { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
        body: boundedBody(payload), redirect: 'error', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: controller.signal }), expired]);
      const value = await Promise.race([readResponse(response, controller.signal), expired]);
      if (response.status === 200) return value;
      const data = responseObject(value, ['error']);
      const error = responseObject(data.error, ['code']);
      if (typeof error.code !== 'string' || !failureCodes.has(error.code))
        throw new RegistryClientError('invalid_response', response.status);
      throw new RegistryClientError(error.code === 'invalid_input' ? 'invalid_input_remote'
        : error.code as RegistryClientErrorCode, response.status);
    } catch (error) {
      if (error instanceof RegistryClientError) throw error;
      throw new RegistryClientError('unavailable');
    } finally { if (timeout) clearTimeout(timeout); controller.abort(); }
  }
  return Object.freeze({
    preflight: async (value: RegistryPreflightRequest) => {
      const request = captureRegistryPreflight(value);
      return validatePreflightResult(await post('/v1/publications/preflight', request), request);
    },
    declare: async (value: RegistryDeclarationRequest) => {
      const request = captureRegistryDeclaration(value, allowLoopbackDelivery);
      return validateDeclarationResult(await post('/v1/deployments/declare', request), request);
    }
  });
}
