'use client';

/** Panel-scoped counterpart of the original Creezio workspace's setTabMeta.
 * Metadata is presentation only: it is never persisted or used for access. */
import {createContext, createElement, useCallback, useContext, useLayoutEffect, useMemo, useRef,
  useSyncExternalStore, type ReactNode} from 'react';

export type WorkspaceTrailCrumb = Readonly<{label: string; href?: string}>;
export type WorkspaceMetadata = Readonly<{
  title?: string;
  subtitle?: string;
  kind?: 'section' | 'entity';
  trail?: readonly WorkspaceTrailCrumb[];
}>;

type Listener = () => void;
type Owner = symbol;
export interface WorkspaceMetadataStore {
  register(panelId: string, owner: Owner, metadata: WorkspaceMetadata): void;
  unregister(panelId: string, owner: Owner): void;
  subscribe(panelId: string, listener: Listener): () => void;
  read(panelId: string): WorkspaceMetadata | null;
}

const panelKey = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const text = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 200 && value.isWellFormed()
  && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function internalHref(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !value.isWellFormed()
    || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://workspace.invalid');
    return url.origin === 'https://workspace.invalid' && !url.hash && `${url.pathname}${url.search}` === value;
  } catch { return false; }
}
function normalized(value: unknown): WorkspaceMetadata | null {
  if (!plain(value) || Reflect.ownKeys(value).some(key => typeof key !== 'string'
    || !['title', 'subtitle', 'kind', 'trail'].includes(key))) return null;
  const result: {title?: string; subtitle?: string; kind?: 'section' | 'entity'; trail?: readonly WorkspaceTrailCrumb[]} = {};
  if (Object.hasOwn(value, 'title')) { if (!text(value.title)) return null; result.title = value.title; }
  if (Object.hasOwn(value, 'subtitle')) { if (!text(value.subtitle)) return null; result.subtitle = value.subtitle; }
  if (Object.hasOwn(value, 'kind')) {
    if (value.kind !== 'section' && value.kind !== 'entity') return null;
    result.kind = value.kind;
  }
  if (Object.hasOwn(value, 'trail')) {
    if (!Array.isArray(value.trail) || value.trail.length > 12) return null;
    const trail: WorkspaceTrailCrumb[] = [];
    for (const item of value.trail) {
      if (!plain(item) || Reflect.ownKeys(item).some(key => typeof key !== 'string'
        || !['label', 'href'].includes(key)) || !text(item.label)
        || Object.hasOwn(item, 'href') && !internalHref(item.href)) return null;
      trail.push(Object.freeze({label: item.label, ...(Object.hasOwn(item, 'href') ? {href: item.href as string} : {})}));
    }
    result.trail = Object.freeze(trail);
  }
  return Object.keys(result).length ? Object.freeze(result) : null;
}
function equal(a: WorkspaceMetadata | null, b: WorkspaceMetadata | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.title !== b.title || a.subtitle !== b.subtitle || a.kind !== b.kind) return false;
  const left = a.trail ?? [], right = b.trail ?? [];
  return left.length === right.length && left.every((item, index) => item.label === right[index].label
    && item.href === right[index].href);
}

/** Separate instance per mounted shell. Multiple registrations on a panel use the latest mounted entry. */
export function createWorkspaceMetadataStore(): WorkspaceMetadataStore {
  const entries = new Map<string, Map<Owner, WorkspaceMetadata>>();
  const listeners = new Map<string, Set<Listener>>();
  const snapshots = new Map<string, WorkspaceMetadata>();
  const publish = (panelId: string) => {
    const registrations = entries.get(panelId);
    const candidate = registrations?.size ? [...registrations.values()].at(-1)! : null;
    const previous = snapshots.get(panelId) ?? null;
    if (equal(previous, candidate)) return;
    if (candidate) snapshots.set(panelId, candidate);
    else snapshots.delete(panelId);
    listeners.get(panelId)?.forEach(listener => listener());
  };
  const store: WorkspaceMetadataStore = {
    register(panelId, owner, metadata) {
      if (!panelKey(panelId) || typeof owner !== 'symbol') return;
      const value = normalized(metadata);
      const registrations = entries.get(panelId) ?? new Map<Owner, WorkspaceMetadata>();
      if (value) { registrations.set(owner, value); entries.set(panelId, registrations); }
      else { registrations.delete(owner); if (!registrations.size) entries.delete(panelId); }
      publish(panelId);
    },
    unregister(panelId, owner) {
      const registrations = entries.get(panelId);
      if (!registrations?.delete(owner)) return;
      if (!registrations.size) entries.delete(panelId);
      publish(panelId);
    },
    subscribe(panelId, listener) {
      if (!panelKey(panelId)) return () => {};
      const callbacks = listeners.get(panelId) ?? new Set<Listener>();
      callbacks.add(listener); listeners.set(panelId, callbacks);
      return () => { callbacks.delete(listener); if (!callbacks.size) listeners.delete(panelId); };
    },
    read(panelId) { return snapshots.get(panelId) ?? null; },
  };
  return Object.freeze(store);
}

const MetadataContext = createContext<WorkspaceMetadataStore | null>(null);
const EMPTY_SNAPSHOT: ReadonlyMap<string, WorkspaceMetadata> = new Map();

export function WorkspaceMetadataProvider({children}: {children: ReactNode}) {
  const store = useRef<WorkspaceMetadataStore | null>(null);
  if (!store.current) store.current = createWorkspaceMetadataStore();
  return createElement(MetadataContext.Provider, {value: store.current}, children);
}

/** Publish after commit; a panel's metadata disappears when its view unmounts. */
export function useRegisterWorkspaceMetadata(panelId: string, metadata: WorkspaceMetadata): void {
  const store = useContext(MetadataContext);
  const owner = useRef<Owner>(Symbol('workspace-metadata'));
  useLayoutEffect(() => () => store?.unregister(panelId, owner.current), [store, panelId]);
  useLayoutEffect(() => { store?.register(panelId, owner.current, metadata); });
}

export function useWorkspaceMetadata(panelId: string): WorkspaceMetadata | null {
  const store = useContext(MetadataContext);
  const subscribe = useCallback((listener: Listener) => store?.subscribe(panelId, listener) ?? (() => {}), [store, panelId]);
  const read = useCallback(() => store?.read(panelId) ?? null, [store, panelId]);
  return useSyncExternalStore(subscribe, read, () => null);
}

/** Read every requested panel in one hook call, including inactive tabs. */
export function useWorkspaceMetadataForPanels(panelIds: readonly string[]): ReadonlyMap<string, WorkspaceMetadata> {
  const store = useContext(MetadataContext);
  const idsKey = JSON.stringify([...new Set(panelIds.filter(panelKey))]);
  const ids = useMemo(() => JSON.parse(idsKey) as string[], [idsKey]);
  const cache = useRef<{store: WorkspaceMetadataStore; idsKey: string;
    snapshot: ReadonlyMap<string, WorkspaceMetadata>} | null>(null);
  const subscribe = useCallback((listener: Listener) => {
    if (!store) return () => {};
    const unsubscribe = ids.map(id => store.subscribe(id, listener));
    return () => unsubscribe.forEach(stop => stop());
  }, [store, ids]);
  const read = useCallback((): ReadonlyMap<string, WorkspaceMetadata> => {
    if (!store) return EMPTY_SNAPSHOT;
    const previous = cache.current;
    if (previous?.store === store && previous.idsKey === idsKey
      && ids.every(id => previous.snapshot.get(id) === (store.read(id) ?? undefined))) return previous.snapshot;
    const next = new Map<string, WorkspaceMetadata>();
    for (const id of ids) {
      const metadata = store.read(id);
      if (metadata) next.set(id, metadata);
    }
    const snapshot = next.size ? next : EMPTY_SNAPSHOT;
    cache.current = {store, idsKey, snapshot};
    return snapshot;
  }, [store, ids, idsKey]);
  return useSyncExternalStore(subscribe, read, () => EMPTY_SNAPSHOT);
}
