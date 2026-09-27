/** Worker-compatible secret envelopes. Keys are deployment inputs, never defaults. */
export const VAULT_CRYPTO_POLICY = Object.freeze({ version: 1, keyBytes: 32, ivBytes: 12,
  tagBits: 128, maximumKeys: 8, maximumSecretBytes: 16_384 });

export class VaultError extends Error {
  readonly code: 'invalid_input' | 'unavailable' | 'unreadable' | 'conflict';
  constructor(code: VaultError['code']) { super('Vault operation refused.'); this.name = 'VaultError'; this.code = code; }
}
export interface VaultContext {
  readonly moduleId: string;
  readonly contextId: string;
  readonly reference: string;
  readonly bindingId: string;
  readonly version: number;
}
export interface VaultKeyring {
  readonly activeKeyId: string;
  seal(context: VaultContext, plaintext: string): Promise<string>;
  open(context: VaultContext, envelope: string): Promise<string>;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const referencePattern = /^creezio-secret:v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isVaultReference(value: unknown): value is string {
  return typeof value === 'string' && referencePattern.test(value);
}
export function createVaultReference(): string { return `creezio-secret:v1:${crypto.randomUUID()}`; }
export function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}
function bytes(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !value.length || value.length > maximum || !value.isWellFormed()) throw new VaultError('invalid_input');
  const result = encoder.encode(value);
  if (result.length > maximum) throw new VaultError('invalid_input');
  return result;
}
function aad(context: VaultContext): Uint8Array<ArrayBuffer> {
  if (!plainRecord(context) || Object.keys(context).sort().join(',') !== 'bindingId,contextId,moduleId,reference,version'
    || !isVaultReference(context.reference) || !Number.isSafeInteger(context.version) || context.version < 1)
    throw new VaultError('invalid_input');
  bytes(context.moduleId, 200); bytes(context.contextId, 128); bytes(context.bindingId, 128);
  return encoder.encode(JSON.stringify(['creezio:vault:1', context.moduleId, context.contextId, context.bindingId, context.reference, context.version]));
}
function encode(value: Uint8Array): string {
  let binary = ''; for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value: string, maximum: number): Uint8Array<ArrayBuffer> {
  if (value.length > Math.ceil(maximum * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new VaultError('unreadable');
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
    const result = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (result.length > maximum || encode(result) !== value) throw new Error();
    return result;
  } catch { throw new VaultError('unreadable'); }
}

/** Old key IDs may decrypt existing envelopes; only activeKeyId encrypts new writes. */
export function createVaultKeyring(input: { activeKeyId: string; keys: Readonly<Record<string, Uint8Array>> }): VaultKeyring {
  if (!plainRecord(input) || Object.keys(input).sort().join(',') !== 'activeKeyId,keys'
    || typeof input.activeKeyId !== 'string' || !keyPattern.test(input.activeKeyId) || !plainRecord(input.keys)) throw new VaultError('unavailable');
  const entries = Object.entries(input.keys);
  if (!entries.length || entries.length > VAULT_CRYPTO_POLICY.maximumKeys || !Object.hasOwn(input.keys, input.activeKeyId)) throw new VaultError('unavailable');
  const keys = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [id, value] of entries) {
    if (!keyPattern.test(id) || !(value instanceof Uint8Array) || value.byteLength !== 32) throw new VaultError('unavailable');
    keys.set(id, new Uint8Array(value));
  }
  const activeKeyId = input.activeKeyId;
  async function key(id: string): Promise<CryptoKey> {
    const raw = keys.get(id);
    if (!raw) throw new VaultError('unreadable');
    try { return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
    catch { throw new VaultError('unavailable'); }
  }
  return Object.freeze({ activeKeyId,
    async seal(context: VaultContext, plaintext: string) {
      const additionalData = aad(context), clear = bytes(plaintext, VAULT_CRYPTO_POLICY.maximumSecretBytes);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      try {
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, await key(activeKeyId), clear);
        return `czv1.${activeKeyId}.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
      } catch (error) { if (error instanceof VaultError) throw error; throw new VaultError('unavailable'); }
      finally { clear.fill(0); }
    },
    async open(context: VaultContext, envelope: string) {
      const additionalData = aad(context);
      if (typeof envelope !== 'string' || envelope.length > 23_000) throw new VaultError('unreadable');
      const parts = envelope.split('.');
      if (parts.length !== 4 || parts[0] !== 'czv1' || !keyPattern.test(parts[1]!)) throw new VaultError('unreadable');
      const iv = decode(parts[2]!, 12), ciphertext = decode(parts[3]!, VAULT_CRYPTO_POLICY.maximumSecretBytes + 16);
      if (iv.length !== 12 || ciphertext.length < 17) throw new VaultError('unreadable');
      let clear: Uint8Array<ArrayBuffer> | undefined;
      try {
        clear = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, await key(parts[1]!), ciphertext));
        return decoder.decode(clear);
      } catch (error) { if (error instanceof VaultError) throw error; throw new VaultError('unreadable'); }
      finally { clear?.fill(0); }
    },
  });
}
