import { DataAccessError, type JsonValue } from './types.ts';

export const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const validId = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) && !/[\r\n\u2028\u2029]/.test(value);
/** Capture plain JSON without invoking getters; bound before serialization or asynchronous work. */
export function copyJson(value: unknown, maximumBytes = 65_536): JsonValue {
  let nodes = 0, characters = 0;
  const ancestors = new Set<object>();
  function visit(input: unknown, depth: number): JsonValue {
    if (++nodes > 100_000 || depth > 24) throw new DataAccessError('invalid_input');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') {
      characters += input.length;
      if (characters > maximumBytes || !input.isWellFormed()) throw new DataAccessError('invalid_input');
      return input;
    }
    if (!input || typeof input !== 'object' || ancestors.has(input)) throw new DataAccessError('invalid_input');
    const array = Array.isArray(input), proto = Object.getPrototypeOf(input);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new DataAccessError('invalid_input');
    if (array && input.length > 100_000) throw new DataAccessError('invalid_input');
    const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
    if (keys.length > 100_001 || (array && keys.length !== input.length + 1)) throw new DataAccessError('invalid_input');
    ancestors.add(input);
    const result: Record<string, JsonValue> = Object.create(null), items: JsonValue[] = [];
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || !descriptors[key].enumerable || !own(descriptors[key], 'value')) throw new DataAccessError('invalid_input');
      if (array && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= input.length)) throw new DataAccessError('invalid_input');
      characters += key.length;
      const child = visit(descriptors[key].value, depth + 1);
      if (array) items.push(child); else result[key] = child;
    }
    ancestors.delete(input);
    return Object.freeze(array ? items : result);
  }
  try {
    const copied = visit(value, 0);
    if (new TextEncoder().encode(JSON.stringify(copied)).length > maximumBytes) throw new DataAccessError('invalid_input');
    return copied;
  } catch (error) { if (error instanceof DataAccessError) throw error; throw new DataAccessError('invalid_input'); }
}
export function record(value: unknown): asserts value is Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataAccessError('invalid_input');
}
export function keys(value: object, required: readonly string[], optional: readonly string[] = []) {
  if (required.some(key => !own(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
    throw new DataAccessError('invalid_input');
}
