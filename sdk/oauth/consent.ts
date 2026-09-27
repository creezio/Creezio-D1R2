import type { AccessAudience } from '../access/types.ts';

export interface ConsentPreview {
  readonly transactionId: string;
  readonly clientName: string;
  readonly redirectHost: string;
  readonly resource: string;
  readonly audience: AccessAudience;
  readonly contextId: string;
  readonly permissions: readonly Readonly<{id: string; title: string}>[];
  readonly scopes: readonly string[];
  readonly expiresAtMs: number;
  readonly csrfToken: string;
  readonly principal: Readonly<{id: string; displayName: string}>;
}

export type ConsentPreviewResult =
  | Readonly<{kind: 'ready'; preview: ConsentPreview}>
  | Readonly<{kind: 'sign_in'; audience: AccessAudience}>
  | Readonly<{kind: 'expired'}>
  | Readonly<{kind: 'unavailable'}>;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const transactionPattern = /^[A-Za-z0-9_-]{16,128}$/;
const isAudience = (value: unknown): value is AccessAudience => value === 'admin' || value === 'app';
const isText = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** UI data only. Validation and authorization remain exclusively on the server. */
export function parseConsentPreview(value: unknown, expectedTransactionId: string): ConsentPreview | null {
  if (!isRecord(value) || !exactKeys(value, ['transactionId', 'clientName', 'redirectHost', 'resource',
    'audience', 'contextId', 'permissions', 'scopes', 'expiresAtMs', 'csrfToken', 'principal'])) return null;
  if (value.transactionId !== expectedTransactionId || !isConsentTransactionId(value.transactionId)
    || !isText(value.clientName, 200) || !isText(value.redirectHost, 255)
    || !isText(value.resource, 2048) || !isAudience(value.audience)
    || !isText(value.contextId, 128) || !idPattern.test(value.contextId)
    || !isText(value.csrfToken, 512)
    || !Number.isSafeInteger(value.expiresAtMs) || (value.expiresAtMs as number) <= 0
    || !Array.isArray(value.permissions) || value.permissions.length > 128
    || !Array.isArray(value.scopes) || value.scopes.length > 128
    || !isRecord(value.principal) || !exactKeys(value.principal, ['id', 'displayName'])
    || !isText(value.principal.id, 128) || !idPattern.test(value.principal.id)
    || !isText(value.principal.displayName, 200)) return null;
  const permissions: {id: string; title: string}[] = [];
  for (const item of value.permissions) {
    if (!isRecord(item) || !exactKeys(item, ['id', 'title']) || !isText(item.id, 200)
      || !isText(item.title, 200)) return null;
    permissions.push(Object.freeze({id: item.id, title: item.title}));
  }
  const scopes: string[] = [];
  for (const item of value.scopes) {
    if (!isText(item, 200)) return null;
    scopes.push(item);
  }
  if (new Set(permissions.map(item => item.id)).size !== permissions.length
    || new Set(scopes).size !== scopes.length
    || permissions.some(item => !scopes.includes(item.id))) return null;
  return Object.freeze({
    transactionId: value.transactionId, clientName: value.clientName,
    redirectHost: value.redirectHost, resource: value.resource, audience: value.audience,
    contextId: value.contextId, permissions: Object.freeze(permissions), scopes: Object.freeze(scopes),
    expiresAtMs: value.expiresAtMs as number, csrfToken: value.csrfToken,
    principal: Object.freeze({id: value.principal.id, displayName: value.principal.displayName}),
  });
}

export function isConsentTransactionId(value: unknown): value is string {
  return typeof value === 'string' && transactionPattern.test(value);
}

export async function loadConsentPreview(transactionId: string,
  request: typeof fetch = fetch, signal?: AbortSignal): Promise<ConsentPreviewResult> {
  if (!isConsentTransactionId(transactionId)) return {kind: 'unavailable'};
  try {
    const response = await request(`/oauth/consent/${encodeURIComponent(transactionId)}/preview`, {
      method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: {Accept: 'application/json'}, signal,
    });
    if (response.status === 404 || response.status === 410) return {kind: 'expired'};
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return {kind: 'unavailable'};
    const declaredSize = response.headers.get('content-length');
    if (declaredSize && Number(declaredSize) > 65_536) return {kind: 'unavailable'};
    const source = await response.text();
    if (source.length > 65_536) return {kind: 'unavailable'};
    const body: unknown = JSON.parse(source);
    if (response.status === 401) {
      if (isRecord(body) && isRecord(body.error) && body.error.code === 'authentication_required'
        && isAudience(body.audience))
        return {kind: 'sign_in', audience: body.audience};
      return {kind: 'unavailable'};
    }
    if (response.status !== 200) return {kind: 'unavailable'};
    const preview = parseConsentPreview(body, transactionId);
    return preview ? {kind: 'ready', preview} : {kind: 'unavailable'};
  } catch { return {kind: 'unavailable'}; }
}
