import type { ComponentType } from 'react';
import type { WorkspaceViewProps } from '../workspace/types.ts';
import type {FrontThemeComponent, PublicFrontViewProps} from '../front/types.ts';

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
  /** Exact locked runtime archive integrity for restoring a compatible front panel. */
  readonly moduleIntegrity: string;
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

export type RuntimeFrontSelection = Readonly<{kind:'workspace'} | {kind:'headless'}
  | {kind:'theme';moduleId:string;theme:string}>;
/** Public views receive only presentational props; protected views use the existing workspace SDK. */
export type RuntimeFrontView =
  | (Omit<RuntimeView,'access'|'component'> & {readonly access:'public-read';
      readonly component:ComponentType<PublicFrontViewProps>})
  | (Omit<RuntimeView,'access'|'component'> & {readonly access:'protected';
      readonly component:ComponentType<WorkspaceViewProps>});
export type RuntimeFrontNavigation = RuntimeNavigation;
export interface RuntimeFrontSlot {
  readonly id:string;
  readonly moduleId:string;
  readonly slot:string;
  readonly viewId:string;
  readonly surfaces:readonly ('workspace'|'front')[];
  readonly audiences:readonly ('admin'|'app')[];
  readonly permissions:readonly RuntimePermissionRef[];
}
export interface RuntimeFrontTheme {
  readonly id:string;
  readonly moduleId:string;
  readonly slots:readonly string[];
  readonly component:FrontThemeComponent;
}
export interface RuntimeFrontCatalog {
  readonly compositionDigest:string;
  readonly front:RuntimeFrontSelection;
  readonly views:readonly Omit<RuntimeFrontView,'component'|'validateInput'|'validateState'>[];
  readonly navigation:readonly RuntimeFrontNavigation[];
  readonly slots:readonly RuntimeFrontSlot[];
  readonly theme:Readonly<Omit<RuntimeFrontTheme,'component'>>|null;
}
