import { createD1MachineStore } from './machine-store.ts';
import { createD1IdentityStore, type IdentityDatabase } from './d1-store.ts';
import { parseMachineScopes, type MachineScope } from './machine-policy.ts';
import { identityInputFields, identityAdmissionKey, normalizeDisplayName, validIdentityId } from './input.ts';
import { digestOpaqueToken, issueOpaqueToken } from './tokens.ts';
import { ACCESS_MANAGEMENT, createNativeAuthorizationResolver } from '../authorization/resolver.ts';
import { createD1AuthorizationStore } from '../authorization/d1-store.ts';
import { authorize, copyAuthorizationTarget } from '../authorization/authorize.ts';
import { MANAGE_ACCESS, policySnapshot, validPolicyCatalog, type AccessPolicy } from '../authorization/policy.ts';
import type { AuthorizationDecision, AuthorizationSnapshot, AuthorizationTarget, PermissionDefinition } from '../authorization/types.ts';

export const MACHINE_ACCOUNT_POLICY = Object.freeze({ minimumTtlMs: 1000, maximumTtlMs: 365 * 24 * 60 * 60 * 1000,
  admissionWindowMs: 60_000, administrationGlobalLimit: 60, administrationActorLimit: 20 });
type Failure = Readonly<{ ok: false; error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'conflict' | 'rate_limited' | 'storage_error' }>;
const fail = (error: Failure['error']): Failure => Object.freeze({ ok: false, error });
const validTtl = (value: unknown): value is number => Number.isSafeInteger(value)
  && Number(value) >= MACHINE_ACCOUNT_POLICY.minimumTtlMs && Number(value) <= MACHINE_ACCOUNT_POLICY.maximumTtlMs;

/** Explicit service identities and scoped API credentials. A provider API key,
 * browser session and machine credential are different authorities. All methods
 * are internal operations until their transport adapters are qualified. */
export function createMachineAccountService(db: IdentityDatabase, options: { permissions: readonly PermissionDefinition[] }) {
  const store = createD1MachineStore(db), identity = createD1IdentityStore(db);
  const authorizationStore = createD1AuthorizationStore(db);
  const { resolve, permissions } = createNativeAuthorizationResolver(db, options);
  const catalog = new Map(permissions.map(permission => [permission.id, permission]));
  function knownScopes(scopes: readonly MachineScope[]) {
    return scopes.every(scope => scope.permissionIds.every(id => {
      const definition = catalog.get(id);
      return id !== MANAGE_ACCESS && definition?.actors.includes('machine') && definition.audiences.includes(scope.audience);
    }));
  }
  function activeContexts(scopes: readonly MachineScope[], policy: AccessPolicy) {
    return scopes.every(scope => policy.contexts.some(context => context.id === scope.contextId && context.status === 'active'));
  }
  async function administration(token: unknown) {
    const current = await resolve(token, 'admin');
    if (!current) return fail('unauthorized');
    if (!authorize(policySnapshot(current.policy, permissions, current.session), ACCESS_MANAGEMENT, current.nowMs).allowed)
      return fail('forbidden');
    const windowMs = MACHINE_ACCOUNT_POLICY.admissionWindowMs;
    if (!(await identity.consumeThrottle({ key: await identityAdmissionKey('machine-administration-global'),
      limit: MACHINE_ACCOUNT_POLICY.administrationGlobalLimit, windowMs })).allowed
      || !(await identity.consumeThrottle({ key: await identityAdmissionKey('machine-administration-actor', current.session.principalId),
        limit: MACHINE_ACCOUNT_POLICY.administrationActorLimit, windowMs })).allowed) return fail('rate_limited');
    return { ok: true as const, policy: current.policy, guard: Object.freeze({ sessionDigest: current.digest,
      sessionId: current.session.id, principalId: current.session.principalId, epoch: current.epoch }) };
  }
  async function createService(token: unknown, input: unknown) {
    if (!identityInputFields(input, ['displayName'])) return fail('invalid_input');
    const displayName = normalizeDisplayName(input.displayName);
    if (!displayName) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      const principal = await store.createService(current.guard, { displayName });
      return principal ? Object.freeze({ ok: true as const, principal }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function setServiceStatus(token: unknown, input: unknown) {
    if (!identityInputFields(input, ['principalId', 'expectedAuthVersion', 'status']) || !validIdentityId(input.principalId)
      || !Number.isSafeInteger(input.expectedAuthVersion) || Number(input.expectedAuthVersion) < 1
      || Number(input.expectedAuthVersion) >= Number.MAX_SAFE_INTEGER || (input.status !== 'active' && input.status !== 'disabled'))
      return fail('invalid_input');
    const principalId = input.principalId, expectedAuthVersion = Number(input.expectedAuthVersion), status = input.status;
    try {
      const current = await administration(token); if (!current.ok) return current;
      const principal = await store.setServiceStatus(current.guard, { principalId, expectedAuthVersion, status });
      return principal ? Object.freeze({ ok: true as const, principal }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function issueToken(token: unknown, input: unknown) {
    if (!identityInputFields(input, ['principalId', 'label', 'ttlMs', 'scopes']) || !validIdentityId(input.principalId)
      || !validTtl(input.ttlMs)) return fail('invalid_input');
    const principalId = input.principalId, ttlMs = input.ttlMs, label = normalizeDisplayName(input.label), scopes = parseMachineScopes(input.scopes);
    if (!label || !scopes || !knownScopes(scopes)) return fail('invalid_input');
    try {
      const current = await administration(token); if (!current.ok) return current;
      if (!activeContexts(scopes, current.policy)) return fail('invalid_input');
      const issued = await issueOpaqueToken('api-token');
      const credential = await store.issueToken(current.guard, { principalId, label, ttlMs, scopes, digest: issued.digest });
      return credential ? Object.freeze({ ok: true as const, token: issued.token, credential }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function rotateToken(token: unknown, input: unknown) {
    if (!identityInputFields(input, ['credentialId', 'ttlMs']) || !validIdentityId(input.credentialId) || !validTtl(input.ttlMs))
      return fail('invalid_input');
    const credentialId = input.credentialId, ttlMs = input.ttlMs;
    try {
      const current = await administration(token); if (!current.ok) return current;
      const previous = await store.readToken(credentialId);
      if (!previous) return fail('conflict');
      const scopes = parseMachineScopes(previous.scopes);
      if (!scopes || !knownScopes(scopes) || !activeContexts(scopes, current.policy)) return fail('invalid_input');
      const issued = await issueOpaqueToken('api-token');
      const credential = await store.rotateToken(current.guard, { credentialId, ttlMs, digest: issued.digest });
      return credential ? Object.freeze({ ok: true as const, token: issued.token, credential }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function revokeToken(token: unknown, input: unknown) {
    if (!identityInputFields(input, ['credentialId']) || !validIdentityId(input.credentialId)) return fail('invalid_input');
    const credentialId = input.credentialId;
    try {
      const current = await administration(token); if (!current.ok) return current;
      return await store.revokeToken(current.guard, credentialId) ? Object.freeze({ ok: true as const }) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  async function check(token: unknown, target: AuthorizationTarget): Promise<AuthorizationDecision> {
    try {
      const captured = copyAuthorizationTarget(target);
      if (!captured) return Object.freeze({ allowed: false, reason: 'invalid_target' });
      const digest = await digestOpaqueToken(token, 'api-token');
      if (!digest) return Object.freeze({ allowed: false, reason: 'credential_disabled' });
      const current = await authorizationStore.readMachine(digest, captured.contextId, captured.audience);
      if (!current) return Object.freeze({ allowed: false, reason: 'credential_disabled' });
      if (!validPolicyCatalog(current.policy, permissions)) return Object.freeze({ allowed: false, reason: 'invalid_snapshot' });
      const scope = current.credential.scope;
      if (scope && (scope.contextId !== captured.contextId || scope.audience !== captured.audience || !knownScopes([scope])))
        return Object.freeze({ allowed: false, reason: 'invalid_snapshot' });
      const principalId = current.principal.id;
      const member = current.policy.contexts.some(context => context.id === captured.contextId && context.status === 'active')
        && current.policy.memberships.some(m => m.principalId === principalId && m.contextId === captured.contextId
          && m.audience === captured.audience && m.status === 'active');
      const snapshot: AuthorizationSnapshot = {
        actor: { id: principalId, kind: 'service', enabled: true, contextIds: member ? [captured.contextId] : [], audiences: [captured.audience] },
        credential: { id: current.credential.id, subjectId: current.credential.principalId, kind: 'api-token', enabled: true,
          expiresAtMs: current.credential.expiresAtMs, contextIds: scope ? [scope.contextId] : [],
          audiences: scope ? [scope.audience] : [], permissionIds: scope ? scope.permissionIds : [] },
        permissions, roles: current.policy.roles,
        assignments: current.policy.assignments.filter(a => a.principalId === principalId && a.contextId === captured.contextId && a.audience === captured.audience)
          .map(a => ({ roleId: a.roleId, contextId: a.contextId, audiences: [a.audience] })),
        overrides: current.policy.overrides.filter(o => o.principalId === principalId && o.contextId === captured.contextId && o.audience === captured.audience)
          .map(o => ({ permissionId: o.permissionId, contextId: o.contextId, audiences: [o.audience], effect: o.effect })),
      };
      return authorize(snapshot, captured, current.nowMs);
    } catch { return Object.freeze({ allowed: false, reason: 'invalid_snapshot' }); }
  }
  return Object.freeze({ createService, setServiceStatus, issueToken, rotateToken, revokeToken, check });
}
