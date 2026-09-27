import type { ComponentType, ReactNode } from 'react';
import type { WorkspaceInput, WorkspaceLocation, WorkspaceNavigation } from '../workspace/types.ts';

export interface FrontBrand {
  readonly name: string;
  readonly description?: string;
}

/** The theme receives presentation data and host-owned commands only. */
export interface FrontThemeProps {
  readonly brand: FrontBrand;
  readonly account: { readonly displayName: string } | null;
  readonly navigation: readonly {
    readonly id: string;
    readonly title: string;
    readonly viewId: string;
    readonly order: number;
    readonly active: boolean;
  }[];
  readonly location: WorkspaceLocation | null;
  readonly children: ReactNode;
  readonly renderSlot: (slot: string) => ReactNode;
  readonly navigate: (viewId: string, input?: WorkspaceInput) => boolean;
  readonly onLogin: () => void;
  readonly onLogout: () => void;
  readonly onRefresh: () => void;
}

export type FrontThemeComponent = ComponentType<FrontThemeProps>;

/** Anonymous public-read views have no native session or operation client. */
export interface PublicFrontViewProps {
  readonly input: WorkspaceInput;
  readonly location: WorkspaceLocation;
  readonly audience: 'app';
  readonly active: boolean;
  readonly navigation: Pick<WorkspaceNavigation, 'open' | 'visit'>;
}

export interface FrontProjection {
  readonly sessionId: string;
  readonly principalId: string;
  readonly audience: 'app';
  readonly contextId: string;
  readonly compositionDigest: string;
  readonly epoch: number;
  readonly viewIds: readonly string[];
  readonly navigationIds: readonly string[];
  readonly slotIds: readonly string[];
}
