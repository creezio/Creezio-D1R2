import type { AuthorizationAudience } from '../authorization/types.ts';

/** A tuple is indivisible: permissions apply only to this exact context/audience pair. */
export interface MachineScope {
  readonly contextId: string;
  readonly audience: AuthorizationAudience;
  readonly permissionIds: readonly string[];
}

export const MACHINE_SCOPE_LIMITS = Object.freeze({ tuples: 64, permissions: 256 });
const contextPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const permissionPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const text = (value: unknown, pattern: RegExp, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum && value.match(pattern)?.[0] === value;

/** Copy descriptors, never read caller properties or execute accessors/iterators. */
function dataArray(value: unknown, maximum: number): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value)
    || length.value < 1 || length.value > maximum) return null;
  // Bound before ownKeys/descriptors: an oversized array is rejected without enumeration.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length.value + 1) return null;
  const allowed = new Set(['length', ...Array.from({ length: length.value }, (_, index) => String(index))]);
  if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) return null;
  const copied: unknown[] = [];
  for (let index = 0; index < length.value; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    copied.push(descriptor.value);
  }
  return copied;
}

function dataRecord(value: unknown, expected: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) return null;
  const values: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    values[key] = descriptor.value;
  }
  return values;
}

/**
 * Parse only the declared shape and bounds; this does not authorize anything.
 * The server validates context existence, installed permissions, machine actor
 * and audience compatibility, then intersects these limits with current ACLs.
 * No cross-product, wildcard, implicit empty grant or duplicate tuple is accepted.
 * Foreign prototypes, accessors, sparse/cyclic structures and throwing proxies
 * fail closed. Transparent proxies may be read as inert data via descriptors.
 */
export function parseMachineScopes(value: unknown): readonly MachineScope[] | null {
  try {
    const input = dataArray(value, MACHINE_SCOPE_LIMITS.tuples);
    if (!input) return null;
    const scopes: MachineScope[] = [], seenTuples = new Set<string>();
    let totalPermissions = 0;
    for (const candidate of input) {
      const tuple = dataRecord(candidate, ['contextId', 'audience', 'permissionIds']);
      if (!tuple || !text(tuple.contextId, contextPattern, 128)
        || (tuple.audience !== 'admin' && tuple.audience !== 'app')) return null;
      const tupleKey = JSON.stringify([tuple.contextId, tuple.audience]);
      if (seenTuples.has(tupleKey)) return null;
      seenTuples.add(tupleKey);
      const permissions = dataArray(tuple.permissionIds, MACHINE_SCOPE_LIMITS.permissions - totalPermissions);
      if (!permissions) return null;
      const permissionIds: string[] = [], seenPermissions = new Set<string>();
      for (const permission of permissions) {
        if (!text(permission, permissionPattern, 256) || seenPermissions.has(permission)) return null;
        seenPermissions.add(permission); permissionIds.push(permission);
      }
      totalPermissions += permissionIds.length;
      scopes.push(Object.freeze({ contextId: tuple.contextId, audience: tuple.audience,
        permissionIds: Object.freeze(permissionIds) }));
    }
    return Object.freeze(scopes);
  } catch { return null; }
}

/** Decode bounded SELECT projections, one permission per row, without broadening pairs. */
export function parseStoredMachineScopeRows(value: unknown): readonly MachineScope[] | null {
  try {
    const rows = dataArray(value, MACHINE_SCOPE_LIMITS.permissions);
    if (!rows) return null;
    const tuples = new Map<string, { contextId: string; audience: AuthorizationAudience; permissionIds: string[] }>();
    for (const candidate of rows) {
      const row = dataRecord(candidate, ['contextId', 'audience', 'permissionId']);
      if (!row || !text(row.contextId, contextPattern, 128)
        || (row.audience !== 'admin' && row.audience !== 'app') || !text(row.permissionId, permissionPattern, 256)) return null;
      const key = JSON.stringify([row.contextId, row.audience]);
      let tuple = tuples.get(key);
      if (!tuple) {
        if (tuples.size >= MACHINE_SCOPE_LIMITS.tuples) return null;
        tuple = { contextId: row.contextId, audience: row.audience, permissionIds: [] };
        tuples.set(key, tuple);
      }
      tuple.permissionIds.push(row.permissionId);
    }
    // The common parser also rejects duplicate SQL rows instead of silently deduplicating.
    return parseMachineScopes(Array.from(tuples.values()));
  } catch { return null; }
}
