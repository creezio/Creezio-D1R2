import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export function runSuite(name) {
  if (!['backend','ui','api-mcp','widgets','package','docs'].includes(name)) throw new Error('Unknown module suite');
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(root, 'tests', name, 'contract.test.mjs')], {cwd: root,encoding:'utf8',timeout:15000});
  const counts = {};
  for (const key of ['tests','pass','fail','cancelled','skipped','todo']) {
    const matches = [...(result.stdout ?? '').matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gm'))];
    counts[key] = matches.length === 1 ? Number(matches[0][1]) : null;
  }
  const ok = result.status === 0 && counts.tests > 0 && counts.pass === counts.tests && ['fail','cancelled','skipped','todo'].every(key => counts[key] === 0);
  if (!ok) throw new Error('Suite '+name+' failed or did not execute completely: '+(result.stdout ?? '')+(result.stderr ?? ''));
  const manifest = JSON.parse(readFileSync(new URL('../module/manifest.json',import.meta.url),'utf8'));
  const suite = manifest.validation.suites[name];
  return {suite:name,status:suite.mode === 'not-applicable' ? 'not-applicable' : 'passed',tests:counts.tests,justification:suite.justification ?? null};
}
