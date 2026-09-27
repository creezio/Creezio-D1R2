/** Préparation P5 hors dépôt. À copier/ajuster dans sdk/widgets/types.ts après GO. */

export type WidgetAudience = 'admin' | 'app';
export type WidgetDigest = `sha256-${string}`;

export interface WidgetMessageInstanceV1 {
  readonly instanceId: string;
  readonly instanceRevision: number;
  readonly moduleId: string;
  readonly widgetId: string;
  readonly widgetVersion: string;
  readonly resourceUri: string;
  readonly resourceDigest: WidgetDigest;
  /** Host-created pointer to the durable read execution supplying render input. */
  readonly renderExecution?: Readonly<{moduleId: string; operationId: string;
    operationDigest: WidgetDigest; executionId: string}>;
  /** Value validated against the compiled P1 state schema, never a credential. */
  readonly state: unknown;
  readonly objectRef?: string;
  readonly objectVersion?: number | string;
}

/** Value of conversation message.content, not the whole authorized message row. */
export interface WidgetMessageContentV1 {
  readonly kind: 'creezio.widget-message';
  readonly schemaVersion: 1;
  /** One to four entries; whole JSON value at most 4096 UTF-8 bytes. */
  readonly instances: readonly WidgetMessageInstanceV1[];
}

export type WidgetInstanceRef = Readonly<{
  instanceId: string;
  instanceRevision: number;
  moduleId: string;
  widgetId: string;
  widgetVersion: string;
  audience: WidgetAudience;
  objectRef?: string;
  objectVersion?: number | string;
} & (
  | {host: 'creezio'; conversationId: string; messageId: string}
  | {host: 'external-mcp'; invocationRequestId: string; resourceUri: string}
)>;

export interface WidgetActionEnvelope {
  /** Host-created, persisted before dispatch; Engine requestKey for Creezio commands. */
  readonly requestId: string;
  readonly instance: WidgetInstanceRef;
  readonly actionId: string;
  readonly input: unknown;
  readonly expectedObjectVersion?: number | string;
}

export interface WidgetActionOutcome {
  readonly requestId: string;
  readonly instanceId: string;
  readonly instanceRevision: number;
  readonly state: 'transmitted' | 'succeeded' | 'rejected' | 'unknown';
  readonly code?: string;
  readonly output?: unknown;
  readonly objectVersion?: number | string;
  readonly executionId?: string;
}

/** Public intent port. Host-specific adapters implement its operations. */
export interface WidgetActionPort {
  previewMessage(request: WidgetActionEnvelope): Promise<Readonly<{
    requestId: string; text: string; state: 'proposed';
  }>>;
  sendProposedMessage(requestId: string, explicitUserGesture: true): Promise<WidgetActionOutcome>;
  replaceContext(request: WidgetActionEnvelope): Promise<WidgetActionOutcome>;
  removeContext(request: WidgetActionEnvelope): Promise<WidgetActionOutcome>;
  invokeDirect(request: WidgetActionEnvelope): Promise<WidgetActionOutcome>;
  reconcile(requestId: string, instanceId: string): Promise<WidgetActionOutcome>;
}

/** Lifecycle surface; resource/profile lookup belongs to the host implementation. */
export interface WidgetBridgePort {
  initialize(instance: WidgetInstanceRef, capabilities: readonly string[]): Promise<void>;
  dispatch(request: WidgetActionEnvelope): Promise<WidgetActionOutcome>;
  dispose(instanceId: string): void;
}
