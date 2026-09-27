import type { RuntimeProfile } from '../../adapters/runtime-profiles.ts';
import type { RuntimeEnvironment } from './environment.ts';
import type { OperationHandler } from '../operations/types.ts';

export type RuntimeMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RuntimeInput {
  readonly params: Readonly<Record<string, string>>;
  /** Untrusted request data, never an actor, permission or resolved context. */
  readonly query: URLSearchParams;
}
export interface RuntimeOperationContext {
  readonly moduleId: string;
  readonly profile: RuntimeProfile;
  readonly requestId: string;
  /** Abort-aware I/O should stop on request cancellation or the declared handler deadline. */
  readonly signal: AbortSignal;
}
export type RuntimeHandler = (input: RuntimeInput, context: RuntimeOperationContext) => Response | Promise<Response>;
export interface RuntimeOperation {
  /** API binding identity. Multiple bindings may call the same canonical operation. */
  readonly id: string;
  readonly operationId?: string;
  /** Module owning the canonical operation and its handler, possibly different from the API contributor. */
  readonly ownerModuleId: string;
  readonly method: RuntimeMethod;
  readonly path: string;
  readonly access: 'public-read' | 'protected';
  readonly maxDurationMs: number;
  /** Canonical handlers execute only through declaredHttp. The public metadata
   * harness also accepts its original Response adapter, without data access. */
  readonly handler: RuntimeHandler | OperationHandler;
}
export interface RuntimeModule {
  readonly id: string;
  readonly version: string;
  readonly operations: readonly RuntimeOperation[];
}
/** Explicit native access transport audiences; absence means both are disabled. */
export type RuntimeNativeAccess = Readonly<{ admin: boolean; app: boolean }>;
export interface RuntimeDefinition {
  readonly modules: readonly RuntimeModule[];
  readonly compositionDigest: string;
  readonly nativeAccess?: RuntimeNativeAccess;
  /** Host-owned adapter over compiled declarations and the common operation engine. */
  readonly declaredHttp?: {
    dispatch(request: Request, resolved: RuntimeEnvironment, environment: unknown, requestId: string): Promise<Response | null>;
  };
}
export interface RuntimeExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
export interface CreezioRuntime {
  fetch(request: Request, environment: unknown, executionContext?: RuntimeExecutionContext): Promise<Response | null>;
}
