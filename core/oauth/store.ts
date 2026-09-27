import { ACCESS_TABLES, type IdentityDatabase } from '../identity/d1-store.ts';
import { OAUTH_AUTHORIZATION_FROM, OAUTH_AUTHORIZATION_LIVE } from '../authorization/oauth-guard.ts';
import type { OAuthAudience } from './protocol.ts';

type Bind = string | number | null;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const t = Object.fromEntries(Object.entries(ACCESS_TABLES).map(([key, value]) => [key, `"${value}"`])) as Record<keyof typeof ACCESS_TABLES, string>;

export class OAuthStoreError extends Error {
  constructor() { super('OAuth storage operation failed.'); this.name = 'OAuthStoreError'; }
}
export interface OAuthClientRow {
  readonly id: string; readonly displayName: string; readonly redirectUris: readonly string[];
  readonly scopeAllowlist: readonly string[]; readonly registrationKind: 'predefined' | 'dcr';
  readonly tokenEndpointAuthMethod: 'none'; readonly createdAtMs: number;
}
export interface OAuthRequestRow {
  readonly id: string; readonly clientId: string; readonly redirectUri: string;
  readonly resource: string; readonly audience: OAuthAudience; readonly contextId: string;
  readonly scopes: readonly string[]; readonly state: string; readonly codeChallenge: string;
  readonly principalId: string | null; readonly sessionId: string | null;
  readonly csrfDigest: string | null; readonly expiresAtMs: number;
}
export interface OAuthGrantRow {
  readonly id: string; readonly principalId: string; readonly clientId: string;
  readonly resource: string; readonly audience: OAuthAudience; readonly contextId: string;
  readonly scopes: readonly string[]; readonly permissionIds: readonly string[];
  readonly authVersion: number; readonly accountVersion: number; readonly credentialVersion: number;
}
export interface OAuthCodeRow {
  readonly id: string; readonly grantId: string; readonly clientId: string;
  readonly redirectUri: string; readonly resource: string; readonly codeChallenge: string;
  readonly expiresAtMs: number;
}
export interface OAuthRefreshRow {
  readonly id: string; readonly grantId: string; readonly familyId: string;
  readonly clientId: string; readonly resource: string; readonly expiresAtMs: number;
  readonly consumedAtMs: number | null;
}
export interface OAuthAccessRow {
  readonly id: string; readonly grantId: string; readonly clientId: string;
  readonly principalId: string; readonly resource: string; readonly audience: OAuthAudience;
  readonly contextId: string; readonly scopes: readonly string[]; readonly permissionIds: readonly string[];
  readonly expiresAtMs: number;
}

function stringArray(value: unknown, max = 128): readonly string[] {
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed) && parsed.length <= max && parsed.every(item => typeof item === 'string'
      && item.length > 0 && item.length <= 2048) && new Set(parsed).size === parsed.length) return Object.freeze(parsed);
  } catch { /* storage error below */ }
  throw new OAuthStoreError();
}
function one(rows: readonly Record<string, unknown>[]): Record<string, unknown> | null {
  if (rows.length > 1) throw new OAuthStoreError();
  return rows[0] ?? null;
}
function requireClaim(value: boolean): void { if (!value) throw new OAuthStoreError(); }

/** D1-backed OAuth state. Mutations whose result issues a credential are one D1 transaction. */
export function createD1OAuthStore(db: IdentityDatabase) {
  function statement(sql: string, values: readonly Bind[] = []): D1PreparedStatement {
    try { return db.prepare(sql).bind(...values); } catch { throw new OAuthStoreError(); }
  }
  async function batch(statements: readonly D1PreparedStatement[]): Promise<D1Result<Record<string, unknown>>[]> {
    try {
      const result = await db.batch([...statements]);
      if (result.length !== statements.length || result.some(item => item.success !== true)) throw new OAuthStoreError();
      return result as D1Result<Record<string, unknown>>[];
    } catch { throw new OAuthStoreError(); }
  }
  async function query(sql: string, values: readonly Bind[] = []) {
    return one((await batch([statement(sql, values)]))[0].results);
  }
  const liveClient = `revoked_at_ms IS NULL`;
  const liveGrant = `g.revoked_at_ms IS NULL AND c.revoked_at_ms IS NULL
    AND p.kind='human' AND p.status='active' AND h.status='active'
    AND g.auth_version=p.auth_version AND g.account_version=h.version AND g.credential_version=pc.version
    AND (pc.expires_at_ms IS NULL OR pc.expires_at_ms>${NOW})`;
  const identity = (id: keyof typeof ACCESS_TABLES) => t[id];
  return Object.freeze({
    async pruneEphemeral(): Promise<void> {
      await batch([
        statement(`DELETE FROM ${t.oauth_requests} WHERE id IN
          (SELECT id FROM ${t.oauth_requests} WHERE expires_at_ms<=${NOW}
            ORDER BY expires_at_ms,id LIMIT 50)`),
        statement(`DELETE FROM ${t.oauth_codes} WHERE id IN
          (SELECT id FROM ${t.oauth_codes} WHERE expires_at_ms<=${NOW}
            ORDER BY expires_at_ms,id LIMIT 50)`),
      ]);
    },
    async client(clientId: string): Promise<OAuthClientRow | null> {
      const row = await query(`SELECT id, display_name AS displayName, redirect_uris_json AS redirectUris,
        scope_allowlist_json AS scopeAllowlist, registration_kind AS registrationKind,
        token_endpoint_auth_method AS tokenEndpointAuthMethod, created_at_ms AS createdAtMs
        FROM ${t.oauth_clients} WHERE id=? AND ${liveClient} LIMIT 2`, [clientId]);
      if (!row) return null;
      if (row.registrationKind !== 'predefined' && row.registrationKind !== 'dcr'
        || row.tokenEndpointAuthMethod !== 'none') throw new OAuthStoreError();
      return Object.freeze({ id: String(row.id), displayName: String(row.displayName),
        redirectUris: stringArray(row.redirectUris, 8), scopeAllowlist: stringArray(row.scopeAllowlist),
        registrationKind: row.registrationKind, tokenEndpointAuthMethod: 'none',
        createdAtMs: Number(row.createdAtMs) });
    },
    async registerClient(input: OAuthClientRow): Promise<boolean> {
      const result = await batch([statement(`INSERT INTO ${t.oauth_clients}
        (id,display_name,redirect_uris_json,scope_allowlist_json,registration_kind,token_endpoint_auth_method,created_at_ms,revoked_at_ms)
        VALUES (?,?,?,?,?,'none',${NOW},NULL)`, [input.id, input.displayName,
        JSON.stringify(input.redirectUris), JSON.stringify(input.scopeAllowlist), input.registrationKind])]);
      return result[0].meta.changes === 1;
    },
    async createRequest(input: OAuthRequestRow): Promise<boolean> {
      const result = await batch([statement(`INSERT INTO ${t.oauth_requests}
        (id,client_id,redirect_uri,resource,audience,context_id,scopes_json,state,code_challenge,
         principal_id,session_id,csrf_digest,created_at_ms,expires_at_ms,consumed_at_ms)
        SELECT ?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,${NOW},?,NULL
        WHERE EXISTS(SELECT 1 FROM ${t.oauth_clients} c WHERE c.id=? AND c.revoked_at_ms IS NULL)
          AND (SELECT COUNT(*) FROM ${t.oauth_requests}
            WHERE consumed_at_ms IS NULL AND expires_at_ms>${NOW}) < 500
          AND (SELECT COUNT(*) FROM ${t.oauth_requests}
            WHERE client_id=? AND consumed_at_ms IS NULL AND expires_at_ms>${NOW}) < 100`,
      [input.id, input.clientId, input.redirectUri, input.resource, input.audience, input.contextId,
        JSON.stringify(input.scopes), input.state, input.codeChallenge, input.expiresAtMs,
        input.clientId, input.clientId])]);
      return result[0].meta.changes === 1;
    },
    async request(id: string): Promise<OAuthRequestRow | null> {
      const row = await query(`SELECT r.id, r.client_id AS clientId, r.redirect_uri AS redirectUri,
        r.resource, r.audience, r.context_id AS contextId, r.scopes_json AS scopes, r.state,
        r.code_challenge AS codeChallenge, r.principal_id AS principalId, r.session_id AS sessionId,
        r.csrf_digest AS csrfDigest, r.expires_at_ms AS expiresAtMs
        FROM ${t.oauth_requests} r JOIN ${t.oauth_clients} c ON c.id=r.client_id
        WHERE r.id=? AND r.consumed_at_ms IS NULL AND r.expires_at_ms>${NOW}
          AND c.revoked_at_ms IS NULL LIMIT 2`, [id]);
      return row ? Object.freeze({ id: String(row.id), clientId: String(row.clientId),
        redirectUri: String(row.redirectUri), resource: String(row.resource), audience: row.audience as OAuthAudience,
        contextId: String(row.contextId), scopes: stringArray(row.scopes), state: String(row.state),
        codeChallenge: String(row.codeChallenge), principalId: row.principalId as string | null,
        sessionId: row.sessionId as string | null, csrfDigest: row.csrfDigest as string | null,
        expiresAtMs: Number(row.expiresAtMs) }) : null;
    },
    async bindRequest(id: string, principalId: string, sessionId: string, csrfDigest: string): Promise<boolean> {
      const result = await batch([statement(`UPDATE ${t.oauth_requests}
        SET principal_id=?,session_id=?,csrf_digest=? WHERE id=? AND consumed_at_ms IS NULL
        AND expires_at_ms>${NOW} AND (principal_id IS NULL OR principal_id=?)
        AND (session_id IS NULL OR session_id=?)`,
      [principalId, sessionId, csrfDigest, id, principalId, sessionId])]);
      return result[0].meta.changes === 1;
    },
    async sessionVersions(sessionDigest: string, sessionId: string, principalId: string,
      audience: OAuthAudience): Promise<{authVersion:number;accountVersion:number;credentialVersion:number} | null> {
      const row = await query(`SELECT p.auth_version AS authVersion,h.version AS accountVersion,
        pc.version AS credentialVersion FROM ${identity('sessions')} s
        JOIN ${identity('principals')} p ON p.id=s.principal_id
        JOIN ${identity('human_accounts')} h ON h.principal_id=p.id
        JOIN ${identity('password_credentials')} pc ON pc.principal_id=p.id
        WHERE s.secret_hash=? AND s.id=? AND p.id=? AND s.audience=?
          AND s.revoked_at_ms IS NULL AND s.expires_at_ms>${NOW}
          AND p.kind='human' AND p.status='active' AND h.status='active'
          AND s.auth_version=p.auth_version AND s.account_version=h.version AND s.credential_version=pc.version
          AND (pc.expires_at_ms IS NULL OR pc.expires_at_ms>${NOW}) LIMIT 2`,
      [sessionDigest,sessionId,principalId,audience]);
      return row ? Object.freeze({authVersion:Number(row.authVersion),accountVersion:Number(row.accountVersion),
        credentialVersion:Number(row.credentialVersion)}) : null;
    },
    async finishRequest(input: { id: string; principalId: string; sessionId: string; sessionDigest: string;
      csrfDigest: string; epoch: number; grant?: OAuthGrantRow; codeId?: string; codeDigest?: string;
      redirectUri?: string; codeChallenge?: string;
      codeExpiresAtMs?: number }): Promise<boolean> {
      const session = identity('sessions'), principal = identity('principals'), human = identity('human_accounts');
      const password = identity('password_credentials'), state = identity('authorization_state');
      const valid = `SELECT 1 FROM ${t.oauth_requests} r
        JOIN ${t.oauth_clients} c ON c.id=r.client_id AND c.revoked_at_ms IS NULL
        JOIN ${session} s ON s.id=?
        JOIN ${principal} p ON p.id=s.principal_id JOIN ${human} h ON h.principal_id=p.id
        JOIN ${password} pc ON pc.principal_id=p.id JOIN ${state} a ON a.id='application'
        JOIN ${identity('contexts')} ctx ON ctx.id=r.context_id
        JOIN ${identity('memberships')} m ON m.principal_id=p.id AND m.context_id=r.context_id AND m.audience=r.audience
        WHERE r.id=? AND r.principal_id=? AND r.session_id=? AND r.csrf_digest=?
        AND r.consumed_at_ms IS NULL AND r.expires_at_ms>${NOW} AND s.secret_hash=?
        AND s.audience=r.audience AND s.revoked_at_ms IS NULL AND s.expires_at_ms>${NOW}
        AND s.auth_version=p.auth_version AND s.account_version=h.version AND s.credential_version=pc.version
        AND p.kind='human' AND p.status='active' AND h.status='active'
        AND (pc.expires_at_ms IS NULL OR pc.expires_at_ms>${NOW})
        AND ctx.status='active' AND m.status='active' AND a.epoch=?`;
      const checks = [input.sessionId, input.id, input.principalId, input.sessionId,
        input.csrfDigest, input.sessionDigest, input.epoch];
      const writes = [statement(`SELECT CASE WHEN EXISTS(${valid}) THEN 1 ELSE json('oauth_guard_failed') END AS allowed`, checks),
        statement(`UPDATE ${t.oauth_requests} SET consumed_at_ms=${NOW} WHERE id=? AND consumed_at_ms IS NULL`, [input.id])];
      if (input.grant) {
        const g = input.grant;
        requireClaim(!!input.codeId && !!input.codeDigest && !!input.codeExpiresAtMs
          && !!input.redirectUri && !!input.codeChallenge);
        writes.push(statement(`INSERT INTO ${t.oauth_grants}
          (id,principal_id,client_id,resource,audience,context_id,scopes_json,permission_ids_json,
           auth_version,account_version,credential_version,created_at_ms,revoked_at_ms)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,${NOW},NULL)`,
        [g.id, g.principalId, g.clientId, g.resource, g.audience, g.contextId,
          JSON.stringify(g.scopes), JSON.stringify(g.permissionIds), g.authVersion, g.accountVersion, g.credentialVersion]));
        writes.push(statement(`INSERT INTO ${t.oauth_codes}
          (id,secret_hash,grant_id,redirect_uri,resource,code_challenge,created_at_ms,expires_at_ms,consumed_at_ms)
          VALUES (?,?,?,?,?,?,${NOW},?,NULL)`,
        [input.codeId!, input.codeDigest!, g.id, input.redirectUri!,
          g.resource, input.codeChallenge!, input.codeExpiresAtMs!]));
      }
      const result = await batch(writes);
      return result[1].meta.changes === 1;
    },
    async code(digest: string): Promise<OAuthCodeRow | null> {
      const row = await query(`SELECT k.id,k.grant_id AS grantId,g.client_id AS clientId,
        k.redirect_uri AS redirectUri,k.resource,k.code_challenge AS codeChallenge,
        k.expires_at_ms AS expiresAtMs FROM ${t.oauth_codes} k JOIN ${t.oauth_grants} g ON g.id=k.grant_id
        WHERE k.secret_hash=? AND k.consumed_at_ms IS NULL AND k.expires_at_ms>${NOW}
          AND g.revoked_at_ms IS NULL LIMIT 2`, [digest]);
      return row ? Object.freeze({id:String(row.id),grantId:String(row.grantId),clientId:String(row.clientId),
        redirectUri:String(row.redirectUri),resource:String(row.resource),
        codeChallenge:String(row.codeChallenge),expiresAtMs:Number(row.expiresAtMs)}) : null;
    },
    async grant(id: string): Promise<OAuthGrantRow | null> {
      const row = await query(`SELECT g.id,g.principal_id AS principalId,g.client_id AS clientId,
        g.resource,g.audience,g.context_id AS contextId,g.scopes_json AS scopes,
        g.permission_ids_json AS permissionIds,g.auth_version AS authVersion,
        g.account_version AS accountVersion,g.credential_version AS credentialVersion
        FROM ${t.oauth_grants} g JOIN ${t.oauth_clients} c ON c.id=g.client_id
        WHERE g.id=? AND g.revoked_at_ms IS NULL AND c.revoked_at_ms IS NULL LIMIT 2`, [id]);
      return row ? Object.freeze({id:String(row.id),principalId:String(row.principalId),
        clientId:String(row.clientId),resource:String(row.resource),audience:row.audience as OAuthAudience,
        contextId:String(row.contextId),scopes:stringArray(row.scopes),permissionIds:stringArray(row.permissionIds),
        authVersion:Number(row.authVersion),accountVersion:Number(row.accountVersion),
        credentialVersion:Number(row.credentialVersion)}) : null;
    },
    async consumeCode(input: { digest: string; codeId: string; grantId: string; clientId: string;
      accessId: string; accessDigest: string; accessExpiresAtMs: number;
      refreshId: string; refreshDigest: string; refreshExpiresAtMs: number }): Promise<boolean> {
      const result = await batch([
        statement(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${t.oauth_codes} k
          JOIN ${t.oauth_grants} g ON g.id=k.grant_id
          JOIN ${t.oauth_clients} c ON c.id=g.client_id
          JOIN ${identity('principals')} p ON p.id=g.principal_id
          JOIN ${identity('human_accounts')} h ON h.principal_id=p.id
          JOIN ${identity('password_credentials')} pc ON pc.principal_id=p.id
          WHERE k.id=? AND k.secret_hash=? AND k.grant_id=? AND g.client_id=?
          AND k.consumed_at_ms IS NULL AND k.expires_at_ms>${NOW} AND ${liveGrant}
          AND EXISTS(SELECT 1 FROM ${identity('contexts')} ctx
            JOIN ${identity('memberships')} m ON m.context_id=ctx.id
            WHERE ctx.id=g.context_id AND ctx.status='active' AND m.principal_id=p.id
              AND m.audience=g.audience AND m.status='active'))
          THEN 1 ELSE json('oauth_code_invalid') END AS allowed`,
        [input.codeId, input.digest, input.grantId, input.clientId]),
        statement(`UPDATE ${t.oauth_codes} SET consumed_at_ms=${NOW} WHERE id=? AND secret_hash=?
          AND consumed_at_ms IS NULL AND expires_at_ms>${NOW}`, [input.codeId, input.digest]),
        statement(`INSERT INTO ${t.oauth_access_tokens}
          (id,secret_hash,grant_id,created_at_ms,expires_at_ms,revoked_at_ms)
          VALUES (?,?,?,${NOW},?,NULL)`,
        [input.accessId,input.accessDigest,input.grantId,input.accessExpiresAtMs]),
        statement(`INSERT INTO ${t.oauth_refresh_tokens}
          (id,secret_hash,grant_id,family_id,parent_id,created_at_ms,expires_at_ms,consumed_at_ms,revoked_at_ms)
          VALUES (?,?,?,?,NULL,${NOW},?,NULL,NULL)`,
        [input.refreshId,input.refreshDigest,input.grantId,input.refreshId,input.refreshExpiresAtMs]),
      ]);
      return result[1].meta.changes === 1;
    },
    async refresh(digest: string): Promise<OAuthRefreshRow | null> {
      const row = await query(`SELECT r.id,r.grant_id AS grantId,r.family_id AS familyId,
        g.client_id AS clientId,g.resource,r.expires_at_ms AS expiresAtMs,
        r.consumed_at_ms AS consumedAtMs FROM ${t.oauth_refresh_tokens} r
        JOIN ${t.oauth_grants} g ON g.id=r.grant_id JOIN ${t.oauth_clients} c ON c.id=g.client_id
        JOIN ${identity('principals')} p ON p.id=g.principal_id
        JOIN ${identity('human_accounts')} h ON h.principal_id=p.id
        JOIN ${identity('password_credentials')} pc ON pc.principal_id=p.id
        WHERE r.secret_hash=? AND r.revoked_at_ms IS NULL AND r.expires_at_ms>${NOW}
          AND ${liveGrant}
          AND EXISTS(SELECT 1 FROM ${identity('contexts')} ctx
            JOIN ${identity('memberships')} m ON m.context_id=ctx.id
            WHERE ctx.id=g.context_id AND ctx.status='active' AND m.principal_id=p.id
              AND m.audience=g.audience AND m.status='active') LIMIT 2`, [digest]);
      return row ? Object.freeze({id:String(row.id),grantId:String(row.grantId),familyId:String(row.familyId),
        clientId:String(row.clientId),resource:String(row.resource),expiresAtMs:Number(row.expiresAtMs),
        consumedAtMs:row.consumedAtMs as number | null}) : null;
    },
    async rotateRefresh(input: {digest:string;id:string;grantId:string;familyId:string;clientId:string;
      accessId:string;accessDigest:string;accessExpiresAtMs:number;
      refreshId:string;refreshDigest:string;refreshExpiresAtMs:number}): Promise<boolean> {
      const result = await batch([
        statement(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ${t.oauth_refresh_tokens} r
          JOIN ${t.oauth_grants} g ON g.id=r.grant_id JOIN ${t.oauth_clients} c ON c.id=g.client_id
          JOIN ${identity('principals')} p ON p.id=g.principal_id
          JOIN ${identity('human_accounts')} h ON h.principal_id=p.id
          JOIN ${identity('password_credentials')} pc ON pc.principal_id=p.id
          WHERE r.id=? AND r.secret_hash=? AND r.grant_id=? AND r.family_id=? AND g.client_id=?
          AND r.consumed_at_ms IS NULL AND r.revoked_at_ms IS NULL AND r.expires_at_ms>${NOW}
          AND ${liveGrant}
          AND EXISTS(SELECT 1 FROM ${identity('contexts')} ctx
            JOIN ${identity('memberships')} m ON m.context_id=ctx.id
            WHERE ctx.id=g.context_id AND ctx.status='active' AND m.principal_id=p.id
              AND m.audience=g.audience AND m.status='active'))
          THEN 1 ELSE json('oauth_refresh_invalid') END AS allowed`,
        [input.id,input.digest,input.grantId,input.familyId,input.clientId]),
        statement(`UPDATE ${t.oauth_refresh_tokens} SET consumed_at_ms=${NOW}
          WHERE id=? AND secret_hash=? AND consumed_at_ms IS NULL`, [input.id,input.digest]),
        statement(`INSERT INTO ${t.oauth_access_tokens}
          (id,secret_hash,grant_id,created_at_ms,expires_at_ms,revoked_at_ms)
          VALUES (?,?,?,${NOW},?,NULL)`,
        [input.accessId,input.accessDigest,input.grantId,input.accessExpiresAtMs]),
        statement(`INSERT INTO ${t.oauth_refresh_tokens}
          (id,secret_hash,grant_id,family_id,parent_id,created_at_ms,expires_at_ms,consumed_at_ms,revoked_at_ms)
          VALUES (?,?,?,?,?,${NOW},?,NULL,NULL)`,
        [input.refreshId,input.refreshDigest,input.grantId,input.familyId,input.id,input.refreshExpiresAtMs]),
      ]);
      return result[1].meta.changes === 1;
    },
    async revokeFamily(familyId: string): Promise<void> {
      await batch([statement(`UPDATE ${t.oauth_refresh_tokens} SET revoked_at_ms=${NOW}
        WHERE family_id=? AND revoked_at_ms IS NULL`, [familyId])]);
    },
    async revokeGrant(grantId: string, principalId: string): Promise<boolean> {
      const result = await batch([statement(`UPDATE ${t.oauth_grants} SET revoked_at_ms=${NOW}
        WHERE id=? AND principal_id=? AND revoked_at_ms IS NULL`, [grantId,principalId])]);
      return result[0].meta.changes === 1;
    },
    async revokeByToken(accessDigest: string | null, refreshDigest: string | null,
      clientId: string): Promise<void> {
      const grantByAccess = accessDigest ? await query(`SELECT g.id FROM ${t.oauth_access_tokens} a
        JOIN ${t.oauth_grants} g ON g.id=a.grant_id WHERE a.secret_hash=? AND g.client_id=? LIMIT 2`,
      [accessDigest,clientId]) : null;
      const grantByRefresh = !grantByAccess && refreshDigest ? await query(`SELECT g.id FROM ${t.oauth_refresh_tokens} r
        JOIN ${t.oauth_grants} g ON g.id=r.grant_id WHERE r.secret_hash=? AND g.client_id=? LIMIT 2`,
      [refreshDigest,clientId]) : null;
      const grantId = grantByAccess?.id ?? grantByRefresh?.id;
      if (typeof grantId === 'string') await batch([statement(`UPDATE ${t.oauth_grants}
        SET revoked_at_ms=${NOW} WHERE id=? AND client_id=? AND revoked_at_ms IS NULL`, [grantId,clientId])]);
    },
    async access(digest: string): Promise<OAuthAccessRow | null> {
      const row = await query(`SELECT ot.id,ot.grant_id AS grantId,og.client_id AS clientId,
        og.principal_id AS principalId,og.resource,og.audience,og.context_id AS contextId,
        og.scopes_json AS scopes,og.permission_ids_json AS permissionIds,ot.expires_at_ms AS expiresAtMs
        ${OAUTH_AUTHORIZATION_FROM}
        WHERE ot.secret_hash=? AND ${OAUTH_AUTHORIZATION_LIVE} LIMIT 2`, [digest]);
      return row ? Object.freeze({id:String(row.id),grantId:String(row.grantId),clientId:String(row.clientId),
        principalId:String(row.principalId),resource:String(row.resource),audience:row.audience as OAuthAudience,
        contextId:String(row.contextId),scopes:stringArray(row.scopes),permissionIds:stringArray(row.permissionIds),
        expiresAtMs:Number(row.expiresAtMs)}) : null;
    },
  });
}
