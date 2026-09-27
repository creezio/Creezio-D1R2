import renderer from 'vinext/server/fetch-handler';
import { createRuntime } from './core/runtime/dispatch';
import { modules, compositionDigest, nativeAccess, httpBindings, mcpCatalog, permissions, permissionTitles, workspaceCatalog, frontCatalog } from './.creezio/generated/server';
import { operationCatalog, operationValidators, operationHandlers } from './.creezio/generated/operations';
import { dataCatalog } from './.creezio/generated/data-catalog';
import {fileCatalog} from './.creezio/generated/file-catalog';
import type {FileBucket} from './core/files/service';
import { runtimeInventory } from './.creezio/generated/module-inventory';
import {openAiProvider, toolCatalog} from './.creezio/generated/provider-catalog';
import {createOpenAiProviderHost, readProviderKeyring} from './core/providers/host';
import { createOperationRegistry } from './core/operations/registry';
import { createDeclaredHttpDispatcher } from './core/operations/http';
import { createOperationEngine } from './core/operations/service';
import { createMcpHttpTransport } from './core/mcp/http';
import { createMcpAuthentication } from './core/mcp/authentication';
import { dispatchOAuthHttp } from './core/oauth/http';
import { oauthResourceMetadataUrl } from './core/oauth/protocol';
import { resolveAccessHttpConfiguration } from './core/identity/http-policy';

const registry = createOperationRegistry({catalog: operationCatalog, validators: operationValidators, handlers: operationHandlers});
const declaredHttp = createDeclaredHttpDispatcher({registry, dataCatalog, fileCatalog, permissions, bindings: httpBindings,
  workspaceCatalog, frontCatalog, runtimeInventory, toolCatalog, ...(openAiProvider ? {openAiProvider} : {})});
const oauthHttp = {dispatch(request: Request, resolved: Parameters<typeof dispatchOAuthHttp>[1], rawEnvironment: unknown,
  requestId: string, path: string) {
  return dispatchOAuthHttp(request, resolved, rawEnvironment, permissions, requestId, path, nativeAccess, permissionTitles);
}};
const mcpHttp = {async dispatch(request: Request, resolved: Parameters<typeof dispatchOAuthHttp>[1], rawEnvironment: unknown,
  requestId: string, audience: 'admin' | 'app') {
  const configuration = resolveAccessHttpConfiguration(rawEnvironment, resolved.profile);
  if (!configuration) return Response.json({error:{code:'runtime_unavailable'},requestId},{status:503,
    headers:{'cache-control':'no-store','x-content-type-options':'nosniff','x-creezio-request-id':requestId}});
  let keyring: ReturnType<typeof readProviderKeyring> = null;
  try { keyring = readProviderKeyring(rawEnvironment); } catch { /* Invalid deployment configuration disables the provider. */ }
  const provider = openAiProvider ? createOpenAiProviderHost({db:resolved.bindings.DB,catalog:dataCatalog,permissions,
    ...openAiProvider,keyring}) : null;
  const engine = createOperationEngine({db: resolved.bindings.DB, catalog: dataCatalog, registry, permissions, runtimeInventory,
    ...(provider ? {providerAvailability:async(request,providerId)=>providerId==='openai.responses.v1'
      ?provider.availability(request):{providerId,state:'missing' as const,modelIds:[]}} : {}),
    ...(openAiProvider && keyring ? {providerSecrets:{storage:openAiProvider.vault,keyring,providerId:'openai.responses.v1'}} : {}),
    files:{catalog:fileCatalog,bucket:resolved.bindings.BUCKET as unknown as FileBucket}});
  const authentication = createMcpAuthentication(resolved.bindings.DB, permissions);
  return createMcpHttpTransport(mcpCatalog, registry, engine, {
    origin: configuration.origin,
    resourceMetadataUrl: selected => oauthResourceMetadataUrl(configuration.origin, selected),
    authenticate: authentication.authenticate,
    canDiscover: authentication.canDiscover,
  }).dispatch(request, audience, requestId);
}};
const runtime = createRuntime({ modules, compositionDigest, nativeAccess, declaredHttp, oauthHttp, mcpHttp });

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await runtime.fetch(request, env, ctx);
    if (response) return response;
    return renderer.fetch(request, env, ctx);
  },
};
