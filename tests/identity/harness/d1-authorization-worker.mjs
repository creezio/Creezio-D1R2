// Internal qualification only: never registered in the application's composition.
// Server-owned catalogue and SQL fault injection are fixtures, not caller APIs.
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createD1IdentityStore, ACCESS_TABLES } from '../../../core/identity/d1-store.ts';
import { digestOpaqueToken, issueOpaqueToken } from '../../../core/identity/tokens.ts';
import { createD1AuthorizationStore } from '../../../core/authorization/d1-store.ts';
import { createAuthorizationService } from '../../../core/authorization/service.ts';

const permissions = [
  { id: 'example.notes:read', audiences: ['admin', 'app'], actors: ['user'] },
  { id: 'example.notes:write', audiences: ['app'], actors: ['user'] },
];
const table = id => `"${ACCESS_TABLES[id]}"`;
const NOW = "(CAST(unixepoch('now') AS INTEGER) * 1000)";

export default {
  async fetch(request, env) {
    const body = await request.json();
    try {
      let value;
      switch (body.method) {
        case 'bootstrap': {
          const provisioned = await provisionBootstrapCapability(env.DB);
          if (!provisioned) throw new Error('Fixture bootstrap provisioning failed.');
          value = await createAccountService(env.DB).bootstrap({ ...body.args[0], token: provisioned.token });
          break;
        }
        case 'login': value = await createAccountService(env.DB).login(...body.args); break;
        case 'issueSession': {
          // Trusted fixture setup, not a login operation or proof of password possession.
          const issued = await issueOpaqueToken('session');
          const store = createD1IdentityStore(env.DB);
          const account = await store.findPasswordAccount(body.args[0]);
          const session = await store.createSessionAfterPassword(account, { sessionDigest: issued.digest, audience: body.args[1], ttlMs: 60000 });
          if (!session) throw new Error('Fixture session creation failed.');
          value = { token: issued.token, session };
          break;
        }
        case 'check': value = await createAuthorizationService(env.DB, { permissions }).check(...body.args); break;
        case 'readPolicy': value = await createAuthorizationService(env.DB, { permissions }).readPolicy(...body.args); break;
        case 'replacePolicy': value = await createAuthorizationService(env.DB, { permissions }).replacePolicy(...body.args); break;
        case 'commitStore': {
          // Exercises the internal stale-claim guard, not a permission-bearing API.
          const session = await createAccountService(env.DB).session(body.args[0], 'admin');
          if (!session) throw new Error('Fixture commit requires a live session.');
          value = await createD1AuthorizationStore(env.DB).commitPolicy({
            sessionDigest: await digestOpaqueToken(body.args[0], 'session'), sessionId: session.id,
            principalId: session.principalId, epoch: body.args[1].epoch, policy: body.args[1].policy,
            beforePolicy: body.args[1].beforePolicy,
          });
          break;
        }
        case 'readStore': {
          let batches = 0;
          const db = { prepare: sql => env.DB.prepare(sql), batch: async statements => { batches++; return env.DB.batch(statements); } };
          const snapshot = await createD1AuthorizationStore(db).read(await digestOpaqueToken(body.args[0], 'session'), body.args[1]);
          value = { batches, snapshot };
          break;
        }
        case 'replaceWithRace': {
          const [token, input, mutation] = body.args;
          const session = await createAccountService(env.DB).session(token, 'admin');
          if (!session) throw new Error('Fixture race requires a live admin session.');
          let batches = 0, injected = false;
          const db = {
            prepare: sql => env.DB.prepare(sql),
            batch: async statements => {
              batches++;
              if (batches === 2) {
                const changes = {
                  epoch: [`UPDATE ${table('authorization_state')} SET epoch=epoch+1 WHERE id='application'`, []],
                  revoked: [`UPDATE ${table('sessions')} SET revoked_at_ms=${NOW} WHERE id=?`, [session.id]],
                  'session-expired': [`UPDATE ${table('sessions')} SET expires_at_ms=${NOW} WHERE id=?`, [session.id]],
                  principal: [`UPDATE ${table('principals')} SET status='disabled' WHERE id=?`, [session.principalId]],
                  'principal-version': [`UPDATE ${table('principals')} SET auth_version=auth_version+1 WHERE id=?`, [session.principalId]],
                  account: [`UPDATE ${table('human_accounts')} SET status='disabled' WHERE principal_id=?`, [session.principalId]],
                  'account-version': [`UPDATE ${table('human_accounts')} SET version=version+1 WHERE principal_id=?`, [session.principalId]],
                  credential: [`UPDATE ${table('password_credentials')} SET version=version+1 WHERE principal_id=?`, [session.principalId]],
                  'credential-expired': [`UPDATE ${table('password_credentials')} SET expires_at_ms=${NOW} WHERE principal_id=?`, [session.principalId]],
                  context: [`UPDATE ${table('contexts')} SET status='disabled' WHERE id='application'`, []],
                  membership: [`UPDATE ${table('memberships')} SET status='disabled' WHERE principal_id=? AND context_id='application' AND audience='admin'`, [session.principalId]],
                };
                const change = changes[mutation];
                if (!change) throw new Error('Unknown qualification race.');
                await env.DB.prepare(change[0]).bind(...change[1]).run();
                injected = true;
              }
              return env.DB.batch(statements);
            },
          };
          const result = await createAuthorizationService(db, { permissions }).replacePolicy(token, input);
          value = { result, batches, injected };
          break;
        }
        default: throw new Error('Unknown authorization qualification operation.');
      }
      return Response.json({ value });
    } catch (error) {
      return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
    }
  },
};
