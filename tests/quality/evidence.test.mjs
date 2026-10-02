import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditedParallelTests, inspectTap, inspectTapPhases, partitionRequiredTests,
  remainingTestBudgetMs, tapFailureExcerpt, slowestTapSubtests, sourceIdentity,
  sameSourceIdentity, collectRequiredTests } from '../../scripts/quality/evidence.mjs';
import { temporaryDirectory } from './temporary.mjs';

const tap = counts => Object.entries({ tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...counts })
  .map(([key, value]) => `# ${key} ${value}`).join('\n');
test('accepts only a successful, nonempty and fully executed suite', () => {
  assert.equal(inspectTap(tap({}), 0).success, true);
  for (const counts of [{ tests: 0, pass: 0 }, { pass: 1, skipped: 1 }, { pass: 1, todo: 1 },
    { pass: 1, cancelled: 1 }, { pass: 1, fail: 1 }]) assert.equal(inspectTap(tap(counts), 0).success, false);
  assert.equal(inspectTap(tap({}), 1).success, false);
  assert.equal(inspectTap(tap({}), null).success, false);
  assert.equal(inspectTap('', 0).success, false);
  assert.equal(inspectTap(tap({}) + '\n# tests 2', 0).success, false);
});
test('reports early TAP failures with bounded, redacted diagnostics', () => {
  const output = `not ok 1 - first failure\n  ---\n  location: 'tests/early.test.mjs:4:1'\n  error: |-\n    wrong value, password='private-value', "secret":"quoted-private", Bearer private-token\n  ...\n${'ok 2 - later pass\n'.repeat(3000)}`;
  const excerpt = tapFailureExcerpt(output);
  assert.match(excerpt, /not ok 1 - first failure/);
  assert.match(excerpt, /tests\/early\.test\.mjs:4:1/);
  assert.match(excerpt, /wrong value/);
  assert.doesNotMatch(excerpt, /private-value|quoted-private|private-token/);
  assert.ok(excerpt.length <= 12000);
  const long = tapFailureExcerpt(`not ok 1 - long failure\n  ---\n  error: ${'x'.repeat(1000)}\n  ...`, {maxChars: 200});
  assert.ok(long.length <= 200);
  assert.match(long, /\[diagnostics truncated\]$/);
  assert.equal(tapFailureExcerpt('ok 1 - pass\n'), '');
});
test('nested failing subtests retain their actual diagnostic before the parent summary', () => {
  const output = '# Subtest: store\n    # Subtest: delivery\n    not ok 1 - delivery\n      ---\n      error: claim expired\n      ...\n    ok 2 - subsequent\nnot ok 1 - store\n  ---\n  error: 1 subtest failed\n  ...\n';
  const excerpt = tapFailureExcerpt(output);
  assert.match(excerpt, /not ok 1 - delivery/);
  assert.match(excerpt, /error: claim expired/);
  assert.match(excerpt, /error: 1 subtest failed/);
  assert.doesNotMatch(excerpt, /subsequent/);
});

test('slow TAP diagnostic is bounded and distinguishes parent and child durations', () => {
  const output = `# Subtest: parent\n    # Subtest: child\n    ok 1 - child\n      ---\n      duration_ms: 20.5\n      ...\nok 1 - parent\n  ---\n  duration_ms: 30.5\n  ...\nok 2 - quick\n  ---\n  duration_ms: 1\n  ...\n`;
  assert.deepEqual(slowestTapSubtests(output, 2), [
    { name: 'parent', level: 0, durationMs: 30.5 },
    { name: 'child', level: 1, durationMs: 20.5 },
  ]);
  assert.deepEqual(slowestTapSubtests('ok 1 - missing duration\n', 12), []);
});

test('audited parallel files are exact and all other required files stay serial', () => {
  assert.equal(auditedParallelTests.length, 16);
  // Other identity files share the guarded D1 fixture and must stay serial.
  assert.deepEqual(auditedParallelTests.filter(file => file.startsWith('tests/identity/')),
    ['tests/identity/d1-impersonation.test.mjs']);
  assert.deepEqual(partitionRequiredTests(['a', 'b', 'c'], ['b']),
    { parallel: ['b'], serial: ['a', 'c'] });
  for (const [required, allowed] of [
    [['a', 'a', 'b'], ['a']], [['a', 'b'], ['a', 'a']], [['a', 'b'], ['missing']],
  ]) assert.throws(() => partitionRequiredTests(required, allowed), /Invalid parallel/);
  assert.throws(() => partitionRequiredTests(['a'], ['a']), /Incomplete or overlapping/);
});

test('two disjoint complete TAP phases alone contribute combined counters', () => {
  const required = ['a', 'b'];
  const phases = [
    { files: ['a'], tap: inspectTap(tap({}), 0) },
    { files: ['b'], tap: inspectTap(tap({ tests: 3, pass: 3 }), 0) },
  ];
  assert.deepEqual(inspectTapPhases(phases, required), { success: true,
    counts: { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, reason: null });
  for (const invalid of [phases.slice(0, 1),
    [{ ...phases[0], files: ['a'] }, { ...phases[1], files: ['a'] }],
    [{ ...phases[0], files: ['a'] }, { ...phases[1], files: ['unknown'] }],
    [{ ...phases[0], files: [] }, phases[1]],
    [phases[0], { ...phases[1], tap: inspectTap('ok 1 - incomplete', 0) }],
    [phases[0], { ...phases[1], tap: inspectTap(tap({ pass: 1, skipped: 1 }), 0) }],
  ]) {
    const result = inspectTapPhases(invalid, required);
    assert.equal(result.success, false);
    assert.equal(result.counts, null);
  }
  assert.equal(remainingTestBudgetMs(900000, 0), 900000);
  assert.equal(remainingTestBudgetMs(900000, 899999.9), 0);
  assert.equal(remainingTestBudgetMs(900000, 900001), 0);
});

test('a commit change invalidates proof even with identical source bytes', () => {
  const a = { head: 'head-a', tree: 'tree-a', sha256: 'content-a' };
  assert.equal(sameSourceIdentity(a, { ...a }), true);
  for (const key of ['head', 'tree', 'sha256']) assert.equal(sameSourceIdentity(a, { ...a, [key]: 'changed' }), false);
});

test('the aggregate refuses a missing or empty contracts suite and linked tests', t => {
  const root = temporaryDirectory(t, 'creezio-suites-');
  mkdirSync(join(root, 'tests', 'quality'), { recursive: true });
  writeFileSync(join(root, 'tests', 'quality', 'one.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'contracts'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*contracts/);
  writeFileSync(join(root, 'tests', 'contracts', 'two.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'runtime'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*runtime/);
  writeFileSync(join(root, 'tests', 'runtime', 'three.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'identity'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*identity/);
  writeFileSync(join(root, 'tests', 'identity', 'four.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'data'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*data/);
  writeFileSync(join(root, 'tests', 'data', 'five.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'operations'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*operations/);
  writeFileSync(join(root, 'tests', 'operations', 'six.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'workspace'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*workspace/);
  writeFileSync(join(root, 'tests', 'workspace', 'seven.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'registry'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*registry/);
  writeFileSync(join(root, 'tests', 'registry', 'eight.test.mjs'), '// fixture');
  assert.throws(() => collectRequiredTests(root), /ENOENT/);
  mkdirSync(join(root, 'tests', 'local'));
  assert.throws(() => collectRequiredTests(root), /No tests found.*local/);
  writeFileSync(join(root, 'tests', 'local', 'nine.test.mjs'), '// fixture');
  for (const suite of ['oauth', 'mcp', 'modules', 'front', 'conversations', 'openai', 'widgets', 'cloudflare', 'crm', 'support', 'pages-navigation', 'analytics', 'catalog', 'connectors', 'n8n', 'stripe', 'meili', 'search', 'granola', 'storage-authority']) {
    assert.throws(() => collectRequiredTests(root), /ENOENT/);
    mkdirSync(join(root, 'tests', suite));
    assert.throws(() => collectRequiredTests(root), new RegExp(`No tests found.*${suite}`));
    writeFileSync(join(root, 'tests', suite, 'required.test.mjs'), '// fixture');
  }
  assert.deepEqual(collectRequiredTests(root), ['tests/quality/one.test.mjs', 'tests/contracts/two.test.mjs', 'tests/runtime/three.test.mjs', 'tests/identity/four.test.mjs', 'tests/data/five.test.mjs', 'tests/operations/six.test.mjs', 'tests/workspace/seven.test.mjs', 'tests/registry/eight.test.mjs', 'tests/local/nine.test.mjs', 'tests/oauth/required.test.mjs', 'tests/mcp/required.test.mjs', 'tests/modules/required.test.mjs', 'tests/front/required.test.mjs', 'tests/conversations/required.test.mjs', 'tests/openai/required.test.mjs', 'tests/widgets/required.test.mjs', 'tests/cloudflare/required.test.mjs', 'tests/crm/required.test.mjs', 'tests/support/required.test.mjs', 'tests/pages-navigation/required.test.mjs', 'tests/analytics/required.test.mjs', 'tests/catalog/required.test.mjs', 'tests/connectors/required.test.mjs', 'tests/n8n/required.test.mjs', 'tests/stripe/required.test.mjs', 'tests/meili/required.test.mjs', 'tests/search/required.test.mjs', 'tests/granola/required.test.mjs', 'tests/storage-authority/required.test.mjs']);
  renameSync(join(root, 'tests', 'contracts'), join(root, 'saved-contracts'));
  symlinkSync(join(root, 'saved-contracts'), join(root, 'tests', 'contracts'), process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => collectRequiredTests(root), /Invalid test directory/); }
  finally { unlinkSync(join(root, 'tests', 'contracts')); }
});
test('source identity covers pending source edits but not ignored evidence', t => {
  const root = temporaryDirectory(t, 'creezio-evidence-');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '--initial-branch=main');
  writeFileSync(join(root, '.gitignore'), 'report.json\n');
  writeFileSync(join(root, 'source.txt'), 'one');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const initial = sourceIdentity(root);
  assert.equal(initial.dirty, false);
  writeFileSync(join(root, ' leading-space.txt'), 'first');
  const spaced = sourceIdentity(root);
  assert.ok(spaced.files.find(file => file.path === ' leading-space.txt')?.sha256);
  writeFileSync(join(root, ' leading-space.txt'), 'second');
  assert.notEqual(sourceIdentity(root).sha256, spaced.sha256);
  unlinkSync(join(root, ' leading-space.txt'));
  writeFileSync(join(root, 'report.json'), '{}');
  assert.equal(sourceIdentity(root).sha256, initial.sha256);
  writeFileSync(join(root, 'pending.txt'), 'new');
  const pending = sourceIdentity(root);
  assert.equal(pending.dirty, true);
  assert.notEqual(pending.sha256, initial.sha256);
  writeFileSync(join(root, 'source.txt'), 'two');
  assert.notEqual(sourceIdentity(root).sha256, pending.sha256);
  assert.equal(readFileSync(join(root, 'pending.txt'), 'utf8'), 'new');
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'note.md'), 'a');
  git('add', 'docs/note.md');
  const moved = join(root, 'moved');
  renameSync(join(root, 'docs'), moved);
  symlinkSync(moved, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.throws(() => sourceIdentity(root), /Linked source entry/); }
  finally { unlinkSync(join(root, 'docs')); }
});
