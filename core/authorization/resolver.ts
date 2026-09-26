import { createD1AuthorizationStore } from './d1-store.ts';
import { NATIVE_ACCESS_PERMISSIONS, ADMIN_CONTEXT, MANAGE_ACCESS, IMPERSONATE_ACCESS, parseAccessPolicy, validPolicyCatalog } from './policy.ts';
import type { AuthorizationTarget, PermissionDefinition } from './types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import { digestOpaqueToken } from '../identity/tokens.ts';

export const ACCESS_MANAGEMENT: AuthorizationTarget = Object.freeze({ contextId: ADMIN_CONTEXT, audience: 'admin',
  actors: Object.freeze(['user'] as const), requiredPermissionIds: Object.freeze([MANAGE_ACCESS]), purpose: 'operation' });
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
  return Object.freeze({ permissions, resolve });
}
