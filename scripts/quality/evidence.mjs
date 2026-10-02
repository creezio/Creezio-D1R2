import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { verifyPortableSource } from '../local/source-manifest.mjs';

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

/** Split only an audited allowlist; every required file must run exactly once. */
export const auditedParallelTests = Object.freeze([
  // The only identity file in this phase: its guarded persistent test directory
  // is shared with the identity files that remain in the later serial phase.
  'tests/identity/d1-impersonation.test.mjs',
  // Private Miniflare D1/R2, ephemeral ports, injected provider transports.
  'tests/modules/messaging-delivery-integration.test.mjs',
  'tests/openai/turn-bridge.test.mjs',
  'tests/crm/integration.test.mjs',
  'tests/meili/integration.test.mjs',
  'tests/catalog/integration.test.mjs',
  'tests/analytics/integration.test.mjs',
  'tests/support/integration.test.mjs',
  'tests/stripe/integration.test.mjs',
  'tests/granola/integration.test.mjs',
  'tests/n8n/integration.test.mjs',
  'tests/pages-navigation/integration.test.mjs',
  'tests/connectors/resend-integration.test.mjs',
  'tests/connectors/hermes-integration.test.mjs',
  'tests/modules/crm-transports.test.mjs',
  'tests/modules/support-links-integration.test.mjs',
]);

export function partitionRequiredTests(required, parallelAllowlist) {
  if (new Set(required).size !== required.length ||
      new Set(parallelAllowlist).size !== parallelAllowlist.length ||
      parallelAllowlist.some(file => !required.includes(file))) {
    throw new Error('Invalid parallel test allowlist or required manifest');
  }
  const allowed = new Set(parallelAllowlist);
  const parallel = required.filter(file => allowed.has(file));
  const serial = required.filter(file => !allowed.has(file));
  if (!parallel.length || !serial.length || parallel.length + serial.length !== required.length ||
      new Set([...parallel, ...serial]).size !== required.length) {
    throw new Error('Incomplete or overlapping test partition');
  }
  return { parallel, serial };
}

/** Count only two complete, disjoint TAP phases; never infer success from fragments. */
export function inspectTapPhases(phases, required) {
  if (phases.length !== 2 || phases.some(phase => !phase.tap?.success)) {
    return { success: false, counts: null, reason: 'Missing or incomplete TAP phase' };
  }
  const files = phases.flatMap(phase => phase.files);
  if (files.length !== required.length || new Set(files).size !== required.length ||
      files.some(file => !required.includes(file))) {
    return { success: false, counts: null, reason: 'Phase file manifest mismatch' };
  }
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
    .map(key => [key, phases.reduce((sum, phase) => sum + phase.tap.counts[key], 0)]));
  const success = counts.tests > 0 && counts.pass === counts.tests &&
    ['fail', 'cancelled', 'skipped', 'todo'].every(key => counts[key] === 0);
  return { success, counts: success ? counts : null,
    reason: success ? null : 'Incomplete or skipped test counts' };
}

export function remainingTestBudgetMs(deadline, now) {
  return Math.max(0, Math.floor(deadline - now));
}

/** Diagnostic only: parent TAP durations can contain their children's time. */
export function slowestTapSubtests(output, limit = 12) {
  const rows = [];
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = /^( *)(?:ok|not ok) \d+ - (.+)$/.exec(lines[index]);
    if (!match || match[1].length % 4 !== 0 || lines[index + 1] !== `${match[1]}  ---`) continue;
    for (let next = index + 2; next < Math.min(lines.length, index + 16); next++) {
      if (lines[next] === `${match[1]}  ...`) break;
      const duration = new RegExp(`^${match[1]}  duration_ms: (\\d+(?:\\.\\d+)?)$`).exec(lines[next]);
      if (duration) {
        rows.push({ name: match[2].slice(0, 180), level: match[1].length / 4,
          durationMs: Number(duration[1]) });
        break;
      }
    }
  }
  return rows.sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
}

/** Surface early failures that the aggregate's console tail would otherwise hide. */
export function tapFailureExcerpt(output, {maxFailures = 5, maxChars = 12000} = {}) {
  const lines = output.split(/\r?\n/);
  const failures = [];
  for (let index = 0; index < lines.length && failures.length < maxFailures; index++) {
    const match = /^( *)not ok \d+ - /.exec(lines[index]);
    if (!match) continue;
    const indent = match[1];
    const boundary = new RegExp(`^ {0,${indent.length}}(?:# Subtest: |ok \\d+ - |not ok \\d+ - |1\\.\\.)`);
    const block = [lines[index]];
    while (++index < lines.length) {
      if (boundary.test(lines[index])) { index--; break; }
      block.push(lines[index]);
      if (lines[index] === `${indent}  ...`) break;
    }
    failures.push(block.join('\n'));
  }
  const redacted = failures.join('\n').replace(/\b(Bearer\s+)[^\s'"\]]+/gi, '$1[redacted]')
    .replace(/(['"]?)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)(['"]?\s*[:=]\s*)(['"]?)[^\s,'"}\]]+/gi,
      (_match, opening, key, separator, quote) => `${opening}${key}${separator}${quote}[redacted]`)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]');
  const suffix = '\n[diagnostics truncated]';
  if (redacted.length <= maxChars) return redacted;
  if (maxChars <= suffix.length) return suffix.slice(0, maxChars);
  return `${redacted.slice(0, maxChars - suffix.length)}${suffix}`;
}

/** Each approved suite is mandatory; a missing directory cannot silently shrink coverage. */
export function collectRequiredTests(root) {
  const suites = ['quality', 'contracts', 'runtime', 'identity', 'data', 'operations', 'workspace', 'registry', 'local', 'oauth', 'mcp', 'modules', 'front', 'conversations', 'openai', 'widgets', 'cloudflare', 'crm', 'support', 'pages-navigation', 'analytics', 'catalog', 'connectors', 'n8n', 'stripe', 'meili', 'search', 'granola', 'storage-authority'];
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
  // Docker images omit .git. Their source manifest was exported from a clean Git
  // checkout before build and is checked against every source file here.
  if (!lstatSync(resolve(root, '.git'), {throwIfNoEntry: false})) return verifyPortableSource(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Git status may trust assume-unchanged and skip-worktree index entries without
  // inspecting their working-tree bytes. Refuse those flags before assigning HEAD
  // provenance to the bytes that will be built or exported.
  const flags = git('ls-files', '--cached', '-v', '-z').split('\0').filter(Boolean);
  if (flags.some(entry => entry[0] !== 'H' || entry[1] !== ' ')) {
    const error = new Error('Source index flags hide working-tree changes.');
    error.code = 'source_index_flags';
    throw error;
  }
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
