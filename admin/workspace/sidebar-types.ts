import type { ComponentType, ReactNode } from 'react';

export type SidebarIcon = ComponentType<{className?: string}>;
export type SidebarSelectOptions = Readonly<{newTab: boolean}>;

/** The host passes only destinations admitted by the current workspace projection. */
export type SidebarDestination = Readonly<{
  id: string;
  label: string;
  icon?: SidebarIcon;
} & ({href: string; onSelect?: never} | {href?: never; onSelect: (options: SidebarSelectOptions) => void})>;

export type SidebarSlotContext = Readonly<{
  collapsed: boolean;
  onNavigate: () => void;
}>;

export interface SidebarAccount {
  readonly displayName: string;
}

export interface SidebarProps {
  readonly primaryItems: readonly SidebarDestination[];
  readonly adminItems?: readonly SidebarDestination[];
  readonly actionItems?: readonly SidebarDestination[];
  readonly activeItemId?: string | null;
  readonly account: SidebarAccount | null;
  readonly onLogout: () => void | Promise<void>;
  readonly collapsed?: boolean;
  readonly onToggleCollapse?: () => void;
  readonly mobileOpen?: boolean;
  readonly onMobileClose?: () => void;
  readonly renderTools?: (context: SidebarSlotContext) => ReactNode;
  readonly renderPlugins?: (context: SidebarSlotContext) => ReactNode;
  readonly renderAccountActions?: () => ReactNode;
}
