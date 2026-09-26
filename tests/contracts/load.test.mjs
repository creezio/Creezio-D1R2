import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadJson, inspectJson, ContractLoadError } from '../../sdk/contracts/load.mjs';
import { temporaryDirectory } from '../quality/temporary.mjs';
import { accepted, refused } from './helpers.mjs';

function throwsCode(callback, code) {
  assert.throws(callback, error => error instanceof ContractLoadError && error.code === code);
}

test('loads UTF-8 declarations inside their explicit root without changing their content', t => {
  const root = temporaryDirectory(t, 'creezio-contract-load-');
  mkdirSync(join(root, 'nested'));
  const path = join(root, 'nested', 'module.json');
  const value = { title: 'Équipe et accès', versions: [1, null, true] };
  writeFileSync(path, JSON.stringify(value));
  assert.deepEqual(loadJson(path, { root }), value);
  assert.deepEqual(loadJson('nested/module.json', { root }), value);
});

test('loads data only: JavaScript and malformed JSON never execute and errors redact the input', t => {
  const root = temporaryDirectory(t, 'creezio-contract-load-');
  const path = join(root, 'module.json');
  const marker = ['sensitive', 'fixture', 'value'].join('-');
  writeFileSync(path, `globalThis.__creezioLoaderExecuted = true; /* ${marker} */`);
  try {
    assert.throws(() => loadJson(path, { root }), error => {
      assert.ok(error instanceof ContractLoadError);
      assert.equal(error.code, 'load.json');
      assert.ok(!error.message.includes(marker), 'A diagnostic must not echo private input');
      return true;
    });
    assert.equal(globalThis.__creezioLoaderExecuted, undefined);
  } finally { delete globalThis.__creezioLoaderExecuted; }
});

test('refuses missing files and directories as module declarations', t => {
  const root = temporaryDirectory(t, 'creezio-contract-load-');
  throwsCode(() => loadJson(join(root, 'missing.json'), { root }), 'load.file');
  throwsCode(() => loadJson(root, { root }), 'load.file');
});

test('confines reads to the root even for an existing sibling with the same prefix', t => {
  const temp = temporaryDirectory(t, 'creezio-contract-load-');
  const root = join(temp, 'allowed');
  const sibling = join(temp, 'allowed-other');
  mkdirSync(root); mkdirSync(sibling);
  const outside = join(sibling, 'module.json');
  writeFileSync(outside, '{}');
  throwsCode(() => loadJson(outside, { root }), 'load.path');
  throwsCode(() => loadJson('../allowed-other/module.json', { root }), 'load.path');
  throwsCode(() => loadJson('https://example.invalid/module.json', { root }), 'load.path');
});

test('refuses parent junctions or symlinks instead of following them to JSON', t => {
  const temp = temporaryDirectory(t, 'creezio-contract-load-');
  const root = join(temp, 'allowed');
  const target = join(temp, 'elsewhere');
  mkdirSync(root); mkdirSync(target);
  writeFileSync(join(target, 'module.json'), '{}');
  const link = join(root, 'linked');
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { throwsCode(() => loadJson(join(link, 'module.json'), { root }), 'load.link'); }
  finally { unlinkSync(link); }
});

test('bounds file size in bytes before parsing multibyte text', t => {
  const root = temporaryDirectory(t, 'creezio-contract-load-');
  const path = join(root, 'module.json');
  const source = JSON.stringify({ title: 'é'.repeat(64) });
  writeFileSync(path, source);
  assert.ok(Buffer.byteLength(source) > source.length);
  throwsCode(() => loadJson(path, { root, maxBytes: source.length }), 'load.size');
  assert.deepEqual(loadJson(path, { root, maxBytes: Buffer.byteLength(source) }), JSON.parse(source));
});

test('bounds parsed depth and node count independently of byte size', t => {
  const root = temporaryDirectory(t, 'creezio-contract-load-');
  const path = join(root, 'module.json');
  writeFileSync(path, JSON.stringify({ a: { b: { c: { d: {} } } } }));
  throwsCode(() => loadJson(path, { root, maxDepth: 2 }), 'json.depth');
  writeFileSync(path, JSON.stringify(Array.from({ length: 100 }, (_, i) => i)));
  throwsCode(() => loadJson(path, { root, maxNodes: 10 }), 'json.nodes');
});

test('rejects unsafe object keys without polluting Object.prototype', t => {
  const root = temporaryDirectory(t, 'creezio-contract-load-');
  const path = join(root, 'module.json');
  writeFileSync(path, '{"__proto__":{"contractPolluted":true}}');
  throwsCode(() => loadJson(path, { root }), 'json.unsafe-key');
  assert.equal({}.contractPolluted, undefined);
});

test('in-memory inspection accepts JSON data and refuses cycles, non-JSON values and accessors', () => {
  const good = { nested: [{ count: 2 }, null, false] };
  const before = structuredClone(good);
  accepted(inspectJson(good));
  assert.deepEqual(good, before);
  const cyclic = {}; cyclic.self = cyclic;
  refused(inspectJson(cyclic), 'json.cycle');
  for (const value of [NaN, Infinity, undefined, 1n, new Date(), () => 1]) {
    refused(inspectJson({ value }), 'json.type');
  }
  let calls = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return 1; } });
  refused(inspectJson(accessor), 'json.type');
  assert.equal(calls, 0, 'Inspection must not execute an accessor');
});
