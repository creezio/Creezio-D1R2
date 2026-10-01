import type {DeliveryPhase, DeliveryReadiness} from './types.ts';

export type DeliveryResult<T> = Readonly<{ok: true; value: T} | {ok: false; code: string}>;
export interface DeliveryTarget {
  readonly accountId: string;
  readonly workerName: string;
}
export interface DeliverySecretConnection {
  readonly contextId: string;
  readonly reference: string;
  readonly bindingId: string;
  readonly label: string;
}
export interface DeliverySecretSelection {
  readonly contextId: string;
  readonly reference: string;
  readonly bindingId: string;
  readonly mode: 'rewrap' | 'disable';
}
/** The credential exists only in the form and this one transport call. */
export interface DeliveryConfigureInput {
  readonly target: DeliveryTarget;
  readonly credentials: Readonly<{apiToken: string}>;
}
export interface DeliveryInspection {
  readonly hostProfile: 'docker-local' | 'other';
  readonly configuration: DeliveryReadiness;
  readonly preparation: DeliveryReadiness;
  /** Resolved non-secret target, used to re-enter a lost operator credential for the same transfer. */
  readonly target: DeliveryTarget | null;
  readonly activeTransferId: string | null;
  /** Opaque references and display labels only; never plaintext secret values. */
  readonly secretConnections: readonly DeliverySecretConnection[];
}
export interface DeliveryPlanSummary {
  readonly title: string;
  readonly details: readonly string[];
  readonly warnings: readonly string[];
}
export interface DeliveryPrepared {
  readonly transferId: string;
  readonly planDigest: string;
  readonly summary: DeliveryPlanSummary;
}
export interface DeliveryTransferStatus {
  readonly transferId: string;
  readonly planDigest: string;
  readonly phase: DeliveryPhase;
  /** Present while prepared so a reloaded UI can review the exact plan before start. */
  readonly summary: DeliveryPlanSummary | null;
  readonly finalUrl: string | null;
  readonly registryStatus: 'pending' | 'effective' | 'unknown';
}
export interface DeliveryUpdateInspection {
  readonly kind: 'update';
  readonly readiness: 'needed' | 'ready';
  readonly currentPublicationId: string | null;
  readonly activeUpdateId: string | null;
  readonly target: DeliveryTarget | null;
}
export interface DeliveryUpdatePrepared {
  readonly kind: 'update';
  readonly updateId: string;
  readonly planDigest: string;
  readonly summary: DeliveryPlanSummary;
}
export type DeliveryUpdatePhase = 'prepared' | 'building' | 'built' | 'preflight'
  | 'schema-applying' | 'schema-ready' | 'publishing' | 'delivery-unknown' | 'rejected' | 'delivered';
export interface DeliveryUpdateStatus {
  readonly kind: 'update';
  readonly updateId: string;
  readonly planDigest: string;
  readonly phase: DeliveryUpdatePhase;
  readonly summary: DeliveryPlanSummary | null;
  readonly finalUrl: string | null;
  readonly registryStatus: 'pending' | 'unknown' | 'effective';
  /** Native local scope signal. Remote proof is checked only when retry is requested. */
  readonly retryEligible?: boolean;
  /** Sanitized publisher failure; absence leaves the outcome unknown. */
  readonly diagnostic?: Readonly<{phase:'wrangler'|'post-upload'|'unknown';
    reason:'spawn_error'|'exit_nonzero'|'output_limit'|'timeout'|'inspection_failed'|'unavailable';
    exitCode:number|null;apiCodes:readonly number[];
    /** Closed classification of Cloudflare validation code 10021; never raw provider output. */
    validationIssue?:'startup_cpu_limit'|'startup_memory_limit'|'syntax_error'
      |'unsupported_handler'|'unknown_validation'}>;
}

/** Host-owned local operator boundary. Implementations validate the HTTP DTO and reuse admin session/CSRF/ACL. */
export interface DeliveryTransport {
  inspect(): Promise<DeliveryResult<DeliveryInspection>>;
  configure(input: DeliveryConfigureInput): Promise<DeliveryResult<DeliveryInspection>>;
  prepare(input: Readonly<{secretSelections: readonly DeliverySecretSelection[]}>): Promise<DeliveryResult<DeliveryPrepared>>;
  start(input: Readonly<{transferId: string; planDigest: string}>): Promise<DeliveryResult<DeliveryTransferStatus>>;
  status(transferId: string): Promise<DeliveryResult<DeliveryTransferStatus>>;
  reconcile(input: Readonly<{transferId: string; planDigest: string}>): Promise<DeliveryResult<DeliveryTransferStatus>>;
  inspectUpdate(): Promise<DeliveryResult<DeliveryUpdateInspection>>;
  prepareUpdate(): Promise<DeliveryResult<DeliveryUpdatePrepared>>;
  startUpdate(input: Readonly<{updateId: string; planDigest: string}>): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  statusUpdate(updateId: string): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  reconcileUpdate(input: Readonly<{updateId: string; planDigest: string}>): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  retryUpdate(input: Readonly<{updateId: string; planDigest: string}>): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  /** Added after earlier local adapters; absence means checked refusal is unavailable. */
  rejectUpdate?(input: Readonly<{updateId: string; planDigest: string}>): Promise<DeliveryResult<DeliveryUpdateStatus>>;
}
