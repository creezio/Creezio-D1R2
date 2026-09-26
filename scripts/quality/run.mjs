import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectTap, sourceIdentity, sameSourceIdentity, collectRequiredTests } from './evidence.mjs';
import { validateDocs } from './docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const started = new Date().toISOString();
const evidencePath = resolve(root, '.quality/latest.json');
mkdirSync(dirname(evidencePath), { recursive: true });
const write = value => writeFileSync(evidencePath, JSON.stringify(value, null, 2) + '\n');
write({ schemaVersion: 1, profile: 'p0-contracts-local', started, state: 'running', success: false, mergeReady: false });
try {
const source = sourceIdentity(root);
const docs = await validateDocs(root);
const tests = collectRequiredTests(root);
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests],
  { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
const tap = inspectTap(result.stdout ?? '', result.status);
const unchanged = sameSourceIdentity(source, sourceIdentity(root));
const success = docs.errors.length === 0 && tap.success && unchanged;
const report = { schemaVersion: 1, profile: 'p0-contracts-local', started, finished: new Date().toISOString(),
  source, results: { docs, tests: { ...tap, files: tests, exitCode: result.status }, sourceUnchanged: unchanged },
  success, state: success ? 'passed' : 'failed', mergeReady: false,
  limits: ['Local documentation, quality-controller and SDK contract tests; module fixtures are not runtime modules',
    'No remote CI, package installation, dependency lifecycle execution or hosted CMS qualification'] };
write(report);
console.log(JSON.stringify({ success, mergeReady: false, source: source.sha256, docs: docs.metrics,
  tests: tap, sourceUnchanged: unchanged, evidence: '.quality/latest.json' }, null, 2));
if (!success) {
  for (const error of docs.errors) console.error(JSON.stringify(error));
  if (!tap.success) console.error((result.stdout ?? '').slice(-12000), result.stderr ?? '', result.error?.message ?? '');
  process.exitCode = 1;
}
} catch (error) {
  write({ schemaVersion: 1, profile: 'p0-contracts-local', started, finished: new Date().toISOString(),
    state: 'failed', success: false, mergeReady: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
