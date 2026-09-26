import { argon2id } from '@noble/hashes/argon2.js';

/** One approved profile. Stored input cannot choose a cheaper or arbitrarily expensive KDF. */
export const PASSWORD_PROFILE = Object.freeze({
  algorithm: 'argon2id', version: 19, memoryKiB: 19456, iterations: 2, parallelism: 1,
  saltBytes: 16, hashBytes: 32, maximumPasswordBytes: 1024,
});
const prefix = '$argon2id$v=19$m=19456,t=2,p=1$';
const options = Object.freeze({ m: 19456, t: 2, p: 1, version: 19, dkLen: 32, maxmem: 24 * 1024 * 1024 });
const encoder = new TextEncoder();

export class PasswordInputError extends Error {
  constructor() { super('Invalid password input.'); this.name = 'PasswordInputError'; }
}

function passwordBytes(value: unknown): Uint8Array | null {
  // Length/strength policy for account creation belongs to the account operation.
  // No trimming, truncation or Unicode replacement: verification uses the exact bytes.
  if (typeof value !== 'string' || !value.length || value.length > PASSWORD_PROFILE.maximumPasswordBytes || !value.isWellFormed()) return null;
  const bytes = encoder.encode(value);
  if (bytes.byteLength > PASSWORD_PROFILE.maximumPasswordBytes) { bytes.fill(0); return null; }
  return bytes;
}
function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/=+$/, ''); }
function decode(value: string, length: number): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value) || value.length !== Math.ceil(length * 8 / 6)) return null;
  const bytes = Uint8Array.from(atob(value + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
  if (bytes.length !== length || encode(bytes) !== value) { bytes.fill(0); return null; }
  return bytes;
}
function parse(record: unknown): { salt: Uint8Array; hash: Uint8Array } | null {
  if (typeof record !== 'string' || record.length > 128 || !record.startsWith(prefix)) return null;
  const parts = record.slice(prefix.length).split('$');
  if (parts.length !== 2) return null;
  const salt = decode(parts[0], PASSWORD_PROFILE.saltBytes);
  if (!salt) return null;
  const hash = decode(parts[1], PASSWORD_PROFILE.hashBytes);
  if (!hash) { salt.fill(0); return null; }
  return { salt, hash };
}

/** Validate stored parameters without performing a KDF or retaining decoded buffers. */
export function isApprovedPasswordRecord(record: unknown): boolean {
  const parsed = parse(record);
  if (!parsed) return false;
  parsed.salt.fill(0); parsed.hash.fill(0);
  return true;
}

/**
 * Synchronous, bounded parameters; blocks this isolate until completion.
 * The caller must apply request admission and revalidate account state before writing.
 * No Promise/timeout is claimed to preempt this CPU work. No account or session is created.
 */
export function hashPassword(password: unknown): string {
  const input = passwordBytes(password);
  if (!input) throw new PasswordInputError();
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_PROFILE.saltBytes));
  let hash: Uint8Array | undefined;
  try {
    hash = argon2id(input, salt, options);
    return `${prefix}${encode(salt)}$${encode(hash)}`;
  } finally { input.fill(0); salt.fill(0); hash?.fill(0); }
}

/** Malformed/unapproved records fail without deriving. This is not a complete login handler. */
export function verifyPassword(password: unknown, record: unknown): boolean {
  const parsed = parse(record);
  if (!parsed) return false;
  const input = passwordBytes(password);
  if (!input) { parsed.salt.fill(0); parsed.hash.fill(0); return false; }
  let derived: Uint8Array | undefined;
  try {
    derived = argon2id(input, parsed.salt, options);
    // Fixed-length comparison with no early exit; no stronger VM timing guarantee is claimed.
    let difference = 0;
    for (let index = 0; index < PASSWORD_PROFILE.hashBytes; index++) difference |= derived[index] ^ parsed.hash[index];
    return difference === 0;
  } finally { input.fill(0); parsed.salt.fill(0); parsed.hash.fill(0); derived?.fill(0); }
}
