// Only the first Worker exposes the real dispatcher. The second, internal test
// service prepares synthetic data and injects faults; it is never a product route.
import { createRuntime } from '../../../core/runtime/dispatch.ts';
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createD1IdentityStore, ACCESS_TABLES } from '../../../core/identity/d1-store.ts';
import { issueOpaqueToken } from '../../../core/identity/tokens.ts';

const compositionDigest = `sha256-${'0'.repeat(64)}`;
const access = { id: 'creezio.access', version: '0.0.0', operations: [] };
const protectedModule = { id: 'example.protected', version: '1.0.0', operations: [{ id: 'read', ownerModuleId: 'example.protected',
  method: 'GET', path: '/api/modules/example.protected/status', access: 'protected', maxDurationMs: 1000,
  handler() { throw new Error('Protected module must remain unreachable.'); } }] };
const makeRuntime = (mode = 'enabled') => createRuntime({ compositionDigest,
  modules: mode === 'absent' ? [] : [access, protectedModule],
  nativeAccess: { admin: mode !== 'absent', app: mode === 'enabled' } });
const runtime = makeRuntime();
const table = id => `"${ACCESS_TABLES[id]}"`;

function instrumentDatabase(real, options, stats) {
  const originals = new WeakMap();
  function wrap(statement, sql) {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...values) => wrap(target.bind(...values), sql);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } }); originals.set(proxy, { statement, sql }); return proxy;
  }
  return { prepare(sql) {
    stats.prepares++;
    if (options.storageFailure) throw new Error('Synthetic private database detail must never be returned.');
    return wrap(real.prepare(sql), sql);
  }, async batch(statements) {
    stats.batches++;
    const entries = statements.map(statement => originals.get(statement));
    if (entries.some(entry => !entry)) throw new Error('Untracked HTTP fixture statement.');
    if (options.race && !stats.injected && entries.some(entry => new RegExp(`INSERT\\s+INTO\\s+${table('sessions')}`, 'i').test(entry.sql))) {
      const mutations = {
        'principal-version': `UPDATE ${table('principals')} SET auth_version=auth_version+1 WHERE kind='human'`,
        'account-version': `UPDATE ${table('human_accounts')} SET version=version+1`,
        'credential-version': `UPDATE ${table('password_credentials')} SET version=version+1`,
        disabled: `UPDATE ${table('principals')} SET status='disabled' WHERE kind='human'`,
      };
      if (!mutations[options.race]) throw new Error('Invalid HTTP qualification race.');
      await real.prepare(mutations[options.race]).run(); stats.injected = true;
    }
    return real.batch(entries.map(entry => entry.statement));
  } };
}

async function invokeFixture(env, specification) {
  const stats = { prepares: 0, batches: 0, injected: false, cancelled: false };
  const db = instrumentDatabase(env.DB, specification, stats);
  const settings = { ...env, DB: db, ...(specification.environment ?? {}) };
  const init = { method: specification.method ?? 'GET', headers: specification.headers ?? {} };
  let timer;
  if (specification.stream) {
    const encoder = new TextEncoder(), abort = new AbortController();
    init.signal = abort.signal;
    init.body = new ReadableStream({ start(controller) {
      switch (specification.stream) {
        case 'invalid-utf8': controller.enqueue(new Uint8Array([0xc3, 0x28])); controller.close(); break;
        case 'oversize': controller.enqueue(encoder.encode(' '.repeat(16384))); controller.enqueue(encoder.encode('{}')); controller.close(); break;
        case 'misleading-length': controller.enqueue(encoder.encode(' '.repeat(16384))); controller.enqueue(encoder.encode('{}')); controller.close(); break;
        case 'errored': controller.error(new Error('Synthetic private stream error')); break;
        case 'pre-aborted': abort.abort(); break;
        case 'aborted': timer = setTimeout(() => abort.abort(), 20); break;
        case 'timeout': break;
        default: throw new Error('Unknown HTTP qualification stream.');
      }
    }, cancel() { stats.cancelled = true; } });
  } else if (specification.body !== undefined) init.body = specification.body;
  try {
    const response = await makeRuntime(specification.mode).fetch(new Request(specification.url, init), settings);
    if (!response) return { status: null, headers: {}, body: '', stats };
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text(), stats };
  } finally { clearTimeout(timer); }
}

export default {
  async fetch(request, env, ctx) {
    if (env.QUALIFICATION_ROLE !== 'control') return await runtime.fetch(request, env, ctx) ?? new Response('Not found', { status: 404 });
    const { method, args } = await request.json();
    try {
      let value;
      switch (method) {
        case 'bootstrap': {
          const provisioned = await provisionBootstrapCapability(env.DB);
          if (!provisioned) throw new Error('Internal fixture bootstrap provisioning failed.');
          value = await createAccountService(env.DB).bootstrap({ ...args[0], token: provisioned.token }); break;
        }
        case 'issueSession': {
          // Trusted fixture setup, never exposed by /api/access or evidence of password possession.
          const account = await createD1IdentityStore(env.DB).findPasswordAccount(args[0]), issued = await issueOpaqueToken('session');
          const session = await createD1IdentityStore(env.DB).createSessionAfterPassword(account,
            { sessionDigest: issued.digest, audience: args[1], ttlMs: 60000 });
          if (!session) throw new Error('Synthetic HTTP session creation failed.');
          value = { token: issued.token, session }; break;
        }
        case 'opaqueToken': value = (await issueOpaqueToken(args[0])).token; break;
        case 'invoke': value = await invokeFixture(env, args[0]); break;
        default: throw new Error('Unknown internal HTTP qualification method.');
      }
      return Response.json({ value });
    } catch (error) { return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 }); }
  },
};
