import renderer from 'vinext/server/fetch-handler';
import { createRuntime } from './core/runtime/dispatch';
import { modules, compositionDigest, nativeAccess, httpBindings, mcpCatalog, permissions, permissionTitles, workspaceCatalog, workspaceNavigationCatalog, frontCatalog, widgetCatalog, widgetValidators } from './.creezio/generated/server';
import { operationCatalog, operationValidators, operationHandlers } from './.creezio/generated/operations';
import { dataCatalog } from './.creezio/generated/data-catalog';
import {fileCatalog} from './.creezio/generated/file-catalog';
import {publicPageProjection} from './.creezio/generated/public-pages';
import {createPublicPages} from './core/runtime/public-pages';
import {frontContextId} from './application/config/front';
import {readMcpLinkedImage} from './core/files/mcp';
import { runtimeInventory } from './.creezio/generated/module-inventory';
import {openAiProvider, toolCatalog, connectors, searchProjections, webhookMappings, deliveryMappings} from './.creezio/generated/provider-catalog';
import { createOperationRegistry } from './core/operations/registry';
import { createDeclaredHttpDispatcher } from './core/operations/http';
import {createRuntimeOperationHost} from './core/runtime/operation-host';
import { createMcpHttpTransportFactory } from './core/mcp/http';
import { createMcpAuthentication } from './core/mcp/authentication';
import { dispatchOAuthHttp } from './core/oauth/http';
import { oauthResourceMetadataUrl } from './core/oauth/protocol';
import { resolveAccessHttpConfiguration } from './core/identity/http-policy';

const registry = createOperationRegistry({catalog: operationCatalog, validators: operationValidators, handlers: operationHandlers});
const analyticsCompiled=modules.some(module=>module.id==='creezio.analytics');
const mcpTransportFactory = createMcpHttpTransportFactory(mcpCatalog, registry);
const declaredHttp = createDeclaredHttpDispatcher({registry, dataCatalog, fileCatalog, permissions, bindings: httpBindings,
  workspaceCatalog, workspaceNavigationCatalog, frontCatalog, runtimeInventory, toolCatalog, widgetCatalog, widgetValidators, connectors,
  search:searchProjections,deliveries:deliveryMappings,webhooks:{mappings:webhookMappings,contextId:frontContextId},
  ...(openAiProvider ? {openAiProvider} : {})});
const oauthHttp = {dispatch(request: Request, resolved: Parameters<typeof dispatchOAuthHttp>[1], rawEnvironment: unknown,
  requestId: string, path: string) {
  return dispatchOAuthHttp(request, resolved, rawEnvironment, permissions, requestId, path, nativeAccess, permissionTitles,
    resolved.storageAuthority?.storageMutation??undefined);
}};
const mcpHttp = {async dispatch(request: Request, resolved: Parameters<typeof dispatchOAuthHttp>[1], rawEnvironment: unknown,
  requestId: string, audience: 'admin' | 'app') {
  const configuration = resolveAccessHttpConfiguration(rawEnvironment, resolved.profile);
  if (!configuration) return Response.json({error:{code:'runtime_unavailable'},requestId},{status:503,
    headers:{'cache-control':'no-store','x-content-type-options':'nosniff','x-creezio-request-id':requestId}});
  const host=createRuntimeOperationHost({catalog:dataCatalog,registry,permissions,runtimeInventory,httpBindings,
    workspaceCatalog,workspaceNavigationCatalog,
    connectors,search:searchProjections,deliveries:deliveryMappings,fileCatalog,
    widgets:{catalog:widgetCatalog,validators:widgetValidators},...(openAiProvider?{openAiProvider}:{})},
  resolved,rawEnvironment);
  const authentication = createMcpAuthentication(resolved.bindings.DB, permissions);
  return mcpTransportFactory(host.engine, {
    origin: configuration.origin,
    resourceMetadataUrl: selected => oauthResourceMetadataUrl(configuration.origin, selected),
    authenticate: authentication.authenticate,
    canDiscover: authentication.canDiscover,
    readLinkedImage:(binding,identity,recordId,reference)=>readMcpLinkedImage({...host.forContext(identity.contextId),files:fileCatalog},
    binding,identity,recordId,reference),
    approvals:host.approvals,
    ...(analyticsCompiled?{diagnosticsDb:resolved.bindings.DB}:{}),
  }).dispatch(request, audience, requestId);
}};
const runtime = createRuntime({ modules, compositionDigest, nativeAccess, declaredHttp, oauthHttp, mcpHttp,
  ...(publicPageProjection ? {publicPages:createPublicPages({catalog:dataCatalog,contextId:frontContextId,
    projection:publicPageProjection})} : {}) });

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await runtime.fetch(request, env, ctx);
    if (response) return response;
    return renderer.fetch(request, env, ctx);
  },
};
