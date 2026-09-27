import '../../../scripts/local-environment.mjs';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { loadAccessInstallPlan } from '../../../scripts/data/install-access.mjs';
import { compileCompositionSchema } from '../../../scripts/data/composition-schema.mjs';
import { createAccountService, provisionBootstrapCapability } from '../../../core/identity/accounts.ts';
import { createAccountLifecycleService } from '../../../core/identity/lifecycle.ts';
import { createMachineAccountService } from '../../../core/identity/machines.ts';
import { createImpersonationService } from '../../../core/identity/impersonation.ts';
import { createAuthorizationService } from '../../../core/authorization/service.ts';
import { createDataAccess } from '../../../core/data/service.ts';
import { ACCESS_TABLES } from '../../../core/identity/d1-store.ts';
import { moduleId, permissions, operationComposition } from './operations.mjs';

const good = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result; };
export const dataSchema = compileCompositionSchema(operationComposition());
export const catalog = dataSchema.runtimeCatalog;
export const recordTable = catalog.modules[0].models.find(model => model.modelId === 'record').table;
export const quote = value => `"${value.replaceAll('"', '""')}"`;

/** Only real native credentials and D1 policy state. Extra CREATE statements belong to the host engine. */
export async function createOperationFixture({ statements = [], onStep = () => {}, script = 'export default {fetch(){return new Response(null,{status:404})}}' } = {}) {
  const runtime = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true, compatibilityDate: '2026-05-15',
    script, d1Databases: { DB: 'creezio-operation-qualification' }, d1Persist: false });
  try {
    onStep('database');
    const db = await runtime.getD1Database('DB');
    onStep('schema');
    await db.batch([...loadAccessInstallPlan().statements, ...dataSchema.statements, ...statements].map(sql => db.prepare(sql)));
    const accounts = createAccountService(db), capability = await provisionBootstrapCapability(db);
    onStep('owner');
    const password = 'Synthetic operation qualification password';
    const owner = good(await accounts.bootstrap({ token: capability.token, loginIdentifier: 'operations-owner@example.invalid', displayName: 'Operation owner', password }));
    const ownerSession = good(await accounts.login({ loginIdentifier: 'operations-owner@example.invalid', password, audience: 'admin' }));
    const lifecycle = createAccountLifecycleService(db, { permissions });
    onStep('subject');
    const invitation = good(await lifecycle.issueInvitation(ownerSession.token, { loginIdentifier: 'operations-subject@example.invalid', displayName: 'Operation subject' }));
    const subject = good(await lifecycle.redeem({ token: invitation.token, purpose: 'invitation', password }));
    const subjectSession = good(await accounts.login({ loginIdentifier: 'operations-subject@example.invalid', password, audience: 'admin' }));
    const machines = createMachineAccountService(db, { permissions });
    onStep('machine');
    const machine = good(await machines.createService(ownerSession.token, { displayName: 'Operation machine' }));
    const authorization = createAuthorizationService(db, { permissions }), current = good(await authorization.readPolicy(ownerSession.token));
    const policy = structuredClone(current.policy), basePermissions = permissions.filter(p => !p.id.endsWith(':approve')).map(p => p.id);
    policy.roles.find(role => role.id === 'administrator').permissionIds.push('creezio.access:impersonate');
    policy.roles.push({ id: 'operation-user', inherits: [], permissionIds: basePermissions, permissionOverrides: [] });
    policy.contexts.push({ id: 'other', status: 'active' });
    for (const principalId of [owner.principalId, subject.principalId, machine.principal.id]) for (const contextId of ['application', 'other']) for (const audience of ['admin', 'app']) {
      if (!policy.memberships.some(member => member.principalId === principalId && member.contextId === contextId && member.audience === audience))
        policy.memberships.push({ principalId, contextId, audience, status: 'active' });
      policy.assignments.push({ principalId, contextId, audience, roleId: 'operation-user' });
    }
    good(await authorization.replacePolicy(ownerSession.token, { expectedEpoch: current.epoch, policy }));
    onStep('credentials');
    const issued = good(await machines.issueToken(ownerSession.token, { principalId: machine.principal.id, label: 'Operation fixture token', ttlMs: 600_000,
      scopes: [{ contextId: 'application', audience: 'admin', permissionIds: basePermissions },
        { contextId: 'other', audience: 'app', permissionIds: [`${moduleId}:read`] }] }));
    const impersonation = createImpersonationService(db, { permissions });
    const impersonated = good(await impersonation.start(ownerSession.token, { subjectPrincipalId: subject.principalId, contextId: 'application', audience: 'admin',
      permissionIds: basePermissions, reason: 'Synthetic operation qualification', ttlMs: 600_000 }));
    const credentials = Object.freeze({ session: Object.freeze({ kind: 'session', token: subjectSession.token }),
      machine: Object.freeze({ kind: 'api-token', token: issued.token }), impersonation: Object.freeze({ kind: 'impersonation', token: impersonated.token }) });
    const createData = (database = db) => createDataAccess(database, { catalog, permissions });
    const data = createData();
    onStep('ready');
    return { runtime, db, catalog, data, credentials, owner, subject, machine, ownerSession, subjectSession, issued, impersonated,
      accounts, machines, impersonation, authorization, createData,
      async revoke(kind) {
        if (kind === 'session') await accounts.logout(subjectSession.token, 'admin');
        else if (kind === 'machine') good(await machines.revokeToken(ownerSession.token, { credentialId: issued.credential.id }));
        else if (kind === 'impersonation') good(await impersonation.stop(impersonated.token));
        else throw new Error('Unknown synthetic credential.');
      },
      async bumpEpoch() { await db.prepare(`UPDATE ${quote(ACCESS_TABLES.authorization_state)} SET epoch=epoch+1`).run(); },
      async countRecords() { return (await db.prepare(`SELECT count(*) AS n FROM ${quote(recordTable)}`).first()).n; },
      async record(id, contextId = 'application') { return db.prepare(`SELECT * FROM ${quote(recordTable)} WHERE context_id=? AND id=?`).bind(contextId, id).first(); },
      dispose: () => runtime.dispose(),
    };
  } catch (error) { await runtime.dispose(); throw error; }
}
