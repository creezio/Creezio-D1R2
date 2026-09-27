import renderer from 'vinext/server/fetch-handler';
import { createRuntime } from './core/runtime/dispatch';
import { modules, compositionDigest, nativeAccess, httpBindings, mcpCatalog, permissions, permissionTitles, workspaceCatalog } from './.creezio/generated/server';
import { operationCatalog, operationValidators, operationHandlers } from './.creezio/generated/operations';
import { dataCatalog } from './.creezio/generated/data-catalog';
import { runtimeInventory } from './.creezio/generated/module-inventory';
import { createOperationRegistry } from './core/operations/registry';
import { createDeclaredHttpDispatcher } from './core/operations/http';
import { createOperationEngine } from './core/operations/service';
import { createMcpHttpTransport } from './core/mcp/http';
import { createMcpAuthentication } from './core/mcp/authentication';
import { dispatchOAuthHttp } from './core/oauth/http';
import { oauthResourceMetadataUrl } from './core/oauth/protocol';
import { resolveAccessHttpConfiguration } from './core/identity/http-policy';

const registry = createOperationRegistry({catalog: operationCatalog, validators: operationValidators, handlers: operationHandlers});
const declaredHttp = createDeclaredHttpDispatcher({registry, dataCatalog, permissions, bindings: httpBindings, workspaceCatalog, runtimeInventory});
const oauthHttp = {dispatch(request: Request, resolved: Parameters<typeof dispatchOAuthHttp>[1], rawEnvironment: unknown,
  requestId: string, path: string) {
  return dispatchOAuthHttp(request, resolved, rawEnvironment, permissions, requestId, path, nativeAccess, permissionTitles);
}};
const mcpHttp = {async dispatch(request: Request, resolved: Parameters<typeof dispatchOAuthHttp>[1], rawEnvironment: unknown,
  requestId: string, audience: 'admin' | 'app') {
  const configuration = resolveAccessHttpConfiguration(rawEnvironment, resolved.profile);
  if (!configuration) return Response.json({error:{code:'runtime_unavailable'},requestId},{status:503,
    headers:{'cache-control':'no-store','x-content-type-options':'nosniff','x-creezio-request-id':requestId}});
  const engine = createOperationEngine({db: resolved.bindings.DB, catalog: dataCatalog, registry, permissions, runtimeInventory});
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
