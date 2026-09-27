import type { AuthorizationAudience } from '../authorization/types.ts';
import {copyJson} from '../data/input.ts';
import type { OperationRegistry } from '../operations/registry.ts';
import type { McpCatalog, McpResourceBinding, McpToolBinding } from './types.ts';

const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
const schema = (value: unknown): value is Readonly<Record<string, unknown>> => !!value && typeof value === 'object'
  && !Array.isArray(value) && (value as Record<string, unknown>).type === 'object';
const fail = (): never => { throw new TypeError('Invalid MCP catalog.'); };

/** Runtime check against the compiled operation registry; a catalog never grants authority. */
export function createMcpCatalog(catalog: McpCatalog, registry: OperationRegistry) {
  try { catalog = copyJson(catalog, 4 * 1024 * 1024) as unknown as McpCatalog; }
  catch { fail(); }
  if (!catalog || !Array.isArray(catalog.tools) || !Array.isArray(catalog.resources)
    || catalog.tools.length > 1000 || catalog.resources.length > 1000) fail();
  const tools = {admin: new Map<string, McpToolBinding>(), app: new Map<string, McpToolBinding>()};
  const resources = {admin: new Map<string, McpResourceBinding>(), app: new Map<string, McpResourceBinding>()};
  for (const item of catalog.tools) {
    if (!item || !['admin', 'app'].includes(item.audience) || !id(item.moduleId) || !id(item.operationId)
      || !id(item.contributorModuleId) || typeof item.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(item.name)
      || !Array.isArray(item.auth) || !item.auth.length || item.auth.some(auth => !['oauth', 'api-token'].includes(auth))
      || !Array.isArray(item.actors) || item.actors.length !== item.auth.length
      || item.auth.some((auth, index) => item.actors[index] !== ({oauth: 'delegated-user', 'api-token': 'machine'} as Record<string, string>)[auth])
      || !schema(item.inputSchema) || !schema(item.outputSchema) || !Array.isArray(item.permissions)
      || item.permissions.some(permission => typeof permission !== 'string')) fail();
    const operation = registry.resolve(item.moduleId, item.operationId);
    if (!operation.declaration.audiences.includes(item.audience)
      || item.actors.some(actor => !operation.declaration.actors.includes(actor))
      || operation.declaration.context !== item.context || operation.contractDigest !== item.contractDigest
      || item.permissions.length !== operation.declaration.permissions.length
      || item.permissions.some((permission, index) => permission !== `${operation.declaration.permissions[index].moduleId}:${operation.declaration.permissions[index].id}`)
      || item.annotations?.readOnly !== (operation.declaration.kind === 'query')) fail();
    const audience = item.audience as AuthorizationAudience;
    if (tools[audience].has(item.name)) fail();
    tools[audience].set(item.name, item);
  }
  for (const item of catalog.resources) {
    if (!item || !['admin', 'app'].includes(item.audience) || !id(item.id) || !id(item.contributorModuleId)
      || typeof item.uri !== 'string' || !item.uri || typeof item.mimeType !== 'string'
      || !Array.isArray(item.permissions) || item.permissions.some(permission => typeof permission !== 'string')
      || !Array.isArray(item.actors) || item.actors.some(actor => !['delegated-user', 'machine'].includes(actor))
      || !['application', 'required'].includes(item.context)
      || !['asset', 'operation'].includes(item.source?.kind)) fail();
    if (item.source.kind === 'operation') {
      const operation = registry.resolve(item.source.moduleId, item.source.operationId);
      if (operation.declaration.kind !== 'query' || !operation.declaration.audiences.includes(item.audience)
        || operation.declaration.context !== item.context) fail();
    } else if (typeof item.source.path !== 'string' || !item.source.path) fail();
    const audience = item.audience as AuthorizationAudience;
    if (resources[audience].has(item.uri)) fail();
    resources[audience].set(item.uri, item);
  }
  return Object.freeze({
    tool(audience: AuthorizationAudience, name: string): McpToolBinding | undefined { return tools[audience].get(name); },
    resource(audience: AuthorizationAudience, uri: string): McpResourceBinding | undefined { return resources[audience].get(uri); },
    tools(audience: AuthorizationAudience): readonly McpToolBinding[] { return Object.freeze([...tools[audience].values()]); },
    resources(audience: AuthorizationAudience): readonly McpResourceBinding[] { return Object.freeze([...resources[audience].values()]); },
  });
}
