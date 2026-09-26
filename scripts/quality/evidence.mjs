import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';

/** TAP counters are necessary as well as process success: skipped/empty is not a pass. */
export function inspectTap(output, exitCode) {
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    if (matches.length !== 1) return { success: false, reason: `Missing or ambiguous ${key} counter` };
    counts[key] = Number(matches[0][1]);
  }
  const success = exitCode === 0 && counts.tests > 0 && counts.pass === counts.tests
    && ['fail', 'cancelled', 'skipped', 'todo'].every(key => counts[key] === 0);
  return { success, counts, reason: success ? null : 'Nonzero exit, missing, failed or unexecuted test' };
}

/** Each approved suite is mandatory; a missing directory cannot silently shrink coverage. */
export function collectRequiredTests(root) {
  const suites = ['quality', 'contracts'];
  const files = [];
  for (const suite of suites) {
    const directory = resolve(root, 'tests', suite);
    for (const entry of [root, resolve(root, 'tests'), directory]) {
      const stat = lstatSync(entry);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Invalid test directory: ${suite}`);
    }
    const names = readdirSync(directory).filter(name => name.endsWith('.test.mjs')).sort();
    if (!names.length) throw new Error(`No tests found in required suite: ${suite}`);
    for (const name of names) {
      const stat = lstatSync(resolve(directory, name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid test file in suite: ${suite}`);
      files.push(`tests/${suite}/${name}`);
    }
  }
  return files;
}

/** Includes untracked sources, excludes ignored evidence, and never follows symlinks. */
export function sourceIdentity(root) {
  root = resolve(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const paths = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort();
  const files = [];
  const aggregate = createHash('sha256');
  for (const path of paths) {
    let hash = null;
    try {
      const absolute = resolve(root, path);
      const inside = relative(root, absolute);
      if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('Source path escapes repository');
      for (let ancestor = absolute; ancestor !== dirname(root); ancestor = dirname(ancestor)) {
        if (lstatSync(ancestor).isSymbolicLink()) throw new Error(`Linked source entry: ${path}`);
      }
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsupported source entry: ${path}`);
      hash = createHash('sha256').update(readFileSync(absolute)).digest('hex');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    files.push({ path, sha256: hash });
    aggregate.update(JSON.stringify([path, hash]) + '\n');
  }
  return { head: git('rev-parse', 'HEAD').trim(), tree: git('rev-parse', 'HEAD^{tree}').trim(),
    dirty: Boolean(git('status', '--porcelain')), sha256: aggregate.digest('hex'), files };
}

export function sameSourceIdentity(before, after) {
  return ['head', 'tree', 'sha256'].every(key => typeof before[key] === 'string' && before[key] === after[key]);
}
