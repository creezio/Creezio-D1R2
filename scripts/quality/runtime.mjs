import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Local ceilings include Access, Modules, Conversations and optional OpenAI with SSR.
// T15 measured 3,751,835 raw / 722,469 gzip bytes after adding provider transport,
// encrypted configuration, turn bridge, tool schemas and UI. Preserve a bounded
// margin of about 3%; graph and timing ceilings are unchanged.
// They are neither provider quotas nor production latency guarantees.
export const RUNTIME_BUDGETS = Object.freeze({ workerBytes: 3_850_000, workerGzipBytes: 750_000,
  selectedGraphInputs: 32, startupMs: 15_000, routeMs: 3_000 });

export function assertRuntimeBudgets(report) {
  const check = (name, value, limit) => {
    if (!Number.isFinite(value) || value < 0 || value > limit) throw new Error(`Local runtime budget ${name} exceeded: ${value} > ${limit}.`);
  };
  check('workerBytes', report.artifact.worker.bytes, RUNTIME_BUDGETS.workerBytes);
  check('workerGzipBytes', report.artifact.worker.gzipBytes, RUNTIME_BUDGETS.workerGzipBytes);
  check('selectedGraphInputs', report.witness.boundary.inputs.length, RUNTIME_BUDGETS.selectedGraphInputs);
  for (const name of ['startup', 'restart']) check(name, report.durationsMs[name], RUNTIME_BUDGETS.startupMs);
  for (const name of ['homepage', 'staticAsset', 'health', 'witness', 'storageRoundtrip']) check(name, report.durationsMs[name], RUNTIME_BUDGETS.routeMs);
  return RUNTIME_BUDGETS;
}

/** Local artifact measurement only: this does not prove browser or hosted behavior. */
export function measureRuntimeArtifacts(root) {
  const directory = resolve(root);
  function walk(path) {
    return readdirSync(path).sort().flatMap(name => {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Runtime evidence refuses linked artifacts.');
      return stat.isDirectory() ? walk(file) : [file];
    });
  }
  const files = [...walk(join(directory, 'dist/server')), ...walk(join(directory, 'dist/client'))]
    .map(file => {
      const bytes = readFileSync(file), path = relative(directory, file).replaceAll('\\', '/');
      return { path, bytes: bytes.length, sha256: hash(bytes),
        ...(path.startsWith('dist/server/') && /\.(?:m?js)$/.test(path) ? { gzipBytes: gzipSync(bytes).length } : {}) };
    });
  const workerFiles = files.filter(file => file.gzipBytes !== undefined);
  if (!workerFiles.some(file => file.path === 'dist/server/index.js')) throw new Error('A complete built Worker is required.');
  return {
    digest: `sha256-${hash(JSON.stringify(files))}`,
    worker: { files: workerFiles.length, bytes: workerFiles.reduce((total, file) => total + file.bytes, 0),
      gzipBytes: workerFiles.reduce((total, file) => total + file.gzipBytes, 0) },
    assets: { files: files.filter(file => file.path.startsWith('dist/client/')).length,
      bytes: files.filter(file => file.path.startsWith('dist/client/')).reduce((total, file) => total + file.bytes, 0) },
    files,
  };
}
