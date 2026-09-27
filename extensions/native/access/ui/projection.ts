/** Read-only view projections. The server remains the authority for every write. */
import type { AccessAdminPolicyRead } from '../../../../sdk/access/admin-types.ts';
import type { AccessAdminSnapshot } from '../../../../sdk/access/admin-types.ts';

export type AccessEffect = 'allow' | 'deny' | 'inherit';
export type AccessAudience = 'admin' | 'app';
export type AccessPolicyView = AccessAdminPolicyRead;

export interface MatrixRole { readonly id: string; readonly label: string; readonly locked: boolean;
  readonly defaults: readonly string[]; readonly effective: readonly string[] }
export interface MatrixGroup { readonly id: string; readonly label: string;
  readonly permissions: readonly { readonly id: string; readonly label: string }[] }
export interface MatrixOverride { readonly role: string; readonly permission: string; readonly effect: 'allow' | 'deny' }
export interface MatrixView { readonly epoch: number; readonly roles: readonly MatrixRole[];
  readonly groups: readonly MatrixGroup[]; readonly overrides: readonly MatrixOverride[] }

export const rolePermissionKey = (roleId: string, permissionId: string): string =>
  JSON.stringify([roleId, permissionId]);
export function rolePermissionTuple(key: string): readonly [string, string] {
  const value: unknown = JSON.parse(key);
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string')
    throw new TypeError('Invalid role-permission key.');
  return [value[0], value[1]];
}

/** Mirrors inherited-denial precedence for display; it never grants a permission. */
export function roleDecisions(view: AccessPolicyView) {
  const roles = new Map(view.policy.roles.map(role => [role.id, role]));
  const cache = new Map<string, { baseline: Set<string>; grants: Set<string>; denials: Set<string> }>();
  const visiting = new Set<string>();
  function resolve(roleId: string) {
    const found = cache.get(roleId); if (found) return found;
    const role = roles.get(roleId);
    if (!role || visiting.has(roleId)) throw new TypeError('Invalid role graph.');
    visiting.add(roleId);
    const baseline = new Set(role.permissionIds), denials = new Set<string>();
    for (const parentId of role.inherits) {
      const parent = resolve(parentId);
      for (const id of parent.grants) baseline.add(id);
      for (const id of parent.denials) denials.add(id);
    }
    for (const id of denials) baseline.delete(id);
    const grants = new Set(baseline);
    for (const override of role.permissionOverrides) {
      if (override.effect === 'allow') { denials.delete(override.permissionId); grants.add(override.permissionId); }
      else { denials.add(override.permissionId); grants.delete(override.permissionId); }
    }
    visiting.delete(roleId);
    const value = { baseline, grants, denials }; cache.set(roleId, value); return value;
  }
  for (const roleId of roles.keys()) resolve(roleId);
  return cache;
}

export function matrixFromPolicy(view: AccessPolicyView): MatrixView {
  const decisions = roleDecisions(view);
  const groups = new Map<string, { id: string; label: string; permissions: { id: string; label: string }[] }>();
  for (const permission of view.permissions) {
    const moduleId = permission.moduleId;
    const group = groups.get(moduleId) ?? { id: moduleId, label: moduleId, permissions: [] };
    group.permissions.push({ id: permission.id, label: permission.title });
    groups.set(moduleId, group);
  }
  for (const group of groups.values()) group.permissions.sort((a, b) => a.id.localeCompare(b.id));
  return {
    epoch: view.epoch,
    roles: view.policy.roles.map(role => ({ id: role.id, label: role.id, locked: false,
      defaults: [...decisions.get(role.id)!.baseline], effective: [...decisions.get(role.id)!.grants] })),
    groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)),
    overrides: view.policy.roles.flatMap(role => role.permissionOverrides.map(override => ({
      role: role.id, permission: override.permissionId, effect: override.effect })))
  };
}

export function principalScope(view: AccessPolicyView, principalId: string, contextId: string, audience: AccessAudience,
  kind: 'human' | 'service' = 'human') {
  const actor = kind === 'human' ? 'user' : 'machine';
  const eligible = new Set(view.permissions.filter(permission => permission.audiences.includes(audience)
    && permission.actors.includes(actor)).map(permission => permission.id));
  const assignmentIds = view.policy.assignments.filter(row => row.principalId === principalId
    && row.contextId === contextId && row.audience === audience).map(row => row.roleId);
  const decisions = roleDecisions(view), grants = new Set<string>(), denials = new Set<string>();
  for (const roleId of assignmentIds) {
    const role = decisions.get(roleId); if (!role) continue;
    for (const id of role.grants) grants.add(id);
    for (const id of role.denials) denials.add(id);
  }
  const baseline = [...grants].filter(id => !denials.has(id) && eligible.has(id));
  const overrides = view.policy.overrides.filter(row => row.principalId === principalId
    && row.contextId === contextId && row.audience === audience);
  for (const override of overrides) {
    if (override.effect === 'allow') { denials.delete(override.permissionId); grants.add(override.permissionId); }
    else denials.add(override.permissionId);
  }
  return { assignmentIds, baseline, effective: [...grants].filter(id => !denials.has(id) && eligible.has(id)), overrides,
    membership: view.policy.memberships.find(row => row.principalId === principalId
      && row.contextId === contextId && row.audience === audience) ?? null };
}

export function changedEffects(initial: ReadonlyMap<string, AccessEffect>, draft: ReadonlyMap<string, AccessEffect>) {
  const changes: { key: string; effect: AccessEffect }[] = [];
  for (const key of new Set([...initial.keys(), ...draft.keys()])) {
    const before = initial.get(key) ?? 'inherit', after = draft.get(key) ?? 'inherit';
    if (before !== after) changes.push({ key, effect: after });
  }
  return changes;
}

/** A dirty draft always stays attached to its original epoch until the editor discards it. */
export function draftRefreshDecision(baseEpoch: number, currentEpoch: number,
  initial: ReadonlyMap<string, AccessEffect>, draft: ReadonlyMap<string, AccessEffect>) {
  if (baseEpoch === currentEpoch) return 'same' as const;
  return changedEffects(initial, draft).length ? 'preserve-stale' as const : 'adopt' as const;
}

/** Verification suspends the view; only a confirmed identity loss discards drafts. */
export function shouldPurgeAdminView(snapshot: Pick<AccessAdminSnapshot,
  'authorized' | 'suspended' | 'identityVersion'>, previousIdentityVersion: number): boolean {
  return snapshot.identityVersion !== previousIdentityVersion || !snapshot.authorized && !snapshot.suspended;
}
