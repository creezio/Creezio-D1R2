import { createDataTransactionExecutor, type HostDataBatch } from '../data/service.ts';
import { copyJson, keys, record, validId, quote } from '../data/input.ts';
import type { DataLease, DataPlan, JsonValue } from '../data/types.ts';
import type { SqlStatement } from '../data/authorization.ts';
import { OPERATION_TABLES } from './models.ts';
import { OPERATION_STORE_LIMITS as LIMITS, OperationStoreError,
  type OperationStoreOptions, type OperationStore, type OperationExecution, type OperationClaim,
  type OperationDelivery, type DeliveryClaim, type OperationStart, type OperationStartResult,
  type OperationOutboxIntent } from './store-types.ts';

const T = Object.freeze(Object.fromEntries(Object.entries(OPERATION_TABLES).map(([id, name]) => [id, quote(name)]))) as Record<keyof typeof OPERATION_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const sql = (sql: string, ...bindings: (string | number | null)[]): SqlStatement => ({ sql, bindings });
const id = () => crypto.randomUUID();
const fail = (code: OperationStoreError['code']): never => { throw new OperationStoreError(code); };
const hash = (value: unknown): value is string => typeof value === 'string' && value.length === 71 && /^sha256:[a-f0-9]{64}$/.test(value);
const version = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && /^[\x21-\x7e]+$/.exec(value)?.[0] === value;
const duration = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= LIMITS.minimumClaimTtlMs && Number(value) <= LIMITS.maximumClaimTtlMs;
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const executionColumns = `id,module_id,operation_id,operation_version,actor_principal_id,principal_id,context_id,audience,
 input_hash,state,output,error_code,claim_nonce,created_at_ms,updated_at_ms,claim_expires_at_ms,retained_until_ms`;
const deliveryColumns = `id,execution_id,intent_id,provider,provider_idempotency_key,payload,state,receipt,claim_nonce,
 created_at_ms,updated_at_ms,claim_expires_at_ms`;
const uncertainDelivery = `EXISTS(SELECT 1 FROM ${T.outbox} d WHERE d.execution_id=${T.executions}.id
  AND (d.state='unknown' OR (d.state='claimed' AND d.claim_expires_at_ms<=${NOW}))) AS uncertain_delivery`;
type Identity = ReturnType<OperationStoreOptions['data']['describeLease']>;
interface ClaimState { readonly identity: Identity; readonly executionId: string; readonly nonce: string; attempted: boolean }
interface DeliveryClaimState { readonly identity: Identity; readonly executionId: string; readonly outboxId: string; readonly nonce: string; attempted: boolean }

function capture(value: unknown, maximumBytes = 65_536): JsonValue {
  try { return copyJson(value, maximumBytes); } catch { return fail('invalid_input'); }
}
function equalIdentity(a: Identity, b: Identity) {
  // Credential instances may rotate. The effective actor/subject and scope may not.
  return a.moduleId === b.moduleId && a.actorPrincipalId === b.actorPrincipalId && a.principalId === b.principalId
    && a.contextId === b.contextId && a.audience === b.audience;
}
function scopeWhere(identity: Identity, alias = '') {
  const p = alias ? alias + '.' : '';
  return sql(`${p}module_id=? AND ${p}actor_principal_id=? AND ${p}principal_id=? AND ${p}context_id=? AND ${p}audience=?`,
    identity.moduleId, identity.actorPrincipalId, identity.principalId, identity.contextId, identity.audience);
}
async function scopeHash(who: Identity, operationId: string, keyHash: string): Promise<string> {
  const scopeBytes = new TextEncoder().encode(JSON.stringify([who.moduleId, operationId,
    who.actorPrincipalId, who.principalId, who.contextId, who.audience, keyHash]));
  return 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', scopeBytes)),
    b => b.toString(16).padStart(2, '0')).join('');
}
function decodedJson(value: unknown, maximumBytes: number): JsonValue {
  if (value === null) return null;
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > maximumBytes) return fail('unavailable');
  try { return copyJson(JSON.parse(value), maximumBytes); } catch { return fail('unavailable'); }
}
function execution(row: Record<string, unknown>): OperationExecution {
  for (const key of ['id','module_id','operation_id','actor_principal_id','principal_id','context_id']) if (!validId(row[key])) fail('unavailable');
  if (!version(row.operation_version)) fail('unavailable');
  if (!hash(row.input_hash) || !['admin', 'app'].includes(String(row.audience))
    || !['running','waiting','succeeded','failed','unknown'].includes(String(row.state))
    || row.error_code !== null && !validId(row.error_code)) fail('unavailable');
  for (const key of ['created_at_ms','updated_at_ms','claim_expires_at_ms','retained_until_ms','now_ms']) if (!timestamp(row[key])) fail('unavailable');
  const state = row.state === 'running' && Number(row.claim_expires_at_ms) <= Number(row.now_ms)
    || row.state === 'waiting' && row.uncertain_delivery === 1 ? 'unknown' : row.state;
  return Object.freeze({ id: String(row.id), moduleId: String(row.module_id), operationId: String(row.operation_id), operationVersion: String(row.operation_version),
    actorPrincipalId: String(row.actor_principal_id), principalId: String(row.principal_id), contextId: String(row.context_id), audience: row.audience as 'admin' | 'app',
    inputHash: String(row.input_hash), state: state as OperationExecution['state'], output: decodedJson(row.output, LIMITS.outputBytes),
    errorCode: row.error_code as string | null, createdAtMs: Number(row.created_at_ms), updatedAtMs: Number(row.updated_at_ms),
    claimExpiresAtMs: Number(row.claim_expires_at_ms), retainedUntilMs: Number(row.retained_until_ms) });
}
function delivery(row: Record<string, unknown>): OperationDelivery {
  for (const key of ['id','execution_id','intent_id','provider']) if (!validId(row[key])) fail('unavailable');
  if (typeof row.provider_idempotency_key !== 'string' || !row.provider_idempotency_key || row.provider_idempotency_key.length > 256
    || !['queued','claimed','succeeded','failed','unknown'].includes(String(row.state))) fail('unavailable');
  for (const key of ['created_at_ms','updated_at_ms','now_ms']) if (!timestamp(row[key])) fail('unavailable');
  if (row.claim_expires_at_ms !== null && !timestamp(row.claim_expires_at_ms)) fail('unavailable');
  const state = row.state === 'claimed' && Number(row.claim_expires_at_ms) <= Number(row.now_ms) ? 'unknown' : row.state;
  return Object.freeze({ id: String(row.intent_id), executionId: String(row.execution_id), provider: String(row.provider),
    providerIdempotencyKey: String(row.provider_idempotency_key), state: state as OperationDelivery['state'],
    payload: decodedJson(row.payload, LIMITS.payloadBytes), receipt: decodedJson(row.receipt, LIMITS.receiptBytes),
    createdAtMs: Number(row.created_at_ms), updatedAtMs: Number(row.updated_at_ms), claimExpiresAtMs: row.claim_expires_at_ms as number | null });
}

/** Trusted host store. SQL is generated only here, on the same binding and fresh
 * T05 guard as opaque business plans. Neither store nor DB reaches handlers.
 * External effects are not transactions: a claimed delivery is never reissued. */
export function createOperationStore({ db, data }: OperationStoreOptions): OperationStore {
  const transactions = createDataTransactionExecutor(data, db);
  const claims = new WeakMap<OperationClaim, ClaimState>(), deliveries = new WeakMap<DeliveryClaim, DeliveryClaimState>();
  const identity = (lease: DataLease) => data.describeLease(lease);
  async function run(lease: DataLease, batch: HostDataBatch) {
    try { return await transactions.execute(lease, batch); }
    catch { return fail('unavailable'); }
  }
  const assert = (condition: SqlStatement) => sql(`SELECT CASE WHEN (${condition.sql}) THEN 1 ELSE json('creezio_operation_guard_failed') END AS accepted`, ...condition.bindings);
  function executionQuery(executionId: string, who: Identity) {
    const scope = scopeWhere(who);
    return sql(`SELECT ${executionColumns},${NOW} AS now_ms,${uncertainDelivery} FROM ${T.executions} WHERE id=? AND ${scope.sql} LIMIT 1`, executionId, ...scope.bindings);
  }
  function executionSizeGuard(executionId: string, who: Identity) {
    const scope = scopeWhere(who);
    return assert(sql(`NOT EXISTS(SELECT 1 FROM ${T.executions} WHERE id=? AND ${scope.sql} AND length(CAST(output AS BLOB))>?)`,
      executionId, ...scope.bindings, LIMITS.outputBytes));
  }
  function audit(executionId: string, who: Identity, event: string, nonce: string | null, outboxId: string | null = null,
    code: string | null = null, condition?: SqlStatement) {
    return sql(`INSERT INTO ${T.audit}(id,execution_id,attempt_nonce,outbox_id,event,actor_principal_id,principal_id,context_id,audience,code,created_at_ms)
      SELECT ?,?,?,?,?,?,?,?,?,?,${NOW}${condition ? ` WHERE ${condition.sql}` : ''}`,
    id(), executionId, nonce, outboxId, event, who.actorPrincipalId, who.principalId, who.contextId, who.audience, code, ...(condition?.bindings ?? []));
  }
  function ownClaim(lease: DataLease, claim: OperationClaim, mark = false) {
    const state = claim && typeof claim === 'object' ? claims.get(claim) : undefined;
    if (!state || state.attempted || !equalIdentity(state.identity, identity(lease))) return fail('invalid_claim');
    if (mark) state.attempted = true;
    return state;
  }
  const claimCondition = (state: ClaimState, requireLive = true) => sql(`EXISTS(SELECT 1 FROM ${T.executions}
    WHERE id=? AND claim_nonce=? AND state='running'${requireLive ? ` AND claim_expires_at_ms>${NOW}` : ''})`, state.executionId, state.nonce);
  const newClaim = (who: Identity, executionId: string, nonce: string): OperationClaim => {
    const token: OperationClaim = Object.freeze({ kind: 'operation-claim' });
    claims.set(token, { identity: who, executionId, nonce, attempted: false }); return token;
  };
  async function start(lease: DataLease, input: OperationStart): Promise<OperationStartResult> {
    const captured = capture(input); record(captured); keys(captured, ['operationId','operationVersion','keyHash','inputHash','claimTtlMs','retentionMs']);
    if (!validId(captured.operationId) || !version(captured.operationVersion) || !hash(captured.keyHash) || !hash(captured.inputHash)
      || !duration(captured.claimTtlMs) || !Number.isSafeInteger(captured.retentionMs)
      || Number(captured.retentionMs) < 1000 || Number(captured.retentionMs) > LIMITS.maximumRetentionMs) return fail('invalid_input');
    const who = identity(lease), executionId = id(), nonce = id(), attemptId = id();
    const scopedKey = await scopeHash(who, String(captured.operationId), String(captured.keyHash));
    const acquired = sql(`EXISTS(SELECT 1 FROM ${T.executions} WHERE id=? AND claim_nonce=?)`, executionId, nonce);
    const result = await run(lease, { write: true, after: [
      sql(`INSERT INTO ${T.executions}(id,scope_hash,input_hash,module_id,operation_id,operation_version,actor_principal_id,principal_id,context_id,audience,
        state,output,error_code,claim_nonce,attempt_number,created_at_ms,updated_at_ms,claim_expires_at_ms,retained_until_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,'running',NULL,NULL,?,1,${NOW},${NOW},${NOW}+?,${NOW}+?) ON CONFLICT(scope_hash) DO NOTHING`,
      executionId, scopedKey, captured.inputHash, who.moduleId, captured.operationId, captured.operationVersion,
      who.actorPrincipalId, who.principalId, who.contextId, who.audience, nonce, captured.claimTtlMs, Number(captured.retentionMs)),
      sql(`INSERT INTO ${T.attempts}(id,execution_id,claim_nonce,number,state,created_at_ms,settled_at_ms)
        SELECT ?,?,?,1,'running',${NOW},NULL WHERE ${acquired.sql}`, attemptId, executionId, nonce, ...acquired.bindings),
      audit(executionId, who, 'started', nonce, null, null, acquired),
      assert(sql(`NOT EXISTS(SELECT 1 FROM ${T.executions} WHERE scope_hash=? AND length(CAST(output AS BLOB))>?)`, scopedKey, LIMITS.outputBytes)),
      sql(`SELECT ${executionColumns},${NOW} AS now_ms,${uncertainDelivery} FROM ${T.executions} WHERE scope_hash=? LIMIT 1`, scopedKey),
    ] });
    const row = result.after.at(-1)?.results[0];
    if (!row) return fail('unavailable');
    if (row.input_hash !== captured.inputHash || row.operation_version !== captured.operationVersion
      || Number(row.retained_until_ms) <= Number(row.now_ms)) return fail('conflict');
    const projected = execution(row);
    return row.id === executionId && row.claim_nonce === nonce
      ? Object.freeze({ kind: 'acquired', claim: newClaim(who, executionId, nonce), execution: projected })
      : Object.freeze({ kind: 'existing', execution: projected });
  }
  async function read(lease: DataLease, executionId: string) {
    if (!validId(executionId)) return fail('invalid_input');
    const who = identity(lease), result = await run(lease, { write: false, after: [executionSizeGuard(executionId, who), executionQuery(executionId, who)] });
    return result.after[1].results[0] ? execution(result.after[1].results[0]) : null;
  }
  async function lookup(lease: DataLease, input: { readonly operationId: string; readonly keyHash: string }) {
    const captured = capture(input); record(captured); keys(captured, ['operationId', 'keyHash']);
    if (!validId(captured.operationId) || !hash(captured.keyHash)) return fail('invalid_input');
    const who = identity(lease), scopedKey = await scopeHash(who, String(captured.operationId), String(captured.keyHash));
    const scope = scopeWhere(who);
    const where = `scope_hash=? AND operation_id=? AND ${scope.sql} AND retained_until_ms>${NOW}`;
    const bindings = [scopedKey, String(captured.operationId), ...scope.bindings];
    const result = await run(lease, { write: false, after: [
      assert(sql(`NOT EXISTS(SELECT 1 FROM ${T.executions} WHERE ${where} AND length(CAST(output AS BLOB))>?)`,
        ...bindings, LIMITS.outputBytes)),
      sql(`SELECT ${executionColumns},${NOW} AS now_ms,${uncertainDelivery} FROM ${T.executions} WHERE ${where} LIMIT 1`,
        ...bindings),
    ] });
    return result.after[1].results[0] ? execution(result.after[1].results[0]) : null;
  }
  async function commit(lease: DataLease, claim: OperationClaim, input: { readonly plans: readonly DataPlan[]; readonly output: JsonValue;
    readonly outbox?: readonly OperationOutboxIntent[]; readonly nativeStatements?: readonly SqlStatement[] }) {
    // Plans are opaque: capture their container without recursively copying capabilities.
    const desc = input && typeof input === 'object' ? Object.getOwnPropertyDescriptors(input) : null;
    if (!desc || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(desc).some(key => !['plans','output','outbox','nativeStatements'].includes(String(key)))
      || !desc.plans || !desc.output || Object.values(desc).some(d => !Object.hasOwn(d, 'value'))) return fail('invalid_input');
    const output = capture(desc.output.value, LIMITS.outputBytes), outbox = capture(desc.outbox?.value ?? [], LIMITS.outbox * LIMITS.payloadBytes + 8192);
    if (!Array.isArray(outbox) || outbox.length > LIMITS.outbox) return fail('invalid_input');
    const intents = new Set<string>();
    for (const item of outbox) {
      record(item); keys(item, ['id','provider','payload','providerIdempotencyKey']);
      if (!validId(item.id) || intents.has(item.id) || !validId(item.provider) || typeof item.providerIdempotencyKey !== 'string'
        || !item.providerIdempotencyKey || item.providerIdempotencyKey.length > 256 || /[\u0000-\u001f\u007f]/.test(item.providerIdempotencyKey)) return fail('invalid_input');
      capture(item.payload, LIMITS.payloadBytes); intents.add(item.id);
    }
    const state = ownClaim(lease, claim, true), who = state.identity;
    const nativeStatements = desc.nativeStatements?.value ?? [];
    if (!Array.isArray(nativeStatements) || nativeStatements.length && (who.moduleId !== 'creezio.access'
      || !Array.isArray(desc.plans.value) || desc.plans.value.length !== 0 || outbox.length !== 0)) return fail('invalid_input');
    const statements: SqlStatement[] = [
      sql(`UPDATE ${T.executions} SET state=?,output=?,error_code=NULL,updated_at_ms=${NOW} WHERE id=? AND claim_nonce=?`,
        outbox.length ? 'waiting' : 'succeeded', JSON.stringify(output), state.executionId, state.nonce),
      sql(`UPDATE ${T.attempts} SET state='succeeded',settled_at_ms=${NOW} WHERE execution_id=? AND claim_nonce=? AND state='running'`, state.executionId, state.nonce),
    ];
    for (const item of outbox as unknown as readonly OperationOutboxIntent[]) statements.push(sql(
      `INSERT INTO ${T.outbox}(id,execution_id,intent_id,provider,provider_idempotency_key,payload,state,receipt,claim_nonce,created_at_ms,updated_at_ms,claim_expires_at_ms)
       VALUES(?,?,?,?,?,?,'queued',NULL,NULL,${NOW},${NOW},NULL)`, id(), state.executionId, item.id, item.provider, item.providerIdempotencyKey, JSON.stringify(item.payload)));
    // A late audit failure must roll back every business write, result and outbox row.
    statements.push(audit(state.executionId, who, 'committed', state.nonce), executionQuery(state.executionId, who));
    const result = await run(lease, { write: true, before: [assert(claimCondition(state))], plans: desc.plans.value,
      after: [...nativeStatements, ...statements] });
    const row = result.after.at(-1)?.results[0]; if (!row) return fail('unavailable'); return execution(row);
  }
  async function finish(lease: DataLease, claim: OperationClaim, code: string, unknown: boolean) {
    if (!validId(code)) return fail('invalid_input');
    const state = ownClaim(lease, claim, true), event = unknown ? 'unknown' : 'failed';
    const result = await run(lease, { write: true, before: [assert(claimCondition(state, false))], after: [
      sql(`UPDATE ${T.executions} SET state=?,error_code=?,updated_at_ms=${NOW} WHERE id=? AND claim_nonce=?`, event, code, state.executionId, state.nonce),
      sql(`UPDATE ${T.attempts} SET state=?,settled_at_ms=${NOW} WHERE execution_id=? AND claim_nonce=?`, event, state.executionId, state.nonce),
      audit(state.executionId, state.identity, event, state.nonce, null, code), executionQuery(state.executionId, state.identity),
    ] });
    const row = result.after.at(-1)?.results[0]; if (!row) return fail('unavailable'); return execution(row);
  }
  async function resume(lease: DataLease, input: { readonly executionId: string; readonly inputHash: string; readonly claimTtlMs: number }): Promise<OperationStartResult> {
    const captured = capture(input); record(captured); keys(captured, ['executionId','inputHash','claimTtlMs']);
    if (!validId(captured.executionId) || !hash(captured.inputHash) || !duration(captured.claimTtlMs)) return fail('invalid_input');
    const who = identity(lease), nonce = id(), scope = scopeWhere(who);
    const acquired = sql(`EXISTS(SELECT 1 FROM ${T.executions} WHERE id=? AND claim_nonce=?)`, captured.executionId, nonce);
    const result = await run(lease, { write: true, after: [
      sql(`UPDATE ${T.executions} SET claim_nonce=?,attempt_number=attempt_number+1,claim_expires_at_ms=${NOW}+?,updated_at_ms=${NOW}
       WHERE id=? AND ${scope.sql} AND input_hash=? AND state='running' AND claim_expires_at_ms<=${NOW} AND retained_until_ms>${NOW}
       AND attempt_number<? AND NOT EXISTS(SELECT 1 FROM ${T.outbox} WHERE execution_id=?)`, nonce, captured.claimTtlMs, captured.executionId,
      ...scope.bindings, captured.inputHash, LIMITS.attempts, captured.executionId),
      sql(`UPDATE ${T.attempts} SET state='unknown',settled_at_ms=${NOW} WHERE execution_id=? AND state='running' AND ${acquired.sql}`,
        captured.executionId, ...acquired.bindings),
      sql(`INSERT INTO ${T.attempts}(id,execution_id,claim_nonce,number,state,created_at_ms,settled_at_ms)
       SELECT ?,id,claim_nonce,attempt_number,'running',${NOW},NULL FROM ${T.executions} WHERE id=? AND claim_nonce=?`, id(), captured.executionId, nonce),
      audit(captured.executionId, who, 'resumed', nonce, null, null, acquired),
      executionSizeGuard(captured.executionId, who), executionQuery(captured.executionId, who),
    ] });
    const row = result.after.at(-1)?.results[0];
    if (!row || row.input_hash !== captured.inputHash || Number(row.retained_until_ms) <= Number(row.now_ms)) return fail('conflict');
    const projected = execution(row);
    return row.claim_nonce === nonce ? Object.freeze({ kind: 'acquired', claim: newClaim(who, String(row.id), nonce), execution: projected })
      : Object.freeze({ kind: 'existing', execution: projected });
  }
  function deliveryScope(executionId: string, who: Identity) {
    const scope = scopeWhere(who, 'e');
    return sql(`EXISTS(SELECT 1 FROM ${T.executions} e WHERE e.id=? AND ${scope.sql})`, executionId, ...scope.bindings);
  }
  function deliveryQuery(executionId: string, outboxId: string, who: Identity) {
    const scope = deliveryScope(executionId, who);
    return sql(`SELECT ${deliveryColumns},${NOW} AS now_ms FROM ${T.outbox} WHERE execution_id=? AND intent_id=? AND ${scope.sql} LIMIT 1`,
      executionId, outboxId, ...scope.bindings);
  }
  function deliverySizeGuard(executionId: string, outboxId: string, who: Identity) {
    const scope = deliveryScope(executionId, who);
    return assert(sql(`NOT EXISTS(SELECT 1 FROM ${T.outbox} WHERE execution_id=? AND intent_id=? AND ${scope.sql}
      AND (length(CAST(payload AS BLOB))>? OR length(CAST(receipt AS BLOB))>?))`, executionId, outboxId, ...scope.bindings, LIMITS.payloadBytes, LIMITS.receiptBytes));
  }
  async function readDelivery(lease: DataLease, input: { readonly executionId: string; readonly outboxId: string }) {
    const captured = capture(input); record(captured); keys(captured, ['executionId','outboxId']);
    if (!validId(captured.executionId) || !validId(captured.outboxId)) return fail('invalid_input');
    const who = identity(lease), result = await run(lease, { write: false, after: [deliverySizeGuard(captured.executionId, captured.outboxId, who),
      deliveryQuery(captured.executionId, captured.outboxId, who)] });
    return result.after[1].results[0] ? delivery(result.after[1].results[0]) : null;
  }
  async function claimDelivery(lease: DataLease, input: { readonly executionId: string; readonly outboxId: string; readonly claimTtlMs: number }) {
    const captured = capture(input); record(captured); keys(captured, ['executionId','outboxId','claimTtlMs']);
    if (!validId(captured.executionId) || !validId(captured.outboxId) || !duration(captured.claimTtlMs)) return fail('invalid_input');
    const who = identity(lease), nonce = id(), scope = deliveryScope(captured.executionId, who);
    const acquired = sql(`EXISTS(SELECT 1 FROM ${T.outbox} WHERE execution_id=? AND intent_id=? AND claim_nonce=?)`, captured.executionId, captured.outboxId, nonce);
    const result = await run(lease, { write: true, after: [
      sql(`UPDATE ${T.outbox} SET state='claimed',claim_nonce=?,claim_expires_at_ms=${NOW}+?,updated_at_ms=${NOW}
       WHERE execution_id=? AND intent_id=? AND state='queued' AND ${scope.sql}`, nonce, captured.claimTtlMs, captured.executionId, captured.outboxId, ...scope.bindings),
      audit(captured.executionId, who, 'delivery-claimed', nonce, captured.outboxId, null, acquired),
      deliverySizeGuard(captured.executionId, captured.outboxId, who), deliveryQuery(captured.executionId, captured.outboxId, who),
    ] });
    const row = result.after.at(-1)?.results[0];
    if (!row || row.claim_nonce !== nonce) return null;
    const token: DeliveryClaim = Object.freeze({ kind: 'operation-delivery-claim' });
    deliveries.set(token, { identity: who, executionId: captured.executionId, outboxId: captured.outboxId, nonce, attempted: false });
    return Object.freeze({ claim: token, delivery: delivery(row) });
  }
  async function settleDelivery(lease: DataLease, claim: DeliveryClaim, input: { readonly state: 'succeeded' | 'failed' | 'unknown'; readonly receipt?: JsonValue }) {
    const captured = capture(input, LIMITS.receiptBytes + 256); record(captured); keys(captured, ['state'], ['receipt']);
    if (typeof captured.state !== 'string' || !['succeeded','failed','unknown'].includes(captured.state)) return fail('invalid_input');
    const receipt = capture(captured.receipt ?? null, LIMITS.receiptBytes);
    const state = claim && typeof claim === 'object' ? deliveries.get(claim) : undefined;
    if (!state || state.attempted || !equalIdentity(state.identity, identity(lease))) return fail('invalid_claim');
    state.attempted = true;
    // A positive reply may arrive after the claim deadline. Its exact nonce can
    // settle that emission, but never authorizes a second emission.
    const result = await run(lease, { write: true, before: [assert(sql(`EXISTS(SELECT 1 FROM ${T.outbox}
      WHERE execution_id=? AND intent_id=? AND claim_nonce=? AND state IN ('claimed','unknown'))`, state.executionId, state.outboxId, state.nonce))], after: [
      sql(`UPDATE ${T.outbox} SET state=?,receipt=?,updated_at_ms=${NOW} WHERE execution_id=? AND intent_id=? AND claim_nonce=?`,
        String(captured.state), JSON.stringify(receipt), state.executionId, state.outboxId, state.nonce),
      sql(`UPDATE ${T.executions} SET state=CASE
        WHEN EXISTS(SELECT 1 FROM ${T.outbox} WHERE execution_id=? AND state='unknown') THEN 'unknown'
        WHEN EXISTS(SELECT 1 FROM ${T.outbox} WHERE execution_id=? AND state IN ('queued','claimed')) THEN 'waiting'
        WHEN EXISTS(SELECT 1 FROM ${T.outbox} WHERE execution_id=? AND state='failed') THEN 'failed' ELSE 'succeeded' END,
        updated_at_ms=${NOW} WHERE id=?`, state.executionId, state.executionId, state.executionId, state.executionId),
      audit(state.executionId, state.identity, `delivery-${captured.state}`, state.nonce, state.outboxId),
      deliveryQuery(state.executionId, state.outboxId, state.identity),
    ] });
    const row = result.after.at(-1)?.results[0]; if (!row) return fail('unavailable'); return delivery(row);
  }
  return Object.freeze({ start, read, lookup, commit, resume, readDelivery, claimDelivery, settleDelivery,
    fail: (lease, claim, code) => finish(lease, claim, code, false), markUnknown: (lease, claim, code) => finish(lease, claim, code, true) } satisfies OperationStore);
}
export { OPERATION_STORE_LIMITS, OperationStoreError } from './store-types.ts';
