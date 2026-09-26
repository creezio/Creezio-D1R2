import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, symlinkSync, rmdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { composeRuntime } from '../../scripts/build/compose-runtime.mjs';
import { assertWorkerBoundary } from '../../scripts/build/worker-boundary.mjs';
import { measureRuntimeArtifacts, assertRuntimeBudgets } from '../../scripts/quality/runtime.mjs';
import { contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { qualificationState, qualificationScratch } from './harness/state.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const compatibilityDate = '2026-05-15';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const stateBindings = { d1Databases: { DB: 'creezio-t03-synthetic-d1' }, r2Buckets: { BUCKET: 'creezio-t03-synthetic-r2' } };

async function witnessBundle() {
  const outputDir = '.quality/runtime-witness-generated';
  const generated = await composeRuntime({ root, compositionPath: 'configuration/composition.witness.json',
    lockPath: 'configuration/composition.witness.lock.json', outputDir });
  assert.equal(generated.moduleCount, 1);
  const boundary = await assertWorkerBoundary({ root, entryPoints: [`${outputDir}/server.ts`, 'core/runtime/dispatch.ts'] });
  const result = await build({ absWorkingDir: root, bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    stdin: { resolveDir: root, sourcefile: '.quality/runtime-harness-entry.ts', loader: 'ts', contents:
      `import { createRuntime } from './core/runtime/dispatch.ts';
       import { modules, compositionDigest } from './${outputDir}/server.ts';
       const runtime = createRuntime({ modules, compositionDigest });
       export default { async fetch(request, env, ctx) {
         return await runtime.fetch(request, env, ctx) ?? new Response('Not found', {status:404});
       }};` },
  });
  const script = result.outputFiles[0].text;
  return { script, boundary, digest: digest(script), compositionDigest: generated.compositionDigest };
}

test('selected Worker graph rejects transitively imported filesystem and TCP Node APIs', async () => {
  for (const entry of ['entry.ts', 'tcp.ts']) await assert.rejects(
    assertWorkerBoundary({ root, entryPoints: [`tests/runtime/fixtures/incompatible/${entry}`] }),
    /Selected application code cannot import Node builtin/,
  );
});

test('selected Worker graph refuses transitive paths outside its root and linked sources', async () => {
  const scratch = qualificationScratch(root);
  const selected = join(scratch.directory, 'selected'), outside = join(scratch.directory, 'outside');
  mkdirSync(selected); mkdirSync(outside); writeFileSync(join(outside, 'value.ts'), 'export const value = 1;');
  const entry = join(selected, 'entry.ts'), linked = join(selected, 'linked');
  let linkCreated = false;
  try {
    writeFileSync(entry, "import { value } from '../outside/value.ts'; export { value };\n");
    await assert.rejects(assertWorkerBoundary({ root: selected, entryPoints: ['entry.ts'] }), /Selected Worker import escapes/);
    symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir'); linkCreated = true;
    writeFileSync(entry, "import { value } from './linked/value.ts'; export { value };\n");
    await assert.rejects(assertWorkerBoundary({ root: selected, entryPoints: ['entry.ts'] }), /Selected Worker import traverses a link/);
  } finally {
    if (linkCreated) { if (process.platform === 'win32') rmdirSync(linked); else unlinkSync(linked); } // Remove only this test's link, never the target directory.
    scratch.cleanup();
  }
});

test('normal application build refuses incompatible server and UI imports before replacing the valid artifact', { timeout: 75000 }, async () => {
  const artifactBefore = measureRuntimeArtifacts(root).digest;
  const scratch = qualificationScratch(root);
  try {
    const base = join(root, 'tests/runtime/fixtures/module-witness');
    const manifest = JSON.parse(readFileSync(join(base, 'module/manifest.json'), 'utf8'));
    const target = join(scratch.directory, 'module');
    for (const file of new Set(['module/manifest.json', ...manifest.packaging.runtime.files])) {
      const destination = join(target, file); mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join(base, file)));
    }
    const composition = JSON.parse(readFileSync(join(root, 'configuration/composition.witness.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(root, 'configuration/composition.witness.lock.json'), 'utf8'));
    composition.modules[0].source.path = slash(relative(root, target));
    lock.compositionIntegrity = contractIntegrity(composition);
    const compositionPath = join(scratch.directory, 'composition.json'), lockPath = join(scratch.directory, 'composition.lock.json');
    writeFileSync(compositionPath, JSON.stringify(composition)); writeFileSync(lockPath, JSON.stringify(lock));
    const variants = [
      { file: 'module/operations.ts', code: "import { readFileSync } from 'node:fs';\nexport function read_status() { return readFileSync('not-an-application-file'); }\nexport function read_protected() { throw new Error('unreachable'); }\n" },
      { file: 'ui/front/view.ts', code: "import { readFileSync } from 'node:fs';\nexport function view() { return readFileSync('not-an-application-file', 'utf8'); }\n" },
    ];
    for (const variant of variants) {
      writeFileSync(join(target, variant.file), variant.code);
      try {
        const run = spawnSync(process.execPath, ['scripts/run-framework.mjs', 'build'], { cwd: root, encoding: 'utf8',
          timeout: 30000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env,
            CREEZIO_COMPOSITION: compositionPath, CREEZIO_COMPOSITION_LOCK: lockPath } });
        assert.equal(run.error, undefined, variant.file); assert.notEqual(run.status, 0, variant.file);
        assert.match(`${run.stdout}\n${run.stderr}`, /Selected application code cannot import Node builtin node:fs/, variant.file);
        assert.equal(measureRuntimeArtifacts(root).digest, artifactBefore, `${variant.file}: refused candidate must preserve the existing build.`);
      } finally {
        // Each variant changes one contribution only; UI rejection cannot rely on a still-invalid handler.
        writeFileSync(join(target, variant.file), readFileSync(join(base, variant.file)));
      }
    }
  } finally {
    await composeRuntime({ root, compositionPath: 'configuration/composition.json', lockPath: 'configuration/composition.lock.json' });
    scratch.cleanup();
  }
});

test('actual Vinext Worker, static assets, selected module and persistent D1/R2 run in workerd', { timeout: 90000 }, async t => {
  const started = new Date().toISOString();
  // The aggregate builds dist first. Missing/failed builds are errors, never skipped tests.
  const artifacts = measureRuntimeArtifacts(root);
  const witness = await witnessBundle();
  const report = { status: 'running', started, finished: null, qualification: 'local-workerd',
    artifact: artifacts, witness: { digest: witness.digest, compositionDigest: witness.compositionDigest, boundary: witness.boundary },
    durationsMs: {}, limitations: ['No browser hydration assertion', 'No hosted Sites or Cloudflare deployment',
      'No authenticated application operation', 'D1/R2 writes use an internal synthetic harness only'] };
  mkdirSync(join(root, '.quality'), { recursive: true });
  const reportPath = join(root, '.quality/runtime-latest.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const state = qualificationState(root);
  const options = {
    host: '127.0.0.1', port: 0, cf: false,
    d1Persist: join(state.directory, 'd1'), r2Persist: join(state.directory, 'r2'),
    workers: [
      { name: 'creezio-built', modules: [
          { type: 'ESModule', path: join(root, 'dist/server/index.js') },
          ...artifacts.files.filter(file => file.gzipBytes !== undefined && file.path !== 'dist/server/index.js')
            .map(file => ({ type: 'ESModule', path: join(root, file.path) })),
        ], modulesRoot: join(root, 'dist/server'),
        compatibilityDate, compatibilityFlags: ['nodejs_compat'], bindings: { CREEZIO_RUNTIME_PROFILE: 'local' },
        ...stateBindings, assets: { directory: join(root, 'dist/client'), binding: 'ASSETS',
          routerConfig: { has_user_worker: true }, assetConfig: { html_handling: 'none', not_found_handling: 'none' } } },
      { name: 'creezio-witness', modules: true, script: witness.script, compatibilityDate,
        bindings: { CREEZIO_RUNTIME_PROFILE: 'local' }, ...stateBindings },
      { name: 'creezio-missing-bindings', modules: true, script: witness.script, compatibilityDate,
        bindings: { CREEZIO_RUNTIME_PROFILE: 'local' } },
      { name: 'qualification-harness', modules: true, scriptPath: join(root, 'tests/runtime/harness/storage-worker.mjs'),
        compatibilityDate, ...stateBindings },
    ],
  };
  let instance;
  let childFailed = false;
  async function check(name, run) {
    await t.test(name, async () => {
      try { await run(); } catch (error) { childFailed = true; throw error; }
    });
  }
  async function start() {
    const start = performance.now(); instance = new Miniflare(options); await instance.ready;
    return performance.now() - start;
  }
  async function timed(name, operation) {
    const start = performance.now(); const value = await operation(); report.durationsMs[name] = performance.now() - start; return value;
  }
  try {
    report.durationsMs.startup = await start();
    await check('full artifact serves SSR and the exact emitted static asset', async () => {
      const response = await timed('homepage', () => instance.dispatchFetch('http://localhost/'));
      assert.equal(response.status, 200, response.status === 200 ? undefined : await response.clone().text());
      const html = await response.text(); assert.match(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), /Votre application commence ici/);
      const asset = artifacts.files.find(file => file.path.startsWith('dist/client/') && /\.js$/.test(file.path));
      assert.ok(asset, 'The full build must contain a browser JavaScript asset.');
      const url = `http://localhost/${asset.path.slice('dist/client/'.length)}`;
      const assetResponse = await timed('staticAsset', () => instance.dispatchFetch(url));
      assert.equal(assetResponse.status, 200); assert.equal(digest(Buffer.from(await assetResponse.arrayBuffer())), asset.sha256);
    });
    await check('full artifact health is JSON; empty composition and unknown API/MCP never serve HTML', async () => {
      const health = await timed('health', () => instance.dispatchFetch('http://localhost/api/health'));
      assert.equal(health.status, 200, health.status === 200 ? undefined : await health.clone().text()); assert.deepEqual(await health.json(), { status: 'ok' });
      for (const route of ['/api/missing', '/mcp/missing', '/api/modules/example.witness/status', '/api/qualification/roundtrip']) {
        const response = await instance.dispatchFetch(`http://localhost${route}`);
        assert.equal(response.status, 404); assert.equal((await response.json()).error.code, 'not_found');
      }
    });
    await check('the generated selected module executes in workerd, only on its allowed HTTP method', async () => {
      const worker = await instance.getWorker('creezio-witness');
      const response = await timed('witness', () => worker.fetch('http://internal/api/modules/example.witness/status'));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { module: 'example.witness', version: '1.0.0', status: 'ready' });
      const denied = await worker.fetch('http://internal/api/modules/example.witness/status', { method: 'POST' });
      assert.equal(denied.status, 405); assert.equal((await denied.json()).error.code, 'method_not_allowed');
    });
    await check('protected module rejects spoofed GPT headers, bearer and cookie without executing handler', async () => {
      const worker = await instance.getWorker('creezio-witness');
      for (const method of ['GET', 'HEAD']) {
        const response = await worker.fetch('http://internal/api/modules/example.witness/protected', { method,
          headers: { authorization: 'Bearer synthetic-not-a-credential', cookie: 'session=synthetic',
            'oai-authenticated-user-id': 'synthetic-owner', 'oai-authenticated-user-email': 'owner@example.invalid',
            'oai-authenticated-user-full-name': 'Synthetic Owner', 'x-creezio-request-id': 'spoofed' } });
        assert.equal(response.status, 401);
        assert.match(response.headers.get('x-creezio-request-id'), /^[0-9a-f-]{36}$/);
        if (method === 'HEAD') assert.equal(await response.text(), '');
        else assert.equal((await response.json()).error.code, 'authentication_required');
      }
    });
    await check('missing D1/R2 bindings fail closed in workerd', async () => {
      const worker = await instance.getWorker('creezio-missing-bindings');
      const response = await worker.fetch('http://internal/api/health');
      assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'runtime_unavailable');
    });
    let expected;
    await check('internal harness writes and reads synthetic data through real D1 and R2', async () => {
      const worker = await instance.getWorker('qualification-harness');
      const response = await timed('storageRoundtrip', () => worker.fetch('http://internal/roundtrip', { method: 'POST' }));
      assert.equal(response.status, 200); expected = await response.json();
      assert.equal(expected.database, 'Creezio T03 — synthetic persistent fixture');
      assert.equal(expected.object, expected.database);
    });
    await check('both bindings persist after the workerd process is disposed and restarted', async () => {
      await instance.dispose(); instance = undefined;
      report.durationsMs.restart = await start();
      const worker = await instance.getWorker('qualification-harness');
      const response = await worker.fetch('http://internal/record');
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected);
    });
    await check('artifact and measured workerd durations stay within local regression budgets', async () => {
      report.budgets = assertRuntimeBudgets(report);
    });
    report.status = childFailed ? 'failed' : 'passed';
  } finally {
    try { if (instance) await instance.dispose(); }
    finally { state.cleanup(); }
    if (report.status !== 'passed') report.status = 'failed';
    report.finished = new Date().toISOString();
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    t.diagnostic(JSON.stringify({ qualification: report.qualification, status: report.status, artifactDigest: artifacts.digest,
      worker: artifacts.worker, assets: artifacts.assets, durationsMs: report.durationsMs }));
  }
});
