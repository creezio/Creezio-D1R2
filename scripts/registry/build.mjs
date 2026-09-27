import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {assertWorkerBoundary} from '../build/worker-boundary.mjs';

export const registryRoot = fileURLToPath(new URL('../../', import.meta.url));
export async function buildRegistry() {
  const entry = 'services/registry/worker.ts';
  const graph = await assertWorkerBoundary({root: registryRoot, entryPoints: [entry]});
  const sharedTransport = new Set(['core/identity/http-policy.ts', 'adapters/runtime-profiles.ts']);
  if (graph.inputs.some(input => !input.startsWith('services/registry/') && !input.startsWith('sdk/registry/')
    && !sharedTransport.has(input)))
    throw new Error('The registry Worker must remain independent from application code.');
  const result = await build({absWorkingDir: registryRoot, entryPoints: [entry], bundle: true,
    write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent'});
  const bundle = result.outputFiles[0].contents;
  const directory = resolve(registryRoot, '.quality/registry');
  await mkdir(directory, {recursive: true});
  await writeFile(resolve(directory, 'worker.mjs'), bundle);
  const report = {entry, bytes: bundle.byteLength,
    artifactDigest: `sha256-${createHash('sha256').update(bundle).digest('hex')}`, inputs: graph.inputs};
  await writeFile(resolve(directory, 'build.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await buildRegistry()));
