import {ACCESS_TABLES, type IdentityDatabase} from './d1-store.ts';
import {identityInputFields, validIdentityId} from './input.ts';
import {parseAccessPolicy, type AccessPolicy} from '../authorization/policy.ts';
import type {AccessAdminAuditChange, AccessAdminAuditCursor, AccessAdminAuditDetailPage,
  AccessAdminAuditEntry, AccessAdminAuditPage, AccessAdminChangeValue,
  AccessAdminPolicyChange} from '../../sdk/access/admin-types.ts';
import type {LifecycleGuard} from './lifecycle-store.ts';

export const ACCESS_AUDIT_LIMITS = Object.freeze({listPage: 50, detailPage: 32, detailBytes: 524_288});
export class AccessAuditStoreError extends Error {
  constructor() {super('Access audit storage unavailable.'); this.name = 'AccessAuditStoreError';}
}
const table = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const epoch = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const credentialDigest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const action = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const displayName = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => !!value
  && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validCursor = (value: unknown): value is AccessAdminAuditCursor | null => value === null
  || exact(value, ['createdAtMs', 'id']) && instant(value.createdAtMs) && validIdentityId(value.id);
const validLimit = (value: unknown, max: number): value is number => Number.isSafeInteger(value)
  && Number(value) >= 1 && Number(value) <= max;

function captureGuard(value: unknown): LifecycleGuard {
  if (!identityInputFields(value, ['sessionDigest', 'sessionId', 'principalId', 'epoch'])
    || !credentialDigest(value.sessionDigest) || !validIdentityId(value.sessionId)
    || !validIdentityId(value.principalId) || !epoch(value.epoch)) throw new AccessAuditStoreError();
  return Object.freeze({...value}) as unknown as LifecycleGuard;
}

type ChangeWithoutIndex = AccessAdminPolicyChange;
function policyChanges(before: AccessPolicy, after: AccessPolicy): readonly ChangeWithoutIndex[] {
  const old = new Map<string, {change: Omit<ChangeWithoutIndex, 'before' | 'after'>; value: AccessAdminChangeValue}>();
  const next = new Map<string, {change: Omit<ChangeWithoutIndex, 'before' | 'after'>; value: AccessAdminChangeValue}>();
  const put = (map: typeof old, kind: ChangeWithoutIndex['kind'], key: readonly string[],
    change: Omit<ChangeWithoutIndex, 'before' | 'after'>, value: AccessAdminChangeValue) => {
    const serialized = JSON.stringify([kind, ...key]);
    if (map.has(serialized)) throw new AccessAuditStoreError();
    map.set(serialized, {change, value});
  };
  const capture = (policy: AccessPolicy, map: typeof old) => {
    for (const context of policy.contexts)
      put(map, 'context-status', [context.id], {kind: 'context-status', contextId: context.id}, context.status);
    for (const role of policy.roles) {
      put(map, 'role-existence', [role.id], {kind: 'role-existence', roleId: role.id}, 'present');
      for (const parentRoleId of role.inherits)
        put(map, 'role-parent', [role.id, parentRoleId], {kind: 'role-parent', roleId: role.id, parentRoleId}, 'present');
      for (const permissionId of role.permissionIds)
        put(map, 'role-grant', [role.id, permissionId], {kind: 'role-grant', roleId: role.id, permissionId}, 'present');
      for (const override of role.permissionOverrides)
        put(map, 'role-override', [role.id, override.permissionId],
          {kind: 'role-override', roleId: role.id, permissionId: override.permissionId}, override.effect);
    }
    for (const membership of policy.memberships)
      put(map, 'membership', [membership.principalId, membership.contextId, membership.audience],
        {kind: 'membership', principalId: membership.principalId, contextId: membership.contextId,
          audience: membership.audience}, membership.status);
    for (const assignment of policy.assignments)
      put(map, 'role-assignment', [assignment.principalId, assignment.contextId, assignment.audience, assignment.roleId],
        {kind: 'role-assignment', principalId: assignment.principalId, contextId: assignment.contextId,
          audience: assignment.audience, roleId: assignment.roleId}, 'present');
    for (const override of policy.overrides)
      put(map, 'principal-override', [override.principalId, override.contextId, override.audience, override.permissionId],
        {kind: 'principal-override', principalId: override.principalId, contextId: override.contextId,
          audience: override.audience, permissionId: override.permissionId}, override.effect);
  };
  capture(before, old); capture(after, next);
  const changes: ChangeWithoutIndex[] = [];
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const prior = old.get(key), current = next.get(key);
    const previous = prior?.value ?? (current?.change.kind === 'role-override'
      || current?.change.kind === 'principal-override' ? 'inherit' : 'absent');
    const following = current?.value ?? (prior?.change.kind === 'role-override'
      || prior?.change.kind === 'principal-override' ? 'inherit' : 'absent');
    if (previous !== following) changes.push(Object.freeze({... (current ?? prior)!.change,
      before: previous, after: following}));
  }
  return Object.freeze(changes.sort((a, b) => {
    const tuple = (change: ChangeWithoutIndex) => JSON.stringify([change.kind, change.principalId ?? '',
      change.contextId ?? '', change.audience ?? '', change.roleId ?? '', change.parentRoleId ?? '',
      change.permissionId ?? '']);
    const left = tuple(a), right = tuple(b); return left < right ? -1 : left > right ? 1 : 0;
  }));
}

function detailEnvelope(value: unknown): {before: AccessPolicy; after: AccessPolicy} {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > ACCESS_AUDIT_LIMITS.detailBytes)
    throw new AccessAuditStoreError();
  let data: unknown;
  try {data = JSON.parse(value);} catch {throw new AccessAuditStoreError();}
  if (!exact(data, ['version', 'beforePolicy', 'afterPolicy']) || data.version !== 1)
    throw new AccessAuditStoreError();
  const before = parseAccessPolicy(data.beforePolicy), after = parseAccessPolicy(data.afterPolicy);
  if (!before || !after) throw new AccessAuditStoreError();
  return {before, after};
}

/** Read-only D1 projection; an already-resolved admin guard is rechecked in each coherent batch. */
export function createD1AccessAuditStore(db: IdentityDatabase) {
  const statement = (sql: string, values: (string | number | null)[] = []) => db.prepare(sql).bind(...values);
  const adminFrom = `FROM ${table.sessions} s JOIN ${table.principals} p ON p.id=s.principal_id
    JOIN ${table.human_accounts} h ON h.principal_id=p.id
    JOIN ${table.password_credentials} c ON c.principal_id=p.id
    JOIN ${table.authorization_state} state ON state.id='application'`;
  const liveAdmin = `s.secret_hash=? AND s.id=? AND p.id=? AND state.epoch=? AND s.audience='admin'
    AND s.revoked_at_ms IS NULL AND s.expires_at_ms>${NOW}
    AND p.kind='human' AND p.status='active' AND h.status='active'
    AND s.auth_version=p.auth_version AND s.account_version=h.version AND s.credential_version=c.version
    AND (c.expires_at_ms IS NULL OR c.expires_at_ms>${NOW})
    AND EXISTS(SELECT 1 FROM ${table.contexts} WHERE id='application' AND status='active')
    AND EXISTS(SELECT 1 FROM ${table.memberships} WHERE principal_id=p.id
      AND context_id='application' AND audience='admin' AND status='active')`;
  const guarded = `EXISTS(SELECT 1 ${adminFrom} WHERE ${liveAdmin})`;
  const args = (guard: LifecycleGuard) => [guard.sessionDigest, guard.sessionId, guard.principalId, guard.epoch];
  async function read(statements: D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[] | null> {
    try {
      const results = await db.batch<Record<string, unknown>>(statements);
      if (results.length !== statements.length || results.some(result => result.success !== true || !Array.isArray(result.results)))
        throw new AccessAuditStoreError();
      if (results[0].results.length === 0) return null;
      if (results[0].results.length !== 1 || results[0].results[0].allowed !== 1) throw new AccessAuditStoreError();
      return results;
    } catch {throw new AccessAuditStoreError();}
  }
  function header(guard: LifecycleGuard) {
    return statement(`SELECT 1 AS allowed ${adminFrom} WHERE ${liveAdmin} LIMIT 2`, args(guard));
  }
  async function list(guardValue: LifecycleGuard, input: {limit: number; before: AccessAdminAuditCursor | null}):
    Promise<AccessAdminAuditPage | null> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['limit', 'before']) || !validLimit(input.limit, ACCESS_AUDIT_LIMITS.listPage)
      || !validCursor(input.before)) throw new AccessAuditStoreError();
    const cursor = input.before, limit = input.limit;
    const results = await read([header(guard), statement(`SELECT audit.id, audit.action,
      audit.principal_id AS principalId, actor.display_name AS actorDisplayName,
      audit.target_principal_id AS targetPrincipalId, audit.created_at_ms AS createdAtMs,
      CASE WHEN detail.audit_id IS NULL THEN 0 ELSE 1 END AS detailAvailable
      FROM ${table.access_audit} audit JOIN ${table.principals} actor ON actor.id=audit.principal_id
      LEFT JOIN ${table.access_policy_audit_details} detail ON detail.audit_id=audit.id
      WHERE (? IS NULL OR audit.created_at_ms<? OR (audit.created_at_ms=? AND audit.id<?)) AND ${guarded}
      ORDER BY audit.created_at_ms DESC,audit.id DESC LIMIT ?`,
    [cursor?.createdAtMs ?? null, cursor?.createdAtMs ?? null, cursor?.createdAtMs ?? null,
      cursor?.id ?? null, ...args(guard), limit + 1])]);
    if (!results) return null;
    if (results[1].results.length > limit + 1) throw new AccessAuditStoreError();
    const rows = results[1].results.map(row => {
      if (!validIdentityId(row.id) || !action(row.action) || !validIdentityId(row.principalId)
        || !displayName(row.actorDisplayName) || row.targetPrincipalId !== null && !validIdentityId(row.targetPrincipalId)
        || !instant(row.createdAtMs) || row.detailAvailable !== 0 && row.detailAvailable !== 1)
        throw new AccessAuditStoreError();
      return Object.freeze({id: row.id, action: row.action, principalId: row.principalId,
        actorDisplayName: row.actorDisplayName, targetPrincipalId: row.targetPrincipalId,
        createdAtMs: row.createdAtMs, summary: row.action, detailAvailable: row.detailAvailable === 1}) as AccessAdminAuditEntry;
    });
    let prior = cursor;
    for (const row of rows) {
      if (prior && (row.createdAtMs > prior.createdAtMs || row.createdAtMs === prior.createdAtMs && row.id >= prior.id))
        throw new AccessAuditStoreError();
      prior = {createdAtMs: row.createdAtMs, id: row.id};
    }
    const items = Object.freeze(rows.slice(0, limit));
    const last = items.at(-1);
    return Object.freeze({items, nextCursor: rows.length > limit && last
      ? Object.freeze({createdAtMs: last.createdAtMs, id: last.id}) : null});
  }
  async function detail(guardValue: LifecycleGuard, input: {auditId: string; limit: number; afterIndex: number | null}):
    Promise<AccessAdminAuditDetailPage | null | undefined> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['auditId', 'limit', 'afterIndex']) || !validIdentityId(input.auditId)
      || !validLimit(input.limit, ACCESS_AUDIT_LIMITS.detailPage)
      || input.afterIndex !== null && (!Number.isSafeInteger(input.afterIndex) || input.afterIndex < 0))
      throw new AccessAuditStoreError();
    const results = await read([header(guard), statement(`SELECT detail.from_epoch AS fromEpoch,
      detail.to_epoch AS toEpoch, detail.changes_json AS changesJson
      FROM ${table.access_policy_audit_details} detail
      JOIN ${table.access_audit} audit ON audit.id=detail.audit_id
      WHERE detail.audit_id=? AND ${guarded} LIMIT 2`, [input.auditId, ...args(guard)])]);
    if (!results) return null;
    if (results[1].results.length === 0) return undefined;
    if (results[1].results.length !== 1) throw new AccessAuditStoreError();
    const row = results[1].results[0];
    if (!epoch(row.fromEpoch) || !epoch(row.toEpoch) || row.toEpoch !== row.fromEpoch + 1)
      throw new AccessAuditStoreError();
    const envelope = detailEnvelope(row.changesJson);
    const all = policyChanges(envelope.before, envelope.after);
    const start = input.afterIndex === null ? 0 : input.afterIndex + 1;
    const changes: AccessAdminAuditChange[] = all.slice(start, start + input.limit).map((change, offset) =>
      Object.freeze({index: start + offset, ...change}));
    const nextAfterIndex = start + changes.length < all.length ? start + changes.length - 1 : null;
    return Object.freeze({auditId: input.auditId, fromEpoch: row.fromEpoch, toEpoch: row.toEpoch,
      changes: Object.freeze(changes), nextAfterIndex});
  }
  return Object.freeze({list, detail});
}
