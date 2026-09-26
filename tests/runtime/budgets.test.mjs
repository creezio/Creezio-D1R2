import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntimeBudgets, RUNTIME_BUDGETS } from '../../scripts/quality/runtime.mjs';

const valid = () => ({
  artifact: { worker: { bytes: 700_000, gzipBytes: 220_000 } },
  witness: { boundary: { inputs: ['core.ts', 'module.ts'] } },
  durationsMs: { startup: 500, restart: 500, homepage: 100, staticAsset: 100, health: 10, witness: 10, storageRoundtrip: 100 },
});

test('runtime ceilings reject size, import graph and latency regressions rather than only reporting them', () => {
  assert.deepEqual(assertRuntimeBudgets(valid()), RUNTIME_BUDGETS);
  const tooLarge = valid(); tooLarge.artifact.worker.bytes = RUNTIME_BUDGETS.workerBytes + 1;
  assert.throws(() => assertRuntimeBudgets(tooLarge), /workerBytes/);
  const tooCompressed = valid(); tooCompressed.artifact.worker.gzipBytes = RUNTIME_BUDGETS.workerGzipBytes + 1;
  assert.throws(() => assertRuntimeBudgets(tooCompressed), /workerGzipBytes/);
  const tooMany = valid(); tooMany.witness.boundary.inputs = Array(RUNTIME_BUDGETS.selectedGraphInputs + 1).fill('dependency');
  assert.throws(() => assertRuntimeBudgets(tooMany), /selectedGraphInputs/);
  for (const key of Object.keys(valid().durationsMs)) {
    const slow = valid(); slow.durationsMs[key] = 20_000;
    assert.throws(() => assertRuntimeBudgets(slow), new RegExp(key));
    delete slow.durationsMs[key];
    assert.throws(() => assertRuntimeBudgets(slow), new RegExp(key));
  }
});
