import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {assertWorkerBoundary} from '../../scripts/build/worker-boundary.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const slash = path => path.replaceAll('\\', '/');
const wrappers = /(?:^|\/)sdk\/(?:operations\/handler\.ts|ui\/(?:assistant-provider\.tsx|index\.ts)|workspace\/(?:components|metadata|toolbar)\.tsx)$/;
const compiled = [
  'operations/error.js',
  'operations/handler.js',
  'ui/assistant-provider-impl.js',
  'workspace/components-impl.js',
  'workspace/metadata-impl.js',
];

function assertInstalledSdkGraph(inputs) {
  const paths = inputs.map(slash);
  for (const file of compiled) assert.ok(paths.includes(`node_modules/@creezio/sdk/dist/esm/${file}`),
    `Selected graph must use the installed SDK export ${file}.`);
  assert.deepEqual(paths.filter(path => wrappers.test(path)), [],
    'Selected graph must not load a source wrapper from the SDK package scope.');
  assert.ok(paths.every(path => !path.startsWith('sdk/dist/')),
    'Selected graph must not use the local SDK build in place of the installed package.');
}

test('selected Worker graph resolves host and native modules through installed SDK exports', async () => {
  const graph = await assertWorkerBoundary({root, entryPoints: [
    '.creezio/generated/server.ts', '.creezio/generated/client.tsx',
    '.creezio/generated/operations.ts', '.creezio/generated/provider-catalog.ts',
    'core/runtime/dispatch.ts', 'core/operations/http.ts',
  ]});
  assertInstalledSdkGraph(graph.inputs);
});

test('Vite config loader graph resolves installed SDK before config execution', async () => {
  const graph = await build({
    absWorkingDir: root, entryPoints: ['vite.config.ts'], bundle: true, write: false,
    metafile: true, platform: 'node', format: 'esm', target: 'node24', preserveSymlinks: true,
    logLevel: 'silent', plugins: [{name: 'external-framework-only', setup(bundler) {
      bundler.onResolve({filter: /^[^./]/}, args => {
        if (args.path.startsWith('@creezio/sdk/')) return undefined;
        return {path: args.path, external: true};
      });
    }}],
  });
  const paths = Object.keys(graph.metafile.inputs).map(slash);
  assert.ok(paths.includes('node_modules/@creezio/sdk/dist/esm/operations/error.js'));
  assert.ok(paths.every(path => !wrappers.test(path)));
  assert.ok(paths.every(path => !path.startsWith('sdk/dist/')));
});

test('host toolbar entry resolves its public SDK export', async () => {
  const graph = await build({
    absWorkingDir: root, entryPoints: ['admin/workspace/page-toolbar-context.tsx'],
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm',
    preserveSymlinks: true, logLevel: 'silent',
  });
  const paths = Object.keys(graph.metafile.inputs).map(slash);
  assert.ok(paths.includes('node_modules/@creezio/sdk/dist/esm/workspace/toolbar-impl.js'));
  assert.ok(paths.every(path => !wrappers.test(path)));
  assert.ok(paths.every(path => !path.startsWith('sdk/dist/')));
});
