'use client';

import type {FrontThemeProps} from '../../../sdk/front/types.ts';
import {Button} from '@creezio/sdk/ui';
import styles from './theme.module.css';

/** Creezio's cream-and-ink presentation around host-authorized contributions. */
export function StandardFrontTheme({brand, account, navigation, children, renderSlot,
  navigate, onLogin, onLogout, onRefresh}: FrontThemeProps) {
  const header = renderSlot('front.header');
  const sidebar = renderSlot('front.sidebar');
  const context = renderSlot('front.context');
  const footer = renderSlot('front.footer');
  return <div className={styles.root} data-front-theme="standard">
    <header className={styles.header}>
      <div className={styles.brand}><strong>{brand.name}</strong>{brand.description && <span>{brand.description}</span>}</div>
      {header && <div className={styles.headerSlot}>{header}</div>}
      <div className={styles.account}>
        {account && <span className={styles.accountName}>{account.displayName}</span>}
        <Button size="sm" variant="outline" onClick={onRefresh}>Actualiser</Button>
        <Button size="sm" variant="outline" onClick={account ? onLogout : onLogin}>
          {account ? 'Se déconnecter' : 'Se connecter'}
        </Button>
      </div>
    </header>
    <div className={styles.body}>
      <nav className={styles.navigation} aria-label="Navigation de l’application">
        {navigation.map(item => <button key={item.id} type="button" className={styles.navItem}
          aria-current={item.active ? 'page' : undefined} onClick={() => navigate(item.viewId)}>{item.title}</button>)}
        {sidebar && <div className={styles.sidebarSlot}>{sidebar}</div>}
      </nav>
      <main className={styles.main}>{children ?? <p className={styles.empty}>Aucune vue disponible.</p>}</main>
      {context && <aside className={styles.context} aria-label="Contexte de la page">{context}</aside>}
    </div>
    {footer && <footer className={styles.footer}>{footer}</footer>}
  </div>;
}
