/** Technical bounds, shared by the internal service and D1 store; no premium policy. */
export const IMPERSONATION_LIMITS = Object.freeze({ minimumTtlMs: 1000, maximumTtlMs: 900_000,
  permissions: 64, reasonBytes: 500, perSourceSession: 8, global: 512 });
const qualified = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function parseImpersonationPermissions(value: unknown): readonly string[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length < 1 || value.length > IMPERSONATION_LIMITS.permissions) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const copied: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const d = descriptors[String(index)];
      if (!d || !d.enumerable || !Object.hasOwn(d, 'value') || typeof d.value !== 'string'
        || d.value.length > 256 || d.value.match(qualified)?.[0] !== d.value) return null;
      copied.push(d.value);
    }
    if (new Set(copied).size !== copied.length) return null;
    return Object.freeze(copied.sort());
  } catch { return null; }
}

export function normalizeImpersonationReason(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1000 || !value.isWellFormed()
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) return null;
  const reason = value.trim();
  return reason && new TextEncoder().encode(reason).length <= IMPERSONATION_LIMITS.reasonBytes ? reason : null;
}
