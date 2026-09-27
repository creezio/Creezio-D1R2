'use client';

import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode} from 'react';
import {canonicalAccessOrigin, type AccessAudience, type AccessController,
  type AccessSession} from '../access/types.ts';
import type {OperationClient} from '../operations/client.ts';
import type {CompiledWidgetResource, WidgetCatalogEntry} from './catalog.ts';
import {createWidgetApprovalClient, type WidgetApprovalClient} from './approval-client.ts';

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
  const [revision, setRevision] = useState(0);
  const requestGeneration = useRef(0);
  const configurationRef = useRef<WidgetHostConfiguration | null>(null);
  configurationRef.current = state.configuration;
  useEffect(() => props.access.subscribe(() => setRevision(value => value + 1)), [props.access]);
  const session = sessionNow(props.access);
  const sessionKey = session ? `${session.id}:${session.principalId}` : '';
  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    const before = sessionNow(props.access);
    configurationRef.current = null;
    if (!id(props.contextId)) {setState({phase: 'unavailable', configuration: null,
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
      setState(config ? {phase: 'ready', configuration: config, error: null} :
        {phase: 'unavailable', configuration: null, error: 'Catalogue de widgets indisponible.'});
    } catch {
      if (generation === requestGeneration.current && sameSession(before, sessionNow(props.access)))
        setState({phase: 'unavailable', configuration: null, error: 'Catalogue de widgets indisponible.'});
    }
  }, [props.access, props.audience, props.contextId, fetcher, origin]);
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
  const value = useMemo<WidgetHostValue>(() => ({...state, audience: props.audience,
    contextId: props.contextId, access: props.access, operationClient: props.operationClient,
    resolveOperationBinding, approvalClient, refresh, loadResource}),
    [state, props.audience, props.contextId, props.access, props.operationClient,
      resolveOperationBinding, approvalClient, refresh, loadResource]);
  return <WidgetHostContext.Provider value={value}>{props.children}</WidgetHostContext.Provider>;
}

export function useWidgetHost(): WidgetHostValue | null {return useContext(WidgetHostContext);}
