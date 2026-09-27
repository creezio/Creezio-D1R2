import {canonicalAccessOrigin, type AccessAudience, type AccessController,
  type AccessSession} from '../access/types.ts';
import {readJson} from '../operations/protocol.ts';

export interface WidgetApprovalPreview {
  readonly approvalId: string;
  readonly state: 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired';
  readonly expiresAtMs: number;
  readonly operation: Readonly<{moduleId: string; operationId: string; title: string}>;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly inputDigest: string;
  /** One-use transaction/session nonce. Only the trusted native UI receives it. */
  readonly csrfNonce: string | null;
  readonly sessionId: string;
  readonly principalId: string;
  readonly contextId: string;
}
export type WidgetApprovalResult<T> = Readonly<{kind: 'ok'; value: T}> |
  Readonly<{kind: 'rejected'; code: string}> | Readonly<{kind: 'unknown'; code: string}>;

const identifier = (value: unknown): value is string => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const idOrOperation = identifier;
const record = (value: unknown): value is Record<string, unknown> => !!value &&
  typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const sameSession = (a: AccessSession | null, b: AccessSession | null) => !!a && !!b &&
  a.id === b.id && a.principalId === b.principalId && a.audience === b.audience;
const currentSession = (access: AccessController) => {
  const snapshot = access.getSnapshot();
  return snapshot.phase === 'authenticated' && !snapshot.pending ? snapshot.session : null;
};

function preview(value: unknown, requestedId: string, session: AccessSession, contextId: string): WidgetApprovalPreview | null {
  if (!record(value) || value.approvalId !== requestedId ||
    !['pending', 'approved', 'rejected', 'consumed', 'expired'].includes(String(value.state)) ||
    !Number.isSafeInteger(value.expiresAtMs) || !record(value.operation) ||
    !identifier(value.operation.moduleId) || !identifier(value.operation.operationId) ||
    typeof value.operation.title !== 'string' || value.operation.title.length > 240 ||
    !record(value.fields) || Object.keys(value.fields).length > 100 ||
    typeof value.inputDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.inputDigest) ||
    value.sessionId !== session.id || value.principalId !== session.principalId ||
    value.contextId !== contextId ||
    (value.state === 'pending' && (typeof value.csrfNonce !== 'string' || !value.csrfNonce.length || value.csrfNonce.length > 512)) ||
    (value.state !== 'pending' && value.csrfNonce !== null))
    return null;
  try {if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16_384) return null;}
  catch {return null;}
  return value as unknown as WidgetApprovalPreview;
}

export function createWidgetApprovalClient(options: {origin: string; audience: AccessAudience;
  contextId: string; access: AccessController; fetcher?: typeof fetch}) {
  const origin = canonicalAccessOrigin(options.origin);
  if (!origin || options.access.origin !== origin || options.access.audience !== options.audience ||
    !identifier(options.contextId)) throw new TypeError('Invalid widget approval client.');
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const url = (approvalId: string) => `${origin}/api/widgets/${options.audience}/approvals/${encodeURIComponent(approvalId)}`;
  return Object.freeze({
    async request(input: {moduleId: string; operationId: string; input: Readonly<Record<string, unknown>>}):
      Promise<WidgetApprovalResult<Readonly<{approvalId: string; state: 'pending'; expiresAtMs: number}>>> {
      if (!idOrOperation(input.moduleId) || !idOrOperation(input.operationId) || !record(input.input))
        return {kind: 'rejected', code: 'invalid_input'};
      const before = currentSession(options.access);
      if (!before) return {kind: 'rejected', code: 'unauthorized'};
      try {
        const response = await fetcher(`${origin}/api/widgets/${options.audience}/approvals`, {method: 'POST',
          headers: {'accept': 'application/json', 'content-type': 'application/json',
            'x-creezio-context': options.contextId, 'x-creezio-request': '1'},
          body: JSON.stringify(input), credentials: 'same-origin', mode: 'same-origin',
          redirect: 'error', cache: 'no-store'});
        if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
          return {kind: 'unknown', code: 'invalid_response'};
        const body = await readJson(response);
        if (!sameSession(before, currentSession(options.access))) return {kind: 'unknown', code: 'stale'};
        if (response.status === 200 && record(body) && identifier(body.approvalId) &&
          body.state === 'pending' && Number.isSafeInteger(body.expiresAtMs))
          return {kind: 'ok', value: body as {approvalId: string; state: 'pending'; expiresAtMs: number}};
        const code = record(body) && record(body.error) && typeof body.error.code === 'string'
          ? body.error.code : 'unavailable';
        return response.status >= 400 && response.status < 500 ? {kind: 'rejected', code} : {kind: 'unknown', code};
      } catch {return {kind: 'unknown', code: 'outcome_unknown'};}
    },
    async read(approvalId: string): Promise<WidgetApprovalResult<WidgetApprovalPreview>> {
      if (!identifier(approvalId)) return {kind: 'rejected', code: 'invalid_input'};
      const before = currentSession(options.access);
      if (!before) return {kind: 'rejected', code: 'unauthorized'};
      try {
        const response = await fetcher(url(approvalId), {method: 'GET',
          headers: {'accept': 'application/json', 'x-creezio-context': options.contextId},
          credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store'});
        if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
          return {kind: 'unknown', code: 'invalid_response'};
        const body = await readJson(response);
        if (!sameSession(before, currentSession(options.access))) return {kind: 'unknown', code: 'stale'};
        if (response.status === 200) {
          const value = preview(body, approvalId, before, options.contextId);
          return value ? {kind: 'ok', value} : {kind: 'unknown', code: 'invalid_response'};
        }
        const code = record(body) && record(body.error) && typeof body.error.code === 'string'
          ? body.error.code : 'unavailable';
        return response.status >= 400 && response.status < 500 ? {kind: 'rejected', code} : {kind: 'unknown', code};
      } catch {return {kind: 'unknown', code: 'unavailable'};}
    },
    async decide(approval: WidgetApprovalPreview, decision: 'approve' | 'reject'):
      Promise<WidgetApprovalResult<Readonly<{approvalId: string; state: 'approved' | 'rejected'; expiresAtMs: number}>>> {
      const before = currentSession(options.access);
      if (!before || !approval || !preview(approval, approval.approvalId, before, options.contextId) ||
        approval.state !== 'pending' || !approval.csrfNonce ||
        !['approve', 'reject'].includes(decision)) return {kind: 'rejected', code: 'invalid_input'};
      try {
        const response = await fetcher(`${url(approval.approvalId)}/decide`, {method: 'POST',
          headers: {'accept': 'application/json', 'content-type': 'application/json',
            'x-creezio-context': options.contextId, 'x-creezio-request': '1'},
          body: JSON.stringify({decision, csrfNonce: approval.csrfNonce}), credentials: 'same-origin',
          mode: 'same-origin', redirect: 'error', cache: 'no-store'});
        if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
          return {kind: 'unknown', code: 'invalid_response'};
        const body = await readJson(response);
        if (!sameSession(before, currentSession(options.access))) return {kind: 'unknown', code: 'stale'};
        if (response.status === 200 && record(body) && body.approvalId === approval.approvalId &&
          ['approved', 'rejected'].includes(String(body.state)) && Number.isSafeInteger(body.expiresAtMs))
          return {kind: 'ok', value: body as {approvalId: string; state: 'approved' | 'rejected'; expiresAtMs: number}};
        const code = record(body) && record(body.error) && typeof body.error.code === 'string'
          ? body.error.code : 'unavailable';
        return response.status >= 400 && response.status < 500 ? {kind: 'rejected', code} : {kind: 'unknown', code};
      } catch {return {kind: 'unknown', code: 'outcome_unknown'};}
    },
  });
}
export type WidgetApprovalClient = ReturnType<typeof createWidgetApprovalClient>;
