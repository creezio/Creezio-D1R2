import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { createVaultKeyring, createVaultReference, isVaultReference, VAULT_CRYPTO_POLICY } from '../../core/vault/crypto.ts';

const synthetic = 'qualification only — synthetic connector key';
const raw = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const context = () => ({ moduleId: 'example.settings', contextId: 'application', bindingId: 'connection-test', reference: createVaultReference(), version: 1 });

test('vault AES-256-GCM envelope independently decrypts with Node and binds its exact context', async () => {
  const ring = createVaultKeyring({ activeKeyId: 'test-2026', keys: { 'test-2026': raw } });
  const c = context(), envelope = await ring.seal(c, synthetic);
  assert.equal(VAULT_CRYPTO_POLICY.keyBytes, 32); assert.equal(VAULT_CRYPTO_POLICY.ivBytes, 12);
  assert.equal(VAULT_CRYPTO_POLICY.tagBits, 128);
  const [format, keyId, iv, encoded] = envelope.split('.');
  assert.equal(format, 'czv1'); assert.equal(keyId, 'test-2026');
  const encrypted = Buffer.from(encoded, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', raw, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(JSON.stringify(['creezio:vault:1', c.moduleId, c.contextId, c.bindingId, c.reference, c.version])));
  decipher.setAuthTag(encrypted.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'), synthetic);
  assert.equal(await ring.open(c, envelope), synthetic);
  for (const altered of [{ ...c, moduleId: 'other.settings' }, { ...c, contextId: 'other' },
    { ...c, reference: createVaultReference() }, { ...c, version: 2 }, { ...c, bindingId: 'other-connection' }])
    await assert.rejects(ring.open(altered, envelope), error => error.code === 'unreadable' && !error.message.includes(synthetic));
});

test('key rotation is explicit, old keys only read old envelopes, absent keys never fall back', async () => {
  const c = context(), old = createVaultKeyring({ activeKeyId: 'old', keys: { old: raw } });
  const envelope = await old.seal(c, synthetic);
  const rotated = createVaultKeyring({ activeKeyId: 'current', keys: { old: raw, current: new Uint8Array(32).fill(7) } });
  assert.equal(await rotated.open(c, envelope), synthetic);
  assert.match(await rotated.seal(c, synthetic), /^czv1\.current\./);
  const retired = createVaultKeyring({ activeKeyId: 'current', keys: { current: new Uint8Array(32).fill(7) } });
  await assert.rejects(retired.open(c, envelope), { code: 'unreadable' });
  await assert.rejects(rotated.open(c, envelope.replace('.old.', '.current.')), { code: 'unreadable' });
  for (const input of [{ activeKeyId: 'missing', keys: {} }, { activeKeyId: 'bad', keys: { bad: new Uint8Array(31) } },
    { activeKeyId: 'bad', keys: { bad: 'fallback password' } }]) assert.throws(() => createVaultKeyring(input), { code: 'unavailable' });
});

test('vault inputs are captured before awaits, envelopes are randomized and references confer no identity', async () => {
  const mutableKey = new Uint8Array(raw), input = { activeKeyId: 'initial', keys: { initial: mutableKey } };
  const ring = createVaultKeyring(input); mutableKey.fill(0); input.activeKeyId = 'changed';
  const c = context(), preserved = { ...c }, pending = ring.seal(c, synthetic); c.contextId = 'changed';
  const first = await pending, second = await ring.seal(preserved, synthetic);
  assert.notEqual(first, second); assert.equal(await ring.open(preserved, first), synthetic);
  assert.equal(isVaultReference(preserved.reference), true);
  assert.equal(isVaultReference(preserved.reference + '\n'), false);
  assert.equal(first.includes(synthetic), false);
  assert.equal(Object.isFrozen(ring), true);
});

test('malformed, oversized and tampered envelopes fail without exposing plaintext or key bytes', async () => {
  const ring = createVaultKeyring({ activeKeyId: 'test', keys: { test: raw } }), c = context();
  const envelope = await ring.seal(c, synthetic), parts = envelope.split('.');
  const ciphertext = Buffer.from(parts[3], 'base64url'); ciphertext[0] ^= 1;
  const invalid = ['', 'czv2.test.a.b', `${envelope}.extra`, envelope.replace(parts[2], parts[2] + '='),
    `${parts.slice(0, 3).join('.')}.${ciphertext.toString('base64url')}`, 'x'.repeat(23_001)];
  for (const value of invalid) await assert.rejects(ring.open(c, value), error => error.code === 'unreadable' && (!value.length || !error.message.includes(value)));
  for (const value of ['', 'x'.repeat(16_385), 'é'.repeat(8193), '\ud800']) await assert.rejects(ring.seal(c, value), { code: 'invalid_input' });
  const accessor = { ...c }; Object.defineProperty(accessor, 'contextId', { get() { throw new Error('getter executed'); } });
  await assert.rejects(ring.seal(accessor, synthetic), { code: 'invalid_input' });
});
