import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { issueOpaqueToken, digestOpaqueToken } from '../../core/identity/tokens.ts';

const purposes = ['session', 'api-token', 'invitation', 'activation', 'password-reset', 'bootstrap'];

test('every purpose issues a canonical 256-bit token with a separate reproducible digest', async () => {
  for (const purpose of purposes) {
    const issued = await issueOpaqueToken(purpose), second = await issueOpaqueToken(purpose);
    assert.notEqual(issued.token, second.token);
    assert.match(issued.token, /^cz1[sairvb]_[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(issued.token.slice(5), 'base64url').byteLength, 32);
    assert.equal(issued.digest, await digestOpaqueToken(issued.token, purpose));
    assert.equal(issued.digest, 'sha256:' + createHash('sha256').update(`creezio:credential:v1:${purpose}:${issued.token}`).digest('hex'));
    assert.match(issued.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Object.isFrozen(issued), true);
  }
});

test('a credential cannot be replayed as another purpose or used as its own stored digest', async () => {
  for (const purpose of purposes) {
    const issued = await issueOpaqueToken(purpose);
    for (const other of purposes.filter(candidate => candidate !== purpose)) {
      assert.equal(await digestOpaqueToken(issued.token, other), null);
    }
    assert.equal(await digestOpaqueToken(issued.digest, purpose), null);
  }
});

test('reject malformed, unknown-version, padded and oversized tokens without normalization', async () => {
  const { token } = await issueOpaqueToken('session');
  for (const invalid of [null, {}, [], 1, '', ' ' + token, token + ' ', token + '=', token.toUpperCase(), token.replace('cz1s_', 'cz2s_'),
    token.slice(0, -1), token + 'x', 'cz1s_' + '*'.repeat(43), 'x'.repeat(10000)]) {
    assert.equal(await digestOpaqueToken(invalid, 'session'), null);
  }
});

test('reject alternative base64 encodings with nonzero padding bits', async () => {
  const canonical = 'cz1s_' + 'A'.repeat(43);
  assert.match(await digestOpaqueToken(canonical, 'session'), /^sha256:/);
  assert.equal(await digestOpaqueToken(canonical.slice(0, -1) + 'B', 'session'), null);
});

test('unknown purpose names fail closed rather than falling back to session', async () => {
  for (const purpose of ['owner', 'constructor', '__proto__', undefined, ['session'], { toString() { return 'bootstrap'; } }]) {
    await assert.rejects(issueOpaqueToken(purpose), /Unknown token purpose/);
    await assert.rejects(digestOpaqueToken('anything', purpose), /Unknown token purpose/);
  }
});
