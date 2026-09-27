'use client';

/** Creezio shell-ui/workspace/workspace-shell.tsx, adapted to the public panel SDK.
 * The original layout/classes and sidebar preference remain; URL and access are host-owned. */
import {useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {CloudUpload, FileText, Menu} from 'lucide-react';
import type {WorkspaceRenderProps} from '@creezio/sdk/workspace/components';
import {WorkspaceMetadataProvider, useWorkspaceMetadataForPanels} from '@creezio/sdk/workspace/metadata';
import {Button} from './primitives/button';
import {Sidebar} from './sidebar';
import {WorkspaceTabBar} from './workspace-tab-bar';
import {PageToolbarProvider} from './page-toolbar-context';
import {DestinationSearchDialog} from './destination-search';
import {cn} from './utils';
import {AssistantProvider, ASSISTANT_PANEL_WIDTH_PX, useAssistantUiOptional} from '@creezio/sdk/ui/assistant-provider';
import {DeliveryTransportProvider} from '@creezio/sdk/delivery/context';
import type {DeliveryTransport} from '@creezio/sdk/delivery/transport';

export interface CreezioShellProps extends WorkspaceRenderProps {
  readonly account: {displayName: string} | null;
  readonly onLogout: () => void;
  readonly onRefreshAccess: () => void;
  /** Compiled and authorized module contribution supplied by the host. */
  readonly assistant?: ReactNode;
  /** Native session scope; never a credential. */
  readonly assistantScopeKey?: string;
  /** Host-owned local operator bridge; null when the delivery capability is unavailable. */
  readonly deliveryTransport?: DeliveryTransport | null;
}

export function CreezioShell(props: CreezioShellProps) {
  const shell = <WorkspaceMetadataProvider><PageToolbarProvider><CreezioShellContent {...props} /></PageToolbarProvider></WorkspaceMetadataProvider>;
  return <DeliveryTransportProvider transport={props.deliveryTransport ?? null}>
    <AssistantProvider key={props.assistantScopeKey ?? 'anonymous'} scopeKey={props.assistantScopeKey ?? 'anonymous'}>
      {shell}{props.assistant}
    </AssistantProvider>
  </DeliveryTransportProvider>;
}

function CreezioShellContent({controller,snapshot,authorized,items,children,account,onLogout,onRefreshAccess,assistant}: CreezioShellProps) {
  const assistantUi = useAssistantUiOptional();
  const rightChromePx = assistant && assistantUi?.hydrated && assistantUi.open ? ASSISTANT_PANEL_WIDTH_PX : 0;
  const metadata = useWorkspaceMetadataForPanels(snapshot.tabs.map(tab => tab.id));
  const [navOpen,setNavOpen] = useState(false);
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const [searchOpen,setSearchOpen] = useState(false);
  const [newTabMode,setNewTabMode] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    try { setSidebarCollapsed(localStorage.getItem('creezio-sidebar-collapsed') === 'true'); } catch { /* Optional preference. */ }
  },[]);
  const toggleSidebarCollapsed = useCallback(() => setSidebarCollapsed(previous => {
    const next = !previous;
    try { localStorage.setItem('creezio-sidebar-collapsed',String(next)); } catch { /* Session still works without storage. */ }
    return next;
  }),[]);
  const closeNav = useCallback(() => setNavOpen(false),[]);
  useEffect(() => {
    if(wasOpenRef.current && !navOpen) menuButtonRef.current?.focus();
    wasOpenRef.current = navOpen;
  },[navOpen]);
  useEffect(() => { if(!authorized) {setNavOpen(false);setSearchOpen(false);} },[authorized]);
  const openSearch = useCallback((newTab: boolean) => {
    if(!authorized) return;
    setNewTabMode(newTab);setSearchOpen(true);
  },[authorized]);
  const changeSearchOpen = useCallback((open: boolean) => {
    if(open && !authorized) return;
    setSearchOpen(open);
    if(!open) setNewTabMode(false);
  },[authorized]);
  const activeTab = snapshot.tabs.find(tab => tab.id === snapshot.activeTabId);
  const activeItem = items.find(item => item.viewId === activeTab?.location.viewId);
  const activeMetadata = activeTab ? metadata.get(activeTab.id) : undefined;
  const tabs = snapshot.tabs.map(tab => {
    const presentation = metadata.get(tab.id);
    return presentation ? {...tab, title:presentation.title ?? tab.title, subtitle:presentation.subtitle} : tab;
  });
  const destination = (item: (typeof items)[number], icon = FileText) => ({id:item.id,label:item.title,icon,
    onSelect: ({newTab}: {newTab:boolean}) => {controller.open(item.viewId,{}, {newTab});closeNav();}});
  const deliveryItem = (item: (typeof items)[number]) => item.viewId.startsWith('creezio.delivery:');

  return <div
    className={cn('flex h-dvh max-h-dvh overflow-hidden bg-gradient-to-br from-slate-50 via-white to-sky-50/40 transition-[padding] duration-200 ease-out',
      rightChromePx > 0 && 'md:pr-[var(--assistant-chrome-right)]')}
    style={{'--assistant-chrome-right': `${rightChromePx}px`} as CSSProperties}
    data-creezio-workspace="original-shell" data-creezio-assistant-chrome={rightChromePx > 0 ? 'panel' : 'fab-overlay'}>
    <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebarCollapsed}
      mobileOpen={navOpen} onMobileClose={closeNav} account={authorized ? account : null} onLogout={onLogout}
      activeItemId={activeItem?.id} primaryItems={items.filter(item => !deliveryItem(item)).map(item => destination(item))}
      adminItems={items.filter(deliveryItem).map(item => destination(item, CloudUpload))}
      renderAccountActions={() => <button type="button" onClick={onRefreshAccess}
        className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50">Actualiser les accès</button>} />
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col transition-[margin] duration-200 ease-out',
      sidebarCollapsed ? 'md:ml-16' : 'md:ml-64')}>
      <header className="sticky top-0 z-20 shrink-0 bg-[#ebe7df] px-2 sm:px-3 md:px-4 md:pr-0">
        <div className="flex items-stretch gap-1.5">
          <Button ref={menuButtonRef} type="button" variant="outline" size="icon"
            className="mt-1.5 h-7 w-7 shrink-0 border-slate-300/80 bg-white/70 md:hidden"
            onClick={() => setNavOpen(true)} aria-label="Ouvrir le menu de navigation" aria-expanded={navOpen} aria-controls="mobile-nav">
            <Menu className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1"><WorkspaceTabBar tabs={authorized ? tabs : []}
            activeTabId={authorized ? snapshot.activeTabId : null}
            canGoBack={authorized && !!activeTab && activeTab.historyIndex>0}
            canGoForward={authorized && !!activeTab && activeTab.historyIndex<activeTab.history.length-1}
            onActivate={controller.activate} onClose={controller.close} onLock={controller.lock} onMove={controller.move}
            onBack={controller.back} onForward={controller.forward} onOpenDestinationSearch={openSearch}
            pageChrome={authorized && activeTab ? {kind:activeMetadata?.kind ?? 'section',trail:activeMetadata?.trail,
              href:activeTab.location.url,panelId:activeTab.id,
              onNavigate: href => {controller.visit(href);}} : undefined} /></div>
        </div>
      </header>
      <main className="relative min-h-0 flex-1 overflow-hidden bg-white">{children}</main>
    </div>
    <DestinationSearchDialog open={authorized && searchOpen} newTabMode={newTabMode} items={items}
      onOpenChange={changeSearchOpen} onChoose={(item,newTab) => {controller.open(item.viewId,{}, {newTab});}} />
  </div>;
}
