import { ACCESS_TABLES } from '../identity/d1-store.ts';
import type { AuthorizationAudience } from './types.ts';
import type { SqlStatement } from '../data/authorization.ts';

const t = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([id, name]) => [id, `"${name}"`])) as Record<keyof typeof ACCESS_TABLES, string>;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
/** Shared by coherent reads and final guarded batches. No session is manufactured for a grant. */
export const OAUTH_AUTHORIZATION_FROM = `FROM ${t.oauth_access_tokens} ot
  JOIN ${t.oauth_grants} og ON og.id=ot.grant_id JOIN ${t.oauth_clients} oc ON oc.id=og.client_id
  JOIN ${t.principals} p ON p.id=og.principal_id JOIN ${t.human_accounts} h ON h.principal_id=p.id
  JOIN ${t.password_credentials} pc ON pc.principal_id=p.id
  JOIN ${t.authorization_state} a ON a.id='application'`;
export const OAUTH_AUTHORIZATION_LIVE = `ot.revoked_at_ms IS NULL AND ot.expires_at_ms > ${NOW}
  AND og.revoked_at_ms IS NULL AND oc.revoked_at_ms IS NULL
  AND p.kind='human' AND p.status='active' AND h.status='active'
  AND og.auth_version=p.auth_version AND og.account_version=h.version AND og.credential_version=pc.version
  AND (pc.expires_at_ms IS NULL OR pc.expires_at_ms > ${NOW})
  AND EXISTS(SELECT 1 FROM ${t.contexts} ctx JOIN ${t.memberships} m ON m.context_id=ctx.id
    WHERE ctx.id=og.context_id AND ctx.status='active' AND m.principal_id=p.id
      AND m.audience=og.audience AND m.status='active')`;

export interface OAuthAccessGuard {
  readonly digest: string; readonly credentialId: string; readonly grantId: string; readonly clientId: string;
  readonly principalId: string; readonly epoch: number; readonly contextId: string;
  readonly audience: AuthorizationAudience; readonly resource: string; readonly permissionIds: readonly string[];
}
/** An EXISTS expression for server-owned resolved state, not a public SQL capability. */
export function oauthAccessCondition(state: OAuthAccessGuard): SqlStatement {
  return Object.freeze({sql: `EXISTS(SELECT 1 ${OAUTH_AUTHORIZATION_FROM}
    WHERE ot.secret_hash=? AND ot.id=? AND og.id=? AND oc.id=? AND p.id=? AND a.epoch=?
      AND og.context_id=? AND og.audience=? AND og.resource=? AND ${OAUTH_AUTHORIZATION_LIVE}
      AND og.permission_ids_json=?)`,
    bindings: Object.freeze([state.digest, state.credentialId, state.grantId, state.clientId,
      state.principalId, state.epoch, state.contextId, state.audience, state.resource, JSON.stringify(state.permissionIds)])});
}
