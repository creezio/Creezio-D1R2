import type { ComponentType } from 'react';

/** Build-time view projection. Visibility does not grant backend permissions. */
export interface RuntimeView {
  readonly id: string;
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly route: string;
  readonly title: string;
  readonly surfaces: readonly ('workspace' | 'front')[];
  readonly permissions: readonly { readonly moduleId: string; readonly kind: string; readonly id: string }[];
  readonly audiences: readonly ('admin' | 'app')[];
  readonly access: 'public-read' | 'protected';
  readonly component: ComponentType;
}
