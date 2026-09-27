import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function runSuite(name) {
  if (!['backend', 'ui', 'api-mcp', 'widgets', 'package', 'docs'].includes(name)) throw new Error('Unknown suite');
  const manifest = JSON.parse(readFileSync(new URL('../module/manifest.json', import.meta.url), 'utf8'));
  const suite = manifest.validation.suites[name];
  const tests = suite?.tests;
  if (!Array.isArray(tests) || !tests.length || new Set(tests).size !== tests.length
    || tests.some(file => typeof file !== 'string'
      || !new RegExp(`^tests/${name}/[A-Za-z0-9._-]+\\.test\\.mjs$`).test(file)))
    throw new Error(`Invalid ${name} tests`);
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
    ...tests.map(file => path.join(root, file))], {cwd: root, encoding: 'utf8', timeout: 15000});
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...(result.stdout ?? '').matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    counts[key] = matches.length === 1 ? Number(matches[0][1]) : null;
  }
  if (result.status !== 0 || !(counts.tests > 0) || counts.pass !== counts.tests
    || ['fail', 'cancelled', 'skipped', 'todo'].some(key => counts[key] !== 0))
    throw new Error(`Suite ${name} failed: ${result.stdout ?? ''}${result.stderr ?? ''}`);
  return {suite: name, status: suite.mode === 'not-applicable' ? 'not-applicable' : 'passed', tests: counts.tests,
    justification: suite.justification ?? null};
}
