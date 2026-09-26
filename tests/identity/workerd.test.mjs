import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { assertWorkerBoundary } from '../../scripts/build/worker-boundary.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entries = ['core/identity/password.ts', 'core/identity/tokens.ts', 'core/authorization/index.ts'];
// A public synthetic vector, never an issued credential or user secret.
const fixedToken = `cz1s_${Buffer.alloc(32, 7).toString('base64url')}`;
const expectedDigest = `sha256:${createHash('sha256').update(`creezio:credential:v1:session:${fixedToken}`).digest('hex')}`;

// Test-only handler: no bindings, account store, session middleware or persisted state.
const harness = `
import { PASSWORD_PROFILE, hashPassword, verifyPassword } from './core/identity/password.ts';
import { issueOpaqueToken, digestOpaqueToken } from './core/identity/tokens.ts';
import { authorize } from './core/authorization/index.ts';
export default { async fetch(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === '/password') {
    const password = 'Synthetic qualification only — exact UTF-8';
    const phc = hashPassword(password);
    return Response.json({ profile: PASSWORD_PROFILE, phc,
      correct: verifyPassword(password, phc), wrong: verifyPassword(password + '!', phc),
      unapprovedCost: verifyPassword(password, phc.replace('m=19456', 'm=32')) });
  }
  if (path === '/tokens') {
    const issued = await issueOpaqueToken('session');
    return Response.json({
      issuedShape: /^cz1s_[A-Za-z0-9_-]{43}$/.test(issued.token),
      digestShape: /^sha256:[a-f0-9]{64}$/.test(issued.digest),
      digestMatches: (await digestOpaqueToken(issued.token, 'session')) === issued.digest,
      crossPurpose: await digestOpaqueToken(issued.token, 'password-reset'),
      fixedDigest: await digestOpaqueToken(${JSON.stringify(fixedToken)}, 'session') });
  }
  if (path === '/authorization') {
    const snapshot = {
      actor: { id: 'user-1', kind: 'human', enabled: true, contextIds: ['context-main'], audiences: ['app'] },
      credential: { id: 'session-1', subjectId: 'user-1', kind: 'session', enabled: true,
        expiresAtMs: 2000, contextIds: ['context-main'], audiences: ['app'], permissionIds: ['example.tasks:read'] },
      permissions: [{ id: 'example.tasks:read', audiences: ['app'], actors: ['user'] }],
      roles: [{ id: 'viewer', inherits: [], permissionIds: ['example.tasks:read'], permissionOverrides: [] }],
      assignments: [{ roleId: 'viewer', contextId: 'context-main', audiences: ['app'] }], overrides: []
    };
    const target = { contextId: 'context-main', audience: 'app', actors: ['user'],
      requiredPermissionIds: ['example.tasks:read'], purpose: 'operation' };
    return Response.json({ allowed: authorize(snapshot, target, 1000),
      revoked: authorize({ ...snapshot, actor: { ...snapshot.actor, enabled: false } }, target, 1000) });
  }
  return new Response(null, { status: 404 });
} };
`;

test('identity foundations execute inside workerd without Node or account persistence', { timeout: 20000 }, async t => {
  const boundary = await assertWorkerBoundary({ root, entryPoints: entries });
  assert.deepEqual(boundary.entries, entries);
  const bundled = await build({ absWorkingDir: root,
    stdin: { resolveDir: root, sourcefile: 'identity-workerd-harness.ts', loader: 'ts', contents: harness },
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], logLevel: 'silent' });
  for (const output of Object.values(bundled.metafile.outputs)) assert.deepEqual(output.imports, []);
  const script = bundled.outputFiles[0].text;
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true, script,
    compatibilityDate: '2026-05-15' });
  // Timer lives outside workerd. Failure stops this experiment and disposes its runtime;
  // it does not prove that an application timeout can preempt synchronous Argon2 CPU.
  async function bounded(operation, milliseconds = 3000) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`External workerd deadline exceeded (${milliseconds} ms).`)), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function request(path) {
    return bounded(async () => {
      const response = await mf.dispatchFetch(`http://identity-qualification${path}`);
      assert.equal(response.status, 200);
      return response.json();
    });
  }
  let passwordWallMs;
  try {
    await bounded(() => mf.ready, 5000);
    const start = performance.now();
    const password = await request('/password');
    passwordWallMs = performance.now() - start;
    assert.deepEqual(password.profile, { algorithm: 'argon2id', version: 19, memoryKiB: 19456,
      iterations: 2, parallelism: 1, saltBytes: 16, hashBytes: 32, maximumPasswordBytes: 1024 });
    assert.match(password.phc, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    assert.equal(password.correct, true);
    assert.equal(password.wrong, false);
    assert.equal(password.unapprovedCost, false);
    assert.ok(passwordWallMs < 3000);

    const tokens = await request('/tokens');
    assert.deepEqual(tokens, { issuedShape: true, digestShape: true, digestMatches: true,
      crossPurpose: null, fixedDigest: expectedDigest });

    assert.deepEqual(await request('/authorization'), {
      allowed: { allowed: true, reason: 'allowed' }, revoked: { allowed: false, reason: 'actor_disabled' },
    });
    t.diagnostic(JSON.stringify({ scope: 'workerd-identity-foundations', bundleBytes: Buffer.byteLength(script),
      bundleSha256: createHash('sha256').update(script).digest('hex'), boundaryEntries: boundary.entries,
      passwordDerivations: 3, passwordWallMs,
      limitations: ['Outside-worker wall clock, not CPU billing or isolate memory',
        'Fixed server snapshot, no authentication middleware or persistent account/revocation store',
        'No D1/R2, login, UI, Sites or deployed application qualification'] }));
  } finally { await mf.dispose(); }
});
