import type { ComponentType } from 'react';
import type { AccessAudience, AccessController } from '../access/types.ts';
import type { createOperationClient } from '../operations/client.ts';

export type WorkspaceOperationClient = ReturnType<typeof createOperationClient>;

export type WorkspaceInput = Readonly<Record<string, string>>;
export interface WorkspacePanelPolicy {
  readonly identityFields: readonly string[];
  readonly navigation: 'sdk';
  readonly retention: 'preserve' | 'discard';
  readonly inactiveEffects: 'suspend' | 'explicit-read-only';
}
export interface WorkspaceViewProps {
  readonly input: WorkspaceInput;
  /** Stable identity of the containing retained panel. */
  readonly panelId: string;
  /** Canonical, authorized location currently shown in this panel. */
  readonly location: WorkspaceLocation;
  readonly contextId: string;
  readonly audience: AccessAudience;
  readonly active: boolean;
  readonly navigation: WorkspaceNavigation;
  readonly client: WorkspaceOperationClient;
}
export interface WorkspaceView {
  readonly id: string;
  readonly moduleId: string;
  readonly title: string;
  readonly route: string;
  readonly surfaces: readonly ('workspace' | 'front')[];
  readonly audiences: readonly AccessAudience[];
  readonly panel: WorkspacePanelPolicy;
  /** Generated standalone validator for the declared UI input schema. */
  readonly validateInput?: (input: unknown) => boolean;
  /** Build-compiled validator for explicitly persistable, non-secret view state. */
  readonly validateState?: (state: unknown) => boolean;
  readonly component: ComponentType<WorkspaceViewProps>;
}
export interface WorkspaceNavigationItem {
  readonly id: string;
  readonly title: string;
  readonly viewId: string;
  readonly order: number;
}
/** A host read bound to a freshly verified session, context and composition. */
export interface WorkspaceProjection {
  readonly sessionId: string;
  readonly principalId: string;
  readonly audience: AccessAudience;
  readonly contextId: string;
  readonly compositionDigest: string;
  readonly epoch: number;
  readonly viewIds: readonly string[];
  readonly navigationIds: readonly string[];
}
export interface WorkspaceLocation {
  readonly viewId: string;
  readonly input: WorkspaceInput;
  readonly url: string;
  readonly identity: string;
}
/** Small presentation state; `data` requires a declared non-secret schema.
 * A save may remain in mounted memory while savePanelState returns false when
 * sessionStorage is unavailable or rejects the persisted snapshot. */
export interface WorkspacePanelState {
  readonly activeSubview?: string;
  readonly scrollTop?: number;
  readonly scrollLeft?: number;
  readonly data?: Readonly<Record<string, unknown>>;
}
export interface WorkspaceTab {
  readonly id: string;
  readonly title: string;
  readonly locked: boolean;
  readonly pinned: boolean;
  readonly history: readonly WorkspaceLocation[];
  readonly historyIndex: number;
  readonly location: WorkspaceLocation;
  readonly panelState?: WorkspacePanelState;
}
export interface WorkspaceSnapshot {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string | null;
}
export interface WorkspaceNavigation {
  open(viewId: string, input?: WorkspaceInput, options?: {newTab?: boolean; replace?: boolean}): boolean;
  visit(url: string, options?: {newTab?: boolean; replace?: boolean}): boolean;
  back(): boolean;
  forward(): boolean;
  readPanelState(): WorkspacePanelState | null;
  savePanelState(state: WorkspacePanelState): boolean;
}
export interface WorkspaceProps {
  readonly access: AccessController;
  readonly projection: WorkspaceProjection | null;
  readonly views: readonly WorkspaceView[];
  readonly navigation: readonly WorkspaceNavigationItem[];
  readonly client: WorkspaceOperationClient;
  readonly contextId: string;
  readonly initialUrl?: string;
  /** Optional landing view; opened as the first, non-closable tab. */
  readonly homeViewId?: string;
  readonly onLocationChange?: (url: string) => void;
}
