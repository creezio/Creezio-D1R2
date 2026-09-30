import { copyJson } from '../data/input.ts';
import { exactRecord, parseAccessPolicy, type AccessPolicy } from './policy.ts';
import type { AuthorizationAudience } from './types.ts';

export const ACCESS_DELTA_LIMITS = Object.freeze({ changes: 32, inputBytes: 12_288, changeBytes: 1024 });

type Status = 'active' | 'disabled';
type Effect = 'inherit' | 'allow' | 'deny';
type Toggle = Readonly<{ present: boolean }>;
export type AccessPolicyChange =
  | Readonly<{ kind: 'context-admit'; contextId: string; status: Status }>
  | Readonly<{ kind: 'context-status'; contextId: string; status: Status }>
  | Readonly<{ kind: 'membership'; principalId: string; contextId: string; audience: AuthorizationAudience; status: Status }>
  | (Readonly<{ kind: 'role-parent'; roleId: string; parentRoleId: string }> & Toggle)
  | (Readonly<{ kind: 'role-grant'; roleId: string; permissionId: string }> & Toggle)
  | Readonly<{ kind: 'role-override'; roleId: string; permissionId: string; effect: Effect }>
  | (Readonly<{ kind: 'role-assignment'; principalId: string; contextId: string; audience: AuthorizationAudience; roleId: string }> & Toggle)
  | Readonly<{ kind: 'principal-override'; principalId: string; contextId: string; audience: AuthorizationAudience;
    permissionId: string; effect: Effect }>;

const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const role = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const permission = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const valid = (value: unknown, pattern: RegExp, max = 128): value is string =>
  typeof value === 'string' && value.length <= max && pattern.test(value);
const audience = (value: unknown): value is AuthorizationAudience => value === 'admin' || value === 'app';
const status = (value: unknown): value is Status => value === 'active' || value === 'disabled';
const effect = (value: unknown): value is Effect => value === 'inherit' || value === 'allow' || value === 'deny';

function key(change: AccessPolicyChange): string {
  switch (change.kind) {
    case 'context-admit': case 'context-status': return JSON.stringify(['context', change.contextId]);
    case 'membership': return JSON.stringify([change.kind, change.principalId, change.contextId, change.audience]);
    case 'role-parent': return JSON.stringify([change.kind, change.roleId, change.parentRoleId]);
    case 'role-grant': case 'role-override': return JSON.stringify([change.kind, change.roleId, change.permissionId]);
    case 'role-assignment': return JSON.stringify([change.kind, change.principalId, change.contextId, change.audience, change.roleId]);
    case 'principal-override': return JSON.stringify([change.kind, change.principalId, change.contextId, change.audience, change.permissionId]);
  }
}

/** Strict, bounded delta; the client never supplies a replacement ACL graph. */
export function parseAccessPolicyChanges(value: unknown): readonly AccessPolicyChange[] | null {
  let copied: unknown;
  try { copied = copyJson(value, ACCESS_DELTA_LIMITS.inputBytes); } catch { return null; }
  if (!Array.isArray(copied) || copied.length < 1 || copied.length > ACCESS_DELTA_LIMITS.changes) return null;
  const seen = new Set<string>(), result: AccessPolicyChange[] = [];
  for (const raw of copied) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const c = raw as Record<string, unknown>;
    let accepted = false;
    switch (c.kind) {
      case 'context-admit': accepted = exactRecord(c, ['kind', 'contextId', 'status'])
        && valid(c.contextId, opaque) && status(c.status); break;
      case 'context-status': accepted = exactRecord(c, ['kind', 'contextId', 'status'])
        && valid(c.contextId, opaque) && status(c.status); break;
      case 'membership': accepted = exactRecord(c, ['kind', 'principalId', 'contextId', 'audience', 'status'])
        && valid(c.principalId, opaque) && valid(c.contextId, opaque) && audience(c.audience) && status(c.status); break;
      case 'role-parent': accepted = exactRecord(c, ['kind', 'roleId', 'parentRoleId', 'present'])
        && valid(c.roleId, role) && valid(c.parentRoleId, role) && typeof c.present === 'boolean'; break;
      case 'role-grant': accepted = exactRecord(c, ['kind', 'roleId', 'permissionId', 'present'])
        && valid(c.roleId, role) && valid(c.permissionId, permission, 256) && typeof c.present === 'boolean'; break;
      case 'role-override': accepted = exactRecord(c, ['kind', 'roleId', 'permissionId', 'effect'])
        && valid(c.roleId, role) && valid(c.permissionId, permission, 256) && effect(c.effect); break;
      case 'role-assignment': accepted = exactRecord(c, ['kind', 'principalId', 'contextId', 'audience', 'roleId', 'present'])
        && valid(c.principalId, opaque) && valid(c.contextId, opaque) && audience(c.audience)
        && valid(c.roleId, role) && typeof c.present === 'boolean'; break;
      case 'principal-override': accepted = exactRecord(c, ['kind', 'principalId', 'contextId', 'audience', 'permissionId', 'effect'])
        && valid(c.principalId, opaque) && valid(c.contextId, opaque) && audience(c.audience)
        && valid(c.permissionId, permission, 256) && effect(c.effect); break;
    }
    if (!accepted || new TextEncoder().encode(JSON.stringify(c)).length > ACCESS_DELTA_LIMITS.changeBytes) return null;
    const change = c as AccessPolicyChange, tuple = key(change);
    if (seen.has(tuple)) return null;
    seen.add(tuple); result.push(Object.freeze(change));
  }
  return Object.freeze(result);
}

/** Apply exact tuple edits while preserving every other grant, parent and assignment. */
export function applyAccessPolicyChanges(current: AccessPolicy, changes: readonly AccessPolicyChange[]): AccessPolicy | null {
  const next = structuredClone(current) as {
    contexts: {id: string; status: Status}[];
    roles: {id: string; inherits: string[]; permissionIds: string[];
      permissionOverrides: {permissionId: string; effect: 'allow' | 'deny'}[]}[];
    memberships: {principalId: string; contextId: string; audience: AuthorizationAudience; status: Status}[];
    assignments: {principalId: string; contextId: string; audience: AuthorizationAudience; roleId: string}[];
    overrides: {principalId: string; contextId: string; audience: AuthorizationAudience;
      permissionId: string; effect: 'allow' | 'deny'}[];
  };
  for (const change of changes) {
    const role = 'roleId' in change ? next.roles.find(item => item.id === change.roleId) : null;
    switch (change.kind) {
      case 'context-admit': {
        if (next.contexts.some(item => item.id === change.contextId)) return null;
        next.contexts.push({id: change.contextId, status: change.status}); break;
      }
      case 'context-status': {
        const context = next.contexts.find(item => item.id === change.contextId);
        if (!context || context.status === change.status) return null;
        context.status = change.status; break;
      }
      case 'membership': {
        const member = next.memberships.find(item => item.principalId === change.principalId
          && item.contextId === change.contextId && item.audience === change.audience);
        if (member && member.status === change.status) return null;
        if (member) member.status = change.status;
        else next.memberships.push({principalId: change.principalId, contextId: change.contextId,
          audience: change.audience, status: change.status});
        break;
      }
      case 'role-parent': {
        if (!role) return null;
        if (role.inherits.includes(change.parentRoleId) === change.present) return null;
        role.inherits = role.inherits.filter(id => id !== change.parentRoleId);
        if (change.present) role.inherits.push(change.parentRoleId);
        break;
      }
      case 'role-grant': {
        if (!role) return null;
        if (role.permissionIds.includes(change.permissionId) === change.present) return null;
        role.permissionIds = role.permissionIds.filter(id => id !== change.permissionId);
        if (change.present) role.permissionIds.push(change.permissionId);
        break;
      }
      case 'role-override': {
        if (!role) return null;
        if ((role.permissionOverrides.find(item => item.permissionId === change.permissionId)?.effect ?? 'inherit') === change.effect) return null;
        role.permissionOverrides = role.permissionOverrides.filter(item => item.permissionId !== change.permissionId);
        if (change.effect !== 'inherit') role.permissionOverrides.push({permissionId: change.permissionId, effect: change.effect});
        break;
      }
      case 'role-assignment': {
        if (next.assignments.some(item => item.principalId === change.principalId && item.contextId === change.contextId
          && item.audience === change.audience && item.roleId === change.roleId) === change.present) return null;
        next.assignments = next.assignments.filter(item => item.principalId !== change.principalId
          || item.contextId !== change.contextId || item.audience !== change.audience || item.roleId !== change.roleId);
        if (change.present) next.assignments.push({principalId: change.principalId, contextId: change.contextId,
          audience: change.audience, roleId: change.roleId});
        break;
      }
      case 'principal-override': {
        if ((next.overrides.find(item => item.principalId === change.principalId
          && item.contextId === change.contextId && item.audience === change.audience
          && item.permissionId === change.permissionId)?.effect ?? 'inherit') === change.effect) return null;
        next.overrides = next.overrides.filter(item => item.principalId !== change.principalId
          || item.contextId !== change.contextId || item.audience !== change.audience || item.permissionId !== change.permissionId);
        if (change.effect !== 'inherit') next.overrides.push({principalId: change.principalId,
          contextId: change.contextId, audience: change.audience, permissionId: change.permissionId, effect: change.effect});
        break;
      }
    }
  }
  next.contexts.sort((a, b) => a.id.localeCompare(b.id));
  next.roles.sort((a, b) => a.id.localeCompare(b.id));
  for (const item of next.roles) {
    item.inherits.sort(); item.permissionIds.sort();
    item.permissionOverrides.sort((a, b) => a.permissionId.localeCompare(b.permissionId));
  }
  next.memberships.sort((a, b) => JSON.stringify([a.principalId,a.contextId,a.audience]).localeCompare(JSON.stringify([b.principalId,b.contextId,b.audience])));
  next.assignments.sort((a, b) => JSON.stringify([a.principalId,a.contextId,a.audience,a.roleId]).localeCompare(JSON.stringify([b.principalId,b.contextId,b.audience,b.roleId])));
  next.overrides.sort((a, b) => JSON.stringify([a.principalId,a.contextId,a.audience,a.permissionId]).localeCompare(JSON.stringify([b.principalId,b.contextId,b.audience,b.permissionId])));
  return parseAccessPolicy(next);
}
