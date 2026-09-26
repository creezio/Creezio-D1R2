import type { RuntimeProfile } from '../../adapters/runtime-profiles.ts';

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
  readonly handler: RuntimeHandler;
}
export interface RuntimeModule {
  readonly id: string;
  readonly version: string;
  readonly operations: readonly RuntimeOperation[];
}
export interface RuntimeDefinition {
  readonly modules: readonly RuntimeModule[];
  readonly compositionDigest: string;
}
export interface RuntimeExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
export interface CreezioRuntime {
  fetch(request: Request, environment: unknown, executionContext?: RuntimeExecutionContext): Promise<Response | null>;
}
