import { ACCESS_TABLES, normalizeLoginIdentifier, type IdentityDatabase } from './d1-store.ts';
import { identityInputFields, normalizeDisplayName, validIdentityId } from './input.ts';
import type { LifecycleGuard } from './lifecycle-store.ts';
import type { SqlStatement } from '../data/authorization.ts';
import {accessAdminCondition, captureAccessAdminGuard, type AccessAdminGuard} from '../authorization/admin-authority.ts';

export interface AdministrativePrincipal {
  readonly id: string;
  readonly kind: 'human' | 'service';
  readonly displayName: string;
  readonly status: 'active' | 'disabled';
  readonly authVersion: number;
  readonly humanStatus: 'active' | 'pending' | 'disabled' | null;
  readonly loginIdentifier: string | null;
  readonly createdAtMs: number;
}
export interface AdministrativeSession {
  readonly id: string;
  readonly audience: 'admin' | 'app';
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly revokedAtMs: number | null;
  readonly active: boolean;
}
export interface AdministrationPage<T> { readonly items: readonly T[]; readonly nextAfterId: string | null }
export interface PrincipalPageInput { readonly afterId: string | null; readonly limit: number; readonly kind: 'human' | 'service' | 'all' }
export interface SessionPageInput { readonly principalId: string; readonly afterId: string | null; readonly limit: number }
export interface HumanVersionInput { readonly principalId: string; readonly expectedAuthVersion: number }
export interface HumanStatusInput extends HumanVersionInput { readonly status: 'active' | 'disabled' }

export const ADMINISTRATION_STORE_LIMITS = Object.freeze({ maximumPageSize: 50, sessionMarkers: 32, capabilityMarkers: 8 });
export class AdministrationStoreInputError extends Error {
  constructor() { super('Invalid account administration store input.'); this.name = 'AdministrationStoreInputError'; }
}
export class AdministrationStoreError extends Error {
  constructor() { super('Account administration storage operation failed.'); this.name = 'AdministrationStoreError'; }
}
const table = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const MAX = Number.MAX_SAFE_INTEGER;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
type AdminGuardInput = LifecycleGuard | AccessAdminGuard;
const principalStatus = (value: unknown): value is AdministrativePrincipal['status'] => value === 'active' || value === 'disabled';
const validPage = (limit: unknown, afterId: unknown) => positive(limit) && limit <= ADMINISTRATION_STORE_LIMITS.maximumPageSize
  && (afterId === null || validIdentityId(afterId));
function captureGuard(value: unknown): AccessAdminGuard {
  try { return captureAccessAdminGuard(value); }
  catch { throw new AdministrationStoreInputError(); }
}
function principalRow(row: Record<string, unknown>): AdministrativePrincipal {
  const name = normalizeDisplayName(row.displayName);
  if (!validIdentityId(row.id) || !name || name !== row.displayName || !principalStatus(row.status)
    || !positive(row.authVersion) || !instant(row.createdAtMs)) throw new AdministrationStoreError();
  if (row.kind === 'human') {
    if ((row.humanStatus !== 'active' && row.humanStatus !== 'pending' && row.humanStatus !== 'disabled')
      || !normalizeLoginIdentifier(row.loginIdentifier) || normalizeLoginIdentifier(row.loginIdentifier) !== row.loginIdentifier) throw new AdministrationStoreError();
  } else if (row.kind !== 'service' || row.humanStatus !== null || row.loginIdentifier !== null) throw new AdministrationStoreError();
  return Object.freeze({ id: row.id, kind: row.kind, displayName: name, status: row.status,
    authVersion: row.authVersion, humanStatus: row.humanStatus as AdministrativePrincipal['humanStatus'],
    loginIdentifier: row.loginIdentifier as string | null, createdAtMs: row.createdAtMs });
}
function sessionRow(row: Record<string, unknown>): AdministrativeSession {
  if (!validIdentityId(row.id) || (row.audience !== 'admin' && row.audience !== 'app')
    || !instant(row.createdAtMs) || !instant(row.expiresAtMs)
    || (row.revokedAtMs !== null && !instant(row.revokedAtMs)) || (row.active !== 0 && row.active !== 1)) throw new AdministrationStoreError();
  return Object.freeze({ id: row.id, audience: row.audience, createdAtMs: row.createdAtMs,
    expiresAtMs: row.expiresAtMs, revokedAtMs: row.revokedAtMs, active: row.active === 1 });
}

/**
 * Trusted persistence behind a current human manage(application/admin) decision.
 * Pages recheck the same administrative guard in one coherent batch. Writes use
 * an exact fresh audit claim: revoking the caller's own session cannot interrupt
 * already acquired effects. No deletion, ACL edit or human activation occurs.
 */
export function createD1AccountAdministrationStore(db: IdentityDatabase) {
  const statement = (sql: string, values: (string | number | null)[] = []) => {
    try { return db.prepare(sql).bind(...values); } catch { throw new AdministrationStoreError(); }
  };
  const planned = (sql: string, bindings: (string | number | null)[] = []): SqlStatement => ({sql, bindings});
  async function batch(statements: D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[]> {
    try {
      const results = await db.batch<Record<string, unknown>>(statements);
      if (results.length !== statements.length || results.some(r => r.success !== true || !Array.isArray(r.results))) throw new AdministrationStoreError();
      return results;
    } catch { throw new AdministrationStoreError(); }
  }
  const execute = (plans: readonly SqlStatement[]) => batch(plans.map(item => statement(item.sql, [...item.bindings])));
  const principalColumns = `tp.id, tp.kind, tp.display_name AS displayName, tp.status, tp.auth_version AS authVersion,
    th.status AS humanStatus, th.login_identifier AS loginIdentifier, tp.created_at_ms AS createdAtMs`;
  const principalFrom = `FROM ${table.principals} tp LEFT JOIN ${table.human_accounts} th ON th.principal_id = tp.id`;
  function pageResult<T extends { readonly id: string }>(results: D1Result<Record<string, unknown>>[], limit: number,
    afterId: string | null, decode: (row: Record<string, unknown>) => T): AdministrationPage<T> | null {
    if (results[0].results.length === 0) return null;
    if (results[0].results.length !== 1 || results[0].results[0].allowed !== 1 || results[1].results.length > limit + 1) throw new AdministrationStoreError();
    const rows = results[1].results.map(decode);
    let previous = afterId;
    for (const row of rows) {
      if (previous !== null && row.id <= previous) throw new AdministrationStoreError();
      previous = row.id;
    }
    const items = Object.freeze(rows.slice(0, limit));
    return Object.freeze({ items, nextAfterId: rows.length > limit ? items.at(-1)!.id : null });
  }
  async function listPrincipals(guardValue: AdminGuardInput, input: PrincipalPageInput): Promise<AdministrationPage<AdministrativePrincipal> | null> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['afterId', 'limit', 'kind']) || !validPage(input.limit, input.afterId)
      || (input.kind !== 'human' && input.kind !== 'service' && input.kind !== 'all')) throw new AdministrationStoreInputError();
    const { afterId, limit, kind } = input;
    // Separate fixed branches preserve the (kind,id) or primary-key range scan.
    const predicate = kind === 'all' ? 'tp.id > ?' : 'tp.kind = ? AND tp.id > ?';
    const filters = kind === 'all' ? [afterId ?? ''] : [kind, afterId ?? ''];
    const authority = accessAdminCondition(guard);
    const results = await batch([
      statement(`SELECT 1 AS allowed WHERE ${authority.sql} LIMIT 2`, [...authority.bindings]),
      statement(`SELECT ${principalColumns} ${principalFrom} WHERE ${predicate} AND ${authority.sql}
        ORDER BY tp.id COLLATE BINARY LIMIT ?`, [...filters, ...authority.bindings, limit + 1]),
    ]);
    return pageResult(results, limit, afterId, principalRow);
  }
  async function listSessions(guardValue: AdminGuardInput, input: SessionPageInput): Promise<AdministrationPage<AdministrativeSession> | null> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['principalId', 'afterId', 'limit']) || !validIdentityId(input.principalId)
      || !validPage(input.limit, input.afterId)) throw new AdministrationStoreInputError();
    const { principalId, afterId, limit } = input;
    const authority = accessAdminCondition(guard);
    const results = await batch([
      statement(`SELECT 1 AS allowed WHERE ${authority.sql}
        AND EXISTS (SELECT 1 ${principalFrom} WHERE tp.id = ? AND tp.kind = 'human' AND th.principal_id IS NOT NULL) LIMIT 2`,
      [...authority.bindings, principalId]),
      statement(`SELECT ts.id, ts.audience, ts.created_at_ms AS createdAtMs, ts.expires_at_ms AS expiresAtMs,
        ts.revoked_at_ms AS revokedAtMs, CASE WHEN tp.status = 'active' AND th.status = 'active'
          AND ts.revoked_at_ms IS NULL AND ts.expires_at_ms > ${NOW}
          AND ts.auth_version = tp.auth_version AND ts.account_version = th.version AND ts.credential_version = tc.version
          AND (tc.expires_at_ms IS NULL OR tc.expires_at_ms > ${NOW}) THEN 1 ELSE 0 END AS active
        FROM ${table.sessions} ts JOIN ${table.principals} tp ON tp.id = ts.principal_id
        JOIN ${table.human_accounts} th ON th.principal_id = tp.id
        LEFT JOIN ${table.password_credentials} tc ON tc.principal_id = tp.id
        WHERE tp.id = ? AND tp.kind = 'human' AND ts.id > ? AND ${authority.sql}
        ORDER BY ts.id COLLATE BINARY LIMIT ?`, [principalId, afterId ?? '', ...authority.bindings, limit + 1]),
    ]);
    return pageResult(results, limit, afterId, sessionRow);
  }

  type Action = 'human-status-updated' | 'human-sessions-revoked' | 'human-session-revoked';
  function acquire(guard: AccessAdminGuard, action: Action, extra: string, values: (string | number)[],
    auditId:string=crypto.randomUUID()) {
    const nonce = crypto.randomUUID();
    const authority = accessAdminCondition(guard);
    const exists = `EXISTS (SELECT 1 FROM ${table.access_audit} WHERE id = ? AND claim_nonce = ? AND action = ?)`;
    const args = () => [auditId, nonce, action];
    return { auditId, nonce, exists, args, query: planned(`INSERT INTO ${table.access_audit}
      (id, action, principal_id, session_id, credential_id, context_id, audience,
        claim_nonce, created_at_ms, target_principal_id, target_session_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}, NULL, NULL WHERE ${authority.sql} AND (${extra})`,
    [auditId, action, guard.principalId, guard.kind === 'session' ? guard.sessionId : null,
      guard.kind === 'oauth' ? guard.credentialId : null,
      guard.kind === 'oauth' ? 'application' : null, guard.kind === 'oauth' ? 'admin' : null,
      nonce, ...authority.bindings, ...values]) };
  }
  type Claim = ReturnType<typeof acquire>;
  const recordTarget = (claim: Claim, principalId: string, sessionId: string | null = null) => planned(
    `UPDATE ${table.access_audit} SET target_principal_id = ?, target_session_id = ? WHERE id = ? AND claim_nonce = ?`,
    [principalId, sessionId, claim.auditId, claim.nonce]);
  function targetVersion(value: unknown): HumanVersionInput {
    if (!identityInputFields(value, ['principalId', 'expectedAuthVersion']) || !validIdentityId(value.principalId)
      || !positive(value.expectedAuthVersion) || value.expectedAuthVersion >= MAX) throw new AdministrationStoreInputError();
    return Object.freeze({ principalId: value.principalId, expectedAuthVersion: value.expectedAuthVersion });
  }
  const humanTarget = `EXISTS (SELECT 1 ${principalFrom} WHERE tp.id = ? AND tp.kind = 'human'
    AND th.principal_id IS NOT NULL AND tp.auth_version = ?)`;
  function markers(claim: Claim, target: HumanVersionInput): SqlStatement[] {
    // The version change invalidates ALL old sessions and capabilities. These
    // physical markers intentionally leave historical/expired rows untouched.
    return [planned(`UPDATE ${table.sessions} SET revoked_at_ms = ${NOW}, revocation_nonce = ?
      WHERE id IN (SELECT id FROM ${table.sessions} WHERE principal_id = ? AND auth_version = ?
        AND revoked_at_ms IS NULL AND expires_at_ms > ${NOW} LIMIT ${ADMINISTRATION_STORE_LIMITS.sessionMarkers}) AND ${claim.exists}`,
    [claim.nonce, target.principalId, target.expectedAuthVersion, ...claim.args()]),
    planned(`UPDATE ${table.account_capabilities} SET revoked_at_ms = ${NOW}
      WHERE id IN (SELECT id FROM ${table.account_capabilities} WHERE principal_id = ? AND auth_version = ?
        AND revoked_at_ms IS NULL AND consumed_at_ms IS NULL AND expires_at_ms > ${NOW}
        LIMIT ${ADMINISTRATION_STORE_LIMITS.capabilityMarkers}) AND ${claim.exists}`,
    [target.principalId, target.expectedAuthVersion, ...claim.args()])];
  }
  function didAcquire(results: D1Result<Record<string, unknown>>[]): boolean {
    const count = results[0].meta.changes;
    if (count !== 0 && count !== 1) throw new AdministrationStoreError();
    return count === 1;
  }
  function prepareSetHumanStatus(guardValue: AdminGuardInput, input: HumanStatusInput,
    auditId?:string) {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['principalId', 'expectedAuthVersion', 'status']) || !principalStatus(input.status)) throw new AdministrationStoreInputError();
    const target = targetVersion({ principalId: input.principalId, expectedAuthVersion: input.expectedAuthVersion }), nextStatus = input.status;
    if (nextStatus === 'disabled' && target.principalId === guard.principalId) return null;
    const claim = acquire(guard, 'human-status-updated', `${humanTarget}
      AND EXISTS (SELECT 1 FROM ${table.principals} WHERE id = ? AND status <> ?)
      AND (? <> 'disabled' OR ? <> ?)`,
    [target.principalId, target.expectedAuthVersion, target.principalId, nextStatus, nextStatus,
      guard.principalId, target.principalId],auditId);
    const statements: SqlStatement[] = [
      claim.query,
      planned(`UPDATE ${table.principals} SET status = ?, auth_version = auth_version + 1, updated_at_ms = ${NOW}
        WHERE id = ? AND ${claim.exists}`, [nextStatus, target.principalId, ...claim.args()]),
      ...markers(claim, target), recordTarget(claim, target.principalId),
      planned(`SELECT ${principalColumns} ${principalFrom} WHERE tp.id = ? AND ${claim.exists}`, [target.principalId, ...claim.args()]),
    ];
    return Object.freeze({auditId:claim.auditId,statements: Object.freeze(statements),
      assertion: planned(`SELECT CASE WHEN ${claim.exists} THEN 1 ELSE json('creezio_access_admin_conflict') END AS accepted`, claim.args()),
      output: Object.freeze({principalId: target.principalId, status: nextStatus, authVersion: target.expectedAuthVersion + 1})});
  }
  async function commitPreparedSetHumanStatus(plan:NonNullable<ReturnType<typeof prepareSetHumanStatus>>): Promise<AdministrativePrincipal | null> {
    if (!plan) return null;
    const results = await execute(plan.statements);
    if (!didAcquire(results)) return null;
    if (results.at(-1)!.results.length !== 1) throw new AdministrationStoreError();
    return principalRow(results.at(-1)!.results[0]);
  }
  async function setHumanStatus(guardValue: AdminGuardInput, input: HumanStatusInput): Promise<AdministrativePrincipal | null> {
    const plan = prepareSetHumanStatus(guardValue, input);
    return plan?commitPreparedSetHumanStatus(plan):null;
  }
  async function readPrincipal(principalId:string):Promise<AdministrativePrincipal|null>{
    if(!validIdentityId(principalId))throw new AdministrationStoreInputError();
    const rows=await batch([statement(`SELECT ${principalColumns} ${principalFrom} WHERE tp.id=? LIMIT 2`,[principalId])]);
    if(rows[0].results.length>1)throw new AdministrationStoreError();
    return rows[0].results.length?principalRow(rows[0].results[0]):null;
  }
  function prepareRevokeAllHumanSessions(guardValue: AdminGuardInput, input: HumanVersionInput,
    auditId?:string) {
    const guard = captureGuard(guardValue), target = targetVersion(input);
    const claim = acquire(guard, 'human-sessions-revoked', humanTarget,
      [target.principalId, target.expectedAuthVersion],auditId);
    const statements: SqlStatement[] = [
      claim.query,
      planned(`UPDATE ${table.principals} SET auth_version = auth_version + 1, updated_at_ms = ${NOW}
        WHERE id = ? AND ${claim.exists}`, [target.principalId, ...claim.args()]),
      ...markers(claim, target), recordTarget(claim, target.principalId),
      planned(`SELECT id AS principalId, auth_version AS authVersion FROM ${table.principals}
        WHERE id = ? AND ${claim.exists}`, [target.principalId, ...claim.args()]),
    ];
    return Object.freeze({auditId:claim.auditId,statements: Object.freeze(statements),
      assertion: planned(`SELECT CASE WHEN ${claim.exists} THEN 1 ELSE json('creezio_access_admin_conflict') END AS accepted`, claim.args()),
      output: Object.freeze({principalId: target.principalId, authVersion: target.expectedAuthVersion + 1})});
  }
  async function commitPreparedRevokeAllHumanSessions(plan:ReturnType<typeof prepareRevokeAllHumanSessions>): Promise<{
    readonly principalId: string; readonly authVersion: number;
  } | null> {
    const results = await execute(plan.statements);
    if (!didAcquire(results)) return null;
    const rows = results.at(-1)!.results;
    if (rows.length !== 1 || rows[0].principalId !== plan.output.principalId || rows[0].authVersion !== plan.output.authVersion) throw new AdministrationStoreError();
    return plan.output;
  }
  async function revokeAllHumanSessions(guardValue: AdminGuardInput, input: HumanVersionInput): Promise<{
    readonly principalId: string; readonly authVersion: number;
  } | null> {
    return commitPreparedRevokeAllHumanSessions(prepareRevokeAllHumanSessions(guardValue,input));
  }
  function prepareRevokeSessionById(guardValue: AdminGuardInput, input: { readonly sessionId: string },
    auditId?:string) {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['sessionId']) || !validIdentityId(input.sessionId)) throw new AdministrationStoreInputError();
    const sessionId = input.sessionId;
    const claim = acquire(guard, 'human-session-revoked', `EXISTS (SELECT 1 FROM ${table.sessions} ts
      JOIN ${table.principals} tp ON tp.id = ts.principal_id JOIN ${table.human_accounts} th ON th.principal_id = tp.id
      WHERE ts.id = ? AND tp.kind = 'human' AND ts.revoked_at_ms IS NULL)`, [sessionId],auditId);
    const statements: SqlStatement[] = [
      claim.query,
      planned(`UPDATE ${table.sessions} SET revoked_at_ms = ${NOW}, revocation_nonce = ?
        WHERE id = ? AND ${claim.exists}`, [claim.nonce, sessionId, ...claim.args()]),
      planned(`UPDATE ${table.access_audit} SET target_principal_id =
        (SELECT principal_id FROM ${table.sessions} WHERE id = ?), target_session_id = ?
        WHERE id = ? AND claim_nonce = ?`, [sessionId, sessionId, claim.auditId, claim.nonce]),
    ];
    return Object.freeze({auditId:claim.auditId,statements: Object.freeze(statements),
      assertion: planned(`SELECT CASE WHEN ${claim.exists} THEN 1 ELSE json('creezio_access_admin_conflict') END AS accepted`, claim.args()),
      output: Object.freeze({sessionId, revoked: true as const})});
  }
  async function commitPreparedRevokeSessionById(plan:ReturnType<typeof prepareRevokeSessionById>): Promise<boolean> {
    const results = await execute(plan.statements);
    const acquired = didAcquire(results);
    if (results[1].meta.changes !== Number(acquired) || results[2].meta.changes !== Number(acquired)) throw new AdministrationStoreError();
    return acquired;
  }
  async function revokeSessionById(guardValue: AdminGuardInput, input: { readonly sessionId: string }): Promise<boolean> {
    return commitPreparedRevokeSessionById(prepareRevokeSessionById(guardValue,input));
  }
  return Object.freeze({ listPrincipals, listSessions, setHumanStatus, revokeAllHumanSessions, revokeSessionById,
    prepareSetHumanStatus, prepareRevokeAllHumanSessions, prepareRevokeSessionById,
    commitPreparedSetHumanStatus,commitPreparedRevokeAllHumanSessions,commitPreparedRevokeSessionById,
    readPrincipal });
}
