'use client';

/** Creezio assistant-provider, narrowed to presentation state.
 * The Conversations controller owns messages, selection and drafts. */
import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';

export const ASSISTANT_PANEL_WIDTH_PX = 400;
type AssistantUiContextValue = Readonly<{
  open: boolean;
  setOpen: (value: boolean) => void;
  toggle: () => void;
  hydrated: boolean;
}>;
const AssistantUiContext = createContext<AssistantUiContextValue | null>(null);

function storageKey(scopeKey: string): string {
  return `creezio-assistant-ui:${encodeURIComponent(scopeKey.slice(0, 256))}`;
}
function readOpen(key: string): boolean {
  try { return window.sessionStorage.getItem(key) === 'open'; }
  catch { return false; }
}
function writeOpen(key: string, open: boolean): void {
  try { window.sessionStorage.setItem(key, open ? 'open' : 'closed'); }
  catch { /* Optional chrome preference. */ }
}

export function AssistantProvider({children, scopeKey}: {children: ReactNode; scopeKey: string}) {
  const key = storageKey(scopeKey);
  const [open, setOpenState] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setOpenState(readOpen(key)); setHydrated(true); }, [key]);
  const setOpen = useCallback((value: boolean) => {
    setOpenState(value); writeOpen(key, value);
  }, [key]);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const value = useMemo(() => ({open, setOpen, toggle, hydrated}), [open, setOpen, toggle, hydrated]);
  return <AssistantUiContext.Provider value={value}>{children}</AssistantUiContext.Provider>;
}
export function useAssistantUi(): AssistantUiContextValue {
  const value = useContext(AssistantUiContext);
  if (!value) throw new Error('useAssistantUi requires AssistantProvider.');
  return value;
}
export function useAssistantUiOptional(): AssistantUiContextValue | null {
  return useContext(AssistantUiContext);
}
