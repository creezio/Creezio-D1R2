#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../../sdk/contracts/load.mjs';
import { validateComposition, contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { safePackagePath } from '../../sdk/contracts/references.mjs';
import { validateRuntimeDefinition, RuntimeConfigurationError } from '../../core/runtime/dispatch.ts';

export class CompositionBuildError extends Error {
  constructor(code, message, diagnostics = []) { super(message); this.name = 'CompositionBuildError'; this.code = code; this.diagnostics = diagnostics; }
}
const fail = (code, message) => { throw new CompositionBuildError(code, message); };
const slash = value => value.split(path.sep).join('/');
const contained = (root, target) => { const rel = path.relative(root, target); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

/** Every existing ancestor is inspected before any read/write. A junction is never a package shortcut. */
function confined(root, target, { directory = false, missing = false } = {}) {
  const absolute = path.resolve(root, target);
  if (!contained(root, absolute)) fail('source.escape', 'A composition path escapes its repository root.');
  let cursor = absolute;
  while (true) {
    try { if (lstatSync(cursor).isSymbolicLink()) fail('source.link', 'Linked source and output paths are not accepted.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  if (!existsSync(absolute)) { if (missing) return absolute; fail('source.missing', 'A selected composition file or directory is missing.'); }
  const stat = lstatSync(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('source.type', 'The selected path has an unexpected filesystem type.');
  if (!contained(realpathSync(root), realpathSync(absolute))) fail('source.escape', 'A resolved source path escapes its repository root.');
  return absolute;
}

function packageExports(exportsValue) {
  const paths = new Set();
  function visit(value) {
    if (typeof value === 'string') { if (value.startsWith('./') && !value.includes('*')) paths.add(value.slice(2)); }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(exportsValue); return paths;
}

function locateModule(root, selection) {
  let directory, exports, packageVersion;
  if (selection.source?.kind === 'workspace') {
    if (!safePackagePath(selection.source.path)) fail('source.path', 'Workspace module paths must be safe repository-relative paths.');
    directory = confined(root, selection.source.path, { directory: true });
  } else if (selection.source?.kind === 'package') {
    const name = selection.source.name;
    if (typeof name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) fail('source.package', 'A package selection needs an explicit npm package name.');
    directory = confined(root, path.join('node_modules', name), { directory: true });
    const manifest = loadJson(confined(root, path.join(directory, 'package.json')), { root });
    if (manifest.name !== name) fail('source.package', 'Installed package identity differs from the explicit selection.');
    packageVersion = manifest.version;
    exports = packageExports(manifest.exports);
    if (!exports.has('module/manifest.json')) fail('source.private-entry', 'The package must explicitly export its module manifest.');
  } else fail('source.kind', 'Module sources must be explicit workspace or already-installed packages.');
  const descriptor = loadJson(confined(root, path.join(directory, 'module/manifest.json')), { root });
  if (selection.source.kind === 'package' && packageVersion !== descriptor.identity?.version) fail('source.package-version', 'Installed package version differs from its module descriptor.');
  return { directory, exports, descriptor };
}

function moduleFile(root, located, relative, { exported = false } = {}) {
  if (!safePackagePath(relative)) fail('source.path', 'Module files must have safe artifact-relative paths.');
  if (!located.descriptor.packaging.runtime.files.includes(relative)) fail('source.undeclared-entry', 'A runtime entry is absent from its declared runtime inventory.');
  if (exported && located.exports && !located.exports.has(relative)) fail('source.private-entry', 'A generated import targets an unexported package file.');
  const absolute = confined(root, path.join(located.directory, relative));
  if (!contained(located.directory, absolute)) fail('source.escape', 'A module entry escapes its module directory.');
  return absolute;
}

function codeFile(root, located, reference) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(reference.export)) fail('source.export', 'Code entries require a static JavaScript export identifier.');
  return moduleFile(root, located, reference.path, { exported: true });
}

const publicOperation = operation => operation?.kind === 'query' && operation.context === 'application'
  && operation.actors.length === 1 && operation.actors[0] === 'anonymous' && operation.permissions.length === 0;
const importSpecifier = (output, source) => { const rel = slash(path.relative(output, source)); return rel.startsWith('.') ? rel : `./${rel}`; };
const stringify = value => JSON.stringify(value, null, 2);

/** Build-time only: validates inert declarations, checks selected local files, and emits static imports.
 * Does not install packages, import their code, grant authorization, execute SQL, or publish anything.
 * Package archive provenance/integrity is a separate T-30 qualification; an installed directory is not that proof.
 */
export async function composeRuntime({ root = process.cwd(), compositionPath = 'configuration/composition.json', lockPath, outputDir = '.creezio/generated' } = {}) {
  root = path.resolve(root);
  confined(root, root, { directory: true });
  const compositionFile = confined(root, compositionPath);
  const lockFile = confined(root, lockPath ?? compositionPath.replace(/\.json$/, '.lock.json'));
  const composition = loadJson(compositionFile, { root }), lock = loadJson(lockFile, { root });
  if (!Array.isArray(composition.modules)) fail('composition.invalid', 'The composition must declare its selected module collection.');
  const located = composition.modules.map(selection => locateModule(root, selection));
  const result = validateComposition(composition, { modules: located.map(item => item.descriptor), lock });
  if (result.errors.length) throw new CompositionBuildError('composition.invalid', 'Composition and lock validation failed.', result.errors);
  const output = confined(root, outputDir, { directory: true, missing: true });
  const destinations = Object.fromEntries(['server.ts', 'client.tsx', 'composition.json'].map(name => [name, confined(root, path.join(output, name), { missing: true })]));
  if (located.some(item => contained(item.directory, output))
    || Object.values(destinations).some(destination => destination === compositionFile || destination === lockFile)) {
    fail('output.source-collision', 'Generated output must not overwrite selected module sources or composition inputs.');
  }
  const indexes = new Map(located.map(item => [item.descriptor.identity.id, item]));
  const inactive = result.metrics.disabledContributions ?? [];
  const active = (moduleId, pointer) => !inactive.some(item => item.moduleId === moduleId && (item.path === pointer || pointer.startsWith(`${item.path}/`)));
  const resolveOperation = reference => indexes.get(reference.moduleId)?.descriptor.contracts.operations.find(item => item.id === reference.id);
  const serverImports = [], clientImports = [], modules = [], views = [];
  let importIndex = 0;
  function importCode(destination, owner, reference, imports) {
    const source = codeFile(root, owner, reference), name = `contribution_${importIndex++}`;
    imports.push(`import { ${reference.export} as ${name} } from ${JSON.stringify(importSpecifier(destination, source))};`);
    return name;
  }
  for (const selection of composition.modules) {
    const item = indexes.get(selection.moduleId), descriptor = item.descriptor;
    // Even inactive packages cannot hide missing or linked declared runtime files.
    for (const entry of descriptor.packaging.runtime.files) moduleFile(root, item, entry);
    codeFile(root, item, descriptor.entrypoints.server);
    if (descriptor.entrypoints.ui) codeFile(root, item, descriptor.entrypoints.ui);
    if (!selection.enabled) continue;
    const operations = [];
    for (const [index, api] of descriptor.contracts.api.entries()) {
      if (!active(selection.moduleId, `/contracts/api/${index}`)) continue;
      if (!composition.exposure[api.audience].moduleIds.includes(selection.moduleId)) continue;
      const operation = resolveOperation(api.operation), owner = indexes.get(api.operation.moduleId);
      const handler = importCode(output, owner, operation.handler, serverImports);
      const access = api.method === 'GET' && api.audience === 'app' && api.auth.length === 1 && api.auth[0] === 'anonymous' && publicOperation(operation) ? 'public-read' : 'protected';
      operations.push({ id: api.id, operationId: operation.id, ownerModuleId: owner.descriptor.identity.id, method: api.method, path: api.path, access, maxDurationMs: operation.execution.maxDurationMs, handler });
    }
    modules.push({ id: descriptor.identity.id, version: descriptor.identity.version, operations });
    for (const [index, view] of descriptor.contracts.ui.views.entries()) {
      if (!active(selection.moduleId, `/contracts/ui/views/${index}`)) continue;
      const component = importCode(output, item, view.component, clientImports);
      const access = view.surfaces.includes('front') && composition.exposure.app.moduleIds.includes(selection.moduleId)
        && view.permissions.length === 0 && view.operations.every(reference => publicOperation(resolveOperation(reference))) ? 'public-read' : 'protected';
      views.push({ id: `${selection.moduleId}:${view.id}`, moduleId: selection.moduleId, moduleVersion: descriptor.identity.version, route: view.route,
        title: view.title, surfaces: view.surfaces, permissions: view.permissions, audiences: view.surfaces.includes('front') ? ['app'] : [], access, component });
    }
  }
  const compositionDigest = contractIntegrity(composition);
  // This host-owned transport is not a module CRUD operation or an implicit
  // public contribution. Each audience requires both selection and exposure.
  const accessEnabled = modules.some(module => module.id === 'creezio.access');
  const nativeAccess = Object.freeze({
    admin: accessEnabled && composition.exposure.admin.moduleIds.includes('creezio.access'),
    app: accessEnabled && composition.exposure.app.moduleIds.includes('creezio.access'),
  });
  // Only approved host code is loaded. Module entrypoints remain inert paths;
  // these sentinels verify the exact dispatch policy without evaluating package code.
  try {
    validateRuntimeDefinition({ compositionDigest, nativeAccess, modules: modules.map(module => ({ ...module,
      operations: module.operations.map(operation => ({ ...operation, handler() { throw new Error('Build validation must never invoke module handlers.'); } })),
    })) });
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw new CompositionBuildError(`build.${error.code.replaceAll('.', '-')}`, error.message,
      [{ code: error.code, message: error.message }]);
    throw error;
  }
  const banner = '// Generated from an explicit validated composition. Do not edit.\n';
  const serverModules = modules.map(module => `{ id: ${JSON.stringify(module.id)}, version: ${JSON.stringify(module.version)}, operations: [${module.operations.map(operation => {
    const { handler, ...metadata } = operation; return `{ ...${JSON.stringify(metadata)}, handler: ${handler} }`;
  }).join(',\n')}] }`);
  const clientViews = views.map(view => { const { component, ...metadata } = view; return `{ ...${JSON.stringify(metadata)}, component: ${component} }`; });
  const rendered = {
    'server.ts': `${banner}import type { RuntimeModule, RuntimeNativeAccess } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/runtime/types.ts')))};\n${serverImports.join('\n')}\nexport const compositionDigest = ${JSON.stringify(compositionDigest)};\nexport const nativeAccess: RuntimeNativeAccess = Object.freeze(${JSON.stringify(nativeAccess)});\nexport const modules: readonly RuntimeModule[] = [${serverModules.join(',\n')}];\n`,
    'client.tsx': `${banner}import type { RuntimeView } from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/runtime/ui.ts')))};\n${clientImports.join('\n')}\nexport const compositionDigest = ${JSON.stringify(compositionDigest)};\nexport const views: readonly RuntimeView[] = [${clientViews.join(',\n')}];\n`,
    'composition.json': `${stringify({ schemaVersion: 1, compositionDigest, nativeAccess, applicationId: composition.application.id, hostProfile: composition.host.profile,
      modules: modules.map(({ id, version, operations }) => ({ id, version, routes: operations.map(({ handler, ...metadata }) => metadata) })),
      views: views.map(({ component, ...metadata }) => metadata), packageArchivesVerified: false })}\n`,
  };
  mkdirSync(output, { recursive: true });
  for (const [name, content] of Object.entries(rendered)) {
    const target = confined(root, destinations[name], { missing: true });
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) writeFileSync(target, content, 'utf8');
  }
  return { compositionDigest, nativeAccess, moduleCount: modules.length, viewCount: views.length, outputs: Object.values(destinations).map(file => slash(path.relative(root, file))) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const compositionPath = process.env.CREEZIO_COMPOSITION || 'configuration/composition.json';
  try { console.log(JSON.stringify(await composeRuntime({ compositionPath, lockPath: process.env.CREEZIO_COMPOSITION_LOCK || undefined }), null, 2)); }
  catch (error) { console.error(JSON.stringify({ code: error.code ?? 'build.failed', message: error.message, diagnostics: error.diagnostics ?? [] })); process.exitCode = 1; }
}
