// Qualification only. Never included in application routes or module composition.
import { createDataAccess } from '../../../core/data/service.ts';
import { createVaultKeyring, createVaultReference } from '../../../core/vault/crypto.ts';

export default {
  async fetch(request, env) {
    const { token } = await request.json();
    const data = createDataAccess(env.DB, { catalog: env.CATALOG, permissions: env.PERMISSIONS });
    const lease = await data.authorize({ kind: 'session', token }, {
      contextId: 'context-x', audience: 'admin', actors: ['user'],
      requiredPermissionIds: ['example.data:manage-records'], purpose: 'operation',
    }, { moduleId: 'example.data' });
    const record = await data.forModule(lease, 'example.data').get('record', { key: { id: 'shared-id' } });
    const keys = createVaultKeyring({ activeKeyId: 'synthetic', keys: { synthetic: new Uint8Array(32).fill(42) } });
    const context = { moduleId: 'example.data', contextId: 'context-x', bindingId: 'synthetic-connection', reference: createVaultReference(), version: 1 };
    const plaintext = 'Synthetic workerd secret';
    const envelope = await keys.seal(context, plaintext);
    const roundtrip = await keys.open(context, envelope) === plaintext;
    let wrongContextRefused = false;
    try { await keys.open({ ...context, contextId: 'context-y' }, envelope); }
    catch { wrongContextRefused = true; }
    data.dispose(lease);
    return Response.json({ title: record.title, roundtrip, wrongContextRefused,
      plaintextAbsentFromEnvelope: !envelope.includes(plaintext) });
  },
};
