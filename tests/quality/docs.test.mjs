import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDocs, REQUIRED_DOCUMENTS, DEVELOPMENT_SKILLS, SUITES } from '../../scripts/quality/docs.mjs';
import { temporaryDirectory } from './temporary.mjs';

function write(root, path, text) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
}
function append(root, path, text) { write(root, path, readFileSync(join(root, path), 'utf8') + text); }
function codes(result) { return result.errors.map(error => error.code); }

function trace(root, count = 1) {
  let requirements = '# Exigences\n', stories = '# Stories\n', tasks = '# Tâches\n';
  for (let number = 1; number <= count; number++) {
    const n = String(number).padStart(2, '0');
    requirements += `<a id="REQ-${n}01"></a>**REQ-${n}01** | Comportement requis. [US-${n}](USER-STORIES.md#US-${n}) · [T-${n}](TODO.md#T-${n}) · recette \`V-${n}01\`\n`;
    stories += `\n<a id="US-${n}"></a>\n## US-${n} — Besoin\nCritères [REQ-${n}01](EXIGENCES.md#REQ-${n}01), travail [T-${n}](TODO.md#T-${n}).\n`;
    tasks += `\n<a id="T-${n}"></a>\n## T-${n} — Travail\n- Dépendances : aucune.\n- Besoin : [US-${n}](USER-STORIES.md#US-${n}). Acceptation : [REQ-${n}01](EXIGENCES.md#REQ-${n}01).\n`;
  }
  write(root, 'docs/EXIGENCES.md', requirements);
  write(root, 'docs/USER-STORIES.md', stories);
  write(root, 'docs/TODO.md', tasks);
}

function fixture(t) {
  const root = temporaryDirectory(t, 'creezio-docs-test-');
  for (const file of REQUIRED_DOCUMENTS) write(root, file, '# Document de contrôle\nContenu de fixture pour la validation structurelle.\n');
  append(root, 'docs/STANDARD-MODULE.md', `\n${SUITES.map(suite => `- \`ci/${suite}.mjs\``).join('\n')}\n`);
  for (const name of DEVELOPMENT_SKILLS) write(root, `skills/development/${name}/SKILL.md`, `---\nname: ${name}\ndescription: "Guide de validation ${name}."\n---\n# Guide\nAppliquer le contrat du périmètre.\n`);
  trace(root);
  return root;
}

test('a documentation-only P0 tree is valid without runtime or modules', t => {
  const root = fixture(t);
  const result = validateDocs(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.requirements, 1);
  assert.equal(result.metrics.stories, 1);
  assert.equal(result.metrics.tasks, 1);
  assert.equal(result.metrics.modules, 0);
  assert.equal(result.metrics.skills, 9);
});

test('Cloudflare local secret files are inspected with redacted diagnostics', t => {
  const root = fixture(t);
  const value = ['cf', 'at_', 'Q'.repeat(36)].join('');
  for (const file of ['.dev.vars', '.dev.vars.test', '.dev.vars.example']) write(root, file, `CLOUDFLARE_API_TOKEN=${value}\n`);
  const result = validateDocs(root);
  for (const file of ['.dev.vars', '.dev.vars.test', '.dev.vars.example']) {
    assert.ok(result.errors.some(error => error.code === 'POSSIBLE_SECRET' && error.file === file));
  }
  assert.ok(!JSON.stringify(result).includes(value));
});

test('required documentation and the six suite declarations cannot disappear', t => {
  const root = fixture(t);
  unlinkSync(join(root, 'docs/PRD.md'));
  write(root, 'AGENTS.md', '\n');
  write(root, 'docs/STANDARD-MODULE.md', '# Module\n');
  const result = validateDocs(root);
  assert.ok(codes(result).includes('MISSING_DOCUMENT'));
  assert.ok(codes(result).includes('EMPTY_DOCUMENT'));
  assert.equal(result.errors.filter(error => error.code === 'SUITE_CONTRACT_MISSING').length, 6);
});

test('Markdown links handle Unicode headings, duplicate headings, parentheses and references', t => {
  const root = fixture(t);
  write(root, 'docs/API (v1).md', '# Titre école\n## Réponse\n## Réponse\n<a id="Exact-ID"></a>\n');
  append(root, 'README.md', [
    '[Unicode](<docs/API%20(v1).md#titre-école>)',
    '[Duplicate](<docs/API%20(v1).md#réponse-1>)',
    '[Nested](docs/API\\ \\(v1\\).md#Exact-ID)',
    '[Reference][api]', '[api]: <docs/API%20(v1).md#Exact-ID> "Title"',
    '```md', '[example](does-not-exist.md)', '<a id="ignored"></a>', '```',
    '`[also an example](absent.md)`', '<!-- [hidden](absent.md) -->', '',
  ].join('\n'));
  const result = validateDocs(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.metrics.localLinks >= 10);
});

test('missing file, absent anchor and undefined reference are rejected with source locations', t => {
  const root = fixture(t);
  append(root, 'README.md', '\n[Missing](docs/missing.md)\n[Anchor](docs/PRD.md#absent)\n[Reference][unknown]\n');
  const result = validateDocs(root);
  for (const code of ['LINK_TARGET_MISSING', 'LINK_ANCHOR_MISSING', 'MISSING_LINK_REFERENCE']) {
    const error = result.errors.find(item => item.code === code);
    assert.ok(error, code);
    assert.equal(error.file, 'README.md');
    assert.ok(error.line >= 4);
  }
});

test('repository escapes, unsafe links and malformed encoding cannot be accepted', t => {
  const root = fixture(t);
  append(root, 'README.md', '\n[Outside](../outside.md)\n[Unsafe](javascript:alert(1))\n[Encoding](docs/%ZZ.md)\n');
  const result = validateDocs(root);
  for (const code of ['LINK_OUTSIDE_ROOT', 'LINK_UNSAFE', 'LINK_ENCODING']) assert.ok(codes(result).includes(code), code);
});

test('symbolic directories are not traversed or used as local link targets', t => {
  const root = fixture(t);
  const outside = temporaryDirectory(t, 'creezio-docs-link-target-');
  write(outside, 'external.md', '# Outside\n');
  const link = join(root, 'linked');
  try {
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('The test host does not permit creating directory links.'); return; }
    throw error;
  }
  try {
    append(root, 'README.md', '\n[External](linked/external.md)\n');
    const result = validateDocs(root);
    assert.ok(codes(result).includes('SYMLINK_NOT_ALLOWED'));
    assert.ok(codes(result).includes('LINK_TARGET_MISSING'));
    assert.ok(!result.errors.some(error => error.file.startsWith('linked/')));
  } finally {
    // Remove the link itself; the shared helper never traverses reparse points.
    unlinkSync(link);
  }
});

test('traceability detects duplicate identifiers and orphaned reciprocal links', t => {
  const root = fixture(t);
  const requirement = readFileSync(join(root, 'docs/EXIGENCES.md'), 'utf8').split('\n')[1];
  append(root, 'docs/EXIGENCES.md', `${requirement}\n`);
  write(root, 'docs/USER-STORIES.md', '<a id="US-01"></a>\n## US-01 — Besoin\n[T-01](TODO.md#T-01)\n');
  const result = validateDocs(root);
  assert.ok(codes(result).includes('TRACE_DUPLICATE'));
  assert.ok(codes(result).includes('TRACE_MISSING'));
  assert.ok(codes(result).includes('TRACE_NOT_RECIPROCAL'));
});

test('unknown references, missing recipe IDs and noncanonical definitions are rejected', t => {
  const root = fixture(t);
  const path = 'docs/EXIGENCES.md';
  write(root, path, readFileSync(join(root, path), 'utf8').replace('V-0101', 'recette à définir') + '[Unknown](TODO.md#T-99)\n');
  append(root, 'README.md', '\n<a id="REQ-9901"></a>\n');
  const result = validateDocs(root);
  for (const code of ['TRACE_RECIPE_MISSING', 'TRACE_UNKNOWN', 'TRACE_NONCANONICAL']) assert.ok(codes(result).includes(code), code);
});

test('task dependencies form a directed acyclic graph and missing tasks fail', t => {
  const root = fixture(t);
  trace(root, 2);
  const path = 'docs/TODO.md';
  let source = readFileSync(join(root, path), 'utf8');
  source = source.replace('Dépendances : aucune.', 'Dépendances : [T-02](#T-02).');
  write(root, path, source);
  let result = validateDocs(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.dependencyEdges, 1);
  write(root, path, source.replace('Dépendances : aucune.', 'Dépendances : [T-01](#T-01).'));
  result = validateDocs(root);
  assert.ok(codes(result).includes('DEPENDENCY_CYCLE'));
  write(root, path, source.replace('Dépendances : aucune.', 'Dépendances : T-99.'));
  assert.ok(codes(validateDocs(root)).includes('DEPENDENCY_UNKNOWN'));
});

test('frontmatter validates identity, description, duplicate keys and literal blocks', t => {
  const root = fixture(t);
  const file = 'skills/development/create-app/SKILL.md';
  write(root, file, '---\nname: create-app\ndescription: >\n  Créer une application.\n  Préserver sa provenance.\n---\n# Guide\nContenu.\n');
  assert.deepEqual(validateDocs(root).errors, []);
  write(root, file, '---\nname: not-the-directory\nname: Also-invalid\ndescription: []\n---\n# Guide\n');
  const result = validateDocs(root);
  for (const code of ['SKILL_FRONTMATTER', 'SKILL_NAME', 'SKILL_DESCRIPTION']) assert.ok(codes(result).includes(code), code);
  write(root, file, '---\nname: create-app\ndescription: null\n---\n# Guide\n');
  assert.ok(codes(validateDocs(root)).includes('SKILL_DESCRIPTION'));
  write(root, file, '---\nname: create-app\ndescription: "Guide cité." # Commentaire YAML\n---\n# Guide\n');
  assert.deepEqual(validateDocs(root).errors, []);
});

test('artifact names cannot hide a present module from its contract', t => {
  const root = fixture(t);
  for (const name of ['private', 'build', 'dist']) write(root, `extensions/common/${name}/README.md`, '# Module\n');
  const result = validateDocs(root);
  assert.equal(result.metrics.modules, 3);
  for (const name of ['private', 'build', 'dist']) assert.ok(result.errors.some(error => error.file === `extensions/common/${name}/AGENTS.md` && error.code === 'MISSING_DOCUMENT'));
});

test('a large unmatched-bracket document terminates without a quadratic rescan', t => {
  const root = fixture(t);
  append(root, 'README.md', `\n${'['.repeat(250_000)}\n`);
  const script = fileURLToPath(new URL('../../scripts/quality/docs.mjs', import.meta.url));
  const command = spawnSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(command.error, undefined, 'Document validation must complete within the bounded test process.');
  assert.equal(command.status, 0, command.stderr);
});

test('a present module requires documents and six control/test surfaces without executing them', t => {
  const root = fixture(t);
  const module = 'extensions/common/example';
  write(root, `${module}/README.md`, '# Example module\n');
  let result = validateDocs(root);
  assert.equal(result.metrics.modules, 1);
  assert.ok(codes(result).includes('MISSING_DOCUMENT'));
  assert.equal(result.errors.filter(error => error.code === 'MODULE_CONTROL_MISSING').length, 7);
  assert.equal(result.errors.filter(error => error.code === 'MODULE_TESTS_MISSING').length, 6);
  for (const name of ['AGENTS.md', 'FILES.md', 'prd.md', 'interview.md', 'TODO.md', 'CHANGELOG.md']) write(root, `${module}/${name}`, '# Module contract fixture\n');
  // A throwing fixture demonstrates that inspection never imports the candidate.
  const source = 'throw new Error("Inspected fixture must never execute");\n';
  write(root, `${module}/gate.mjs`, source);
  for (const suite of SUITES) {
    write(root, `${module}/ci/${suite}.mjs`, source);
    write(root, `${module}/tests/${suite}/contract.test.mjs`, source);
  }
  result = validateDocs(root);
  assert.deepEqual(result.errors, []);
  write(root, `${module}/ci/backend.mjs`, '// TODO\n/* no implementation */\n');
  assert.ok(codes(validateDocs(root)).includes('MODULE_CONTROL_MISSING'));
});

test('obvious credentials are rejected without including their values in diagnostics', t => {
  const root = fixture(t);
  const token = ['ghp_', 'A'.repeat(36)].join('');
  const privateHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const environmentValue = 'B'.repeat(32);
  const cloudflareToken = ['cfut_', 'C'.repeat(32)].join('');
  write(root, 'docs/unsafe.md', `# Credentials\n${token}\n${privateHeader}\n${cloudflareToken}\n`);
  write(root, '.env', `CLOUDFLARE_API_TOKEN=${environmentValue}\n`);
  const result = validateDocs(root);
  assert.equal(result.errors.filter(error => error.code === 'POSSIBLE_SECRET').length, 4);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.ok(!JSON.stringify(result).includes(privateHeader));
  assert.ok(!JSON.stringify(result).includes(environmentValue));
  assert.ok(!JSON.stringify(result).includes(cloudflareToken));
});

test('CLI returns nonzero for invalid documents and zero for a valid P0 fixture', t => {
  const root = fixture(t);
  const script = fileURLToPath(new URL('../../scripts/quality/docs.mjs', import.meta.url));
  let command = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  assert.deepEqual(JSON.parse(command.stdout).errors, []);
  append(root, 'README.md', '\n[Missing](missing.md)\n');
  command = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(command.status, 1);
  assert.ok(JSON.parse(command.stdout).errors.some(error => error.code === 'LINK_TARGET_MISSING'));
});

test('an absent root returns a diagnostic rather than throwing', t => {
  const root = fixture(t);
  assert.deepEqual(codes(validateDocs(resolve(root, 'absent'))), ['ROOT_INVALID']);
});
