// Internal qualification only. Never register this Worker in an application composition.
// Fixture SQL and fault injection exercise real D1; they are not product transports.
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createAccountLifecycleService } from '../../../core/identity/lifecycle.ts';
import { createD1AccountLifecycleStore } from '../../../core/identity/lifecycle-store.ts';
import { createD1IdentityStore, ACCESS_TABLES } from '../../../core/identity/d1-store.ts';
import { createD1AuthorizationStore } from '../../../core/authorization/d1-store.ts';
import { createAuthorizationService } from '../../../core/authorization/service.ts';
import { digestOpaqueToken, issueOpaqueToken } from '../../../core/identity/tokens.ts';

const options = { permissions: [{ id: 'example.notes:read', audiences: ['app'], actors: ['user'] }] };
const table = id => `"${ACCESS_TABLES[id]}"`;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const lifecycleMethods = ['issueInvitation', 'issueActivation', 'issuePasswordReset', 'revokeCapability', 'redeem'];

function mutationStatement(db, mutation, { session, capability }) {
  const changes = {
    epoch: [`UPDATE ${table('authorization_state')} SET epoch=epoch+1 WHERE id='application'`, []],
    'issuer-revoked': [`UPDATE ${table('sessions')} SET revoked_at_ms=${NOW} WHERE id=?`, [session?.id]],
    'issuer-expired': [`UPDATE ${table('sessions')} SET expires_at_ms=${NOW} WHERE id=?`, [session?.id]],
    'issuer-membership': [`UPDATE ${table('memberships')} SET status='disabled' WHERE principal_id=? AND context_id='application' AND audience='admin'`, [session?.principalId]],
    'issuer-credential': [`UPDATE ${table('password_credentials')} SET version=version+1 WHERE principal_id=?`, [session?.principalId]],
    expired: [`UPDATE ${table('account_capabilities')} SET expires_at_ms=${NOW} WHERE id=?`, [capability?.capabilityId]],
    revoked: [`UPDATE ${table('account_capabilities')} SET revoked_at_ms=${NOW} WHERE id=?`, [capability?.capabilityId]],
    principal: [`UPDATE ${table('principals')} SET status='disabled' WHERE id=?`, [capability?.principalId]],
    account: [`UPDATE ${table('human_accounts')} SET status='disabled' WHERE principal_id=?`, [capability?.principalId]],
    'principal-version': [`UPDATE ${table('principals')} SET auth_version=auth_version+1 WHERE id=?`, [capability?.principalId]],
    'account-version': [`UPDATE ${table('human_accounts')} SET version=version+1 WHERE principal_id=?`, [capability?.principalId]],
    'credential-version': [`UPDATE ${table('password_credentials')} SET version=version+1 WHERE principal_id=?`, [capability?.principalId]],
  };
  const change = changes[mutation];
  if (!change || change[1].includes(undefined)) throw new Error('Invalid lifecycle qualification race.');
  return db.prepare(change[0]).bind(...change[1]);
}

// Track query provenance ourselves instead of depending on private Miniflare statement fields.
function wrappingDatabase(real, beforeBatch) {
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
    if (entries.some(entry => !entry)) throw new Error('Untracked qualification statement.');
    await beforeBatch(entries.map(entry => entry.sql));
    return real.batch(entries.map(entry => entry.statement));
  } };
}

export default {
  async fetch(request, env) {
    const body = await request.json();
    try {
      let value;
      if (lifecycleMethods.includes(body.method)) value = await createAccountLifecycleService(env.DB, options)[body.method](...body.args);
      else switch (body.method) {
        case 'bootstrap': {
          const provisioned = await provisionBootstrapCapability(env.DB);
          if (!provisioned) throw new Error('Fixture bootstrap provisioning failed.');
          value = await createAccountService(env.DB).bootstrap({ ...body.args[0], token: provisioned.token }); break;
        }
        case 'login': value = await createAccountService(env.DB).login(...body.args); break;
        case 'session': value = await createAccountService(env.DB).session(...body.args); break;
        case 'issueSession': {
          // Trusted fixture setup only, not proof of password possession.
          const account = await createD1IdentityStore(env.DB).findPasswordAccount(body.args[0]);
          const issued = await issueOpaqueToken('session');
          const session = await createD1IdentityStore(env.DB).createSessionAfterPassword(account, {
            sessionDigest: issued.digest, audience: body.args[1], ttlMs: 60000,
          });
          if (!session) throw new Error('Fixture session creation failed.');
          value = { token: issued.token, session }; break;
        }
        case 'check': value = await createAuthorizationService(env.DB, options).check(...body.args); break;
        case 'readPolicy': value = await createAuthorizationService(env.DB, options).readPolicy(...body.args); break;
        case 'replacePolicy': value = await createAuthorizationService(env.DB, options).replacePolicy(...body.args); break;
        case 'readCapability': {
          const digest = await digestOpaqueToken(body.args[0], body.args[1]);
          value = digest ? await createD1AccountLifecycleStore(env.DB).readCapability(digest, body.args[1]) : null; break;
        }
        case 'staleRevoke': {
          // Internal guard replay fixture; the store itself is not an authorization endpoint.
          const [token, capabilityId] = body.args, digest = await digestOpaqueToken(token, 'session');
          const snapshot = await createD1AuthorizationStore(env.DB).read(digest, 'admin');
          const guard = { sessionDigest: digest, sessionId: snapshot.session.id, principalId: snapshot.session.principalId, epoch: snapshot.epoch - 1 };
          value = await createD1AccountLifecycleStore(env.DB).revokeCapability(guard, capabilityId); break;
        }
        case 'withRace': {
          const [method, args, mutation, capability] = body.args;
          if (!lifecycleMethods.includes(method)) throw new Error('Invalid lifecycle fixture method.');
          const session = method === 'redeem' ? null : await createAccountService(env.DB).session(args[0], 'admin');
          let injected = false, batches = 0;
          const db = wrappingDatabase(env.DB, async sql => {
            batches++;
            // Throttle and authorization reads are not commit points. Intercept the actual capability mutation batch.
            if (!injected && sql.length > 2 && sql.some(query => /(?:INSERT|UPDATE)\s/i.test(query)
              && query.includes(table('account_capabilities')))) {
              await mutationStatement(env.DB, mutation, { session, capability }).run(); injected = true;
            }
          });
          const result = await createAccountLifecycleService(db, options)[method](...args);
          value = { result, injected, batches }; break;
        }
        case 'redeemMutableInput': {
          const input = body.args[0]; let mutated = false;
          const db = wrappingDatabase(env.DB, async () => {
            if (!mutated) {
              input.password = 'Attacker replacement must not be persisted';
              input.purpose = 'password-reset'; input.token = 'malformed'; mutated = true;
            }
          });
          value = { result: await createAccountLifecycleService(db, options).redeem(input), mutated }; break;
        }
        default: throw new Error('Unknown lifecycle qualification operation.');
      }
      return Response.json({ value });
    } catch (error) {
      return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
    }
  },
};
