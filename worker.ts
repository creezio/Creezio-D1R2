import renderer from 'vinext/server/fetch-handler';
import { createRuntime } from './core/runtime/dispatch';
import { modules, compositionDigest, nativeAccess, httpBindings, permissions, workspaceCatalog } from './.creezio/generated/server';
import { operationCatalog, operationValidators, operationHandlers } from './.creezio/generated/operations';
import { dataCatalog } from './.creezio/generated/data-catalog';
import { createOperationRegistry } from './core/operations/registry';
import { createDeclaredHttpDispatcher } from './core/operations/http';

const registry = createOperationRegistry({catalog: operationCatalog, validators: operationValidators, handlers: operationHandlers});
const declaredHttp = createDeclaredHttpDispatcher({registry, dataCatalog, permissions, bindings: httpBindings, workspaceCatalog});
const runtime = createRuntime({ modules, compositionDigest, nativeAccess, declaredHttp });

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await runtime.fetch(request, env, ctx);
    if (response) return response;
    return renderer.fetch(request, env, ctx);
  },
};
