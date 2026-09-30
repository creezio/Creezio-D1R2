import { ACCESS_TABLES, type IdentityDatabase } from './d1-store.ts';
import type { LifecycleGuard } from './lifecycle-store.ts';
import { ACCESS_POLICY_LIMITS } from '../authorization/policy.ts';
import { identityInputFields, normalizeDisplayName, validIdentityId } from './input.ts';
import { MACHINE_SCOPE_LIMITS, parseMachineScopes, parseStoredMachineScopeRows, type MachineScope } from './machine-policy.ts';
import type {SqlStatement} from '../data/authorization.ts';
import {accessAdminCondition,captureAccessAdminGuard,type AccessAdminGuard} from '../authorization/admin-authority.ts';

export interface ServicePrincipal {
  readonly id: string;
  readonly displayName: string;
  readonly status: 'active' | 'disabled';
  readonly authVersion: number;
}
export interface IssuedMachineCredential {
  readonly id: string;
  readonly principalId: string;
  readonly label: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly scopes: readonly MachineScope[];
}
/** Private server projection. Deliberately contains no secret hash. */
export interface StoredMachineCredential extends IssuedMachineCredential {
  readonly authVersion: number;
  readonly revokedAtMs: number | null;
}
export interface IssueMachineTokenInput {
  readonly principalId: string;
  readonly label: string;
  readonly digest: string;
  readonly ttlMs: number;
  readonly scopes: readonly MachineScope[];
}
export const MACHINE_STORE_LIMITS = Object.freeze({
  minimumTokenTtlMs: 1000, maximumTokenTtlMs: 365 * 24 * 60 * 60 * 1000,
  maximumPrincipals: ACCESS_POLICY_LIMITS.principals,
  maximumActiveCredentials: 1024, maximumActivePerPrincipal: 32,
  revocationBatchSize: 32,
});
export class MachineStoreInputError extends Error {
  constructor() { super('Invalid machine account store input.'); this.name = 'MachineStoreInputError'; }
}
export class MachineStoreError extends Error {
  constructor() { super('Machine account storage operation failed.'); this.name = 'MachineStoreError'; }
}

const table = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const MAX = Number.MAX_SAFE_INTEGER;
const digest = (value: unknown): value is string => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const status = (value: unknown): value is ServicePrincipal['status'] => value === 'active' || value === 'disabled';
const ttl = (value: unknown): value is number => Number.isSafeInteger(value)
  && Number(value) >= MACHINE_STORE_LIMITS.minimumTokenTtlMs && Number(value) <= MACHINE_STORE_LIMITS.maximumTokenTtlMs;
function captureGuard(value: unknown): AccessAdminGuard {
  try{return captureAccessAdminGuard(value);}catch{throw new MachineStoreInputError();}
}
function serviceRow(row: Record<string, unknown>): ServicePrincipal {
  const name = normalizeDisplayName(row.displayName);
  if (!validIdentityId(row.id) || !name || name !== row.displayName || !status(row.status) || !positive(row.authVersion)) throw new MachineStoreError();
  return Object.freeze({ id: row.id, displayName: name, status: row.status, authVersion: row.authVersion });
}
function credentialRow(row: Record<string, unknown>, rows: Record<string, unknown>[]): StoredMachineCredential {
  const label = normalizeDisplayName(row.label), scopes = parseStoredMachineScopeRows(rows);
  if (!validIdentityId(row.id) || !validIdentityId(row.principalId) || !label || label !== row.label || !scopes
    || !instant(row.createdAtMs) || !instant(row.expiresAtMs) || row.expiresAtMs <= row.createdAtMs
    || !positive(row.authVersion) || (row.revokedAtMs !== null && !instant(row.revokedAtMs))) throw new MachineStoreError();
  return Object.freeze({ id: row.id, principalId: row.principalId, label, createdAtMs: row.createdAtMs,
    expiresAtMs: row.expiresAtMs, authVersion: row.authVersion, revokedAtMs: row.revokedAtMs, scopes });
}

/**
 * Trusted server persistence only: caller resolves manage(application/admin) and
 * validates the installed permission catalogue before supplying its guard.
 * The database rechecks that administrative session and epoch at each mutation.
 * A machine principal or credential never creates human accounts, sessions or ACLs.
 * Tokens are represented only by hashes; rotation copies immutable scopes in SQL.
 */
export function createD1MachineStore(db: IdentityDatabase) {
  const planned=(sql:string,bindings:(string|number|null)[]=[]):SqlStatement=>({sql,bindings});
  const statement = (sql: string, values: (string | number | null)[] = []) => {
    try { return db.prepare(sql).bind(...values); } catch { throw new MachineStoreError(); }
  };
  async function batch(statements: D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[]> {
    try {
      const results = await db.batch<Record<string, unknown>>(statements);
      if (results.length !== statements.length || results.some(row => row.success !== true || !Array.isArray(row.results))) throw new MachineStoreError();
      return results;
    } catch { throw new MachineStoreError(); }
  }
  const tokenFrom = `FROM ${table.api_credentials} k JOIN ${table.principals} tp ON tp.id = k.principal_id`;
  const liveToken = `tp.kind = 'service' AND tp.status = 'active' AND k.auth_version = tp.auth_version
    AND k.revoked_at_ms IS NULL AND k.expires_at_ms > ${NOW}`;
  const roomGlobal = `(SELECT COUNT(*) FROM (SELECT k.id ${tokenFrom} WHERE ${liveToken}
    LIMIT ${MACHINE_STORE_LIMITS.maximumActiveCredentials})) < ${MACHINE_STORE_LIMITS.maximumActiveCredentials}`;
  const roomTarget = `(SELECT COUNT(*) FROM (SELECT k.id ${tokenFrom} WHERE ${liveToken} AND tp.id = ?
    LIMIT ${MACHINE_STORE_LIMITS.maximumActivePerPrincipal})) < ${MACHINE_STORE_LIMITS.maximumActivePerPrincipal}`;
  const roomPrincipal = `(SELECT COUNT(*) FROM (SELECT id FROM ${table.principals}
    LIMIT ${MACHINE_STORE_LIMITS.maximumPrincipals})) < ${MACHINE_STORE_LIMITS.maximumPrincipals}`;
  type Action = 'service-created' | 'service-status-updated' | 'api-token-issued' | 'api-token-rotated' | 'api-token-revoked';
  function acquire(guard: AccessAdminGuard, action: Action, extra: string, values: (string | number)[],
    auditId:string=crypto.randomUUID()) {
    const nonce = crypto.randomUUID();
    const exists = `EXISTS (SELECT 1 FROM ${table.access_audit} WHERE id = ? AND claim_nonce = ? AND action = ?)`;
    const args = () => [auditId, nonce, action];
    const authority=accessAdminCondition(guard);
    const sql=`INSERT INTO ${table.access_audit}
      (id, action, principal_id, session_id, credential_id, context_id, audience,
        claim_nonce, created_at_ms, target_principal_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ${NOW}, NULL WHERE ${authority.sql} AND (${extra})`;
    const bindings=[auditId,action,guard.principalId,guard.kind==='session'?guard.sessionId:null,
      guard.kind==='oauth'?guard.credentialId:null,guard.kind==='oauth'?'application':null,
      guard.kind==='oauth'?'admin':null,nonce,...authority.bindings,...values];
    return {auditId,nonce,exists,args,query:statement(sql,bindings),plan:planned(sql,bindings)};
  }
  type Claim = ReturnType<typeof acquire>;
  const assertion=(claim:Claim):SqlStatement=>planned(
    `SELECT CASE WHEN ${claim.exists} THEN 1 ELSE json('creezio_machine_conflict') END AS accepted`,claim.args());
  const planTarget=(claim:Claim,principalId:string,credentialId:string|null=null):SqlStatement=>planned(
    `UPDATE ${table.access_audit} SET target_principal_id = ?, target_credential_id = ? WHERE id = ? AND claim_nonce = ?`,
    [principalId,credentialId,claim.auditId,claim.nonce]);
  const recordTarget = (claim: Claim, principalId: string, credentialId: string | null = null) => statement(
    `UPDATE ${table.access_audit} SET target_principal_id = ?, target_credential_id = ? WHERE id = ? AND claim_nonce = ?`,
    [principalId, credentialId, claim.auditId, claim.nonce]);
  function acquired(results: D1Result<Record<string, unknown>>[]): boolean {
    const count = results[0].meta.changes;
    if (count !== 0 && count !== 1) throw new MachineStoreError();
    return count === 1;
  }
  function readServiceResult(results: D1Result<Record<string, unknown>>[]): ServicePrincipal | null {
    if (!acquired(results)) return null;
    const rows = results.at(-1)!.results;
    if (rows.length !== 1) throw new MachineStoreError();
    return serviceRow(rows[0]);
  }
  const credentialSelect = `SELECT id, principal_id AS principalId, label, auth_version AS authVersion,
    created_at_ms AS createdAtMs, expires_at_ms AS expiresAtMs, revoked_at_ms AS revokedAtMs FROM ${table.api_credentials}`;
  const scopeSelect = `SELECT context_id AS contextId, audience, permission_id AS permissionId FROM ${table.api_credential_scopes}`;
  function tokenProjectionQueries(id: string, claim?: Claim) {
    const suffix = claim ? ` AND ${claim.exists}` : '';
    const args = claim ? claim.args() : [];
    return [statement(`${credentialSelect} WHERE id = ?${suffix} LIMIT 2`, [id, ...args]),
      statement(`${scopeSelect} WHERE credential_id = ?${suffix} ORDER BY context_id, audience, permission_id
        LIMIT ${MACHINE_SCOPE_LIMITS.permissions + 1}`, [id, ...args])];
  }
  function issued(results: D1Result<Record<string, unknown>>[]): IssuedMachineCredential | null {
    if (!acquired(results)) return null;
    const rows = results.at(-2)!.results;
    if (rows.length !== 1) throw new MachineStoreError();
    const { authVersion: _version, revokedAtMs: _revoked, ...projection } = credentialRow(rows[0], results.at(-1)!.results);
    return Object.freeze(projection);
  }

  async function createService(guardValue: AccessAdminGuard | LifecycleGuard, input: { readonly displayName: string }): Promise<ServicePrincipal | null> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['displayName'])) throw new MachineStoreInputError();
    const displayName = normalizeDisplayName(input.displayName);
    if (!displayName) throw new MachineStoreInputError();
    const id = crypto.randomUUID(), claim = acquire(guard, 'service-created', roomPrincipal, []);
    return readServiceResult(await batch([
      claim.query,
      statement(`INSERT INTO ${table.principals} (id, kind, status, auth_version, display_name, created_at_ms, updated_at_ms)
        SELECT ?, 'service', 'active', 1, ?, ${NOW}, ${NOW} WHERE ${claim.exists}`, [id, displayName, ...claim.args()]),
      recordTarget(claim, id),
      statement(`SELECT id, display_name AS displayName, status, auth_version AS authVersion FROM ${table.principals}
        WHERE id = ? AND ${claim.exists}`, [id, ...claim.args()]),
    ]));
  }

  async function setServiceStatus(guardValue: AccessAdminGuard | LifecycleGuard, input: {
    readonly principalId: string; readonly expectedAuthVersion: number; readonly status: ServicePrincipal['status'];
  },auditId?:string): Promise<ServicePrincipal | null> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['principalId', 'expectedAuthVersion', 'status']) || !validIdentityId(input.principalId)
      || !positive(input.expectedAuthVersion) || input.expectedAuthVersion >= MAX || !status(input.status)) throw new MachineStoreInputError();
    const { principalId, expectedAuthVersion, status: nextStatus } = input;
    const claim = acquire(guard, 'service-status-updated', `EXISTS (SELECT 1 FROM ${table.principals}
      WHERE id = ? AND kind = 'service' AND auth_version = ? AND status <> ?)`,
      [principalId, expectedAuthVersion, nextStatus],auditId);
    return readServiceResult(await batch([
      claim.query,
      statement(`UPDATE ${table.principals} SET status = ?, auth_version = auth_version + 1, updated_at_ms = ${NOW}
        WHERE id = ? AND ${claim.exists}`, [nextStatus, principalId, ...claim.args()]),
      // All previous tokens are invalid through auth_version, even when more
      // historical rows exist. Physical markers are bounded, not authoritative.
      statement(`UPDATE ${table.api_credentials} SET revoked_at_ms = ${NOW} WHERE id IN
        (SELECT id FROM ${table.api_credentials} WHERE principal_id = ? AND auth_version = ? AND revoked_at_ms IS NULL
          AND expires_at_ms > ${NOW} LIMIT ${MACHINE_STORE_LIMITS.revocationBatchSize}) AND ${claim.exists}`,
      [principalId, expectedAuthVersion, ...claim.args()]),
      recordTarget(claim, principalId),
      statement(`SELECT id, display_name AS displayName, status, auth_version AS authVersion FROM ${table.principals}
        WHERE id = ? AND ${claim.exists}`, [principalId, ...claim.args()]),
    ]));
  }
  /** Host-only plans are committed with the operation execution and its receipt in one D1 batch. */
  function prepareCreateService(guardValue:AccessAdminGuard,input:{readonly displayName:string},auditId?:string){
    const guard=captureGuard(guardValue),displayName=normalizeDisplayName(input?.displayName);
    if(!displayName)throw new MachineStoreInputError();
    const id=crypto.randomUUID(),claim=acquire(guard,'service-created',roomPrincipal,[],auditId);
    return Object.freeze({auditId:claim.auditId,output:Object.freeze({principal:{id,displayName,
      status:'active' as const,authVersion:1}}),statements:Object.freeze([
      claim.plan,
      planned(`INSERT INTO ${table.principals} (id,kind,status,auth_version,display_name,created_at_ms,updated_at_ms)
        SELECT ?,'service','active',1,?,${NOW},${NOW} WHERE ${claim.exists}`,
      [id,displayName,...claim.args()]),planTarget(claim,id),assertion(claim)])});
  }
  function prepareSetServiceStatus(guardValue:AccessAdminGuard,input:{readonly principalId:string;
    readonly expectedAuthVersion:number;readonly status:ServicePrincipal['status']},auditId?:string){
    const guard=captureGuard(guardValue);
    if(!validIdentityId(input?.principalId)||!positive(input.expectedAuthVersion)
      ||input.expectedAuthVersion>=MAX||!status(input.status))throw new MachineStoreInputError();
    const {principalId,expectedAuthVersion,status:nextStatus}=input;
    const claim=acquire(guard,'service-status-updated',`EXISTS (SELECT 1 FROM ${table.principals}
      WHERE id=? AND kind='service' AND auth_version=? AND status<>?)`,
      [principalId,expectedAuthVersion,nextStatus],auditId);
    return Object.freeze({auditId:claim.auditId,output:Object.freeze({principal:{id:principalId,
      status:nextStatus,authVersion:expectedAuthVersion+1}}),statements:Object.freeze([
      claim.plan,
      planned(`UPDATE ${table.principals} SET status=?,auth_version=auth_version+1,updated_at_ms=${NOW}
        WHERE id=? AND ${claim.exists}`,[nextStatus,principalId,...claim.args()]),
      planned(`UPDATE ${table.api_credentials} SET revoked_at_ms=${NOW} WHERE id IN
        (SELECT id FROM ${table.api_credentials} WHERE principal_id=? AND auth_version=?
          AND revoked_at_ms IS NULL AND expires_at_ms>${NOW} LIMIT ${MACHINE_STORE_LIMITS.revocationBatchSize})
        AND ${claim.exists}`,[principalId,expectedAuthVersion,...claim.args()]),
      planTarget(claim,principalId),assertion(claim)])});
  }
  function prepareIssueToken(guardValue:AccessAdminGuard,input:IssueMachineTokenInput,auditId?:string){
    const guard=captureGuard(guardValue),label=normalizeDisplayName(input?.label),scopes=parseMachineScopes(input?.scopes);
    if(!validIdentityId(input?.principalId)||!label||!digest(input?.digest)||!ttl(input?.ttlMs)||!scopes)
      throw new MachineStoreInputError();
    const {principalId,ttlMs}=input,id=crypto.randomUUID(),scopesJson=JSON.stringify(scopes);
    const claim=acquire(guard,'api-token-issued',`${roomGlobal} AND ${roomTarget}
      AND EXISTS (SELECT 1 FROM ${table.principals} WHERE id=? AND kind='service' AND status='active')
      AND NOT EXISTS (SELECT 1 FROM json_each(?) v WHERE NOT EXISTS (SELECT 1 FROM ${table.contexts}
        WHERE id=json_extract(v.value,'$.contextId') AND status='active'))`,
    [principalId,principalId,scopesJson],auditId);
    return Object.freeze({auditId:claim.auditId,output:Object.freeze({credential:{id,principalId,label,
      scopes,ttlMs}}),statements:Object.freeze([
      claim.plan,
      planned(`INSERT INTO ${table.api_credentials}
        (id,secret_hash,principal_id,auth_version,label,created_at_ms,expires_at_ms,revoked_at_ms,revocation_nonce)
        SELECT ?,?,id,auth_version,?,${NOW},${NOW}+?,NULL,NULL FROM ${table.principals}
        WHERE id=? AND ${claim.exists}`,[id,input.digest,label,ttlMs,principalId,...claim.args()]),
      planned(`INSERT INTO ${table.api_credential_scopes} (credential_id,context_id,audience,permission_id)
        SELECT ?,json_extract(t.value,'$.contextId'),json_extract(t.value,'$.audience'),p.value
        FROM json_each(?) t,json_each(t.value,'$.permissionIds') p WHERE ${claim.exists}`,
      [id,scopesJson,...claim.args()]),planTarget(claim,principalId,id),assertion(claim)])});
  }
  function prepareRevokeToken(guardValue:AccessAdminGuard,credentialId:string,auditId?:string){
    const guard=captureGuard(guardValue);
    if(!validIdentityId(credentialId))throw new MachineStoreInputError();
    const claim=acquire(guard,'api-token-revoked',`EXISTS (SELECT 1 FROM ${table.api_credentials}
      WHERE id=? AND revoked_at_ms IS NULL)`,[credentialId],auditId);
    return Object.freeze({auditId:claim.auditId,output:Object.freeze({credentialId,revoked:true}),
      statements:Object.freeze([claim.plan,
        planned(`UPDATE ${table.api_credentials} SET revoked_at_ms=${NOW},revocation_nonce=?
          WHERE id=? AND ${claim.exists}`,[claim.nonce,credentialId,...claim.args()]),
        planned(`UPDATE ${table.access_audit} SET target_principal_id=
          (SELECT principal_id FROM ${table.api_credentials} WHERE id=?),target_credential_id=?
          WHERE id=? AND claim_nonce=?`,[credentialId,credentialId,claim.auditId,claim.nonce]),
        assertion(claim)])});
  }
  async function readService(principalId:string):Promise<ServicePrincipal|null>{
    if(!validIdentityId(principalId))throw new MachineStoreInputError();
    const rows=await batch([statement(`SELECT id,display_name AS displayName,status,
      auth_version AS authVersion FROM ${table.principals} WHERE id=? AND kind='service' LIMIT 2`,[principalId])]);
    if(rows[0].results.length>1)throw new MachineStoreError();
    return rows[0].results.length?serviceRow(rows[0].results[0]):null;
  }

  async function issueToken(guardValue: AccessAdminGuard | LifecycleGuard, input: IssueMachineTokenInput): Promise<IssuedMachineCredential | null> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['principalId', 'label', 'digest', 'ttlMs', 'scopes'])
      || !validIdentityId(input.principalId) || !digest(input.digest) || !ttl(input.ttlMs)) throw new MachineStoreInputError();
    const label = normalizeDisplayName(input.label), scopes = parseMachineScopes(input.scopes);
    if (!label || !scopes) throw new MachineStoreInputError();
    const { principalId, digest: tokenDigest, ttlMs } = input;
    const id = crypto.randomUUID(), scopesJson = JSON.stringify(scopes);
    const claim = acquire(guard, 'api-token-issued', `${roomGlobal} AND ${roomTarget}
      AND EXISTS (SELECT 1 FROM ${table.principals} WHERE id = ? AND kind = 'service' AND status = 'active')
      AND NOT EXISTS (SELECT 1 FROM json_each(?) v WHERE NOT EXISTS (SELECT 1 FROM ${table.contexts}
        WHERE id = json_extract(v.value, '$.contextId') AND status = 'active'))`, [principalId, principalId, scopesJson]);
    return issued(await batch([
      claim.query,
      statement(`INSERT INTO ${table.api_credentials}
        (id, secret_hash, principal_id, auth_version, label, created_at_ms, expires_at_ms, revoked_at_ms, revocation_nonce)
        SELECT ?, ?, id, auth_version, ?, ${NOW}, ${NOW} + ?, NULL, NULL FROM ${table.principals}
        WHERE id = ? AND ${claim.exists}`, [id, tokenDigest, label, ttlMs, principalId, ...claim.args()]),
      statement(`INSERT INTO ${table.api_credential_scopes} (credential_id, context_id, audience, permission_id)
        SELECT ?, json_extract(t.value, '$.contextId'), json_extract(t.value, '$.audience'), p.value
        FROM json_each(?) t, json_each(t.value, '$.permissionIds') p WHERE ${claim.exists}`, [id, scopesJson, ...claim.args()]),
      recordTarget(claim, principalId, id),
      ...tokenProjectionQueries(id, claim),
    ]));
  }

  async function readToken(credentialId: string): Promise<StoredMachineCredential | null> {
    if (!validIdentityId(credentialId)) return null;
    const results = await batch(tokenProjectionQueries(credentialId));
    if (results[0].results.length === 0) return null;
    if (results[0].results.length !== 1) throw new MachineStoreError();
    return credentialRow(results[0].results[0], results[1].results);
  }
  async function readTokenForAdmin(guardValue:AccessAdminGuard,credentialId:string):Promise<StoredMachineCredential|null>{
    const guard=captureGuard(guardValue);
    if(!validIdentityId(credentialId))throw new MachineStoreInputError();
    const authority=accessAdminCondition(guard);
    const results=await batch([
      statement(`${credentialSelect} WHERE id=? AND ${authority.sql} LIMIT 2`,
        [credentialId,...authority.bindings]),
      statement(`${scopeSelect} WHERE credential_id=? AND ${authority.sql}
        ORDER BY context_id,audience,permission_id LIMIT ${MACHINE_SCOPE_LIMITS.permissions+1}`,
      [credentialId,...authority.bindings])]);
    if(results[0].results.length===0)return null;
    if(results[0].results.length!==1)throw new MachineStoreError();
    return credentialRow(results[0].results[0],results[1].results);
  }

  async function rotateToken(guardValue: AccessAdminGuard | LifecycleGuard, input: {
    readonly credentialId: string; readonly digest: string; readonly ttlMs: number;
  },auditId?:string): Promise<IssuedMachineCredential | null> {
    const guard = captureGuard(guardValue);
    if (!identityInputFields(input, ['credentialId', 'digest', 'ttlMs']) || !validIdentityId(input.credentialId)
      || !digest(input.digest) || !ttl(input.ttlMs)) throw new MachineStoreInputError();
    const { credentialId, digest: tokenDigest, ttlMs } = input;
    const id = crypto.randomUUID(), claim = acquire(guard, 'api-token-rotated',
      `EXISTS (SELECT 1 ${tokenFrom} WHERE k.id = ? AND ${liveToken})`, [credentialId],auditId);
    // The old token is revoked before creating its successor, so a rotation at
    // the live-token quota does not increase the number of active credentials.
    return issued(await batch([
      claim.query,
      statement(`UPDATE ${table.api_credentials} SET revoked_at_ms = ${NOW}, revocation_nonce = ?
        WHERE id = ? AND ${claim.exists}`, [claim.nonce, credentialId, ...claim.args()]),
      statement(`INSERT INTO ${table.api_credentials}
        (id, secret_hash, principal_id, auth_version, label, created_at_ms, expires_at_ms, revoked_at_ms, revocation_nonce)
        SELECT ?, ?, principal_id, auth_version, label, ${NOW}, ${NOW} + ?, NULL, NULL FROM ${table.api_credentials}
        WHERE id = ? AND revocation_nonce = ? AND ${claim.exists}`, [id, tokenDigest, ttlMs, credentialId, claim.nonce, ...claim.args()]),
      statement(`INSERT INTO ${table.api_credential_scopes} (credential_id, context_id, audience, permission_id)
        SELECT ?, context_id, audience, permission_id FROM ${table.api_credential_scopes}
        WHERE credential_id = ? AND ${claim.exists}`, [id, credentialId, ...claim.args()]),
      statement(`UPDATE ${table.access_audit} SET target_principal_id =
        (SELECT principal_id FROM ${table.api_credentials} WHERE id = ?), target_credential_id = ?
        WHERE id = ? AND claim_nonce = ?`, [id, id, claim.auditId, claim.nonce]),
      ...tokenProjectionQueries(id, claim),
    ]));
  }

  async function revokeToken(guardValue: AccessAdminGuard | LifecycleGuard, credentialId: string,auditId?:string): Promise<boolean> {
    const guard = captureGuard(guardValue);
    if (!validIdentityId(credentialId)) throw new MachineStoreInputError();
    const claim = acquire(guard, 'api-token-revoked', `EXISTS (SELECT 1 FROM ${table.api_credentials}
      WHERE id = ? AND revoked_at_ms IS NULL)`, [credentialId],auditId);
    const results = await batch([
      claim.query,
      statement(`UPDATE ${table.api_credentials} SET revoked_at_ms = ${NOW}, revocation_nonce = ?
        WHERE id = ? AND ${claim.exists}`, [claim.nonce, credentialId, ...claim.args()]),
      statement(`UPDATE ${table.access_audit} SET target_principal_id =
        (SELECT principal_id FROM ${table.api_credentials} WHERE id = ?), target_credential_id = ?
        WHERE id = ? AND claim_nonce = ?`, [credentialId, credentialId, claim.auditId, claim.nonce]),
    ]);
    const success = acquired(results);
    if (results[1].meta.changes !== Number(success) || results[2].meta.changes !== Number(success)) throw new MachineStoreError();
    return success;
  }

  return Object.freeze({ createService, setServiceStatus, readService, issueToken, readToken, readTokenForAdmin,
    rotateToken, revokeToken,
    prepareCreateService,prepareSetServiceStatus,prepareIssueToken,prepareRevokeToken });
}
