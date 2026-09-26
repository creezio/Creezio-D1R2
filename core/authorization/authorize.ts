import type {
  AuthorizationActor, AuthorizationDecision, AuthorizationReason,
  AuthorizationSnapshot, AuthorizationTarget, RoleDefinition,
} from './types.ts';

export const AUTHORIZATION_LIMITS = Object.freeze({
  permissions: 1000, roles: 256, assignments: 1000, overrides: 1000,
  roleDepth: 16, contexts: 256, inputDepth: 12, inputNodes: 50_000,
});

const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const QUALIFIED_PERMISSION = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const audience = (value: unknown) => value === 'admin' || value === 'app';
const actor = (value: unknown) => value === 'user' || value === 'machine' || value === 'delegated-user';
const text = (value: unknown, expression: RegExp, maximum = 128) => typeof value === 'string' && value.length <= maximum && value.match(expression)?.[0] === value;
const id = (value: unknown) => text(value, ID);
const opaqueId = (value: unknown) => text(value, OPAQUE_ID);
const permissionId = (value: unknown) => text(value, QUALIFIED_PERMISSION, 256);
const instant = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const record = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const shape = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const list = (value: unknown, maximum: number, valid: (item: unknown) => boolean, nonempty = false): value is unknown[] =>
  Array.isArray(value) && value.length <= maximum && (!nonempty || value.length > 0) && value.every(valid);
const uniqueList = (value: unknown, maximum: number, valid: (item: unknown) => boolean, nonempty = false) =>
  list(value, maximum, valid, nonempty) && new Set(value).size === value.length;
const audiences = (value: unknown, nonempty = false) => uniqueList(value, 2, audience, nonempty);
const actors = (value: unknown) => uniqueList(value, 3, actor, true);
const contexts = (value: unknown) => uniqueList(value, AUTHORIZATION_LIMITS.contexts, opaqueId);
const permissions = (value: unknown) => uniqueList(value, AUTHORIZATION_LIMITS.permissions, permissionId);

/** Bound plain-data inspection and reject accessors without reading their values. */
function plainData(value: unknown): boolean {
  let nodes = 0;
  const ancestors = new WeakSet<object>();
  function inspect(item: unknown, depth: number): boolean {
    if (++nodes > AUTHORIZATION_LIMITS.inputNodes || depth > AUTHORIZATION_LIMITS.inputDepth) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'string') return item.length <= 256;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item !== 'object' || ancestors.has(item)) return false;
    if (Array.isArray(item) ? Object.getPrototypeOf(item) !== Array.prototype : !record(item)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) return false;
    const entries = Object.entries(descriptors);
    if (Array.isArray(item)) {
      if (item.length > 1000 || entries.length !== item.length + 1) return false;
      if (entries.some(([key]) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key))) return false;
    } else if (entries.length > 20) return false;
    ancestors.add(item);
    for (const [key, descriptor] of entries) {
      if (Array.isArray(item) && key === 'length') continue;
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable || !inspect(descriptor.value, depth + 1)) return false;
    }
    ancestors.delete(item);
    return true;
  }
  try { return inspect(value, 0); } catch { return false; }
}

function snapshotShape(value: unknown): value is AuthorizationSnapshot {
  if (!plainData(value) || !shape(value, ['actor', 'credential', 'permissions', 'roles', 'assignments', 'overrides'])) return false;
  const principal = value.actor, credential = value.credential;
  return shape(principal, ['id', 'kind', 'enabled', 'contextIds', 'audiences'])
    && opaqueId(principal.id) && (principal.kind === 'human' || principal.kind === 'service') && typeof principal.enabled === 'boolean'
    && contexts(principal.contextIds) && audiences(principal.audiences)
    && shape(credential, ['id', 'subjectId', 'kind', 'enabled', 'expiresAtMs', 'contextIds', 'audiences', 'permissionIds'])
    && opaqueId(credential.id) && opaqueId(credential.subjectId) && (credential.kind === 'session' || credential.kind === 'api-token' || credential.kind === 'oauth')
    && typeof credential.enabled === 'boolean' && instant(credential.expiresAtMs)
    && contexts(credential.contextIds) && audiences(credential.audiences) && permissions(credential.permissionIds)
    && list(value.permissions, AUTHORIZATION_LIMITS.permissions, item => shape(item, ['id', 'audiences', 'actors'])
      && permissionId(item.id) && audiences(item.audiences, true) && actors(item.actors))
    && list(value.roles, AUTHORIZATION_LIMITS.roles, item => shape(item, ['id', 'inherits', 'permissionIds', 'permissionOverrides'])
      && id(item.id) && uniqueList(item.inherits, AUTHORIZATION_LIMITS.roles, id) && permissions(item.permissionIds)
      && list(item.permissionOverrides, AUTHORIZATION_LIMITS.overrides, override => shape(override, ['permissionId', 'effect'])
        && permissionId(override.permissionId) && (override.effect === 'allow' || override.effect === 'deny')))
    && list(value.assignments, AUTHORIZATION_LIMITS.assignments, item => shape(item, ['roleId', 'contextId', 'audiences'])
      && id(item.roleId) && opaqueId(item.contextId) && audiences(item.audiences, true))
    && list(value.overrides, AUTHORIZATION_LIMITS.overrides, item => shape(item, ['permissionId', 'contextId', 'audiences', 'effect'])
      && permissionId(item.permissionId) && opaqueId(item.contextId) && audiences(item.audiences, true) && (item.effect === 'allow' || item.effect === 'deny'));
}

function targetShape(value: unknown): value is AuthorizationTarget {
  return plainData(value) && shape(value, ['contextId', 'audience', 'actors', 'requiredPermissionIds', 'purpose'])
    && opaqueId(value.contextId) && audience(value.audience) && actors(value.actors) && permissions(value.requiredPermissionIds)
    && (value.purpose === 'operation' || value.purpose === 'human-approval');
}

type ResolvedRoles = { grants: Map<string, Set<string>>; denials: Map<string, Set<string>> } | { error: AuthorizationReason };
function resolveRoles(snapshot: AuthorizationSnapshot): ResolvedRoles {
  const knownPermissions = new Set(snapshot.permissions.map(permission => permission.id));
  if (knownPermissions.size !== snapshot.permissions.length) return { error: 'invalid_snapshot' };
  const roles = new Map(snapshot.roles.map(role => [role.id, role]));
  if (roles.size !== snapshot.roles.length) return { error: 'invalid_snapshot' };
  for (const role of roles.values()) {
    if (role.inherits.some(parent => !roles.has(parent))) return { error: 'role_missing' };
    if (role.permissionIds.some(permission => !knownPermissions.has(permission))) return { error: 'permission_unknown' };
    if (new Set(role.permissionOverrides.map(override => override.permissionId)).size !== role.permissionOverrides.length) return { error: 'invalid_snapshot' };
    if (role.permissionOverrides.some(override => !knownPermissions.has(override.permissionId))) return { error: 'permission_unknown' };
  }
  if (snapshot.assignments.some(assignment => !roles.has(assignment.roleId))) return { error: 'role_missing' };
  if (snapshot.overrides.some(override => !knownPermissions.has(override.permissionId))
    || snapshot.credential.permissionIds.some(permission => !knownPermissions.has(permission))) return { error: 'permission_unknown' };

  const visiting = new Set<string>(), grants = new Map<string, Set<string>>(), denials = new Map<string, Set<string>>(), depths = new Map<string, number>();
  let failure: AuthorizationReason | undefined;
  function visit(role: RoleDefinition, stackDepth: number): number {
    if (visiting.has(role.id)) { failure = 'role_cycle'; return 0; }
    if (stackDepth > AUTHORIZATION_LIMITS.roleDepth) { failure = 'role_depth'; return 0; }
    const knownDepth = depths.get(role.id);
    if (knownDepth !== undefined) return knownDepth;
    visiting.add(role.id);
    const effective = new Set(role.permissionIds), denied = new Set<string>();
    let depth = 1;
    for (const parentId of role.inherits) {
      depth = Math.max(depth, visit(roles.get(parentId)!, stackDepth + 1) + 1);
      if (failure) return 0;
      for (const permission of grants.get(parentId)!) effective.add(permission);
      for (const permission of denials.get(parentId)!) denied.add(permission);
    }
    // Inherited denials beat inherited/default grants. Only this role's explicit
    // override can lift them; parent order never changes the result.
    for (const permission of denied) effective.delete(permission);
    for (const override of role.permissionOverrides) {
      if (override.effect === 'allow') { denied.delete(override.permissionId); effective.add(override.permissionId); }
      else { denied.add(override.permissionId); effective.delete(override.permissionId); }
    }
    visiting.delete(role.id);
    if (depth > AUTHORIZATION_LIMITS.roleDepth) { failure = 'role_depth'; return 0; }
    depths.set(role.id, depth); grants.set(role.id, effective); denials.set(role.id, denied);
    return depth;
  }
  for (const role of roles.values()) { visit(role, 1); if (failure) return { error: failure }; }
  return { grants, denials };
}

const decision = (reason: AuthorizationReason): AuthorizationDecision => Object.freeze({ allowed: reason === 'allowed', reason });

/**
 * Evaluates fresh, already authenticated server state. Neither argument may come
 * from caller-controlled headers/body. No cache, I/O, implicit owner or approval
 * receipt is created. The caller must reload state and enforce it atomically at
 * the eventual write; reusing this snapshot cannot prove revocation freshness.
 */
export function authorize(snapshot: unknown, target: unknown, nowMs: number): AuthorizationDecision {
  if (!instant(nowMs)) return decision('invalid_time');
  if (!snapshotShape(snapshot)) return decision('invalid_snapshot');
  if (!targetShape(target)) return decision('invalid_target');
  const resolved = resolveRoles(snapshot);
  if ('error' in resolved) return decision(resolved.error);
  const { actor: principal, credential } = snapshot;
  if (!principal.enabled) return decision('actor_disabled');
  if (!credential.enabled) return decision('credential_disabled');
  if (credential.subjectId !== principal.id) return decision('credential_subject');
  if (credential.expiresAtMs <= nowMs) return decision('credential_expired');
  if (principal.kind === 'service' && credential.kind !== 'api-token') return decision('credential_kind');
  const effectiveActor: AuthorizationActor = credential.kind === 'session' ? 'user' : credential.kind === 'oauth' ? 'delegated-user' : 'machine';
  if (!principal.contextIds.includes(target.contextId)) return decision('context_denied');
  if (!principal.audiences.includes(target.audience)) return decision('audience_denied');
  if (!credential.contextIds.includes(target.contextId) || !credential.audiences.includes(target.audience)) return decision('scope_denied');
  if (!target.actors.includes(effectiveActor)) return decision('actor_denied');
  if (target.purpose === 'human-approval' && (principal.kind !== 'human' || credential.kind === 'api-token')) return decision('human_approval_required');

  const catalog = new Map(snapshot.permissions.map(permission => [permission.id, permission]));
  const granted = new Set<string>(), denied = new Set<string>();
  for (const assignment of snapshot.assignments) {
    if (assignment.contextId === target.contextId && assignment.audiences.includes(target.audience)) {
      for (const permission of resolved.grants.get(assignment.roleId)!) granted.add(permission);
      for (const permission of resolved.denials.get(assignment.roleId)!) denied.add(permission);
    }
  }
  // Across assigned roles, denial wins. Account allow may lift a role denial,
  // but account deny always wins, independently of override order.
  const accountDenials = new Set<string>();
  for (const override of snapshot.overrides) {
    if (override.contextId !== target.contextId || !override.audiences.includes(target.audience)) continue;
    if (override.effect === 'allow') { denied.delete(override.permissionId); granted.add(override.permissionId); }
    else accountDenials.add(override.permissionId);
  }
  for (const permission of accountDenials) denied.add(permission);
  for (const required of target.requiredPermissionIds) {
    const definition = catalog.get(required);
    if (!definition) return decision('permission_unknown');
    if (!definition.audiences.includes(target.audience)) return decision('audience_denied');
    if (!definition.actors.includes(effectiveActor)) return decision('actor_denied');
    if (denied.has(required) || !granted.has(required)) return decision('permission_denied');
    if (!credential.permissionIds.includes(required)) return decision('scope_denied');
  }
  return decision('allowed');
}
