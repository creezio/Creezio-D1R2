import { authorize } from './authorize.ts';
import { createD1AuthorizationStore } from './d1-store.ts';
import { ACCESS_PERMISSION, ADMIN_CONTEXT, MANAGE_ACCESS, exactRecord, parseAccessPolicy,
  policySnapshot, validPolicyCatalog } from './policy.ts';
import type { AccessPolicy } from './policy.ts';
import type { AuthorizationDecision, AuthorizationTarget, PermissionDefinition } from './types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import { digestOpaqueToken } from '../identity/tokens.ts';

type Failure = { readonly ok: false; readonly error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'conflict' | 'storage_error' };
const fail = (error: Failure['error']): Failure => Object.freeze({ ok: false, error });
const MANAGEMENT: AuthorizationTarget = Object.freeze({ contextId: ADMIN_CONTEXT, audience: 'admin',
  actors: Object.freeze(['user'] as const), requiredPermissionIds: Object.freeze([MANAGE_ACCESS]), purpose: 'operation' });

/** Server composition supplies the catalog; callers never choose permission definitions or actor identities. */
export function createAuthorizationService(db: IdentityDatabase, options: { permissions: readonly PermissionDefinition[] }) {
  // The built-in administration permission cannot be broadened by a module catalog.
  if (!options || !Array.isArray(options.permissions) || options.permissions.some(p => p?.id === MANAGE_ACCESS))
    throw new TypeError('Invalid server permission catalog.');
  const permissions = structuredClone([ACCESS_PERMISSION, ...options.permissions]);
  const empty = parseAccessPolicy({ contexts: [], roles: [], memberships: [], assignments: [], overrides: [] })!;
  if (!validPolicyCatalog(empty, permissions)) throw new TypeError('Invalid server permission catalog.');
  const store = createD1AuthorizationStore(db);
  async function state(token: unknown, audience: 'admin' | 'app') {
    const digest = await digestOpaqueToken(token, 'session');
    if (!digest) return null;
    const result = await store.read(digest, audience);
    if (!result) return null;
    const policy = parseAccessPolicy(result.policy);
    if (!policy || !validPolicyCatalog(policy, permissions)) throw new Error('Invalid persisted policy.');
    return { ...result, policy, digest };
  }
  async function check(token: unknown, target: AuthorizationTarget): Promise<AuthorizationDecision> {
    try {
      if (!target || (target.audience !== 'admin' && target.audience !== 'app'))
        return Object.freeze({ allowed: false, reason: 'invalid_target' });
      const current = await state(token, target.audience);
      if (!current) return Object.freeze({ allowed: false, reason: 'credential_disabled' });
      return authorize(policySnapshot(current.policy, permissions, current.session), target, current.nowMs);
    } catch { return Object.freeze({ allowed: false, reason: 'invalid_snapshot' }); }
  }
  async function readPolicy(token: unknown): Promise<{ok: true; epoch: number; policy: AccessPolicy} | Failure> {
    try {
      const current = await state(token, 'admin');
      if (!current) return fail('unauthorized');
      if (!authorize(policySnapshot(current.policy, permissions, current.session), MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      return Object.freeze({ ok: true, epoch: current.epoch, policy: current.policy });
    } catch { return fail('storage_error'); }
  }
  async function replacePolicy(token: unknown, input: unknown): Promise<{ok: true; epoch: number} | Failure> {
    if (!exactRecord(input, ['expectedEpoch', 'policy']) || !Number.isSafeInteger(input.expectedEpoch)
      || Number(input.expectedEpoch) < 1 || Number(input.expectedEpoch) >= Number.MAX_SAFE_INTEGER) return fail('invalid_input');
    const expectedEpoch = Number(input.expectedEpoch);
    const policy = parseAccessPolicy(input.policy);
    if (!policy || !validPolicyCatalog(policy, permissions)) return fail('invalid_input');
    try {
      const current = await state(token, 'admin');
      if (!current) return fail('unauthorized');
      if (!authorize(policySnapshot(current.policy, permissions, current.session), MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      if (current.epoch !== expectedEpoch) return fail('conflict');
      const principals = new Set(current.principals.map(p => p.id));
      if (policy.memberships.some(m => !principals.has(m.principalId))
        || current.policy.contexts.some(c => !policy.contexts.some(next => next.id === c.id))) return fail('invalid_input');
      // Initial administrative editor cannot lock itself out. Transfer/delegated
      // administration needs a separate operation, not an implicit exception.
      if (!authorize(policySnapshot(policy, permissions, current.session), MANAGEMENT, current.nowMs).allowed)
        return fail('forbidden');
      const committed = await store.commitPolicy({ sessionDigest: current.digest, sessionId: current.session.id,
        principalId: current.session.principalId, epoch: current.epoch, policy });
      return committed ? Object.freeze({ ok: true, epoch: current.epoch + 1 }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  return Object.freeze({ check, readPolicy, replacePolicy });
}
