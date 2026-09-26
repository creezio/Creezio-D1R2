import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, relative, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUITES = Object.freeze(['backend', 'ui', 'api-mcp', 'widgets', 'package', 'docs']);
export const DEVELOPMENT_SKILLS = Object.freeze([
  'create-app', 'create-module', 'data-and-permissions', 'ui-and-widgets',
  'test-and-package', 'publish-and-update', 'contribute', 'review-change', 'maintain-standards',
]);
export const REQUIRED_DOCUMENTS = Object.freeze([
  'README.md', 'AGENTS.md', 'FILES.md', 'CONTRIBUTING.md', 'LICENSE', 'skills/README.md',
  ...[
    'PRD', 'EXIGENCES', 'USER-STORIES', 'TODO', 'PLAN-IMPLEMENTATION', 'MATRICE-CAPACITES',
    'ARCHITECTURE-DEPOTS', 'STANDARD-MODULE', 'DEVELOPMENT-STANDARD', 'GIT-FLOW',
    'CADRE-PRODUIT-ET-COMMUNAUTE', 'EXTENSIONS-THEMES-ECOSYSTEME', 'INTERACTIONS-WIDGETS',
    'COMPATIBILITE-CHATGPT', 'STOCKAGE-ET-HEBERGEMENT', 'LICENCES-ET-OFFRES',
    'QUALIFICATION-SITES', 'AUDIT-AVANT-DEVELOPPEMENT', 'DEPENDANCES-MODULES',
  ].map(name => `docs/${name}.md`),
]);

const IGNORED = new Set(['.git', '.quality', '.creezio', 'node_modules', 'dist', 'build', 'coverage', '.next', '.wrangler', '.cache', 'private', 'docker-data']);
const TEXT_FILE = /\.(?:md|mdx|mjs|cjs|js|jsx|ts|tsx|json|ya?ml|toml|txt|html|css|env|example)$/i;
const MODULE_DOCUMENTS = ['README.md', 'AGENTS.md', 'FILES.md', 'prd.md', 'interview.md', 'TODO.md', 'CHANGELOG.md'];
const MODULE_FAMILIES = ['extensions/native', 'extensions/common', 'application/extensions'];
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const slash = path => path.split(sep).join('/');
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !/^(?:[A-Za-z]:|[\\/])/.test(rel)); };
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
const blank = text => text.replace(/[^\n]/g, ' ');

// Keep offsets so diagnostics refer to source lines, not a transformed document.
function prose(text) {
  let fence = null;
  return text.replace(/<!--[^]*?-->/g, blank).split('\n').map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && /^\s*$/.test(line.slice(marker[0].length))) fence = null;
      return blank(line);
    }
    if (marker) { fence = marker[1]; return blank(line); }
    return line;
  }).join('\n');
}

function anchors(text, add, file) {
  const result = new Set();
  for (const match of text.matchAll(/<[^>]+\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/g)) {
    if (result.has(match[1])) add('DUPLICATE_ANCHOR', file, lineOf(text, match.index), 'An explicit anchor is defined more than once.');
    result.add(match[1]);
  }
  const counts = new Map();
  const lines = text.split('\n');
  function heading(value) {
    const slug = value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&(?:[a-z]+|#\d+);/gi, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').toLowerCase().trim()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    let id = slug;
    while (counts.has(id)) id = `${slug}-${(counts.get(slug) || 0) + 1}`, counts.set(slug, (counts.get(slug) || 0) + 1);
    counts.set(id, counts.get(id) || 0);
    result.add(id);
  }
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) heading(match[1]);
    else if (i && /^\s{0,3}(?:=+|-+)\s*$/.test(lines[i]) && lines[i - 1].trim() && !/^\s*[|>#]/.test(lines[i - 1])) heading(lines[i - 1]);
  }
  return result;
}

function destination(text, start) {
  let cursor = start;
  while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++;
  if (text[cursor] === '<') {
    const end = text.indexOf('>', cursor + 1);
    return end < 0 ? null : { value: text.slice(cursor + 1, end), end: end + 1 };
  }
  const begin = cursor;
  let depth = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\' && cursor + 1 < text.length) { cursor += 2; continue; }
    if (char === '(') depth++;
    else if (char === ')') { if (!depth) break; depth--; }
    if (/\s/.test(char) && !depth) break;
    cursor++;
  }
  return { value: text.slice(begin, cursor).replace(/\\([\\()[\]<> ])/g, '$1'), end: cursor };
}

function links(text, add, file) {
  const clean = text.replace(/(`+)([^]*?)\1/g, blank);
  const starts = [0];
  for (const match of clean.matchAll(/\n/g)) starts.push(match.index + 1);
  const sourceLine = offset => {
    let low = 0, high = starts.length;
    while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid + 1; else high = mid; }
    return low;
  };
  // Index matching brackets once; unmatched brackets must not rescan the document.
  const bracketEnds = new Map(), stack = [];
  for (let index = 0; index < clean.length; index++) {
    if (clean[index] === '\\') { index++; continue; }
    if (clean[index] === '[') stack.push(index);
    else if (clean[index] === ']' && stack.length) bracketEnds.set(stack.pop(), index);
  }
  const definitions = new Map();
  const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const result = [];
  const definitionLines = new Set();
  for (const match of clean.matchAll(/^\s{0,3}\[([^\]\n]+)\]:\s*/gm)) {
    const value = destination(clean, match.index + match[0].length);
    if (!value) continue;
    const key = normalize(match[1]);
    if (definitions.has(key)) add('DUPLICATE_LINK_REFERENCE', file, sourceLine(match.index), 'A reference link is defined more than once.');
    definitions.set(key, value.value);
    definitionLines.add(sourceLine(match.index));
    result.push({ target: value.value, line: sourceLine(match.index) });
  }
  for (let cursor = 0; cursor < clean.length; cursor++) {
    if (clean[cursor] !== '[' || clean[cursor - 1] === '\\' || definitionLines.has(sourceLine(cursor))) continue;
    let end = bracketEnds.get(cursor);
    if (end === undefined) continue;
    const label = clean.slice(cursor + 1, end);
    let target;
    if (clean[end + 1] === '(') {
      const value = destination(clean, end + 2);
      if (value) { target = value.value; end = value.end; }
    } else if (clean[end + 1] === '[') {
      const close = clean.indexOf(']', end + 2);
      if (close < 0) continue;
      const key = normalize(clean.slice(end + 2, close) || label);
      if (!definitions.has(key)) add('MISSING_LINK_REFERENCE', file, sourceLine(cursor), 'A reference link has no definition.');
      else target = definitions.get(key);
      end = close;
    } else target = definitions.get(normalize(label));
    if (target !== undefined) result.push({ target, line: sourceLine(cursor) });
    cursor = end;
  }
  for (const match of clean.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) result.push({ target: match[1], line: sourceLine(match.index) });
  return result;
}

function parseSkill(text, file, add) {
  const match = text.match(/^---\r?\n([^]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) { add('SKILL_FRONTMATTER', file, 1, 'A skill requires a delimited frontmatter block.'); return; }
  const fields = new Map();
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() || /^\s*#/.test(lines[i])) continue;
    const field = lines[i].match(/^([a-z][a-z0-9-]*):\s*(.*)$/i);
    if (!field) { add('SKILL_FRONTMATTER', file, i + 2, 'Use scalar frontmatter fields or an indented text block.'); continue; }
    if (fields.has(field[1])) add('SKILL_FRONTMATTER', file, i + 2, 'A frontmatter key is duplicated.');
    let value = field[2];
    if (/^[|>][-+]?$/.test(value)) {
      const parts = [];
      while (i + 1 < lines.length && /^(?:\s+|$)/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(' ');
    } else if (value.startsWith('"')) {
      const quoted = value.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/);
      try { if (!quoted) throw new Error(); value = JSON.parse(quoted[1]); } catch { add('SKILL_FRONTMATTER', file, i + 2, 'A quoted scalar is malformed.'); value = ''; }
    } else if (value.startsWith("'")) {
      const quoted = value.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
      if (!quoted) { add('SKILL_FRONTMATTER', file, i + 2, 'A quoted scalar is malformed.'); value = ''; }
      else value = quoted[1].replace(/''/g, "'");
    } else {
      value = value.replace(/\s+#.*$/, '');
      if (/^(?:null|~|true|false|[-+]?\d+(?:\.\d+)?)$/i.test(value)) value = undefined;
      else if (/^[*&!]/.test(value)) { add('SKILL_FRONTMATTER', file, i + 2, 'YAML aliases and tags are not supported by the canonical scalar frontmatter.'); value = undefined; }
    }
    fields.set(field[1], value);
  }
  const name = fields.get('name');
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name !== basename(dirname(file))) add('SKILL_NAME', file, 1, 'The skill name must match its directory and use a lowercase hyphenated identifier.');
  const description = fields.get('description');
  if (typeof description !== 'string' || !description.trim() || description.length > 1024 || /^[\[{]/.test(description)) add('SKILL_DESCRIPTION', file, 1, 'The skill description must be a nonempty scalar of at most 1024 characters.');
  if (!text.slice(match[0].length).trim()) add('EMPTY_SKILL', file, 1, 'The skill body is empty.');
}

/** Read-only structural validation. It never executes inspected module or skill code. */
export function validateDocs(root) {
  const base = resolve(root);
  const errors = [];
  const metrics = { files: 0, markdownFiles: 0, localLinks: 0, requirements: 0, stories: 0, tasks: 0, dependencyEdges: 0, skills: 0, modules: 0, textFilesScanned: 0 };
  const add = (code, file, line, message) => errors.push({ code, file, line, message });
  const files = new Map(), directories = new Set(), texts = new Map(), documents = new Map();
  try { const stat = lstatSync(base); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(); }
  catch { add('ROOT_INVALID', '.', 1, 'The root must be an existing directory, not a symbolic link.'); return { errors, metrics }; }
  function walk(directory) {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { add('READ_FAILED', slash(relative(base, directory)), 1, 'Cannot inspect this directory.'); return; }
    for (const entry of entries) {
      const current = slash(relative(base, directory));
      const moduleBoundary = MODULE_FAMILIES.some(family => current === family || (dirname(current).replaceAll('\\', '/') === family && basename(current).startsWith('@')));
      if (!moduleBoundary && entry.isDirectory() && ((directory === base && IGNORED.has(entry.name)) || ['.git', 'node_modules'].includes(entry.name))) continue;
      const absolute = resolve(directory, entry.name), name = slash(relative(base, absolute));
      if (entry.isSymbolicLink()) { add('SYMLINK_NOT_ALLOWED', name, 1, 'Symbolic links are not followed by the document validator.'); continue; }
      if (entry.isDirectory()) { directories.add(name); walk(absolute); }
      else if (entry.isFile()) files.set(name, absolute);
    }
  }
  walk(base);
  metrics.files = files.size;
  const secretPatterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['provider-key', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{32,}|sk_live_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{30,}|cf(?:ut|at)_[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/],
    ['literal-credential', /\b(?:api[_-]?key|access[_-]?token|password|secret)\b["']?\s*[:=]\s*["']([A-Za-z0-9_+\/=.-]{24,})["']/i],
    ['environment-credential', /^\s*(?:export\s+)?(?:[A-Z][A-Z0-9]*_)*(?:API_KEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET|PRIVATE_KEY)(?:_[A-Z0-9]+)*\s*=\s*["']?([A-Za-z0-9_+\/=.-]{24,})/],
  ];
  for (const [file, absolute] of files) {
    if (!TEXT_FILE.test(file) && !/(?:^|\/)(?:LICENSE|\.(?:env|dev\.vars)(?:\.[^/]+)?)$/.test(file)) continue;
    try {
      if (lstatSync(absolute).size > MAX_TEXT_BYTES) { add('TEXT_TOO_LARGE', file, 1, 'Text exceeds the validation size limit and was not inspected.'); continue; }
      const text = readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '');
      texts.set(file, text); metrics.textFilesScanned++;
      text.split('\n').forEach((line, index) => {
        for (const [kind, pattern] of secretPatterns) {
          const match = pattern.exec(line);
          if (match && !(['literal-credential', 'environment-credential'].includes(kind) && /(?:example|placeholder|replace|changeme|your[_-]|process\.env)/i.test(match[1]))) add('POSSIBLE_SECRET', file, index + 1, `Possible ${kind}; value redacted.`);
        }
      });
      if (/\.md$/i.test(file)) { const clean = prose(text); documents.set(file, { text, clean, anchors: anchors(clean, add, file) }); }
    } catch { add('READ_FAILED', file, 1, 'Cannot read this text file.'); }
  }
  metrics.markdownFiles = documents.size;
  function required(file) {
    if (!files.has(file)) add('MISSING_DOCUMENT', file, 1, 'A required document is missing.');
    else if (!texts.get(file)?.trim()) add('EMPTY_DOCUMENT', file, 1, 'A required document is empty or unreadable.');
  }
  REQUIRED_DOCUMENTS.forEach(required);
  for (const skill of DEVELOPMENT_SKILLS) required(`skills/development/${skill}/SKILL.md`);
  for (const suite of SUITES) if (!texts.get('docs/STANDARD-MODULE.md')?.includes(`${suite}.mjs`)) add('SUITE_CONTRACT_MISSING', 'docs/STANDARD-MODULE.md', 1, `The ${suite} suite entry must be documented.`);

  for (const [file, doc] of documents) {
    if (basename(file) === 'SKILL.md') { metrics.skills++; parseSkill(doc.text, file, add); }
    for (const link of links(doc.clean, add, file)) {
      if (/^(?:https?:|mailto:|tel:|codex:|app:|plugin:|skill:|\/\/)/i.test(link.target)) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.target) || /^[\\/]/.test(link.target)) { add('LINK_UNSAFE', file, link.line, 'A local link must remain inside the repository and cannot use an executable scheme.'); continue; }
      const [rawPath, ...fragments] = link.target.split('#');
      let path, fragment;
      try { path = decodeURIComponent(rawPath.split('?')[0]); fragment = decodeURIComponent(fragments.join('#')); }
      catch { add('LINK_ENCODING', file, link.line, 'A link contains invalid percent encoding.'); continue; }
      const absolute = path ? resolve(base, dirname(file), path) : files.get(file);
      metrics.localLinks++;
      if (!inside(base, absolute)) { add('LINK_OUTSIDE_ROOT', file, link.line, 'A local link escapes the repository.'); continue; }
      const target = slash(relative(base, absolute));
      if (!files.has(target) && !directories.has(target)) { add('LINK_TARGET_MISSING', file, link.line, 'A local link target is missing or has different casing.'); continue; }
      if (fragment && documents.has(target) && !documents.get(target).anchors.has(fragment)) add('LINK_ANCHOR_MISSING', file, link.line, 'The target Markdown anchor does not exist.');
    }
  }

  const definitions = new Map();
  const traceFiles = new Map([['REQ', 'docs/EXIGENCES.md'], ['US', 'docs/USER-STORIES.md'], ['T', 'docs/TODO.md']]);
  for (const [prefix, file] of traceFiles) {
    const text = documents.get(file)?.clean || '';
    const records = [...text.matchAll(new RegExp(`<a\\s+id=["'](${prefix}-\\d+)["']\\s*>\\s*</a>`, 'g'))];
    if (!records.length) add('TRACE_EMPTY', file, 1, 'The canonical traceability document has no explicit requirement/story/task identifiers.');
    for (let index = 0; index < records.length; index++) {
      const match = records[index];
      if (definitions.has(match[1])) add('TRACE_DUPLICATE', file, lineOf(text, match.index), 'A canonical identifier is defined more than once.');
      const body = text.slice(match.index, records[index + 1]?.index ?? text.length);
      definitions.set(match[1], { id: match[1], prefix, file, line: lineOf(text, match.index), body, refs: new Set([...body.matchAll(/\]\([^)]*#((?:REQ|US|T)-\d+)\)/g)].map(m => m[1])) });
    }
  }
  for (const [file, doc] of documents) for (const match of doc.clean.matchAll(/<a\s+id=["']((REQ|US|T)-\d+)["']\s*>\s*<\/a>/g)) {
    if (traceFiles.get(match[2]) !== file) add('TRACE_NONCANONICAL', file, lineOf(doc.clean, match.index), 'A central identifier must be defined only in its canonical document.');
  }
  const graph = new Map();
  for (const record of definitions.values()) {
    const { id, prefix, file, line, body, refs } = record;
    metrics[prefix === 'REQ' ? 'requirements' : prefix === 'US' ? 'stories' : 'tasks']++;
    for (const ref of refs) if (!definitions.has(ref)) add('TRACE_UNKNOWN', file, line, `Unknown traceability identifier ${ref}.`);
    const needed = prefix === 'REQ' ? ['US', 'T'] : prefix === 'US' ? ['REQ', 'T'] : ['REQ', 'US'];
    for (const kind of needed) if (![...refs].some(ref => ref.startsWith(`${kind}-`))) add('TRACE_MISSING', file, line, `${id} has no ${kind} traceability link.`);
    if (prefix === 'REQ' && !/\bV-\d+\b/.test(body)) add('TRACE_RECIPE_MISSING', file, line, `${id} has no validation recipe identifier.`);
    if (prefix === 'REQ' || prefix === 'US') for (const ref of refs) {
      if (prefix === 'US' && !ref.startsWith('T-')) continue;
      const target = definitions.get(ref);
      if (target && !target.refs.has(id)) add('TRACE_NOT_RECIPROCAL', file, line, `${id} and ${ref} are not linked in both directions.`);
    }
    if (prefix === 'T') {
      const declaration = body.match(/^\s*-\s*Dépendances\s*:\s*(.+)$/m);
      if (!declaration) add('TASK_DEPENDENCIES_MISSING', file, line, `${id} requires an explicit dependency declaration.`);
      const deps = new Set([...(declaration?.[1] || '').matchAll(/\bT-\d+\b/g)].map(m => m[0]));
      graph.set(id, [...deps]); metrics.dependencyEdges += deps.size;
    }
  }
  const visited = new Set(), active = new Set();
  function visit(id, chain) {
    if (active.has(id)) { const record = definitions.get(id); add('DEPENDENCY_CYCLE', record.file, record.line, `Task dependency cycle: ${[...chain.slice(chain.indexOf(id)), id].join(' -> ')}.`); return; }
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of graph.get(id) || []) {
      if (!graph.has(dependency)) { const record = definitions.get(id); add('DEPENDENCY_UNKNOWN', record.file, record.line, `Unknown task dependency ${dependency}.`); }
      else visit(dependency, [...chain, id]);
    }
    active.delete(id); visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);

  for (const family of MODULE_FAMILIES) {
    const modules = [...directories].filter(path => dirname(path).replaceAll('\\', '/') === family && !basename(path).startsWith('@'));
    modules.push(...[...directories].filter(path => dirname(dirname(path)).replaceAll('\\', '/') === family && basename(dirname(path)).startsWith('@')));
    for (const module of modules) {
      metrics.modules++;
      MODULE_DOCUMENTS.forEach(name => required(`${module}/${name}`));
      for (const entry of ['gate.mjs', ...SUITES.map(suite => `ci/${suite}.mjs`)]) {
        const file = `${module}/${entry}`;
        const source = texts.get(file)?.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
        if (!source) add('MODULE_CONTROL_MISSING', file, 1, 'A module requires nonempty control entry points; document inspection does not execute or certify those controls.');
      }
      for (const suite of SUITES) if (![...files.keys()].some(path => path.startsWith(`${module}/tests/${suite}/`) && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && texts.get(path)?.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim())) add('MODULE_TESTS_MISSING', `${module}/tests/${suite}`, 1, `The ${suite} suite has no test source.`);
    }
  }
  errors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code));
  return { errors, metrics };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateDocs(process.argv[2] || process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.errors.length ? 1 : 0;
}
