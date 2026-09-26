import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_TABLES, createD1IdentityStore, normalizeLoginIdentifier, IdentityStoreError, IdentityStoreInputError,
} from '../../core/identity/d1-store.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const record = '$argon2id$v=19$m=19456,t=2,p=1$' + 'A'.repeat(22) + '$' + 'A'.repeat(43);
const snapshot = () => ({ principalId: 'principal-1', loginIdentifier: 'native@example.invalid', authVersion: 1,
  accountVersion: 1, credentialVersion: 1, passwordRecord: record });
function uncalledDatabase() {
  let calls = 0;
  return { db: { prepare() { calls++; throw new Error('Unexpected SQL'); }, batch() { calls++; throw new Error('Unexpected SQL'); } },
    calls: () => calls };
}

test('login policy is bounded ASCII, case folded and consistent without Unicode lookalike conversion', () => {
  assert.equal(normalizeLoginIdentifier('  Native+test@EXAMPLE.invalid  '), 'native+test@example.invalid');
  assert.equal(normalizeLoginIdentifier('a'.repeat(254)), 'a'.repeat(254));
  for (const value of [null, {}, ['abc'], '', 'ab', 'a'.repeat(255), 'x'.repeat(513), 'a b', 'a\nb', 'éabc', 'Kabc', 'İabc', 'abc/def', "abc' OR 1=1"]) {
    assert.equal(normalizeLoginIdentifier(value), null);
  }
});

test('table names encode the module and model bytes without collisions or caller-controlled SQL', () => {
  const names = Object.keys(ACCESS_TABLES);
  assert.equal(names.length, 17);
  assert.equal(new Set(Object.values(ACCESS_TABLES)).size, 17);
  for (const name of names) {
    assert.equal(ACCESS_TABLES[name], `cz_${Buffer.from('creezio.access').toString('hex')}_${Buffer.from(name).toString('hex')}`);
  }
  assert.equal(Object.isFrozen(ACCESS_TABLES), true);
});

test('malformed credentials and lookups are rejected before database access', async () => {
  const fake = uncalledDatabase(), store = createD1IdentityStore(fake.db);
  for (const value of [null, '', 'plain secret', 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(65)]) {
    assert.equal(await store.canCompleteBootstrap(value), false);
    assert.equal(await store.getSession(value, 'app'), null);
    assert.equal(await store.revokeSession(value, 'app'), false);
  }
  assert.equal(await store.getSession(digest, 'owner'), null);
  assert.equal(await store.revokeSession(digest, 'owner'), false);
  assert.equal(await store.findPasswordAccount('not a login'), null);
  assert.equal(fake.calls(), 0);
});

test('bootstrap input rejects malformed PHC and projections rather than writing partial accounts', async () => {
  const fake = uncalledDatabase(), store = createD1IdentityStore(fake.db);
  for (const input of [null, { capabilityDigest: 'raw-secret', expiresAtMs: 1 }, { capabilityDigest: digest, expiresAtMs: Infinity }]) {
    await assert.rejects(store.provisionBootstrap(input), IdentityStoreInputError);
  }
  const valid = { capabilityDigest: digest, loginIdentifier: 'native@example.invalid', displayName: 'Synthetic account', passwordRecord: record };
  for (const input of [null, { ...valid, capabilityDigest: 'raw' }, { ...valid, loginIdentifier: 'Kelvin' },
    { ...valid, displayName: '\ud800' }, { ...valid, displayName: 'a\nb' }, { ...valid, displayName: 'x'.repeat(201) },
    { ...valid, passwordRecord: record.replace('m=19456', 'm=32') }]) {
    await assert.rejects(store.completeBootstrap(input), IdentityStoreInputError);
  }
  assert.equal(fake.calls(), 0);
});

test('post-KDF session input requires finite bounded TTL, audience and current snapshot fields', async () => {
  const fake = uncalledDatabase(), store = createD1IdentityStore(fake.db);
  const input = { sessionDigest: digest, audience: 'app', ttlMs: 60000 };
  for (const invalid of [{ ...input, ttlMs: 999 }, { ...input, ttlMs: 2592000001 }, { ...input, ttlMs: Infinity },
    { ...input, ttlMs: 1000.5 }, { ...input, audience: 'owner' }, { ...input, sessionDigest: 'raw' }]) {
    await assert.rejects(store.createSessionAfterPassword(snapshot(), invalid), IdentityStoreInputError);
  }
  for (const invalid of [null, { ...snapshot(), authVersion: 0 }, { ...snapshot(), accountVersion: NaN },
    { ...snapshot(), credentialVersion: 0 }, { ...snapshot(), loginIdentifier: 'Noncanonical' },
    { ...snapshot(), passwordRecord: 'not-phc' }]) {
    await assert.rejects(store.createSessionAfterPassword(invalid, input), IdentityStoreInputError);
  }
  assert.equal(fake.calls(), 0);
});

test('throttle keys are digests and all window/count inputs are bounded before SQL', async () => {
  const fake = uncalledDatabase(), store = createD1IdentityStore(fake.db);
  const input = { key: digest, limit: 10, windowMs: 60000 };
  for (const invalid of [null, { ...input, key: '198.51.100.1' }, { ...input, key: 'native@example.invalid' },
    { ...input, limit: 0 }, { ...input, limit: 1001 }, { ...input, limit: 1.5 }, { ...input, windowMs: 999 },
    { ...input, windowMs: 86400001 }, { ...input, windowMs: Infinity }]) {
    await assert.rejects(store.consumeThrottle(invalid), IdentityStoreInputError);
  }
  assert.equal(fake.calls(), 0);
});

test('storage failures never expose SQL parameters or vendor diagnostics', async () => {
  const sensitive = 'synthetic-sensitive-diagnostic';
  for (const phase of ['prepare', 'bind', 'first', 'batch']) {
    const fake = { prepare() {
      if (phase === 'prepare') throw new Error(sensitive);
      return { bind() {
        if (phase === 'bind') throw new Error(sensitive);
        return { first: async () => { throw new Error(sensitive); } };
      } };
    }, batch: async () => { throw new Error(sensitive); } };
    const store = createD1IdentityStore(fake);
    await assert.rejects(phase === 'batch' ? store.provisionBootstrap({ capabilityDigest: digest, expiresAtMs: 1 }) : store.canCompleteBootstrap(digest),
      error => error instanceof IdentityStoreError && !String(error).includes(sensitive) && !('cause' in error));
  }
});

test('a failed maintenance statement cannot produce a successful throttle admission', async () => {
  const store = createD1IdentityStore({
    prepare: () => ({ bind: () => ({}) }),
    batch: async () => [
      { success: false, results: [], meta: { changes: 0 } },
      { success: true, results: [{ attempts: 1, retryAtMs: 1000000 }], meta: { changes: 1 } },
    ],
  });
  await assert.rejects(store.consumeThrottle({ key: digest, limit: 10, windowMs: 60000 }), IdentityStoreError);
});
