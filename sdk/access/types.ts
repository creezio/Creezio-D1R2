/** Browser-facing identity only. A session is not a role or an authorization grant. */
export type AccessAudience = 'admin' | 'app';
export type AccessErrorCode = 'invalid_input' | 'invalid_credentials' | 'rate_limited'
  | 'request_rejected' | 'unavailable' | 'invalid_response';
export interface AccessCredentials { readonly loginIdentifier: string; readonly password: string }
export interface AccessSession {
  readonly id: string;
  readonly principalId: string;
  readonly displayName: string;
  readonly audience: AccessAudience;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}
export type AccessSessionResult = Readonly<{kind: 'authenticated'; session: AccessSession}>
  | Readonly<{kind: 'anonymous'}> | Readonly<{kind: 'unavailable'; error: AccessErrorCode}>;
export type AccessMutationResult = Readonly<{ok: true}> | Readonly<{ok: false; error: AccessErrorCode}>;
export interface AccessTransport {
  readonly origin: string;
  readonly audience: AccessAudience;
  readSession(options?: {signal?: AbortSignal}): Promise<AccessSessionResult>;
  login(credentials: AccessCredentials): Promise<AccessMutationResult>;
  logout(): Promise<AccessMutationResult>;
}
export interface AccessScope { readonly origin: string; readonly audience: AccessAudience }
export interface AccessCoordinator {
  readonly mode: 'origin' | 'document';
  runExclusive<T>(scope: AccessScope, task: () => Promise<T>): Promise<T>;
  subscribe(scope: AccessScope, listener: () => void): () => void;
  invalidate(scope: AccessScope): void;
}
export interface AccessSnapshot {
  readonly phase: 'loading' | 'anonymous' | 'authenticated' | 'unavailable';
  readonly session: AccessSession | null;
  readonly pending: null | 'login' | 'logout';
  readonly error: AccessErrorCode | null;
  readonly coordination: 'origin' | 'document';
}
export interface AccessController {
  readonly audience: AccessAudience;
  readonly origin: string;
  getSnapshot(): AccessSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  login(credentials: AccessCredentials): Promise<void>;
  logout(): Promise<void>;
  dispose(): void;
}

export const ACCESS_ERROR_CODES: readonly AccessErrorCode[] = Object.freeze([
  'invalid_input', 'invalid_credentials', 'rate_limited', 'request_rejected', 'unavailable', 'invalid_response',
]);
export const isAccessAudience = (value: unknown): value is AccessAudience => value === 'admin' || value === 'app';
export const isAccessErrorCode = (value: unknown): value is AccessErrorCode =>
  typeof value === 'string' && (ACCESS_ERROR_CODES as readonly string[]).includes(value);

/** Read only own data properties. Mock/custom transports never get to execute getters. */
export function accessFields(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return null;
    const copy: Record<string, unknown> = Object.create(null);
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor || !('value' in descriptor)) return null;
      copy[field] = descriptor.value;
    }
    return copy;
  } catch { return null; }
}
const wellFormed = (value: string) => value.isWellFormed();
export function copyAccessCredentials(value: unknown): AccessCredentials | null {
  const input = accessFields(value, ['loginIdentifier', 'password']);
  if (!input || typeof input.loginIdentifier !== 'string' || typeof input.password !== 'string'
    || input.loginIdentifier.length < 1 || input.loginIdentifier.length > 512
    || input.password.length === 0 || input.password.length > 1024
    || !wellFormed(input.loginIdentifier) || !wellFormed(input.password)
    || new TextEncoder().encode(input.password).byteLength > 1024) return null;
  return Object.freeze({loginIdentifier: input.loginIdentifier, password: input.password});
}
export function copyAccessSession(value: unknown, audience: AccessAudience): AccessSession | null {
  const session = accessFields(value, ['id', 'principalId', 'displayName', 'audience', 'createdAtMs', 'expiresAtMs']);
  if (!session || session.audience !== audience) return null;
  for (const field of ['id', 'principalId'] as const) {
    const id = session[field];
    if (typeof id !== 'string' || /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.exec(id)?.[0] !== id) return null;
  }
  if (typeof session.displayName !== 'string' || !session.displayName.length || session.displayName.length > 200
    || !wellFormed(session.displayName) || !Number.isSafeInteger(session.createdAtMs)
    || !Number.isSafeInteger(session.expiresAtMs) || (session.createdAtMs as number) < 0
    || (session.expiresAtMs as number) <= (session.createdAtMs as number)) return null;
  return Object.freeze({id: session.id as string, principalId: session.principalId as string,
    displayName: session.displayName, audience, createdAtMs: session.createdAtMs as number, expiresAtMs: session.expiresAtMs as number});
}

export function canonicalAccessOrigin(value: unknown): string | null {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return value;
  } catch { return null; }
}
