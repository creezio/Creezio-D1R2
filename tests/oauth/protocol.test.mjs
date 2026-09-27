import test from 'node:test';
import assert from 'node:assert/strict';
import { oauthIssuer, oauthResource, oauthProtectedResourceMetadata, oauthAuthorizationServerMetadata,
  parseOAuthAuthorizationRequest, verifyOAuthPkce, validOAuthRedirectUri, oauthRedirect,
} from '../../core/oauth/protocol.ts';

const issuer = 'https://example.test';
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
const challenge = 'UO50YnvS0O1UIJVT7jw9l9xq3N91o-SXTJHjQxeAEAA';
const scopes = ['creezio.access:manage', 'example.tasks:read'];
function params(resource = oauthResource(issuer, 'admin')) {
  return new URLSearchParams({client_id: 'chatgpt', redirect_uri: redirect, resource,
    response_type: 'code', scope: resource.endsWith('/admin') ? scopes[0] : scopes[1],
    code_challenge: challenge, code_challenge_method: 'S256', state: 'state-1'});
}

test('each MCP audience has an exact resource and protected resource metadata', () => {
  assert.equal(oauthIssuer(issuer), issuer);
  assert.equal(oauthResource(issuer, 'admin'), `${issuer}/mcp/admin`);
  assert.equal(oauthResource(issuer, 'app'), `${issuer}/mcp/app`);
  assert.equal(oauthProtectedResourceMetadata(issuer, 'admin', [scopes[0]]).resource, `${issuer}/mcp/admin`);
  assert.deepEqual(oauthProtectedResourceMetadata(issuer, 'app', [scopes[1]]).scopes_supported,
    [scopes[1]]);
  assert.deepEqual(oauthAuthorizationServerMetadata(issuer, scopes).code_challenge_methods_supported, ['S256']);
  assert.throws(() => oauthIssuer('https://example.test.evil/'), /invalid_issuer/);
});

test('authorize rejects missing, duplicated and cross-resource binding', () => {
  assert.equal(parseOAuthAuthorizationRequest(params(), issuer, scopes).audience, 'admin');
  assert.equal(parseOAuthAuthorizationRequest(params(oauthResource(issuer, 'app')), issuer, scopes).audience, 'app');
  const missing = params(); missing.delete('resource');
  assert.throws(() => parseOAuthAuthorizationRequest(missing, issuer, scopes), /invalid_request/);
  const noScope = params(); noScope.delete('scope');
  assert.deepEqual(parseOAuthAuthorizationRequest(noScope, issuer, scopes).scopes, []);
  const emptyScope = params(); emptyScope.set('scope', '');
  assert.deepEqual(parseOAuthAuthorizationRequest(emptyScope, issuer, scopes).scopes, []);
  const duplicate = params(); duplicate.append('redirect_uri', redirect);
  assert.throws(() => parseOAuthAuthorizationRequest(duplicate, issuer, scopes), /invalid_request/);
  const crossed = params(); crossed.set('scope', 'example.tasks:write');
  assert.throws(() => parseOAuthAuthorizationRequest(crossed, issuer, scopes), /invalid_scope/);
  const wrongTarget = params(`${issuer}/mcp`);
  assert.throws(() => parseOAuthAuthorizationRequest(wrongTarget, issuer, scopes), /invalid_target/);
  const pkce = params(); pkce.set('code_challenge_method', 'plain');
  assert.throws(() => parseOAuthAuthorizationRequest(pkce, issuer, scopes), /invalid_request/);
});

test('PKCE S256 verifies the complete RFC 7636 verifier and redirect carries exact issuer', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const knownChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.equal(await verifyOAuthPkce(verifier, knownChallenge), true);
  assert.equal(await verifyOAuthPkce(verifier + 'x', knownChallenge), false);
  assert.equal(await verifyOAuthPkce('short', knownChallenge), false);
  assert.equal(validOAuthRedirectUri('https://example.test/callback#fragment'), false);
  const uri = new URL(oauthRedirect(redirect, {code: 'code-1', state: 'state-1', issuer}));
  assert.equal(uri.searchParams.get('code'), 'code-1');
  assert.equal(uri.searchParams.get('state'), 'state-1');
  assert.equal(uri.searchParams.get('iss'), issuer);
});
