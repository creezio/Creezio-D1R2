'use client';

import {useEffect, useId, useRef, useState, type RefObject} from 'react';
import {ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, Shield, X} from 'lucide-react';
import {Button} from './primitives/button';
import {Avatar, AvatarFallback} from './primitives/avatar';
import {cn} from './utils';
import type {SidebarDestination, SidebarIcon, SidebarProps, SidebarSlotContext} from './sidebar-types';

export type {SidebarAccount, SidebarDestination, SidebarIcon, SidebarProps, SidebarSelectOptions, SidebarSlotContext} from './sidebar-types';

function aidSlug(label: string): string {
  return label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function DestinationIcon({icon: Icon, className}: {icon?: SidebarIcon; className: string}) {
  return Icon ? <Icon className={className} /> : null;
}

function Destination({item, active, collapsed, onNavigate, className, iconClassName}: {
  item: SidebarDestination;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  className: string;
  iconClassName: string;
}) {
  const content = <>
    <DestinationIcon icon={item.icon} className={iconClassName}/>
    {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
  </>;
  const common = {
    'data-creezio-aid': `nav.${aidSlug(item.label)}`,
    'aria-current': active ? ('page' as const) : undefined,
    title: collapsed ? item.label : undefined,
    className,
  };
  return item.href !== undefined
    ? <a href={item.href} onClick={onNavigate} {...common}>{content}</a>
    : <button type="button"
        onClick={event => { item.onSelect({newTab: event.ctrlKey || event.metaKey || event.shiftKey}); onNavigate?.(); }}
        onAuxClick={event => {
          if (event.button !== 1) return;
          event.preventDefault();
          item.onSelect({newTab: true});
          onNavigate?.();
        }} {...common}>{content}</button>;
}

function AdminNavGroup({items, activeItemId, collapsed, onNavigate, renderTools}: {
  items: readonly SidebarDestination[];
  activeItemId?: string | null;
  collapsed?: boolean;
  onNavigate?: () => void;
  renderTools?: SidebarProps['renderTools'];
}) {
  const adminActive = items.some(item => item.id === activeItemId);
  const [open, setOpen] = useState(adminActive);
  const [popover, setPopover] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const sectionId = useId();

  useEffect(() => { if (adminActive) setOpen(true); }, [adminActive]);
  useEffect(() => {
    if (!popover) return;
    function onDoc(event: MouseEvent) {
      if (!popRef.current?.contains(event.target as Node)) setPopover(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [popover]);

  if (!items.length && !renderTools) return null;
  const toolContext: SidebarSlotContext = {
    collapsed: false,
    onNavigate: () => { setPopover(false); onNavigate?.(); },
  };
  const toolLinks = renderTools?.(toolContext);

  if (collapsed) return <div className="relative" ref={popRef}>
    <button type="button" title="Admin" aria-label="Admin" aria-expanded={popover}
      aria-controls={sectionId} onClick={() => setPopover(value => !value)} data-creezio-aid="nav.admin"
      className={cn('flex h-9 w-full items-center justify-center rounded-lg text-sm transition-colors',
        adminActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white')}>
      <Shield className="h-4 w-4 shrink-0"/>
    </button>
    {popover ? <div id={sectionId} className="absolute left-full top-0 z-50 ml-2 min-w-[12rem] rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
      {items.map(item => <Destination key={item.id} item={item} active={item.id === activeItemId}
        onNavigate={toolContext.onNavigate} className={cn('flex items-center gap-2 px-3 py-2 text-sm',
          item.id === activeItemId ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white')}
        iconClassName="h-3.5 w-3.5"/>)}
      {toolLinks ? <>{items.length ? <div className="my-1 border-t border-slate-700"/> : null}
        <div className="px-1">{toolLinks}</div></> : null}
    </div> : null}
  </div>;

  return <div className="space-y-0.5">
    <button type="button" onClick={() => setOpen(value => !value)} data-creezio-aid="nav.admin"
      aria-expanded={open} aria-controls={sectionId}
      className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        adminActive ? 'bg-slate-800/80 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white')}>
      <Shield className="h-4 w-4 shrink-0"/>
      <span className="flex-1 text-left">Admin</span>
      <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open ? 'rotate-0' : '-rotate-90')}/>
    </button>
    {open ? <div id={sectionId} className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
      {items.map(item => <Destination key={item.id} item={item} active={item.id === activeItemId}
        onNavigate={onNavigate} className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
          item.id === activeItemId ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-white')}
        iconClassName="h-3.5 w-3.5 shrink-0"/>)}
      {toolLinks ? <><div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Outils</div>
        {toolLinks}</> : null}
    </div> : null}
  </div>;
}

function SidebarActionLinks({items, collapsed, onNavigate}: {
  items: readonly SidebarDestination[]; collapsed?: boolean; onNavigate?: () => void;
}) {
  return <>{items.map(item => <Destination key={item.id} item={item} active={false} collapsed={collapsed}
    onNavigate={onNavigate} iconClassName="h-4 w-4 shrink-0"
    className={cn('flex w-full items-center rounded-lg text-sm transition-colors',
      collapsed ? 'h-9 justify-center' : 'gap-3 px-3 py-2',
      'text-slate-300 hover:bg-slate-800/60 hover:text-white')}/>)}</>;
}

function NavLinks({primaryItems, adminItems = [], actionItems = [], activeItemId, collapsed,
  onNavigate, renderTools, renderPlugins}: SidebarProps & {onNavigate?: () => void}) {
  const slotContext: SidebarSlotContext = {collapsed: Boolean(collapsed), onNavigate: onNavigate ?? (() => {})};
  return <nav aria-label="Navigation principale" className={cn(
    'sidebar-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto py-4',
    collapsed ? 'px-2.5' : 'px-3')}>
    {primaryItems.map(item => <Destination key={item.id} item={item} active={item.id === activeItemId}
      collapsed={collapsed} onNavigate={onNavigate} iconClassName="h-4 w-4 shrink-0"
      className={cn('flex items-center rounded-lg text-sm transition-colors',
        collapsed ? 'h-9 justify-center' : 'gap-3 px-3 py-2',
        item.id === activeItemId ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white')}/>) }
    {renderPlugins?.(slotContext)}
    <AdminNavGroup items={adminItems} activeItemId={activeItemId} collapsed={collapsed}
      onNavigate={onNavigate} renderTools={renderTools}/>
    <SidebarActionLinks items={actionItems} collapsed={collapsed} onNavigate={onNavigate}/>
  </nav>;
}

function BrandMark({className}: {className?: string}) {
  return <div aria-hidden="true" className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
    'bg-gradient-to-br from-slate-500 to-slate-700 text-[11px] font-bold tracking-tight text-white shadow-sm',
    className)}>C</div>;
}

function BrandHeader({collapsed, onToggleCollapse, showClose, onClose, closeRef}: {
  collapsed?: boolean; onToggleCollapse?: () => void; showClose?: boolean;
  onClose?: () => void; closeRef?: RefObject<HTMLButtonElement | null>;
}) {
  if (collapsed) return <div className="flex h-[57px] shrink-0 items-center justify-center border-b border-slate-800">
    <button type="button" onClick={onToggleCollapse} aria-label="Déplier la barre latérale"
      title="Déplier la barre latérale"
      className="group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-slate-800">
      <BrandMark className="transition-opacity group-hover:opacity-0"/>
      <PanelLeftOpen className="absolute h-4 w-4 text-slate-200 opacity-0 transition-opacity group-hover:opacity-100"/>
    </button>
  </div>;
  return <div className="flex h-[57px] shrink-0 items-center justify-between gap-2 border-b border-slate-800 pl-4 pr-2">
    <div className="flex min-w-0 items-center gap-2.5">
      <BrandMark/>
      <div className="truncate text-sm font-semibold tracking-[0.18em] text-white">CREEZIO</div>
    </div>
    <div className="flex shrink-0 items-center">
      {onToggleCollapse ? <Button type="button" variant="ghost" size="icon" onClick={onToggleCollapse}
        aria-label="Réduire la barre latérale" title="Réduire la barre latérale"
        className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white">
        <PanelLeftClose className="h-4 w-4"/>
      </Button> : null}
      {showClose ? <Button ref={closeRef} type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fermer le menu"
        className="h-8 w-8 text-slate-300 hover:bg-slate-800 hover:text-white">
        <X className="h-4 w-4"/>
      </Button> : null}
    </div>
  </div>;
}

function initialsFromUsername(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '?';
}

function AccountAvatar({label}: {label: string}) {
  return <Avatar className="h-8 w-8 border border-slate-700 bg-slate-800">
    <AvatarFallback className="bg-slate-800 text-xs font-semibold text-slate-100">
      {initialsFromUsername(label)}
    </AvatarFallback>
  </Avatar>;
}

function SidebarFooter({account, collapsed, onLogout, renderAccountActions}: Pick<SidebarProps,
  'account' | 'collapsed' | 'onLogout' | 'renderAccountActions'>) {
  if (!account) return null;
  const label = account.displayName || 'Compte';
  if (collapsed) return <div className="flex shrink-0 flex-col items-center gap-1.5 border-t border-slate-800 px-2.5 py-3">
    <span title={label}><AccountAvatar label={label}/></span>
    <Button type="button" variant="ghost" size="icon" onClick={() => void onLogout()} title="Déconnexion" aria-label="Déconnexion"
      className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white">
      <LogOut className="h-4 w-4"/>
    </Button>
  </div>;
  const accountActions = renderAccountActions?.();
  return <div className="relative shrink-0 space-y-3 border-t border-slate-800 px-3 py-3">
    {accountActions ? <div className="relative">{accountActions}</div> : null}
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <AccountAvatar label={label}/>
        <span className="truncate text-sm font-medium text-slate-200">{label}</span>
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={() => void onLogout()} title="Déconnexion" aria-label="Déconnexion"
        className="h-8 w-8 shrink-0 text-slate-400 hover:bg-slate-800 hover:text-white">
        <LogOut className="h-4 w-4"/>
      </Button>
    </div>
  </div>;
}

function SidebarContent(props: SidebarProps & {onNavigate?: () => void}) {
  return <>
    <NavLinks {...props}/>
    <SidebarFooter account={props.account} collapsed={props.collapsed} onLogout={props.onLogout}
      renderAccountActions={props.renderAccountActions}/>
  </>;
}

export function Sidebar({collapsed = false, onToggleCollapse, mobileOpen = false, onMobileClose,
  ...content}: SidebarProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onMobileClose?.(); }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [mobileOpen, onMobileClose]);

  return <>
    <aside className={cn('fixed inset-y-0 left-0 z-30 hidden h-[100dvh] flex-col bg-slate-900 text-slate-100 md:flex',
      'transition-[width] duration-200 ease-out', collapsed ? 'w-16' : 'w-64')}>
      <BrandHeader collapsed={collapsed} onToggleCollapse={onToggleCollapse}/>
      <SidebarContent {...content} collapsed={collapsed}/>
    </aside>
    {mobileOpen ? <div className="fixed inset-0 z-40 md:hidden">
      <button type="button" aria-label="Fermer le menu" onClick={onMobileClose}
        className="absolute inset-0 bg-black/50"/>
      <aside id="mobile-nav" role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="absolute inset-y-0 left-0 flex h-[100dvh] w-64 max-w-[85vw] flex-col bg-slate-900 text-slate-100 shadow-xl">
        <span id={titleId} className="sr-only">Menu de navigation</span>
        <BrandHeader showClose onClose={onMobileClose} closeRef={closeRef}/>
        <SidebarContent {...content} onNavigate={onMobileClose}/>
      </aside>
    </div> : null}
  </>;
}
