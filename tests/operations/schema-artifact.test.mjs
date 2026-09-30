import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, statSync, symlinkSync, unlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRuntimeSchema } from '../../scripts/data/prepare-runtime.mjs';
import { describeD1Schema } from '../../scripts/data/d1-schema.mjs';
import { RUNTIME_STORAGE_MODULE_ID, RUNTIME_MODELS, RUNTIME_TABLES } from '../../scripts/data/runtime-models.mjs';
import { temporaryDirectory } from '../quality/temporary.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const artifact = root => path.join(root, 'data/schema/runtime.sql');

test('versioned technical SQL exactly matches canonical host models and mappings without database I/O', () => {
  const generated = describeD1Schema(RUNTIME_STORAGE_MODULE_ID, RUNTIME_MODELS), report = prepareRuntimeSchema();
  const bytes = readFileSync(artifact(repository));
  assert.equal(bytes.toString('utf8'), generated.sql);
  assert.deepEqual(Object.fromEntries(Object.entries(generated.tables)), RUNTIME_TABLES);
  assert.deepEqual(RUNTIME_MODELS.map(model => model.id), ['executions', 'attempts', 'audit', 'outbox', 'approvals',
    'storage_routes', 'storage_grants', 'storage_mutations', 'storage_source_receipts']);
  assert.deepEqual(RUNTIME_MODELS.find(model => model.id === 'approvals').indexes.map(index => index.id),
    ['request', 'actor-state', 'expiry']);
  assert.equal(report.models, RUNTIME_MODELS.length); assert.equal(report.statements, generated.statements.length);
  assert.equal(report.sqlBytes, bytes.length);
  assert.equal(report.sqlDigest, `sha256-${createHash('sha256').update(bytes).digest('hex')}`);
  assert.equal(report.checked, true); assert.equal(report.artifactChanged, false); assert.equal(report.databaseChanged, false);
});

test('checking refuses stale SQL without rewriting it; explicit writing creates only the fixed artifact', t => {
  const root = temporaryDirectory(t, 'creezio-runtime-sql-');
  assert.throws(() => prepareRuntimeSchema({ root }), { code: 'runtime.schema-path' });
  assert.deepEqual(readdirSync(root), []);
  const created = prepareRuntimeSchema({ root, check: false });
  assert.equal(created.artifactChanged, true); assert.equal(created.databaseChanged, false);
  assert.deepEqual(readdirSync(root), ['data']); assert.deepEqual(readdirSync(path.join(root, 'data')), ['schema']);
  assert.deepEqual(readdirSync(path.join(root, 'data/schema')), ['runtime.sql']);
  const original = readFileSync(artifact(root), 'utf8'), before = statSync(artifact(root)).mtimeMs;
  assert.equal(prepareRuntimeSchema({ root, check: false }).artifactChanged, false);
  assert.equal(statSync(artifact(root)).mtimeMs, before);
  const stale = original + '\n-- unapproved byte change\n'; writeFileSync(artifact(root), stale);
  assert.throws(() => prepareRuntimeSchema({ root }), { code: 'runtime.schema-mismatch' });
  assert.equal(readFileSync(artifact(root), 'utf8'), stale);
  assert.equal(prepareRuntimeSchema({ root, check: false }).artifactChanged, true);
  assert.equal(readFileSync(artifact(root), 'utf8'), original);
  assert.equal(prepareRuntimeSchema({ root }).checked, true);
});

test('artifact preparation refuses configurable model/database sources, accessors and linked ancestors', t => {
  let called = false;
  assert.throws(() => prepareRuntimeSchema({ get db() { called = true; throw new Error('Must remain inert'); } }), { code: 'runtime.schema-input' });
  assert.equal(called, false);
  assert.throws(() => prepareRuntimeSchema({ check: 'false' }), { code: 'runtime.schema-input' });
  assert.throws(() => prepareRuntimeSchema({ models: [] }), { code: 'runtime.schema-input' });
  const root = temporaryDirectory(t, 'creezio-runtime-sql-links-'), target = path.join(root, 'target'), link = path.join(root, 'data');
  mkdirSync(target); symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => prepareRuntimeSchema({ root, check: false }), { code: 'runtime.schema-path' }); assert.deepEqual(readdirSync(target), []); }
  finally { unlinkSync(link); }
});
