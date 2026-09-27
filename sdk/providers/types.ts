import type {JsonValue} from '../../core/data/types.ts';
import type {DataPlan} from '../../core/data/types.ts';

/** Public, provider-neutral contract. Credentials and HTTP clients remain in the host. */
export interface ProviderDescriptor {
  readonly id: string;
  readonly capabilities: Readonly<{text: boolean; functionTools: boolean; resumableStream: boolean}>;
}

export interface ProviderTool {
  /** The host's declared operation binding, reauthorized before execution. */
  readonly bindingId: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonValue;
  readonly schemaDigest: string;
  /** False permits declared optional properties; the host still validates every call. Defaults to true. */
  readonly strict?: boolean;
}

export interface ProviderLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxOutputTokens: number;
  readonly maxToolCalls: number;
  readonly deadlineMs: number;
}

export interface ProviderCreateInput {
  readonly turnId: string;
  readonly modelId: string;
  /** Provider-neutral message and tool-result items, bounded by the host. */
  readonly inputItems: readonly JsonValue[];
  readonly tools: readonly ProviderTool[];
  readonly limits: ProviderLimits;
}

export type ProviderState = 'queued' | 'running' | 'needs_tools' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type ProviderEvent = Readonly<{
  readonly cursor: number;
  readonly kind: 'text_delta';
  readonly text: string;
} | {
  readonly cursor: number;
  readonly kind: 'function_call';
  readonly callId: string;
  readonly name: string;
  readonly arguments: JsonValue;
} | {
  readonly cursor: number;
  readonly kind: 'usage';
  readonly inputTokens: number;
  readonly outputTokens: number;
} | {
  readonly cursor: number;
  readonly kind: 'terminal';
  readonly state: Exclude<ProviderState, 'queued' | 'running' | 'needs_tools'>;
  readonly errorCode?: string;
}>;

export interface ProviderReceipt {
  readonly responseId: string;
  /** Cursor of response.created; checkpoint it before consuming events. */
  readonly cursor: number;
}
export interface ProviderStream {
  readonly receipt: ProviderReceipt;
  readonly events: AsyncIterable<ProviderEvent>;
}
export interface ProviderSnapshot {
  readonly responseId: string;
  readonly state: ProviderState;
  readonly cursor: number | null;
  readonly events: readonly ProviderEvent[];
}
export interface ProviderTransport {
  /** Resolves after response.created, before the remaining stream is consumed. */
  create(input: ProviderCreateInput, signal: AbortSignal): Promise<ProviderStream>;
  /** Resumes a known response only; never creates a replacement. */
  resume(responseId: string, afterCursor: number, signal: AbortSignal): AsyncIterable<ProviderEvent>;
  status(responseId: string, signal: AbortSignal): Promise<ProviderSnapshot>;
  cancel(responseId: string, signal: AbortSignal): Promise<ProviderSnapshot>;
}

/** Host-owned fixed-endpoint capability. It injects the context's provider credential. */
export interface ProviderHttpPort {
  request(input: Readonly<{method: 'GET' | 'POST'; resource: 'models' | 'responses' | 'response' | 'response-stream' | 'response-cancel';
    responseId?: string; afterCursor?: number; body?: JsonValue; signal: AbortSignal}>): Promise<Response>;
}

/** Static mapping exported by a provider module for the trusted host resolver. */
export interface ProviderConfigStorage {
  readonly moduleId: string;
  readonly modelId: string;
  readonly contextField: string;
  readonly fields: Readonly<{id:string; modelId:string; apiKeyRef:string;
    secretVersion:string; enabled:string; revision:string; updatedAt:string}>;
}

/** Narrow host capability given only to the trusted provider configuration handler. */
export interface ProviderSecretsPort {
  preparePut(input:Readonly<{providerId:string; secret:string}>):Promise<Readonly<{plan:DataPlan; reference:string; version:number}>>;
  prepareReplace(input:Readonly<{providerId:string; reference:string; expectedVersion:number; secret:string}>):
    Promise<Readonly<{plan:DataPlan; reference:string; version:number}>>;
  prepareRevoke(input:Readonly<{providerId:string; reference:string; expectedVersion:number}>):
    Promise<Readonly<{plan:DataPlan; version:number}>>;
}
