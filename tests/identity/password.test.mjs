import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, PASSWORD_PROFILE, PasswordInputError } from '../../core/identity/password.ts';

// Fixed synthetic vector independently recorded by local workerd and the protected Sites probe.
const fixturePassword = 'Creezio T04 — synthetic qualification only';
const fixtureSalt = Buffer.from(Array.from({ length: 16 }, (_, index) => index + 1)).toString('base64').replace(/=+$/, '');
const fixtureHash = Buffer.from('19f56965225ad8cf1c07f2c64f442aef18df55fb59534dc961c644882190edc0', 'hex').toString('base64').replace(/=+$/, '');
const fixture = `$argon2id$v=19$m=19456,t=2,p=1$${fixtureSalt}$${fixtureHash}`;

test('approved Argon2id profile verifies the hosted/local synthetic vector and rejects wrong passwords', () => {
  assert.deepEqual(PASSWORD_PROFILE, { algorithm: 'argon2id', version: 19, memoryKiB: 19456, iterations: 2,
    parallelism: 1, saltBytes: 16, hashBytes: 32, maximumPasswordBytes: 1024 });
  assert.equal(verifyPassword(fixturePassword, fixture), true);
  assert.equal(verifyPassword(fixturePassword + 'x', fixture), false);
  assert.equal(Object.isFrozen(PASSWORD_PROFILE), true);
});

test('hash creation salts each password independently and emits a canonical PHC record', () => {
  const password = 'A synthetic passphrase used only in tests';
  const first = hashPassword(password), second = hashPassword(password);
  assert.notEqual(first, second);
  assert.match(first, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  assert.equal(verifyPassword(password, first), true);
  assert.equal(first.includes(password), false);
});

test('records cannot select weaker or huge costs, alternate algorithms, versions or extra fields', () => {
  const invalid = [null, {}, '', fixture.replace('m=19456', 'm=32'), fixture.replace('m=19456', 'm=999999999'),
    fixture.replace('t=2', 't=1'), fixture.replace('t=2', 't=1000000'), fixture.replace('p=1', 'p=4'),
    fixture.replace('v=19', 'v=16'), fixture.replace('argon2id', 'argon2i'), fixture + '$extra',
    fixture.replace('m=19456,t=2,p=1', 'p=1,t=2,m=19456'), ' '.repeat(10000), fixture + '=', ' ' + fixture];
  for (const record of invalid) assert.equal(verifyPassword(fixturePassword, record), false);
});

test('PHC salt/hash encodings must have their full lengths and canonical padding bits', () => {
  for (const [salt, hash] of [[fixtureSalt + '=', fixtureHash], [fixtureSalt.slice(1), fixtureHash],
    [fixtureSalt, fixtureHash.slice(1)], ['A'.repeat(21) + 'B', fixtureHash], [fixtureSalt, 'A'.repeat(42) + 'B'],
    ['_'.repeat(22), fixtureHash]]) {
    assert.equal(verifyPassword(fixturePassword, `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${hash}`), false);
  }
});

test('input is bounded by UTF-8 bytes and rejects ill-formed Unicode without coercion', () => {
  for (const input of [undefined, {}, ['password'], '', 'a'.repeat(1025), 'é'.repeat(513), '\ud800', '\udc00']) {
    assert.throws(() => hashPassword(input), PasswordInputError);
    assert.equal(verifyPassword(input, fixture), false);
  }
});

test('verification preserves whitespace and exact Unicode instead of normalizing the secret', () => {
  const password = '  Café – 🔑 synthetic password  ';
  const record = hashPassword(password);
  assert.equal(verifyPassword(password, record), true);
  assert.equal(verifyPassword(password.trim(), record), false);
  assert.equal(verifyPassword(password.normalize('NFD'), record), false);
});
