// Internal Worker qualification only. Fixture sessions, SQL races and catalogues are not product routes.
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createAccountLifecycleService } from '../../../core/identity/lifecycle.ts';
import { createAccountAdministrationService } from '../../../core/identity/administration.ts';
import { createMachineAccountService } from '../../../core/identity/machines.ts';
import { createImpersonationService } from '../../../core/identity/impersonation.ts';
import { createAuthorizationService } from '../../../core/authorization/service.ts';
import { createD1IdentityStore, ACCESS_TABLES } from '../../../core/identity/d1-store.ts';
import { issueOpaqueToken } from '../../../core/identity/tokens.ts';

const options = { permissions: [
  { id: 'example.work:read', audiences: ['admin', 'app'], actors: ['user', 'impersonated-user'] },
  { id: 'example.work:write', audiences: ['admin', 'app'], actors: ['user', 'impersonated-user'] },
  { id: 'example.work:later', audiences: ['admin', 'app'], actors: ['user', 'impersonated-user'] },
  { id: 'example.work:human', audiences: ['admin', 'app'], actors: ['user'] },
] };
const table = id => `"${ACCESS_TABLES[id]}"`;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const methods = ['start', 'check', 'stop'];

function wrapDatabase(real, beforeBatch, onFailure = () => {}) {
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
    if (entries.some(entry => !entry)) throw new Error('Untracked impersonation qualification statement.');
    await beforeBatch(entries.map(entry => entry.sql));
    try { return await real.batch(entries.map(entry => entry.statement)); }
    catch (error) { onFailure(error); throw error; }
  } };
}

function mutationStatement(db, mutation, session, input) {
  const changes = {
    epoch: [`UPDATE ${table('authorization_state')} SET epoch=epoch+1 WHERE id='application'`, []],
    'source-revoked': [`UPDATE ${table('sessions')} SET revoked_at_ms=${NOW} WHERE id=?`, [session?.id]],
    'source-expired': [`UPDATE ${table('sessions')} SET expires_at_ms=${NOW} WHERE id=?`, [session?.id]],
    'source-version': [`UPDATE ${table('principals')} SET auth_version=auth_version+1 WHERE id=?`, [session?.principalId]],
    'source-account-version': [`UPDATE ${table('human_accounts')} SET version=version+1 WHERE principal_id=?`, [session?.principalId]],
    'source-password-version': [`UPDATE ${table('password_credentials')} SET version=version+1 WHERE principal_id=?`, [session?.principalId]],
    'source-password-expired': [`UPDATE ${table('password_credentials')} SET expires_at_ms=${NOW} WHERE principal_id=?`, [session?.principalId]],
    'source-membership': [`UPDATE ${table('memberships')} SET status='disabled' WHERE principal_id=? AND context_id='application' AND audience='admin'`, [session?.principalId]],
    'subject-disabled': [`UPDATE ${table('principals')} SET status='disabled' WHERE id=?`, [input?.subjectPrincipalId]],
    'subject-version': [`UPDATE ${table('principals')} SET auth_version=auth_version+1 WHERE id=?`, [input?.subjectPrincipalId]],
    'subject-account-version': [`UPDATE ${table('human_accounts')} SET version=version+1 WHERE principal_id=?`, [input?.subjectPrincipalId]],
    'subject-password-version': [`UPDATE ${table('password_credentials')} SET version=version+1 WHERE principal_id=?`, [input?.subjectPrincipalId]],
    'subject-password-expired': [`UPDATE ${table('password_credentials')} SET expires_at_ms=${NOW} WHERE principal_id=?`, [input?.subjectPrincipalId]],
    'subject-membership': [`UPDATE ${table('memberships')} SET status='disabled' WHERE principal_id=? AND context_id=? AND audience=?`, [input?.subjectPrincipalId, input?.contextId, input?.audience]],
    'context-disabled': [`UPDATE ${table('contexts')} SET status='disabled' WHERE id=?`, [input?.contextId]],
  };
  const change = changes[mutation];
  if (!change || change[1].includes(undefined)) throw new Error('Invalid impersonation qualification race.');
  return db.prepare(change[0]).bind(...change[1]);
}

export default {
  async fetch(request, env) {
    const body = await request.json();
    try {
      let value;
      if (methods.includes(body.method)) value = await createImpersonationService(env.DB, options)[body.method](...body.args);
      else switch (body.method) {
        case 'bootstrap': {
          let databaseError;
          const db = wrapDatabase(env.DB, async () => {}, error => { databaseError = error; });
          try {
            const issued = await provisionBootstrapCapability(db);
            if (!issued) throw new Error('Fixture bootstrap provisioning failed.');
            value = await createAccountService(db).bootstrap({ ...body.args[0], token: issued.token });
          } catch (error) { throw databaseError ?? error; }
          break;
        }
        case 'login': value = await createAccountService(env.DB).login(...body.args); break;
        case 'session': value = await createAccountService(env.DB).session(...body.args); break;
        case 'issueSession': {
          // Trusted setup only; not evidence of password possession.
          const store = createD1IdentityStore(env.DB), account = await store.findPasswordAccount(body.args[0]);
          const issued = await issueOpaqueToken('session');
          const session = await store.createSessionAfterPassword(account, { sessionDigest: issued.digest, audience: body.args[1] ?? 'admin', ttlMs: 900000 });
          if (!session) throw new Error('Fixture session creation failed.');
          value = { token: issued.token, session }; break;
        }
        case 'opaqueToken': value = (await issueOpaqueToken(body.args[0])).token; break;
        case 'issueInvitation': value = await createAccountLifecycleService(env.DB, options).issueInvitation(...body.args); break;
        case 'redeem': value = await createAccountLifecycleService(env.DB, options).redeem(...body.args); break;
        case 'createService': value = await createMachineAccountService(env.DB, options).createService(...body.args); break;
        case 'readPolicy': value = await createAuthorizationService(env.DB, options).readPolicy(...body.args); break;
        case 'replacePolicy': value = await createAuthorizationService(env.DB, options).replacePolicy(...body.args); break;
        case 'nativeCheck': value = await createAuthorizationService(env.DB, options).check(...body.args); break;
        case 'listPrincipals': value = await createAccountAdministrationService(env.DB, options).listPrincipals(...body.args); break;
        case 'measured': {
          const [method, args] = body.args;
          if (!methods.includes(method)) throw new Error('Invalid measured impersonation method.');
          const batches = [];
          const db = wrapDatabase(env.DB, async sql => { batches.push({ count: sql.length, reads: sql.every(query => /^SELECT\s/i.test(query.trimStart())) }); });
          value = { result: await createImpersonationService(db, options)[method](...args), batches }; break;
        }
        case 'withRace': {
          const [args, mutation] = body.args;
          const session = await createAccountService(env.DB).session(args[0], 'admin');
          let injected = false;
          const db = wrapDatabase(env.DB, async sql => {
            if (!injected && sql.some(query => new RegExp(`INSERT\\s+INTO\\s+${table('access_audit')}`, 'i').test(query))) {
              await mutationStatement(env.DB, mutation, session, args[1]).run(); injected = true;
            }
          });
          value = { result: await createImpersonationService(db, options).start(...args), injected }; break;
        }
        case 'mutableInput': {
          const [method, args] = body.args;
          let mutated = false;
          const db = wrapDatabase(env.DB, async () => {
            if (mutated) return;
            if (method === 'start') {
              args[1].permissionIds.push('creezio.access:manage'); args[1].audience = 'admin';
              args[1].contextId = 'outside'; args[1].reason = 'Changed after validation'; args[1].ttlMs = 0;
            } else if (method === 'check') { args[1].requiredPermissionIds.length = 0; args[1].audience = 'app'; }
            else throw new Error('Invalid mutable impersonation method.');
            mutated = true;
          });
          value = { result: await createImpersonationService(db, options)[method](...args), mutated }; break;
        }
        default: throw new Error('Unknown impersonation qualification operation.');
      }
      return Response.json({ value });
    } catch (error) {
      return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
    }
  },
};
