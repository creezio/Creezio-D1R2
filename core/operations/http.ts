import { createD1IdentityStore } from '../identity/d1-store.ts';
import { identityAdmissionKey } from '../identity/input.ts';
import { AccessHttpError, HTTP_POLICY, readAccessCookie, readAccessJson, resolveAccessHttpConfiguration } from '../identity/http-policy.ts';
import type { RuntimeEnvironment } from '../runtime/environment.ts';
import type { PermissionDefinition } from '../authorization/types.ts';
import type { RuntimeDataCatalog } from '../data/types.ts';
import type { OperationRegistry } from './registry.ts';
import { createOperationEngine } from './service.ts';
import { dispatchWorkspaceHttp } from '../workspace/http.ts';
import type { WorkspaceAuthorizationCatalog } from '../workspace/authorization.ts';
import { dispatchFrontHttp } from '../front/http.ts';
import type { FrontAuthorizationCatalog } from '../front/authorization.ts';
import { OperationError } from './types.ts';
import type { OperationHttpBinding, OperationHttpExecution } from './http-types.ts';
import { oauthResource } from '../oauth/protocol.ts';
import {dispatchFileHttp} from '../files/http.ts';
import type {RuntimeFileCatalog} from '../files/catalog.ts';
import type {FileBucket} from '../files/service.ts';
import {createOpenAiProviderHost,readProviderKeyring} from '../providers/host.ts';
import type {ProviderConfigStorage,ProviderHttpPort,ProviderTransport} from '../../sdk/providers/types.ts';
import type {VaultStorage} from '../vault/service.ts';
import {createTurnBridge} from '../conversations/turn-bridge.ts';
import type {ProviderOperationSchema} from '../providers/tools.ts';
import {dispatchWidgetHttp} from '../widgets/http.ts';
import {createWidgetApprovalService} from '../widgets/approval.ts';
import type {CompiledWidgetCatalog, WidgetValidatorMap} from '../../sdk/widgets/catalog.ts';

type Engine = ReturnType<typeof createOperationEngine>;
const encoder = new TextEncoder();
const STATUS_PREFIX = '/api/operations/status/';
const LOOKUP_PREFIX = '/api/operations/lookup/';
export const OPERATION_HTTP_DEADLINE_MS = 30_000;
const fail = (code: string, status: number): never => { throw new AccessHttpError(code, status); };
function json(body: unknown, status: number, requestId: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-creezio-request-id', requestId);
  return new Response(JSON.stringify(body), { status, headers });
}
const failure = (code: string, status: number, requestId: string, extra?: HeadersInit, head = false) => {
  const response = json({ error: { code }, requestId }, status, requestId, extra);
  return head ? new Response(null, {status: response.status, headers: response.headers}) : response;
};
function projected(execution: Awaited<ReturnType<Engine['status']>>, replayed?: boolean): OperationHttpExecution {
  if (!execution) throw new AccessHttpError('not_found', 404);
  return Object.freeze({ id: execution.id, state: execution.state, output: execution.output,
    errorCode: execution.errorCode, ...(replayed === undefined ? {} : { replayed }) });
}
function match(path: string, template: string): Record<string, string> | null {
  const actual = path.split('/'), expected = template.split('/');
  if (actual.length !== expected.length) return null;
  const result: Record<string, string> = Object.create(null);
  for (let i = 0; i < actual.length; i++) {
    const slot = /^\{([A-Za-z][A-Za-z0-9_]*)\}$/.exec(expected[i]);
    let value: string;
    try { value = decodeURIComponent(actual[i]); } catch { return null; }
    if (/[/\\\u0000-\u001f\u007f]/.test(value) || value === '.' || value === '..' || value.length > 256) return null;
    if (slot) { if (!value) return null; result[slot[1]] = value; }
    else if (value !== expected[i]) return null;
  }
  return result;
}
function primitive(raw: string, codec: OperationHttpBinding['parameters'][number]['codec']): string | number | boolean {
  if (raw.length > 2048 || !raw.isWellFormed()) fail('invalid_input', 400);
  if (codec === 'string') return raw;
  if (codec === 'boolean') { if (raw === 'true') return true; if (raw === 'false') return false; }
  if (codec === 'integer' && /^(?:0|-?[1-9][0-9]*)$/.test(raw)) {
    const value = Number(raw); if (Number.isSafeInteger(value)) return value;
  }
  if (codec === 'number' && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) {
    const value = Number(raw); if (Number.isFinite(value)) return value;
  }
  return fail('invalid_input', 400);
}
function headerLimit(request: Request): void {
  let total = 0;
  for (const [name, value] of request.headers) {
    total += encoder.encode(name).length + encoder.encode(value).length + 4;
    if (total > HTTP_POLICY.maxHeaderBytes) fail('headers_too_large', 431);
  }
}
function decodedRequestKey(request: Request): string {
  const encoded = request.headers.get('x-creezio-request-key');
  if (!encoded || !/^[A-Za-z0-9_-]{2,683}$/.test(encoded)) return fail('invalid_input', 400);
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    if (!binary.length || binary.length > 512) fail('invalid_input', 400);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const key = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    if (!key || !key.isWellFormed() || btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') !== encoded)
      fail('invalid_input', 400);
    return key;
  } catch { return fail('invalid_input', 400); }
}
function approvalPointer(request: Request, statusRead: boolean): string | undefined {
  const value = request.headers.get('x-creezio-approval-id');
  if (value === null) return undefined;
  // This is an opaque grant reference, never part of a module's business input.
  // Only the engine may establish its authority and consume it with the mutation.
  if (statusRead || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) fail('invalid_input', 400);
  return value;
}
function bearer(request: Request): {kind: 'api-token' | 'oauth'; token: string} {
  const value = request.headers.get('authorization');
  const found = value && /^Bearer (cz1([ao])_[A-Za-z0-9_-]{43})$/.exec(value);
  if (!found) throw new AccessHttpError('authentication_required', 401);
  return {kind: found[2] === 'o' ? 'oauth' : 'api-token', token: found[1]};
}
function credential(request: Request, binding: OperationHttpBinding, configuration: NonNullable<ReturnType<typeof resolveAccessHttpConfiguration>>) {
  // Presence of Authorization chooses machine auth irrevocably, even when malformed.
  if (request.headers.has('authorization')) {
    const issued = bearer(request);
    if (!binding.auth.includes(issued.kind)) fail('authentication_required', 401);
    return issued.kind === 'oauth'
      ? {kind: 'oauth' as const, token: issued.token, resource: oauthResource(configuration.origin, binding.audience)}
      : {kind: 'api-token' as const, token: issued.token};
  }
  if (!binding.auth.includes('session')) {
    if (binding.auth.some(value => ['anonymous', 'impersonation', 'webhook-signature'].includes(value)))
      fail('capability_unavailable', 501);
    fail('authentication_required', 401);
  }
  const token = readAccessCookie(request, configuration, binding.audience);
  if (!token) {
    throw new AccessHttpError('authentication_required', 401);
  }
  return { kind: 'session' as const, token };
}
function context(request: Request, binding: OperationHttpBinding): string {
  const value = request.headers.get('x-creezio-context');
  if (binding.context === 'application') {
    if (value !== null && value !== 'application') fail('invalid_context', 400);
    return 'application';
  }
  if (!value || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new AccessHttpError('invalid_context', 400);
  return value;
}
function transportChecks(request: Request, binding: OperationHttpBinding,
  configuration: NonNullable<ReturnType<typeof resolveAccessHttpConfiguration>>, statusRead: boolean): void {
  headerLimit(request);
  const url = new URL(request.url);
  if (url.origin !== configuration.origin || request.headers.get('origin') !== null && request.headers.get('origin') !== configuration.origin)
    fail('origin_denied', 403);
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') fail('origin_denied', 403);
  const mutation = !statusRead && binding.method !== 'GET';
  if (mutation && !request.headers.has('authorization')) {
    if (request.headers.get('origin') !== configuration.origin || request.headers.get('x-creezio-request') !== '1')
      fail('origin_denied', 403);
  }
  if (mutation && request.headers.get('x-creezio-request') !== '1') fail('request_header_required', 403);
  if ((!mutation || statusRead) && (request.body !== null || request.headers.has('content-encoding'))) fail('body_not_allowed', 400);
  if (statusRead && url.search) fail('query_not_allowed', 400);
}
function mappedInput(request: Request, binding: OperationHttpBinding, pathValues: Record<string, string>, body: unknown): unknown {
  const url = new URL(request.url), input: Record<string, unknown> = Object.create(null);
  if (body !== undefined) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) fail('invalid_input', 400);
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) input[key] = value;
  }
  const allowedQuery = new Set(binding.parameters.filter(parameter => parameter.in === 'query').map(parameter => parameter.name));
  if ([...url.searchParams].length > 64 || [...url.searchParams.keys()].some(key => !allowedQuery.has(key))) fail('invalid_query', 400);
  for (const parameter of binding.parameters) {
    const raw = parameter.in === 'path' ? pathValues[parameter.name]
      : parameter.in === 'query' ? url.searchParams.getAll(parameter.name)
      : request.headers.get(parameter.name);
    if (Array.isArray(raw) && raw.length > 1) fail('invalid_query', 400);
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value === null) { if (parameter.required) fail('invalid_input', 400); continue; }
    if (Object.hasOwn(input, parameter.inputField)) fail('argument_collision', 400);
    input[parameter.inputField] = primitive(value, parameter.codec);
  }
  return input;
}
async function admit(environment: RuntimeEnvironment, binding: OperationHttpBinding, token: string, statusRead = false): Promise<void> {
  const store = createD1IdentityStore(environment.bindings.DB), windowMs = binding.rateLimit.windowSeconds * 1000;
  // Reconciliation has its own bounded bucket; the write that needs inspection
  // must not spend the only declared request slot for its status read.
  const domain = `${binding.contributorModuleId}:${binding.id}${statusRead ? ':status' : ''}`;
  const global = await store.consumeThrottle({ key: await identityAdmissionKey('operation-http-global', domain),
    limit: binding.rateLimit.requests, windowMs });
  if (!global.allowed) fail('rate_limited', 429);
  const actor = await store.consumeThrottle({ key: await identityAdmissionKey('operation-http-credential', `${domain}:${token}`),
    limit: binding.rateLimit.requests, windowMs });
  if (!actor.allowed) fail('rate_limited', 429);
}
function errorStatus(error: OperationError): number {
  switch (error.code) {
    case 'invalid_input': return 400;
    case 'unauthorized': return 401;
    case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'conflict': return 409;
    case 'approval_required': return 428;
    case 'rate_limited': return 429;
    case 'unsupported': return 501;
    case 'cancelled': return 499;
    case 'timeout': return 504;
    case 'unknown': return 202;
    default: return 503;
  }
}
async function bounded<T>(request: Request, action: () => Promise<T>, command: boolean): Promise<T> {
  let rejectCancellation: (reason: AccessHttpError) => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  // A rejected loser in Promise.race must remain observed.
  void cancellation.catch(() => {});
  const cancelled = (timeout: boolean) => rejectCancellation(new AccessHttpError(command ? 'unknown' : timeout ? 'operation_timeout' : 'request_cancelled',
    command ? 202 : timeout ? 504 : 499));
  const onAbort = () => cancelled(false);
  if (request.signal.aborted) onAbort(); else request.signal.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => cancelled(true), OPERATION_HTTP_DEADLINE_MS);
  try { return await Promise.race([Promise.resolve().then(action), cancellation]); }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); }
}

/** Host-only adapter. Bindings are compiled at build time; this does no module discovery. */
export function createOperationHttpTransport(bindings: readonly OperationHttpBinding[], engine: Engine) {
  const selected = Object.freeze([...bindings]);
  if (selected.length > 1000 || selected.some(binding => !binding || typeof binding.path !== 'string')) throw new Error('Invalid HTTP bindings.');
  return Object.freeze({
    async dispatch(request: Request, environment: RuntimeEnvironment, rawEnvironment: unknown, requestId: string): Promise<Response | null> {
      const url = new URL(request.url);
      const statusMatch = /^\/api\/operations\/status\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      const lookupMatch = /^\/api\/operations\/lookup\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      const statusRead = !!statusMatch || !!lookupMatch;
      const statusBinding = statusMatch && selected.find(item => item.contributorModuleId === statusMatch[1] && item.id === statusMatch[2]);
      const lookupBinding = lookupMatch && selected.find(item => item.contributorModuleId === lookupMatch[1] && item.id === lookupMatch[2]);
      const matches = statusRead ? [] : selected.flatMap(binding => { const params = match(url.pathname, binding.path); return params ? [{ binding, params }] : []; });
      if (!statusRead && !matches.length) return null;
      const methods = statusRead ? ['GET'] : matches.map(item => item.binding.method);
      const selectedRoute = statusRead ? null : matches.find(item => item.binding.method === request.method);
      if (!selectedRoute && !statusRead || statusRead && request.method !== 'GET')
        return failure('method_not_allowed', 405, requestId, { allow: [...new Set(methods)].join(', ') }, request.method === 'HEAD');
      const binding = statusMatch ? statusBinding : lookupMatch ? lookupBinding : selectedRoute?.binding;
      if (!binding) return failure('not_found', 404, requestId);
      const configuration = resolveAccessHttpConfiguration(rawEnvironment, environment.profile);
      if (!configuration) return failure('runtime_unavailable', 503, requestId);
      try {
        transportChecks(request, binding, configuration, statusRead);
        const approvalId = approvalPointer(request, statusRead);
        const issued = credential(request, binding, configuration), contextId = context(request, binding);
        if (statusMatch) {
          await admit(environment, binding, issued.token, true);
          const execution = await bounded(request, () => engine.status({ credential: issued, moduleId: binding.moduleId,
            operationId: binding.operationId, audience: binding.audience, contextId, executionId: statusMatch[3] }), false);
          return json({ execution: projected(execution) }, 200, requestId);
        }
        if (lookupMatch) {
          const requestKey = decodedRequestKey(request);
          await admit(environment, binding, issued.token, true);
          const execution = await bounded(request, () => engine.lookup({ credential: issued, moduleId: binding.moduleId,
            operationId: binding.operationId, audience: binding.audience, contextId, requestKey }), false);
          return json({ execution: projected(execution) }, execution?.state === 'running' || execution?.state === 'unknown' ? 202 : 200, requestId);
        }
        const input = mappedInput(request, binding, selectedRoute!.params,
          binding.method === 'GET' ? undefined : await readAccessJson(request));
        await admit(environment, binding, issued.token);
        const result = await bounded(request, () => engine.invoke({ credential: issued, moduleId: binding.moduleId, operationId: binding.operationId,
          audience: binding.audience, contextId, input, signal: request.signal,
          ...(approvalId === undefined ? {} : {approvalId}) }), binding.kind === 'command');
        return json({ execution: projected(result.execution, result.replayed) }, result.execution.state === 'running' || result.execution.state === 'unknown' ? 202 : 200,
          requestId);
      } catch (error) {
        if (error instanceof AccessHttpError) return failure(error.code, error.status, requestId,
          error.status === 429 ? { 'retry-after': String(binding.rateLimit.windowSeconds) } : undefined);
        if (error instanceof OperationError) return failure(error.code, errorStatus(error), requestId);
        return failure('service_unavailable', 503, requestId);
      }
    },
  });
}
export { STATUS_PREFIX as OPERATION_HTTP_STATUS_PREFIX };
export { LOOKUP_PREFIX as OPERATION_HTTP_LOOKUP_PREFIX };

/** Single host entry point for the reviewed static catalogs and request-local D1. */
export function createDeclaredHttpDispatcher(options: {readonly registry: OperationRegistry;
  readonly dataCatalog: RuntimeDataCatalog; readonly permissions: readonly PermissionDefinition[];
  readonly fileCatalog?: RuntimeFileCatalog;
  readonly bindings: readonly OperationHttpBinding[]; readonly workspaceCatalog: WorkspaceAuthorizationCatalog;
  readonly frontCatalog?: FrontAuthorizationCatalog & {readonly front: {readonly kind: 'workspace' | 'headless' | 'theme'}};
  readonly openAiProvider?: {readonly config:ProviderConfigStorage;readonly vault:VaultStorage;
    readonly transport:(http:ProviderHttpPort)=>ProviderTransport};
  readonly toolCatalog?:readonly ProviderOperationSchema[];
  readonly widgetCatalog?:CompiledWidgetCatalog;
  readonly widgetValidators?:WidgetValidatorMap;
  readonly runtimeInventory?: Parameters<typeof createOperationEngine>[0]['runtimeInventory']}) {
  return Object.freeze({async dispatch(request: Request, environment: RuntimeEnvironment, rawEnvironment: unknown,
    requestId: string): Promise<Response | null> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/widgets/')) return options.widgetCatalog
      ? dispatchWidgetHttp(request, environment, rawEnvironment, requestId, {permissions:options.permissions,catalog:options.widgetCatalog,
        approvals:createWidgetApprovalService({db:environment.bindings.DB,catalog:options.dataCatalog,permissions:options.permissions,registry:options.registry})}) : null;
    if (path.startsWith('/api/files/')) return options.fileCatalog
      ? dispatchFileHttp(request, environment, rawEnvironment, requestId, {catalog:options.dataCatalog,files:options.fileCatalog,permissions:options.permissions}) : null;
    if (path.startsWith('/api/workspace/')) return dispatchWorkspaceHttp(request, environment, rawEnvironment, requestId,
      {permissions: options.permissions, catalog: options.workspaceCatalog});
    if (path.startsWith('/api/front/')) return options.frontCatalog?.front.kind === 'theme'
      ? dispatchFrontHttp(request, environment, rawEnvironment, requestId, {permissions: options.permissions, catalog: options.frontCatalog}) : null;
    if (!path.startsWith('/api/')) return null;
    const driveMatch=/^\/api\/operations\/turns\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/drive$/.exec(path);
    if (!path.startsWith(STATUS_PREFIX) && !path.startsWith(LOOKUP_PREFIX)
      && !driveMatch && !options.bindings.some(binding => match(path, binding.path))) return null;
    let keyring:ReturnType<typeof readProviderKeyring>=null;
    try{keyring=readProviderKeyring(rawEnvironment);}catch{/* Misconfigured deployment is unavailable, never replaced with an in-process key. */}
    const provider=options.openAiProvider?createOpenAiProviderHost({db:environment.bindings.DB,
      catalog:options.dataCatalog,permissions:options.permissions,...options.openAiProvider,keyring}):null;
    const createHostEngine = () => createOperationEngine({db: environment.bindings.DB, registry: options.registry,
      catalog: options.dataCatalog, permissions: options.permissions, runtimeInventory: options.runtimeInventory,
      approvals:createWidgetApprovalService({db:environment.bindings.DB,catalog:options.dataCatalog,permissions:options.permissions,registry:options.registry}),
      ...(options.widgetCatalog && options.widgetValidators ? {widgets:{catalog:options.widgetCatalog,validators:options.widgetValidators}} : {}),
      ...(provider ? {providerAvailability:async(request,providerId)=>providerId==='openai.responses.v1'
        ?provider.availability(request):{providerId,state:'missing' as const,modelIds:[]}} : {}),
      ...(options.openAiProvider&&keyring?{providerSecrets:{storage:options.openAiProvider.vault,keyring,
        providerId:'openai.responses.v1'}}:{}),
      ...(options.fileCatalog ? {files:{catalog:options.fileCatalog,bucket:environment.bindings.BUCKET as unknown as FileBucket}} : {})});
    if(driveMatch){
      if(request.method!=='POST')return failure('method_not_allowed',405,requestId,{allow:'POST'},request.method==='HEAD');
      if(!provider)return failure('runtime_unavailable',503,requestId);
      const configuration=resolveAccessHttpConfiguration(rawEnvironment,environment.profile);
      if(!configuration)return failure('runtime_unavailable',503,requestId);
      try{
        headerLimit(request);
        const url=new URL(request.url),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
        if(url.origin!==configuration.origin||origin!==configuration.origin||site!==null&&site!=='same-origin'&&site!=='none'
          ||request.headers.get('x-creezio-request')!=='1')fail('origin_denied',403);
        if(request.headers.has('authorization'))fail('authentication_required',401);
        if(url.search||request.headers.has('content-encoding')||!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))
          fail('invalid_input',400);
        const audienceValue=request.headers.get('x-creezio-audience');
        if(audienceValue!=='admin'&&audienceValue!=='app')fail('invalid_input',400);
        const audience=audienceValue as 'admin'|'app';
        const contextValue=request.headers.get('x-creezio-context');
        if(!contextValue||contextValue.length>128||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(contextValue))fail('invalid_context',400);
        const contextId=contextValue as string;
        const token=readAccessCookie(request,configuration,audience);
        if(!token)fail('authentication_required',401);
        const body=await readAccessJson(request) as Record<string,unknown>;
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='conversationId'
          ||typeof body.conversationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.conversationId)
          ||encoder.encode(JSON.stringify(body)).length>1024)fail('invalid_input',400);
        const bucket=createD1IdentityStore(environment.bindings.DB);
        const throttle=await bucket.consumeThrottle({key:await identityAdmissionKey('turn-drive',`${contextId}:${token}`),
          limit:30,windowMs:60_000});
        if(!throttle.allowed)fail('rate_limited',429);
        const bridge=createTurnBridge({db:environment.bindings.DB,catalog:options.dataCatalog,
          permissions:options.permissions,provider,registry:options.registry,engine:createHostEngine(),toolCatalog:options.toolCatalog??[],
          ...(options.widgetCatalog && options.widgetValidators ? {widgets:{catalog:options.widgetCatalog,validators:options.widgetValidators}} : {})});
        const driveSignal=new AbortController(),onAbort=()=>driveSignal.abort();
        if(request.signal.aborted)onAbort();else request.signal.addEventListener('abort',onAbort,{once:true});
        const driveTimer=setTimeout(()=>driveSignal.abort(),25_000);
        let result;
        try{result=await bounded(request,()=>bridge.drive({credential:{kind:'session',token},
          contextId,audience,conversationId:String(body.conversationId),turnId:driveMatch[1],signal:driveSignal.signal}),true);}
        finally{clearTimeout(driveTimer);request.signal.removeEventListener('abort',onAbort);}
        return json(result,200,requestId);
      }catch(error){
        if(error instanceof AccessHttpError)return failure(error.code,error.status,requestId);
        if(error instanceof OperationError)return failure(error.code,errorStatus(error),requestId);
        return failure('service_unavailable',503,requestId);
      }
    }
    return createOperationHttpTransport(options.bindings, createHostEngine()).dispatch(request, environment, rawEnvironment, requestId);
  }});
}
