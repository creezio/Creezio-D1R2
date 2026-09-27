import type { AuthorizationAudience, AuthorizationTarget, PermissionDefinition } from '../authorization/types.ts';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface ContractReference { readonly moduleId: string; readonly kind: string; readonly id: string }
export interface DataField {
  readonly id: string; readonly type: 'string' | 'integer' | 'number' | 'boolean' | 'date-time' | 'json';
  readonly nullable: boolean; readonly protected: boolean; readonly computed: boolean;
  readonly default?: JsonValue; readonly schema?: { readonly schemaId: string };
  readonly constraints?: { readonly minLength?: number; readonly maxLength?: number; readonly minimum?: number;
    readonly maximum?: number; readonly enum?: readonly JsonValue[]; readonly pattern?: string };
}
export interface DataModel {
  readonly id: string; readonly title: string; readonly scope: 'context' | 'application'; readonly contextField?: string;
  readonly fields: readonly DataField[]; readonly primaryKey: readonly string[];
  readonly indexes: readonly { readonly id: string; readonly fields: readonly string[]; readonly unique: boolean }[];
  readonly relations: readonly { readonly id: string; readonly fields: readonly string[]; readonly target: ContractReference;
    readonly targetFields: readonly string[]; readonly onDelete: string }[];
  readonly permissions: readonly ContractReference[]; readonly deletion: { readonly mode: 'soft' | 'hard'; readonly requiresApproval: boolean };
  readonly public: boolean;
}
export type DataAction = 'read' | 'create' | 'update' | 'delete';
export interface DataPermission {
  readonly id: string; readonly audiences: PermissionDefinition['audiences']; readonly actors: readonly string[];
  /** Presentation from the module contract; never participates in authorization. */
  readonly title?: string;
  readonly actions: readonly string[]; readonly resources: readonly ContractReference[];
}
export interface RuntimeDataCatalog {
  readonly schemaVersion: 1; readonly compositionDigest: string;
  readonly modules: readonly { readonly moduleId: string; readonly version: string; readonly enabled: boolean;
    readonly permissions: readonly DataPermission[];
    readonly models: readonly { readonly modelId: string; readonly table: string; readonly model: DataModel }[] }[];
}
/** Opaque request-local capabilities. Their shape alone never authenticates them. */
export interface DataLease { readonly kind: 'data-lease' }
export interface DataPlan { readonly kind: 'data-plan' }
export type DataCredential = { readonly kind: 'session' | 'api-token' | 'impersonation'; readonly token: unknown }
  | { readonly kind: 'oauth'; readonly token: unknown; readonly resource: string };
export type DataRecord = Readonly<Record<string, JsonValue>>;
export interface DataRead { readonly key: DataRecord; readonly fields?: readonly string[]; readonly where?: DataRecord; readonly required?: boolean }
export interface DataList { readonly limit: number; readonly after?: DataRecord | null; readonly where?: DataRecord; readonly fields?: readonly string[] }
export interface DataCreate { readonly values: DataRecord }
export interface DataCompare { readonly field: string; readonly expected: number }
export interface DataPatch { readonly key: DataRecord; readonly values: DataRecord; readonly compare?: DataCompare;
  readonly where?: DataRecord }
export interface DataDelete { readonly key: DataRecord; readonly compare?: DataCompare; readonly where?: DataRecord }
export interface DataBatchResult { readonly rows: readonly DataRecord[]; readonly changes: number }
export interface DataPort {
  planGet(modelId: string, input: DataRead): DataPlan;
  planList(modelId: string, input: DataList): DataPlan;
  planCreate(modelId: string, input: DataCreate): DataPlan;
  planPatch(modelId: string, input: DataPatch): DataPlan;
  planDelete(modelId: string, input: DataDelete): DataPlan;
  get(modelId: string, input: DataRead): Promise<DataRecord | null>;
  list(modelId: string, input: DataList): Promise<{ readonly items: readonly DataRecord[]; readonly nextAfter: DataRecord | null }>;
  create(modelId: string, input: DataCreate): Promise<{ readonly changes: number }>;
  patch(modelId: string, input: DataPatch): Promise<{ readonly changes: number }>;
  delete(modelId: string, input: DataDelete): Promise<{ readonly changes: number }>;
}
export interface InternalDataPortOptions { readonly moduleId: string; readonly modelId: string; readonly fields: readonly string[] }
export interface DataAccess {
  authorize(credential: DataCredential, target: AuthorizationTarget, owner: { readonly moduleId: string }): Promise<DataLease>;
  forModule(lease: DataLease, moduleId: string): DataPort;
  /** Core services only. Never hand this factory or its protected-field port to a module handler. */
  internalPort(lease: DataLease, options: InternalDataPortOptions): DataPort;
  describeLease(lease: DataLease): Readonly<{moduleId: string; contextId: string; audience: AuthorizationAudience;
    principalId: string; actorPrincipalId: string; credentialKind: DataCredential['kind']}>;
  /** Additional declared resource permissions; cannot replace or weaken the operation target. */
  requirePermissions(lease: DataLease, permissionIds: readonly string[]): void;
  readBatch(lease: DataLease, plans: readonly DataPlan[]): Promise<readonly DataBatchResult[]>;
  commitBatch(lease: DataLease, plans: readonly DataPlan[]): Promise<readonly DataBatchResult[]>;
  dispose(lease: DataLease): void;
}
export type DataErrorCode = 'invalid_input' | 'invalid_catalog' | 'unauthorized' | 'forbidden' | 'invalid_lease'
  | 'invalid_plan' | 'unsupported' | 'storage_error';
export class DataAccessError extends Error {
  readonly code: DataErrorCode;
  constructor(code: DataErrorCode) { super(`Data access refused (${code}).`); this.name = 'DataAccessError'; this.code = code; }
}
export const DATA_LIMITS = Object.freeze({ page: 50, plans: 16, statements: 48, bindings: 100,
  inputBytes: 65_536, leaseMs: 30_000, resultBytes: 262_144, fields: 100, conditions: 32 });
export type { AuthorizationAudience, AuthorizationTarget, PermissionDefinition };
