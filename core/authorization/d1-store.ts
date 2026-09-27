import { ACCESS_TABLES, type IdentityDatabase, type NativeSession } from '../identity/d1-store.ts';
import { ACCESS_POLICY_LIMITS, parseAccessPolicy, type AccessPolicy } from './policy.ts';
import type { AuthorizationAudience } from './types.ts';
import { MACHINE_SCOPE_LIMITS, parseStoredMachineScopeRows, type MachineScope } from '../identity/machine-policy.ts';
import { decodeImpersonationMeta, type ImpersonationMeta } from '../identity/impersonation-store.ts';
import { IMPERSONATION_LIMITS } from '../identity/impersonation-policy.ts';
import type { SqlStatement } from '../data/authorization.ts';
import {accessAdminCondition, captureAccessAdminGuard, type AccessAdminGuard} from './admin-authority.ts';
import { OAUTH_AUTHORIZATION_FROM, OAUTH_AUTHORIZATION_LIVE } from './oauth-guard.ts';

export interface StoredPrincipal {
  readonly id: string;
  readonly kind: 'human' | 'service';
  readonly status: 'active' | 'disabled';
  readonly humanStatus: 'active' | 'pending' | 'disabled' | null;
}

/** One coherent database read, not proof that a later write is still authorized. */
export interface StoredAuthorizationState {
  readonly epoch: number;
  readonly nowMs: number;
  readonly session: NativeSession;
  readonly principals: readonly StoredPrincipal[];
  readonly policy: AccessPolicy;
}

/** Credential and ACLs resolved together; deliberately has no human session. */
export interface StoredMachineAuthorizationState {
  readonly epoch: number;
  readonly nowMs: number;
  readonly policy: AccessPolicy;
  readonly principal: { readonly id: string; readonly displayName: string; readonly authVersion: number };
  readonly credential: {
    readonly id: string; readonly principalId: string; readonly expiresAtMs: number;
    readonly scope: MachineScope | null;
  };
}

export interface StoredOAuthAuthorizationState {
  readonly epoch: number; readonly nowMs: number; readonly policy: AccessPolicy;
  readonly principals: readonly StoredPrincipal[];
  readonly principal: {readonly id: string; readonly authVersion: number; readonly accountVersion: number; readonly credentialVersion: number};
  readonly credential: {readonly id: string; readonly grantId: string; readonly clientId: string; readonly resource: string;
    readonly contextId: string; readonly audience: AuthorizationAudience; readonly permissionIds: readonly string[]; readonly expiresAtMs: number};
}

/** Current target identity metadata; deliberately not a target session. */
export interface StoredImpersonationSubject {
  readonly id: string;
  readonly displayName: string;
  readonly authVersion: number;
  readonly accountVersion: number;
  readonly credentialVersion: number;
  readonly credentialExpiresAtMs: number | null;
}
export interface StoredImpersonationSourceState extends StoredAuthorizationState {
  readonly subject: StoredImpersonationSubject;
}
export interface StoredImpersonationAuthorizationState extends StoredImpersonationSourceState {
  readonly impersonation: ImpersonationMeta;
}

export type CommitAccessPolicyInput = ({ readonly guard: AccessAdminGuard } | {
  /** Existing T04 session-only direct store callers. */
  readonly sessionDigest: string; readonly sessionId: string; readonly principalId: string; readonly epoch: number;
}) & {
  readonly policy: AccessPolicy;
  /** The checked snapshot from the same administrative read, for lossless audit detail. */
  readonly beforePolicy: AccessPolicy;
};

export class AuthorizationStoreInputError extends Error {
  constructor() { super('Invalid authorization store input.'); this.name = 'AuthorizationStoreInputError'; }
}
export class AuthorizationStoreError extends Error {
  constructor() { super('Authorization storage operation failed.'); this.name = 'AuthorizationStoreError'; }
}

const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const MAX_EPOCH = Number.MAX_SAFE_INTEGER;
const digest = (value: unknown): value is string => typeof value === 'string'
  && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const identifier = (value: unknown): value is string => typeof value === 'string'
  && !/[\r\n\u2028\u2029]/.test(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const audience = (value: unknown): value is AuthorizationAudience => value === 'admin' || value === 'app';
const table = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;

function inputShape(value: unknown): value is CommitAccessPolicyInput {
  try {
    if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.hasOwn(descriptors, 'guard') ? ['guard', 'policy', 'beforePolicy']
      : ['sessionDigest', 'sessionId', 'principalId', 'epoch', 'policy', 'beforePolicy'];
    return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
      descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], 'value'));
  } catch { return false; }
}

function principalRow(value: Record<string, unknown>): StoredPrincipal {
  if (!identifier(value.id) || (value.kind !== 'human' && value.kind !== 'service')
    || (value.status !== 'active' && value.status !== 'disabled')
    || (value.humanStatus !== null && value.humanStatus !== 'active'
      && value.humanStatus !== 'pending' && value.humanStatus !== 'disabled')) throw new AuthorizationStoreError();
  return Object.freeze({ id: value.id, kind: value.kind as StoredPrincipal['kind'],
    status: value.status as StoredPrincipal['status'], humanStatus: value.humanStatus as StoredPrincipal['humanStatus'] });
}

/**
 * Internal trusted server storage, not a public mutation or authorization API.
 * The service resolves this state, checks the fixed application/admin/manage
 * operation, preserves existing context IDs and validates the candidate against
 * the installed permission catalogue before committing. Never accept an ACL or
 * this guard from HTTP/MCP without those checks. No schema creation occurs here.
 */
export function createD1AuthorizationStore(db: IdentityDatabase) {
  const statement = (sql: string, values: (string | number | null)[] = []) => {
    try { return db.prepare(sql).bind(...values); } catch { throw new AuthorizationStoreError(); }
  };
  async function batch(statements: D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[]> {
    try {
      const results = await db.batch<Record<string, unknown>>(statements);
      if (results.length !== statements.length || results.some(result => result.success !== true || !Array.isArray(result.results))) {
        throw new AuthorizationStoreError();
      }
      return results;
    } catch { throw new AuthorizationStoreError(); }
  }

  // Session validity is checked against current account and credential versions,
  // and database time in the batch, never a client timestamp or GPT identity.
  const sessionFrom = `FROM ${table.sessions} s
    JOIN ${table.principals} p ON p.id = s.principal_id
    JOIN ${table.human_accounts} h ON h.principal_id = p.id
    JOIN ${table.password_credentials} c ON c.principal_id = p.id
    JOIN ${table.authorization_state} a ON a.id = 'application'`;
  const currentHumanSession = `s.revoked_at_ms IS NULL AND s.expires_at_ms > ${NOW}
    AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
    AND s.auth_version = p.auth_version AND s.account_version = h.version AND s.credential_version = c.version
    AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ${NOW})`;
  const liveSession = `s.secret_hash = ? AND s.audience = ? AND ${currentHumanSession}`;
  const sourceMembership = `EXISTS (SELECT 1 FROM ${table.contexts} WHERE id = 'application' AND status = 'active')
    AND EXISTS (SELECT 1 FROM ${table.memberships} WHERE principal_id = p.id
      AND context_id = 'application' AND audience = 'admin' AND status = 'active')`;
  const currentTarget = `tp.id <> p.id AND tp.kind = 'human' AND tp.status = 'active' AND th.status = 'active'
    AND (tc.expires_at_ms IS NULL OR tc.expires_at_ms > ${NOW})`;
  const impersonationIdentities = `s.id, s.principal_id AS principalId, p.display_name AS displayName,
    s.audience, s.auth_version AS authVersion, s.created_at_ms AS createdAtMs,
    s.expires_at_ms AS expiresAtMs, a.epoch, ${NOW} AS nowMs,
    tp.id AS subjectId, tp.display_name AS subjectDisplayName, tp.auth_version AS subjectAuthVersion,
    th.version AS subjectAccountVersion, tc.version AS subjectCredentialVersion, tc.expires_at_ms AS subjectCredentialExpiresAtMs`;

  // Keep this same ordered ACL projection for human, machine and impersonation reads.
  // Each caller includes its credential SELECT in the SAME D1 batch, at index 0.
  function policyQueries(): D1PreparedStatement[] {
    return [
      statement(`SELECT p.id, p.kind, p.status, h.status AS humanStatus FROM ${table.principals} p
        LEFT JOIN ${table.human_accounts} h ON h.principal_id = p.id ORDER BY p.id LIMIT ${ACCESS_POLICY_LIMITS.principals + 1}`),
      statement(`SELECT id, status FROM ${table.contexts} ORDER BY id LIMIT ${ACCESS_POLICY_LIMITS.contexts + 1}`),
      statement(`SELECT id FROM ${table.roles} ORDER BY id LIMIT ${ACCESS_POLICY_LIMITS.roles + 1}`),
      statement(`SELECT role_id AS roleId, parent_role_id AS parentRoleId FROM ${table.role_parents}
        ORDER BY role_id, parent_role_id LIMIT ${ACCESS_POLICY_LIMITS.roleEdges + 1}`),
      statement(`SELECT role_id AS roleId, permission_id AS permissionId FROM ${table.role_grants}
        ORDER BY role_id, permission_id LIMIT ${ACCESS_POLICY_LIMITS.roleEdges + 1}`),
      statement(`SELECT role_id AS roleId, permission_id AS permissionId, effect FROM ${table.role_overrides}
        ORDER BY role_id, permission_id LIMIT ${ACCESS_POLICY_LIMITS.roleEdges + 1}`),
      statement(`SELECT principal_id AS principalId, context_id AS contextId, audience, status FROM ${table.memberships}
        ORDER BY principal_id, context_id, audience LIMIT ${ACCESS_POLICY_LIMITS.memberships + 1}`),
      statement(`SELECT principal_id AS principalId, context_id AS contextId, audience, role_id AS roleId FROM ${table.role_assignments}
        ORDER BY principal_id, context_id, audience, role_id LIMIT ${ACCESS_POLICY_LIMITS.assignments + 1}`),
      statement(`SELECT principal_id AS principalId, context_id AS contextId, audience, permission_id AS permissionId, effect
        FROM ${table.principal_overrides} ORDER BY principal_id, context_id, audience, permission_id LIMIT ${ACCESS_POLICY_LIMITS.overrides + 1}`),
    ];
  }

  function decodePolicy(results: D1Result<Record<string, unknown>>[], principalId: string) {
    const caps = [1, ACCESS_POLICY_LIMITS.principals, ACCESS_POLICY_LIMITS.contexts, ACCESS_POLICY_LIMITS.roles,
      ACCESS_POLICY_LIMITS.roleEdges, ACCESS_POLICY_LIMITS.roleEdges, ACCESS_POLICY_LIMITS.roleEdges,
      ACCESS_POLICY_LIMITS.memberships, ACCESS_POLICY_LIMITS.assignments, ACCESS_POLICY_LIMITS.overrides];
    if (caps.some((cap, index) => !results[index] || results[index].results.length > cap)) throw new AuthorizationStoreError();
    const roles = results[3].results.map(role => ({ id: role.id, inherits: [] as unknown[],
      permissionIds: [] as unknown[], permissionOverrides: [] as unknown[] }));
    const roleMap = new Map(roles.map(role => [role.id, role]));
    if (roleMap.size !== roles.length) throw new AuthorizationStoreError();
    for (const parent of results[4].results) {
      const role = roleMap.get(parent.roleId);
      if (!role) throw new AuthorizationStoreError();
      role.inherits.push(parent.parentRoleId);
    }
    for (const grant of results[5].results) {
      const role = roleMap.get(grant.roleId);
      if (!role) throw new AuthorizationStoreError();
      role.permissionIds.push(grant.permissionId);
    }
    for (const override of results[6].results) {
      const role = roleMap.get(override.roleId);
      if (!role) throw new AuthorizationStoreError();
      role.permissionOverrides.push({ permissionId: override.permissionId, effect: override.effect });
    }
    const policy = parseAccessPolicy({ contexts: results[2].results, roles,
      memberships: results[7].results, assignments: results[8].results, overrides: results[9].results });
    if (!policy) throw new AuthorizationStoreError();
    const principals = Object.freeze(results[1].results.map(principalRow));
    const knownPrincipals = new Set(principals.map(principal => principal.id));
    if (knownPrincipals.size !== principals.length || !knownPrincipals.has(principalId)
      || policy.memberships.some(membership => !knownPrincipals.has(membership.principalId))) throw new AuthorizationStoreError();
    return { principals, policy };
  }

  async function read(sessionDigest: string, requestedAudience: AuthorizationAudience): Promise<StoredAuthorizationState | null> {
    if (!digest(sessionDigest) || !audience(requestedAudience)) return null;
    const results = await batch([
      statement(`SELECT s.id, s.principal_id AS principalId, p.display_name AS displayName,
        s.audience, s.auth_version AS authVersion, s.created_at_ms AS createdAtMs,
        s.expires_at_ms AS expiresAtMs, a.epoch, ${NOW} AS nowMs ${sessionFrom}
        WHERE ${liveSession} LIMIT 2`, [sessionDigest, requestedAudience]),
      ...policyQueries(),
    ]);
    if (results[0].results.length === 0) return null;
    const row = results[0].results[0];
    if (!identifier(row.id) || !identifier(row.principalId) || typeof row.displayName !== 'string'
      || row.displayName.length > 200 || !row.displayName.isWellFormed() || !audience(row.audience)
      || row.audience !== requestedAudience || !positive(row.authVersion) || !instant(row.createdAtMs)
      || !instant(row.expiresAtMs) || !positive(row.epoch) || !instant(row.nowMs)
      || row.expiresAtMs <= row.nowMs) throw new AuthorizationStoreError();
    const { principals, policy } = decodePolicy(results, row.principalId);
    const session = Object.freeze({ id: row.id, principalId: row.principalId, displayName: row.displayName,
      audience: row.audience, authVersion: row.authVersion, createdAtMs: row.createdAtMs, expiresAtMs: row.expiresAtMs });
    return Object.freeze({ epoch: row.epoch, nowMs: row.nowMs, session, principals, policy });
  }

  /** null context is used only by the trusted transport to recover the grant's single bound context. */
  async function readOAuthAccess(tokenDigest: string, contextId: string | null,
    requestedAudience: AuthorizationAudience, resource: string): Promise<StoredOAuthAuthorizationState | null> {
    if (!digest(tokenDigest) || contextId !== null && !identifier(contextId) || !audience(requestedAudience)
      || typeof resource !== 'string' || resource.length > 2048) return null;
    try {
      const url = new URL(resource);
      if (url.href !== resource || url.username || url.password || url.search || url.hash
        || url.pathname !== `/mcp/${requestedAudience}`
        || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return null;
    } catch { return null; }
    const results = await batch([
      statement(`SELECT ot.id, og.id AS grantId, og.client_id AS clientId, og.principal_id AS principalId,
        og.resource, og.context_id AS contextId, og.audience, og.permission_ids_json AS permissionIds,
        og.auth_version AS authVersion, og.account_version AS accountVersion, og.credential_version AS credentialVersion,
        MIN(ot.expires_at_ms, COALESCE(pc.expires_at_ms, ot.expires_at_ms)) AS expiresAtMs, a.epoch, ${NOW} AS nowMs
        ${OAUTH_AUTHORIZATION_FROM} WHERE ot.secret_hash=? AND og.resource=? AND og.audience=?
          AND (? IS NULL OR og.context_id=?) AND ${OAUTH_AUTHORIZATION_LIVE} LIMIT 2`,
      [tokenDigest, resource, requestedAudience, contextId, contextId]), ...policyQueries(),
    ]);
    if (results[0].results.length === 0) return null;
    const row = results[0].results[0];
    if (!identifier(row.id) || !identifier(row.grantId) || !identifier(row.principalId) || !identifier(row.contextId)
      || typeof row.clientId !== 'string' || !row.clientId || row.clientId.length > 2048
      || row.resource !== resource || row.audience !== requestedAudience || contextId !== null && row.contextId !== contextId
      || !positive(row.authVersion) || !positive(row.accountVersion) || !positive(row.credentialVersion)
      || !positive(row.epoch) || !instant(row.nowMs) || !instant(row.expiresAtMs) || row.expiresAtMs <= row.nowMs
      || typeof row.permissionIds !== 'string' || row.permissionIds.length > 65536) throw new AuthorizationStoreError();
    let ids: unknown;
    try { ids = JSON.parse(row.permissionIds); } catch { throw new AuthorizationStoreError(); }
    if (!Array.isArray(ids) || ids.length > 128 || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || id.length > 256
        || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id))
      || JSON.stringify(ids) !== row.permissionIds) throw new AuthorizationStoreError();
    const {principals, policy} = decodePolicy(results, row.principalId);
    return Object.freeze({epoch: row.epoch, nowMs: row.nowMs, principals, policy,
      principal: Object.freeze({id: row.principalId, authVersion: row.authVersion,
        accountVersion: row.accountVersion, credentialVersion: row.credentialVersion}),
      credential: Object.freeze({id: row.id, grantId: row.grantId, clientId: row.clientId, resource,
        contextId: row.contextId, audience: requestedAudience, permissionIds: Object.freeze(ids as string[]), expiresAtMs: row.expiresAtMs})});
  }

  async function readMachine(tokenDigest: string, contextId: string,
    requestedAudience: AuthorizationAudience): Promise<StoredMachineAuthorizationState | null> {
    if (!digest(tokenDigest) || !identifier(contextId) || !audience(requestedAudience)) return null;
    const results = await batch([
      statement(`SELECT k.id, k.principal_id AS principalId, p.display_name AS displayName,
        p.auth_version AS authVersion, k.expires_at_ms AS expiresAtMs, a.epoch, ${NOW} AS nowMs
        FROM ${table.api_credentials} k JOIN ${table.principals} p ON p.id = k.principal_id
        JOIN ${table.authorization_state} a ON a.id = 'application'
        WHERE k.secret_hash = ? AND k.revoked_at_ms IS NULL AND k.expires_at_ms > ${NOW}
          AND p.kind = 'service' AND p.status = 'active' AND k.auth_version = p.auth_version LIMIT 2`, [tokenDigest]),
      ...policyQueries(),
      // Validate the complete bounded credential scope set, then select one
      // indivisible tuple. No union of contexts/audiences/permissions is returned.
      statement(`SELECT context_id AS contextId, audience, permission_id AS permissionId
        FROM ${table.api_credential_scopes} WHERE credential_id IN
          (SELECT id FROM ${table.api_credentials} WHERE secret_hash = ?)
        ORDER BY context_id, audience, permission_id LIMIT ${MACHINE_SCOPE_LIMITS.permissions + 1}`, [tokenDigest]),
    ]);
    if (results[0].results.length === 0) return null;
    const row = results[0].results[0];
    if (!identifier(row.id) || !identifier(row.principalId) || typeof row.displayName !== 'string'
      || row.displayName.length > 200 || !row.displayName.isWellFormed() || !positive(row.authVersion)
      || !instant(row.expiresAtMs) || !positive(row.epoch) || !instant(row.nowMs)
      || row.expiresAtMs <= row.nowMs) throw new AuthorizationStoreError();
    const { policy } = decodePolicy(results, row.principalId);
    const scopes = parseStoredMachineScopeRows(results[10].results);
    if (!scopes) throw new AuthorizationStoreError();
    const scope = scopes.find(item => item.contextId === contextId && item.audience === requestedAudience) ?? null;
    return Object.freeze({ epoch: row.epoch, nowMs: row.nowMs, policy,
      principal: Object.freeze({ id: row.principalId, displayName: row.displayName, authVersion: row.authVersion }),
      credential: Object.freeze({ id: row.id, principalId: row.principalId, expiresAtMs: row.expiresAtMs, scope }),
    });
  }

  function decodeImpersonationIdentities(results: D1Result<Record<string, unknown>>[]): StoredImpersonationSourceState {
    if (results[0].results.length !== 1) throw new AuthorizationStoreError();
    const row = results[0].results[0];
    if (!identifier(row.id) || !identifier(row.principalId) || typeof row.displayName !== 'string'
      || row.displayName.length > 200 || !row.displayName.isWellFormed() || row.audience !== 'admin'
      || !positive(row.authVersion) || !instant(row.createdAtMs) || !instant(row.expiresAtMs)
      || !positive(row.epoch) || !instant(row.nowMs) || row.expiresAtMs <= row.nowMs
      || !identifier(row.subjectId) || row.subjectId === row.principalId || typeof row.subjectDisplayName !== 'string'
      || row.subjectDisplayName.length > 200 || !row.subjectDisplayName.isWellFormed()
      || !positive(row.subjectAuthVersion) || !positive(row.subjectAccountVersion) || !positive(row.subjectCredentialVersion)
      || (row.subjectCredentialExpiresAtMs !== null && (!instant(row.subjectCredentialExpiresAtMs)
        || row.subjectCredentialExpiresAtMs <= row.nowMs))) throw new AuthorizationStoreError();
    const { principals, policy } = decodePolicy(results, row.principalId);
    for (const id of [row.principalId, row.subjectId]) {
      const principal = principals.find(item => item.id === id);
      if (!principal || principal.kind !== 'human' || principal.status !== 'active' || principal.humanStatus !== 'active') throw new AuthorizationStoreError();
    }
    const session: NativeSession = Object.freeze({ id: row.id, principalId: row.principalId, displayName: row.displayName,
      audience: 'admin', authVersion: row.authVersion, createdAtMs: row.createdAtMs, expiresAtMs: row.expiresAtMs });
    const subject = Object.freeze({ id: row.subjectId, displayName: row.subjectDisplayName, authVersion: row.subjectAuthVersion,
      accountVersion: row.subjectAccountVersion, credentialVersion: row.subjectCredentialVersion,
      credentialExpiresAtMs: row.subjectCredentialExpiresAtMs });
    return Object.freeze({ epoch: row.epoch, nowMs: row.nowMs, session, principals, policy, subject });
  }

  async function readForImpersonation(sessionDigest: string, subjectPrincipalId: string, contextId: string,
    requestedAudience: AuthorizationAudience): Promise<StoredImpersonationSourceState | null> {
    if (!digest(sessionDigest) || !identifier(subjectPrincipalId) || !identifier(contextId) || !audience(requestedAudience)) return null;
    const results = await batch([
      statement(`SELECT ${impersonationIdentities} ${sessionFrom}
        JOIN ${table.principals} tp ON tp.id = ?
        JOIN ${table.human_accounts} th ON th.principal_id = tp.id
        JOIN ${table.password_credentials} tc ON tc.principal_id = tp.id
        WHERE ${liveSession} AND ${sourceMembership} AND ${currentTarget}
        AND EXISTS (SELECT 1 FROM ${table.contexts} WHERE id = ? AND status = 'active')
        AND EXISTS (SELECT 1 FROM ${table.memberships} WHERE principal_id = tp.id
          AND context_id = ? AND audience = ? AND status = 'active') LIMIT 2`,
      [subjectPrincipalId, sessionDigest, 'admin', contextId, contextId, requestedAudience]),
      ...policyQueries(),
    ]);
    if (!results[0].results.length) return null;
    const state = decodeImpersonationIdentities(results);
    if (state.subject.id !== subjectPrincipalId) throw new AuthorizationStoreError();
    return state;
  }

  async function readImpersonation(tokenDigest: string): Promise<StoredImpersonationAuthorizationState | null> {
    if (!digest(tokenDigest)) return null;
    const results = await batch([
      statement(`SELECT ${impersonationIdentities}, k.id AS impersonationId, k.context_id AS contextId,
        k.audience AS impersonationAudience, k.reason, k.created_at_ms AS impersonationCreatedAtMs,
        k.expires_at_ms AS impersonationExpiresAtMs
        ${sessionFrom} JOIN ${table.impersonations} k ON k.source_session_id = s.id AND k.actor_principal_id = p.id
        JOIN ${table.principals} tp ON tp.id = k.subject_principal_id
        JOIN ${table.human_accounts} th ON th.principal_id = tp.id
        JOIN ${table.password_credentials} tc ON tc.principal_id = tp.id
        WHERE k.secret_hash = ? AND k.ended_at_ms IS NULL AND k.revocation_nonce IS NULL AND k.expires_at_ms > ${NOW}
        AND s.audience = 'admin' AND ${currentHumanSession} AND ${sourceMembership} AND ${currentTarget}
        AND tp.auth_version = k.subject_auth_version AND th.version = k.subject_account_version
        AND tc.version = k.subject_credential_version
        AND EXISTS (SELECT 1 FROM ${table.contexts} WHERE id = k.context_id AND status = 'active')
        AND EXISTS (SELECT 1 FROM ${table.memberships} WHERE principal_id = tp.id
          AND context_id = k.context_id AND audience = k.audience AND status = 'active') LIMIT 2`, [tokenDigest]),
      ...policyQueries(),
      statement(`SELECT permission_id AS permissionId FROM ${table.impersonation_permissions}
        WHERE impersonation_id IN (SELECT id FROM ${table.impersonations} WHERE secret_hash = ?)
        ORDER BY permission_id LIMIT ${IMPERSONATION_LIMITS.permissions + 1}`, [tokenDigest]),
    ]);
    if (!results[0].results.length) return null;
    const state = decodeImpersonationIdentities(results), row = results[0].results[0];
    const impersonation = decodeImpersonationMeta({ id: row.impersonationId, actorPrincipalId: state.session.principalId,
      subjectPrincipalId: state.subject.id, sourceSessionId: state.session.id, contextId: row.contextId,
      audience: row.impersonationAudience, reason: row.reason,
      createdAtMs: row.impersonationCreatedAtMs, expiresAtMs: row.impersonationExpiresAtMs },
    results[10].results.map(item => item.permissionId));
    if (!impersonation || impersonation.expiresAtMs <= state.nowMs) throw new AuthorizationStoreError();
    return Object.freeze({ ...state, impersonation });
  }

  const planned = (sql: string, bindings: (string | number | null)[] = []): SqlStatement => ({sql, bindings});
  function preparePolicyCommit(input: CommitAccessPolicyInput) {
    if (!inputShape(input)) throw new AuthorizationStoreInputError();
    let authority: AccessAdminGuard;
    try { authority = captureAccessAdminGuard('guard' in input ? input.guard : {
      sessionDigest: input.sessionDigest, sessionId: input.sessionId, principalId: input.principalId, epoch: input.epoch}); }
    catch { throw new AuthorizationStoreInputError(); }
    if (authority.epoch >= MAX_EPOCH) throw new AuthorizationStoreInputError();
    // Copy/freeze the candidate before awaiting I/O. The caller cannot alter the
    // serialized effects while claim acquisition is pending.
    const policy = parseAccessPolicy(input.policy);
    const beforePolicy = parseAccessPolicy(input.beforePolicy);
    if (!policy || !beforePolicy) throw new AuthorizationStoreInputError();
    const claim = crypto.randomUUID(), auditId = crypto.randomUUID();
    const current = accessAdminCondition(authority);
    const claimExists = `EXISTS (SELECT 1 FROM ${table.access_audit}
      WHERE id = ? AND claim_nonce = ? AND action = 'authorization-updated')`;
    const guard = () => [auditId, claim];
    const rolesJson = JSON.stringify(policy.roles);
    const statements: SqlStatement[] = [
      planned(`INSERT INTO ${table.access_audit}
        (id, action, principal_id, session_id, credential_id, context_id, audience, claim_nonce, created_at_ms)
        SELECT ?, 'authorization-updated', ?, ?, ?, ?, ?, ?, ${NOW} WHERE ${current.sql}`,
      [auditId, authority.principalId, authority.kind === 'session' ? authority.sessionId : null,
        authority.kind === 'oauth' ? authority.credentialId : null,
        authority.kind === 'oauth' ? 'application' : null, authority.kind === 'oauth' ? 'admin' : null,
        claim, ...current.bindings]),
      ...(['role_assignments', 'principal_overrides', 'role_parents', 'role_grants', 'role_overrides', 'memberships'] as const)
        .map(id => planned(`DELETE FROM ${table[id]} WHERE ${claimExists}`, guard())),
      planned(`INSERT INTO ${table.contexts} (id, status)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.status') FROM json_each(?) WHERE ${claimExists}
        ON CONFLICT(id) DO UPDATE SET status = excluded.status`, [JSON.stringify(policy.contexts), ...guard()]),
      planned(`INSERT INTO ${table.roles} (id)
        SELECT json_extract(value, '$.id') FROM json_each(?) WHERE ${claimExists}
        ON CONFLICT(id) DO NOTHING`, [rolesJson, ...guard()]),
      planned(`DELETE FROM ${table.roles} WHERE id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?))
        AND ${claimExists}`, [rolesJson, ...guard()]),
      planned(`INSERT INTO ${table.memberships} (principal_id, context_id, audience, status)
        SELECT json_extract(value, '$.principalId'), json_extract(value, '$.contextId'),
          json_extract(value, '$.audience'), json_extract(value, '$.status') FROM json_each(?) WHERE ${claimExists}`,
      [JSON.stringify(policy.memberships), ...guard()]),
      planned(`INSERT INTO ${table.role_parents} (role_id, parent_role_id)
        SELECT json_extract(r.value, '$.id'), p.value FROM json_each(?) r, json_each(r.value, '$.inherits') p WHERE ${claimExists}`,
      [rolesJson, ...guard()]),
      planned(`INSERT INTO ${table.role_grants} (role_id, permission_id)
        SELECT json_extract(r.value, '$.id'), g.value FROM json_each(?) r, json_each(r.value, '$.permissionIds') g WHERE ${claimExists}`,
      [rolesJson, ...guard()]),
      planned(`INSERT INTO ${table.role_overrides} (role_id, permission_id, effect)
        SELECT json_extract(r.value, '$.id'), json_extract(o.value, '$.permissionId'), json_extract(o.value, '$.effect')
        FROM json_each(?) r, json_each(r.value, '$.permissionOverrides') o WHERE ${claimExists}`, [rolesJson, ...guard()]),
      planned(`INSERT INTO ${table.role_assignments} (principal_id, context_id, audience, role_id)
        SELECT json_extract(value, '$.principalId'), json_extract(value, '$.contextId'),
          json_extract(value, '$.audience'), json_extract(value, '$.roleId') FROM json_each(?) WHERE ${claimExists}`,
      [JSON.stringify(policy.assignments), ...guard()]),
      planned(`INSERT INTO ${table.principal_overrides} (principal_id, context_id, audience, permission_id, effect)
        SELECT json_extract(value, '$.principalId'), json_extract(value, '$.contextId'), json_extract(value, '$.audience'),
          json_extract(value, '$.permissionId'), json_extract(value, '$.effect') FROM json_each(?) WHERE ${claimExists}`,
      [JSON.stringify(policy.overrides), ...guard()]),
      planned(`UPDATE ${table.authorization_state} SET epoch = epoch + 1, updated_at_ms = ${NOW}
        WHERE id = 'application' AND epoch = ? AND ${claimExists}`, [authority.epoch, ...guard()]),
    ];
    const changesJson = JSON.stringify({version: 1, beforePolicy, afterPolicy: policy});
    if (new TextEncoder().encode(changesJson).length > 524_288) throw new AuthorizationStoreInputError();
    statements.push(planned(`INSERT INTO ${table.access_policy_audit_details}
      (audit_id, from_epoch, to_epoch, changes_json)
      SELECT ?, ?, ?, ? WHERE ${claimExists}`,
    [auditId, authority.epoch, authority.epoch + 1, changesJson, ...guard()]));
    return Object.freeze({auditId, claim, statements: Object.freeze(statements),
      assertion: planned(`SELECT CASE WHEN ${claimExists} THEN 1 ELSE json('creezio_access_policy_conflict') END AS accepted`, guard())});
  }

  async function commitPolicy(input: CommitAccessPolicyInput): Promise<boolean> {
    const plan = preparePolicyCommit(input);
    const results = await batch(plan.statements.map(item => statement(item.sql, [...item.bindings])));
    const acquired = results[0].meta.changes;
    if (acquired !== 0 && acquired !== 1) throw new AuthorizationStoreError();
    // The authorization state update precedes the required detail insert.
    if (results.at(-2)!.meta.changes !== acquired || results.at(-1)!.meta.changes !== acquired)
      throw new AuthorizationStoreError();
    return acquired === 1;
  }

  return Object.freeze({ read, readMachine, readOAuthAccess, readForImpersonation, readImpersonation, commitPolicy, preparePolicyCommit });
}
