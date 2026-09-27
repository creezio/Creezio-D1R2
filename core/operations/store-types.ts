import type { DataAccess, DataLease, DataPlan, JsonValue } from '../data/types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import type { SqlStatement } from '../data/authorization.ts';

export type ExecutionState = 'running' | 'waiting' | 'succeeded' | 'failed' | 'unknown';
export type DeliveryState = 'queued' | 'claimed' | 'succeeded' | 'failed' | 'unknown';
export interface OperationExecution {
  readonly id: string; readonly moduleId: string; readonly operationId: string; readonly operationVersion: string;
  readonly actorPrincipalId: string; readonly principalId: string; readonly contextId: string; readonly audience: 'admin' | 'app';
  readonly inputHash: string; readonly state: ExecutionState; readonly output: JsonValue;
  readonly errorCode: string | null; readonly createdAtMs: number; readonly updatedAtMs: number;
  readonly claimExpiresAtMs: number; readonly retainedUntilMs: number;
}
/** Nonces never leave the host store. Shape alone cannot mint either claim. */
export interface OperationClaim { readonly kind: 'operation-claim' }
export interface DeliveryClaim { readonly kind: 'operation-delivery-claim' }
export interface OperationStart {
  readonly operationId: string; readonly operationVersion: string; readonly keyHash: string; readonly inputHash: string;
  readonly claimTtlMs: number; readonly retentionMs: number;
}
export type OperationStartResult = { readonly kind: 'acquired'; readonly claim: OperationClaim; readonly execution: OperationExecution }
  | { readonly kind: 'existing'; readonly execution: OperationExecution };
/** Host-validated provider intent, not credentials or an arbitrary network request. */
export interface OperationOutboxIntent {
  readonly id: string; readonly provider: string; readonly payload: JsonValue; readonly providerIdempotencyKey: string;
}
export interface OperationDelivery {
  readonly id: string; readonly executionId: string; readonly provider: string; readonly payload: JsonValue;
  readonly providerIdempotencyKey: string; readonly state: DeliveryState; readonly receipt: JsonValue;
  readonly createdAtMs: number; readonly updatedAtMs: number; readonly claimExpiresAtMs: number | null;
}
/** Host-only reference obtained from a provider acknowledgement. Never returned to a module or browser. */
export interface OperationDeliveryCheckpoint {
  readonly providerReference: string; readonly cursor: number;
  /** Host-only bounded result of a read tool, retained until the continuation is appended. */
  readonly pendingTool?:JsonValue;
}
export interface OperationStore {
  start(lease: DataLease, input: OperationStart): Promise<OperationStartResult>;
  read(lease: DataLease, executionId: string): Promise<OperationExecution | null>;
  /** Read by the original idempotency key without acquiring or resuming a claim. */
  lookup(lease: DataLease, input: { readonly operationId: string; readonly keyHash: string }): Promise<OperationExecution | null>;
  commit(lease: DataLease, claim: OperationClaim, input: {
    readonly plans: readonly DataPlan[]; readonly output: JsonValue; readonly outbox?: readonly OperationOutboxIntent[];
    /** Trusted host Access statements; never accepted from an operation handler. */
    readonly nativeStatements?: readonly SqlStatement[];
  }): Promise<OperationExecution>;
  /** Rejection is allowed only before any business commit attempt or external emission. */
  fail(lease: DataLease, claim: OperationClaim, code: string): Promise<OperationExecution>;
  markUnknown(lease: DataLease, claim: OperationClaim, code: string): Promise<OperationExecution>;
  /** Explicit host invocation for resumable, pure plan preparation. No provider retry. */
  resume(lease: DataLease, input: { readonly executionId: string; readonly inputHash: string; readonly claimTtlMs: number }): Promise<OperationStartResult>;
  claimDelivery(lease: DataLease, input: { readonly executionId: string; readonly outboxId: string; readonly claimTtlMs: number }): Promise<{
    readonly claim: DeliveryClaim; readonly delivery: OperationDelivery;
  } | null>;
  /** Persist the provider handle before reading its stream. The active claim and cursor are checked atomically. */
  checkpointDelivery(lease: DataLease, claim: DeliveryClaim, checkpoint: OperationDeliveryCheckpoint,
    plans?: readonly DataPlan[]): Promise<OperationDelivery>;
  /** Acquire a fresh observation claim only for a delivery whose provider handle is already durable. */
  resumeKnownDelivery(lease: DataLease, input: { readonly executionId: string; readonly outboxId: string; readonly claimTtlMs: number }): Promise<{
    readonly claim: DeliveryClaim; readonly delivery: OperationDelivery;
  } | null>;
  /** Commit a tool result's business plans and its next provider step under the current delivery claim. */
  appendDelivery(lease: DataLease, claim: DeliveryClaim, input: {
    readonly plans: readonly DataPlan[]; readonly intent: OperationOutboxIntent;
  }): Promise<OperationDelivery>;
  settleDelivery(lease: DataLease, claim: DeliveryClaim, input: {
    readonly state: 'succeeded' | 'failed' | 'unknown'; readonly receipt?: JsonValue;
  }, plans?:readonly DataPlan[]): Promise<OperationDelivery>;
  readDelivery(lease: DataLease, input: { readonly executionId: string; readonly outboxId: string }): Promise<OperationDelivery | null>;
  /** Resolve a host-generated turn intent inside the current actor/context scope. */
  findDelivery(lease:DataLease,outboxId:string):Promise<OperationDelivery|null>;
}
export interface OperationStoreOptions { readonly db: IdentityDatabase; readonly data: DataAccess }
export class OperationStoreError extends Error {
  readonly code: 'invalid_input' | 'invalid_claim' | 'conflict' | 'unavailable';
  constructor(code: OperationStoreError['code']) { super(`Operation storage refused (${code}).`); this.name = 'OperationStoreError'; this.code = code; }
}
export const OPERATION_STORE_LIMITS = Object.freeze({ minimumClaimTtlMs: 1000, maximumClaimTtlMs: 30_000,
  maximumRetentionMs: 365 * 24 * 60 * 60 * 1000, outputBytes: 262_144, payloadBytes: 32_768,
  receiptBytes: 16_384, outbox: 8, attempts: 32 });
