import { ACCESS_TABLES, normalizeLoginIdentifier, type IdentityDatabase } from './d1-store.ts';
import { isApprovedPasswordRecord } from './password.ts';
import { ACCESS_POLICY_LIMITS } from '../authorization/policy.ts';

export type AccountCapabilityPurpose = 'invitation' | 'activation' | 'password-reset';
export interface LifecycleGuard {
  readonly sessionDigest: string;
  readonly sessionId: string;
  readonly principalId: string;
  readonly epoch: number;
}
export interface IssuedAccountCapability {
  readonly principalId: string;
  readonly capabilityId: string;
  readonly expiresAtMs: number;
}
export interface AvailableAccountCapability extends IssuedAccountCapability {
  readonly purpose: AccountCapabilityPurpose;
}
export interface InvitationInput {
  readonly digest: string;
  readonly loginIdentifier: string;
  readonly displayName: string;
  readonly ttlMs: number;
}
export interface CapabilityInput {
  readonly purpose: 'activation' | 'password-reset';
  readonly digest: string;
  readonly principalId: string;
  readonly ttlMs: number;
}
export interface ConsumeCapabilityInput {
  readonly digest: string;
  readonly purpose: AccountCapabilityPurpose;
  readonly passwordRecord: string;
}

export const LIFECYCLE_STORE_LIMITS = Object.freeze({
  minimumCapabilityTtlMs: 1000, maximumCapabilityTtlMs: 7 * 24 * 60 * 60 * 1000,
  maximumPasswordResetTtlMs: 60 * 60 * 1000,
  maximumPrincipals: ACCESS_POLICY_LIMITS.principals,
  maximumOutstandingCapabilities: 512, maximumOutstandingPerPrincipal: 8,
  sessionRevocationBatchSize: 32,
});
export class LifecycleStoreInputError extends Error {
  constructor() { super('Invalid account lifecycle store input.'); this.name = 'LifecycleStoreInputError'; }
}
export class LifecycleStoreError extends Error {
  constructor() { super('Account lifecycle storage operation failed.'); this.name = 'LifecycleStoreError'; }
}

const table = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const MAX = Number.MAX_SAFE_INTEGER;
const digest = (v: unknown): v is string => typeof v === 'string' && v.length === 71 && /^sha256:[a-f0-9]{64}$/.test(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && v.length <= 128
  && v.match(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)?.[0] === v;
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const purpose = (v: unknown): v is AccountCapabilityPurpose => v === 'invitation' || v === 'activation' || v === 'password-reset';
function shape(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length
      && keys.every(key => Object.hasOwn(descriptors, key) && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'));
  } catch { return false; }
}
function captureGuard(value: unknown): LifecycleGuard {
  if (!shape(value, ['sessionDigest', 'sessionId', 'principalId', 'epoch']) || !digest(value.sessionDigest)
    || !identifier(value.sessionId) || !identifier(value.principalId) || !positive(value.epoch)) throw new LifecycleStoreInputError();
  return Object.freeze({ sessionDigest: value.sessionDigest, sessionId: value.sessionId,
    principalId: value.principalId, epoch: value.epoch });
}
function validTtl(value: unknown, requestedPurpose: AccountCapabilityPurpose): value is number {
  return Number.isSafeInteger(value) && Number(value) >= LIFECYCLE_STORE_LIMITS.minimumCapabilityTtlMs
    && Number(value) <= (requestedPurpose === 'password-reset'
      ? LIFECYCLE_STORE_LIMITS.maximumPasswordResetTtlMs : LIFECYCLE_STORE_LIMITS.maximumCapabilityTtlMs);
}
function validName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.isWellFormed()
    && [...value].length <= 120 && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Trusted internal persistence, never a public capability provisioning endpoint.
 * The server service must resolve current manage(application/admin) permission
 * before supplying a guard. Here session/epoch are rechecked at the write.
 * Consuming an explicitly issued capability changes identity only, never ACLs.
 * No token delivery, clear secret/password, KDF, schema creation or HTTP occurs.
 */
export function createD1AccountLifecycleStore(db: IdentityDatabase) {
  const statement = (sql: string, values: (string | number | null)[] = []) => {
    try { return db.prepare(sql).bind(...values); } catch { throw new LifecycleStoreError(); }
  };
  async function batch(statements: D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[]> {
    try {
      const results = await db.batch<Record<string, unknown>>(statements);
      if (results.length !== statements.length || results.some(r => r.success !== true || !Array.isArray(r.results))) throw new LifecycleStoreError();
      return results;
    } catch { throw new LifecycleStoreError(); }
  }
  const adminFrom = `FROM ${table.sessions} s JOIN ${table.principals} p ON p.id = s.principal_id
    JOIN ${table.human_accounts} h ON h.principal_id = p.id
    JOIN ${table.password_credentials} c ON c.principal_id = p.id
    JOIN ${table.authorization_state} a ON a.id = 'application'`;
  const liveAdmin = `s.secret_hash = ? AND s.id = ? AND p.id = ? AND a.epoch = ? AND s.audience = 'admin'
    AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ${NOW}
    AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
    AND s.auth_version = p.auth_version AND s.account_version = h.version AND s.credential_version = c.version
    AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ${NOW})
    AND EXISTS (SELECT 1 FROM ${table.contexts} WHERE id = 'application' AND status = 'active')
    AND EXISTS (SELECT 1 FROM ${table.memberships} WHERE principal_id = p.id
      AND context_id = 'application' AND audience = 'admin' AND status = 'active')`;
  const pending = `consumed_at_ms IS NULL AND revoked_at_ms IS NULL AND expires_at_ms > ${NOW}`;
  const roomGlobal = `(SELECT COUNT(*) FROM (SELECT id FROM ${table.account_capabilities}
    WHERE ${pending} LIMIT ${LIFECYCLE_STORE_LIMITS.maximumOutstandingCapabilities})) < ${LIFECYCLE_STORE_LIMITS.maximumOutstandingCapabilities}`;
  const roomPrincipal = `(SELECT COUNT(*) FROM (SELECT id FROM ${table.principals}
    LIMIT ${LIFECYCLE_STORE_LIMITS.maximumPrincipals})) < ${LIFECYCLE_STORE_LIMITS.maximumPrincipals}`;
  const roomTarget = `(SELECT COUNT(*) FROM (SELECT id FROM ${table.account_capabilities}
    WHERE principal_id = ? AND ${pending} LIMIT ${LIFECYCLE_STORE_LIMITS.maximumOutstandingPerPrincipal})) < ${LIFECYCLE_STORE_LIMITS.maximumOutstandingPerPrincipal}`;
  const targetFrom = `FROM ${table.principals} tp JOIN ${table.human_accounts} th ON th.principal_id = tp.id
    LEFT JOIN ${table.password_credentials} tc ON tc.principal_id = tp.id`;
  const pendingTarget = `tp.kind = 'human' AND tp.status = 'active' AND th.status = 'pending' AND tc.principal_id IS NULL`;
  // An expired password credential can be recovered; the recovery capability's
  // own expiry and the captured identity versions remain mandatory.
  const resetTarget = `tp.kind = 'human' AND tp.status = 'active' AND th.status = 'active' AND tc.principal_id IS NOT NULL`;
  const targetVersions = `tp.auth_version = k.auth_version AND th.version = k.account_version
    AND tp.auth_version < ${MAX} AND th.version < ${MAX}
    AND ((k.purpose IN ('invitation', 'activation') AND ${pendingTarget} AND k.credential_version IS NULL)
      OR (k.purpose = 'password-reset' AND ${resetTarget} AND tc.version = k.credential_version AND tc.version < ${MAX}))`;
  const available = `k.secret_hash = ? AND k.purpose = ? AND k.claim_nonce IS NULL
    AND k.consumed_at_ms IS NULL AND k.revoked_at_ms IS NULL AND k.expires_at_ms > ${NOW}
    AND EXISTS (SELECT 1 ${targetFrom} WHERE tp.id = k.principal_id AND ${targetVersions})`;

  function acquire(guard: LifecycleGuard, action: 'capability-issued' | 'capability-revoked', extra: string, values: (string | number)[]) {
    const auditId = crypto.randomUUID(), nonce = crypto.randomUUID();
    const claimExists = `EXISTS (SELECT 1 FROM ${table.access_audit} WHERE id = ? AND claim_nonce = ? AND action = ?)`;
    const args = () => [auditId, nonce, action];
    return { auditId, nonce, claimExists, args, query: statement(`INSERT INTO ${table.access_audit}
      (id, action, principal_id, session_id, claim_nonce, created_at_ms, target_principal_id, capability_id)
      SELECT ?, ?, p.id, s.id, ?, ${NOW}, NULL, NULL ${adminFrom} WHERE ${liveAdmin} AND (${extra})`,
    [auditId, action, nonce, guard.sessionDigest, guard.sessionId, guard.principalId, guard.epoch, ...values]) };
  }
  function issued(results: D1Result<Record<string, unknown>>[]): IssuedAccountCapability | null {
    if (results[0].meta.changes === 0) return null;
    if (results[0].meta.changes !== 1 || results.at(-1)!.results.length !== 1) throw new LifecycleStoreError();
    const row = results.at(-1)!.results[0];
    if (!identifier(row.principalId) || !identifier(row.capabilityId) || !positive(row.expiresAtMs)) throw new LifecycleStoreError();
    return Object.freeze({ principalId: row.principalId, capabilityId: row.capabilityId, expiresAtMs: row.expiresAtMs });
  }

  async function issueInvitation(guardValue: LifecycleGuard, input: InvitationInput): Promise<IssuedAccountCapability | null> {
    const guard = captureGuard(guardValue);
    if (!shape(input, ['digest', 'loginIdentifier', 'displayName', 'ttlMs']) || !digest(input.digest)
      || !validName(input.displayName) || !validTtl(input.ttlMs, 'invitation')) throw new LifecycleStoreInputError();
    const login = normalizeLoginIdentifier(input.loginIdentifier);
    if (!login) throw new LifecycleStoreInputError();
    const { digest: capabilityDigest, displayName, ttlMs } = input;
    const principalId = crypto.randomUUID(), capabilityId = crypto.randomUUID();
    const claim = acquire(guard, 'capability-issued', `${roomPrincipal} AND ${roomGlobal}
      AND NOT EXISTS (SELECT 1 FROM ${table.human_accounts} WHERE login_identifier = ?)`, [login]);
    return issued(await batch([
      claim.query,
      statement(`INSERT INTO ${table.principals} (id, kind, status, auth_version, display_name, created_at_ms, updated_at_ms)
        SELECT ?, 'human', 'active', 1, ?, ${NOW}, ${NOW} WHERE ${claim.claimExists}`, [principalId, displayName, ...claim.args()]),
      statement(`INSERT INTO ${table.human_accounts} (principal_id, login_identifier, status, version, created_at_ms, updated_at_ms)
        SELECT ?, ?, 'pending', 1, ${NOW}, ${NOW} WHERE ${claim.claimExists}`, [principalId, login, ...claim.args()]),
      statement(`INSERT INTO ${table.account_capabilities} (id, secret_hash, purpose, principal_id,
        auth_version, account_version, credential_version, created_at_ms, expires_at_ms, consumed_at_ms, revoked_at_ms, claim_nonce)
        SELECT ?, ?, 'invitation', ?, 1, 1, NULL, ${NOW}, ${NOW} + ?, NULL, NULL, NULL WHERE ${claim.claimExists}`,
      [capabilityId, capabilityDigest, principalId, ttlMs, ...claim.args()]),
      statement(`UPDATE ${table.access_audit} SET target_principal_id = ?, capability_id = ?
        WHERE id = ? AND claim_nonce = ?`, [principalId, capabilityId, claim.auditId, claim.nonce]),
      statement(`SELECT principal_id AS principalId, id AS capabilityId, expires_at_ms AS expiresAtMs
        FROM ${table.account_capabilities} WHERE id = ? AND ${claim.claimExists}`, [capabilityId, ...claim.args()]),
    ]));
  }

  async function issueCapability(guardValue: LifecycleGuard, input: CapabilityInput): Promise<IssuedAccountCapability | null> {
    const guard = captureGuard(guardValue);
    if (!shape(input, ['purpose', 'digest', 'principalId', 'ttlMs']) || (input.purpose !== 'activation' && input.purpose !== 'password-reset')
      || !digest(input.digest) || !identifier(input.principalId) || !validTtl(input.ttlMs, input.purpose)) throw new LifecycleStoreInputError();
    const { purpose: requestedPurpose, digest: capabilityDigest, principalId, ttlMs } = input;
    const capabilityId = crypto.randomUUID();
    const target = requestedPurpose === 'activation' ? pendingTarget : resetTarget;
    const targetCondition = `${target} AND tp.auth_version < ${MAX} AND th.version < ${MAX}
      AND (tc.version IS NULL OR tc.version < ${MAX})`;
    const claim = acquire(guard, 'capability-issued', `${roomGlobal} AND ${roomTarget}
      AND EXISTS (SELECT 1 ${targetFrom} WHERE tp.id = ? AND ${targetCondition})`, [principalId, principalId]);
    return issued(await batch([
      claim.query,
      statement(`INSERT INTO ${table.account_capabilities} (id, secret_hash, purpose, principal_id,
        auth_version, account_version, credential_version, created_at_ms, expires_at_ms, consumed_at_ms, revoked_at_ms, claim_nonce)
        SELECT ?, ?, ?, tp.id, tp.auth_version, th.version, tc.version, ${NOW}, ${NOW} + ?, NULL, NULL, NULL
        ${targetFrom} WHERE tp.id = ? AND ${targetCondition} AND ${claim.claimExists}`,
      [capabilityId, capabilityDigest, requestedPurpose, ttlMs, principalId, ...claim.args()]),
      statement(`UPDATE ${table.access_audit} SET target_principal_id = ?, capability_id = ?
        WHERE id = ? AND claim_nonce = ?`, [principalId, capabilityId, claim.auditId, claim.nonce]),
      statement(`SELECT principal_id AS principalId, id AS capabilityId, expires_at_ms AS expiresAtMs
        FROM ${table.account_capabilities} WHERE id = ? AND ${claim.claimExists}`, [capabilityId, ...claim.args()]),
    ]));
  }

  async function readCapability(capabilityDigest: string, requestedPurpose: AccountCapabilityPurpose): Promise<AvailableAccountCapability | null> {
    if (!digest(capabilityDigest) || !purpose(requestedPurpose)) return null;
    const result = await batch([statement(`SELECT k.id AS capabilityId, k.principal_id AS principalId,
      k.purpose, k.expires_at_ms AS expiresAtMs FROM ${table.account_capabilities} k WHERE ${available} LIMIT 2`,
    [capabilityDigest, requestedPurpose])]);
    const rows = result[0].results;
    if (rows.length === 0) return null;
    if (rows.length !== 1 || !identifier(rows[0].capabilityId) || !identifier(rows[0].principalId)
      || rows[0].purpose !== requestedPurpose || !positive(rows[0].expiresAtMs)) throw new LifecycleStoreError();
    return Object.freeze({ capabilityId: rows[0].capabilityId, principalId: rows[0].principalId,
      purpose: requestedPurpose, expiresAtMs: rows[0].expiresAtMs });
  }

  async function consumeCapability(input: ConsumeCapabilityInput): Promise<{ readonly principalId: string } | null> {
    if (!shape(input, ['digest', 'purpose', 'passwordRecord']) || !digest(input.digest)
      || !purpose(input.purpose) || !isApprovedPasswordRecord(input.passwordRecord)) throw new LifecycleStoreInputError();
    const { digest: capabilityDigest, purpose: requestedPurpose, passwordRecord } = input;
    const nonce = crypto.randomUUID(), auditId = crypto.randomUUID();
    const owned = `k.claim_nonce = ? AND k.secret_hash = ? AND k.purpose = ? AND k.consumed_at_ms IS NOT NULL`;
    const args = () => [nonce, capabilityDigest, requestedPurpose];
    const owner = `SELECT k.principal_id FROM ${table.account_capabilities} k WHERE ${owned}`;
    const results = await batch([
      statement(`UPDATE ${table.account_capabilities} AS k SET claim_nonce = ?, consumed_at_ms = ${NOW}
        WHERE ${available}`, [nonce, capabilityDigest, requestedPurpose]),
      requestedPurpose === 'password-reset'
        ? statement(`UPDATE ${table.password_credentials} SET password_record = ?, version = version + 1,
          expires_at_ms = NULL, updated_at_ms = ${NOW} WHERE principal_id IN (${owner})`, [passwordRecord, ...args()])
        : statement(`INSERT INTO ${table.password_credentials}
          (principal_id, password_record, version, expires_at_ms, created_at_ms, updated_at_ms)
          SELECT k.principal_id, ?, 1, NULL, ${NOW}, ${NOW} FROM ${table.account_capabilities} k WHERE ${owned}`,
        [passwordRecord, ...args()]),
      statement(`UPDATE ${table.human_accounts} SET status = 'active', version = version + 1,
        updated_at_ms = ${NOW} WHERE principal_id IN (${owner})`, args()),
      statement(`UPDATE ${table.principals} SET auth_version = auth_version + 1,
        updated_at_ms = ${NOW} WHERE id IN (${owner})`, args()),
      // Versions invalidate EVERY prior session/capability. Physical markers
      // are bounded maintenance, not the source of that universal revocation.
      // Expired historical rows remain untouched and are already unusable.
      statement(`UPDATE ${table.sessions} SET revoked_at_ms = ${NOW}, revocation_nonce = ?
        WHERE id IN (SELECT id FROM ${table.sessions} WHERE principal_id IN (${owner})
          AND revoked_at_ms IS NULL AND expires_at_ms > ${NOW} LIMIT ${LIFECYCLE_STORE_LIMITS.sessionRevocationBatchSize})`, [nonce, ...args()]),
      statement(`UPDATE ${table.account_capabilities} SET revoked_at_ms = ${NOW}
        WHERE id IN (SELECT id FROM ${table.account_capabilities} WHERE principal_id IN (${owner})
          AND claim_nonce IS NULL AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL AND expires_at_ms > ${NOW}
          LIMIT ${LIFECYCLE_STORE_LIMITS.maximumOutstandingPerPrincipal})`, args()),
      statement(`INSERT INTO ${table.access_audit}
        (id, action, principal_id, session_id, claim_nonce, created_at_ms, target_principal_id, capability_id)
        SELECT ?, ?, k.principal_id, NULL, ?, ${NOW}, k.principal_id, k.id
        FROM ${table.account_capabilities} k WHERE ${owned}`,
      [auditId, requestedPurpose === 'password-reset' ? 'password-reset' : 'account-activated', nonce, ...args()]),
      statement(`SELECT k.principal_id AS principalId FROM ${table.account_capabilities} k WHERE ${owned}`, args()),
    ]);
    if (results[0].meta.changes === 0) return null;
    if (results[0].meta.changes !== 1 || results.at(-1)!.results.length !== 1
      || !identifier(results.at(-1)!.results[0].principalId)) throw new LifecycleStoreError();
    return Object.freeze({ principalId: results.at(-1)!.results[0].principalId as string });
  }

  async function revokeCapability(guardValue: LifecycleGuard, capabilityId: string): Promise<boolean> {
    const guard = captureGuard(guardValue);
    if (!identifier(capabilityId)) throw new LifecycleStoreInputError();
    const claim = acquire(guard, 'capability-revoked', `EXISTS (SELECT 1 FROM ${table.account_capabilities}
      WHERE id = ? AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL)`, [capabilityId]);
    const results = await batch([
      claim.query,
      statement(`UPDATE ${table.account_capabilities} SET revoked_at_ms = ${NOW}
        WHERE id = ? AND ${claim.claimExists}`, [capabilityId, ...claim.args()]),
      statement(`UPDATE ${table.access_audit} SET target_principal_id =
        (SELECT principal_id FROM ${table.account_capabilities} WHERE id = ?), capability_id = ?
        WHERE id = ? AND claim_nonce = ?`, [capabilityId, capabilityId, claim.auditId, claim.nonce]),
    ]);
    const acquired = results[0].meta.changes;
    if ((acquired !== 0 && acquired !== 1) || results[1].meta.changes !== acquired || results[2].meta.changes !== acquired) throw new LifecycleStoreError();
    return acquired === 1;
  }

  return Object.freeze({ issueInvitation, issueCapability, readCapability, consumeCapability, revokeCapability });
}
