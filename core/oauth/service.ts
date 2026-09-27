import { authorize } from '../authorization/authorize.ts';
import { policySnapshot } from '../authorization/policy.ts';
import { createNativeAuthorizationResolver } from '../authorization/resolver.ts';
import type { PermissionDefinition } from '../authorization/types.ts';
import { createD1IdentityStore, type IdentityDatabase } from '../identity/d1-store.ts';
import { identityAdmissionKey } from '../identity/input.ts';
import { digestOpaqueToken, issueOpaqueToken } from '../identity/tokens.ts';
import { createD1OAuthStore, type OAuthClientRow, type OAuthGrantRow } from './store.ts';
import { OAUTH_LIMITS, OAuthProtocolError, oauthIssuer, oauthRedirect, oauthResource,
  parseOAuthAuthorizationRequest, validOAuthRedirectUri, verifyOAuthPkce,
  type OAuthAudience, type OAuthAuthorizationRequest } from './protocol.ts';

const fail = (code: string, status = 400): never => { throw new OAuthProtocolError(code, status); };
const identifier = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const scopeString = (ids: readonly string[]) => [...ids].sort().join(' ');

export interface OAuthServiceOptions {
  /** Public deployment origin. Never inferred from the incoming request. */
  readonly issuer: string;
  /** Dynamic module permissions, excluding the resolver's built-in Access definitions. */
  readonly permissions: readonly PermissionDefinition[];
  readonly enabledAudiences?: Readonly<{admin:boolean;app:boolean}>;
  /** Presentation only; never participates in authorization. */
  readonly permissionTitles?: Readonly<Record<string,string>>;
}
export interface OAuthTokenResponse {
  readonly access_token: string; readonly token_type: 'Bearer'; readonly expires_in: number;
  readonly refresh_token: string; readonly scope: string;
}

/** Native delegated grants over the existing user identity and authorization catalog. */
export function createOAuthService(db: IdentityDatabase, options: OAuthServiceOptions) {
  const issuer = oauthIssuer(options.issuer);
  const enabled = options.enabledAudiences ?? Object.freeze({admin:true,app:true});
  const resolver = createNativeAuthorizationResolver(db, {permissions: options.permissions});
  const store = createD1OAuthStore(db);
  const admission = createD1IdentityStore(db);
  function advertised(audience: OAuthAudience) {
    if (!enabled[audience]) return [];
    return resolver.permissions.filter(permission => permission.audiences.includes(audience)
      && permission.actors.includes('delegated-user')).map(permission => permission.id).sort();
  }
  function checkedClient(request: OAuthAuthorizationRequest, client: OAuthClientRow | null): OAuthClientRow {
    if (!enabled[request.audience]) return fail('invalid_target');
    if (!client || !client.redirectUris.includes(request.redirectUri)) return fail('invalid_client');
    if (request.scopes.some(scope => !client.scopeAllowlist.includes(scope)
      || !advertised(request.audience).includes(scope))) return fail('invalid_scope');
    return client;
  }
  async function activeRequest(requestId: string) {
    if (!identifier(requestId)) return fail('not_found', 404);
    const request = await store.request(requestId);
    if (!request) return fail('not_found', 404);
    const client = checkedClient(request, await store.client(request.clientId));
    if (request.resource !== oauthResource(issuer, request.audience)) return fail('invalid_target');
    return {request, client};
  }
  async function userState(sessionToken: unknown, audience: OAuthAudience, contextId: string) {
    const state = await resolver.resolve(sessionToken, audience);
    if (!state) return fail('authentication_required', 401);
    if (!state.policy.contexts.some(item => item.id === contextId && item.status === 'active')
      || !state.policy.memberships.some(item => item.principalId === state.session.principalId
        && item.contextId === contextId && item.audience === audience && item.status === 'active'))
      return fail('forbidden', 403);
    return state;
  }
  function effectivePermissions(state: Awaited<ReturnType<typeof userState>>,
    request: OAuthAuthorizationRequest | {audience:OAuthAudience;contextId:string;scopes:readonly string[]}) {
    const snapshot = policySnapshot(state.policy, resolver.permissions, state.session);
    return request.scopes.filter(id => {
      const permission = resolver.permissions.find(item => item.id === id);
      return permission?.audiences.includes(request.audience)
        && permission.actors.includes('delegated-user')
        && authorize(snapshot, {contextId:request.contextId,audience:request.audience,
          actors:['user'],requiredPermissionIds:[id],purpose:'operation'}, state.nowMs).allowed;
    });
  }
  async function issuePair(grantId: string) {
    const grant = await store.grant(grantId);
    if (!grant) return fail('invalid_grant');
    const access = await issueOpaqueToken('oauth-access');
    const refresh = await issueOpaqueToken('oauth-refresh');
    return {grant, access, refresh, accessExpiresAtMs:Date.now() + OAUTH_LIMITS.accessTtlMs,
      refreshExpiresAtMs:Date.now() + OAUTH_LIMITS.refreshTtlMs};
  }
  function tokenResponse(pair: Awaited<ReturnType<typeof issuePair>>): OAuthTokenResponse {
    return Object.freeze({access_token:pair.access.token,token_type:'Bearer',
      expires_in:Math.floor(OAUTH_LIMITS.accessTtlMs / 1000),refresh_token:pair.refresh.token,
      scope:scopeString(pair.grant.scopes)});
  }
  return Object.freeze({
    permissions: resolver.permissions,
    advertisedScopes: advertised,
    async registerPredefined(input: {id:string;displayName:string;redirectUris:readonly string[];
      scopeAllowlist:readonly string[]}): Promise<boolean> {
      if (!identifier(input?.id) || !input.displayName || input.displayName.length > OAUTH_LIMITS.clientName
        || !Array.isArray(input.redirectUris) || input.redirectUris.length < 1
        || input.redirectUris.length > OAUTH_LIMITS.redirectCount
        || !input.redirectUris.every(validOAuthRedirectUri)
        || new Set(input.redirectUris).size !== input.redirectUris.length
        || !Array.isArray(input.scopeAllowlist) || input.scopeAllowlist.length > OAUTH_LIMITS.permissionCount
        || input.scopeAllowlist.some(scope => !resolver.permissions.some(p => p.id === scope && p.actors.includes('delegated-user')))
        || new Set(input.scopeAllowlist).size !== input.scopeAllowlist.length) return fail('invalid_client_metadata');
      return store.registerClient({id:input.id,displayName:input.displayName,redirectUris:input.redirectUris,
        scopeAllowlist:input.scopeAllowlist,registrationKind:'predefined',tokenEndpointAuthMethod:'none',
        createdAtMs:Date.now()});
    },
    async registerDcr(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid_client_metadata');
      const body = input as Record<string, unknown>;
      if (typeof body.client_name !== 'string' || !body.client_name.trim()
        || body.client_name.length > OAUTH_LIMITS.clientName
        || !Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1
        || body.redirect_uris.length > OAUTH_LIMITS.redirectCount
        || !body.redirect_uris.every(validOAuthRedirectUri)
        || new Set(body.redirect_uris).size !== body.redirect_uris.length
        || body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none'
        || body.grant_types !== undefined && (!Array.isArray(body.grant_types)
          || body.grant_types.some(value => value !== 'authorization_code' && value !== 'refresh_token'))
        || body.response_types !== undefined && (!Array.isArray(body.response_types)
          || body.response_types.some(value => value !== 'code'))) return fail('invalid_client_metadata');
      const scopes = typeof body.scope === 'string' ? (body.scope ? body.scope.split(' ') : []) : resolver.permissions
        .filter(permission => permission.actors.includes('delegated-user')).map(permission => permission.id);
      if (scopes.length > OAUTH_LIMITS.permissionCount || scopes.some(scope => typeof scope !== 'string'
        || !resolver.permissions.some(permission => permission.id === scope && permission.actors.includes('delegated-user')))
        || new Set(scopes).size !== scopes.length) return fail('invalid_scope');
      const id = `oauth-${crypto.randomUUID()}`;
      const client = {id,displayName:body.client_name,redirectUris:body.redirect_uris as string[],
        scopeAllowlist:scopes,registrationKind:'dcr' as const,tokenEndpointAuthMethod:'none' as const,
        createdAtMs:Date.now()};
      if (!await store.registerClient(client)) return fail('temporarily_unavailable', 503);
      return Object.freeze({client_id:id,client_name:client.displayName,redirect_uris:client.redirectUris,
        grant_types:['authorization_code','refresh_token'],response_types:['code'],
        token_endpoint_auth_method:'none',scope:scopeString(scopes)});
    },
    async authorize(params: URLSearchParams) {
      const request = parseOAuthAuthorizationRequest(params, issuer,
        resolver.permissions.filter(permission => permission.actors.includes('delegated-user'))
          .map(permission => permission.id));
      checkedClient(request, await store.client(request.clientId));
      const global = await admission.consumeThrottle({key:await identityAdmissionKey('oauth-authorize-global'),
        limit:120,windowMs:60_000});
      if (!global.allowed) return fail('rate_limited',429);
      const client = await admission.consumeThrottle({key:await identityAdmissionKey('oauth-authorize-client',request.clientId),
        limit:30,windowMs:60_000});
      if (!client.allowed) return fail('rate_limited',429);
      await store.pruneEphemeral();
      const id = crypto.randomUUID();
      const created = await store.createRequest({...request,id,principalId:null,sessionId:null,csrfDigest:null,
        expiresAtMs:Date.now() + OAUTH_LIMITS.requestTtlMs});
      if (!created) {
        if (await store.client(request.clientId)) return fail('rate_limited',429);
        return fail('invalid_client');
      }
      return Object.freeze({transactionId:id,consentPath:`/oauth/consent/${id}`,
        audience:request.audience});
    },
    async authorizationErrorRedirect(params: URLSearchParams, error: string): Promise<string | null> {
      const clientId = params.getAll('client_id'), redirectUri = params.getAll('redirect_uri');
      const states = params.getAll('state');
      if (clientId.length !== 1 || redirectUri.length !== 1 || states.length !== 1
        || !identifier(clientId[0]) || !validOAuthRedirectUri(redirectUri[0])
        || !states[0] || states[0].length > OAUTH_LIMITS.state) return null;
      const client = await store.client(clientId[0]);
      if (!client?.redirectUris.includes(redirectUri[0])) return null;
      return oauthRedirect(redirectUri[0],{error,state:states[0],issuer});
    },
    async requestAudience(requestId: string): Promise<OAuthAudience> {
      return (await activeRequest(requestId)).request.audience;
    },
    async preview(requestId: string, sessionToken: unknown) {
      const {request,client} = await activeRequest(requestId);
      const state = await userState(sessionToken, request.audience, request.contextId);
      if (request.principalId && request.principalId !== state.session.principalId
        || request.sessionId && request.sessionId !== state.session.id) return fail('forbidden', 403);
      const csrf = await issueOpaqueToken('oauth-request');
      if (!await store.bindRequest(request.id,state.session.principalId,state.session.id,csrf.digest))
        return fail('not_found', 404);
      const permissions = effectivePermissions(state,request).map(id => {
        const suggested = options.permissionTitles?.[id];
        const title = typeof suggested === 'string' && suggested.length > 0 && suggested.length <= 200
          && suggested.isWellFormed() ? suggested : id;
        return Object.freeze({id,title});
      });
      return Object.freeze({transactionId:request.id,clientName:client.displayName,
        redirectHost:new URL(request.redirectUri).host,resource:request.resource,audience:request.audience,
        contextId:request.contextId,scopes:request.scopes,permissions,
        expiresAtMs:request.expiresAtMs,csrfToken:csrf.token,
        principal:Object.freeze({id:state.session.principalId,displayName:state.session.displayName})});
    },
    async decide(input: {requestId:string;sessionToken:unknown;csrfToken:unknown;
      decision:'approve'|'deny';permissionIds:readonly string[]}) {
      const {request} = await activeRequest(input.requestId);
      const state = await userState(input.sessionToken,request.audience,request.contextId);
      const csrfDigest = await digestOpaqueToken(input.csrfToken,'oauth-request');
      if (!digest(csrfDigest) || csrfDigest !== request.csrfDigest
        || request.principalId !== state.session.principalId || request.sessionId !== state.session.id)
        return fail('invalid_request');
      if (input.decision !== 'approve' && input.decision !== 'deny') return fail('invalid_request');
      async function finish(input: Parameters<typeof store.finishRequest>[0]) {
        try {
          if (await store.finishRequest(input)) return;
        } catch (failure) {
          if (!await store.request(request.id)) return fail('invalid_request');
          throw failure;
        }
        return fail('invalid_request');
      }
      if (input.decision === 'deny') {
        await finish({id:request.id,principalId:state.session.principalId,
          sessionId:state.session.id,sessionDigest:state.digest,csrfDigest,epoch:state.epoch});
        return Object.freeze({redirectUri:oauthRedirect(request.redirectUri,
          {error:'access_denied',state:request.state,issuer})});
      }
      const selected = input.permissionIds;
      if (!Array.isArray(selected) || selected.length > OAUTH_LIMITS.permissionCount
        || new Set(selected).size !== selected.length
        || selected.some(id => typeof id !== 'string' || !request.scopes.includes(id)))
        return fail('invalid_scope');
      const allowed = effectivePermissions(state,request);
      if (selected.some(id => !allowed.includes(id))) return fail('forbidden', 403);
      const versions = await store.sessionVersions(state.digest,state.session.id,state.session.principalId,request.audience);
      if (!versions) return fail('authentication_required', 401);
      const grant: OAuthGrantRow = Object.freeze({id:crypto.randomUUID(),principalId:state.session.principalId,
        clientId:request.clientId,resource:request.resource,audience:request.audience,
        contextId:request.contextId,scopes:Object.freeze([...selected].sort()),
        permissionIds:Object.freeze([...selected].sort()),...versions});
      const code = await issueOpaqueToken('oauth-code');
      await finish({id:request.id,principalId:state.session.principalId,
        sessionId:state.session.id,sessionDigest:state.digest,csrfDigest,epoch:state.epoch,
        grant,codeId:crypto.randomUUID(),codeDigest:code.digest,redirectUri:request.redirectUri,
        codeChallenge:request.codeChallenge,codeExpiresAtMs:Date.now()+OAUTH_LIMITS.codeTtlMs});
      return Object.freeze({redirectUri:oauthRedirect(request.redirectUri,
        {code:code.token,state:request.state,issuer})});
    },
    async exchangeCode(input: {clientId:string;code:unknown;redirectUri:string;resource:string;codeVerifier:unknown})
      : Promise<OAuthTokenResponse> {
      if (!identifier(input?.clientId) || !validOAuthRedirectUri(input.redirectUri)) return fail('invalid_request');
      const client = await store.client(input.clientId);
      if (!client || !client.redirectUris.includes(input.redirectUri)) return fail('invalid_client', 401);
      const codeDigest = await digestOpaqueToken(input.code,'oauth-code');
      if (!codeDigest) return fail('invalid_grant');
      const code = await store.code(codeDigest);
      if (!code || code.clientId !== input.clientId || code.redirectUri !== input.redirectUri
        || code.resource !== input.resource || !await verifyOAuthPkce(input.codeVerifier,code.codeChallenge))
        return fail('invalid_grant');
      const pair = await issuePair(code.grantId);
      if (pair.grant.clientId !== input.clientId || pair.grant.resource !== input.resource)
        return fail('invalid_grant');
      if (!enabled[pair.grant.audience]) return fail('invalid_grant');
      try {
        if (!await store.consumeCode({digest:codeDigest,codeId:code.id,grantId:code.grantId,
          clientId:input.clientId,accessId:crypto.randomUUID(),accessDigest:pair.access.digest,
          accessExpiresAtMs:pair.accessExpiresAtMs,refreshId:crypto.randomUUID(),
          refreshDigest:pair.refresh.digest,refreshExpiresAtMs:pair.refreshExpiresAtMs}))
          return fail('invalid_grant');
      } catch (failure) {
        if (!await store.code(codeDigest)) return fail('invalid_grant');
        throw failure;
      }
      return tokenResponse(pair);
    },
    async refresh(input: {clientId:string;refreshToken:unknown;resource:string}): Promise<OAuthTokenResponse> {
      if (!identifier(input?.clientId) || !await store.client(input.clientId)) return fail('invalid_client', 401);
      const refreshDigest = await digestOpaqueToken(input.refreshToken,'oauth-refresh');
      if (!refreshDigest) return fail('invalid_grant');
      const old = await store.refresh(refreshDigest);
      if (!old || old.clientId !== input.clientId || old.resource !== input.resource) return fail('invalid_grant');
      if (old.consumedAtMs !== null) {
        await store.revokeFamily(old.familyId);
        const grant = await store.grant(old.grantId);
        if (grant) await store.revokeGrant(old.grantId,grant.principalId);
        return fail('invalid_grant');
      }
      const pair = await issuePair(old.grantId);
      if (pair.grant.clientId !== input.clientId || pair.grant.resource !== input.resource)
        return fail('invalid_grant');
      if (!enabled[pair.grant.audience]) return fail('invalid_grant');
      try {
        if (!await store.rotateRefresh({digest:refreshDigest,id:old.id,grantId:old.grantId,
          familyId:old.familyId,clientId:input.clientId,accessId:crypto.randomUUID(),
          accessDigest:pair.access.digest,accessExpiresAtMs:pair.accessExpiresAtMs,
          refreshId:crypto.randomUUID(),refreshDigest:pair.refresh.digest,
          refreshExpiresAtMs:pair.refreshExpiresAtMs})) return fail('invalid_grant');
      } catch (error) {
        const latest = await store.refresh(refreshDigest);
        if (latest?.consumedAtMs !== null && latest?.consumedAtMs !== undefined) {
          await store.revokeFamily(old.familyId);
          const grant = await store.grant(old.grantId);
          if (grant) await store.revokeGrant(old.grantId,grant.principalId);
          return fail('invalid_grant');
        }
        throw error;
      }
      return tokenResponse(pair);
    },
    async verifyAccess(token: unknown, resource: string) {
      const tokenDigest = await digestOpaqueToken(token,'oauth-access');
      if (!tokenDigest) return null;
      const access = await store.access(tokenDigest);
      return access?.resource === resource && enabled[access.audience] ? access : null;
    },
    async revokeToken(clientId: string, token: unknown): Promise<void> {
      if (!identifier(clientId) || !await store.client(clientId)) return fail('invalid_client', 401);
      const access = await digestOpaqueToken(token,'oauth-access');
      const refresh = await digestOpaqueToken(token,'oauth-refresh');
      await store.revokeByToken(access,refresh,clientId);
    },
    async revokeGrant(grantId: string, principalId: string): Promise<boolean> {
      if (!identifier(grantId) || !identifier(principalId)) return fail('invalid_request');
      return store.revokeGrant(grantId,principalId);
    },
  });
}
