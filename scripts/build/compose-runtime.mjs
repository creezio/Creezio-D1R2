#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { compileCompositionSchema } from '../data/composition-schema.mjs';
import { compileOperationSchemas } from '../operations/schemas.mjs';
import { compileHttpBindings } from '../operations/http-bindings.mjs';
import { compileMcpBindings } from '../mcp/bindings.mjs';
import { createOperationRegistry } from '../../core/operations/registry.ts';
import { compileModuleInventoryWithDocuments } from '../../sdk/modules/inventory.mjs';
import { captureHostInventory } from '../../core/operations/host-inventory.ts';
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

/** Match deployed descriptors by their exact lock identity, not catalog ordering. */
export function currentModuleCandidateKeys(composition, lock, inventory) {
  return composition.modules.map(selection => {
    const node = lock.modules.find(item => item.moduleId === selection.moduleId);
    const found = inventory.candidates.filter(candidate => candidate.moduleId === selection.moduleId
      && candidate.version === node?.version && candidate.origin === node.origin
      && candidate.lockNode.contractIntegrity === node.contractIntegrity
      && candidate.lockNode.runtime.integrity === node.runtime.integrity
      && candidate.lockNode.validation.integrity === node.validation.integrity
      && contractIntegrity(candidate.source) === contractIntegrity(selection.source));
    if (found.length !== 1) fail('inventory.current-candidate', 'Every deployed module must match one exact inventory candidate.');
    return found[0].candidateKey;
  });
}

/** Build-time only: validates inert declarations, checks selected local files, and emits static imports.
 * Does not install packages, import their code, grant authorization, execute SQL, or publish anything.
 * Package archive provenance/integrity is a separate T-30 qualification; an installed directory is not that proof.
 */
/** Read and validate inert composition descriptors without generating output or loading module code. */
export function loadRuntimeComposition({ root = process.cwd(), compositionPath = 'configuration/composition.json', lockPath } = {}) {
  root = path.resolve(root);
  confined(root, root, { directory: true });
  const compositionFile = confined(root, compositionPath);
  const lockFile = confined(root, lockPath ?? compositionPath.replace(/\.json$/, '.lock.json'));
  const composition = loadJson(compositionFile, { root }), lock = loadJson(lockFile, { root });
  if (!Array.isArray(composition.modules)) fail('composition.invalid', 'The composition must declare its selected module collection.');
  const located = composition.modules.map(selection => locateModule(root, selection));
  const result = validateComposition(composition, { modules: located.map(item => item.descriptor), lock });
  if (result.errors.length) throw new CompositionBuildError('composition.invalid', 'Composition and lock validation failed.', result.errors);
  return { root, compositionFile, lockFile, composition, lock, located, result };
}

export async function composeRuntime({ root = process.cwd(), compositionPath = 'configuration/composition.json', lockPath,
  inventoryPath = 'configuration/module-inventory.json', outputDir = '.creezio/generated' } = {}) {
  const loaded = loadRuntimeComposition({ root, compositionPath, lockPath });
  root = loaded.root;
  const { compositionFile, lockFile, composition, lock, located, result } = loaded;
  const dataPlan = compileCompositionSchema({ composition, lock, modules: located.map(item => item.descriptor) });
  const operationPlan = compileOperationSchemas({ composition, lock, modules: located.map(item => item.descriptor) });
  const output = confined(root, outputDir, { directory: true, missing: true });
  const destinations = Object.fromEntries(['server.ts', 'client.tsx', 'data-catalog.ts', 'module-inventory.ts', 'operations.ts', 'operation-validators.mjs', 'composition.json'].map(name => [name, confined(root, path.join(output, name), { missing: true })]));
  if (located.some(item => contained(item.directory, output))
    || Object.values(destinations).some(destination => destination === compositionFile || destination === lockFile)) {
    fail('output.source-collision', 'Generated output must not overwrite selected module sources or composition inputs.');
  }
  const indexes = new Map(located.map(item => [item.descriptor.identity.id, item]));
  const inactive = result.metrics.disabledContributions ?? [];
  const active = (moduleId, pointer) => !inactive.some(item => item.moduleId === moduleId && (item.path === pointer || pointer.startsWith(`${item.path}/`)));
  const resolveOperation = reference => indexes.get(reference.moduleId)?.descriptor.contracts.operations.find(item => item.id === reference.id);
  const serverImports = [], clientImports = [], operationImports = [], operationHandlers = [], modules = [], views = [], navigation = [], permissions = [];
  const permissionTitles = Object.create(null);
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
    for (const stylesheet of descriptor.contracts.ui.styles) {
      const file = moduleFile(root, item, stylesheet, {exported: true});
      clientImports.push(`import ${JSON.stringify(importSpecifier(output, file))};`);
    }
    for (const [index, permission] of descriptor.contracts.permissions.entries()) {
      if (!active(selection.moduleId, `/contracts/permissions/${index}`)) continue;
      const id = `${selection.moduleId}:${permission.id}`;
      permissionTitles[id] = permission.title;
      // These two definitions are owned and checked by the native resolver.
      if (id === 'creezio.access:manage' || id === 'creezio.access:impersonate') continue;
      permissions.push({ id, audiences: permission.audiences,
        actors: permission.actors.filter(actor => !['anonymous', 'signed-webhook'].includes(actor)) });
    }
    for (const entry of operationPlan.catalog.modules.find(module => module.moduleId === selection.moduleId).operations) {
      if (!entry.active) continue;
      operationHandlers.push({ name: `${selection.moduleId}:${entry.operation.id}`, handler: importCode(output, item, entry.operation.handler, operationImports) });
    }
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
      const firstSegment = view.route.split('/')[1];
      if (['access', 'workspace', 'oauth', 'mcp', '.well-known'].includes(firstSegment) || firstSegment.includes('{')) {
        fail('view.reserved', 'Native access, OAuth, MCP and workspace entry routes belong to the host.');
      }
      const component = importCode(output, item, view.component, clientImports);
      const validator = operationPlan.catalog.modules.find(module => module.moduleId === selection.moduleId)
        .schemas.find(schema => schema.schemaId === view.input.schemaId)?.validator;
      if (!validator) fail('view.schema', 'A view requires its compiled declared input schema.');
      const stateValidator = view.panel.stateSchema ? operationPlan.catalog.modules
        .find(module => module.moduleId === selection.moduleId).schemas
        .find(schema => schema.schemaId === view.panel.stateSchema.schemaId)?.validator : undefined;
      if (view.panel.stateSchema && !stateValidator) fail('view.state-schema', 'A persistent panel state requires its compiled declared schema.');
      const access = view.surfaces.includes('front') && composition.exposure.app.moduleIds.includes(selection.moduleId)
        && view.permissions.length === 0 && view.operations.every(reference => publicOperation(resolveOperation(reference))) ? 'public-read' : 'protected';
      views.push({ id: `${selection.moduleId}:${view.id}`, moduleId: selection.moduleId, moduleVersion: descriptor.identity.version, route: view.route,
        title: view.title, surfaces: view.surfaces, permissions: view.permissions, operations: view.operations,
        input: view.input, panel: view.panel, validator, stateValidator,
        audiences: ['admin', 'app'].filter(audience => composition.exposure[audience].moduleIds.includes(selection.moduleId)
          && (audience === 'app' || view.surfaces.includes('workspace'))), access, component });
    }
    for (const [index, item] of descriptor.contracts.ui.navigation.entries()) {
      if (!active(selection.moduleId, `/contracts/ui/navigation/${index}`)) continue;
      navigation.push({ id: `${selection.moduleId}:${item.id}`, moduleId: selection.moduleId,
        title: item.title, viewId: `${item.view.moduleId}:${item.view.id}`, order: item.order,
        surfaces: item.surfaces, permissions: item.permissions,
        audiences: ['admin', 'app'].filter(audience => composition.exposure[audience].moduleIds.includes(selection.moduleId)
          && (audience === 'app' || item.surfaces.includes('workspace'))) });
    }
  }
  const compositionDigest = contractIntegrity(composition);
  let runtimeInventory;
  if (composition.modules.some(selection => selection.moduleId === 'creezio.modules-settings' && selection.enabled)) {
    const config = loadJson(confined(root, inventoryPath), {root});
    if (config.schemaVersion !== 1 || !Array.isArray(config.allowedOrigins) || !Array.isArray(config.available)
      || Object.keys(config).some(key => !['schemaVersion', 'allowedOrigins', 'available'].includes(key)))
      fail('inventory.configuration', 'An explicit, bounded module inventory configuration is required.');
    const candidates = composition.modules.map(selection => ({source: selection.source,
      lockNode: lock.modules.find(node => node.moduleId === selection.moduleId)})).concat(config.available);
    const {inventory,currentInstalledDocuments}=compileModuleInventoryWithDocuments({root, candidates,
      selectedCount:composition.modules.length,allowedOrigins: config.allowedOrigins});
    currentModuleCandidateKeys(composition,lock,inventory);
    runtimeInventory = captureHostInventory({current: {composition, lock, descriptors: located.map(item => item.descriptor)},
      inventory,currentInstalledDocuments}, compositionDigest);
  }
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
  const httpBindings = compileHttpBindings({composition, modules: located.map(item => item.descriptor),
    operationCatalog: operationPlan.catalog, disabledContributions: inactive});
  const mcpCatalog = compileMcpBindings({composition, modules: located.map(item => item.descriptor),
    operationCatalog: operationPlan.catalog, disabledContributions: inactive});
  const workspaceViews = views.filter(view => view.surfaces.includes('workspace') && view.audiences.length > 0);
  const workspaceIds = new Set(workspaceViews.map(view => view.id));
  const workspaceCatalog = { compositionDigest,
    views: workspaceViews.map(({id, surfaces, audiences, permissions}) => ({id, surfaces, audiences, permissions})),
    navigation: navigation.filter(item => item.surfaces.includes('workspace') && item.audiences.length > 0 && workspaceIds.has(item.viewId))
      .map(({id, viewId, surfaces, audiences, permissions}) => ({id, viewId, surfaces, audiences, permissions})) };
  // Validate the complete operation registry, including operations with no HTTP exposure.
  // Only inert sentinels are supplied here; package handlers never execute during composition.
  try {
    const sentinel = () => { throw new Error('Build validation must never invoke contribution code.'); };
    createOperationRegistry({ catalog: operationPlan.catalog,
      validators: Object.fromEntries(operationPlan.catalog.modules.flatMap(module => module.schemas.map(schema => [schema.validator, sentinel]))),
      handlers: Object.fromEntries(operationHandlers.map(item => [item.name, sentinel])) });
  } catch { fail('build.operation-registry', 'The operation registry exceeds host capabilities or contains invalid bindings.'); }
  const banner = '// Generated from an explicit validated composition. Do not edit.\n';
  const serverModules = modules.map(module => `{ id: ${JSON.stringify(module.id)}, version: ${JSON.stringify(module.version)}, operations: [${module.operations.map(operation => {
    const { handler, ...metadata } = operation; return `{ ...${JSON.stringify(metadata)}, handler: ${handler} }`;
  }).join(',\n')}] }`);
  const clientViews = views.map(view => { const { component, validator, stateValidator, ...metadata } = view;
    return `{ ...${JSON.stringify(metadata)}, component: ${component}, validateInput: compiledValidators.${validator}${stateValidator ? `, validateState: compiledValidators.${stateValidator}` : ''} }`; });
  if (clientViews.length) clientImports.unshift(`import * as compiledValidators from './operation-validators.mjs';`);
  const freezeSource = `const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };\n`;
  // Select declared exports explicitly. Bundlers may decorate a namespace with
  // enumerable Symbol.toStringTag; spreading it would not be a function registry.
  const validatorEntries = operationPlan.catalog.modules.flatMap(module => module.schemas)
    .map(schema => `${JSON.stringify(schema.validator)}: compiledValidators.${schema.validator}`).join(',\n');
  const rendered = {
    'module-inventory.ts': `${banner}import type { ModuleSettingsHostInventory } from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/module-settings/types.ts')))};\n${freezeSource}${runtimeInventory
      ? `const inventory: ModuleSettingsHostInventory['inventory'] = freeze(${JSON.stringify(runtimeInventory.inventory)});\nexport const runtimeInventory: ModuleSettingsHostInventory = freeze({current: {composition: ${JSON.stringify(composition)}, lock: ${JSON.stringify(lock)}, descriptors: ${JSON.stringify(currentModuleCandidateKeys(composition,lock,runtimeInventory.inventory))}.map(key => inventory.candidates.find(candidate => candidate.candidateKey === key)!.descriptor)}, inventory, currentInstalledDocuments: ${JSON.stringify(runtimeInventory.currentInstalledDocuments)}});\n`
      : 'export const runtimeInventory: ModuleSettingsHostInventory | undefined = undefined;\n'}`,
    'operation-validators.mjs': `${banner}${operationPlan.validatorsCode}`,
    'operations.ts': `${banner}import type { RuntimeOperationCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/operations/types.ts')))};\nimport * as compiledValidators from './operation-validators.mjs';\n${operationImports.join('\n')}\nconst freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };\nexport const operationCatalog: RuntimeOperationCatalog = freeze(${JSON.stringify(operationPlan.catalog)});\nexport const operationValidators = Object.freeze({${validatorEntries}});\nexport const operationHandlers = Object.freeze({${operationHandlers.map(item => `${JSON.stringify(item.name)}: ${item.handler}`).join(',\n')}});\n`,
    'data-catalog.ts': `${banner}import type { RuntimeDataCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/data/types.ts')))};\nconst freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };\nexport const dataCatalog: RuntimeDataCatalog = freeze(${JSON.stringify(dataPlan.runtimeCatalog)});\n`,
    'server.ts': `${banner}import type { RuntimeModule, RuntimeNativeAccess } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/runtime/types.ts')))};\nimport type { OperationHttpBinding } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/operations/http-types.ts')))};\nimport type { PermissionDefinition } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/authorization/types.ts')))};\nimport type { WorkspaceAuthorizationCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/workspace/authorization.ts')))};\nimport type { McpCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/mcp/types.ts')))};\n${serverImports.join('\n')}\n${freezeSource}export const compositionDigest = ${JSON.stringify(compositionDigest)};\nexport const nativeAccess: RuntimeNativeAccess = Object.freeze(${JSON.stringify(nativeAccess)});\nexport const modules: readonly RuntimeModule[] = [${serverModules.join(',\n')}];\nexport const httpBindings: readonly OperationHttpBinding[] = freeze(${JSON.stringify(httpBindings)});\nexport const mcpCatalog: McpCatalog = freeze(${JSON.stringify(mcpCatalog)});\nexport const permissions: readonly PermissionDefinition[] = freeze(${JSON.stringify(permissions)});\nexport const permissionTitles: Readonly<Record<string, string>> = freeze(${JSON.stringify(permissionTitles)});\nexport const workspaceCatalog: WorkspaceAuthorizationCatalog = freeze(${JSON.stringify(workspaceCatalog)});\n`,
    'client.tsx': `${banner}import type { RuntimeView, RuntimeNavigation } from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/runtime/ui.ts')))};\nimport type { OperationHttpBinding } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/operations/http-types.ts')))};\n${clientImports.join('\n')}\n${freezeSource}export const compositionDigest = ${JSON.stringify(compositionDigest)};\nexport const nativeAccess = Object.freeze(${JSON.stringify(nativeAccess)});\nexport const views: readonly RuntimeView[] = freeze([${clientViews.join(',\n')}]);\nexport const navigation: readonly RuntimeNavigation[] = freeze(${JSON.stringify(navigation)});\nexport const httpBindings: readonly OperationHttpBinding[] = freeze(${JSON.stringify(httpBindings)});\n`,
    'composition.json': `${stringify({ schemaVersion: 1, compositionDigest, nativeAccess, applicationId: composition.application.id, hostProfile: composition.host.profile,
      operations: { schemasDigest: operationPlan.schemasDigest, validatorsDigest: operationPlan.validatorsDigest, ...operationPlan.metrics },
      modules: modules.map(({ id, version, operations }) => ({ id, version, routes: operations.map(({ handler, ...metadata }) => metadata) })),
      views: views.map(({ component, ...metadata }) => metadata), navigation, httpBindings, packageArchivesVerified: false })}\n`,
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
