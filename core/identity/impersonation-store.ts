import { ACCESS_TABLES, type IdentityDatabase } from './d1-store.ts';
import type { LifecycleGuard } from './lifecycle-store.ts';
import { identityInputFields, validIdentityAudience, validIdentityId } from './input.ts';
import { IMPERSONATION_LIMITS, normalizeImpersonationReason, parseImpersonationPermissions } from './impersonation-policy.ts';

export interface ImpersonationMeta {
  readonly id: string;
  readonly actorPrincipalId: string;
  readonly subjectPrincipalId: string;
  readonly sourceSessionId: string;
  readonly contextId: string;
  readonly audience: 'admin' | 'app';
  readonly reason: string;
  readonly permissionIds: readonly string[];
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}
export interface StartImpersonationInput {
  readonly digest: string;
  readonly subjectPrincipalId: string;
  readonly subjectAuthVersion: number;
  readonly subjectAccountVersion: number;
  readonly subjectCredentialVersion: number;
  readonly contextId: string;
  readonly audience: 'admin' | 'app';
  readonly permissionIds: readonly string[];
  readonly reason: string;
  readonly ttlMs: number;
}
export const IMPERSONATION_STORE_LIMITS = IMPERSONATION_LIMITS;
export class ImpersonationStoreInputError extends Error {
  constructor() { super('Invalid impersonation store input.'); this.name = 'ImpersonationStoreInputError'; }
}
export class ImpersonationStoreError extends Error {
  constructor() { super('Impersonation storage operation failed.'); this.name = 'ImpersonationStoreError'; }
}

const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const MAX = Number.MAX_SAFE_INTEGER;
const table = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;
const digest = (value: unknown): value is string => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function validImpersonationReason(value: unknown): value is string {
  return typeof value === 'string' && normalizeImpersonationReason(value) === value;
}
/** Closed copied data, no wildcards, duplicate entries or implicit native administration. */
export function copyImpersonationPermissions(value: unknown): readonly string[] | null {
  const items = parseImpersonationPermissions(value);
  return items && !items.includes('creezio.access:manage') && !items.includes('creezio.access:impersonate') ? items : null;
}
/** Safe projection shared by coherent authorization reads and issuance. */
export function decodeImpersonationMeta(row: Record<string, unknown>, permissions: unknown): ImpersonationMeta | null {
  const permissionIds = copyImpersonationPermissions(permissions);
  if (!permissionIds || !validIdentityId(row.id) || !validIdentityId(row.actorPrincipalId)
    || !validIdentityId(row.subjectPrincipalId) || row.actorPrincipalId === row.subjectPrincipalId
    || !validIdentityId(row.sourceSessionId) || !validIdentityId(row.contextId) || !validIdentityAudience(row.audience)
    || !validImpersonationReason(row.reason) || !instant(row.createdAtMs) || !instant(row.expiresAtMs)
    || row.expiresAtMs <= row.createdAtMs || row.expiresAtMs - row.createdAtMs > IMPERSONATION_STORE_LIMITS.maximumTtlMs) return null;
  return Object.freeze({ id: row.id, actorPrincipalId: row.actorPrincipalId, subjectPrincipalId: row.subjectPrincipalId,
    sourceSessionId: row.sourceSessionId, contextId: row.contextId, audience: row.audience, reason: row.reason,
    permissionIds, createdAtMs: row.createdAtMs, expiresAtMs: row.expiresAtMs });
}
function captureGuard(value: unknown): LifecycleGuard {
  if (!identityInputFields(value, ['sessionDigest', 'sessionId', 'principalId', 'epoch']) || !digest(value.sessionDigest)
    || !validIdentityId(value.sessionId) || !validIdentityId(value.principalId) || !positive(value.epoch)) throw new ImpersonationStoreInputError();
  return Object.freeze({ sessionDigest: value.sessionDigest, sessionId: value.sessionId,
    principalId: value.principalId, epoch: value.epoch });
}
function captureStart(value: unknown): StartImpersonationInput {
  if (!identityInputFields(value, ['digest', 'subjectPrincipalId', 'subjectAuthVersion', 'subjectAccountVersion',
    'subjectCredentialVersion', 'contextId', 'audience', 'permissionIds', 'reason', 'ttlMs'])
    || !digest(value.digest) || !validIdentityId(value.subjectPrincipalId) || !positive(value.subjectAuthVersion)
    || !positive(value.subjectAccountVersion) || !positive(value.subjectCredentialVersion) || !validIdentityId(value.contextId)
    || !validIdentityAudience(value.audience) || !validImpersonationReason(value.reason)
    || !Number.isSafeInteger(value.ttlMs) || Number(value.ttlMs) < IMPERSONATION_STORE_LIMITS.minimumTtlMs
    || Number(value.ttlMs) > IMPERSONATION_STORE_LIMITS.maximumTtlMs) throw new ImpersonationStoreInputError();
  const permissionIds = copyImpersonationPermissions(value.permissionIds);
  if (!permissionIds) throw new ImpersonationStoreInputError();
  return Object.freeze({ digest: value.digest, subjectPrincipalId: value.subjectPrincipalId,
    subjectAuthVersion: value.subjectAuthVersion, subjectAccountVersion: value.subjectAccountVersion,
    subjectCredentialVersion: value.subjectCredentialVersion, contextId: value.contextId,
    audience: value.audience, permissionIds, reason: value.reason, ttlMs: Number(value.ttlMs) });
}

/**
 * Internal trusted persistence. The server first authorizes the fixed native
 * impersonate permission and every requested target permission from one coherent
 * read. The epoch binds that decision to issuance; SQL rechecks identities,
 * versions, membership and deadlines. This store is not a public grant API.
 * A separate credential is created, never a target session or role assignment.
 * Stopping proves possession only and may end an already invalid credential.
 */
export function createD1ImpersonationStore(db: IdentityDatabase) {
  const statement = (sql: string, values: (string | number | null)[] = []) => {
    try { return db.prepare(sql).bind(...values); } catch { throw new ImpersonationStoreError(); }
  };
  async function batch(statements: D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[]> {
    try {
      const results = await db.batch<Record<string, unknown>>(statements);
      if (results.length !== statements.length || results.some(r => r.success !== true || !Array.isArray(r.results))) throw new ImpersonationStoreError();
      return results;
    } catch { throw new ImpersonationStoreError(); }
  }
  const identitiesFrom = `FROM ${table.sessions} s JOIN ${table.principals} p ON p.id = s.principal_id
    JOIN ${table.human_accounts} h ON h.principal_id = p.id
    JOIN ${table.password_credentials} c ON c.principal_id = p.id
    JOIN ${table.authorization_state} a ON a.id = 'application'
    JOIN ${table.principals} tp ON tp.id = ?
    JOIN ${table.human_accounts} th ON th.principal_id = tp.id
    JOIN ${table.password_credentials} tc ON tc.principal_id = tp.id`;
  const liveIdentities = `s.secret_hash = ? AND s.id = ? AND p.id = ? AND a.epoch = ? AND s.audience = 'admin'
    AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ${NOW}
    AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
    AND s.auth_version = p.auth_version AND s.account_version = h.version AND s.credential_version = c.version
    AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ${NOW})
    AND tp.id <> p.id AND tp.kind = 'human' AND tp.status = 'active' AND th.status = 'active'
    AND tp.auth_version = ? AND th.version = ? AND tc.version = ?
    AND (tc.expires_at_ms IS NULL OR tc.expires_at_ms > ${NOW})
    AND EXISTS (SELECT 1 FROM ${table.contexts} WHERE id = 'application' AND status = 'active')
    AND EXISTS (SELECT 1 FROM ${table.memberships} WHERE principal_id = p.id
      AND context_id = 'application' AND audience = 'admin' AND status = 'active')
    AND EXISTS (SELECT 1 FROM ${table.contexts} WHERE id = ? AND status = 'active')
    AND EXISTS (SELECT 1 FROM ${table.memberships} WHERE principal_id = tp.id
      AND context_id = ? AND audience = ? AND status = 'active')`;
  const outstanding = `ended_at_ms IS NULL AND expires_at_ms > ${NOW}`;

  async function start(guardValue: LifecycleGuard, inputValue: StartImpersonationInput): Promise<ImpersonationMeta | null> {
    const guard = captureGuard(guardValue), input = captureStart(inputValue);
    if (guard.principalId === input.subjectPrincipalId) return null;
    const id = crypto.randomUUID(), auditId = crypto.randomUUID(), nonce = crypto.randomUUID();
    const owned = `EXISTS (SELECT 1 FROM ${table.access_audit} WHERE id = ? AND claim_nonce = ? AND action = 'impersonation-started')`;
    const args = () => [auditId, nonce];
    const results = await batch([
      statement(`INSERT INTO ${table.access_audit} (id, action, principal_id, session_id, claim_nonce, created_at_ms)
        SELECT ?, 'impersonation-started', p.id, s.id, ?, ${NOW} ${identitiesFrom} WHERE ${liveIdentities}
        AND (SELECT COUNT(*) FROM (SELECT id FROM ${table.impersonations} WHERE ${outstanding}
          LIMIT ${IMPERSONATION_STORE_LIMITS.global})) < ${IMPERSONATION_STORE_LIMITS.global}
        AND (SELECT COUNT(*) FROM (SELECT id FROM ${table.impersonations}
          WHERE source_session_id = s.id AND ${outstanding}
          LIMIT ${IMPERSONATION_STORE_LIMITS.perSourceSession})) < ${IMPERSONATION_STORE_LIMITS.perSourceSession}`,
      [auditId, nonce, input.subjectPrincipalId, guard.sessionDigest, guard.sessionId, guard.principalId, guard.epoch,
        input.subjectAuthVersion, input.subjectAccountVersion, input.subjectCredentialVersion, input.contextId, input.contextId, input.audience]),
      // Use the acquired claim's DB timestamp, not a second admission decision.
      // All effects stay tied to this exact fresh claim, even at a clock boundary.
      statement(`INSERT INTO ${table.impersonations} (id, secret_hash, source_session_id, actor_principal_id,
        subject_principal_id, subject_auth_version, subject_account_version, subject_credential_version,
        context_id, audience, reason, created_at_ms, expires_at_ms, ended_at_ms, revocation_nonce)
        SELECT ?, ?, s.id, p.id, tp.id, tp.auth_version, th.version, tc.version, ?, ?, ?,
          audit.created_at_ms, min(audit.created_at_ms + ?, s.expires_at_ms,
            coalesce(c.expires_at_ms, ${MAX}), coalesce(tc.expires_at_ms, ${MAX})), NULL, NULL
        ${identitiesFrom} JOIN ${table.access_audit} audit ON audit.id = ? AND audit.claim_nonce = ?
        WHERE s.id = ? AND p.id = ? AND ${owned}`,
      [id, input.digest, input.contextId, input.audience, input.reason, input.ttlMs,
        input.subjectPrincipalId, ...args(), guard.sessionId, guard.principalId, ...args()]),
      statement(`INSERT INTO ${table.impersonation_permissions} (impersonation_id, permission_id)
        SELECT ?, value FROM json_each(?) WHERE ${owned}`,
      [id, JSON.stringify(input.permissionIds), ...args()]),
      statement(`UPDATE ${table.access_audit} SET target_principal_id = ?, impersonation_id = ?, context_id = ?, audience = ?
        WHERE id = ? AND claim_nonce = ? AND action = 'impersonation-started'`,
      [input.subjectPrincipalId, id, input.contextId, input.audience, ...args()]),
      statement(`SELECT id, actor_principal_id AS actorPrincipalId, subject_principal_id AS subjectPrincipalId,
        source_session_id AS sourceSessionId, context_id AS contextId, audience, reason,
        created_at_ms AS createdAtMs, expires_at_ms AS expiresAtMs
        FROM ${table.impersonations} WHERE id = ? AND ${owned}`, [id, ...args()]),
    ]);
    const acquired = results[0].meta.changes;
    if ((acquired !== 0 && acquired !== 1) || results[1].meta.changes !== acquired
      || results[2].meta.changes !== acquired * input.permissionIds.length || results[3].meta.changes !== acquired
      || results[4].results.length !== acquired) throw new ImpersonationStoreError();
    if (!acquired) return null;
    const projection = decodeImpersonationMeta(results[4].results[0], input.permissionIds);
    if (!projection || projection.id !== id || projection.actorPrincipalId !== guard.principalId
      || projection.subjectPrincipalId !== input.subjectPrincipalId || projection.sourceSessionId !== guard.sessionId
      || projection.contextId !== input.contextId || projection.audience !== input.audience || projection.reason !== input.reason) throw new ImpersonationStoreError();
    return projection;
  }

  async function stop(tokenDigest: string): Promise<boolean> {
    if (!digest(tokenDigest)) return false;
    const nonce = crypto.randomUUID(), auditId = crypto.randomUUID();
    const results = await batch([
      statement(`UPDATE ${table.impersonations} SET ended_at_ms = ${NOW}, revocation_nonce = ?
        WHERE secret_hash = ? AND ended_at_ms IS NULL AND revocation_nonce IS NULL`, [nonce, tokenDigest]),
      // Historical source references are retained. No live-session/expiry check:
      // possession can only terminate this credential, never recover authority.
      statement(`INSERT INTO ${table.access_audit} (id, action, principal_id, session_id, claim_nonce, created_at_ms,
        target_principal_id, impersonation_id, context_id, audience)
        SELECT ?, 'impersonation-stopped', actor_principal_id, source_session_id, ?, ${NOW},
          subject_principal_id, id, context_id, audience FROM ${table.impersonations}
        WHERE secret_hash = ? AND revocation_nonce = ? AND ended_at_ms IS NOT NULL`, [auditId, nonce, tokenDigest, nonce]),
    ]);
    const changed = results[0].meta.changes;
    if ((changed !== 0 && changed !== 1) || results[1].meta.changes !== changed) throw new ImpersonationStoreError();
    return changed === 1;
  }
  return Object.freeze({ start, stop });
}
