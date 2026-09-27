// Synthetic D1 qualification only. No application route or product state is used.
import { createAccountService, provisionBootstrapCapability } from '../../core/identity/accounts.ts';
import { ACCESS_TABLES } from '../../core/identity/d1-store.ts';
import { createAuthorizationService } from '../../core/authorization/service.ts';
import { createWorkspaceAuthorizationService } from '../../core/workspace/authorization.ts';

const permissions = [
  {id: 'example.notes:read', actors: ['user'], audiences: ['app']},
  {id: 'example.notes:write', actors: ['user'], audiences: ['app']},
];
const ref = id => ({moduleId: 'example.notes', kind: 'permission', id});
const catalog = {compositionDigest: `sha256-${'a'.repeat(64)}`, views: [
  {id: 'example.notes:list', surfaces: ['workspace'], audiences: ['app'], permissions: [ref('read')]},
  {id: 'example.notes:edit', surfaces: ['workspace'], audiences: ['app'], permissions: [ref('write')]},
  {id: 'example.notes:admin', surfaces: ['workspace'], audiences: ['admin'], permissions: []},
], navigation: [
  {id: 'example.notes:list-nav', viewId: 'example.notes:list', surfaces: ['workspace'], audiences: ['app'], permissions: []},
  {id: 'example.notes:edit-nav', viewId: 'example.notes:edit', surfaces: ['workspace'], audiences: ['app'], permissions: [ref('write')]},
]};
const table = id => `"${ACCESS_TABLES[id]}"`;

export default {async fetch(request, env) {
  try {
    const {method, args = []} = await request.json(); let value;
    switch (method) {
      case 'bootstrap': {
        const capability = await provisionBootstrapCapability(env.DB);
        value = await createAccountService(env.DB).bootstrap({...args[0], token: capability.token});
        break;
      }
      case 'login': value = await createAccountService(env.DB).login(...args); break;
      case 'grant': {
        const service = createAuthorizationService(env.DB, {permissions});
        const current = await service.readPolicy(args[0]);
        if (!current.ok) throw new Error('No admin policy.');
        const policy = structuredClone(current.policy), principalId = args[1];
        policy.contexts.push({id: 'workspace-a', status: 'active'});
        policy.memberships.push({principalId, contextId: 'workspace-a', audience: 'app', status: 'active'});
        policy.roles.push({id: 'reader', inherits: [], permissionIds: ['example.notes:read'], permissionOverrides: []});
        policy.assignments.push({principalId, contextId: 'workspace-a', audience: 'app', roleId: 'reader'});
        value = await service.replacePolicy(args[0], {expectedEpoch: current.epoch, policy});
        break;
      }
      case 'deny': {
        const service = createAuthorizationService(env.DB, {permissions});
        const current = await service.readPolicy(args[0]);
        if (!current.ok) throw new Error('No admin policy.');
        const policy = structuredClone(current.policy);
        policy.overrides.push({principalId: args[1], contextId: 'workspace-a', audience: 'app', permissionId: 'example.notes:read', effect: 'deny'});
        value = await service.replacePolicy(args[0], {expectedEpoch: current.epoch, policy});
        break;
      }
      case 'read': value = await createWorkspaceAuthorizationService(env.DB, {permissions, catalog}).read(...args); break;
      case 'revoke': {
        await env.DB.prepare(`UPDATE ${table('sessions')} SET revoked_at_ms=(CAST(unixepoch('now') AS INTEGER)*1000) WHERE id=?`).bind(args[0]).run();
        value = true; break;
      }
      default: throw new Error('Unknown fixture operation.');
    }
    return Response.json({value});
  } catch (error) { return Response.json({error: error.message}, {status: 500}); }
}};
