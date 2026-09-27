import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultService } from '../../core/vault/service.ts';
import { createVaultKeyring } from '../../core/vault/crypto.ts';
import { createStorageFixture, moduleId, table } from './fixtures/storage.mjs';

const initialKey = new Uint8Array(32).fill(31), currentKey = new Uint8Array(32).fill(73);
const initial = () => createVaultKeyring({ activeKeyId: 'initial', keys: { initial: initialKey } });
const rotated = () => createVaultKeyring({ activeKeyId: 'current', keys: { initial: initialKey, current: currentKey } });
const secret = 'Synthetic vault storage qualification value';
const bindingId = 'provider-example';
const input = reference => ({ reference, bindingId });

test('protected vault records use real D1, explicit binding and fresh authorization', async t => {
  const f = await createStorageFixture();
  const service = (keyring = initial()) => createVaultService({ data: f.data, catalog: f.catalog, storage: f.vaultStorage, keyring });
  const stored = reference => f.db.prepare(`SELECT * FROM ${table('secret_metadata')} WHERE context_id=? AND id=?`).bind('application', reference).first();
  try {
    let reference;
    await t.test('only encrypted data is persisted; metadata and normal data ports expose no plaintext', async () => {
      const lease = await f.lease(), vault = service(), metadata = await vault.put(lease, { secret, bindingId });
      reference = metadata.reference;
      assert.deepEqual(Object.keys(metadata).sort(), ['reference', 'state', 'version']);
      assert.deepEqual(await vault.metadata(lease, reference), metadata);
      const row = await stored(reference);
      assert.equal(JSON.stringify(row).includes(secret), false);
      assert.match(row.ciphertext, /^czv1\.initial\./);
      assert.equal(row.binding_id, bindingId);
      const normal = f.data.forModule(lease, moduleId);
      await assert.rejects(normal.get('secret_metadata', { key: { id: reference }, fields: ['ciphertext'] }));
      assert.equal(await vault.useSecret(lease, input(reference), value => value === secret), true);
      // Reconstruct the service: resolution depends on persisted records, not a process-local reference map.
      assert.equal(await service().useSecret(lease, input(reference), value => value === secret), true);
    });
    await t.test('references cannot cross contexts or connection bindings', async () => {
      const vault = service(); let called = false;
      assert.equal(await vault.metadata(await f.lease('other'), reference), null);
      await assert.rejects(vault.useSecret(await f.lease('other'), input(reference), () => { called = true; }));
      await assert.rejects(vault.useSecret(await f.lease(), { reference, bindingId: 'other-provider' }, () => { called = true; }), { code: 'unreadable' });
      assert.equal(called, false);
      const row = await stored(reference);
      await f.db.prepare(`INSERT INTO ${table('secret_metadata')} (context_id,id,binding_id,ciphertext,key_id,version,state) VALUES(?,?,?,?,?,?,?)`)
        .bind('other', reference, bindingId, row.ciphertext, row.key_id, row.version, row.state).run();
      await assert.rejects(vault.useSecret(await f.lease('other'), input(reference), () => { called = true; }), { code: 'unreadable' });
      assert.equal(called, false);
    });
    await t.test('replacement is versioned and concurrent replacements have exactly one winner', async () => {
      const vault = service(), lease = await f.lease();
      const results = await Promise.allSettled(['replacement A', 'replacement B'].map(value => vault.replace(lease,
        { ...input(reference), expectedVersion: 1, secret: value })));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter(r => r.status === 'rejected').length, 1);
      assert.equal((await stored(reference)).version, 2);
      await assert.rejects(vault.replace(lease, { ...input(reference), expectedVersion: 1, secret: 'stale replacement' }));
      assert.equal(await vault.useSecret(lease, input(reference), value => ['replacement A', 'replacement B'].includes(value)), true);
    });
    await t.test('rewrapping retains the secret and removing an old key works only after rewrapping', async () => {
      const lease = await f.lease(), vault = service(rotated());
      const currentOnly = createVaultKeyring({ activeKeyId: 'current', keys: { current: currentKey } });
      await assert.rejects(service(currentOnly).useSecret(lease, input(reference), () => {}), { code: 'unreadable' });
      assert.deepEqual(await vault.rewrap(lease, { ...input(reference), expectedVersion: 2 }), { reference, state: 'active', version: 3 });
      const row = await stored(reference);
      assert.equal(row.key_id, 'current'); assert.match(row.ciphertext, /^czv1\.current\./);
      assert.equal(await service(currentOnly).useSecret(lease, input(reference), value => ['replacement A', 'replacement B'].includes(value)), true);
      await assert.rejects(service().useSecret(lease, input(reference), () => {}), { code: 'unreadable' });
    });
    await t.test('record change during decryption prevents delivery of stale plaintext', async () => {
      const ring = rotated(); let called = false;
      const guarded = service({ ...ring, async open(context, envelope) {
        const clear = await ring.open(context, envelope);
        await service(ring).revoke(await f.lease(), { ...input(reference), expectedVersion: 3 });
        return clear;
      } });
      await assert.rejects(guarded.useSecret(await f.lease(), input(reference), () => { called = true; }), { code: 'conflict' });
      assert.equal(called, false);
      assert.deepEqual(await service(ring).metadata(await f.lease(), reference), { reference, state: 'revoked', version: 4 });
      await assert.rejects(service(ring).useSecret(await f.lease(), input(reference), () => { called = true; }), { code: 'unreadable' });
    });
    await t.test('ACL removal during decryption prevents delivery; restoring rights requires a new lease', async () => {
      const ring = initial(), vault = service(ring), lease = await f.lease(); let called = false;
      const metadata = await vault.put(lease, { secret, bindingId });
      const guarded = service({ ...ring, async open(context, envelope) {
        const clear = await ring.open(context, envelope);
        await f.changePermissions(['records', 'files']); return clear;
      } });
      await assert.rejects(guarded.useSecret(lease, input(metadata.reference), () => { called = true; }));
      assert.equal(called, false);
      await assert.rejects(vault.metadata(await f.lease(), metadata.reference));
      await f.changePermissions(['records', 'files', 'secrets']);
      await assert.rejects(vault.metadata(lease, metadata.reference));
      assert.equal(await vault.useSecret(await f.lease(), input(metadata.reference), value => value === secret), true);
    });
    await t.test('session revocation during encryption prevents inserting a secret', async () => {
      const ring = initial(), lease = await f.lease();
      const before = await f.db.prepare(`SELECT count(*) AS n FROM ${table('secret_metadata')}`).first();
      const guarded = service({ ...ring, async seal(context, clear) {
        const encrypted = await ring.seal(context, clear); await f.revoke(); return encrypted;
      } });
      await assert.rejects(guarded.put(lease, { secret, bindingId }));
      assert.deepEqual(await f.db.prepare(`SELECT count(*) AS n FROM ${table('secret_metadata')}`).first(), before);
    });
  } finally { await f.dispose(); }
});
