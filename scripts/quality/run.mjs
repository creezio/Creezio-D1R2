import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectTap, tapFailureExcerpt, sourceIdentity, sameSourceIdentity, collectRequiredTests } from './evidence.mjs';
import { validateDocs } from './docs.mjs';
import { measureRuntimeArtifacts } from './runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const started = new Date().toISOString();
const evidencePath = resolve(root, '.quality/latest.json');
mkdirSync(dirname(evidencePath), { recursive: true });
const write = value => writeFileSync(evidencePath, JSON.stringify(value, null, 2) + '\n');
const profile = 't32-cloudflare';
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
execute('sdk-build', ['scripts/sdk/build.mjs']);
execute('compose', ['scripts/build/compose-runtime.mjs']);
execute('data-models', ['scripts/data/prepare-access.mjs']);
execute('runtime-models', ['scripts/data/prepare-runtime.mjs']);
execute('module-models', ['scripts/data/prepare-modules-settings.mjs']);
execute('module-suites', ['extensions/native/modules-settings/gate.mjs']);
execute('conversations-models', ['scripts/data/prepare-native-module.mjs', 'conversations']);
execute('conversations-suites', ['extensions/native/conversations/gate.mjs']);
execute('openai-models', ['scripts/data/prepare-native-module.mjs', 'openai']);
execute('openai-suites', ['extensions/native/openai/gate.mjs']);
execute('delivery-suites', ['extensions/native/delivery/gate.mjs']);
execute('widgets-witness-suites', ['extensions/widgets-witness/gate.mjs']);
execute('theme-standard-suites', ['themes/standard/gate.mjs']);
execute('theme-chatgpt-suites', ['themes/chatgpt-like/gate.mjs']);
execute('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
execute('build', ['scripts/run-framework.mjs', 'build']);
// T15's 126-file Windows suite measured 329s, then exceeded 360s under local load.
// Keep a bounded aggregate margin; per-test deadlines and complete TAP remain required.
// This harness deadline does not change any product deadline or permit an incomplete TAP result.
const testStarted = performance.now();
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...tests],
  { cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
const testDurationMs = Math.round(performance.now() - testStarted);
// Preserve failing diagnostics before a bounded console tail hides early failures.
writeFileSync(resolve(root, '.quality/tests-latest.tap'), result.stdout ?? '');
writeFileSync(resolve(root, '.quality/tests-latest.stderr.log'), result.stderr ?? '');
const tap = inspectTap(result.stdout ?? '', result.status);
const unchanged = sameSourceIdentity(source, sourceIdentity(root));
let runtime;
try { runtime = JSON.parse(readFileSync(resolve(root, '.quality/runtime-latest.json'), 'utf8')); } catch { runtime = null; }
const runtimeCurrent = runtime?.status === 'passed' && Date.parse(runtime.started) >= Date.parse(started)
  && Date.parse(runtime.finished) >= Date.parse(runtime.started) && Date.parse(runtime.finished) <= Date.now()
  && runtime.artifact?.digest === measureRuntimeArtifacts(root).digest;
const success = docs.errors.length === 0 && tap.success && unchanged && runtimeCurrent;
const report = { schemaVersion: 1, profile, started, finished: new Date().toISOString(),
  source, results: { docs, commands, tests: { ...tap, files: tests, exitCode: result.status, durationMs: testDurationMs }, runtime,
    runtimeEvidenceCurrent: runtimeCurrent, sourceUnchanged: unchanged },
  success, state: success ? 'passed' : 'failed', mergeReady: false,
  limits: ['Native Access, OAuth and MCP transports are tested within the listed suites; the browser and ChatGPT recipes are recorded separately',
    'This aggregate does not certify all native modules, hosted CMS parity, provider onboarding or remote CI provenance'] };
write(report);
console.log(JSON.stringify({ success, mergeReady: false, source: source.sha256, docs: docs.metrics,
  tests: tap, runtimeEvidenceCurrent: runtimeCurrent, sourceUnchanged: unchanged, evidence: '.quality/latest.json' }, null, 2));
if (!success) {
  for (const error of docs.errors) console.error(JSON.stringify(error));
  if (!runtimeCurrent) console.error('Missing, failed, stale or changed runtime artifact evidence.');
  if (!tap.success) console.error(tapFailureExcerpt(result.stdout ?? '') || (result.stdout ?? '').slice(-12000),
    result.stderr ?? '', result.error?.message ?? '');
  process.exitCode = 1;
}
} catch (error) {
  write({ schemaVersion: 1, profile, started, finished: new Date().toISOString(),
    state: 'failed', success: false, mergeReady: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
