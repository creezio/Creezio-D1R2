import { createD1AuthorizationStore } from '../authorization/d1-store.ts';
import { authorize, copyAuthorizationTarget } from '../authorization/authorize.ts';
import { createNativeAuthorizationResolver, IMPERSONATION_TARGET } from '../authorization/resolver.ts';
import { policySnapshot, validPolicyCatalog, MANAGE_ACCESS, IMPERSONATE_ACCESS, type AccessPolicy } from '../authorization/policy.ts';
import type { AuthorizationSnapshot, AuthorizationTarget, PermissionDefinition } from '../authorization/types.ts';
import { ACCESS_TABLES, type IdentityDatabase } from '../identity/d1-store.ts';
import { digestOpaqueToken } from '../identity/tokens.ts';
import { copyJson, keys, quote, record } from './input.ts';
import { DATA_LIMITS, DataAccessError, type DataCredential } from './types.ts';
import { oauthAccessCondition, type OAuthAccessGuard } from '../authorization/oauth-guard.ts';

export interface ResolvedDataAuthorization {
  readonly snapshot: AuthorizationSnapshot; readonly target: AuthorizationTarget; readonly epoch: number;
  readonly digest: string; readonly nowMs: number; readonly validUntilMs: number;
  readonly actorPrincipalId: string; readonly subjectPrincipalId: string;
  readonly oauth?: OAuthAccessGuard;
}
export interface SqlStatement { readonly sql: string; readonly bindings: readonly (string | number | null)[] }
const table = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, quote(name)])) as Record<keyof typeof ACCESS_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";

/** Same policy projection as native machine/impersonation checks, without a fictitious human session. */
export function scopedSnapshot(policy: AccessPolicy, permissions: readonly PermissionDefinition[], subjectId: string,
  credential: AuthorizationSnapshot['credential'], target: AuthorizationTarget): AuthorizationSnapshot {
  const member = policy.contexts.some(c => c.id === target.contextId && c.status === 'active')
    && policy.memberships.some(m => m.principalId === subjectId && m.contextId === target.contextId
      && m.audience === target.audience && m.status === 'active');
  return {
    actor: { id: subjectId, kind: credential.kind === 'api-token' ? 'service' : 'human', enabled: true,
      contextIds: member ? [target.contextId] : [], audiences: [target.audience] }, credential, permissions, roles: policy.roles,
    assignments: policy.assignments.filter(a => a.principalId === subjectId && a.contextId === target.contextId && a.audience === target.audience)
      .map(a => ({ roleId: a.roleId, contextId: a.contextId, audiences: [a.audience] })),
    overrides: policy.overrides.filter(o => o.principalId === subjectId && o.contextId === target.contextId && o.audience === target.audience)
      .map(o => ({ permissionId: o.permissionId, contextId: o.contextId, audiences: [o.audience], effect: o.effect })),
  };
}

export function createDataAuthorization(db: IdentityDatabase, suppliedPermissions: readonly PermissionDefinition[]) {
  const resolver = createNativeAuthorizationResolver(db, { permissions: suppliedPermissions });
  const store = createD1AuthorizationStore(db), permissions = resolver.permissions;
  async function resolve(input: DataCredential, targetInput: AuthorizationTarget): Promise<ResolvedDataAuthorization> {
    const target = copyAuthorizationTarget(targetInput);
    if (!target || target.purpose !== 'operation') throw new DataAccessError('invalid_input');
    const credential = copyJson(input); record(credential);
    keys(credential, credential.kind === 'oauth' ? ['kind', 'token', 'resource'] : ['kind', 'token']);
    if (!['session', 'api-token', 'impersonation', 'oauth'].includes(String(credential.kind)) || typeof credential.token !== 'string'
      || credential.kind === 'oauth' && (typeof credential.resource !== 'string' || credential.resource.length > 2048))
      throw new DataAccessError('invalid_input');
    const kind = credential.kind as DataCredential['kind'];
    const digest = await digestOpaqueToken(credential.token, kind === 'oauth' ? 'oauth-access' : kind);
    if (!digest) throw new DataAccessError('unauthorized');
    let snapshot: AuthorizationSnapshot, policy: AccessPolicy, epoch: number, nowMs: number, actorPrincipalId: string;
    let oauth: OAuthAccessGuard | undefined;
    if (kind === 'session') {
      const current = await store.read(digest, target.audience);
      if (!current) throw new DataAccessError('unauthorized');
      ({ policy, epoch, nowMs } = current); actorPrincipalId = current.session.principalId;
      snapshot = policySnapshot(policy, permissions, current.session);
    } else if (kind === 'oauth') {
      const current = await store.readOAuthAccess(digest, target.contextId, target.audience, credential.resource as string);
      if (!current) throw new DataAccessError('unauthorized');
      ({policy, epoch, nowMs} = current); actorPrincipalId = current.principal.id;
      const scope = current.credential;
      snapshot = scopedSnapshot(policy, permissions, actorPrincipalId, {
        id: scope.id, subjectId: actorPrincipalId, kind, enabled: true, expiresAtMs: scope.expiresAtMs,
        contextIds: [scope.contextId], audiences: [scope.audience], permissionIds: scope.permissionIds,
      }, target);
      oauth = Object.freeze({digest, credentialId: scope.id, grantId: scope.grantId, clientId: scope.clientId,
        principalId: actorPrincipalId, epoch, contextId: scope.contextId, audience: scope.audience,
        resource: scope.resource, permissionIds: scope.permissionIds});
    } else if (kind === 'api-token') {
      const current = await store.readMachine(digest, target.contextId, target.audience);
      if (!current || !current.credential.scope) throw new DataAccessError('unauthorized');
      ({ policy, epoch, nowMs } = current); actorPrincipalId = current.principal.id;
      const scope = current.credential.scope;
      if (scope.permissionIds.some(id => id === MANAGE_ACCESS || id === IMPERSONATE_ACCESS)) throw new DataAccessError('forbidden');
      snapshot = scopedSnapshot(policy, permissions, actorPrincipalId, {
        id: current.credential.id, subjectId: actorPrincipalId, kind, enabled: true, expiresAtMs: current.credential.expiresAtMs,
        contextIds: [scope.contextId], audiences: [scope.audience], permissionIds: scope.permissionIds,
      }, target);
    } else {
      const current = await store.readImpersonation(digest);
      if (!current) throw new DataAccessError('unauthorized');
      ({ policy, epoch, nowMs } = current); actorPrincipalId = current.session.principalId;
      if (!authorize(policySnapshot(policy, permissions, current.session), IMPERSONATION_TARGET, nowMs).allowed)
        throw new DataAccessError('forbidden');
      const scope = current.impersonation;
      if (scope.permissionIds.some(id => id === MANAGE_ACCESS || id === IMPERSONATE_ACCESS
        || !permissions.find(p => p.id === id)?.actors.includes('user')
        || !permissions.find(p => p.id === id)?.actors.includes('impersonated-user'))) throw new DataAccessError('forbidden');
      snapshot = scopedSnapshot(policy, permissions, current.subject.id, {
        id: scope.id, subjectId: current.subject.id, kind, enabled: true, actorPrincipalId, sourceSessionId: current.session.id,
        expiresAtMs: Math.min(scope.expiresAtMs, current.session.expiresAtMs, current.subject.credentialExpiresAtMs ?? Number.MAX_SAFE_INTEGER),
        contextIds: [scope.contextId], audiences: [scope.audience], permissionIds: scope.permissionIds,
      }, target);
    }
    if (!validPolicyCatalog(policy, permissions) || !authorize(snapshot, target, nowMs).allowed) throw new DataAccessError('forbidden');
    // Captured server state is private to the request-local lease; no reference comes from the caller.
    return Object.freeze({ snapshot, target, epoch, digest, nowMs,
      validUntilMs: Math.min(nowMs + DATA_LIMITS.leaseMs, snapshot.credential.expiresAtMs),
      actorPrincipalId, subjectPrincipalId: snapshot.actor.id, ...(oauth ? {oauth} : {}) });
  }
  return Object.freeze({ resolve, permissions });
}

/** A real failing SELECT aborts the batch. UPDATE 0 would not protect later effects. */
export function freshDataGuard(state: ResolvedDataAuthorization): SqlStatement {
  const c = state.snapshot.credential, t = state.target;
  const human = `s.revoked_at_ms IS NULL AND s.expires_at_ms > ${NOW}
    AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
    AND s.auth_version = p.auth_version AND s.account_version = h.version AND s.credential_version = pc.version
    AND (pc.expires_at_ms IS NULL OR pc.expires_at_ms > ${NOW})`;
  const member = (principal: string, context: string, audience: string) => `EXISTS (SELECT 1 FROM ${table.contexts} ctx
    JOIN ${table.memberships} m ON m.context_id = ctx.id WHERE ctx.id = ${context} AND ctx.status = 'active'
      AND m.principal_id = ${principal} AND m.audience = ${audience} AND m.status = 'active')`;
  const humanFrom = `FROM ${table.sessions} s JOIN ${table.principals} p ON p.id=s.principal_id
    JOIN ${table.human_accounts} h ON h.principal_id=p.id JOIN ${table.password_credentials} pc ON pc.principal_id=p.id
    JOIN ${table.authorization_state} a ON a.id='application'`;
  let sql: string, bindings: (string | number | null)[];
  if (c.kind === 'session') {
    sql = `EXISTS(SELECT 1 ${humanFrom} WHERE s.secret_hash=? AND s.id=? AND p.id=? AND s.audience=?
      AND a.epoch=? AND ${human} AND ${member('p.id', '?', '?')})`;
    bindings = [state.digest, c.id, c.subjectId, t.audience, state.epoch, t.contextId, t.audience];
  } else if (c.kind === 'oauth') {
    if (!state.oauth) throw new DataAccessError('unauthorized');
    const condition = oauthAccessCondition(state.oauth);
    sql = condition.sql; bindings = [...condition.bindings];
  } else if (c.kind === 'api-token') {
    sql = `EXISTS(SELECT 1 FROM ${table.api_credentials} k JOIN ${table.principals} p ON p.id=k.principal_id
      JOIN ${table.authorization_state} a ON a.id='application' WHERE k.secret_hash=? AND k.id=? AND p.id=?
      AND p.kind='service' AND p.status='active' AND k.auth_version=p.auth_version
      AND k.revoked_at_ms IS NULL AND k.revocation_nonce IS NULL AND k.expires_at_ms > ${NOW}
      AND a.epoch=? AND ${member('p.id', '?', '?')}
      AND NOT EXISTS (SELECT 1 FROM json_each(?) requested WHERE NOT EXISTS(SELECT 1 FROM ${table.api_credential_scopes} sc
        WHERE sc.credential_id=k.id AND sc.context_id=? AND sc.audience=? AND sc.permission_id=requested.value)))`;
    bindings = [state.digest, c.id, c.subjectId, state.epoch, t.contextId, t.audience,
      JSON.stringify(c.permissionIds), t.contextId, t.audience];
  } else if (c.kind === 'impersonation') {
    sql = `EXISTS(SELECT 1 ${humanFrom} JOIN ${table.impersonations} k ON k.source_session_id=s.id AND k.actor_principal_id=p.id
      JOIN ${table.principals} tp ON tp.id=k.subject_principal_id JOIN ${table.human_accounts} th ON th.principal_id=tp.id
      JOIN ${table.password_credentials} tc ON tc.principal_id=tp.id
      WHERE k.secret_hash=? AND k.id=? AND p.id=? AND s.id=? AND tp.id=? AND a.epoch=? AND ${human}
      AND s.audience='admin' AND k.context_id=? AND k.audience=? AND k.ended_at_ms IS NULL AND k.revocation_nonce IS NULL
      AND k.expires_at_ms > ${NOW} AND tp.id<>p.id AND tp.kind='human' AND tp.status='active' AND th.status='active'
      AND tp.auth_version=k.subject_auth_version AND th.version=k.subject_account_version AND tc.version=k.subject_credential_version
      AND (tc.expires_at_ms IS NULL OR tc.expires_at_ms > ${NOW})
      AND ${member('p.id', "'application'", "'admin'")} AND ${member('tp.id', 'k.context_id', 'k.audience')}
      AND NOT EXISTS(SELECT 1 FROM json_each(?) requested WHERE NOT EXISTS(SELECT 1 FROM ${table.impersonation_permissions} ip
        WHERE ip.impersonation_id=k.id AND ip.permission_id=requested.value)))`;
    bindings = [state.digest, c.id, c.actorPrincipalId, c.sourceSessionId, c.subjectId, state.epoch,
      t.contextId, t.audience, JSON.stringify(c.permissionIds)];
  } else { throw new DataAccessError('unauthorized'); }
  return Object.freeze({ sql: `SELECT CASE WHEN ${NOW} < ? AND ${sql} THEN 1 ELSE json('creezio_data_guard_failed') END AS allowed`,
    bindings: Object.freeze([state.validUntilMs, ...bindings]) });
}
