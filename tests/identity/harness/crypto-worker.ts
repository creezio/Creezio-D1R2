import { scrypt } from '@noble/hashes/scrypt.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// Qualification fixtures only. No account, incoming password, secret or persistent storage.
// This module is never imported by the application entry point.
const password = new TextEncoder().encode('Creezio T04 — synthetic qualification only');
const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
export const qualificationProfiles = Object.freeze({
  scrypt: Object.freeze({ N: 32768, r: 8, p: 3, dkLen: 32, maxmem: 40 * 1024 * 1024 }),
  argon2id: Object.freeze({ m: 19456, t: 2, p: 1, version: 19, dkLen: 32, maxmem: 24 * 1024 * 1024 }),
});
export type QualificationProfile = keyof typeof qualificationProfiles;

/** Pure synchronous derivation, for a separately authenticated synthetic probe only. */
export function deriveSynthetic(profile: QualificationProfile) {
  if (profile !== 'scrypt' && profile !== 'argon2id') throw new Error('Unknown qualification profile.');
  const value = profile === 'scrypt'
    ? scrypt(password, salt, qualificationProfiles.scrypt)
    : argon2id(password, salt, qualificationProfiles.argon2id);
  try {
    return { profile, library: '@noble/hashes', version: '2.4.0', mode: 'synchronous',
      parameters: qualificationProfiles[profile], outputHex: bytesToHex(value),
      // Declared working allocation, not a measurement of isolate heap or process RSS.
      declaredWorkingBytes: profile === 'scrypt' ? 128 * 8 * (32768 + 3 + 1) : 19456 * 1024 };
  } finally { value.fill(0); }
}

/** RFC 9106 section 5.3: deliberately tiny conformance vector, not a password storage policy. */
function deriveArgon2RfcVector() {
  const value = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
    m: 32, t: 3, p: 4, version: 19, dkLen: 32, maxmem: 1024 * 1024,
    key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4),
  });
  try { return { source: 'RFC9106-section-5.3', outputHex: bytesToHex(value), conformanceOnly: true }; }
  finally { value.fill(0); }
}

export function createCryptoQualificationWorker() {
  let admitted = false;
  return {
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === '/admission/status' && request.method === 'GET') return Response.json({ admitted });
      if (!['/scrypt', '/argon2id', '/rfc-argon2id', '/admission/hold'].includes(path)) return new Response(null, { status: 404 });
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
      // Cost and input are fixed by the probe. No request-selected options or passwords.
      if (new URL(request.url).search) return new Response(null, { status: 400 });
      if (request.body) {
        const reader = request.body.getReader();
        const first = await reader.read(); reader.releaseLock();
        if (!first.done) { void request.body.cancel().catch(() => {}); return new Response(null, { status: 400 }); }
      }
      if (admitted) return Response.json({ error: 'qualification_busy' }, { status: 429 });
      admitted = true;
      try {
        if (path === '/admission/hold') {
          // Deterministic test fixture for admission. No KDF is running during this hold.
          await new Promise<void>(resolve => { setTimeout(resolve, 500); });
          return Response.json({ admissionFixture: true });
        }
        if (path === '/rfc-argon2id') return Response.json(deriveArgon2RfcVector());
        return Response.json(deriveSynthetic(path === '/scrypt' ? 'scrypt' : 'argon2id'));
      } finally { admitted = false; }
    },
  };
}

export default /* @__PURE__ */ createCryptoQualificationWorker();
