"use client";
/** Port of Creezio original packages/shell-ui/ui/layout/page-toolbar-context.tsx (6bd6507).
 * Entries are scoped to the mounted provider and panel, never a module singleton. */

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/** Clé stable pour la toolbar : pathname seul (les vues `?view=` partagent les actions). */
export function toolbarKey(panelId: string, href: string): string {
  const path = href.split("?")[0] || "/";
  return `${panelId}\u0000${path}`;
}

type RegisterFn = (panelId: string, href: string, actions: ReactNode | null) => void;

type ToolbarContextValue = {
  register: RegisterFn;
  subscribe: (key: string, callback: () => void) => () => void;
  read: (key: string) => ReactNode | null;
};
const ToolbarContext = createContext<ToolbarContextValue | null>(null);

export function PageToolbarProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<ToolbarContextValue | null>(null);
  if (!storeRef.current) {
    const entries = new Map<string, ReactNode | null>();
    const listeners = new Map<string, Set<() => void>>();
    storeRef.current = {
      register(panelId, href, actions) {
        const key = toolbarKey(panelId, href);
        const previous = entries.get(key) ?? null;
        if (previous === actions) return;
        if (actions == null) entries.delete(key);
        else entries.set(key, actions);
        listeners.get(key)?.forEach(callback => callback());
      },
      subscribe(key, callback) {
        const callbacks = listeners.get(key) ?? new Set<() => void>();
        callbacks.add(callback);
        listeners.set(key, callbacks);
        return () => {
          callbacks.delete(callback);
          if (callbacks.size === 0) listeners.delete(key);
        };
      },
      read(key) { return entries.get(key) ?? null; },
    };
  }

  return (
    <ToolbarContext.Provider value={storeRef.current}>{children}</ToolbarContext.Provider>
  );
}

function useToolbarRegister(): RegisterFn | null {
  return useContext(ToolbarContext)?.register ?? null;
}

/** Publie les actions de page vers le bandeau sticky (clé = pathname de la pane). */
export function useRegisterPageToolbar(
  panelId: string,
  href: string | null,
  actions?: ReactNode,
) {
  const register = useToolbarRegister();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useLayoutEffect(() => {
    if (!register || !href) return;
    register(panelId, href, actionsRef.current ?? null);
    // Cleanup precedes the next layout registration, including query-only
    // changes which intentionally share the same toolbar key.
    return () => register(panelId, href, null);
  });
}

export function usePageToolbarActions(panelId: string, href: string): ReactNode | null {
  const context = useContext(ToolbarContext);
  const key = toolbarKey(panelId, href);
  const subscribe = useCallback((callback: () => void) => context?.subscribe(key, callback) ?? (() => {}), [context, key]);
  const read = useCallback(() => context?.read(key) ?? null, [context, key]);
  return useSyncExternalStore(subscribe, read, () => null);
}
