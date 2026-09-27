import { resolveRuntimeEnvironment } from './environment.ts';
import { dispatchAccessHttp } from '../identity/http.ts';
import type { CreezioRuntime, RuntimeDefinition, RuntimeInput, RuntimeOperation, RuntimeOperationContext, RuntimeNativeAccess, RuntimeHandler } from './types.ts';

export type { CreezioRuntime, RuntimeDefinition, RuntimeHandler, RuntimeInput, RuntimeModule, RuntimeOperation, RuntimeOperationContext } from './types.ts';

const idPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const methods: readonly string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const isApi = (path: string) => path === '/api' || path.startsWith('/api/') || path === '/mcp' || path.startsWith('/mcp/');
export const RUNTIME_LIMITS = Object.freeze({ maxUrlBytes:8192, maxQueryParameters:64, maxQueryValueBytes:2048, maxDurationMs:30000, defaultDurationMs:1000 });
const encoder = new TextEncoder();

export class RuntimeConfigurationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RuntimeConfigurationError'; this.code = code; }
}
type Segment = { readonly literal: string } | { readonly parameter: string };
type Route = {
  readonly moduleId: string;
  readonly operation: RuntimeOperation;
  readonly segments: readonly Segment[];
  readonly specificity: number;
};

function parseRoute(path: string): readonly Segment[] {
  if (typeof path !== 'string' || path.length > 512 || !/^\/(?:[A-Za-z0-9_.{}-]+\/)*[A-Za-z0-9_.{}-]*$/.test(path) || path.includes('//')) throw new RuntimeConfigurationError('route.invalid', 'Routes must use explicit absolute API paths.');
  const normalized = path.replace(/\/$/, '') || '/';
  if (!isApi(normalized) || normalized === '/api/health' || normalized === '/mcp' || normalized.startsWith('/mcp/'))
    throw new RuntimeConfigurationError('route.reserved', 'This route belongs to the host or health endpoint.');
  const names = new Set<string>();
  const segments = normalized.slice(1).split('/').map(segment => {
    if (/^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment)) {
      const parameter = segment.slice(1, -1);
      if (names.has(parameter)) throw new RuntimeConfigurationError('route.parameter', 'Route parameter names must be unique.');
      names.add(parameter); return Object.freeze({ parameter });
    }
    if (segment === '.' || segment === '..' || /[{}]/.test(segment)) throw new RuntimeConfigurationError('route.invalid', 'Invalid route segment.');
    return Object.freeze({ literal: segment });
  });
  if (segments.length >= 2 && 'literal' in segments[0] && segments[0].literal === 'api'
    && (!('literal' in segments[1]) || ['access', 'operations', 'workspace', 'front', 'files'].includes(segments[1].literal)))
    throw new RuntimeConfigurationError('route.reserved', 'Native authentication, execution and workspace paths belong to the host.');
  return Object.freeze(segments);
}

function nativeAccessFor(definition: RuntimeDefinition): RuntimeNativeAccess {
  const value = definition.nativeAccess;
  if (value === undefined) return Object.freeze({admin: false, app: false});
  if (!value || typeof value !== 'object' || typeof value.admin !== 'boolean' || typeof value.app !== 'boolean'
    || Object.keys(value).length !== 2 || ((value.admin || value.app) && !definition.modules.some(module => module.id === 'creezio.access')))
    throw new RuntimeConfigurationError('native-access.invalid', 'Native account audiences require the selected access module.');
  return Object.freeze({admin: value.admin, app: value.app});
}

function overlap(left: readonly Segment[], right: readonly Segment[]): boolean {
  return left.length === right.length && left.every((segment, i) => !('literal' in segment) || !('literal' in right[i]) || segment.literal === (right[i] as {literal:string}).literal);
}

function compile(definition: RuntimeDefinition): readonly Route[] {
  if (!definition || !Array.isArray(definition.modules) || !/^sha256-[a-f0-9]{64}$/.test(definition.compositionDigest)) throw new RuntimeConfigurationError('composition.invalid', 'A static module list and composition digest are required.');
  nativeAccessFor(definition);
  const modules = new Set<string>(), routes: Route[] = [];
  for (const module of definition.modules) {
    if (!module || !idPattern.test(module.id) || !versionPattern.test(module.version) || !Array.isArray(module.operations) || modules.has(module.id)) throw new RuntimeConfigurationError('module.invalid', 'Module metadata must be valid and unique.');
    modules.add(module.id);
  }
  for (const module of definition.modules) {
    const operations = new Set<string>();
    for (const operation of module.operations) {
      if (!operation || !idPattern.test(operation.id) || operation.operationId !== undefined && !idPattern.test(operation.operationId) || operations.has(operation.id)) throw new RuntimeConfigurationError('operation.invalid', 'API binding identities must be valid and unique.');
      operations.add(operation.id);
      if (!idPattern.test(operation.ownerModuleId) || !modules.has(operation.ownerModuleId)) throw new RuntimeConfigurationError('operation.owner', 'The canonical operation owner must be an active static module.');
      if (!methods.includes(operation.method) || !['public-read', 'protected'].includes(operation.access)) throw new RuntimeConfigurationError('operation.invalid', 'Operation access and method must be declared.');
      if (operation.access === 'public-read' && operation.method !== 'GET') throw new RuntimeConfigurationError('operation.public-write', 'Public operations in this runtime must be explicit GET reads.');
      if (typeof operation.handler !== 'function') throw new RuntimeConfigurationError('operation.handler', 'Every API binding requires a statically supplied handler.');
      if (!Number.isSafeInteger(operation.maxDurationMs) || operation.maxDurationMs < 1 || operation.maxDurationMs > RUNTIME_LIMITS.maxDurationMs) throw new RuntimeConfigurationError('operation.budget', 'Operation duration must be declared within the host budget.');
      const segments = parseRoute(operation.path), specificity = segments.filter(segment => 'literal' in segment).length;
      if (routes.some(route => route.operation.method === operation.method && overlap(route.segments, segments) && route.specificity === specificity)) throw new RuntimeConfigurationError('route.conflict', 'API routes must not have ambiguous matching rules.');
      routes.push(Object.freeze({ moduleId: module.id, operation: Object.freeze({ ...operation }), segments, specificity }));
    }
  }
  return Object.freeze(routes.sort((left, right) => right.specificity - left.specificity));
}

function requestPath(path: string): string[] | null {
  try {
    const segments = (path.replace(/\/$/, '') || '/').slice(1).split('/').map(segment => decodeURIComponent(segment));
    return segments.some(segment => /[/\\\u0000-\u001f\u007f]/.test(segment) || segment === '.' || segment === '..') ? null : segments;
  } catch { return null; }
}
function match(route: Route, segments: readonly string[]): Readonly<Record<string, string>> | null {
  if (route.segments.length !== segments.length) return null;
  const params: Record<string, string> = Object.create(null);
  for (let i = 0; i < segments.length; i++) {
    const expected = route.segments[i];
    if ('literal' in expected) { if (expected.literal !== segments[i]) return null; }
    else { if (!segments[i] || segments[i].length > 256) return null; params[expected.parameter] = segments[i]; }
  }
  return Object.freeze(params);
}

function json(body: unknown, status: number, requestId: string, head: boolean, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-creezio-request-id', requestId);
  return new Response(head ? null : JSON.stringify(body), { status, headers });
}
const error = (code: string, message: string, status: number, requestId: string, head: boolean, headers?: HeadersInit) => json({error:{code,message},requestId},status,requestId,head,headers);

class InvocationCancelled extends Error {
  readonly kind: 'timeout' | 'client';
  constructor(kind: 'timeout' | 'client') { super('Invocation cancelled.'); this.kind = kind; }
}

/** Bounds handler completion, not synchronous JavaScript or an already returned response stream. */
async function invoke(route: Route, input: RuntimeInput, context: Omit<RuntimeOperationContext,'signal'>, requestSignal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  let cancelled: InvocationCancelled | undefined;
  let rejectCancellation: (reason: InvocationCancelled) => void = () => {};
  const cancellation = new Promise<never>((_resolve,reject) => { rejectCancellation = reject; });
  const cancel = (kind:'timeout'|'client') => {
    if(cancelled)return;
    cancelled=new InvocationCancelled(kind); controller.abort(); rejectCancellation(cancelled);
  };
  const onAbort = () => cancel('client');
  if(requestSignal.aborted)cancel('client');else requestSignal.addEventListener('abort',onAbort,{once:true});
  const timer = setTimeout(()=>cancel('timeout'),route.operation.maxDurationMs);
  const execution = Promise.resolve().then(()=>{
    if(cancelled)throw cancelled;
    return (route.operation.handler as RuntimeHandler)(input,Object.freeze({...context,signal:controller.signal}));
  });
  // A handler ignoring AbortSignal can still resolve later. Release its body instead of adopting that result.
  void execution.then(async response=>{ if(cancelled && response instanceof Response)await response.body?.cancel(); }).catch(()=>{});
  try { return await Promise.race([execution,cancellation]); }
  catch(failure) { if(cancelled)throw cancelled; throw failure; }
  finally { clearTimeout(timer); requestSignal.removeEventListener('abort',onAbort); }
}

/** Pure host preflight. Validates registration without invoking any supplied handler. */
export function validateRuntimeDefinition(definition: RuntimeDefinition): void {
  compile(definition);
}

/** Routes are compiled once from reviewed static imports, never from request data or a remote module URL. */
export function createRuntime(definition: RuntimeDefinition): CreezioRuntime {
  const routes = compile(definition);
  const nativeAccess = nativeAccessFor(definition);
  return Object.freeze({
    async fetch(request: Request, environment: unknown): Promise<Response | null> {
      const url = new URL(request.url), head = request.method === 'HEAD';
      // No host environment is needed to render a non-API page through the UI adapter.
      let namespace: string;
      try { namespace = decodeURIComponent(url.pathname.split('/')[1] ?? ''); } catch { return null; }
      if (!['api','mcp','oauth','.well-known'].some(name=>namespace===name||namespace.startsWith(`${name}/`)||namespace.startsWith(`${name}\\`))) return null;
      const requestId = crypto.randomUUID();
      if(request.url.length>RUNTIME_LIMITS.maxUrlBytes||encoder.encode(request.url).byteLength>RUNTIME_LIMITS.maxUrlBytes)return error('request_too_large','Request URL exceeds its limit.',414,requestId,head);
      const segments = requestPath(url.pathname);
      if (!segments) return error('invalid_path','Invalid request path.',400,requestId,head);
      let queryCount=0;
      for(const [key,value] of url.searchParams)if(++queryCount>RUNTIME_LIMITS.maxQueryParameters||encoder.encode(key).byteLength>256||encoder.encode(value).byteLength>RUNTIME_LIMITS.maxQueryValueBytes)return error('invalid_query','Query exceeds its limit.',400,requestId,head);
      const resolved = resolveRuntimeEnvironment(environment);
      if (!resolved) return error('runtime_unavailable','Runtime unavailable.',503,requestId,head);
      const path = `/${segments.join('/')}`;
      if (namespace === 'oauth' || namespace === '.well-known') {
        if (!nativeAccess.admin && !nativeAccess.app)
          return error('not_found','OAuth route not found.',404,requestId,head);
        // The GET consent document is rendered by the host UI. Its preview and
        // decision endpoints, metadata and token endpoints stay in the runtime.
        if (namespace === 'oauth' && (request.method === 'GET' || head)
          && /^\/oauth\/consent\/[A-Za-z0-9_-]{16,128}$/.test(path)) return null;
        if (definition.oauthHttp) {
          try {
            const response = await definition.oauthHttp.dispatch(request, resolved, environment, requestId, path);
            if (response) return response;
          } catch { return error('runtime_unavailable','Runtime unavailable.',503,requestId,head); }
        }
        return error('not_found','OAuth route not found.',404,requestId,head);
      }
      if (namespace === 'mcp') {
        const audience = path === '/mcp/admin' ? 'admin' : path === '/mcp/app' ? 'app' : null;
        if (!audience || !nativeAccess[audience] || !definition.mcpHttp)
          return error('not_found','MCP route not found.',404,requestId,head);
        try { return await definition.mcpHttp.dispatch(request, resolved, environment, requestId, audience); }
        catch { return error('runtime_unavailable','Runtime unavailable.',503,requestId,head); }
      }
      if (path === '/api/health') return request.method === 'GET' || head
        ? json({status:'ok'},200,requestId,head)
        : error('method_not_allowed','Method not allowed.',405,requestId,head,{allow:'GET, HEAD'});
      if (path === '/api/access' || path.startsWith('/api/access/'))
        return dispatchAccessHttp(request, resolved, environment, nativeAccess, requestId, path);
      if (path === '/api/workspace' || path.startsWith('/api/workspace/') || path === '/api/files' || path.startsWith('/api/files/')) {
        const audience = segments[2];
        if ((audience !== 'admin' && audience !== 'app') || !nativeAccess[audience])
          return error('not_found','API route not found.',404,requestId,head);
      }
      if ((path === '/api/front' || path.startsWith('/api/front/')) && !nativeAccess.app)
        return error('not_found','API route not found.',404,requestId,head);
      if (definition.declaredHttp) {
        try {
          const response = await definition.declaredHttp.dispatch(request, resolved, environment, requestId);
          if (response) return response;
        } catch { return error('runtime_unavailable','Runtime unavailable.',503,requestId,head); }
      }
      const matches = routes.flatMap(route => { const params = match(route,segments); return params ? [{route,params}] : []; });
      if (!matches.length) return error('not_found','API route not found.',404,requestId,head);
      const matched = matches.find(item => item.route.operation.method === (head ? 'GET' : request.method))
        ?? (head ? matches.find(item=>item.route.operation.access==='protected') : undefined);
      if (!matched) {
        const allowed = new Set<string>(matches.map(item=>item.route.operation.method)); if(allowed.has('GET'))allowed.add('HEAD');
        return error('method_not_allowed','Method not allowed.',405,requestId,head,{allow:[...allowed].join(', ')});
      }
      // A protected declaration can execute only through the common host adapter above.
      if (matched.route.operation.access === 'protected') return error('authentication_required','Authentication required.',401,requestId,head);
      try {
        const context = Object.freeze({ moduleId:matched.route.operation.ownerModuleId, profile:resolved.profile, requestId });
        const input = Object.freeze({ params:matched.params, query:new URLSearchParams(url.search) });
        const response = await invoke(matched.route,input,context,request.signal);
        if (!(response instanceof Response)) throw new Error('Invalid handler result.');
        const headers = new Headers(response.headers);
        headers.set('x-creezio-request-id',requestId); headers.set('x-content-type-options','nosniff'); headers.set('cache-control','no-store');
        // A stream producer may never settle cancellation. HEAD must not wait for its body.
        if(head)void response.body?.cancel().catch(()=>{});
        return new Response(head?null:response.body,{status:response.status,statusText:response.statusText,headers});
      } catch (failure) {
        if(failure instanceof InvocationCancelled)return failure.kind==='timeout'
          ? error('operation_timeout','Operation deadline exceeded.',504,requestId,head)
          : error('request_cancelled','Request cancelled.',499,requestId,head);
        return error('operation_failed','Operation failed.',500,requestId,head);
      }
    },
  });
}
