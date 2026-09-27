/** Transport-independent OAuth 2.1 rules for the two native MCP resources. */
export type OAuthAudience = 'admin' | 'app';
/** OAuth scopes are the already declared Creezio permission IDs. */
export type OAuthScope = string;
export const OAUTH_LIMITS = Object.freeze({ clientId: 2048, redirectUri: 2048, clientName: 160,
  state: 1024, formBytes: 16_384, redirectCount: 8, requestTtlMs: 10 * 60_000,
  codeTtlMs: 5 * 60_000, accessTtlMs: 15 * 60_000, refreshTtlMs: 30 * 24 * 60 * 60_000,
  permissionCount: 128 });

export class OAuthProtocolError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(`OAuth request rejected: ${code}`); this.name = 'OAuthProtocolError';
    this.code = code; this.status = status;
  }
}
const reject = (code: string, status?: number): never => { throw new OAuthProtocolError(code, status); };
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed();
const unreserved = /^[A-Za-z0-9._~-]+$/;
const b64urlSha256 = /^[A-Za-z0-9_-]{43}$/;

/** Issuer is deployment configuration, never a request Host or forwarded header. */
export function oauthIssuer(origin: unknown): string {
  if (!bounded(origin, 2048)) return reject('invalid_issuer');
  let url: URL;
  try { url = new URL(origin); } catch { return reject('invalid_issuer'); }
  if (url.href !== `${url.origin}/` || url.origin !== origin
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.hash || url.search) return reject('invalid_issuer');
  return origin;
}

export function oauthResource(issuer: string, audience: OAuthAudience): string {
  if (audience !== 'admin' && audience !== 'app') return reject('invalid_target');
  return `${oauthIssuer(issuer)}/mcp/${audience}`;
}
export function oauthResourceMetadataUrl(issuer: string, audience: OAuthAudience): string {
  return `${oauthIssuer(issuer)}/.well-known/oauth-protected-resource/mcp/${audience}`;
}
export function oauthAuthorizationServerMetadata(issuer: string, scopes: readonly OAuthScope[]) {
  const base = oauthIssuer(issuer);
  return Object.freeze({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`, revocation_endpoint: `${base}/oauth/revoke`,
    registration_endpoint: `${base}/oauth/register`,
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: checkedScopes(scopes) });
}
export function oauthProtectedResourceMetadata(issuer: string, audience: OAuthAudience,
  scopes: readonly OAuthScope[]) {
  const base = oauthIssuer(issuer);
  return Object.freeze({ resource: oauthResource(base, audience), authorization_servers: [base],
    scopes_supported: checkedScopes(scopes) });
}

/** Exact registered redirect URI. Normalizing it before comparison would weaken binding. */
export function validOAuthRedirectUri(value: unknown): value is string {
  if (!bounded(value, OAUTH_LIMITS.redirectUri) || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
const permissionId = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
function checkedScopes(scopes: readonly OAuthScope[]): readonly OAuthScope[] {
  if (!Array.isArray(scopes) || scopes.length > OAUTH_LIMITS.permissionCount
    || scopes.some(scope => typeof scope !== 'string' || scope.length > 256 || !permissionId.test(scope))
    || new Set(scopes).size !== scopes.length) return reject('invalid_scope');
  return Object.freeze([...scopes].sort());
}
export function oauthScopes(value: unknown, allowedScopes: readonly OAuthScope[]): readonly OAuthScope[] {
  if (value === undefined || value === '') return Object.freeze([]);
  if (!bounded(value, 8192)) return reject('invalid_scope');
  const allowed = new Set(checkedScopes(allowedScopes));
  const items = value.split(' ');
  if (items.length > OAUTH_LIMITS.permissionCount || items.some(item => !item || !permissionId.test(item)
    || !allowed.has(item)) || new Set(items).size !== items.length) return reject('invalid_scope');
  return Object.freeze([...items].sort());
}
export interface OAuthAuthorizationRequest {
  readonly clientId: string; readonly redirectUri: string; readonly resource: string;
  readonly audience: OAuthAudience; readonly contextId: string; readonly scopes: readonly OAuthScope[];
  readonly state: string; readonly codeChallenge: string;
}
function singleton(params: URLSearchParams, name: string, max: number): string {
  const values = params.getAll(name);
  if (values.length !== 1 || !bounded(values[0], max)) return reject('invalid_request');
  return values[0];
}
export function parseOAuthAuthorizationRequest(params: URLSearchParams, issuer: string,
  allowedScopes: readonly OAuthScope[]): OAuthAuthorizationRequest {
  if (!(params instanceof URLSearchParams)) return reject('invalid_request');
  const clientId = singleton(params, 'client_id', OAUTH_LIMITS.clientId);
  const redirectUri = singleton(params, 'redirect_uri', OAUTH_LIMITS.redirectUri);
  const resource = singleton(params, 'resource', 2048);
  const responseType = singleton(params, 'response_type', 32);
  const codeChallenge = singleton(params, 'code_challenge', 128);
  const challengeMethod = singleton(params, 'code_challenge_method', 16);
  const scopes = params.getAll('scope');
  if (scopes.length > 1 || scopes.some(value => value.length > 8192)) return reject('invalid_request');
  const scope = scopes[0];
  const state = singleton(params, 'state', OAUTH_LIMITS.state);
  const contexts = params.getAll('context_id');
  const contextId = contexts.length === 0 ? 'application' : contexts.length === 1 ? contexts[0] : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(contextId)) return reject('invalid_request');
  if (!validOAuthRedirectUri(redirectUri) || responseType !== 'code'
    || challengeMethod !== 'S256' || !b64urlSha256.test(codeChallenge)) return reject('invalid_request');
  const audience = resource === oauthResource(issuer, 'admin') ? 'admin'
    : resource === oauthResource(issuer, 'app') ? 'app' : reject('invalid_target');
  return Object.freeze({ clientId, redirectUri, resource, audience, contextId,
    scopes: oauthScopes(scope, allowedScopes), state, codeChallenge });
}

export async function verifyOAuthPkce(verifier: unknown, challenge: unknown): Promise<boolean> {
  if (!bounded(verifier, 128) || verifier.length < 43 || !unreserved.test(verifier)
    || typeof challenge !== 'string' || !b64urlSha256.test(challenge)) return false;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const actual = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  let difference = 0;
  for (let i = 0; i < 43; i++) difference |= actual.charCodeAt(i) ^ challenge.charCodeAt(i);
  return difference === 0;
}

/** Called only after the client and redirect were checked against trusted registration. */
export function oauthRedirect(uri: string, values: { readonly code?: string; readonly error?: string;
  readonly state: string; readonly issuer: string }): string {
  if (!validOAuthRedirectUri(uri) || !bounded(values.state, OAUTH_LIMITS.state)
    || Boolean(values.code) === Boolean(values.error)) return reject('invalid_request');
  const url = new URL(uri);
  url.searchParams.set(values.code ? 'code' : 'error', values.code ?? values.error!);
  url.searchParams.set('state', values.state);
  url.searchParams.set('iss', oauthIssuer(values.issuer));
  return url.href;
}
