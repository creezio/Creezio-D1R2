import type { AuthorizationAudience } from '../authorization/types.ts';
import type { OperationExecution } from './store-types.ts';

/** Static, build-validated projection of one active contracts.api declaration. */
export interface OperationHttpBinding {
  readonly id: string;
  readonly contributorModuleId: string;
  readonly moduleId: string;
  readonly operationId: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly audience: AuthorizationAudience;
  readonly auth: readonly ('session' | 'api-token' | 'oauth' | 'impersonation' | 'anonymous' | 'webhook-signature')[];
  readonly parameters: readonly { readonly name: string; readonly in: 'path' | 'query' | 'header';
    readonly inputField: string; readonly required: boolean;
    readonly codec: 'string' | 'integer' | 'number' | 'boolean' }[];
  readonly inputSchemaId: string;
  readonly outputSchemaId: string;
  readonly context: 'application' | 'required';
  readonly kind: 'query' | 'command';
  readonly rateLimit: Readonly<{ requests: number; windowSeconds: number }>;
  readonly contractDigest: string;
}

/** The HTTP surface never serializes credentials, hashes, claims or audit internals. */
export interface OperationHttpExecution {
  readonly id: string;
  readonly state: OperationExecution['state'];
  readonly output: OperationExecution['output'];
  readonly errorCode: string | null;
  readonly replayed?: boolean;
}
export interface OperationHttpResult { readonly execution: OperationHttpExecution }
export interface OperationHttpError { readonly error: Readonly<{ code: string }>; readonly requestId: string }

/** Reserved host status read; root owns its final route and dispatch. */
export interface OperationHttpStatusTarget {
  readonly contributorModuleId: string; readonly bindingId: string; readonly executionId: string;
  readonly audience: AuthorizationAudience; readonly contextId: string;
}
/** Read-only reconciliation for a declared binding with required idempotency. */
export interface OperationHttpLookupTarget {
  readonly contributorModuleId: string; readonly bindingId: string; readonly requestKey: string;
  readonly audience: AuthorizationAudience; readonly contextId: string;
}
