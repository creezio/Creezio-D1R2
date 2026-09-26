import { PASSWORD_PROFILE } from './password.ts';

const encoder = new TextEncoder();
export const validIdentityAudience = (value: unknown): value is 'admin' | 'app' => value === 'admin' || value === 'app';
export const validIdentityId = (value: unknown): value is string => typeof value === 'string'
  && value.match(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)?.[0] === value;

export function validPasswordInput(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PASSWORD_PROFILE.maximumPasswordBytes
    && value.isWellFormed() && encoder.encode(value).byteLength <= PASSWORD_PROFILE.maximumPasswordBytes;
}
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 200) return null;
  const normalized = value.trim();
  return normalized && [...normalized].length <= 120 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}
export function identityInputFields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length
      && keys.every(key => Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'));
  } catch { return false; }
}
export async function identityAdmissionKey(domain: string, value = ''): Promise<string> {
  const bytes = encoder.encode(`creezio:identity-admission:v1:${domain}:${value}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
