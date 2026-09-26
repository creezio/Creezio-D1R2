import renderer from 'vinext/server/fetch-handler';
import { createRuntime } from './core/runtime/dispatch';
import { modules, compositionDigest, nativeAccess } from './.creezio/generated/server';

const runtime = createRuntime({ modules, compositionDigest, nativeAccess });

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const response = await runtime.fetch(request, env, ctx);
    if (response) return response;
    return renderer.fetch(request, env, ctx);
  },
};
