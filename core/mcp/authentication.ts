import type { IdentityDatabase } from '../identity/d1-store.ts';
import { digestOpaqueToken } from '../identity/tokens.ts';
import { createD1AuthorizationStore } from '../authorization/d1-store.ts';
import type { AuthorizationActor, AuthorizationAudience, PermissionDefinition } from '../authorization/types.ts';
import { createDataAuthorization } from '../data/authorization.ts';
import { DataAccessError } from '../data/types.ts';
import type { McpAuthenticatedRequest, McpDiscoveryTarget } from './http.ts';

/** Native identities and ACLs for MCP. Cookies and GPT identities are never consulted. */
export function createMcpAuthentication(db: IdentityDatabase, suppliedPermissions: readonly PermissionDefinition[]) {
  const store = createD1AuthorizationStore(db);
  const authorization = createDataAuthorization(db, suppliedPermissions);
  async function authenticate(request: Request, audience: AuthorizationAudience, resource: string): Promise<McpAuthenticatedRequest | null> {
    const value = request.headers.get('authorization');
    if (!value || !/^Bearer [A-Za-z0-9_-]{48}$/.test(value)) return null;
    const token = value.slice(7);
    const oauthDigest = await digestOpaqueToken(token, 'oauth-access');
    if (oauthDigest) {
      const current = await store.readOAuthAccess(oauthDigest, null, audience, resource);
      if (!current) return null;
      const identity = Object.freeze({credential: Object.freeze({kind: 'oauth' as const, token, resource}),
        contextId: current.credential.contextId});
      // Even an empty catalogue has a real authenticated audience and context.
      if (!await canDiscover(identity, {audience, contextId: identity.contextId, actors: ['delegated-user'], permissionIds: []})) return null;
      return identity;
    }
    const machineDigest = await digestOpaqueToken(token, 'api-token');
    if (!machineDigest) return null;
    const contextId = request.headers.get('x-creezio-context') ?? 'application';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(contextId)) return null;
    const current = await store.readMachine(machineDigest, contextId, audience);
    if (!current?.credential.scope) return null;
    const identity = Object.freeze({credential: Object.freeze({kind: 'api-token' as const, token}), contextId});
    if (!await canDiscover(identity, {audience, contextId, actors: ['machine'], permissionIds: []})) return null;
    return identity;
  }
  async function canDiscover(identity: McpAuthenticatedRequest, target: McpDiscoveryTarget): Promise<boolean> {
    // The context comes from the verified grant/scope; a catalog cannot switch it.
    if (target.contextId !== identity.contextId || target.actors.some(actor =>
      !['user', 'machine', 'delegated-user', 'impersonated-user'].includes(actor))) return false;
    try {
      await authorization.resolve(identity.credential, {contextId: target.contextId, audience: target.audience,
        actors: target.actors as readonly AuthorizationActor[], requiredPermissionIds: target.permissionIds, purpose: 'operation'});
      return true;
    } catch (error) {
      if (error instanceof DataAccessError && ['unauthorized', 'forbidden', 'invalid_input'].includes(error.code)) return false;
      throw error;
    }
  }
  return Object.freeze({authenticate, canDiscover});
}
