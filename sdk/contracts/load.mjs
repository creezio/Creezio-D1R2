import { openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxDepth: 48, maxNodes: 20000 });
const CEILINGS = { maxBytes: 16 * 1024 * 1024, maxDepth: 96, maxNodes: 100000 };
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const pointer = (base, key) => `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;

export class ContractLoadError extends Error {
  constructor(code, location, message) {
    super(message); this.name = 'ContractLoadError'; this.code = code; this.path = location;
  }
}

function limitsOf(options) {
  const limits = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const value = options[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > CEILINGS[key]) throw new ContractLoadError('json.limits', '', `Invalid ${key} limit.`);
    limits[key] = value;
  }
  return limits;
}

/** Inspect inert JSON only. Accessors, exotic prototypes and cycles are rejected before validators read values. */
export function inspectJson(value, options = {}) {
  const errors = [], metrics = { nodes: 0, depth: 0, bytes: 0 };
  let limits;
  try { limits = limitsOf(options); } catch (error) { return { errors: [{ code: error.code, path: '', message: error.message }], metrics }; }
  const active = new WeakSet();
  function fail(code, location, message) { if (errors.length < 32) errors.push({ code, path: location, message }); }
  function visit(item, location, depth) {
    if (errors.length || ++metrics.nodes > limits.maxNodes) {
      if (!errors.length) fail('json.nodes', location, 'JSON node limit exceeded.');
      return;
    }
    metrics.depth = Math.max(metrics.depth, depth);
    if (depth > limits.maxDepth) return fail('json.depth', location, 'JSON depth limit exceeded.');
    if (item === null || typeof item === 'boolean') { metrics.bytes += String(item).length; return; }
    if (typeof item === 'string') { metrics.bytes += Buffer.byteLength(JSON.stringify(item)); return; }
    if (typeof item === 'number' && Number.isFinite(item)) { metrics.bytes += String(item).length; return; }
    if (typeof item !== 'object') return fail('json.type', location, 'Only JSON values are accepted.');
    if (active.has(item)) return fail('json.cycle', location, 'Cyclic values are not JSON.');
    const prototype = Object.getPrototypeOf(item);
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail('json.type', location, 'Only plain JSON objects and arrays are accepted.');
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.getOwnPropertySymbols(item).length) fail('json.type', location, 'Symbol properties are not JSON.');
    if (Array.isArray(item) && Object.keys(descriptors).length !== item.length + 1) fail('json.type', location, 'Sparse or decorated arrays are not JSON.');
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (forbiddenKeys.has(key)) { fail('json.unsafe-key', pointer(location, key), 'Reserved property name.'); break; }
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) { fail('json.type', pointer(location, key), 'Accessors and hidden properties are not JSON.'); break; }
      if (!Array.isArray(item)) metrics.bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
      visit(descriptor.value, pointer(location, key), depth + 1);
      if (metrics.bytes > limits.maxBytes) { fail('json.size', location, 'JSON byte limit exceeded.'); break; }
      if (errors.length) break;
    }
    active.delete(item);
  }
  try { visit(value, '', 0); } catch { fail('json.type', '', 'The input could not be inspected as inert JSON.'); }
  if (!errors.length) metrics.bytes = Buffer.byteLength(JSON.stringify(value));
  if (!errors.length && metrics.bytes > limits.maxBytes) fail('json.size', '', 'JSON byte limit exceeded.');
  return { errors, metrics };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Bounded local JSON read. No JavaScript import, handler execution, URL retrieval or linked directory traversal. */
export function loadJson(filePath, options = {}) {
  const limits = limitsOf(options);
  if (typeof filePath !== 'string' || !filePath || /^(?:[a-z]+:\/\/|\\\\|\/\/)/i.test(filePath)) throw new ContractLoadError('load.path', '', 'A local file path is required.');
  const root = path.resolve(options.root ?? process.cwd()), target = path.resolve(root, filePath);
  if (!inside(root, target)) throw new ContractLoadError('load.path', '', 'The file is outside the permitted root.');
  let fd;
  try {
    // Inspect every ancestor, including the root: a junction cannot widen the declared perimeter.
    let cursor = target;
    while (true) {
      if (lstatSync(cursor).isSymbolicLink()) throw new ContractLoadError('load.link', '', 'Linked paths are not accepted.');
      const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
    }
    if (!inside(realpathSync(root), realpathSync(target))) throw new ContractLoadError('load.path', '', 'The resolved file is outside the permitted root.');
    fd = openSync(target, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new ContractLoadError('load.file', '', 'A regular JSON file is required.');
    if (stat.size > limits.maxBytes) throw new ContractLoadError('load.size', '', 'JSON file exceeds its byte limit.');
    const bytes = Buffer.alloc(limits.maxBytes + 1);
    let length = 0;
    while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
    if (length > limits.maxBytes) throw new ContractLoadError('load.size', '', 'JSON file exceeds its byte limit.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw new ContractLoadError('load.json', '', 'The file must contain valid UTF-8 JSON.'); }
    const inspected = inspectJson(value, limits);
    if (inspected.errors.length) { const error = inspected.errors[0]; throw new ContractLoadError(error.code, error.path, error.message); }
    return value;
  } catch (error) {
    if (error instanceof ContractLoadError) throw error;
    throw new ContractLoadError('load.file', '', 'The JSON file could not be read.');
  } finally { if (fd !== undefined) closeSync(fd); }
}
