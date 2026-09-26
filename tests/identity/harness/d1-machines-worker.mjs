// Internal Worker qualification only, never an application route or composition entry.
// The catalogue, direct SQL races and fixture session creation are server-owned test setup.
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createMachineAccountService } from '../../../core/identity/machines.ts';
import { createD1IdentityStore, ACCESS_TABLES } from '../../../core/identity/d1-store.ts';
import { createAuthorizationService } from '../../../core/authorization/service.ts';
import { createD1AuthorizationStore } from '../../../core/authorization/d1-store.ts';
import { digestOpaqueToken, issueOpaqueToken } from '../../../core/identity/tokens.ts';

const options = { permissions: [
  { id: 'example.jobs:read', audiences: ['admin', 'app'], actors: ['user', 'machine'] },
  { id: 'example.jobs:write', audiences: ['admin', 'app'], actors: ['user', 'machine'] },
  { id: 'example.jobs:human', audiences: ['admin', 'app'], actors: ['user'] },
] };
const table = id => `"${ACCESS_TABLES[id]}"`;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";
const machineMethods = ['createService', 'setServiceStatus', 'issueToken', 'rotateToken', 'revokeToken', 'check'];

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
    if (entries.some(entry => !entry)) throw new Error('Untracked machine qualification statement.');
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
    'subject-disabled': [`UPDATE ${table('principals')} SET status='disabled',auth_version=auth_version+1 WHERE id=?`, [subject?.principalId]],
    'subject-version': [`UPDATE ${table('principals')} SET auth_version=auth_version+1 WHERE id=?`, [subject?.principalId]],
    'credential-revoked': [`UPDATE ${table('api_credentials')} SET revoked_at_ms=${NOW} WHERE id=?`, [subject?.credentialId]],
    'credential-expired': [`UPDATE ${table('api_credentials')} SET expires_at_ms=${NOW} WHERE id=?`, [subject?.credentialId]],
  };
  const change = changes[mutation];
  if (!change || change[1].includes(undefined)) throw new Error('Invalid machine qualification race.');
  return db.prepare(change[0]).bind(...change[1]);
}

export default {
  async fetch(request, env) {
    const body = await request.json();
    try {
      let value;
      if (machineMethods.includes(body.method)) value = await createMachineAccountService(env.DB, options)[body.method](...body.args);
      else switch (body.method) {
        case 'bootstrap': {
          const provisioned = await provisionBootstrapCapability(env.DB);
          if (!provisioned) throw new Error('Fixture bootstrap provisioning failed.');
          value = await createAccountService(env.DB).bootstrap({ ...body.args[0], token: provisioned.token }); break;
        }
        case 'login': value = await createAccountService(env.DB).login(...body.args); break;
        case 'session': value = await createAccountService(env.DB).session(...body.args); break;
        case 'issueSession': {
          // Trusted setup only; this does not qualify login/password verification.
          const store = createD1IdentityStore(env.DB), account = await store.findPasswordAccount(body.args[0]);
          const issued = await issueOpaqueToken('session');
          const session = await store.createSessionAfterPassword(account, { sessionDigest: issued.digest, audience: 'admin', ttlMs: 60000 });
          if (!session) throw new Error('Fixture session creation failed.');
          value = { token: issued.token, session }; break;
        }
        case 'readPolicy': value = await createAuthorizationService(env.DB, options).readPolicy(...body.args); break;
        case 'replacePolicy': value = await createAuthorizationService(env.DB, options).replacePolicy(...body.args); break;
        case 'checkMeasured': {
          let batches = 0;
          const db = wrappingDatabase(env.DB, async () => { batches++; });
          value = { decision: await createMachineAccountService(db, options).check(...body.args), batches }; break;
        }
        case 'readMachine': {
          let batches = 0;
          const db = wrappingDatabase(env.DB, async () => { batches++; });
          value = { snapshot: await createD1AuthorizationStore(db).readMachine(await digestOpaqueToken(body.args[0], 'api-token'), body.args[1], body.args[2]), batches };
          break;
        }
        case 'withRace': {
          const [method, args, mutation, subject] = body.args;
          if (!machineMethods.includes(method) || method === 'check') throw new Error('Invalid machine fixture method.');
          const session = await createAccountService(env.DB).session(args[0], 'admin');
          let injected = false, batches = 0;
          const db = wrappingDatabase(env.DB, async sql => {
            batches++;
            if (!injected && sql.some(query => new RegExp(`INSERT\\s+INTO\\s+${table('access_audit')}`, 'i').test(query))) {
              await mutationStatement(env.DB, mutation, session, subject).run(); injected = true;
            }
          });
          const result = await createMachineAccountService(db, options)[method](...args);
          value = { result, injected, batches }; break;
        }
        case 'issueMutableInput': {
          const [token, input] = body.args; let mutated = false;
          const db = wrappingDatabase(env.DB, async () => {
            if (!mutated) {
              input.scopes[0].audience = 'admin'; input.scopes[0].permissionIds.push('creezio.access:manage');
              input.scopes.push({ contextId: 'outside', audience: 'app', permissionIds: ['example.jobs:write'] });
              input.label = 'Unvalidated mutation'; input.ttlMs = 0; mutated = true;
            }
          });
          value = { result: await createMachineAccountService(db, options).issueToken(token, input), mutated }; break;
        }
        case 'checkMutableTarget': {
          const [token, input] = body.args; let mutated = false;
          const db = wrappingDatabase(env.DB, async () => {
            if (!mutated) { input.requiredPermissionIds.length = 0; input.audience = 'app'; mutated = true; }
          });
          value = { decision: await createMachineAccountService(db, options).check(token, input), mutated }; break;
        }
        case 'digest': value = await digestOpaqueToken(...body.args); break;
        default: throw new Error('Unknown machine qualification operation.');
      }
      return Response.json({ value });
    } catch (error) {
      return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
    }
  },
};
