import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectTap, sourceIdentity, sameSourceIdentity, collectRequiredTests } from './evidence.mjs';
import { validateDocs } from './docs.mjs';
import { measureRuntimeArtifacts } from './runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const started = new Date().toISOString();
const evidencePath = resolve(root, '.quality/latest.json');
mkdirSync(dirname(evidencePath), { recursive: true });
const write = value => writeFileSync(evidencePath, JSON.stringify(value, null, 2) + '\n');
const profile = 't04-identity-storage-local';
write({ schemaVersion: 1, profile, started, state: 'running', success: false, mergeReady: false });
try {
const source = sourceIdentity(root);
const docs = await validateDocs(root);
const tests = collectRequiredTests(root);
const commands = [];
function execute(label, args, timeout = 180_000) {
  const time = performance.now();
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  commands.push({ label, command: ['node', ...args], exitCode: result.status, durationMs: Math.round(performance.now() - time) });
  if (result.status !== 0) throw new Error(`${label} failed.\n${(result.stdout ?? '').slice(-10000)}\n${(result.stderr ?? '').slice(-6000)}\n${result.error?.message ?? ''}`);
}
execute('compose', ['scripts/build/compose-runtime.mjs']);
execute('data-models', ['scripts/data/prepare-access.mjs']);
execute('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
execute('build', ['scripts/run-framework.mjs', 'build']);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...tests],
  { cwd: root, encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024 });
const tap = inspectTap(result.stdout ?? '', result.status);
const unchanged = sameSourceIdentity(source, sourceIdentity(root));
let runtime;
try { runtime = JSON.parse(readFileSync(resolve(root, '.quality/runtime-latest.json'), 'utf8')); } catch { runtime = null; }
const runtimeCurrent = runtime?.status === 'passed' && Date.parse(runtime.started) >= Date.parse(started)
  && Date.parse(runtime.finished) >= Date.parse(runtime.started) && Date.parse(runtime.finished) <= Date.now()
  && runtime.artifact?.digest === measureRuntimeArtifacts(root).digest;
const success = docs.errors.length === 0 && tap.success && unchanged && runtimeCurrent;
const report = { schemaVersion: 1, profile, started, finished: new Date().toISOString(),
  source, results: { docs, commands, tests: { ...tap, files: tests, exitCode: result.status }, runtime,
    runtimeEvidenceCurrent: runtimeCurrent, sourceUnchanged: unchanged },
  success, state: success ? 'passed' : 'failed', mergeReady: false,
  limits: ['Local runtime, identity storage and account services; HTTP login, access UI, persistent roles and mutation authorization remain unimplemented',
    'No remote CI, hosted Sites/Cloudflare, archive installation or dependency lifecycle qualification'] };
write(report);
console.log(JSON.stringify({ success, mergeReady: false, source: source.sha256, docs: docs.metrics,
  tests: tap, runtimeEvidenceCurrent: runtimeCurrent, sourceUnchanged: unchanged, evidence: '.quality/latest.json' }, null, 2));
if (!success) {
  for (const error of docs.errors) console.error(JSON.stringify(error));
  if (!runtimeCurrent) console.error('Missing, failed, stale or changed runtime artifact evidence.');
  if (!tap.success) console.error((result.stdout ?? '').slice(-12000), result.stderr ?? '', result.error?.message ?? '');
  process.exitCode = 1;
}
} catch (error) {
  write({ schemaVersion: 1, profile, started, finished: new Date().toISOString(),
    state: 'failed', success: false, mergeReady: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
