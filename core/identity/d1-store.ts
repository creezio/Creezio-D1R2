import { isApprovedPasswordRecord } from './password.ts';

export const IDENTITY_STORE_LIMITS = Object.freeze({
  minimumSessionTtlMs: 1000, maximumSessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  maximumBootstrapTtlMs: 24 * 60 * 60 * 1000,
  minimumThrottleWindowMs: 1000, maximumThrottleWindowMs: 24 * 60 * 60 * 1000, maximumThrottleLimit: 1000,
  throttlePruneBatchSize: 32,
});
const modelIds = ['principals', 'human_accounts', 'password_credentials', 'sessions', 'bootstrap',
  'authorization_state', 'access_audit', 'auth_throttles', 'contexts', 'memberships', 'roles',
  'role_parents', 'role_grants', 'role_overrides', 'role_assignments', 'principal_overrides', 'account_capabilities',
  'api_credentials', 'api_credential_scopes', 'impersonations', 'impersonation_permissions'] as const;
export type AccessModelId = typeof modelIds[number];
const hex = (value: string) => Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');
/** Same lossless namespace encoding as the central schema compiler, without Node. */
export const ACCESS_TABLES: Readonly<Record<AccessModelId, string>> = Object.freeze(Object.fromEntries(
  modelIds.map(id => [id, `cz_${hex('creezio.access')}_${hex(id)}`]),
) as Record<AccessModelId, string>);
const table = Object.fromEntries(modelIds.map(id => [id, `"${ACCESS_TABLES[id]}"`])) as Record<AccessModelId, string>;
// Database time, in integer milliseconds with one-second precision. Never captured before KDF.
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const audience = (value: unknown): value is 'admin' | 'app' => value === 'admin' || value === 'app';
const randomId = () => crypto.randomUUID();

export class IdentityStoreInputError extends Error {
  constructor() { super('Invalid identity store input.'); this.name = 'IdentityStoreInputError'; }
}
export class IdentityStoreError extends Error {
  constructor() { super('Identity storage operation failed.'); this.name = 'IdentityStoreError'; }
}

/** ASCII login policy shared by the account operation and every lookup/write. */
export function normalizeLoginIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._+@-]{2,253}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Internal sensitive snapshot, only passed from the server lookup through its KDF check. */
export interface PasswordAccountSnapshot {
  readonly principalId: string;
  readonly loginIdentifier: string;
  readonly authVersion: number;
  readonly accountVersion: number;
  readonly credentialVersion: number;
  readonly passwordRecord: string;
}
/** Identity metadata only: this is not a permission grant or an authorization snapshot. */
export interface NativeSession {
  readonly id: string;
  readonly principalId: string;
  readonly displayName: string;
  readonly audience: 'admin' | 'app';
  readonly authVersion: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}
export interface BootstrapInput {
  readonly capabilityDigest: string;
  readonly loginIdentifier: string;
  readonly displayName: string;
  readonly passwordRecord: string;
}
export interface SessionGrantInput {
  readonly sessionDigest: string;
  readonly audience: 'admin' | 'app';
  readonly ttlMs: number;
}
export interface ThrottleInput { readonly key: string; readonly limit: number; readonly windowMs: number; }
export type IdentityDatabase = Pick<D1Database, 'prepare' | 'batch'>;

function validSnapshot(snapshot: PasswordAccountSnapshot): boolean {
  return !!snapshot && identifier(snapshot.principalId)
    && normalizeLoginIdentifier(snapshot.loginIdentifier) === snapshot.loginIdentifier
    && positive(snapshot.authVersion) && positive(snapshot.accountVersion) && positive(snapshot.credentialVersion)
    && isApprovedPasswordRecord(snapshot.passwordRecord);
}
async function databaseCall<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch { throw new IdentityStoreError(); }
}

/**
 * Trusted server storage only. No HTTP, schema creation, KDF or input authentication.
 * The caller owns admission and proof of password/capability possession. Schema SQL
 * is compiled centrally from the access models and applied before this store is used.
 */
export function createD1IdentityStore(db: IdentityDatabase) {
  const statement = (sql: string, values: (string | number | null)[] = []) => {
    try { return db.prepare(sql).bind(...values); } catch { throw new IdentityStoreError(); }
  };
  const batch = async (statements: D1PreparedStatement[]) => {
    const results = await databaseCall(() => db.batch(statements));
    if (results.length !== statements.length || results.some(result => result.success !== true)) throw new IdentityStoreError();
    return results;
  };
  const noHumans = `NOT EXISTS (SELECT 1 FROM ${table.principals} WHERE kind = 'human')`;
  const available = `id = 'installation' AND capability_digest = ? AND claim_nonce IS NULL
    AND claimed_at_ms IS NULL AND principal_id IS NULL AND expires_at_ms > ${NOW} AND ${noHumans}`;
  const claimExists = `EXISTS (SELECT 1 FROM ${table.bootstrap} WHERE id = 'installation' AND claim_nonce = ?)`;
  const sessionColumns = `s.id, s.principal_id AS principalId, p.display_name AS displayName,
    s.audience, s.auth_version AS authVersion, s.created_at_ms AS createdAtMs, s.expires_at_ms AS expiresAtMs`;
  const liveSession = `FROM ${table.sessions} s JOIN ${table.principals} p ON p.id = s.principal_id
    JOIN ${table.human_accounts} h ON h.principal_id = p.id
    JOIN ${table.password_credentials} c ON c.principal_id = p.id
    WHERE s.secret_hash = ? AND s.audience = ? AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ${NOW}
      AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
      AND s.auth_version = p.auth_version AND s.account_version = h.version AND s.credential_version = c.version
      AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ${NOW})`;

  async function provisionBootstrap(input: { capabilityDigest: string; expiresAtMs: number }): Promise<boolean> {
    if (!input || !digest(input.capabilityDigest) || !positive(input.expiresAtMs)) throw new IdentityStoreInputError();
    const results = await batch([statement(`INSERT INTO ${table.bootstrap}
      (id, capability_digest, created_at_ms, expires_at_ms, claim_nonce, claimed_at_ms, principal_id)
      SELECT 'installation', ?, ${NOW}, ?, NULL, NULL, NULL
      WHERE ? > ${NOW} AND ? <= ${NOW} + ? AND ${noHumans}
      ON CONFLICT(id) DO UPDATE SET capability_digest = excluded.capability_digest,
        created_at_ms = excluded.created_at_ms, expires_at_ms = excluded.expires_at_ms
      WHERE claim_nonce IS NULL AND claimed_at_ms IS NULL AND principal_id IS NULL
        AND expires_at_ms <= ${NOW} AND ${noHumans}`,
    [input.capabilityDigest, input.expiresAtMs, input.expiresAtMs, input.expiresAtMs, IDENTITY_STORE_LIMITS.maximumBootstrapTtlMs])]);
    return results[0].meta.changes === 1;
  }

  async function canCompleteBootstrap(capabilityDigest: string): Promise<boolean> {
    if (!digest(capabilityDigest)) return false;
    const row = await databaseCall(() => statement(`SELECT 1 AS available FROM ${table.bootstrap} WHERE ${available}`,
      [capabilityDigest]).first<{ available: number }>());
    return row?.available === 1;
  }

  async function completeBootstrap(input: BootstrapInput): Promise<{ principalId: string } | null> {
    const loginIdentifier = normalizeLoginIdentifier(input?.loginIdentifier);
    if (!input || !digest(input.capabilityDigest) || !loginIdentifier
      || typeof input.displayName !== 'string' || !input.displayName.length || input.displayName.length > 200
      || !input.displayName.isWellFormed() || /[\u0000-\u001f\u007f]/.test(input.displayName)
      || !isApprovedPasswordRecord(input.passwordRecord)) throw new IdentityStoreInputError();
    const principalId = randomId(), claim = randomId(), auditId = randomId();
    // Every effect is tied to this fresh, server-generated nonce. UPDATE 0 alone
    // does not abort a D1 batch, so no later INSERT may be unconditional.
    const results = await batch([
      statement(`UPDATE ${table.bootstrap} SET claim_nonce = ?, claimed_at_ms = ${NOW} WHERE ${available}`,
        [claim, input.capabilityDigest]),
      statement(`INSERT INTO ${table.principals} (id, kind, status, auth_version, display_name, created_at_ms, updated_at_ms)
        SELECT ?, 'human', 'active', 1, ?, ${NOW}, ${NOW} WHERE ${claimExists}`, [principalId, input.displayName, claim]),
      statement(`INSERT INTO ${table.human_accounts} (principal_id, login_identifier, status, version, created_at_ms, updated_at_ms)
        SELECT ?, ?, 'active', 1, ${NOW}, ${NOW} WHERE ${claimExists}`, [principalId, loginIdentifier, claim]),
      statement(`INSERT INTO ${table.password_credentials} (principal_id, password_record, version, expires_at_ms, created_at_ms, updated_at_ms)
        SELECT ?, ?, 1, NULL, ${NOW}, ${NOW} WHERE ${claimExists}`, [principalId, input.passwordRecord, claim]),
      statement(`INSERT INTO ${table.authorization_state} (id, epoch, bootstrap_principal_id, updated_at_ms)
        SELECT 'application', 1, ?, ${NOW} WHERE ${claimExists}`, [principalId, claim]),
      // Explicit initial ACL, matching the canonical access policy. The durable
      // bootstrap marker never substitutes for these rows during authorization.
      statement(`INSERT INTO ${table.contexts} (id, status)
        SELECT 'application', 'active' WHERE ${claimExists}`, [claim]),
      statement(`INSERT INTO ${table.roles} (id)
        SELECT 'administrator' WHERE ${claimExists}`, [claim]),
      statement(`INSERT INTO ${table.role_grants} (role_id, permission_id)
        SELECT 'administrator', 'creezio.access:manage' WHERE ${claimExists}`, [claim]),
      statement(`INSERT INTO ${table.memberships} (principal_id, context_id, audience, status)
        SELECT ?, 'application', 'admin', 'active' WHERE ${claimExists}`, [principalId, claim]),
      statement(`INSERT INTO ${table.role_assignments} (principal_id, context_id, audience, role_id)
        SELECT ?, 'application', 'admin', 'administrator' WHERE ${claimExists}`, [principalId, claim]),
      statement(`INSERT INTO ${table.access_audit} (id, action, principal_id, session_id, claim_nonce, created_at_ms)
        SELECT ?, 'bootstrap-completed', ?, NULL, ?, ${NOW} WHERE ${claimExists}`, [auditId, principalId, claim, claim]),
      statement(`UPDATE ${table.bootstrap} SET principal_id = ? WHERE id = 'installation' AND claim_nonce = ?`, [principalId, claim]),
    ]);
    return results[0].meta.changes === 1 ? Object.freeze({ principalId }) : null;
  }

  async function findPasswordAccount(value: string): Promise<PasswordAccountSnapshot | null> {
    const loginIdentifier = normalizeLoginIdentifier(value);
    if (!loginIdentifier) return null;
    const row = await databaseCall(() => statement(`SELECT p.id AS principalId, h.login_identifier AS loginIdentifier,
      p.auth_version AS authVersion, h.version AS accountVersion, c.version AS credentialVersion, c.password_record AS passwordRecord
      FROM ${table.human_accounts} h JOIN ${table.principals} p ON p.id = h.principal_id
      JOIN ${table.password_credentials} c ON c.principal_id = p.id
      WHERE h.login_identifier = ? AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
        AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ${NOW})`, [loginIdentifier]).first<PasswordAccountSnapshot>());
    if (!row) return null;
    if (!validSnapshot(row)) throw new IdentityStoreError();
    return Object.freeze(row);
  }

  async function getSession(sessionDigest: string, requestedAudience: 'admin' | 'app'): Promise<NativeSession | null> {
    if (!digest(sessionDigest) || !audience(requestedAudience)) return null;
    const row = await databaseCall(() => statement(`SELECT ${sessionColumns} ${liveSession}`,
      [sessionDigest, requestedAudience]).first<NativeSession>());
    return row ? Object.freeze(row) : null;
  }

  async function createSessionAfterPassword(snapshot: PasswordAccountSnapshot, input: SessionGrantInput): Promise<NativeSession | null> {
    if (!validSnapshot(snapshot) || !input || !digest(input.sessionDigest) || !audience(input.audience)
      || !Number.isSafeInteger(input.ttlMs) || input.ttlMs < IDENTITY_STORE_LIMITS.minimumSessionTtlMs
      || input.ttlMs > IDENTITY_STORE_LIMITS.maximumSessionTtlMs) throw new IdentityStoreInputError();
    const sessionId = randomId(), auditId = randomId(), claim = randomId();
    const results = await batch([
      statement(`INSERT INTO ${table.sessions}
        (id, secret_hash, principal_id, audience, auth_version, account_version, credential_version,
          created_at_ms, expires_at_ms, revoked_at_ms, revocation_nonce)
        SELECT ?, ?, p.id, ?, p.auth_version, h.version, c.version, ${NOW}, ${NOW} + ?, NULL, NULL
        FROM ${table.principals} p JOIN ${table.human_accounts} h ON h.principal_id = p.id
        JOIN ${table.password_credentials} c ON c.principal_id = p.id
        WHERE p.id = ? AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
          AND p.auth_version = ? AND h.version = ? AND c.version = ?
          AND h.login_identifier = ? AND c.password_record = ?
          AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ${NOW})`,
      [sessionId, input.sessionDigest, input.audience, input.ttlMs, snapshot.principalId,
        snapshot.authVersion, snapshot.accountVersion, snapshot.credentialVersion, snapshot.loginIdentifier, snapshot.passwordRecord]),
      statement(`INSERT INTO ${table.access_audit} (id, action, principal_id, session_id, claim_nonce, created_at_ms)
        SELECT ?, 'session-created', principal_id, id, ?, ${NOW} FROM ${table.sessions}
        WHERE id = ? AND secret_hash = ?`, [auditId, claim, sessionId, input.sessionDigest]),
    ]);
    if (results[0].meta.changes !== 1) return null;
    // A fresh read also catches revocation between insertion and return. The
    // consumer must still resolve each later request; this is never an ACL cache.
    return getSession(input.sessionDigest, input.audience);
  }

  async function revokeSession(sessionDigest: string, requestedAudience: 'admin' | 'app'): Promise<boolean> {
    if (!digest(sessionDigest) || !audience(requestedAudience)) return false;
    const claim = randomId(), auditId = randomId();
    const results = await batch([
      statement(`UPDATE ${table.sessions} SET revoked_at_ms = ${NOW}, revocation_nonce = ?
        WHERE secret_hash = ? AND audience = ? AND revoked_at_ms IS NULL`, [claim, sessionDigest, requestedAudience]),
      statement(`INSERT INTO ${table.access_audit} (id, action, principal_id, session_id, claim_nonce, created_at_ms)
        SELECT ?, 'session-revoked', principal_id, id, ?, ${NOW} FROM ${table.sessions}
        WHERE secret_hash = ? AND audience = ? AND revocation_nonce = ?`, [auditId, claim, sessionDigest, requestedAudience, claim]),
    ]);
    return results[0].meta.changes === 1;
  }

  async function consumeThrottle(input: ThrottleInput): Promise<{ allowed: boolean; retryAtMs: number }> {
    if (!input || !digest(input.key) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > IDENTITY_STORE_LIMITS.maximumThrottleLimit
      || !Number.isSafeInteger(input.windowMs) || input.windowMs < IDENTITY_STORE_LIMITS.minimumThrottleWindowMs
      || input.windowMs > IDENTITY_STORE_LIMITS.maximumThrottleWindowMs) throw new IdentityStoreInputError();
    const results = await batch([
      // Indexed, request-driven maintenance, never a scheduler or an unbounded
      // DELETE. The current window is handled only by the following upsert.
      statement(`DELETE FROM ${table.auth_throttles} WHERE key IN
        (SELECT key FROM ${table.auth_throttles} WHERE expires_at_ms <= ${NOW} AND key <> ?
          ORDER BY expires_at_ms ASC LIMIT ${IDENTITY_STORE_LIMITS.throttlePruneBatchSize})`, [input.key]),
      statement(`INSERT INTO ${table.auth_throttles} (key, window_start_ms, attempts, expires_at_ms)
      VALUES (?, ${NOW}, 1, ${NOW} + ?)
      ON CONFLICT(key) DO UPDATE SET window_start_ms = CASE WHEN expires_at_ms <= ${NOW} THEN ${NOW} ELSE window_start_ms END,
        attempts = CASE WHEN expires_at_ms <= ${NOW} THEN 1 ELSE min(attempts + 1, ?) END,
        expires_at_ms = CASE WHEN expires_at_ms <= ${NOW} THEN ${NOW} + ? ELSE expires_at_ms END
      RETURNING attempts, expires_at_ms AS retryAtMs`, [input.key, input.windowMs, input.limit + 1, input.windowMs])]);
    const row = results[1].results[0] as { attempts: number; retryAtMs: number } | undefined;
    if (!row || !positive(row.attempts) || !positive(row.retryAtMs)) throw new IdentityStoreError();
    return Object.freeze({ allowed: row.attempts <= input.limit, retryAtMs: row.retryAtMs });
  }

  return Object.freeze({ provisionBootstrap, canCompleteBootstrap, completeBootstrap, findPasswordAccount,
    createSessionAfterPassword, getSession, revokeSession, consumeThrottle });
}
