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
  const header = renderSlot('front.header');
  const sidebar = renderSlot('front.sidebar');
  const context = renderSlot('front.context');
  const footer = renderSlot('front.footer');
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {setMobileOpen(false); mobileTrigger.current?.focus();}
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [mobileOpen]);
  const openView = (viewId: string) => {
    if (navigate(viewId)) setMobileOpen(false);
  };
  return <div className={styles.root} data-front-theme="chatgpt-like">
    {mobileOpen && <button type="button" className={styles.scrim} aria-label="Fermer le volet"
      onClick={() => {setMobileOpen(false); mobileTrigger.current?.focus();}} />}
    <aside id="front-chatgpt-navigation" className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''} ${mobileOpen ? styles.mobileOpen : ''}`}>
      <div className={styles.sidebarHeader}>
        <div className={styles.brandRow}>
          <strong className={styles.wordmark} title={brand.name}>{collapsed ? brand.name.slice(0, 1).toUpperCase() : brand.name}</strong>
          <button type="button" className={styles.collapseButton} aria-label={collapsed ? 'Ouvrir le volet' : 'Réduire le volet'}
            aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><PanelLeft size={20} /></button>
          <button type="button" className={styles.closeMobile} aria-label="Fermer le volet"
            onClick={() => {setMobileOpen(false); mobileTrigger.current?.focus();}}><X size={20} /></button>
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
    <div className={styles.workspace}>
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
        <main className={styles.main}>{children ?? <p className={styles.empty}>Aucune vue disponible.</p>}</main>
        {context && <aside className={styles.context} aria-label="Contexte de la page">{context}</aside>}
      </div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  </div>;
}
