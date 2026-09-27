import type {OperationClient, OperationClientResult} from '../operations/client.ts';
import {parseAccessPolicy} from '../../core/authorization/policy.ts';
import {parseAccessPolicyChanges} from '../../core/authorization/delta.ts';
import type {AccessAdminAuditChange, AccessAdminAuditDetailPage, AccessAdminAuditEntry,
  AccessAdminAuditPage, AccessAdminAuditCursor, AccessAdminDeltaInput, AccessAdminPage,
  AccessAdminPermission, AccessAdminPermissionPage, AccessAdminPolicy, AccessAdminPrincipal, AccessAdminReadResult,
  AccessAdminSession} from './admin-types.ts';

const prefix = 'creezio.access:';
const binding = Object.freeze({policy: `${prefix}policy.read`, permissions: `${prefix}permissions.list`,
  principals: `${prefix}principals.list`,
  sessions: `${prefix}sessions.list`, audit: `${prefix}audit.list`, detail: `${prefix}audit.detail`,
  delta: `${prefix}policy.apply-delta`, status: `${prefix}principals.set-human-status`,
  revokeAll: `${prefix}principals.revoke-sessions`, revoke: `${prefix}sessions.revoke`});
const ident = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const permissionId = (value: unknown): value is string => typeof value === 'string' && value.length <= 256
  && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> =>
  plain(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const list = (value: unknown, maximum: number): value is unknown[] => Array.isArray(value) && value.length <= maximum;
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum
  && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
const readFailure = (error: string): AccessAdminReadResult<never> => Object.freeze({ok: false, error});
const accepted = <T>(value: T): AccessAdminReadResult<T> => Object.freeze({ok: true, value: Object.freeze(value)});

function page<T>(value: unknown, item: (value: unknown) => value is T): value is AccessAdminPage<T> {
  return keys(value, ['items', 'nextAfterId']) && list(value.items, 51)
    && value.items.every(item) && (value.nextAfterId === null || ident(value.nextAfterId));
}
function principal(value: unknown): value is AccessAdminPrincipal {
  if (!keys(value, ['id', 'kind', 'displayName', 'status', 'authVersion', 'humanStatus',
    'loginIdentifier', 'createdAtMs'])) return false;
  return ident(value.id) && (value.kind === 'human' || value.kind === 'service')
    && text(value.displayName, 200) && value.displayName.length > 0
    && (value.status === 'active' || value.status === 'disabled') && positive(value.authVersion)
    && (value.humanStatus === null || ['active', 'pending', 'disabled'].includes(String(value.humanStatus)))
    && (value.loginIdentifier === null || text(value.loginIdentifier, 254)) && instant(value.createdAtMs);
}
function session(value: unknown): value is AccessAdminSession {
  return keys(value, ['id', 'audience', 'createdAtMs', 'expiresAtMs', 'revokedAtMs', 'active'])
    && ident(value.id) && (value.audience === 'admin' || value.audience === 'app')
    && instant(value.createdAtMs) && instant(value.expiresAtMs)
    && (value.revokedAtMs === null || instant(value.revokedAtMs)) && typeof value.active === 'boolean';
}
function policyRead(value: unknown): value is {epoch: number; policy: AccessAdminPolicy} {
  return keys(value, ['epoch', 'policy']) && positive(value.epoch) && parseAccessPolicy(value.policy) !== null;
}
function permission(value: unknown): value is AccessAdminPermission {
  return keys(value, ['id', 'moduleId', 'title', 'audiences', 'actors'])
    && permissionId(value.id) && ident(value.moduleId) && value.id.startsWith(`${value.moduleId}:`)
    && text(value.title, 200) && value.title.length > 0
    && list(value.audiences, 2) && value.audiences.every(audience => audience === 'admin' || audience === 'app')
    && list(value.actors, 4) && value.actors.every(actor => ['user', 'machine', 'delegated-user', 'impersonated-user'].includes(String(actor)));
}
function auditEntry(value: unknown): value is AccessAdminAuditEntry {
  return keys(value, ['id', 'action', 'principalId', 'actorDisplayName', 'createdAtMs', 'summary', 'detailAvailable'],
    ['targetPrincipalId']) && ident(value.id) && text(value.action, 64) && ident(value.principalId)
    && text(value.actorDisplayName, 200) && value.actorDisplayName.length > 0
    && (!Object.hasOwn(value, 'targetPrincipalId') || value.targetPrincipalId === null || ident(value.targetPrincipalId))
    && instant(value.createdAtMs) && text(value.summary, 300) && typeof value.detailAvailable === 'boolean';
}
function cursor(value: unknown): value is AccessAdminAuditCursor | null {
  return value === null || keys(value, ['createdAtMs', 'id']) && instant(value.createdAtMs) && ident(value.id);
}
function auditPage(value: unknown): value is AccessAdminAuditPage {
  return keys(value, ['items', 'nextCursor']) && list(value.items, 51)
    && value.items.every(auditEntry) && cursor(value.nextCursor);
}
const kinds = new Set(['context-status', 'membership', 'role-existence', 'role-parent', 'role-grant',
  'role-override', 'role-assignment', 'principal-override']);
const changeValues = new Set(['absent', 'present', 'active', 'disabled', 'inherit', 'allow', 'deny']);
function auditChange(value: unknown): value is AccessAdminAuditChange {
  if (!keys(value, ['index', 'kind', 'before', 'after'], ['principalId', 'contextId', 'audience', 'roleId',
    'parentRoleId', 'permissionId']) || !instant(value.index) || !kinds.has(String(value.kind))
    || !changeValues.has(String(value.before)) || !changeValues.has(String(value.after))) return false;
  for (const key of ['principalId', 'contextId', 'roleId', 'parentRoleId', 'permissionId'])
    if (Object.hasOwn(value, key) && !ident(value[key])) return false;
  return !Object.hasOwn(value, 'audience') || value.audience === 'admin' || value.audience === 'app';
}
function auditDetail(value: unknown): value is AccessAdminAuditDetailPage {
  return keys(value, ['auditId', 'fromEpoch', 'toEpoch', 'changes', 'nextAfterIndex'])
    && ident(value.auditId) && positive(value.fromEpoch) && value.toEpoch === value.fromEpoch + 1
    && list(value.changes, 32) && value.changes.every(auditChange)
    && (value.nextAfterIndex === null || instant(value.nextAfterIndex));
}
function valueOf<T>(result: OperationClientResult, valid: (value: unknown) => value is T): AccessAdminReadResult<T> {
  if (result.kind === 'rejected') return readFailure(result.code);
  if (result.kind !== 'execution' || result.execution.state !== 'succeeded')
    return readFailure(result.kind === 'unknown' ? result.code : result.execution.errorCode ?? 'unavailable');
  return valid(result.execution.output) ? accepted(result.execution.output) : readFailure('invalid_response');
}
function validDelta(value: readonly AccessAdminDeltaInput[]): boolean {
  return parseAccessPolicyChanges(value) !== null;
}

/** Thin typed facade over the canonical T06 operation client. No direct route fetches. */
export function createAccessAdminClient(operations: OperationClient) {
  if (!operations || operations.audience !== 'admin') throw new TypeError('Admin operation client required.');
  const invoke = (bindingId: string, input: Record<string, unknown>) => operations.invoke({bindingId,
    contextId: 'application', input});
  return Object.freeze({
    readPolicy: async () => valueOf(await invoke(binding.policy, {}), policyRead),
    listPermissions: async (input: {limit: number; afterId: string | null}) => {
      if (!positive(input?.limit) || input.limit > 50 || input.afterId !== null && !permissionId(input.afterId))
        return readFailure('invalid_input');
      return valueOf(await invoke(binding.permissions, {limit: input.limit,
        ...(input.afterId === null ? {} : {afterId: input.afterId})}),
        (value): value is AccessAdminPermissionPage => keys(value, ['items', 'nextAfterId', 'catalogDigest'])
          && list(value.items, 50) && value.items.length <= input.limit && value.items.every(permission)
          && (value.nextAfterId === null || permissionId(value.nextAfterId))
          && typeof value.catalogDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(value.catalogDigest));
    },
    listPrincipals: async (input: {kind: 'human' | 'service' | 'all'; limit: number; afterId: string | null}) => {
      if (!['human', 'service', 'all'].includes(input?.kind) || !positive(input?.limit) || input.limit > 50
        || input.afterId !== null && !ident(input.afterId)) return readFailure('invalid_input');
      return valueOf(await invoke(binding.principals, {kind: input.kind, limit: input.limit,
        ...(input.afterId === null ? {} : {afterId: input.afterId})}), (value): value is AccessAdminPage<AccessAdminPrincipal> =>
        page(value, principal) && value.items.length <= input.limit);
    },
    listSessions: async (input: {principalId: string; limit: number; afterId: string | null}) => {
      if (!ident(input?.principalId) || !positive(input?.limit) || input.limit > 50
        || input.afterId !== null && !ident(input.afterId)) return readFailure('invalid_input');
      return valueOf(await invoke(binding.sessions, {principalId: input.principalId, limit: input.limit,
        ...(input.afterId === null ? {} : {afterId: input.afterId})}), (value): value is AccessAdminPage<AccessAdminSession> =>
        page(value, session) && value.items.length <= input.limit);
    },
    listAudit: async (input: {limit: number; before: AccessAdminAuditCursor | null}) => {
      if (!positive(input?.limit) || input.limit > 50 || !cursor(input.before)) return readFailure('invalid_input');
      return valueOf(await invoke(binding.audit, {limit: input.limit,
        ...(input.before ? {beforeCreatedAtMs: input.before.createdAtMs, beforeId: input.before.id} : {})}),
        (value): value is AccessAdminAuditPage => auditPage(value) && value.items.length <= input.limit);
    },
    readAuditDetail: async (input: {auditId: string; limit: number; afterIndex: number | null}) => {
      if (!ident(input?.auditId) || !positive(input?.limit) || input.limit > 32
        || input.afterIndex !== null && !instant(input.afterIndex)) return readFailure('invalid_input');
      return valueOf(await invoke(binding.detail, {auditId: input.auditId, limit: input.limit,
        ...(input.afterIndex === null ? {} : {afterIndex: input.afterIndex})}),
        (value): value is AccessAdminAuditDetailPage => auditDetail(value) && value.changes.length <= input.limit);
    },
    applyDelta: (input: {expectedEpoch: number; changes: readonly AccessAdminDeltaInput[]}, requestKey: string) =>
      !positive(input?.expectedEpoch) || !validDelta(input.changes) ? Promise.resolve({kind: 'rejected', code: 'invalid_input', status: 0} as const)
        : invoke(binding.delta, {...input, requestKey}),
    setHumanStatus: (input: {principalId: string; expectedAuthVersion: number; status: 'active' | 'disabled'}, requestKey: string) =>
      !ident(input?.principalId) || !positive(input.expectedAuthVersion)
        || !['active', 'disabled'].includes(input.status)
        ? Promise.resolve({kind: 'rejected', code: 'invalid_input', status: 0} as const)
        : invoke(binding.status, {...input, requestKey}),
    revokeAllSessions: (input: {principalId: string; expectedAuthVersion: number}, requestKey: string) =>
      !ident(input?.principalId) || !positive(input.expectedAuthVersion)
        ? Promise.resolve({kind: 'rejected', code: 'invalid_input', status: 0} as const)
        : invoke(binding.revokeAll, {...input, requestKey}),
    revokeSession: (input: {sessionId: string}, requestKey: string) => !ident(input?.sessionId)
      ? Promise.resolve({kind: 'rejected', code: 'invalid_input', status: 0} as const)
      : invoke(binding.revoke, {...input, requestKey}),
    status: (bindingId: string, requestKey: string) => operations.status({bindingId, contextId: 'application', requestKey}),
  });
}
export type AccessAdminClient = ReturnType<typeof createAccessAdminClient>;
