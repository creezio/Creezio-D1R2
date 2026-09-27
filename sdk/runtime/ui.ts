import type { ComponentType } from 'react';
import type { WorkspaceViewProps } from '../workspace/types.ts';

export type RuntimeViewProps = WorkspaceViewProps;
export interface RuntimePermissionRef { readonly moduleId: string; readonly kind: 'permission'; readonly id: string }
export interface RuntimeNavigation {
  readonly id: string;
  readonly moduleId: string;
  readonly title: string;
  readonly viewId: string;
  readonly order: number;
  readonly surfaces: readonly ('workspace' | 'front')[];
  readonly audiences: readonly ('admin' | 'app')[];
  readonly permissions: readonly RuntimePermissionRef[];
}

/** Build-time view projection. Visibility does not grant backend permissions. */
export interface RuntimeView {
  readonly id: string;
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly route: string;
  readonly title: string;
  readonly surfaces: readonly ('workspace' | 'front')[];
  readonly permissions: readonly RuntimePermissionRef[];
  readonly operations: readonly { readonly moduleId: string; readonly kind: 'operation'; readonly id: string }[];
  readonly input: { readonly schemaId: string };
  readonly validateInput: (input: unknown) => boolean;
  readonly validateState?: (state: unknown) => boolean;
  readonly panel: {
    readonly stateSchema?: {readonly schemaId: string};
    readonly identityFields: readonly string[];
    readonly navigation: 'sdk';
    readonly retention: 'preserve' | 'discard';
    readonly inactiveEffects: 'suspend' | 'explicit-read-only';
  };
  readonly audiences: readonly ('admin' | 'app')[];
  readonly access: 'public-read' | 'protected';
  readonly component: ComponentType<RuntimeViewProps>;
}
