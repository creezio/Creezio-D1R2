import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectTap, sourceIdentity, sameSourceIdentity, collectRequiredTests } from '../../scripts/quality/evidence.mjs';
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
  assert.deepEqual(collectRequiredTests(root), ['tests/quality/one.test.mjs', 'tests/contracts/two.test.mjs', 'tests/runtime/three.test.mjs', 'tests/identity/four.test.mjs', 'tests/data/five.test.mjs']);
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
