import type { AccessController } from '../access/types.ts';
import type { WorkspaceInput, WorkspaceLocation, WorkspaceNavigation, WorkspacePanelState, WorkspaceProjection,
  WorkspaceSnapshot, WorkspaceTab, WorkspaceView } from './types.ts';

export const MAX_WORKSPACE_TABS = 12;
const MAX_HISTORY = 80;
export const WORKSPACE_STORAGE_KEY = 'creezio-workspace-tabs-v1';
const MAX_STORED_BYTES = 131_072;
const MAX_STORED_STATE_BYTES = 8192 + 512;
const MAX_STORED_DATA_BYTES = 8192;
const encoder = new TextEncoder();
export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}
export const viewKey = (view: Pick<WorkspaceView, 'id'>) => view.id;
/** Route data shared by the workspace and optional front renderers. */
export type WorkspaceRouteView = Pick<WorkspaceView,
  'id' | 'moduleId' | 'route' | 'panel' | 'validateInput' | 'surfaces'>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function copyPanelData(value: unknown): Readonly<Record<string, unknown>> | null {
  const seen = new Set<object>(); let nodes = 0;
  const copy = (source: unknown, depth: number): unknown => {
    if (depth > 8 || ++nodes > 256) throw new TypeError();
    if (source === null || typeof source === 'boolean') return source;
    if (typeof source === 'string' && source.isWellFormed() && source.length <= 2048) return source;
    if (typeof source === 'number' && Number.isFinite(source)) return source;
    if (!source || typeof source !== 'object' || seen.has(source)) throw new TypeError();
    seen.add(source);
    if (Array.isArray(source)) {
      if (Object.getPrototypeOf(source) !== Array.prototype || source.length > 100) throw new TypeError();
      const descriptors = Object.getOwnPropertyDescriptors(source);
      if (Reflect.ownKeys(descriptors).length !== source.length + 1) throw new TypeError();
      const items = Array.from({length: source.length}, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError();
        return copy(descriptor.value, depth + 1);
      });
      return Object.freeze(items);
    }
    if (!record(source)) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(source), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 100) throw new TypeError();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string' || !key || key.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(key)
        || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) throw new TypeError();
      result[key] = copy(descriptors[key].value, depth + 1);
    }
    return Object.freeze(result);
  };
  try {
    if (!record(value)) return null;
    const captured = copy(value, 0) as Readonly<Record<string, unknown>>;
    return encoder.encode(JSON.stringify(captured)).length <= MAX_STORED_DATA_BYTES ? captured : null;
  } catch { return null; }
}
function panelState(value: unknown, view?: WorkspaceView): WorkspacePanelState | null {
  try {
    if (!record(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !['activeSubview', 'scrollTop', 'scrollLeft', 'data'].includes(key)
      || !Object.hasOwn(descriptors[key], 'value'))) return null;
    const output: {activeSubview?: string; scrollTop?: number; scrollLeft?: number; data?: Readonly<Record<string, unknown>>} = {};
    if (own(descriptors, 'activeSubview')) {
      const selected = descriptors.activeSubview.value;
      if (typeof selected !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(selected)) return null;
      output.activeSubview = selected;
    }
    for (const key of ['scrollTop', 'scrollLeft'] as const) if (own(descriptors, key)) {
      const coordinate = descriptors[key].value;
      if (!Number.isSafeInteger(coordinate) || coordinate < 0 || coordinate > 10_000_000) return null;
      output[key] = coordinate;
    }
    if (own(descriptors, 'data')) {
      if (!view?.validateState) return null;
      const data = copyPanelData(descriptors.data.value);
      if (!data || view.validateState(data) !== true) return null;
      output.data = data;
    }
    return JSON.stringify(output).length <= MAX_STORED_STATE_BYTES ? Object.freeze(output) : null;
  } catch { return null; }
}
function storageKey(audience: string, contextId: string, surface: 'workspace' | 'front'): string {
  return `${WORKSPACE_STORAGE_KEY}:${surface === 'front' ? 'front:' : ''}${audience}:${encodeURIComponent(contextId)}`;
}
function forgetStorage(storage: WorkspaceStorage | undefined, key: string, sessionId?: string, principalId?: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
    if (!sessionId || !principalId || typeof storage.length !== 'number' || typeof storage.key !== 'function') return;
    // A confirmed logout/session change also purges this session's other
    // workspace contexts. Do not touch unrelated application storage keys.
    const scoped: string[] = [];
    for (let i = 0; i < Math.min(storage.length, 256); i++) {
      const name = storage.key(i);
      if (name?.startsWith(`${WORKSPACE_STORAGE_KEY}:`) && name !== key) scoped.push(name);
    }
    for (const name of scoped) {
      const raw = storage.getItem(name);
      if (!raw || raw.length > MAX_STORED_BYTES) continue;
      try {
        const value: unknown = JSON.parse(raw);
        if (record(value) && value.sessionId === sessionId && value.principalId === principalId) storage.removeItem(name);
      } catch { /* Malformed other scopes are discarded when selected. */ }
    }
  } catch { /* Session storage may be unavailable; memory is still purged. */ }
}

function safeInput(input: WorkspaceInput): WorkspaceInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const copy: Record<string, string> = Object.create(null);
  try {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || !('value' in descriptor)
        || typeof descriptor.value !== 'string' || descriptor.value.length > 2048
        || !descriptor.value.isWellFormed()) return null;
      copy[key] = descriptor.value;
    }
  } catch { return null; }
  return Object.freeze(copy);
}

function routeParts(view: WorkspaceRouteView): string[] { return view.route.split('/').filter(Boolean); }
export function createWorkspaceLocation(view: WorkspaceRouteView, input: WorkspaceInput): WorkspaceLocation | null {
  const values = safeInput(input);
  if (!values) return null;
  try { if (view.validateInput && view.validateInput(values) !== true) return null; }
  catch { return null; }
  const identityValues: string[] = [];
  for (const field of view.panel.identityFields) {
    if (!own(values, field) || !values[field]) return null;
    identityValues.push(values[field]);
  }
  const consumed = new Set<string>();
  const path = routeParts(view).map(part => {
    const field = /^\{([A-Za-z][A-Za-z0-9_-]*)\}$/.exec(part)?.[1];
    if (!field) return part;
    consumed.add(field);
    if (own(values, field) && (values[field] === '.' || values[field] === '..'
      || /[\\/\u0000-\u001f\u007f]/.test(values[field]))) return '';
    return own(values, field) ? encodeURIComponent(values[field]) : '';
  });
  if (path.some(part => !part)) return null;
  const query = new URLSearchParams();
  for (const key of Object.keys(values).sort()) if (!consumed.has(key)) query.set(key, values[key]);
  const url = `/${path.join('/')}${query.size ? `?${query}` : ''}`;
  return Object.freeze({viewId: viewKey(view), input: values, url,
    identity: JSON.stringify([view.moduleId, view.id, ...identityValues])});
}

function parseLocation(view: WorkspaceRouteView, url: URL): WorkspaceLocation | null {
  const expected = routeParts(view), actual = url.pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const input: Record<string, string> = Object.create(null);
  for (let index = 0; index < expected.length; index++) {
    const field = /^\{([A-Za-z][A-Za-z0-9_-]*)\}$/.exec(expected[index])?.[1];
    if (field) {
      if (!actual[index] || own(input, field)) return null;
      try { input[field] = decodeURIComponent(actual[index]); } catch { return null; }
    } else if (expected[index] !== actual[index]) return null;
  }
  for (const [key, value] of url.searchParams) {
    if (own(input, key)) return null;
    input[key] = value;
  }
  return createWorkspaceLocation(view, input);
}

export function resolveWorkspaceLocation(url: string, views: readonly WorkspaceRouteView[],
  allowed: ReadonlySet<string>, surface: 'workspace' | 'front' = 'workspace'): WorkspaceLocation | null {
  try {
    const parsed = new URL(url, 'https://workspace.invalid');
    if (parsed.origin !== 'https://workspace.invalid' || parsed.hash || !url.startsWith('/')) return null;
    let match: WorkspaceLocation | null = null;
    for (const view of views) {
      if (!allowed.has(viewKey(view)) || !view.surfaces.includes(surface)) continue;
      const location = parseLocation(view, parsed);
      if (location) {
        if (match) return null;
        match = location;
      }
    }
    return match;
  } catch { /* Reject malformed URLs. */ }
  return null;
}

/** Original Creezio's sessionStorage tabs, narrowed to canonical, authorized URLs.
 * Stored links are reparsed; stored inputs, titles, permissions and React state
 * are never trusted or hydrated directly. */
function restoreTabs(storage: WorkspaceStorage | undefined, key: string, projection: WorkspaceProjection,
  views: readonly WorkspaceView[], homeViewId?: string, surface: 'workspace' | 'front' = 'workspace'): WorkspaceSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    if (raw.length > MAX_STORED_BYTES || encoder.encode(raw).length > MAX_STORED_BYTES) { storage.removeItem(key); return null; }
    const saved: unknown = JSON.parse(raw);
    if (!record(saved) || saved.version !== 1 || saved.sessionId !== projection.sessionId
      || saved.principalId !== projection.principalId || saved.audience !== projection.audience
      || saved.contextId !== projection.contextId
      || typeof saved.compositionDigest !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(saved.compositionDigest)
      || surface === 'workspace' && saved.compositionDigest !== projection.compositionDigest
      || !Number.isSafeInteger(saved.epoch) || Number(saved.epoch) > projection.epoch
      || !Array.isArray(saved.tabs) || saved.tabs.length > MAX_WORKSPACE_TABS
      || saved.activeTabId !== null && typeof saved.activeTabId !== 'string') {
      storage.removeItem(key); return null;
    }
    const allowed = new Set(projection.viewIds), ids = new Set<string>(), tabs: WorkspaceTab[] = [];
    for (const entry of saved.tabs) {
      if (!record(entry) || typeof entry.id !== 'string' || !/^pane-[1-9][0-9]{0,6}$/.test(entry.id)
        || ids.has(entry.id) || typeof entry.locked !== 'boolean' || typeof entry.pinned !== 'boolean'
        || !Array.isArray(entry.history) || entry.history.length < 1 || entry.history.length > MAX_HISTORY
        || !Number.isSafeInteger(entry.historyIndex) || Number(entry.historyIndex) < 0
        || Number(entry.historyIndex) >= entry.history.length) continue;
      ids.add(entry.id);
      const history = entry.history.map(url => typeof url === 'string' && url.length <= 8192
        ? resolveWorkspaceLocation(url, views, allowed, surface) : null);
      if (history.some(item => !item)) continue;
      const locations = history as WorkspaceLocation[], location = locations[entry.historyIndex as number];
      if (locations.some(item => item.identity !== location.identity)) continue;
      const view = views.find(item => item.id === location.viewId && item.audiences.includes(projection.audience));
      if (!view) continue;
      // A theme may change the composition digest without changing a module,
      // while module code may change without changing that digest. Restore only
      // a panel produced by the exact same locked runtime in either case.
      if (surface === 'front'
        && (!view.moduleIntegrity || !/^sha256-[a-f0-9]{64}$/.test(view.moduleIntegrity)
          || entry.moduleIntegrity !== view.moduleIntegrity)) continue;
      const state = entry.panelState === undefined ? undefined : panelState(entry.panelState, view);
      tabs.push(Object.freeze({id: entry.id, title: view.title, locked: entry.locked, pinned: entry.pinned,
        history: Object.freeze(locations), historyIndex: entry.historyIndex as number, location,
        ...(state ? {panelState: state} : {})}));
    }
    // A pinned landing tab, when present, belongs at position zero and cannot
    // be unlocked. Bad metadata is repaired from the reviewed view declaration.
    const pinned = tabs.findIndex(tab => tab.pinned);
    if (pinned > 0) tabs.unshift(tabs.splice(pinned, 1)[0]);
    const normalized = tabs.map((tab, index) => tab.pinned && index !== 0 ? {...tab, pinned: false} : tab);
    if (homeViewId && allowed.has(homeViewId) && (!normalized.length || normalized[0].location.viewId !== homeViewId
      || !normalized[0].pinned || !normalized[0].locked)) {
      storage.removeItem(key); return null;
    }
    const activeTabId = normalized.some(tab => tab.id === saved.activeTabId) ? saved.activeTabId as string
      : normalized.at(-1)?.id ?? null;
    return Object.freeze({tabs: Object.freeze(normalized), activeTabId});
  } catch {
    try { storage.removeItem(key); } catch { /* Storage unavailable. */ }
    return null;
  }
}

function persistTabs(storage: WorkspaceStorage | undefined, key: string, projection: WorkspaceProjection,
  snapshot: WorkspaceSnapshot, views: readonly WorkspaceView[]): boolean {
  if (!storage) return false;
  try {
    const value = JSON.stringify({version: 1, sessionId: projection.sessionId, principalId: projection.principalId,
      audience: projection.audience, contextId: projection.contextId, compositionDigest: projection.compositionDigest,
      epoch: projection.epoch, activeTabId: snapshot.activeTabId,
      tabs: snapshot.tabs.map(tab => ({id: tab.id,
        moduleIntegrity: views.find(view => view.id === tab.location.viewId)?.moduleIntegrity ?? null,
        locked: tab.locked, pinned: tab.pinned,
        history: tab.history.map(location => location.url), historyIndex: tab.historyIndex,
        ...(tab.panelState ? {panelState: tab.panelState} : {})}))});
    if (encoder.encode(value).length > MAX_STORED_BYTES) return false;
    storage.setItem(key, value);
    return true;
  } catch { return false; /* Keep the last valid snapshot on quota or storage failure. */ }
}

function tabWithLocation(tab: WorkspaceTab, location: WorkspaceLocation, replace: boolean): WorkspaceTab {
  const history = tab.history.slice(0, tab.historyIndex + 1);
  if (replace) history[history.length - 1] = location;
  else if (history.at(-1)?.url !== location.url) history.push(location);
  const bounded = history.slice(-MAX_HISTORY);
  return {...tab, location, history: bounded, historyIndex: bounded.length - 1,
    title: tab.title};
}

export interface WorkspaceController extends WorkspaceNavigation {
  getSnapshot(): WorkspaceSnapshot;
  isCurrentProjection(projection: WorkspaceProjection | null): boolean;
  subscribe(listener: () => void): () => void;
  setProjection(projection: WorkspaceProjection | null): void;
  /** Confirmed authorization refusal, distinct from a transient verification gap. */
  revokeProjection(): void;
  activate(id: string): boolean;
  close(id: string): boolean;
  move(id: string, index: number): boolean;
  lock(id: string, locked: boolean): boolean;
  pin(id: string): boolean;
  readPanelStateFor(tabId: string): WorkspacePanelState | null;
  savePanelStateFor(tabId: string, state: WorkspacePanelState): boolean;
  dispose(): void;
}

export function createWorkspaceController(options: {access: AccessController; views: readonly WorkspaceView[];
  contextId: string; projection?: WorkspaceProjection | null; initialUrl?: string;
  homeViewId?: string; surface?: 'workspace' | 'front';
  storage?: WorkspaceStorage;
  onLocationChange?: (url: string) => void}): WorkspaceController {
  const {access, views, contextId, onLocationChange} = options;
  const surface = options.surface ?? 'workspace';
  const storage = options.storage, key = storageKey(access.audience, contextId, surface);
  let projection: WorkspaceProjection | null = null;
  let projectionCurrent = false;
  let snapshot: WorkspaceSnapshot = Object.freeze({tabs: Object.freeze([]), activeTabId: null});
  let disposed = false;
  let nextId = 0;
  const listeners = new Set<() => void>();
  const verified = () => {
    const state = access.getSnapshot();
    return state.phase === 'authenticated' && state.pending === null && state.session
      && state.session.audience === access.audience ? state.session : null;
  };
  const allowed = () => new Set(projection?.viewIds ?? []);
  const available = () => projectionCurrent && !!projection && !!verified();
  const publish = (tabs: readonly WorkspaceTab[], activeTabId: string | null) => {
    snapshot = Object.freeze({tabs: Object.freeze(tabs), activeTabId});
    const persisted = projectionCurrent && !!projection && persistTabs(storage, key, projection, snapshot, views);
    for (const listener of listeners) listener();
    const active = tabs.find(tab => tab.id === activeTabId);
    if (active) onLocationChange?.(active.location.url);
    return persisted;
  };
  const purge = () => { if (snapshot.tabs.length || snapshot.activeTabId) publish([], null); };
  const viewFor = (key: string) => views.find(view => viewKey(view) === key
    && view.surfaces.includes(surface) && view.audiences.includes(access.audience));
  const openLocation = (location: WorkspaceLocation, opts: {newTab?: boolean; replace?: boolean} = {}) => {
    if (!available() || !allowed().has(location.viewId)) return false;
    const view = viewFor(location.viewId);
    if (!view) return false;
    const existing = snapshot.tabs.find(tab => tab.location.identity === location.identity);
    if (existing && !opts.newTab) {
      const updated = tabWithLocation(existing, location, !!opts.replace);
      publish(snapshot.tabs.map(tab => tab.id === existing.id ? updated : tab), existing.id);
      return true;
    }
    const active = snapshot.tabs.find(tab => tab.id === snapshot.activeTabId);
    // A locked or pinned tab keeps its location; another identity opens a
    // separate retained pane and history.
    const newTab = opts.newTab || !active || active.locked || active.pinned
      || active.location.identity !== location.identity;
    if (!newTab && active) {
      const updated = tabWithLocation(active, location, !!opts.replace);
      publish(snapshot.tabs.map(tab => tab.id === active.id ? updated : tab), active.id);
      return true;
    }
    if (snapshot.tabs.length >= MAX_WORKSPACE_TABS) return false;
    const tab: WorkspaceTab = Object.freeze({id: `pane-${++nextId}`, title: view.title,
      locked: false, pinned: false, location, history: [location], historyIndex: 0});
    publish([...snapshot.tabs, tab], tab.id);
    return true;
  };
  const unsubscribe = access.subscribe(() => {
    const state = access.getSnapshot();
    if (state.pending || state.phase === 'anonymous') {
      forgetStorage(storage, key, projection?.sessionId, projection?.principalId);
      projection = null; projectionCurrent = false; purge(); return;
    }
    if (state.phase === 'loading' || state.phase === 'unavailable') {
      projectionCurrent = false; return;
    }
    const session = verified();
    if (!session || projection && (projection.sessionId !== session.id
      || projection.principalId !== session.principalId)) {
      forgetStorage(storage, key, projection?.sessionId, projection?.principalId);
      projection = null; projectionCurrent = false; purge();
    }
  });
  const controller: WorkspaceController = {
    getSnapshot: () => snapshot,
    isCurrentProjection: supplied => projectionCurrent && !!supplied && projection === supplied && available(),
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    setProjection(next) {
      if (disposed) return;
      const session = verified();
      if (!session || !next) { projectionCurrent = false; return; }
      if (next.sessionId !== session.id || next.principalId !== session.principalId
        || next.audience !== access.audience || next.contextId !== contextId
        || !/^sha256-[a-f0-9]{64}$/.test(next.compositionDigest)
        || !Number.isSafeInteger(next.epoch) || next.epoch < 0
        || !Array.isArray(next.viewIds) || !Array.isArray(next.navigationIds)) {
        projectionCurrent = false; return;
      }
      if (projection && projection.compositionDigest === next.compositionDigest
        && projection.epoch > next.epoch) return;
      const changed = !projection || projection.sessionId !== next.sessionId
        || projection.principalId !== next.principalId || projection.audience !== next.audience
        || projection.contextId !== next.contextId || projection.compositionDigest !== next.compositionDigest;
      const restored = changed ? restoreTabs(storage, key, next, views, options.homeViewId, surface) : null;
      projection = next;
      projectionCurrent = true;
      if (changed) {
        purge();
        if (restored?.tabs.length) {
          snapshot = restored;
          nextId = Math.max(nextId, ...restored.tabs.map(tab => Number(tab.id.slice(5))));
          publish(restored.tabs, restored.activeTabId);
        } else {
          if (options.homeViewId && next.viewIds.includes(options.homeViewId)
            && controller.open(options.homeViewId)) {
            const home = snapshot.tabs[0];
            if (home) controller.pin(home.id);
          }
          publish(snapshot.tabs, snapshot.activeTabId);
        }
        return;
      }
      const keys = allowed();
      const tabs = snapshot.tabs.filter(tab => keys.has(tab.location.viewId) && !!viewFor(tab.location.viewId));
      if (tabs.length !== snapshot.tabs.length) publish(tabs,
        tabs.some(tab => tab.id === snapshot.activeTabId) ? snapshot.activeTabId : tabs.at(-1)?.id ?? null);
      else publish(snapshot.tabs, snapshot.activeTabId);
    },
    revokeProjection() {
      if (disposed) return;
      forgetStorage(storage, key, projection?.sessionId, projection?.principalId);
      projection = null; projectionCurrent = false; purge();
    },
    open(key, input = {}, opts) {
      if (disposed || !available() || !allowed().has(key)) return false;
      const view = viewFor(key), location = view && createWorkspaceLocation(view, input);
      return location ? openLocation(location, opts) : false;
    },
    visit(url, opts) {
      if (disposed || !available()) return false;
      const location = resolveWorkspaceLocation(url, views.filter(view => view.audiences.includes(access.audience)), allowed(), surface);
      return location ? openLocation(location, opts) : false;
    },
    back() {
      const tab = snapshot.tabs.find(item => item.id === snapshot.activeTabId);
      if (!available() || !tab || tab.historyIndex === 0) return false;
      const index = tab.historyIndex - 1, location = tab.history[index];
      if (!allowed().has(location.viewId)) return false;
      publish(snapshot.tabs.map(item => item.id === tab.id ? {...item, location, historyIndex: index} : item), tab.id);
      return true;
    },
    forward() {
      const tab = snapshot.tabs.find(item => item.id === snapshot.activeTabId);
      if (!available() || !tab || tab.historyIndex >= tab.history.length - 1) return false;
      const index = tab.historyIndex + 1, location = tab.history[index];
      if (!allowed().has(location.viewId)) return false;
      publish(snapshot.tabs.map(item => item.id === tab.id ? {...item, location, historyIndex: index} : item), tab.id);
      return true;
    },
    readPanelState() { return snapshot.activeTabId ? controller.readPanelStateFor(snapshot.activeTabId) : null; },
    savePanelState(value) { return snapshot.activeTabId ? controller.savePanelStateFor(snapshot.activeTabId, value) : false; },
    readPanelStateFor(tabId) {
      if (!available()) return null;
      return snapshot.tabs.find(tab => tab.id === tabId)?.panelState ?? null;
    },
    savePanelStateFor(tabId, value) {
      if (!available()) return false;
      const tab = snapshot.tabs.find(item => item.id === tabId);
      const view = tab && viewFor(tab.location.viewId);
      if (!tab || !view || !allowed().has(tab.location.viewId)) return false;
      const state = panelState(value, view);
      if (!state) return false;
      return publish(snapshot.tabs.map(item => item.id === tab.id ? {...item, panelState: state} : item), snapshot.activeTabId);
    },
    activate(id) {
      if (!available() || !snapshot.tabs.some(tab => tab.id === id)) return false;
      publish(snapshot.tabs, id); return true;
    },
    close(id) {
      const tab = snapshot.tabs.find(item => item.id === id);
      if (!available() || !tab || tab.locked || tab.pinned) return false;
      const index = snapshot.tabs.indexOf(tab), tabs = snapshot.tabs.filter(item => item.id !== id);
      publish(tabs, snapshot.activeTabId === id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : snapshot.activeTabId);
      return true;
    },
    move(id, index) {
      const tab = snapshot.tabs.find(item => item.id === id);
      if (!available() || !tab || tab.pinned || !Number.isInteger(index)) return false;
      const tabs = snapshot.tabs.filter(item => item.id !== id);
      const min = tabs.filter(item => item.pinned).length;
      tabs.splice(Math.max(min, Math.min(index, tabs.length)), 0, tab);
      publish(tabs, snapshot.activeTabId); return true;
    },
    lock(id, locked) {
      const tab = snapshot.tabs.find(item => item.id === id);
      if (!available() || !tab || tab.pinned) return false;
      publish(snapshot.tabs.map(item => item.id === id ? {...item, locked} : item), snapshot.activeTabId);
      return true;
    },
    pin(id) {
      const tab = snapshot.tabs.find(item => item.id === id);
      if (!available() || !tab || snapshot.tabs.some(item => item.pinned)) return false;
      publish([{...tab, pinned: true, locked: true}, ...snapshot.tabs.filter(item => item.id !== id)], snapshot.activeTabId);
      return true;
    },
    dispose() { if (disposed) return; disposed = true; unsubscribe(); listeners.clear(); projection = null; projectionCurrent = false; purge(); },
  };
  controller.setProjection(options.projection ?? null);
  if (options.initialUrl) controller.visit(options.initialUrl);
  return controller;
}
