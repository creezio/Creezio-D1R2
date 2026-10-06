'use client';

import {useEffect, useRef, useState} from 'react';
import {LayoutGrid, PanelLeft, RefreshCw, X} from 'lucide-react';
import type {FrontThemeProps} from '../../../sdk/front/types.ts';
import styles from './theme.module.css';

/** Certivan V5's rail, mobile navigation and content frame, fed by Creezio's front host. */
export function ChatGptLikeFrontTheme({brand, account, navigation, children, renderSlot,
  navigate, onLogin, onLogout, onRefresh}: FrontThemeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const mobileClose = useRef<HTMLButtonElement>(null);
  const mainContent = useRef<HTMLElement>(null);
  const pendingFocus = useRef<'trigger' | 'main' | null>(null);
  const header = renderSlot('front.header');
  const sidebar = renderSlot('front.sidebar');
  const context = renderSlot('front.context');
  const footer = renderSlot('front.footer');
  useEffect(() => {
    if (!mobileOpen) {
      if (pendingFocus.current) {
        const target = pendingFocus.current === 'trigger' && mobileTrigger.current?.getClientRects().length
          ? mobileTrigger.current : mainContent.current;
        target?.focus({preventScroll:true});
        pendingFocus.current = null;
      }
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => mobileClose.current?.focus({preventScroll:true}));
    const mobile = window.matchMedia('(max-width: 767px)');
    const onViewportChange = () => {
      if (!mobile.matches) {pendingFocus.current = 'main'; setMobileOpen(false);}
    };
    mobile.addEventListener('change', onViewportChange);
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMobile();
    };
    document.addEventListener('keydown', close);
    return () => {window.cancelAnimationFrame(focusFrame); document.removeEventListener('keydown', close); mobile.removeEventListener('change', onViewportChange);};
  }, [mobileOpen]);
  const closeMobile = () => {
    pendingFocus.current = 'trigger';
    setMobileOpen(false);
  };
  const openView = (viewId: string) => {
    if (navigate(viewId)) {
      if (mobileOpen) {pendingFocus.current = 'main'; setMobileOpen(false);}
      else mainContent.current?.focus({preventScroll:true});
    }
  };
  const keepFocusInMobile = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!mobileOpen || event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(control => control.getClientRects().length > 0);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus({preventScroll:true});}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus({preventScroll:true});}
  };
  return <div className={styles.root} data-front-theme="chatgpt-like">
    {mobileOpen && <button type="button" className={styles.scrim} aria-label="Fermer le volet"
      tabIndex={-1} aria-hidden="true" onClick={closeMobile} />}
    <aside id="front-chatgpt-navigation" role={mobileOpen ? 'dialog' : undefined}
      aria-modal={mobileOpen ? true : undefined} aria-label={mobileOpen ? 'Navigation de l’application' : undefined}
      onKeyDown={keepFocusInMobile}
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${mobileOpen ? styles.mobileOpen : ''}`}>
      <div className={styles.sidebarHeader}>
        <div className={styles.brandRow}>
          <strong className={styles.wordmark} title={brand.name}>{collapsed ? brand.name.slice(0, 1).toUpperCase() : brand.name}</strong>
          <button type="button" className={styles.collapseButton} aria-label={collapsed ? 'Ouvrir le volet' : 'Réduire le volet'}
            aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><PanelLeft size={20} /></button>
          <button ref={mobileClose} type="button" className={styles.closeMobile} aria-label="Fermer le volet"
            onClick={closeMobile}><X size={20} /></button>
        </div>
      </div>
      <nav className={styles.navigation} aria-label="Navigation de l’application">
        {navigation.map(item => <button key={item.id} type="button" className={styles.navItem}
          aria-current={item.active ? 'page' : undefined} aria-label={item.title}
          title={collapsed ? item.title : undefined}
          onClick={() => openView(item.viewId)}><LayoutGrid size={19} aria-hidden="true" /><span>{item.title}</span></button>)}
        {sidebar && <div className={styles.sidebarSlot}>{sidebar}</div>}
      </nav>
      <div className={styles.sidebarFooter}>
        <button type="button" className={styles.accountMark} onClick={account ? onLogout : onLogin}
          aria-label={account ? 'Se déconnecter' : 'Se connecter'}
          title={account ? 'Se déconnecter' : 'Se connecter'}>
          {account?.displayName?.slice(0, 1).toUpperCase() ?? 'C'}</button>
        <span className={styles.accountName}>{account?.displayName ?? brand.name}</span>
        <button type="button" className={styles.accountAction} onClick={account ? onLogout : onLogin}
          title={account ? 'Se déconnecter' : 'Se connecter'}>{account ? 'Quitter' : 'Entrer'}</button>
      </div>
    </aside>
    <div className={styles.workspace} inert={mobileOpen}>
      <header className={styles.topbar}>
        <button ref={mobileTrigger} type="button" className={styles.mobileTrigger} aria-label="Ouvrir le volet"
          aria-controls="front-chatgpt-navigation" aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}><PanelLeft size={20} /></button>
        <span className={styles.pageTitle}>{brand.name}</span>
        {header && <div className={styles.headerSlot}>{header}</div>}
        <button type="button" className={styles.refreshButton} aria-label="Actualiser" onClick={onRefresh}>
          <RefreshCw size={18} /></button>
      </header>
      <div className={styles.workGrid}>
        <main ref={mainContent} tabIndex={-1} className={styles.main}>{children ?? <p className={styles.empty}>Aucune vue disponible.</p>}</main>
        {context && <aside className={styles.context} aria-label="Contexte de la page">{context}</aside>}
      </div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  </div>;
}
