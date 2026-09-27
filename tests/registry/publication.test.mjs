import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationGate } from '../../core/registry/publication.ts';
import { RegistryClientError } from '../../core/registry/client.ts';

const artifact = Object.freeze({ sourceSha: 'a'.repeat(40), artifactDigest: `sha256-${'b'.repeat(64)}`,
  coreVersion: '1.0.0', contractVersion: '1', compositionDigest: `sha256-${'c'.repeat(64)}` });
const request = Object.freeze({ projectId: 'project-1', installationId: 'installation-1',
  target: 'cloudflare', artifact });
const preflight = Object.freeze({ preflightId: 'preflight-1', projectId: request.projectId,
  installationId: request.installationId, checkedAt: '2026-09-27T02:00:00.000Z',
  expiresAt: '2026-09-27T02:10:00.000Z' });
const receipt = Object.freeze({ deploymentId: 'deployment-1', url: 'https://app.example/',
  artifact, publishedSha: 'd'.repeat(40) });
const declared = Object.freeze({ projectId: request.projectId, installationId: request.installationId,
  deploymentId: receipt.deploymentId, declaredAt: '2026-09-27T02:02:00.000Z', replayed: false });

function journal() {
  const records = new Map();
  return { records,
    async get(key) { return records.get(key) ?? null; },
    async claim(record) { const existing = records.get(record.requestKey); if (existing) return existing;
      records.set(record.requestKey, record); return null; },
    async saveDelivered(record) { assert.equal(records.get(record.requestKey)?.state, 'prepared');
      records.set(record.requestKey, record); },
    async saveSynchronized(record) { assert.equal(records.get(record.requestKey)?.state, 'delivered');
      records.set(record.requestKey, record); }
  };
}
function gate(client, storage = journal()) {
  return { storage, value: createPublicationGate({ client, journal: storage,
    now: () => Date.parse(preflight.checkedAt) + 1000 }) };
}

test('preflight refusal or registry outage blocks new delivery without invoking publisher', async () => {
  for (const code of ['authentication_required', 'forbidden', 'unavailable']) {
    let delivered = 0;
    const { value, storage } = gate({ preflight: async () => { throw new RegistryClientError(code); },
      declare: async () => declared });
    const result = await value.publish(request, `request-${code}`, async () => { delivered++; return receipt; });
    assert.deepEqual(result, { state: 'blocked', reason: code });
    assert.equal(delivered, 0); assert.equal(storage.records.size, 0);
  }
});

test('successful delivery is journaled before declaration; outage stays pending and retry never republishes', async () => {
  let deliveryCalls = 0, declarationCalls = 0, unavailable = true;
  const { value, storage } = gate({ preflight: async () => preflight,
    declare: async declaration => { declarationCalls++;
      assert.equal(declaration.requestKey, 'request-1');
      assert.deepEqual(declaration.artifact, artifact);
      if (unavailable) throw new Error('offline');
      return declared;
    } });
  const first = await value.publish(request, 'request-1', async () => { deliveryCalls++; return receipt; });
  assert.equal(first.state, 'declaration_pending');
  assert.equal(first.record.state, 'delivered');
  assert.equal(storage.records.get('request-1').state, 'delivered');
  assert.equal(deliveryCalls, 1);
  unavailable = false;
  const second = await value.publish(request, 'request-1', async () => { deliveryCalls++; throw new Error('must not run'); });
  assert.equal(second.state, 'synchronized');
  assert.equal(second.record.result.replayed, false);
  assert.equal(deliveryCalls, 1); assert.equal(declarationCalls, 2);
  assert.equal((await value.reconcile('request-1')).state, 'synchronized');
  assert.equal(declarationCalls, 2);
});

test('unknown delivery outcome requires inspection; verified receipt can be confirmed without republishing', async () => {
  let deliveries = 0;
  const { value, storage } = gate({ preflight: async () => preflight, declare: async () => declared });
  const first = await value.publish(request, 'request-2', async () => { deliveries++; throw new Error('lost delivery response'); });
  assert.equal(first.state, 'delivery_unknown');
  assert.equal(storage.records.get('request-2').state, 'prepared');
  assert.equal((await value.publish(request, 'request-2', async () => { deliveries++; return receipt; })).state,
    'requires_inspection');
  assert.equal(deliveries, 1);
  assert.equal((await value.reconcile('request-2')).state, 'requires_inspection');
  assert.equal((await value.confirmDelivered('request-2', receipt)).state, 'synchronized');
  assert.equal(deliveries, 1);
});

test('artifact or installation mismatch is refused and never declared under a prior preflight', async () => {
  let declarations = 0;
  const { value, storage } = gate({ preflight: async () => preflight,
    declare: async () => { declarations++; return declared; } });
  const different = { ...artifact, artifactDigest: `sha256-${'e'.repeat(64)}` };
  const result = await value.publish(request, 'request-3', async () => ({ ...receipt, artifact: different }));
  assert.equal(result.state, 'delivery_unknown');
  assert.equal(declarations, 0);
  assert.equal(storage.records.get('request-3').state, 'prepared');
  await assert.rejects(value.publish({ ...request, installationId: 'installation-2' }, 'request-3',
    async () => receipt), { code: 'invalid_input' });
  await assert.rejects(value.confirmDelivered('request-3', { ...receipt, artifact: different }),
    { code: 'invalid_input' });
});

test('expired preflight and failed durable claim block delivery; failed journal update exposes receipt for recovery', async () => {
  let deliveryCalls = 0;
  const old = { ...preflight, expiresAt: preflight.checkedAt };
  const blocked = gate({ preflight: async () => old, declare: async () => declared });
  assert.equal((await blocked.value.publish(request, 'request-old', async () => { deliveryCalls++; return receipt; })).state,
    'blocked');
  assert.equal(deliveryCalls, 0);

  const storage = journal();
  storage.claim = async () => { throw new Error('disk unavailable'); };
  const broken = gate({ preflight: async () => preflight, declare: async () => declared }, storage);
  assert.equal((await broken.value.publish(request, 'request-disk', async () => { deliveryCalls++; return receipt; })).state,
    'blocked');
  assert.equal(deliveryCalls, 0);

  const recoverable = journal();
  recoverable.saveDelivered = async () => { throw new Error('disk full'); };
  const gateValue = gate({ preflight: async () => preflight, declare: async () => declared }, recoverable).value;
  const result = await gateValue.publish(request, 'request-recover', async () => { deliveryCalls++; return receipt; });
  assert.equal(result.state, 'delivered_unjournaled');
  assert.equal(result.declaration.deploymentId, receipt.deploymentId);
  assert.equal(recoverable.records.get('request-recover').state, 'prepared');
  recoverable.saveDelivered = async record => { recoverable.records.set(record.requestKey, record); };
  assert.equal((await gateValue.confirmDelivered('request-recover', receipt)).state, 'synchronized');
  assert.equal(deliveryCalls, 1);
});

test('a preflight expiring while the durable claim runs never reaches the publisher', async () => {
  let current = Date.parse(preflight.checkedAt) + 1000, deliveries = 0;
  const storage = journal(), originalClaim = storage.claim.bind(storage);
  storage.claim = async record => { const result = await originalClaim(record);
    current = Date.parse(preflight.expiresAt) + 1; return result; };
  const value = createPublicationGate({ client: { preflight: async () => preflight, declare: async () => declared },
    journal: storage, now: () => current });
  assert.deepEqual(await value.publish(request, 'request-expiring', async () => { deliveries++; return receipt; }),
    { state: 'blocked', reason: 'expired_preflight' });
  assert.equal(deliveries, 0);
  assert.equal(storage.records.get('request-expiring').state, 'prepared');
  assert.equal((await value.publish(request, 'request-expiring', async () => { deliveries++; return receipt; })).state,
    'requires_inspection');
  assert.equal(deliveries, 0);
});

test('explicit local loopback delivery survives journal restoration for declaration retry', async () => {
  const storage = journal(); let calls = 0;
  const value = createPublicationGate({ client: { preflight: async () => preflight,
    declare: async () => { if (++calls === 1) throw new Error('offline'); return declared; } },
    journal: storage, allowLoopbackDelivery: true,
    now: () => Date.parse(preflight.checkedAt) + 1000 });
  const local = { ...receipt, url: 'http://127.0.0.1:8787/' };
  assert.equal((await value.publish(request, 'request-local', async () => local)).state, 'declaration_pending');
  assert.equal((await value.reconcile('request-local')).state, 'synchronized');
});
