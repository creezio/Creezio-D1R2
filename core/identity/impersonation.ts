import { createD1IdentityStore, type IdentityDatabase } from './d1-store.ts';
import { createD1ImpersonationStore } from './impersonation-store.ts';
import { IMPERSONATION_LIMITS, normalizeImpersonationReason, parseImpersonationPermissions } from './impersonation-policy.ts';
import { identityAdmissionKey, identityInputFields, validIdentityId } from './input.ts';
import { digestOpaqueToken, issueOpaqueToken } from './tokens.ts';
import { createD1AuthorizationStore } from '../authorization/d1-store.ts';
import { authorize, copyAuthorizationTarget } from '../authorization/authorize.ts';
import { createNativeAuthorizationResolver, IMPERSONATION_TARGET } from '../authorization/resolver.ts';
import { IMPERSONATE_ACCESS, MANAGE_ACCESS, policySnapshot, validPolicyCatalog, type AccessPolicy } from '../authorization/policy.ts';
import type { AuthorizationAudience, AuthorizationDecision, AuthorizationSnapshot, AuthorizationTarget, PermissionDefinition } from '../authorization/types.ts';

type Failure = Readonly<{ok: false; error: 'invalid_input' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'conflict' | 'storage_error'}>;
const fail = (error: Failure['error']): Failure => Object.freeze({ok: false, error});
const refused = (reason: AuthorizationDecision['reason']): AuthorizationDecision => Object.freeze({allowed: false, reason});
interface Scope {
  readonly subjectPrincipalId: string;
  readonly contextId: string;
  readonly audience: AuthorizationAudience;
  readonly permissionIds: readonly string[];
}
function startInput(value: unknown): (Scope & {readonly reason: string; readonly ttlMs: number}) | null {
  if (!identityInputFields(value, ['subjectPrincipalId', 'contextId', 'audience', 'permissionIds', 'reason', 'ttlMs'])
    || !validIdentityId(value.subjectPrincipalId) || !validIdentityId(value.contextId)
    || (value.audience !== 'admin' && value.audience !== 'app') || !Number.isSafeInteger(value.ttlMs)
    || Number(value.ttlMs) < IMPERSONATION_LIMITS.minimumTtlMs || Number(value.ttlMs) > IMPERSONATION_LIMITS.maximumTtlMs) return null;
  const reason = normalizeImpersonationReason(value.reason), permissionIds = parseImpersonationPermissions(value.permissionIds);
  if (!reason || !permissionIds) return null;
  return Object.freeze({subjectPrincipalId: value.subjectPrincipalId, contextId: value.contextId,
    audience: value.audience, permissionIds, reason, ttlMs: Number(value.ttlMs)});
}

/** Internal operations. No cookie, HTTP adapter, UI identity switch or business write permit is issued here. */
export function createImpersonationService(db: IdentityDatabase, options: {permissions: readonly PermissionDefinition[]}) {
  const { permissions } = createNativeAuthorizationResolver(db, options);
  const catalog = new Map(permissions.map(p => [p.id, p]));
  const authorization = createD1AuthorizationStore(db), store = createD1ImpersonationStore(db), identity = createD1IdentityStore(db);
  function knownScope(scope: Scope): boolean {
    return scope.permissionIds.every(id => {
      const definition = catalog.get(id);
      return id !== MANAGE_ACCESS && id !== IMPERSONATE_ACCESS && definition?.audiences.includes(scope.audience)
        && definition.actors.includes('user') && definition.actors.includes('impersonated-user');
    });
  }
  function snapshot(policy: AccessPolicy, scope: Scope,
    source: {readonly actorPrincipalId: string; readonly sourceSessionId: string; readonly id: string; readonly expiresAtMs: number}): AuthorizationSnapshot {
    const member = policy.contexts.some(c => c.id === scope.contextId && c.status === 'active')
      && policy.memberships.some(m => m.principalId === scope.subjectPrincipalId && m.contextId === scope.contextId
        && m.audience === scope.audience && m.status === 'active');
    return {
      actor: {id: scope.subjectPrincipalId, kind: 'human', enabled: true, contextIds: member ? [scope.contextId] : [], audiences: [scope.audience]},
      credential: {id: source.id, subjectId: scope.subjectPrincipalId, kind: 'impersonation', enabled: true,
        actorPrincipalId: source.actorPrincipalId, sourceSessionId: source.sourceSessionId,
        expiresAtMs: source.expiresAtMs, contextIds: [scope.contextId], audiences: [scope.audience], permissionIds: scope.permissionIds},
      permissions, roles: policy.roles,
      assignments: policy.assignments.filter(a => a.principalId === scope.subjectPrincipalId && a.contextId === scope.contextId && a.audience === scope.audience)
        .map(a => ({roleId: a.roleId, contextId: a.contextId, audiences: [a.audience]})),
      overrides: policy.overrides.filter(o => o.principalId === scope.subjectPrincipalId && o.contextId === scope.contextId && o.audience === scope.audience)
        .map(o => ({permissionId: o.permissionId, contextId: o.contextId, audiences: [o.audience], effect: o.effect})),
    };
  }

  async function start(sourceToken: unknown, input: unknown) {
    const captured = startInput(input);
    if (!captured || !knownScope(captured)) return fail('invalid_input');
    try {
      const digest = await digestOpaqueToken(sourceToken, 'session');
      if (!digest) return fail('unauthorized');
      const current = await authorization.readForImpersonation(digest, captured.subjectPrincipalId, captured.contextId, captured.audience);
      if (!current) return fail('unauthorized');
      if (!validPolicyCatalog(current.policy, permissions)) return fail('storage_error');
      if (current.session.principalId === captured.subjectPrincipalId) return fail('forbidden');
      if (!authorize(policySnapshot(current.policy, permissions, current.session), IMPERSONATION_TARGET, current.nowMs).allowed) return fail('forbidden');
      // This prospective impersonation snapshot is only an eligibility check. It
      // creates no target session, persisted credential or reusable write permit.
      const eligible = snapshot(current.policy, captured, {id: 'proposed-impersonation', actorPrincipalId: current.session.principalId,
        sourceSessionId: current.session.id, expiresAtMs: Math.min(current.session.expiresAtMs, current.nowMs + captured.ttlMs,
          current.subject.credentialExpiresAtMs ?? Number.MAX_SAFE_INTEGER)});
      const scopeTarget: AuthorizationTarget = {contextId: captured.contextId, audience: captured.audience,
        actors: ['impersonated-user'], requiredPermissionIds: captured.permissionIds, purpose: 'operation'};
      if (!authorize(eligible, scopeTarget, current.nowMs).allowed) return fail('forbidden');
      if (!(await identity.consumeThrottle({key: await identityAdmissionKey('account-administration-global'), limit: 60, windowMs: 60_000})).allowed
        || !(await identity.consumeThrottle({key: await identityAdmissionKey('account-administration-subject', current.session.principalId), limit: 20, windowMs: 60_000})).allowed)
        return fail('rate_limited');
      const issued = await issueOpaqueToken('impersonation');
      const impersonation = await store.start({sessionDigest: digest, sessionId: current.session.id, principalId: current.session.principalId, epoch: current.epoch},
        {digest: issued.digest, subjectPrincipalId: captured.subjectPrincipalId, subjectAuthVersion: current.subject.authVersion,
          subjectAccountVersion: current.subject.accountVersion, subjectCredentialVersion: current.subject.credentialVersion,
          contextId: captured.contextId, audience: captured.audience, permissionIds: captured.permissionIds, reason: captured.reason, ttlMs: captured.ttlMs});
      return impersonation ? Object.freeze({ok: true as const, token: issued.token, impersonation}) : fail('conflict');
    } catch { return fail('storage_error'); }
  }

  async function check(token: unknown, target: AuthorizationTarget): Promise<AuthorizationDecision> {
    const captured = copyAuthorizationTarget(target);
    if (!captured) return refused('invalid_target');
    try {
      const digest = await digestOpaqueToken(token, 'impersonation');
      if (!digest) return refused('credential_disabled');
      const current = await authorization.readImpersonation(digest);
      if (!current) return refused('credential_disabled');
      if (!validPolicyCatalog(current.policy, permissions) || !knownScope(current.impersonation)) return refused('invalid_snapshot');
      if (!authorize(policySnapshot(current.policy, permissions, current.session), IMPERSONATION_TARGET, current.nowMs).allowed)
        return refused('credential_disabled');
      return authorize(snapshot(current.policy, current.impersonation, current.impersonation), captured, current.nowMs);
    } catch { return refused('invalid_snapshot'); }
  }

  async function stop(token: unknown) {
    try {
      const digest = await digestOpaqueToken(token, 'impersonation');
      if (!digest) return fail('unauthorized');
      // Ending one's credential does not require an administrator still to have
      // access. This never restores the source session or returns its secret.
      return await store.stop(digest) ? Object.freeze({ok: true as const}) : fail('conflict');
    } catch { return fail('storage_error'); }
  }
  return Object.freeze({start, check, stop});
}
