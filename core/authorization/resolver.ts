import { createD1AuthorizationStore } from './d1-store.ts';
import { NATIVE_ACCESS_PERMISSIONS, ADMIN_CONTEXT, MANAGE_ACCESS, IMPERSONATE_ACCESS, parseAccessPolicy, validPolicyCatalog } from './policy.ts';
import type { AuthorizationTarget, PermissionDefinition } from './types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import { digestOpaqueToken } from '../identity/tokens.ts';
import {authorize} from './authorize.ts';
import {policySnapshot} from './policy.ts';
import {scopedSnapshot} from '../data/authorization.ts';
import {captureAccessAdminGuard} from './admin-authority.ts';
import type {AuthorizationSnapshot} from './types.ts';
import {copyJson} from '../data/input.ts';

export const ACCESS_MANAGEMENT: AuthorizationTarget = Object.freeze({ contextId: ADMIN_CONTEXT, audience: 'admin',
  actors: Object.freeze(['user', 'delegated-user'] as const), requiredPermissionIds: Object.freeze([MANAGE_ACCESS]), purpose: 'operation' });
export const IMPERSONATION_TARGET: AuthorizationTarget = Object.freeze({ contextId: ADMIN_CONTEXT, audience: 'admin',
  actors: Object.freeze(['user'] as const), requiredPermissionIds: Object.freeze([IMPERSONATE_ACCESS]), purpose: 'operation' });

/** Server-owned catalogue and coherent native identity/policy resolution. A result
 * is not a write permit: every mutation must revalidate its guard in its D1 batch. */
export function createNativeAuthorizationResolver(db: IdentityDatabase, options: { permissions: readonly PermissionDefinition[] }) {
  if (!options || !Array.isArray(options.permissions) || options.permissions.some(p => p?.id === MANAGE_ACCESS || p?.id === IMPERSONATE_ACCESS))
    throw new TypeError('Invalid server permission catalog.');
  const permissions = structuredClone([...NATIVE_ACCESS_PERMISSIONS, ...options.permissions]);
  const empty = parseAccessPolicy({ contexts: [], roles: [], memberships: [], assignments: [], overrides: [] })!;
  if (!validPolicyCatalog(empty, permissions)) throw new TypeError('Invalid server permission catalog.');
  for (const permission of permissions) {
    Object.freeze(permission.actors); Object.freeze(permission.audiences); Object.freeze(permission);
  }
  Object.freeze(permissions);
  const store = createD1AuthorizationStore(db);
  async function resolve(token: unknown, audience: 'admin' | 'app') {
    const digest = await digestOpaqueToken(token, 'session');
    if (!digest) return null;
    const result = await store.read(digest, audience);
    if (!result) return null;
    const policy = parseAccessPolicy(result.policy);
    if (!policy || !validPolicyCatalog(policy, permissions)) throw new Error('Invalid persisted policy.');
    return Object.freeze({ ...result, policy, digest });
  }
  async function resolveAdminAuthority(input: unknown) {
    let captured: Record<string, unknown> | null = null;
    if (typeof input !== 'string') {
      try {
        const value = copyJson(input, 4096);
        if (value && typeof value === 'object' && !Array.isArray(value)) captured = value as Record<string, unknown>;
      } catch { return null; }
    }
    const token = typeof input === 'string' ? input
      : captured && Object.keys(captured).length === 2 && captured.kind === 'session' ? captured.token : null;
    if (token !== null) {
      const current = await resolve(token, 'admin');
      if (!current) return null;
      const snapshot = policySnapshot(current.policy, permissions, current.session);
      return Object.freeze({policy: current.policy, principals: current.principals, epoch: current.epoch,
        nowMs: current.nowMs, principalId: current.session.principalId, snapshot,
        snapshotFor: (policy: typeof current.policy) => policySnapshot(policy, permissions, current.session),
        guard: captureAccessAdminGuard({kind: 'session', sessionDigest: current.digest,
          sessionId: current.session.id, principalId: current.session.principalId, epoch: current.epoch})});
    }
    if (!captured || Object.keys(captured).length !== 3 || captured.kind !== 'oauth'
      || typeof captured.resource !== 'string') return null;
    const digest = await digestOpaqueToken(captured.token, 'oauth-access');
    if (!digest) return null;
    const current = await store.readOAuthAccess(digest, ADMIN_CONTEXT, 'admin', captured.resource);
    if (!current || !validPolicyCatalog(current.policy, permissions)) return null;
    const scope = current.credential;
    const snapshot: AuthorizationSnapshot = scopedSnapshot(current.policy, permissions, current.principal.id, {
      id: scope.id, subjectId: current.principal.id, kind: 'oauth', enabled: true,
      expiresAtMs: scope.expiresAtMs, contextIds: [scope.contextId], audiences: [scope.audience],
      permissionIds: scope.permissionIds,
    }, ACCESS_MANAGEMENT);
    if (!authorize(snapshot, ACCESS_MANAGEMENT, current.nowMs).allowed) return null;
    return Object.freeze({policy: current.policy, principals: current.principals, epoch: current.epoch,
      nowMs: current.nowMs, principalId: current.principal.id, snapshot,
      snapshotFor: (policy: typeof current.policy) => scopedSnapshot(policy, permissions, current.principal.id, {
        id: scope.id, subjectId: current.principal.id, kind: 'oauth', enabled: true,
        expiresAtMs: scope.expiresAtMs, contextIds: [scope.contextId], audiences: [scope.audience],
        permissionIds: scope.permissionIds,
      }, ACCESS_MANAGEMENT),
      guard: captureAccessAdminGuard({kind: 'oauth', digest, credentialId: scope.id,
        grantId: scope.grantId, clientId: scope.clientId, principalId: current.principal.id,
        epoch: current.epoch, contextId: scope.contextId, audience: scope.audience,
        resource: scope.resource, permissionIds: scope.permissionIds})});
  }
  return Object.freeze({ permissions, resolve, resolveAdminAuthority });
}
