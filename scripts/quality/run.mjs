import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditedParallelTests, inspectTap, inspectTapPhases, partitionRequiredTests, remainingTestBudgetMs,
  tapFailureExcerpt, slowestTapSubtests, sourceIdentity, sameSourceIdentity, collectRequiredTests } from './evidence.mjs';
import { validateDocs } from './docs.mjs';
import { assertArtifactBudgets, measureRuntimeArtifacts } from './runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const started = new Date().toISOString();
const evidencePath = resolve(root, '.quality/latest.json');
mkdirSync(dirname(evidencePath), { recursive: true });
const write = value => writeFileSync(evidencePath, JSON.stringify(value, null, 2) + '\n');
const profile = 't32-cloudflare';
write({ schemaVersion: 1, profile, started, state: 'running', success: false, mergeReady: false });
let earlyArtifactFailure = null;
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
execute('messaging-models', ['scripts/data/prepare-native-module.mjs', 'messaging']);
execute('messaging-suites', ['extensions/native/messaging/gate.mjs']);
execute('crm-models', ['scripts/data/prepare-native-module.mjs', 'crm']);
execute('crm-suites', ['extensions/native/crm/gate.mjs']);
for (const name of ['support', 'pages-navigation', 'analytics']) {
  execute(`${name}-models`, ['scripts/data/prepare-native-module.mjs', name]);
}
execute('catalog-models', ['scripts/data/prepare-native-module.mjs', 'catalog', '--family=common']);
execute('n8n-models', ['scripts/data/prepare-native-module.mjs', 'n8n', '--family=connectors']);
execute('stripe-models', ['scripts/data/prepare-native-module.mjs', 'stripe', '--family=connectors']);
execute('meili-models', ['scripts/data/prepare-native-module.mjs', 'meili', '--family=connectors']);
for (const name of ['granola','resend','hermes']) {
  execute(`${name}-models`, ['scripts/data/prepare-native-module.mjs', name, '--family=connectors']);
}
// These modules run their six suites from their actual runtime/validation
// archives with the packed public SDK, not from hidden Core source imports.
const sdkPackage=JSON.parse(readFileSync(resolve(root,'sdk/package.json'),'utf8'));
if(sdkPackage.name!=='@creezio/sdk'||!/^\d+\.\d+\.\d+$/.test(sdkPackage.version)
  ||!process.env.npm_execpath)throw new Error('Run the official npm run check entry with a stable SDK package version.');
const sdkDirectory=resolve(root,'.quality/sdk-validation');
mkdirSync(sdkDirectory,{recursive:true});
execute('sdk-validation-pack',[process.env.npm_execpath,'pack','--workspace','sdk','--ignore-scripts','--json',
  '--pack-destination',sdkDirectory]);
const sdkArchive=resolve(sdkDirectory,`creezio-sdk-${sdkPackage.version}.tgz`);
const sdkSha=createHash('sha256').update(readFileSync(sdkArchive)).digest('hex');
execute('module-archive-suites',['scripts/modules/validate-archives.mjs','--sdk-archive',sdkArchive,
  '--sdk-sha256',sdkSha,'extensions/native/delivery','extensions/native/messaging',
  'extensions/native/support','extensions/native/pages-navigation',
  'extensions/native/analytics','extensions/common/catalog','extensions/connectors/n8n',
  'extensions/connectors/stripe','extensions/connectors/meili','extensions/connectors/granola',
  'extensions/connectors/resend','extensions/connectors/hermes'],180_000);
execute('delivery-suites', ['extensions/native/delivery/gate.mjs']);
execute('widgets-witness-suites', ['extensions/widgets-witness/gate.mjs']);
execute('theme-standard-suites', ['themes/standard/gate.mjs']);
execute('theme-chatgpt-suites', ['themes/chatgpt-like/gate.mjs']);
execute('typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']);
execute('build', ['scripts/run-framework.mjs', 'build']);
// Refuse an oversized build before the long aggregate. The runtime witness below
// still checks these same limits with its graph and timing evidence.
const artifactStarted = performance.now();
const builtArtifact = measureRuntimeArtifacts(root);
earlyArtifactFailure = { source, results: { docs, commands, artifact: {
  digest: builtArtifact.digest, worker: builtArtifact.worker, assets: builtArtifact.assets },
  tests: { state: 'not_started', requiredFiles: tests, executed: 0 },
  runtimeEvidenceCurrent: false } };
try {
  assertArtifactBudgets(builtArtifact);
  commands.push({ label: 'artifact-budgets', command: ['internal', 'assertArtifactBudgets'],
    exitCode: 0, durationMs: Math.round(performance.now() - artifactStarted) });
} catch (error) {
  commands.push({ label: 'artifact-budgets', command: ['internal', 'assertArtifactBudgets'],
    exitCode: 1, durationMs: Math.round(performance.now() - artifactStarted) });
  throw error;
}
earlyArtifactFailure = null;
// Only these audited files use test concurrency 2. All other and newly added
// files stay serial. Both phases share the original 900s aggregate deadline.
const partition = partitionRequiredTests(tests, auditedParallelTests);
const testStarted = performance.now();
const deadline = testStarted + 900_000;
const phaseResults = [];
let phaseNotStarted = null;
for (const [name, files, concurrency] of [
  ['parallel', partition.parallel, 2], ['serial', partition.serial, 1],
]) {
  const remaining = remainingTestBudgetMs(deadline, performance.now());
  if (remaining === 0) { phaseNotStarted = name; break; }
  const phaseStarted = performance.now();
  const result = spawnSync(process.execPath,
    ['--test', `--test-concurrency=${concurrency}`, '--test-reporter=tap', ...files],
    { cwd: root, encoding: 'utf8', timeout: remaining, maxBuffer: 8 * 1024 * 1024 });
  const tapFile = `.quality/tests-latest-${name}.tap`;
  const stderrFile = `.quality/tests-latest-${name}.stderr.log`;
  writeFileSync(resolve(root, tapFile), result.stdout ?? '');
  writeFileSync(resolve(root, stderrFile), result.stderr ?? '');
  const phase = { name, files, concurrency, exitCode: result.status,
    durationMs: Math.round(performance.now() - phaseStarted),
    timedOut: result.error?.code === 'ETIMEDOUT', tapFile, stderrFile,
    tap: inspectTap(result.stdout ?? '', result.status), stdout: result.stdout ?? '',
    stderr: result.stderr ?? '', error: result.error?.message ?? null };
  phaseResults.push(phase);
  if (!phase.tap.success) break;
}
const testDurationMs = Math.round(performance.now() - testStarted);
const tap = inspectTapPhases(phaseResults, tests);
const slowestSubtests = phaseResults.flatMap(phase => slowestTapSubtests(phase.stdout)
  .map(row => ({ ...row, phase: phase.name })))
  .sort((a, b) => b.durationMs - a.durationMs).slice(0, 12);
const phaseReports = phaseResults.map(({ stdout, stderr, error, ...phase }) => phase);
const unchanged = sameSourceIdentity(source, sourceIdentity(root));
let runtime;
try { runtime = JSON.parse(readFileSync(resolve(root, '.quality/runtime-latest.json'), 'utf8')); } catch { runtime = null; }
const runtimeCurrent = runtime?.status === 'passed' && Date.parse(runtime.started) >= Date.parse(started)
  && Date.parse(runtime.finished) >= Date.parse(runtime.started) && Date.parse(runtime.finished) <= Date.now()
  && runtime.artifact?.digest === measureRuntimeArtifacts(root).digest;
const success = docs.errors.length === 0 && tap.success && unchanged && runtimeCurrent;
const report = { schemaVersion: 1, profile, started, finished: new Date().toISOString(),
  source, results: { docs, commands, tests: { ...tap, files: tests, phases: phaseReports,
    phaseNotStarted, durationMs: testDurationMs }, runtime,
    runtimeEvidenceCurrent: runtimeCurrent, sourceUnchanged: unchanged },
  success, state: success ? 'passed' : 'failed', mergeReady: false,
  limits: ['Native Access, OAuth and MCP transports are tested within the listed suites; the browser and ChatGPT recipes are recorded separately',
    'This aggregate does not certify all native modules, hosted CMS parity, provider onboarding or remote CI provenance'] };
write(report);
console.log(JSON.stringify({ success, mergeReady: false, source: source.sha256, docs: docs.metrics,
  tests: tap, testDurationMs, slowestSubtests, phases: phaseReports.map(({ files, ...phase }) =>
    ({ ...phase, fileCount: files.length })), phaseNotStarted,
  commands: commands.map(({label, exitCode, durationMs}) => ({label, exitCode, durationMs})),
  runtime: runtime ? {status: runtime.status, artifact: runtime.artifact ? {
    digest: runtime.artifact.digest, worker: runtime.artifact.worker, assets: runtime.artifact.assets
  } : null, durationsMs: runtime.durationsMs} : null,
  runtimeEvidenceCurrent: runtimeCurrent, sourceUnchanged: unchanged, evidence: '.quality/latest.json' }, null, 2));
if (!success) {
  for (const error of docs.errors) console.error(JSON.stringify(error));
  if (!runtimeCurrent) console.error('Missing, failed, stale or changed runtime artifact evidence.');
  if (!tap.success) {
    if (phaseNotStarted) console.error(`Test phase ${phaseNotStarted} not started: shared 900s budget exhausted.`);
    for (const phase of phaseResults.filter(item => !item.tap.success)) {
      console.error(`${phase.name} TAP incomplete: ${phase.tap.reason}`,
        tapFailureExcerpt(phase.stdout) || phase.stdout.slice(-12000),
        phase.stderr.slice(-6000), phase.error ?? '');
    }
  }
  process.exitCode = 1;
}
} catch (error) {
  write({ schemaVersion: 1, profile, started, finished: new Date().toISOString(),
    ...(earlyArtifactFailure ?? {}),
    state: 'failed', success: false, mergeReady: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}
