// Internal qualification only. No test method or SQL race is registered in the application.
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createAccountAdministrationService } from '../../../core/identity/administration.ts';
import { createAccountLifecycleService } from '../../../core/identity/lifecycle.ts';
import { createMachineAccountService } from '../../../core/identity/machines.ts';
import { createD1IdentityStore, ACCESS_TABLES } from '../../../core/identity/d1-store.ts';
import { issueOpaqueToken } from '../../../core/identity/tokens.ts';

const options = { permissions: [] };
const table = id => `"${ACCESS_TABLES[id]}"`;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const methods = ['listPrincipals', 'listSessions', 'setHumanStatus', 'revokeAllHumanSessions', 'revokeSessionById'];

function wrapDatabase(real, beforeBatch) {
  const originals = new WeakMap();
  function wrap(statement, sql) {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...values) => wrap(target.bind(...values), sql);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    originals.set(proxy, { statement, sql }); return proxy;
  }
  return { prepare: sql => wrap(real.prepare(sql), sql), batch: async statements => {
    const entries = statements.map(statement => originals.get(statement));
    if (entries.some(entry => !entry)) throw new Error('Untracked administration qualification statement.');
    await beforeBatch(entries.map(entry => entry.sql));
    return real.batch(entries.map(entry => entry.statement));
  } };
}

function mutationStatement(db, mutation, session, subject) {
  const changes = {
    epoch: [`UPDATE ${table('authorization_state')} SET epoch=epoch+1 WHERE id='application'`, []],
    'issuer-revoked': [`UPDATE ${table('sessions')} SET revoked_at_ms=${NOW} WHERE id=?`, [session?.id]],
    'issuer-expired': [`UPDATE ${table('sessions')} SET expires_at_ms=${NOW} WHERE id=?`, [session?.id]],
    'issuer-membership': [`UPDATE ${table('memberships')} SET status='disabled' WHERE principal_id=? AND context_id='application' AND audience='admin'`, [session?.principalId]],
    'issuer-credential-expired': [`UPDATE ${table('password_credentials')} SET expires_at_ms=${NOW} WHERE principal_id=?`, [session?.principalId]],
    'target-version': [`UPDATE ${table('principals')} SET auth_version=auth_version+1 WHERE id=?`, [subject?.principalId]],
    'target-revoked': [`UPDATE ${table('sessions')} SET revoked_at_ms=${NOW} WHERE id=?`, [subject?.sessionId]],
  };
  const change = changes[mutation];
  if (!change || change[1].includes(undefined)) throw new Error('Invalid administration qualification race.');
  return db.prepare(change[0]).bind(...change[1]);
}

export default {
  async fetch(request, env) {
    const body = await request.json();
    try {
      let value;
      if (methods.includes(body.method)) value = await createAccountAdministrationService(env.DB, options)[body.method](...body.args);
      else switch (body.method) {
        case 'bootstrap': {
          const issued = await provisionBootstrapCapability(env.DB);
          if (!issued) throw new Error('Fixture bootstrap provisioning failed.');
          value = await createAccountService(env.DB).bootstrap({ ...body.args[0], token: issued.token }); break;
        }
        case 'login': value = await createAccountService(env.DB).login(...body.args); break;
        case 'session': value = await createAccountService(env.DB).session(...body.args); break;
        case 'issueSession': {
          // Trusted fixture setup, not evidence of password possession.
          const store = createD1IdentityStore(env.DB), account = await store.findPasswordAccount(body.args[0]);
          const issued = await issueOpaqueToken('session');
          const session = await store.createSessionAfterPassword(account, { sessionDigest: issued.digest, audience: body.args[1] ?? 'admin', ttlMs: 60000 });
          if (!session) throw new Error('Fixture session creation failed.');
          value = { token: issued.token, session }; break;
        }
        case 'issueInvitation': value = await createAccountLifecycleService(env.DB, options).issueInvitation(...body.args); break;
        case 'issueActivation': value = await createAccountLifecycleService(env.DB, options).issueActivation(...body.args); break;
        case 'issuePasswordReset': value = await createAccountLifecycleService(env.DB, options).issuePasswordReset(...body.args); break;
        case 'redeem': value = await createAccountLifecycleService(env.DB, options).redeem(...body.args); break;
        case 'createService': value = await createMachineAccountService(env.DB, options).createService(...body.args); break;
        case 'measured': {
          const [method, args] = body.args;
          if (!methods.includes(method)) throw new Error('Invalid measured administration method.');
          const batches = [];
          const db = wrapDatabase(env.DB, async sql => { batches.push(sql.length); });
          value = { result: await createAccountAdministrationService(db, options)[method](...args), batches }; break;
        }
        case 'withRace': {
          const [method, args, mutation, subject] = body.args;
          if (!methods.includes(method)) throw new Error('Invalid administration fixture method.');
          const session = await createAccountService(env.DB).session(args[0], 'admin');
          let injected = false, batches = 0;
          const db = wrapDatabase(env.DB, async sql => {
            batches++;
            const page = method.startsWith('list') && sql.length === 2 && sql.every(query => /^SELECT\s/i.test(query.trimStart()));
            const commit = sql.some(query => new RegExp(`INSERT\\s+INTO\\s+${table('access_audit')}`, 'i').test(query));
            if (!injected && (page || commit)) {
              await mutationStatement(env.DB, mutation, session, subject).run(); injected = true;
            }
          });
          value = { result: await createAccountAdministrationService(db, options)[method](...args), injected, batches }; break;
        }
        case 'mutableInput': {
          const [method, args, replacement] = body.args;
          if (!methods.includes(method)) throw new Error('Invalid mutable administration method.');
          let mutated = false;
          const db = wrapDatabase(env.DB, async () => { if (!mutated) { Object.assign(args[1], replacement); mutated = true; } });
          value = { result: await createAccountAdministrationService(db, options)[method](...args), mutated }; break;
        }
        default: throw new Error('Unknown administration qualification operation.');
      }
      return Response.json({ value });
    } catch (error) {
      return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
    }
  },
};
