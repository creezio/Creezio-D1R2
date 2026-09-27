/** Presentation data for the local delivery view. It contains no credential or secret value. */
export type DeliveryConnection = 'connected' | 'reconnecting' | 'unavailable';
export type DeliveryReadiness = 'unknown' | 'needed' | 'ready';

/** The operator persists these milestones; starting and capturing are transient UI states. */
export type DeliveryPhase = 'prepared' | 'starting' | 'capturing' | 'captured' | 'schema-ready'
  | 'd1-copying' | 'r2-copying' | 'secrets-ready' | 'verified'
  | 'delivery-unknown' | 'delivered';
export type DeliveryStepId = 'capture' | 'schema' | 'd1' | 'r2' | 'secrets' | 'verify' | 'publish';
export type DeliveryStepStatus = 'waiting' | 'current' | 'done' | 'attention';

export interface DeliveryStepViewModel {
  readonly id: DeliveryStepId;
  readonly label: string;
  readonly status: DeliveryStepStatus;
}

/** The client adapter will populate this from validated local-operator responses. */
export interface DeliveryViewInput {
  readonly profile: 'docker-local';
  readonly connection: DeliveryConnection;
  readonly configuration: DeliveryReadiness;
  readonly preparation: DeliveryReadiness;
  readonly planReviewed: boolean;
  readonly transfer: Readonly<{id: string; phase: DeliveryPhase}> | null;
}

export interface DeliveryViewModel {
  readonly profileLabel: string;
  readonly connection: DeliveryConnection;
  readonly connectionLabel: string;
  readonly headline: string;
  readonly detail: string;
  readonly transferId: string | null;
  readonly steps: readonly DeliveryStepViewModel[];
  readonly showCaptureNotice: boolean;
  readonly canConfigure: boolean;
  readonly canPrepare: boolean;
  readonly canStart: boolean;
  readonly canRefresh: boolean;
  readonly canReconcile: boolean;
}
