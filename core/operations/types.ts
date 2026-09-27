import type { AuthorizationActor, AuthorizationAudience } from '../authorization/types.ts';
import type { ContractReference, DataPlan, DataPort, JsonValue } from '../data/types.ts';
import type { OperationOutboxIntent } from './store-types.ts';

/** The canonical v1 declaration is compiled once; transports do not invent an operation policy. */
export interface OperationDeclaration {
  readonly id: string; readonly title: string; readonly kind: 'query' | 'command';
  readonly input: { readonly schemaId: string }; readonly output: { readonly schemaId: string };
  readonly permissions: readonly ContractReference[];
  readonly audiences: readonly AuthorizationAudience[];
  readonly actors: readonly (AuthorizationActor | 'anonymous' | 'signed-webhook')[];
  readonly context: 'application' | 'required';
  readonly handler: { readonly path: string; readonly export: string };
  readonly effects: { readonly reads: readonly ContractReference[]; readonly writes: readonly ContractReference[];
    readonly emits: readonly ContractReference[]; readonly calls: readonly ContractReference[]; readonly providers: readonly string[] };
  readonly errors: readonly { readonly code: string; readonly retryable: boolean; readonly outcome: 'rejected' | 'unknown' }[];
  readonly pagination: { readonly mode: 'none' } | { readonly mode: 'cursor'; readonly cursorField: string; readonly limitField: string; readonly maxItems: number };
  readonly idempotency: { readonly mode: 'none' } | { readonly mode: 'required'; readonly keyField: string;
    readonly scope: 'actor-context-operation'; readonly retentionSeconds: number };
  readonly approval: { readonly mode: 'none' } | { readonly mode: 'required'; readonly permission: ContractReference;
    readonly bind: readonly string[]; readonly expiresAfterSeconds: number };
  readonly concurrency: { readonly mode: 'none' | 'object-version'; readonly versionField?: string };
  readonly execution: { readonly maxDurationMs: number; readonly maxItems: number; readonly resumable: boolean;
    readonly resumeOperation?: ContractReference; readonly cancelOperation?: ContractReference; readonly progressSchema?: { readonly schemaId: string } };
  readonly audit: { readonly required: true; readonly redactFields: readonly string[] };
  readonly public: boolean; readonly requiresModules?: readonly string[];
}

export interface RuntimeOperationCatalog {
  readonly schemaVersion: 1; readonly compositionDigest: string;
  readonly modules: readonly { readonly moduleId: string; readonly version: string; readonly enabled: boolean;
    readonly schemas: readonly { readonly schemaId: string; readonly validator: string }[];
    readonly operations: readonly { readonly operation: OperationDeclaration; readonly active: boolean;
      readonly contractDigest: string; readonly inputValidator: string; readonly outputValidator: string; readonly progressValidator?: string }[] }[];
}
/** Generated at build time. Runtime validation never evaluates a schema or loads remote code. */
export type OperationValidator = (input: unknown) => boolean;
export type OperationValidators = Readonly<Record<string, OperationValidator>>;
/** No immediate mutation, free SQL, transaction executor or identity credential reaches module code. */
export type OperationDataPort = Pick<DataPort, 'get' | 'list' | 'planGet' | 'planList' | 'planCreate' | 'planPatch' | 'planDelete'>;
export interface OperationContext {
  readonly moduleId: string; readonly operationId: string; readonly executionId: string;
  readonly contextId: string; readonly audience: AuthorizationAudience;
  readonly principalId: string; readonly actorPrincipalId: string; readonly signal: AbortSignal;
  readonly data: OperationDataPort;
}
export interface OperationHandlerResult {
  readonly output: unknown;
  readonly plans?: readonly DataPlan[];
  readonly outbox?: readonly OperationOutboxIntent[];
}
export type OperationHandler = (input: JsonValue, context: OperationContext) => OperationHandlerResult | Promise<OperationHandlerResult>;
export type OperationHandlers = Readonly<Record<string, OperationHandler>>;
export interface RegisteredOperation {
  readonly moduleId: string; readonly moduleVersion: string; readonly contractDigest: string; readonly declaration: OperationDeclaration;
  readonly validateInput: OperationValidator; readonly validateOutput: OperationValidator; readonly handler: OperationHandler;
}
export type OperationErrorCode = 'invalid_catalog' | 'not_found' | 'invalid_input' | 'invalid_output' | 'unsupported'
  | 'unauthorized' | 'forbidden' | 'conflict' | 'unavailable' | 'unknown' | 'cancelled' | 'timeout';
export class OperationError extends Error {
  readonly code: OperationErrorCode;
  constructor(code: OperationErrorCode) { super(`Operation refused (${code}).`); this.name = 'OperationError'; this.code = code; }
}
export const OPERATION_LIMITS = Object.freeze({ inputBytes: 65_536, outputBytes: 262_144, catalogBytes: 2_097_152,
  operations: 1000, maxDurationMs: 30_000, maxPlans: 16 });
