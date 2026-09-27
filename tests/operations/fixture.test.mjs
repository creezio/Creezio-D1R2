import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationFixture } from './fixtures/identity.mjs';
import { moduleId } from './fixtures/operations.mjs';

test('operation fixture resolves native session, machine and impersonation without synthetic authority', { timeout: 15000 }, async () => {
  const fixture = await createOperationFixture();
  try {
    const target = { contextId: 'application', audience: 'admin', actors: ['user', 'machine', 'impersonated-user'],
      requiredPermissionIds: [`${moduleId}:read`], purpose: 'operation' };
    for (const [kind, credential] of Object.entries(fixture.credentials)) {
      const lease = await fixture.data.authorize(credential, target, { moduleId }), resolved = fixture.data.describeLease(lease);
      assert.equal(resolved.principalId, kind === 'machine' ? fixture.machine.principal.id : fixture.subject.principalId);
      assert.equal(resolved.actorPrincipalId, kind === 'impersonation' ? fixture.owner.principalId : resolved.principalId);
      fixture.data.dispose(lease);
    }
    await assert.rejects(fixture.data.authorize(fixture.credentials.machine, { ...target, contextId: 'other' }, { moduleId }));
    await assert.rejects(fixture.data.authorize(fixture.credentials.impersonation, { ...target, audience: 'app' }, { moduleId }));
  } finally { await fixture.dispose(); }
});
