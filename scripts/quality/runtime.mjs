import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// PR81 8eeebf5 adds Sidebar preferences, retention and routed storage integration.
// CI36765247034 measured 19,483,275 raw / 3,487,107 gzip bytes (87 Worker files).
// Qualified main684901c measured 19,229,916 raw / 3,461,963 gzip bytes (86 files).
// The complete feature delta is 253,359 raw / 25,144 gzip bytes, without per-file
// attribution or additional package dependencies. Keep under 1% raw headroom;
// the compressed, import graph and runtime duration ceilings are unchanged.
// Each widget remains independently consumable by MCP Apps hosts. New compositions
// must still be measured explicitly rather than treated as arbitrarily extensible.
// They are neither provider quotas nor production latency guarantees.
export const RUNTIME_BUDGETS = Object.freeze({ workerBytes: 19_600_000, workerGzipBytes: 3_500_000,
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
