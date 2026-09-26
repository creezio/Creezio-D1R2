import { ACCESS_TABLES, type IdentityDatabase, type NativeSession } from '../identity/d1-store.ts';
import { ACCESS_POLICY_LIMITS, parseAccessPolicy, type AccessPolicy } from './policy.ts';
import type { AuthorizationAudience } from './types.ts';
import { MACHINE_SCOPE_LIMITS, parseStoredMachineScopeRows, type MachineScope } from '../identity/machine-policy.ts';

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

export interface CommitAccessPolicyInput {
  readonly sessionDigest: string;
  readonly sessionId: string;
  readonly principalId: string;
  readonly epoch: number;
  readonly policy: AccessPolicy;
}

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
    const keys = ['sessionDigest', 'sessionId', 'principalId', 'epoch', 'policy'];
    return Reflect.ownKeys(descriptors).length === keys.length
      && keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'));
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
  const liveSession = `s.secret_hash = ? AND s.audience = ?
    AND s.revoked_at_ms IS NULL AND s.expires_at_ms > ${NOW}
    AND p.kind = 'human' AND p.status = 'active' AND h.status = 'active'
    AND s.auth_version = p.auth_version AND s.account_version = h.version AND s.credential_version = c.version
    AND (c.expires_at_ms IS NULL OR c.expires_at_ms > ${NOW})`;

  // Keep this same ordered ACL projection for both human and machine reads.
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

  async function commitPolicy(input: CommitAccessPolicyInput): Promise<boolean> {
    if (!inputShape(input) || !digest(input.sessionDigest) || !identifier(input.sessionId)
      || !identifier(input.principalId) || !positive(input.epoch) || input.epoch >= MAX_EPOCH) throw new AuthorizationStoreInputError();
    // Copy/freeze the candidate before awaiting I/O. The caller cannot alter the
    // serialized effects while claim acquisition is pending.
    const policy = parseAccessPolicy(input.policy);
    if (!policy) throw new AuthorizationStoreInputError();
    const claim = crypto.randomUUID(), auditId = crypto.randomUUID();
    const claimExists = `EXISTS (SELECT 1 FROM ${table.access_audit}
      WHERE id = ? AND claim_nonce = ? AND action = 'authorization-updated')`;
    const guard = () => [auditId, claim];
    const rolesJson = JSON.stringify(policy.roles);
    const statements = [
      statement(`INSERT INTO ${table.access_audit} (id, action, principal_id, session_id, claim_nonce, created_at_ms)
        SELECT ?, 'authorization-updated', p.id, s.id, ?, ${NOW} ${sessionFrom}
        WHERE ${liveSession} AND s.id = ? AND p.id = ? AND a.epoch = ? AND a.epoch < ${MAX_EPOCH}
          AND EXISTS (SELECT 1 FROM ${table.contexts} WHERE id = 'application' AND status = 'active')
          AND EXISTS (SELECT 1 FROM ${table.memberships} WHERE principal_id = p.id
            AND context_id = 'application' AND audience = 'admin' AND status = 'active')`,
      [auditId, claim, input.sessionDigest, 'admin', input.sessionId, input.principalId, input.epoch]),
      ...(['role_assignments', 'principal_overrides', 'role_parents', 'role_grants', 'role_overrides', 'memberships'] as const)
        .map(id => statement(`DELETE FROM ${table[id]} WHERE ${claimExists}`, guard())),
      statement(`INSERT INTO ${table.contexts} (id, status)
        SELECT json_extract(value, '$.id'), json_extract(value, '$.status') FROM json_each(?) WHERE ${claimExists}
        ON CONFLICT(id) DO UPDATE SET status = excluded.status`, [JSON.stringify(policy.contexts), ...guard()]),
      statement(`INSERT INTO ${table.roles} (id)
        SELECT json_extract(value, '$.id') FROM json_each(?) WHERE ${claimExists}
        ON CONFLICT(id) DO NOTHING`, [rolesJson, ...guard()]),
      statement(`DELETE FROM ${table.roles} WHERE id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?))
        AND ${claimExists}`, [rolesJson, ...guard()]),
      statement(`INSERT INTO ${table.memberships} (principal_id, context_id, audience, status)
        SELECT json_extract(value, '$.principalId'), json_extract(value, '$.contextId'),
          json_extract(value, '$.audience'), json_extract(value, '$.status') FROM json_each(?) WHERE ${claimExists}`,
      [JSON.stringify(policy.memberships), ...guard()]),
      statement(`INSERT INTO ${table.role_parents} (role_id, parent_role_id)
        SELECT json_extract(r.value, '$.id'), p.value FROM json_each(?) r, json_each(r.value, '$.inherits') p WHERE ${claimExists}`,
      [rolesJson, ...guard()]),
      statement(`INSERT INTO ${table.role_grants} (role_id, permission_id)
        SELECT json_extract(r.value, '$.id'), g.value FROM json_each(?) r, json_each(r.value, '$.permissionIds') g WHERE ${claimExists}`,
      [rolesJson, ...guard()]),
      statement(`INSERT INTO ${table.role_overrides} (role_id, permission_id, effect)
        SELECT json_extract(r.value, '$.id'), json_extract(o.value, '$.permissionId'), json_extract(o.value, '$.effect')
        FROM json_each(?) r, json_each(r.value, '$.permissionOverrides') o WHERE ${claimExists}`, [rolesJson, ...guard()]),
      statement(`INSERT INTO ${table.role_assignments} (principal_id, context_id, audience, role_id)
        SELECT json_extract(value, '$.principalId'), json_extract(value, '$.contextId'),
          json_extract(value, '$.audience'), json_extract(value, '$.roleId') FROM json_each(?) WHERE ${claimExists}`,
      [JSON.stringify(policy.assignments), ...guard()]),
      statement(`INSERT INTO ${table.principal_overrides} (principal_id, context_id, audience, permission_id, effect)
        SELECT json_extract(value, '$.principalId'), json_extract(value, '$.contextId'), json_extract(value, '$.audience'),
          json_extract(value, '$.permissionId'), json_extract(value, '$.effect') FROM json_each(?) WHERE ${claimExists}`,
      [JSON.stringify(policy.overrides), ...guard()]),
      statement(`UPDATE ${table.authorization_state} SET epoch = epoch + 1, updated_at_ms = ${NOW}
        WHERE id = 'application' AND epoch = ? AND ${claimExists}`, [input.epoch, ...guard()]),
    ];
    const results = await batch(statements);
    const acquired = results[0].meta.changes;
    if (acquired !== 0 && acquired !== 1) throw new AuthorizationStoreError();
    if (results.at(-1)!.meta.changes !== acquired) throw new AuthorizationStoreError();
    return acquired === 1;
  }

  return Object.freeze({ read, readMachine, commitPolicy });
}
