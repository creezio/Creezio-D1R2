'use client';

import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode} from 'react';
import {canonicalAccessOrigin, type AccessAudience, type AccessController,
  type AccessSession} from '../access/types.ts';
import type {OperationClient} from '../operations/client.ts';
import type {CompiledWidgetResource, WidgetCatalogEntry} from './catalog.ts';
import {createWidgetApprovalClient, type WidgetApprovalClient} from './approval-client.ts';
import {normalizeWidgetOpenLink} from './host-open-link.ts';

export interface WidgetLinkScope {
  readonly sessionId: string; readonly principalId: string; readonly audience: AccessAudience;
  readonly contextId: string; readonly conversationId: string; readonly messageId: string;
  readonly instanceId: string; readonly instanceRevision: number; readonly instanceSignature: string;
  readonly moduleId: string; readonly widgetId: string;
  readonly widgetVersion: string; readonly resourceUri: string; readonly resourceDigest: string;
  readonly catalogEpoch: number;
}

export interface WidgetHostConfiguration {
  readonly sandboxOrigin: string;
  readonly sessionId: string;
  readonly principalId: string;
  readonly audience: AccessAudience;
  readonly contextId: string;
  readonly epoch: number;
  readonly widgets: readonly WidgetCatalogEntry[];
  readonly resources: readonly Omit<CompiledWidgetResource, 'text'>[];
}
export interface WidgetHostState {
  readonly phase: 'loading' | 'ready' | 'anonymous' | 'unavailable';
  readonly configuration: WidgetHostConfiguration | null;
  readonly error: string | null;
}
export interface WidgetHostValue extends WidgetHostState {
  readonly audience: AccessAudience;
  readonly contextId: string;
  readonly access: AccessController;
  readonly operationClient: OperationClient;
  readonly resolveOperationBinding: (input: {moduleId: string; operationId: string;
    operationDigest: string}) => string | null;
  readonly approvalClient: WidgetApprovalClient | null;
  refresh(): Promise<void>;
  loadResource(uri: string, digest: string, profileId: string): Promise<CompiledWidgetResource | null>;
  linkGeneration(): number;
  retainLink(scope: WidgetLinkScope, url: string, previous: WidgetHostConfiguration,
    generation: number, keyboardCandidate?: boolean): boolean;
  keyboardLinkFocus(scope: WidgetLinkScope): boolean;
  takeLink(scope: WidgetLinkScope): string | null;
  discardLinksForConversation(conversationId: string): void;
}

const WidgetHostContext = createContext<WidgetHostValue | null>(null);
const id = (value: unknown): value is string => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const digest = (value: unknown) => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value &&
  typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const sessionNow = (access: AccessController) => {
  const value = access.getSnapshot();
  return value.phase === 'authenticated' && !value.pending ? value.session : null;
};
const sameSession = (a: AccessSession | null, b: AccessSession | null) => !!a && !!b &&
  a.id === b.id && a.principalId === b.principalId && a.audience === b.audience;
const exactSandboxOrigin = (value: unknown, appOrigin: string) => {
  const normalized = canonicalAccessOrigin(value);
  return normalized && normalized !== appOrigin ? normalized : null;
};

const linkScopeKey = (scope: WidgetLinkScope) => JSON.stringify([
  scope.sessionId, scope.principalId, scope.audience, scope.contextId, scope.conversationId,
  scope.messageId, scope.instanceId, scope.instanceRevision, scope.instanceSignature,
  scope.moduleId, scope.widgetId, scope.widgetVersion,
  scope.resourceUri, scope.resourceDigest, scope.catalogEpoch]);
const linkCatalogSignature = (scope: WidgetLinkScope, config: WidgetHostConfiguration): string | null => {
  if (config.sessionId !== scope.sessionId || config.principalId !== scope.principalId ||
    config.audience !== scope.audience || config.contextId !== scope.contextId ||
    config.epoch !== scope.catalogEpoch) return null;
  const widget = config.widgets.find(item => item.moduleId === scope.moduleId && item.widgetId === scope.widgetId &&
    item.version === scope.widgetVersion && item.resourceUri === scope.resourceUri &&
    item.resourceDigest === scope.resourceDigest && item.audiences.includes(scope.audience));
  const resource = config.resources.find(item => item.moduleId === scope.moduleId && item.widgetId === scope.widgetId &&
    item.version === scope.widgetVersion && item.uri === scope.resourceUri &&
    item.digest === scope.resourceDigest && item.audiences.includes(scope.audience));
  return widget && resource ? JSON.stringify([config.sandboxOrigin, widget, resource]) : null;
};

/** A short-lived, memory-only host intent; it never grants a widget operation or replays its MCP request. */
export function createWidgetLinkContinuity(options: {now?: () => number;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void} = {}) {
  const now = options.now ?? Date.now, schedule = options.schedule ?? setTimeout;
  const unschedule = options.unschedule ?? clearTimeout;
  const held = new Map<string, {scope: WidgetLinkScope; url: string; catalogSignature: string; expiresAt: number;
    timer: ReturnType<typeof setTimeout>; keyboardUntil: number; restoreFocus: boolean}>();
  let generation = 0;
  const remove = (key: string) => {const item = held.get(key); if (item) {unschedule(item.timer); held.delete(key);}};
  return {
    generation: () => generation,
    retain(scope: WidgetLinkScope, url: string, previous: WidgetHostConfiguration,
      expectedGeneration: number, keyboardCandidate = false): boolean {
      const normalized = normalizeWidgetOpenLink(url), key = linkScopeKey(scope);
      const catalogSignature = linkCatalogSignature(scope, previous);
      if (expectedGeneration !== generation || !normalized || normalized !== url || !catalogSignature) return false;
      for (const [oldKey, item] of held) if (oldKey !== key &&
        item.scope.conversationId === scope.conversationId && item.scope.messageId === scope.messageId &&
        item.scope.instanceId === scope.instanceId) remove(oldKey);
      if (held.size >= 8 && !held.has(key)) return false;
      remove(key);
      const expiresAt = now() + 60_000;
      const timer = schedule(() => {held.delete(key);}, 60_000);
      held.set(key, {scope, url, catalogSignature, expiresAt, timer,
        keyboardUntil: keyboardCandidate ? now() + 1000 : 0, restoreFocus: false});
      return true;
    },
    confirmForwardTab() {
      for (const item of held.values()) if (item.keyboardUntil && now() <= item.keyboardUntil) {
        item.keyboardUntil = 0; item.restoreFocus = true;
      }
    },
    cancelFocus() {
      for (const item of held.values()) {item.keyboardUntil = 0; item.restoreFocus = false;}
    },
    keyboardFocus(scope: WidgetLinkScope): boolean {
      const item = held.get(linkScopeKey(scope));
      return !!item?.restoreFocus && now() < item.expiresAt;
    },
    take(scope: WidgetLinkScope, config: WidgetHostConfiguration | null, session: AccessSession | null): string | null {
      const key = linkScopeKey(scope), item = held.get(key);
      for (const [oldKey, old] of held) if (oldKey !== key &&
        old.scope.conversationId === scope.conversationId && old.scope.messageId === scope.messageId &&
        old.scope.instanceId === scope.instanceId) remove(oldKey);
      if (!item) return null;
      remove(key);
      return config && session && now() < item.expiresAt &&
        session.id === scope.sessionId && session.principalId === scope.principalId &&
        session.audience === scope.audience &&
        linkCatalogSignature(scope, config) === item.catalogSignature ? item.url : null;
    },
    discardConversation(conversationId: string) {
      generation++;
      for (const [key, item] of held) if (item.scope.conversationId === conversationId) remove(key);
    },
    clear() {generation++;for (const key of held.keys()) remove(key);},
  };
}

/** Validate the light projection. HTML bytes are fetched only on widget mount. */
export function getWidgetHostConfiguration(value: unknown, scope: {origin: string;
  audience: AccessAudience; contextId: string; session: AccessSession}): WidgetHostConfiguration | null {
  if (!record(value) || !exactSandboxOrigin(value.sandboxOrigin, scope.origin) ||
    value.sessionId !== scope.session.id || value.principalId !== scope.session.principalId ||
    value.audience !== scope.audience || value.contextId !== scope.contextId ||
    !Number.isSafeInteger(value.epoch) || (value.epoch as number) < 0 ||
    !Array.isArray(value.widgets) || value.widgets.length > 1000 ||
    !Array.isArray(value.resources) || value.resources.length > 1000) return null;
  const resources = new Map<string, Record<string, unknown>>();
  for (const raw of value.resources) {
    if (!record(raw) || !id(raw.moduleId) || !id(raw.widgetId) || !digest(raw.digest) ||
      !digest(raw.cspProfileId) || typeof raw.uri !== 'string' ||
      raw.mimeType !== 'text/html;profile=mcp-app' || Object.hasOwn(raw, 'text') ||
      !record(raw.uiMeta) || resources.has(raw.uri)) return null;
    resources.set(raw.uri, raw);
  }
  for (const raw of value.widgets) {
    if (!record(raw) || !id(raw.moduleId) || !id(raw.widgetId) ||
      typeof raw.version !== 'string' || typeof raw.resourceUri !== 'string' ||
      !digest(raw.resourceDigest) || !Array.isArray(raw.actions) || !Array.isArray(raw.serverTools) ||
      !resources.has(raw.resourceUri) || resources.get(raw.resourceUri)?.digest !== raw.resourceDigest) return null;
  }
  return value as unknown as WidgetHostConfiguration;
}

async function jsonWithin(response: Response, maxBytes: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body)
    throw new Error('invalid_response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error('response_too_large');
      chunks.push(part.value);
    }
  } finally {try {reader.releaseLock();} catch {}}
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {joined.set(part, offset); offset += part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(joined));
}

export function WidgetHostProvider(props: {origin: string; audience: AccessAudience; contextId: string;
  access: AccessController; operationClient: OperationClient;
  resolveOperationBinding: WidgetHostValue['resolveOperationBinding']; fetcher?: typeof fetch;
  children: ReactNode}) {
  const origin = canonicalAccessOrigin(props.origin);
  if (!origin || props.access.origin !== origin || props.access.audience !== props.audience)
    throw new TypeError('Invalid widget host provider.');
  const fetcher = useMemo(() => props.fetcher ?? globalThis.fetch.bind(globalThis), [props.fetcher]);
  const approvalClient = useMemo(() => id(props.contextId) ? createWidgetApprovalClient({origin, audience: props.audience,
    contextId: props.contextId, access: props.access, fetcher}) : null,
    [origin, props.audience, props.contextId, props.access, fetcher]);
  const resolverRef = useRef(props.resolveOperationBinding);
  resolverRef.current = props.resolveOperationBinding;
  const resolveOperationBinding = useCallback<WidgetHostValue['resolveOperationBinding']>(
    input => resolverRef.current(input), []);
  const [state, setState] = useState<WidgetHostState>({phase: 'loading', configuration: null, error: null});
  const linkContinuity = useMemo(() => createWidgetLinkContinuity(),
    [props.access, props.audience, props.contextId]);
  const [revision, setRevision] = useState(0);
  const requestGeneration = useRef(0);
  const configurationRef = useRef<WidgetHostConfiguration | null>(null);
  configurationRef.current = state.configuration;
  useEffect(() => props.access.subscribe(() => {
    const snapshot = props.access.getSnapshot();
    if (snapshot.pending || snapshot.phase === 'anonymous' || snapshot.phase === 'unavailable')
      linkContinuity.clear();
    setRevision(value => value + 1);
  }), [props.access, linkContinuity]);
  useEffect(() => () => linkContinuity.clear(), [linkContinuity]);
  useEffect(() => {
    const cancel = () => linkContinuity.cancelFocus();
    const keyDown = (event: KeyboardEvent) => {if (event.isTrusted) cancel();};
    const keyUp = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey &&
        document.visibilityState === 'visible' &&
        document.hasFocus() && document.activeElement === document.body)
        linkContinuity.confirmForwardTab();
      else cancel();
    };
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('keyup', keyUp, true);
    document.addEventListener('pointerdown', cancel, true);
    document.addEventListener('focusin', cancel, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('keyup', keyUp, true);
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('focusin', cancel, true);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [linkContinuity]);
  const session = sessionNow(props.access);
  const sessionKey = session ? `${session.id}:${session.principalId}` : '';
  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    const before = sessionNow(props.access);
    configurationRef.current = null;
    if (!id(props.contextId)) {linkContinuity.clear();setState({phase: 'unavailable', configuration: null,
      error: 'Contexte de widgets invalide.'}); return;}
    if (!before) {setState({phase: 'anonymous', configuration: null, error: null}); return;}
    setState({phase: 'loading', configuration: null, error: null});
    try {
      const response = await fetcher(`${origin}/api/widgets/${props.audience}/catalog`, {method: 'GET',
        headers: {'accept': 'application/json', 'x-creezio-context': props.contextId},
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store'});
      if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
        throw new Error('invalid_response');
      const body = await jsonWithin(response, 262_144);
      if (generation !== requestGeneration.current || !sameSession(before, sessionNow(props.access))) return;
      const config = response.status === 200 ? getWidgetHostConfiguration(body,
        {origin, audience: props.audience, contextId: props.contextId, session: before}) : null;
      if (!config) linkContinuity.clear();
      setState(config ? {phase: 'ready', configuration: config, error: null} :
        {phase: 'unavailable', configuration: null, error: 'Catalogue de widgets indisponible.'});
    } catch {
      if (generation === requestGeneration.current && sameSession(before, sessionNow(props.access))) {
        linkContinuity.clear();
        setState({phase: 'unavailable', configuration: null, error: 'Catalogue de widgets indisponible.'});
      }
    }
  }, [props.access, props.audience, props.contextId, fetcher, origin, linkContinuity]);
  useEffect(() => {void refresh(); return () => {requestGeneration.current++;};}, [refresh, sessionKey, revision]);
  const loadResource = useCallback(async (uri: string, wantedDigest: string, profileId: string) => {
    const before = sessionNow(props.access), config = state.configuration;
    if (!before || state.phase !== 'ready' || !config || config.sessionId !== before.id ||
      config.principalId !== before.principalId || !digest(wantedDigest) || !digest(profileId)) return null;
    const declared = config.resources.find(resource => resource.uri === uri &&
      resource.digest === wantedDigest && resource.cspProfileId === profileId &&
      resource.audiences.includes(props.audience));
    if (!declared) return null;
    try {
      const url = new URL(`/api/widgets/${props.audience}/resource`, origin);
      url.searchParams.set('uri', uri);
      const response = await fetcher(url.href, {method: 'GET',
        headers: {'accept': 'application/json', 'x-creezio-context': props.contextId},
        credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store'});
      if (!(response instanceof Response) || response.redirected || response.url && new URL(response.url).origin !== origin)
        return null;
      const body = await jsonWithin(response, 6 * 1_048_576 + 32_768);
      if (!sameSession(before, sessionNow(props.access)) || configurationRef.current !== config || response.status !== 200 ||
        !record(body) || !record(body.resource)) return null;
      const resource = body.resource;
      if (resource.uri !== uri || resource.digest !== wantedDigest || resource.cspProfileId !== profileId ||
        resource.mimeType !== 'text/html;profile=mcp-app' || typeof resource.text !== 'string' ||
        new TextEncoder().encode(resource.text).byteLength > 1_048_576 ||
        JSON.stringify(resource.uiMeta) !== JSON.stringify(declared.uiMeta)) return null;
      return resource as unknown as CompiledWidgetResource;
    } catch {return null;}
  }, [props.access, props.audience, props.contextId, fetcher, origin, state]);
  const linkGeneration = useCallback(() => linkContinuity.generation(), [linkContinuity]);
  const retainLink = useCallback((scope: WidgetLinkScope, url: string,
    previous: WidgetHostConfiguration, generation: number, keyboardCandidate = false) =>
    linkContinuity.retain(scope, url, previous, generation, keyboardCandidate), [linkContinuity]);
  const keyboardLinkFocus = useCallback((scope: WidgetLinkScope) =>
    linkContinuity.keyboardFocus(scope), [linkContinuity]);
  const takeLink = useCallback((scope: WidgetLinkScope) =>
    linkContinuity.take(scope, state.phase === 'ready' ? state.configuration : null,
      sessionNow(props.access)), [linkContinuity, state, props.access]);
  const discardLinksForConversation = useCallback((conversationId: string) =>
    linkContinuity.discardConversation(conversationId), [linkContinuity]);
  const value = useMemo<WidgetHostValue>(() => ({...state, audience: props.audience,
    contextId: props.contextId, access: props.access, operationClient: props.operationClient,
    resolveOperationBinding, approvalClient, refresh, loadResource,
    linkGeneration, retainLink, keyboardLinkFocus, takeLink, discardLinksForConversation}),
    [state, props.audience, props.contextId, props.access, props.operationClient,
      resolveOperationBinding, approvalClient, refresh, loadResource,
      linkGeneration, retainLink, keyboardLinkFocus, takeLink, discardLinksForConversation]);
  return <WidgetHostContext.Provider value={value}>{props.children}</WidgetHostContext.Provider>;
}

export function useWidgetHost(): WidgetHostValue | null {return useContext(WidgetHostContext);}
