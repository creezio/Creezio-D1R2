import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Local ceilings for Access + Modules + Conversations, including SSR. T14's
// measured default composition is 3,493,827 raw / 686,257 gzip bytes. The new
// conversation handlers, 7 data models, static operation validators and original
// chat UI account for this expansion; the front recipe is smaller (2,711,535 /
// 593,206). Keep a small regression margin. Graph and timing ceilings are unchanged.
// They are neither provider quotas nor production latency guarantees.
export const RUNTIME_BUDGETS = Object.freeze({ workerBytes: 3_600_000, workerGzipBytes: 710_000,
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
