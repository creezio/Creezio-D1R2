import { authorize } from './authorize.ts';
import type { AuthorizationAudience, AuthorizationSnapshot, PermissionDefinition, RoleDefinition } from './types.ts';

export const ACCESS_POLICY_LIMITS = Object.freeze({ contexts: 64, roles: 128, memberships: 512,
  assignments: 1000, overrides: 1000, roleEdges: 1024, principals: 1024, bytes: 98_304 });
export const ADMIN_CONTEXT = 'application';
export const MANAGE_ACCESS = 'creezio.access:manage';
export const ACCESS_PERMISSION: PermissionDefinition = Object.freeze({ id: MANAGE_ACCESS,
  audiences: Object.freeze(['admin'] as const), actors: Object.freeze(['user'] as const) });
type Status = 'active' | 'disabled';
export interface AccessPolicy {
  readonly contexts: readonly { readonly id: string; readonly status: Status }[];
  readonly roles: readonly RoleDefinition[];
  readonly memberships: readonly { readonly principalId: string; readonly contextId: string;
    readonly audience: AuthorizationAudience; readonly status: Status }[];
  readonly assignments: readonly { readonly principalId: string; readonly contextId: string;
    readonly audience: AuthorizationAudience; readonly roleId: string }[];
  readonly overrides: readonly { readonly principalId: string; readonly contextId: string;
    readonly audience: AuthorizationAudience; readonly permissionId: string; readonly effect: 'allow' | 'deny' }[];
}

const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const roleId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const permissionId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const matches = (value: unknown, pattern: RegExp, max = 128): value is string =>
  typeof value === 'string' && value.length <= max && value.match(pattern)?.[0] === value;
const status = (value: unknown) => value === 'active' || value === 'disabled';
const audience = (value: unknown) => value === 'admin' || value === 'app';
const effect = (value: unknown) => value === 'allow' || value === 'deny';
const list = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;
export function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => {
    const d = descriptors[key]; return d && d.enumerable && Object.hasOwn(d, 'value');
  });
  } catch { return false; }
}

/** Reject executable/prototyped/cyclic/oversized input before reading or stringifying it. */
function plain(value: unknown): boolean {
  let nodes = 0;
  const ancestors = new WeakSet<object>();
  function inspect(v: unknown, depth: number): boolean {
    if (++nodes > 60_000 || depth > 10) return false;
    if (typeof v === 'string') return v.length <= 256;
    if (typeof v !== 'object' || v === null || ancestors.has(v)) return false;
    const isArray = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (isArray ? proto !== Array.prototype : proto !== null && proto !== Object.prototype) return false;
    if (isArray && v.length > 1024) return false;
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
    if (isArray ? keys.length !== v.length + 1 : keys.length > 8) return false;
    ancestors.add(v);
    for (const key of keys) {
      if (typeof key !== 'string') return false;
      if (isArray && key === 'length') continue;
      if (isArray && !/^(?:0|[1-9][0-9]*)$/.test(key)) return false;
      const d = descriptors[key];
      if (!d.enumerable || !Object.hasOwn(d, 'value') || !inspect(d.value, depth + 1)) return false;
    }
    ancestors.delete(v); return true;
  }
  try { return inspect(value, 0); } catch { return false; }
}
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const key = (...values: readonly string[]) => JSON.stringify(values);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Storage-independent structural parsing. No principal or permission is granted by this function. */
export function parseAccessPolicy(value: unknown): AccessPolicy | null {
  if (!plain(value) || !exactRecord(value, ['contexts', 'roles', 'memberships', 'assignments', 'overrides'])) return null;
  const { contexts, roles, memberships, assignments, overrides } = value;
  if (!list(contexts, ACCESS_POLICY_LIMITS.contexts) || !list(roles, ACCESS_POLICY_LIMITS.roles)
    || !list(memberships, ACCESS_POLICY_LIMITS.memberships) || !list(assignments, ACCESS_POLICY_LIMITS.assignments)
    || !list(overrides, ACCESS_POLICY_LIMITS.overrides)) return null;
  if (!contexts.every(c => exactRecord(c, ['id', 'status']) && matches(c.id, opaque) && status(c.status))) return null;
  if (!roles.every(r => exactRecord(r, ['id', 'inherits', 'permissionIds', 'permissionOverrides']) && matches(r.id, roleId)
    && list(r.inherits, 128) && r.inherits.every(id => matches(id, roleId)) && unique(r.inherits)
    && list(r.permissionIds, 1000) && r.permissionIds.every(id => matches(id, permissionId, 256)) && unique(r.permissionIds)
    && list(r.permissionOverrides, 1000) && r.permissionOverrides.every(o => exactRecord(o, ['permissionId', 'effect'])
      && matches(o.permissionId, permissionId, 256) && effect(o.effect))
    && unique(r.permissionOverrides.map(o => (o as {permissionId: string}).permissionId)))) return null;
  if (!memberships.every(m => exactRecord(m, ['principalId', 'contextId', 'audience', 'status'])
    && matches(m.principalId, opaque) && matches(m.contextId, opaque) && audience(m.audience) && status(m.status))) return null;
  if (!assignments.every(a => exactRecord(a, ['principalId', 'contextId', 'audience', 'roleId'])
    && matches(a.principalId, opaque) && matches(a.contextId, opaque) && audience(a.audience) && matches(a.roleId, roleId))) return null;
  if (!overrides.every(o => exactRecord(o, ['principalId', 'contextId', 'audience', 'permissionId', 'effect'])
    && matches(o.principalId, opaque) && matches(o.contextId, opaque) && audience(o.audience)
    && matches(o.permissionId, permissionId, 256) && effect(o.effect))) return null;
  const policy = value as unknown as AccessPolicy;
  const contextIds = new Set(policy.contexts.map(c => c.id)), roleIds = new Set(policy.roles.map(r => r.id));
  const memberKeys = policy.memberships.map(m => key(m.principalId, m.contextId, m.audience));
  const memberIds = new Set(memberKeys);
  if (contextIds.size !== contexts.length || roleIds.size !== roles.length || !unique(memberKeys)
    || !unique(policy.assignments.map(a => key(a.principalId, a.contextId, a.audience, a.roleId)))
    || !unique(policy.overrides.map(o => key(o.principalId, o.contextId, o.audience, o.permissionId)))
    || policy.roles.some(r => r.inherits.some(id => !roleIds.has(id)))
    || policy.memberships.some(m => !contextIds.has(m.contextId))
    || policy.assignments.some(a => !roleIds.has(a.roleId) || !memberIds.has(key(a.principalId, a.contextId, a.audience)))
    || policy.overrides.some(o => !memberIds.has(key(o.principalId, o.contextId, o.audience)))) return null;
  for (const property of ['inherits', 'permissionIds', 'permissionOverrides'] as const)
    if (policy.roles.reduce((n, r) => n + r[property].length, 0) > ACCESS_POLICY_LIMITS.roleEdges) return null;
  const serialized = JSON.stringify(policy);
  if (new TextEncoder().encode(serialized).length > ACCESS_POLICY_LIMITS.bytes) return null;
  return freeze(JSON.parse(serialized) as AccessPolicy);
}

/** Validate the entire graph against server-owned module permission definitions. */
export function validPolicyCatalog(policy: AccessPolicy, permissions: readonly PermissionDefinition[]): boolean {
  const snapshot: AuthorizationSnapshot = {
    actor: { id: 'policy-validator', kind: 'human', enabled: true, contextIds: [ADMIN_CONTEXT], audiences: ['admin'] },
    credential: { id: 'policy-validator', subjectId: 'policy-validator', kind: 'session', enabled: true,
      expiresAtMs: 1, contextIds: [ADMIN_CONTEXT], audiences: ['admin'], permissionIds: [] },
    permissions, roles: policy.roles, assignments: [], overrides: [],
  };
  const decision = authorize(snapshot, { contextId: ADMIN_CONTEXT, audience: 'admin', actors: ['user'],
    requiredPermissionIds: [], purpose: 'operation' }, 0);
  const known = new Set(permissions.map(p => p.id));
  return decision.allowed && policy.overrides.every(o => known.has(o.permissionId));
}

/** Session grants are bounded by the requested audience and its active membership pair. */
export function policySnapshot(policy: AccessPolicy, permissions: readonly PermissionDefinition[],
  session: {id: string; principalId: string; audience: AuthorizationAudience; expiresAtMs: number}): AuthorizationSnapshot {
  const activeContexts = new Set(policy.contexts.filter(c => c.status === 'active').map(c => c.id));
  const memberships = policy.memberships.filter(m => m.principalId === session.principalId
    && m.audience === session.audience && m.status === 'active' && activeContexts.has(m.contextId));
  const contextIds = memberships.map(m => m.contextId);
  return {
    actor: { id: session.principalId, kind: 'human', enabled: true, contextIds, audiences: [session.audience] },
    credential: { id: session.id, subjectId: session.principalId, kind: 'session', enabled: true,
      expiresAtMs: session.expiresAtMs, contextIds, audiences: [session.audience], permissionIds: permissions.map(p => p.id) },
    permissions, roles: policy.roles,
    assignments: policy.assignments.filter(a => a.principalId === session.principalId && a.audience === session.audience)
      .map(a => ({ roleId: a.roleId, contextId: a.contextId, audiences: [a.audience] })),
    overrides: policy.overrides.filter(o => o.principalId === session.principalId && o.audience === session.audience)
      .map(o => ({ permissionId: o.permissionId, contextId: o.contextId, audiences: [o.audience], effect: o.effect })),
  };
}
