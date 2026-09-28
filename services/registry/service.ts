import {digest, digestCredential, issueCredential} from './credentials.ts';
import {declaration, email, exact, id, installation, preflight, project} from './validation.ts';
import type {RegistryDeclarationRequest, RegistryPreflightRequest} from './types.ts';
import {AccessHttpError, readAccessJson} from '../../core/identity/http-policy.ts';
import {registryPage, registryScript} from './web-ui.ts';

export interface RegistryEnvironment {
  readonly DB: D1Database;
  readonly REGISTRY_ORIGIN: string;
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  /** Service binding to an explicitly configured email delivery Worker. */
  readonly EMAIL_DELIVERY?: {fetch(request: Request): Promise<Response>};
}
type FailureCode = 'invalid_input' | 'authentication_required' | 'forbidden' | 'conflict' | 'not_found'
  | 'rate_limited' | 'configuration_unavailable' | 'service_unavailable';
class Refusal extends Error {
  readonly code: FailureCode;
  readonly status: number;
  constructor(code: FailureCode, status: number) {super(code); this.code = code; this.status = status;}
}
function refuse(code: FailureCode, status: number): never {throw new Refusal(code, status);}
const json = (body: unknown, status = 200, headers?: HeadersInit) => {
  const output = new Headers(headers);
  output.set('content-type', 'application/json; charset=utf-8');
  output.set('cache-control', 'no-store');
  output.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), {status, headers: output});
};
function web(content: string, type: string, page = false): Response {
  const headers = new Headers({'content-type': type, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY'});
  if (page) headers.set('content-security-policy', "default-src 'none'; script-src 'self'; connect-src 'self'; "
    + "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
  return new Response(content, {headers});
}
const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
const ownerCookie = '__Host-creezio-registry-owner';
const oauthCookie = '__Host-creezio-registry-oauth-state';
const iso = (ms: number) => new Date(ms).toISOString();
const uuid = () => crypto.randomUUID();
function headerCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie')?.split(';') ?? [];
  const found = cookies.map(item => item.trim()).filter(item => item.startsWith(`${name}=`));
  return found.length === 1 ? found[0].slice(name.length + 1) : null;
}
async function body(request: Request): Promise<unknown> {
  try {return await readAccessJson(request);}
  catch (error) {
    if (error instanceof AccessHttpError && error.status >= 400 && error.status < 500)
      refuse('invalid_input', error.status === 413 ? 413 : 400);
    refuse('service_unavailable', 503);
  }
}
function csrf(request: Request, origin: string): void {
  if (request.headers.get('origin') !== origin || request.headers.get('x-creezio-request') !== '1') refuse('forbidden', 403);
}
async function owner(db: D1Database, request: Request, now: number): Promise<{id: string; digest: string} | null> {
  const token = headerCookie(request, ownerCookie), hash = await digestCredential(token, 'owner');
  if (!hash) return null;
  const row = await db.prepare(`SELECT o.id,s.digest FROM registry_owner_sessions s JOIN registry_owners o ON o.id=s.owner_id
    WHERE s.digest=? AND s.expires_at_ms>? AND s.revoked_at_ms IS NULL AND o.verified_at_ms>0`)
    .bind(hash, now).first<{id: string; digest: string}>();
  return row ?? null;
}
async function installationActor(db: D1Database, request: Request): Promise<{
  id: string; project_id: string; target: 'sites' | 'cloudflare'; token_version: number; token_digest: string} | null> {
  const bearer = /^Bearer (cz1d_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '');
  const hash = bearer && await digestCredential(bearer[1], 'installation');
  if (!hash) return null;
  return db.prepare(`SELECT i.id,i.project_id,i.target,i.token_version,i.token_digest FROM registry_installations i
    JOIN registry_projects p ON p.id=i.project_id JOIN registry_owners o ON o.id=p.owner_id
    WHERE i.token_digest=? AND i.revoked_at_ms IS NULL AND o.verified_at_ms>0`).bind(hash)
    .first<{id: string; project_id: string; target: 'sites' | 'cloudflare'; token_version: number; token_digest: string}>();
}
async function ownerFor(db: D1Database, method: 'email' | 'github', subject: string, emailAddress: string | null,
  now: number): Promise<string> {
  const candidate = uuid();
  await db.prepare(`INSERT INTO registry_owners(id,method,subject,email,verified_at_ms) VALUES(?,?,?,?,?)
    ON CONFLICT(method,subject) DO UPDATE SET verified_at_ms=excluded.verified_at_ms,
      email=COALESCE(excluded.email,registry_owners.email)`).bind(candidate, method, subject, emailAddress, now).run();
  const row = await db.prepare('SELECT id FROM registry_owners WHERE method=? AND subject=?').bind(method, subject).first<{id: string}>();
  if (!row) refuse('service_unavailable', 503);
  return row.id;
}
async function ownerSession(db: D1Database, ownerId: string, now: number): Promise<string> {
  const issued = await issueCredential('owner');
  await db.prepare('INSERT INTO registry_owner_sessions(digest,owner_id,expires_at_ms,revoked_at_ms) VALUES(?,?,?,NULL)')
    .bind(issued.digest, ownerId, now + 8 * 60 * 60_000).run();
  return issued.token;
}
const canonicalArtifact = (value: RegistryPreflightRequest['artifact']) => JSON.stringify({
  sourceSha: value.sourceSha, artifactDigest: value.artifactDigest, coreVersion: value.coreVersion,
  contractVersion: value.contractVersion, compositionDigest: value.compositionDigest,
});
const stableDeclaration = (value: RegistryDeclarationRequest) => JSON.stringify({
  preflightId: value.preflightId, projectId: value.projectId, installationId: value.installationId,
  deploymentId: value.deploymentId, url: value.url, repositoryUrl: value.repositoryUrl ?? null,
  publishedSha: value.publishedSha ?? null, artifact: JSON.parse(canonicalArtifact(value.artifact)),
});
async function githubJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  let rejectDeadline: (error: Refusal) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {rejectDeadline = reject;});
  void deadline.catch(() => {});
  const timer = setTimeout(() => {controller.abort(); rejectDeadline(new Refusal('service_unavailable', 503));}, 10_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // Workers support manual redirects; the status guard below rejects every 3xx response.
    const response = await Promise.race([fetcher(url, {...init, redirect: 'manual', cache: 'no-store',
      credentials: 'omit', signal: controller.signal}), deadline]);
    if (!response.ok || !response.body) refuse('service_unavailable', 503);
    const length = response.headers.get('content-length');
    // Fetch may decode a compressed response while retaining the wire headers. The stream limit below
    // applies to the bytes actually handed to this service, regardless of those headers.
    if (!response.headers.has('content-encoding') && length
      && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > 16_384)) refuse('service_unavailable', 503);
    reader = response.body.getReader();
    const consume = async () => {
      const chunks: Uint8Array[] = []; let bytes = 0, count = 0;
      for (;;) {
        const part = await reader!.read();
        if (part.done) break;
        if (++count > 16_385 || !(part.value instanceof Uint8Array)) refuse('service_unavailable', 503);
        bytes += part.value.length;
        if (bytes > 16_384) refuse('service_unavailable', 503);
        chunks.push(part.value);
      }
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) {joined.set(chunk, offset); offset += chunk.length;}
      try {return JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(joined));}
      catch {return refuse('service_unavailable', 503);}
    };
    return await Promise.race([consume(), deadline]);
  } catch {return refuse('service_unavailable', 503);}
  finally {
    clearTimeout(timer); controller.abort();
    try {void reader?.cancel().catch(() => {});} catch { /* Cancellation is best effort. */ }
    try {reader?.releaseLock();} catch { /* Pending read may still own the lock. */ }
  }
}
const admissionWindowMs = 3_600_000;
const oauthStateLifetimeMs = 10 * 60_000;
const anonymousAdmissionsPerHour = 120;
async function pruneAnonymousAdmissions(db: D1Database, now: number): Promise<void> {
  // Retain the entire admission window, including consumed entries, so fresh addresses cannot
  // evade the global limit. Bounded deletion prevents a single request doing unbounded cleanup.
  await db.prepare(`DELETE FROM registry_email_challenges WHERE rowid IN
    (SELECT rowid FROM registry_email_challenges WHERE created_at_ms<=? LIMIT 100)`)
    .bind(now - admissionWindowMs).run();
  await db.prepare(`DELETE FROM registry_oauth_states WHERE rowid IN
    (SELECT rowid FROM registry_oauth_states WHERE expires_at_ms<=? LIMIT 100)`)
    .bind(now - admissionWindowMs + oauthStateLifetimeMs).run();
}
async function sendEmail(binding: NonNullable<RegistryEnvironment['EMAIL_DELIVERY']>,
  payload: {to: string; code: string; challengeId: string}): Promise<boolean> {
  const controller = new AbortController();
  let rejectDeadline: (error: Refusal) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {rejectDeadline = reject;});
  void deadline.catch(() => {});
  const timer = setTimeout(() => {controller.abort(); rejectDeadline(new Refusal('service_unavailable', 503));}, 10_000);
  try {
    const response = await Promise.race([binding.fetch(new Request('https://registry-email-delivery.invalid/verification', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal,
    })), deadline]);
    return response.ok;
  } catch {return false;}
  finally {clearTimeout(timer); controller.abort();}
}

/** Separate registry Worker: no app runtime or business D1 import. */
export function createRegistryService(env: RegistryEnvironment, options: {now?: () => number; fetch?: typeof fetch} = {}) {
  const db = env.DB, current = options.now ?? Date.now, remoteFetch = options.fetch ?? fetch;
  return Object.freeze({async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url), origin = env.REGISTRY_ORIGIN;
      if (!origin || url.origin !== origin || !/^https:\/\//.test(origin)) refuse('configuration_unavailable', 503);
      if (request.url.length > 8192 || url.search && !url.pathname.endsWith('/callback')) refuse('invalid_input', 400);
      const now = current(), path = url.pathname;
      if (request.method === 'GET' && path === '/v1/health') return json({status: 'ok'});
      if (request.method === 'GET' && path === '/') return web(registryPage, 'text/html; charset=utf-8', true);
      if (request.method === 'GET' && path === '/registry.js')
        return web(registryScript, 'application/javascript; charset=utf-8');
      if (request.method === 'GET' && path === '/v1/owners/me') {
        const actor = await owner(db, request, now);
        if (!actor) refuse('authentication_required', 401);
        return json({ownerId: actor.id});
      }
      if (request.method === 'GET' && path === '/v1/projects') {
        const actor = await owner(db, request, now);
        if (!actor) refuse('authentication_required', 401);
        const rows = await db.prepare(`SELECT p.id,p.name,p.origin,p.created_at_ms FROM registry_projects p
          JOIN registry_owner_sessions s ON s.owner_id=p.owner_id
          JOIN registry_owners o ON o.id=p.owner_id
          WHERE p.owner_id=? AND s.digest=? AND s.expires_at_ms>? AND s.revoked_at_ms IS NULL
            AND o.verified_at_ms>0 ORDER BY p.created_at_ms DESC,p.id DESC LIMIT 101`)
          .bind(actor.id, actor.digest, now)
          .all<{id: string; name: string; origin: string; created_at_ms: number}>();
        return json({projects: rows.results.slice(0, 100).map(row => ({
          projectId: row.id, name: row.name, origin: row.origin, createdAt: iso(row.created_at_ms),
        })), complete: rows.results.length <= 100, limit: 100});
      }
      const installationsRead = /^\/v1\/projects\/([A-Za-z0-9._:-]+)\/installations$/.exec(path);
      if (request.method === 'GET' && installationsRead) {
        const actor = await owner(db, request, now);
        if (!actor) refuse('authentication_required', 401);
        if (!id(installationsRead[1])) refuse('invalid_input', 400);
        const rows = await db.prepare(`SELECT p.id AS project_id,i.id,i.target,i.token_version,
            i.revoked_at_ms,i.created_at_ms,i.rotated_at_ms FROM registry_projects p
          JOIN registry_owner_sessions s ON s.owner_id=p.owner_id
          JOIN registry_owners o ON o.id=p.owner_id
          LEFT JOIN registry_installations i ON i.project_id=p.id
          WHERE p.id=? AND p.owner_id=? AND s.digest=? AND s.expires_at_ms>?
            AND s.revoked_at_ms IS NULL AND o.verified_at_ms>0
          ORDER BY i.created_at_ms DESC,i.id DESC LIMIT 101`)
          .bind(installationsRead[1], actor.id, actor.digest, now)
          .all<{project_id: string; id: string | null; target: 'sites' | 'cloudflare' | null; token_version: number | null;
            revoked_at_ms: number | null; created_at_ms: number; rotated_at_ms: number | null}>();
        if (!rows.results.length) refuse('not_found', 404);
        const found = rows.results.filter(row => row.id !== null);
        return json({projectId: installationsRead[1], installations: found.slice(0, 100).map(row => ({
          installationId: row.id, target: row.target, tokenVersion: row.token_version,
          createdAt: iso(row.created_at_ms), rotatedAt: row.rotated_at_ms === null ? null : iso(row.rotated_at_ms),
          revokedAt: row.revoked_at_ms === null ? null : iso(row.revoked_at_ms),
        })), complete: found.length <= 100, limit: 100});
      }
      if (request.method === 'POST' && path === '/v1/owners/email/start') {
        csrf(request, origin);
        if (!env.EMAIL_DELIVERY) refuse('configuration_unavailable', 503);
        const value = await body(request);
        if (!exact(value, ['email']) || !email(value.email)) refuse('invalid_input', 400);
        const address = value.email.toLowerCase();
        await pruneAnonymousAdmissions(db, now);
        const challengeId = uuid(), code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, '0');
        const codeDigest = await digest(`creezio:registry:email:v1:${challengeId}:${code}`);
        const admitted = await db.prepare(`INSERT INTO registry_email_challenges
          (id,email,code_digest,created_at_ms,expires_at_ms,attempts,consumed_at_ms)
          SELECT ?,?,?,?,?,0,NULL WHERE
            (SELECT count(*) FROM registry_email_challenges WHERE created_at_ms>?) +
            (SELECT count(*) FROM registry_oauth_states WHERE expires_at_ms>?) < ${anonymousAdmissionsPerHour}
            AND (SELECT count(*) FROM registry_email_challenges WHERE email=? AND created_at_ms>?) < 3`)
          .bind(challengeId, address, codeDigest, now, now + oauthStateLifetimeMs,
            now - admissionWindowMs, now - admissionWindowMs + oauthStateLifetimeMs,
            address, now - admissionWindowMs).run();
        if (admitted.meta.changes !== 1) refuse('rate_limited', 429);
        if (!await sendEmail(env.EMAIL_DELIVERY, {to: address, code, challengeId})) {
          await db.prepare('UPDATE registry_email_challenges SET consumed_at_ms=? WHERE id=? AND consumed_at_ms IS NULL')
            .bind(now, challengeId).run();
          refuse('service_unavailable', 503);
        }
        return json({challengeId, expiresAt: iso(now + oauthStateLifetimeMs)}, 202);
      }
      if (request.method === 'POST' && path === '/v1/owners/email/verify') {
        csrf(request, origin);
        const value = await body(request);
        if (!exact(value, ['challengeId','code']) || !id(value.challengeId) || typeof value.code !== 'string'
          || !/^[0-9]{8}$/.test(value.code)) refuse('invalid_input', 400);
        const codeDigest = await digest(`creezio:registry:email:v1:${value.challengeId}:${value.code}`);
        const result = await db.prepare(`UPDATE registry_email_challenges SET consumed_at_ms=?,attempts=attempts+1
          WHERE id=? AND code_digest=? AND expires_at_ms>? AND consumed_at_ms IS NULL AND attempts<5`)
          .bind(now, value.challengeId, codeDigest, now).run();
        if (result.meta.changes !== 1) {
          await db.prepare('UPDATE registry_email_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at_ms IS NULL AND attempts<5')
            .bind(value.challengeId).run();
          refuse('forbidden', 403);
        }
        const challenge = await db.prepare('SELECT email FROM registry_email_challenges WHERE id=?').bind(value.challengeId).first<{email: string}>();
        if (!challenge) refuse('service_unavailable', 503);
        const ownerId = await ownerFor(db, 'email', challenge.email, challenge.email, now);
        const token = await ownerSession(db, ownerId, now);
        return json({ownerId, verifiedAt: iso(now)}, 200, {'set-cookie': cookie(ownerCookie, token, 8 * 60 * 60)});
      }
      if (request.method === 'GET' && path === '/v1/owners/github/start') {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) refuse('configuration_unavailable', 503);
        const state = await issueCredential('oauth'), verifier = (await issueCredential('oauth')).token.slice(5);
        const proof = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
        const challenge = btoa(String.fromCharCode(...proof)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
        await pruneAnonymousAdmissions(db, now);
        const admitted = await db.prepare(`INSERT INTO registry_oauth_states(state_digest,verifier,expires_at_ms,consumed_at_ms)
          SELECT ?,?,?,NULL WHERE
            (SELECT count(*) FROM registry_email_challenges WHERE created_at_ms>?) +
            (SELECT count(*) FROM registry_oauth_states WHERE expires_at_ms>?) < ${anonymousAdmissionsPerHour}`)
          .bind(state.digest, verifier, now + oauthStateLifetimeMs,
            now - admissionWindowMs, now - admissionWindowMs + oauthStateLifetimeMs).run();
        if (admitted.meta.changes !== 1) refuse('rate_limited', 429);
        const redirect = new URL('https://github.com/login/oauth/authorize');
        redirect.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
        redirect.searchParams.set('redirect_uri', `${origin}/v1/owners/github/callback`);
        redirect.searchParams.set('scope', 'read:user');
        redirect.searchParams.set('state', state.token);
        redirect.searchParams.set('code_challenge', challenge);
        redirect.searchParams.set('code_challenge_method', 'S256');
        return new Response(null, {status: 302, headers: {'location': redirect.href, 'cache-control': 'no-store',
          'set-cookie': cookie(oauthCookie, state.token, 600)}});
      }
      if (request.method === 'GET' && path === '/v1/owners/github/callback') {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) refuse('configuration_unavailable', 503);
        const state = url.searchParams.get('state'), code = url.searchParams.get('code');
        if (!state || state !== headerCookie(request, oauthCookie) || !code || code.length > 512) refuse('forbidden', 403);
        const stateDigest = await digestCredential(state, 'oauth');
        if (!stateDigest) refuse('forbidden', 403);
        const row = await db.prepare('SELECT verifier FROM registry_oauth_states WHERE state_digest=? AND expires_at_ms>? AND consumed_at_ms IS NULL')
          .bind(stateDigest, now).first<{verifier: string}>();
        if (!row) refuse('forbidden', 403);
        const used = await db.prepare('UPDATE registry_oauth_states SET consumed_at_ms=? WHERE state_digest=? AND consumed_at_ms IS NULL')
          .bind(now, stateDigest).run();
        if (used.meta.changes !== 1) refuse('forbidden', 403);
        const issued = (await githubJson(remoteFetch, 'https://github.com/login/oauth/access_token', {method: 'POST',
          headers: {'accept': 'application/json', 'content-type': 'application/json'},
          body: JSON.stringify({client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
            code, redirect_uri: `${origin}/v1/owners/github/callback`, code_verifier: row.verifier})})) as
          {access_token?: unknown; token_type?: unknown};
        if (typeof issued.access_token !== 'string' || issued.access_token.length > 512
          || issued.token_type !== 'bearer') refuse('forbidden', 403);
        const profile = await githubJson(remoteFetch, 'https://api.github.com/user', {headers: {
          'accept': 'application/vnd.github+json', 'authorization': `Bearer ${issued.access_token}`,
          'user-agent': 'creezio-registry'}}) as {id?: unknown; login?: unknown};
        if (!Number.isSafeInteger(profile.id) || Number(profile.id) <= 0 || typeof profile.login !== 'string'
          || !id(profile.login)) refuse('forbidden', 403);
        const ownerId = await ownerFor(db, 'github', String(profile.id), null, now);
        const token = await ownerSession(db, ownerId, now);
        const headers = new Headers({'set-cookie': cookie(ownerCookie, token, 8 * 60 * 60), 'cache-control': 'no-store'});
        headers.append('set-cookie', cookie(oauthCookie, '', 0));
        if ((request.headers.get('accept') ?? '').toLowerCase().includes('text/html')) {
          headers.set('location', `${origin}/`);
          headers.set('referrer-policy', 'no-referrer');
          return new Response(null, {status: 303, headers});
        }
        return json({ownerId, verifiedAt: iso(now)}, 200, headers);
      }
      if (request.method === 'POST' && path === '/v1/projects') {
        csrf(request, origin);
        const actor = await owner(db, request, now);
        if (!actor) refuse('authentication_required', 401);
        const value = await body(request);
        if (!project(value)) refuse('invalid_input', 400);
        const projectId = uuid();
        const inserted = await db.prepare(`INSERT INTO registry_projects(id,owner_id,name,origin,created_at_ms)
          SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM registry_owner_sessions s JOIN registry_owners o ON o.id=s.owner_id
          WHERE s.digest=? AND s.owner_id=? AND s.expires_at_ms>? AND s.revoked_at_ms IS NULL AND o.verified_at_ms>0)`)
          .bind(projectId, actor.id, value.name, value.origin, now, actor.digest, actor.id, now).run();
        if (inserted.meta.changes !== 1) refuse('authentication_required', 401);
        return json({projectId, createdAt: iso(now)}, 201);
      }
      const transfer = /^\/v1\/projects\/([A-Za-z0-9._:-]+)\/transfer$/.exec(path);
      if (request.method === 'POST' && transfer) {
        csrf(request, origin);
        const actor = await owner(db, request, now);
        if (!actor) refuse('authentication_required', 401);
        const value = await body(request);
        if (!id(transfer[1]) || !exact(value, ['newOwnerId']) || !id(value.newOwnerId)
          || value.newOwnerId === actor.id) refuse('invalid_input', 400);
        const nonce = uuid();
        const changes = await db.batch([
          db.prepare(`UPDATE registry_projects SET owner_id=?,owner_updated_at_ms=?,owner_change_nonce=?
          WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM registry_owner_sessions s
          WHERE s.digest=? AND s.owner_id=? AND s.expires_at_ms>? AND s.revoked_at_ms IS NULL)
          AND EXISTS(SELECT 1 FROM registry_owners
          WHERE id=? AND verified_at_ms>0 AND method IN ('email','github'))`)
            .bind(value.newOwnerId, now, nonce, transfer[1], actor.id,
              actor.digest, actor.id, now, value.newOwnerId),
          db.prepare(`UPDATE registry_installations SET revoked_at_ms=?,token_version=token_version+1
            WHERE project_id=? AND revoked_at_ms IS NULL AND EXISTS(SELECT 1 FROM registry_projects
            WHERE id=? AND owner_id=? AND owner_change_nonce=?)`)
            .bind(now, transfer[1], transfer[1], value.newOwnerId, nonce),
        ]);
        if (changes[0].meta.changes !== 1) refuse('forbidden', 403);
        return json({projectId: transfer[1], ownerId: value.newOwnerId, transferredAt: iso(now)});
      }
      if (request.method === 'POST' && path === '/v1/installations') {
        csrf(request, origin);
        const actor = await owner(db, request, now);
        if (!actor) refuse('authentication_required', 401);
        const value = await body(request);
        if (!installation(value)) refuse('invalid_input', 400);
        const projectRow = await db.prepare('SELECT id FROM registry_projects WHERE id=? AND owner_id=?')
          .bind(value.projectId, actor.id).first();
        if (!projectRow) refuse('forbidden', 403);
        const issued = await issueCredential('installation'), installationId = uuid();
        const inserted = await db.prepare(`INSERT INTO registry_installations(id,project_id,target,token_digest,token_version,revoked_at_ms,created_at_ms,rotated_at_ms)
          SELECT ?,?,?,?,1,NULL,?,NULL WHERE EXISTS(SELECT 1 FROM registry_projects p
          JOIN registry_owner_sessions s ON s.owner_id=p.owner_id WHERE p.id=? AND p.owner_id=?
          AND s.digest=? AND s.expires_at_ms>? AND s.revoked_at_ms IS NULL)`)
          .bind(installationId, value.projectId, value.target, issued.digest, now,
            value.projectId, actor.id, actor.digest, now).run();
        if (inserted.meta.changes !== 1) refuse('forbidden', 403);
        return json({installationId, projectId: value.projectId, target: value.target,
          token: issued.token, createdAt: iso(now)}, 201);
      }
      const tokenAction = /^\/v1\/installations\/([A-Za-z0-9._:-]+)\/(rotate|revoke)$/.exec(path);
      if (request.method === 'POST' && tokenAction) {
        csrf(request, origin);
        const actor = await owner(db, request, now);
        if (!actor) refuse('authentication_required', 401);
        if (!id(tokenAction[1]) || request.body !== null) refuse('invalid_input', 400);
        if (tokenAction[2] === 'rotate') {
          const issued = await issueCredential('installation');
          const result = await db.prepare(`UPDATE registry_installations SET token_digest=?,token_version=token_version+1,rotated_at_ms=?
            WHERE id=? AND revoked_at_ms IS NULL AND project_id IN (SELECT id FROM registry_projects WHERE owner_id=?)
            AND EXISTS(SELECT 1 FROM registry_owner_sessions WHERE digest=? AND owner_id=?
            AND expires_at_ms>? AND revoked_at_ms IS NULL)`)
            .bind(issued.digest, now, tokenAction[1], actor.id, actor.digest, actor.id, now).run();
          if (result.meta.changes !== 1) refuse('not_found', 404);
          return json({installationId: tokenAction[1], token: issued.token, rotatedAt: iso(now)});
        }
        const result = await db.prepare(`UPDATE registry_installations SET revoked_at_ms=?,token_version=token_version+1
          WHERE id=? AND revoked_at_ms IS NULL AND project_id IN (SELECT id FROM registry_projects WHERE owner_id=?)
          AND EXISTS(SELECT 1 FROM registry_owner_sessions WHERE digest=? AND owner_id=?
          AND expires_at_ms>? AND revoked_at_ms IS NULL)`)
          .bind(now, tokenAction[1], actor.id, actor.digest, actor.id, now).run();
        if (result.meta.changes !== 1) refuse('not_found', 404);
        return json({installationId: tokenAction[1], revokedAt: iso(now)});
      }
      if (request.method === 'POST' && path === '/v1/publications/preflight') {
        const actor = await installationActor(db, request);
        if (!actor) refuse('authentication_required', 401);
        const value = await body(request);
        if (!preflight(value)) refuse('invalid_input', 400);
        if (actor.id !== value.installationId || actor.project_id !== value.projectId || actor.target !== value.target)
          refuse('forbidden', 403);
        const preflightId = uuid(), expires = now + 10 * 60_000;
        const inserted = await db.prepare(`INSERT INTO registry_preflights(id,project_id,installation_id,target,artifact_json,token_version,checked_at_ms,expires_at_ms)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM registry_installations i
          JOIN registry_projects p ON p.id=i.project_id JOIN registry_owners o ON o.id=p.owner_id
          WHERE i.id=? AND i.project_id=? AND i.target=? AND i.token_digest=? AND i.token_version=?
          AND i.revoked_at_ms IS NULL AND o.verified_at_ms>0)`)
          .bind(preflightId, value.projectId, value.installationId, value.target,
            canonicalArtifact(value.artifact), actor.token_version, now, expires,
            actor.id, actor.project_id, actor.target, actor.token_digest, actor.token_version).run();
        if (inserted.meta.changes !== 1) refuse('authentication_required', 401);
        return json({preflightId, projectId: value.projectId, installationId: value.installationId,
          checkedAt: iso(now), expiresAt: iso(expires)});
      }
      if (request.method === 'POST' && path === '/v1/deployments/declare') {
        const actor = await installationActor(db, request);
        if (!actor) refuse('authentication_required', 401);
        const value = await body(request);
        if (!declaration(value)) refuse('invalid_input', 400);
        if (actor.id !== value.installationId || actor.project_id !== value.projectId) refuse('forbidden', 403);
        const prior = await db.prepare(`SELECT target,artifact_json FROM registry_preflights
          WHERE id=? AND project_id=? AND installation_id=?`).bind(value.preflightId, value.projectId, value.installationId)
          .first<{target: string; artifact_json: string}>();
        // A preflight's expiry limits the *start* of a publication in the client.
        // A delivered publication may be declared much later after an outage or rotation.
        if (!prior || prior.target !== actor.target || prior.artifact_json !== canonicalArtifact(value.artifact))
          refuse('forbidden', 403);
        const requestHash = await digest(`creezio:registry:declaration-key:v1:${value.requestKey}`);
        const payloadHash = await digest(stableDeclaration(value));
        let inserted = false;
        try {
          const result = await db.prepare(`INSERT INTO registry_deployments(id,project_id,installation_id,request_key_digest,payload_digest,
            deployment_id,url,repository_url,published_sha,artifact_json,declared_at_ms)
            SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM registry_installations i
            JOIN registry_projects p ON p.id=i.project_id JOIN registry_owners o ON o.id=p.owner_id
            WHERE i.id=? AND i.project_id=? AND i.target=? AND i.token_digest=? AND i.token_version=?
            AND i.revoked_at_ms IS NULL AND o.verified_at_ms>0)
            ON CONFLICT(installation_id,request_key_digest) DO NOTHING`)
            .bind(uuid(), value.projectId, value.installationId, requestHash, payloadHash, value.deploymentId,
              value.url, value.repositoryUrl ?? null, value.publishedSha ?? null, canonicalArtifact(value.artifact), now,
              actor.id, actor.project_id, actor.target, actor.token_digest, actor.token_version).run();
          inserted = result.meta.changes === 1;
        } catch (error) {
          if (String(error).includes('UNIQUE constraint failed')) refuse('conflict', 409);
          refuse('service_unavailable', 503);
        }
        if (!await installationActor(db, request)) refuse('authentication_required', 401);
        const row = await db.prepare(`SELECT payload_digest,declared_at_ms FROM registry_deployments
          WHERE installation_id=? AND request_key_digest=?`).bind(value.installationId, requestHash)
          .first<{payload_digest: string; declared_at_ms: number}>();
        if (!row || row.payload_digest !== payloadHash) refuse('conflict', 409);
        return json({projectId: value.projectId, installationId: value.installationId,
          deploymentId: value.deploymentId, declaredAt: iso(row.declared_at_ms), replayed: !inserted});
      }
      return json({error: {code: 'not_found'}}, 404);
    } catch (error) {
      if (error instanceof Refusal) return json({error: {code: error.code}}, error.status);
      return json({error: {code: 'service_unavailable'}}, 503);
    }
  }});
}
