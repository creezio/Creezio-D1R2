#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { compileCompositionSchema } from '../data/composition-schema.mjs';
import { compileOperationSchemas } from '../operations/schemas.mjs';
import { compileHttpBindings } from '../operations/http-bindings.mjs';
import { compileMcpBindings } from '../mcp/bindings.mjs';
import { compileWidgetCatalog, compileWidgetContextValidators, projectWidgetProviderTools } from '../widgets/compile.mjs';
import {providerOutputDescription} from './provider-output-description.mjs';
import { serializeMcpCatalogWithWidgetResources } from '../widgets/serialize.mjs';
import { createOperationRegistry } from '../../core/operations/registry.ts';
import { createMcpCatalog } from '../../core/mcp/catalog.ts';
import { compileModuleInventoryWithDocuments } from '../../sdk/modules/inventory.mjs';
import { packageExports, verifyCandidatePackageReceipt } from '../modules/package-receipt.mjs';
import { captureHostInventory } from '../../core/operations/host-inventory.ts';
import {captureFileCategory} from '../../core/files/mapping.ts';
import {captureConnectorDescriptor} from '../../core/connectors/host.ts';
import {compileSearchProjectionSources} from '../../core/search/projection.ts';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadJson } from '../../sdk/contracts/load.mjs';
import { validateComposition, contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { safePackagePath } from '../../sdk/contracts/references.mjs';
import { validateRuntimeDefinition, RuntimeConfigurationError } from '../../core/runtime/dispatch.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import ts from 'typescript';
import {buildSync} from 'esbuild';
import {assertWorkerBoundary} from './worker-boundary.mjs';

export class CompositionBuildError extends Error {
  constructor(code, message, diagnostics = []) { super(message); this.name = 'CompositionBuildError'; this.code = code; this.diagnostics = diagnostics; }
}
const fail = (code, message) => { throw new CompositionBuildError(code, message); };
const slash = value => value.split(path.sep).join('/');
/** Share one verified central script segment per module; every HTML resource stays byte exact. */
export function sharedWidgetScriptSources(resources) {
  const scriptOf = text => {
    const open = '<script>', close = '</script>', start = text.indexOf(open);
    if (start < 0 || text.indexOf('<script') !== start
      || text.indexOf('<script', start + open.length) !== -1) return null;
    const end = text.indexOf(close, start + open.length);
    if (end < 0 || text.indexOf(close, end + close.length) !== -1) return null;
    return {start,text:text.slice(start, end + close.length)};
  };
  const scripts = resources.map(resource => scriptOf(resource.text)), groups = new Map();
  resources.forEach((resource,index) => groups.set(resource.moduleId,
    [...(groups.get(resource.moduleId) ?? []),index]));
  const sharedParts = [], assigned = new Map();
  for (const indexes of groups.values()) {
    if (indexes.length < 2 || indexes.some(index => !scripts[index])) continue;
    const anchor = scripts[indexes[0]].text, offset = 4096, witnessLength = 8192;
    if (anchor.length < offset + witnessLength) continue;
    const witness = anchor.slice(offset, offset + witnessLength);
    if (anchor.indexOf(witness) !== offset || anchor.indexOf(witness,offset+1) !== -1) continue;
    const matches = [{delta:0,left:0,right:anchor.length}];
    let valid = true;
    for (const index of indexes.slice(1)) {
      const other = scripts[index].text, found = other.indexOf(witness);
      if (found < 0 || other.indexOf(witness,found+1) !== -1) { valid = false; break; }
      let left = 0, right = witnessLength;
      while (offset-left>0 && found-left>0 && anchor[offset-left-1]===other[found-left-1]) left++;
      while (offset+right<anchor.length && found+right<other.length
        && anchor[offset+right]===other[found+right]) right++;
      matches.push({delta:found-offset,left:offset-left,right:offset+right});
    }
    if (!valid) continue;
    const left = Math.max(...matches.map(match=>match.left));
    const right = Math.min(...matches.map(match=>match.right));
    if (right-left < 64*1024) continue;
    const part = anchor.slice(left,right);
    const positions = indexes.map((index,i)=>scripts[index].start+left+matches[i].delta);
    if (indexes.some((index,i)=>resources[index].text.slice(positions[i],positions[i]+part.length)!==part)) continue;
    const partIndex = sharedParts.length;
    sharedParts.push(part);
    indexes.forEach((index,i)=>assigned.set(index,{partIndex,position:positions[i]}));
  }
  const resourceSources = resources.map((resource,index) => {
    const shared = assigned.get(index);
    if (!shared) {
      if (`sha256-${createHash('sha256').update(resource.text).digest('hex')}` !== resource.digest)
        fail('widget.resource-digest','Compiled widget resource digest differs from its HTML.');
      return JSON.stringify(resource);
    }
    const before = resource.text.slice(0,shared.position);
    const after = resource.text.slice(shared.position + sharedParts[shared.partIndex].length);
    const rebuilt = before + sharedParts[shared.partIndex] + after;
    if (rebuilt !== resource.text
      || `sha256-${createHash('sha256').update(rebuilt).digest('hex')}` !== resource.digest)
      fail('widget.resource-digest','Shared widget resource differs from its compiled HTML.');
    const textSource = `${JSON.stringify(before)}+widgetSharedParts[${shared.partIndex}]+${JSON.stringify(after)}`;
    return `{${Object.entries(resource).map(([key,value])=>
      `${JSON.stringify(key)}:${key==='text'?textSource:JSON.stringify(value)}`).join(',')}}`;
  });
  return {sharedParts,resourceSources};
}
const contained = (root, target) => { const rel = path.relative(root, target); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function externalPackageCandidate(root,item,composition,lock,allowedOrigins) {
  if(!exactKeys(item,['moduleId','packageName','version','runtime','validation','receipt'])
    || ![item.runtime,item.validation,item.receipt].every(value=>exactKeys(value,['path','integrity'])))
    fail('inventory.external-package','External package declaration is malformed.');
  const selection=composition.modules.find(value=>value.moduleId===item.moduleId);
  const currentNode=lock.modules.find(value=>value.moduleId===item.moduleId);
  if(!selection||selection.source?.kind!=='package'||selection.source.name!==item.packageName||!currentNode)
    fail('inventory.external-package','External package must update one selected package.');
  const paths=[item.runtime.path,item.validation.path,item.receipt.path];
  if(new Set(paths).size!==3||paths.some(value=>!safePackagePath(value)
    ||!value.startsWith('.creezio/packages/')))
    fail('inventory.external-package','External archive paths must be distinct local package files.');
  const bytes=paths.map((value,index)=>{
    const file=confined(root,value),limit=index===2?64*1024:64*1024*1024;
    if(statSync(file).size>limit)fail('inventory.external-package','External package exceeds its byte bound.');
    return readFileSync(file);
  });
  return verifyCandidatePackageReceipt({currentNode,packageName:item.packageName,version:item.version,
    allowedOrigins,runtimeBytes:bytes[0],validationBytes:bytes[1],receiptBytes:bytes[2],
    expected:{runtime:item.runtime.integrity,validation:item.validation.integrity,
      receipt:item.receipt.integrity}});
}

export function mergeExternalPackageCandidates({root,composition,lock,installedInventory,
  externalPackages=[],allowedOrigins}) {
  if(!Array.isArray(externalPackages)||externalPackages.length>16)
    fail('inventory.external-package','External package count exceeds its bound.');
  const external=externalPackages.map(item=>externalPackageCandidate(root,item,composition,
    lock,allowedOrigins));
  const combined=[...installedInventory.candidates,...external];
  if(combined.length>1000||new Set(combined.map(item=>item.candidateKey)).size!==combined.length
    ||new Set(combined.map(item=>`${item.moduleId}:${item.version}:${item.origin}`)).size!==combined.length)
    fail('inventory.external-package','External package duplicates an installed or declared candidate.');
  combined.sort((left,right)=>left.moduleId.localeCompare(right.moduleId)
    ||left.version.localeCompare(right.version)||left.candidateKey.localeCompare(right.candidateKey));
  const base={schemaVersion:1,candidates:combined};
  return {...base,digest:contractIntegrity(base)};
}

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

function themeCodeFile(root, located, reference) {
  const file = codeFile(root, located, reference);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const exported = source.statements.some(statement => {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause
      && ts.isNamedExports(statement.exportClause))
      return statement.exportClause.elements.some(element => !element.isTypeOnly && element.name.text === reference.export);
    if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return false;
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration =>
      ts.isIdentifier(declaration.name) && declaration.name.text === reference.export);
    return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && statement.name?.text === reference.export;
  });
  if (!exported) fail('front.theme-export', 'The selected theme component must have a named runtime export.');
  return file;
}

const publicOperation = operation => operation?.kind === 'query' && operation.context === 'application'
  && operation.actors.length === 1 && operation.actors[0] === 'anonymous' && operation.permissions.length === 0;
const importSpecifier = (output, source) => { const rel = slash(path.relative(output, source)); return rel.startsWith('.') ? rel : `./${rel}`; };
const stringify = value => JSON.stringify(value, null, 2);
// Keep generated catalogues within validateSurfaceAuthorizationCatalog's runtime bounds.
export function checkSurfaceCatalogBounds(surface, catalog) {
  for (const section of ['views', 'navigation', 'slots']) {
    const entries = catalog[section] ?? [];
    if (entries.length > 1000) fail('build.catalog-limit', `${surface} ${section} exceeds the runtime catalog limit of 1000 entries.`);
    if (entries.some(entry => entry.id.length > 128))
      fail('build.catalog-id', `${surface} ${section} contains an identifier longer than the runtime limit of 128 characters.`);
  }
}

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
  const destinations = Object.fromEntries(['server.ts', 'client.tsx', 'widget-catalog.ts', 'data-catalog.ts', 'file-catalog.ts', 'provider-catalog.ts', 'public-pages.ts', 'module-inventory.ts', 'operations.ts', 'operation-validators.mjs', 'operation-validators.d.mts', 'widget-context-validators.mjs', 'widget-context-validators.d.mts', 'composition.json'].map(name => [name, confined(root, path.join(output, name), { missing: true })]));
  if (located.some(item => contained(item.directory, output))
    || Object.values(destinations).some(destination => destination === compositionFile || destination === lockFile)) {
    fail('output.source-collision', 'Generated output must not overwrite selected module sources or composition inputs.');
  }
  const indexes = new Map(located.map(item => [item.descriptor.identity.id, item]));
  const inactive = result.metrics.disabledContributions ?? [];
  const active = (moduleId, pointer) => !inactive.some(item => item.moduleId === moduleId && (item.path === pointer || pointer.startsWith(`${item.path}/`)));
  const resolveOperation = reference => indexes.get(reference.moduleId)?.descriptor.contracts.operations.find(item => item.id === reference.id);
  const serverImports = [], clientImports = [], operationImports = [], operationHandlers = [], modules = [], views = [], navigation = [], slots = [], permissions = [];
  const publicPageImports = [], publicPages = [];
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
    if (descriptor.entrypoints.publicPage) {
      codeFile(root, item, descriptor.entrypoints.publicPage.renderer);
      codeFile(root, item, descriptor.entrypoints.publicPage.imageIds);
      moduleFile(root, item, descriptor.entrypoints.publicPage.stylesheet, {exported:true});
    }
    if (!selection.enabled) continue;
    const moduleIntegrity = lock.modules.find(node => node.moduleId === selection.moduleId)?.runtime.integrity;
    if (!/^sha256-[a-f0-9]{64}$/.test(moduleIntegrity ?? ''))
      fail('build.module-integrity', 'Every active module view needs the exact locked runtime integrity.');
    if (descriptor.entrypoints.publicPage && composition.exposure.app.moduleIds.includes(selection.moduleId)
      && active(selection.moduleId, '/entrypoints/publicPage')) {
      const entry=descriptor.entrypoints.publicPage;
      const names={page:'page',pagePublication:'page_publication',publicPage:'public_page',
        navigation:'navigation',publishedPageMedia:'published_page_media',fileMetadata:'file_metadata'};
      const fields={page:['context_id','id','published_slug','published_title','published_sections',
          'published_settings','published_seo','published_at','published_revision'],
        pagePublication:['context_id','page_id','state','published_revision'],
        publicPage:['context_id','page_id','published_revision'],
        navigation:['context_id','id','published_items','published_at'],
        publishedPageMedia:['context_id','page_id','file_id','content_type','byte_size','digest',
          'intent_id','generation'],
        fileMetadata:['context_id','file_id','object_key','state','content_type','byte_size',
          'digest','intent_id','generation']};
      const selected={};
      for (const [name,target] of Object.entries(names)) {
        const reference=entry.models[name];
        const model=descriptor.contracts.models.find(model=>model.id===reference.id);
        if (reference.moduleId!==selection.moduleId || reference.kind!=='model' || !model
          || model.scope!=='context'||model.contextField!=='context_id'||model.public
          || fields[name].some(field=>!model.fields.some(item=>item.id===field)))
          fail('public-page.model', 'Public page model references must belong to the selected module.');
        selected[target]=reference.id;
      }
      const rendererSource=codeFile(root,item,entry.renderer);
      const renderer='public_page_renderer';
      publicPageImports.push(`import { ${entry.renderer.export} as ${renderer} } from './public-page-renderer.mjs';`);
      const imageIds=importCode(output,item,entry.imageIds,publicPageImports);
      const stylesheet=readFileSync(moduleFile(root,item,entry.stylesheet,{exported:true}),'utf8');
      if(Buffer.byteLength(stylesheet)>64*1024)fail('public-page.stylesheet','Public page stylesheet exceeds its bound.');
      publicPages.push({moduleId:selection.moduleId,models:selected,renderer,rendererSource,
        rendererExport:entry.renderer.export,imageIds,stylesheet});
      if(publicPages.length>1)fail('public-page.conflict','Only one selected public page renderer may own /p.');
    }
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
      if (['access', 'workspace', 'oauth', 'mcp', '.well-known', 'api'].includes(firstSegment) || firstSegment.includes('{')) {
        fail('view.reserved', 'Access, API, OAuth, MCP and workspace entry routes belong to the host.');
      }
      const component = importCode(output, item, view.component, clientImports);
      const validator = operationPlan.catalog.modules.find(module => module.moduleId === selection.moduleId)
        .schemas.find(schema => schema.schemaId === view.input.schemaId)?.validator;
      if (!validator) fail('view.schema', 'A view requires its compiled declared input schema.');
      const stateValidator = view.panel.stateSchema ? operationPlan.catalog.modules
        .find(module => module.moduleId === selection.moduleId).schemas
        .find(schema => schema.schemaId === view.panel.stateSchema.schemaId)?.validator : undefined;
      if (view.panel.stateSchema && !stateValidator) fail('view.state-schema', 'A persistent panel state requires its compiled declared schema.');
      const access = view.surfaces.includes('front') && !view.surfaces.includes('workspace')
        && composition.exposure.app.moduleIds.includes(selection.moduleId)
        && view.permissions.length === 0 && view.operations.every(reference => publicOperation(resolveOperation(reference))) ? 'public-read' : 'protected';
      views.push({ id: `${selection.moduleId}:${view.id}`, moduleId: selection.moduleId,
        moduleVersion: descriptor.identity.version, moduleIntegrity, route: view.route,
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
    for (const [index, slot] of descriptor.contracts.ui.slots.entries()) {
      if (!active(selection.moduleId, `/contracts/ui/slots/${index}`)) continue;
      slots.push({id:`${selection.moduleId}:${slot.id}`,moduleId:selection.moduleId,slot:slot.slot,
        viewId:`${slot.view.moduleId}:${slot.view.id}`,surfaces:slot.surfaces,permissions:slot.permissions,
        audiences:['admin','app'].filter(audience=>composition.exposure[audience].moduleIds.includes(selection.moduleId)
          && (audience==='app'||slot.surfaces.includes('workspace')))});
    }
  }
  const compositionDigest = contractIntegrity(composition);
  // A provider receives the exact input contracts, never schemas reconstructed from UI labels.
  // Runtime discovery still checks operation exposure, effects and the caller's current rights.
  const toolCatalog = operationPlan.catalog.modules.flatMap(module => module.operations.filter(entry => entry.active).map(entry => {
    const schemas=indexes.get(module.moduleId)?.descriptor.contracts.schemas;
    const inputSchema=schemas?.find(schema=>schema.id===entry.operation.input.schemaId)?.schema;
    const outputSchema=schemas?.find(schema=>schema.id===entry.operation.output.schemaId)?.schema;
    if (!inputSchema) fail('provider.input-schema', 'An active operation has no canonical input schema.');
    if (!outputSchema) fail('provider.output-schema', 'An active operation has no canonical output schema.');
    const outputDescription=entry.operation.kind==='query'?providerOutputDescription(outputSchema):'';
    return {moduleId: module.moduleId, operationId: entry.operation.id, inputSchema, schemaDigest: contractIntegrity(inputSchema),
      audiences: ['admin','app'].filter(audience => composition.exposure[audience].moduleIds.includes(module.moduleId)),
      ...(outputDescription?{outputDescription}:{})};
  }));
  const providerImports = [];
  const connectors=located.flatMap(item=>{
    const moduleId=item.descriptor.identity.id;
    if(!composition.modules.some(selection=>selection.moduleId===moduleId&&selection.enabled))return [];
    return (item.descriptor.contracts.connectors??[]).map(captureConnectorDescriptor);
  });
  if(connectors.length>16)fail('connector.limit','An application supports at most sixteen declared connectors.');
  const searchDeclarations=located.flatMap(item=>{
    const moduleId=item.descriptor.identity.id;
    if(!composition.modules.some(selection=>selection.moduleId===moduleId&&selection.enabled))return [];
    return (item.descriptor.contracts.search??[]).filter((declaration,index)=>
      declaration.engine==='provider'&&active(moduleId,`/contracts/search/${index}`));
  });
  const searchSources=compileSearchProjectionSources(searchDeclarations,dataPlan.runtimeCatalog);
  const searchProjections=[...new Set(connectors.map(connector=>connector.moduleId))].flatMap(moduleId=>{
    const providers=new Set(connectors.filter(connector=>connector.moduleId===moduleId)
      .map(connector=>connector.id));
    const sources=searchDeclarations.filter(declaration=>providers.has(declaration.provider))
      .map(declaration=>searchSources.find(source=>source.id===`${declaration.model.moduleId}:${declaration.id}`
        &&source.moduleId===declaration.model.moduleId));
    if(sources.some(source=>!source))fail('search.source','An active search source failed compilation.');
    return sources.length?[{moduleId,sources}]:[];
  });
  if(searchDeclarations.some(declaration=>!connectors.some(connector=>connector.id===declaration.provider)))
    fail('search.provider','A provider-backed search source needs its active declared connector.');
  const webhookMappings=connectors.filter(connector=>connector.webhook).map(connector=>{
    const webhook=connector.webhook,owner=indexes.get(connector.moduleId);
    const matching=(owner?.descriptor.contracts.api??[]).filter(api=>api.path===webhook.path
      &&api.operation?.moduleId===connector.moduleId&&api.operation?.id===webhook.operationId
      &&api.auth?.length===1&&api.auth[0]==='webhook-signature');
    if(matching.length!==1)fail('webhook.binding','A signed webhook needs one exact declared HTTP binding.');
    return {moduleId:connector.moduleId,operationId:webhook.operationId,path:webhook.path,
      mapper:importCode(output,owner,webhook.mapper,providerImports)};
  });
  const deliveryMappings=located.flatMap(item=>{
    const moduleId=item.descriptor.identity.id;
    if(!composition.modules.some(selection=>selection.moduleId===moduleId&&selection.enabled))return [];
    return (item.descriptor.contracts.deliveries??[]).flatMap((delivery,index)=>{
      if(!active(moduleId,`/contracts/deliveries/${index}`))return [];
      const provider=connectors.find(connector=>connector.moduleId===delivery.provider.publicContract.moduleId
        &&connector.id===delivery.provider.connectorId);
      const resource=provider?.resources.find(resource=>resource.id===delivery.provider.resourceId);
      const source=resolveOperation(delivery.command),prepare=resolveOperation(delivery.prepare);
      const receipt=item.descriptor.contracts.schemas.find(schema=>schema.id===delivery.receipt.schemaId);
      const receiptValidator=operationPlan.catalog.modules.find(module=>module.moduleId===moduleId)
        ?.schemas.find(schema=>schema.schemaId===delivery.receipt.schemaId)?.validator;
      if(!provider||!resource||resource.method==='GET'||!resource.idempotencyHeader
        ||!source||source.kind!=='command'||!prepare||prepare.kind!=='query'||!receipt||!receiptValidator)
        fail('delivery.binding','An active delivery needs an own command, preparation query, receipt schema and idempotent provider resource.');
      return [{id:delivery.id,moduleId,commandId:delivery.command.id,prepareId:delivery.prepare.id,
        providerModuleId:provider.moduleId,connectorId:provider.id,resourceId:resource.id,
        readinessId:delivery.provider.readiness.id,configRevisionField:delivery.provider.configRevisionField,
        prepareInput:delivery.prepareInput,matchFields:delivery.matchFields,
        envelopeField:delivery.envelopeField,modelIds:delivery.models.map(ref=>ref.id),
        projectorInput:delivery.projectorInput,acceptance:delivery.acceptance,receiptValidator,
        projector:importCode(output,item,delivery.projector,providerImports)}];
    });
  });
  let providerDefinition = 'null';
  const openAi = indexes.get('creezio.openai');
  if (openAi && composition.modules.some(selection => selection.moduleId === 'creezio.openai' && selection.enabled)) {
    const config = importCode(output, openAi, {path:'module/storage.ts',export:'openAiConfigStorage'}, providerImports);
    const vault = importCode(output, openAi, {path:'module/storage.ts',export:'openAiVaultStorage'}, providerImports);
    const transport = importCode(output, openAi, {path:'module/transport.ts',export:'createOpenAITransport'}, providerImports);
    providerDefinition = `Object.freeze({config:${config},vault:${vault},transport:${transport}})`;
  }
  const fileCatalog = {compositionDigest, categories: located.flatMap(item => {
    const moduleId = item.descriptor.identity.id;
    if (!composition.modules.some(selection => selection.moduleId === moduleId && selection.enabled)) return [];
    return item.descriptor.contracts.files.map(category => ({moduleId,
      category: captureFileCategory(dataPlan.runtimeCatalog, moduleId, category),
      audiences: ['admin','app'].filter(audience => composition.exposure[audience].moduleIds.includes(moduleId))}));
  })};
  let runtimeInventory;
  if (composition.modules.some(selection => selection.moduleId === 'creezio.modules-settings' && selection.enabled)) {
    const config = loadJson(confined(root, inventoryPath), {root});
    if (config.schemaVersion !== 1 || !Array.isArray(config.allowedOrigins) || !Array.isArray(config.available)
      || Object.keys(config).some(key => !['schemaVersion', 'allowedOrigins', 'available','validationReceipts','externalPackages'].includes(key))
      || (config.externalPackages!==undefined&&(!Array.isArray(config.externalPackages)
        ||config.externalPackages.length>16))
      || (config.validationReceipts!==undefined&&(!config.validationReceipts
        || Array.isArray(config.validationReceipts)||typeof config.validationReceipts!=='object'
        || Object.entries(config.validationReceipts).some(([moduleId,receipt])=>
          !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(moduleId)||!safePackagePath(receipt)
          ||!composition.modules.some(selection=>selection.moduleId===moduleId)))))
      fail('inventory.configuration', 'An explicit, bounded module inventory configuration is required.');
    const candidates = composition.modules.map(selection => ({source: selection.source,
      lockNode: lock.modules.find(node => node.moduleId === selection.moduleId),
      ...(config.validationReceipts?.[selection.moduleId]
        ?{validationReceipt:config.validationReceipts[selection.moduleId]}:{})})).concat(config.available);
    const {inventory:installedInventory,currentInstalledDocuments}=compileModuleInventoryWithDocuments({root, candidates,
      selectedCount:composition.modules.length,allowedOrigins: config.allowedOrigins});
    const inventory=mergeExternalPackageCandidates({root,composition,lock,installedInventory,
      externalPackages:config.externalPackages??[],allowedOrigins:config.allowedOrigins});
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
  const widgetCatalog = compileWidgetCatalog({composition, modules: located.map(item => item.descriptor),
    operationCatalog: operationPlan.catalog, disabledContributions: inactive,
    readAsset: (moduleId, relative) => readFileSync(moduleFile(root, indexes.get(moduleId), relative, {exported: true}), 'utf8'),
    bundleRenderer: (moduleId, reference) => {
      const source = codeFile(root, indexes.get(moduleId), reference);
      let bundled;
      try {
        bundled = buildSync({entryPoints: [source], absWorkingDir: root, bundle: true, write: false,
          platform: 'browser', format: 'iife', globalName: '__creezioWidget', target: 'es2022',
          legalComments: 'eof', sourcemap: false, minify: true, logLevel: 'silent',
          footer: {js: `__creezioWidget.${reference.export}();`}});
      } catch { fail('widget.renderer', 'A widget renderer cannot be bundled for the browser.'); }
      if (bundled.outputFiles.length !== 1) fail('widget.renderer', 'A widget renderer must be one self-contained browser script.');
      return bundled.outputFiles[0].text.replaceAll('</script', '<\\/script');
    }});
  const mcpCatalog = compileMcpBindings({composition, modules: located.map(item => item.descriptor),
    operationCatalog: operationPlan.catalog, disabledContributions: inactive, widgetCatalog});
  const providerToolCatalog = projectWidgetProviderTools(mcpCatalog, toolCatalog);
  const mcpCatalogLiteral = serializeMcpCatalogWithWidgetResources(mcpCatalog, widgetCatalog);
  const workspaceViews = views.filter(view => view.surfaces.includes('workspace') && view.audiences.length > 0);
  const workspaceIds = new Set(workspaceViews.map(view => view.id));
  const workspaceCatalog = { compositionDigest,
    views: workspaceViews.map(({id, surfaces, audiences, permissions}) => ({id, surfaces, audiences, permissions})),
    navigation: navigation.filter(item => item.surfaces.includes('workspace') && item.audiences.length > 0 && workspaceIds.has(item.viewId))
      .map(({id, viewId, surfaces, audiences, permissions}) => ({id, viewId, surfaces, audiences, permissions})) };
  const workspaceNavigationCatalog={compositionDigest,entries:navigation
    .filter(item=>item.surfaces.includes('workspace')&&item.audiences.length>0&&workspaceIds.has(item.viewId))
    .map(item=>{
      const view=workspaceViews.find(candidate=>candidate.id===item.viewId);
      return {id:item.id,moduleId:item.moduleId,viewId:item.viewId,title:item.title,order:item.order,
        route:view.route,audiences:item.audiences.filter(audience=>view.audiences.includes(audience)),
        permissionIds:[...new Set([...view.permissions,...item.permissions].map(ref=>`${ref.moduleId}:${ref.id}`))]};
    })};
  const frontViews=views.filter(view=>view.surfaces.includes('front')&&view.audiences.includes('app'));
  const frontViewIds=new Set(frontViews.map(view=>view.id));
  const frontNavigation=navigation.filter(item=>item.surfaces.includes('front')&&item.audiences.includes('app')
    && frontViewIds.has(item.viewId));
  const frontSlots=slots.filter(item=>item.surfaces.includes('front')&&item.audiences.includes('app')
    && frontViewIds.has(item.viewId));
  // Slots have no input mapping. Refuse a view that cannot render with the empty input.
  const checkedSlotInputs=new Set();
  for(const slot of frontSlots) {
    if(checkedSlotInputs.has(slot.viewId))continue;
    checkedSlotInputs.add(slot.viewId);
    const view=frontViews.find(item=>item.id===slot.viewId);
    if(view.panel.identityFields.length>0 || view.route.split('/').some(part=>/^\{[A-Za-z][A-Za-z0-9_-]*\}$/.test(part)))
      fail('front.slot-input','A front slot view must have no route or panel identity inputs.');
    const owner=indexes.get(view.moduleId)?.descriptor;
    const schema=owner?.contracts.schemas.find(item=>item.id===view.input.schemaId)?.schema;
    try {
      if(!schema||addFormats(new Ajv2020({strict:true,allErrors:false})).compile(schema)({})!==true)
        fail('front.slot-input','A front slot view must accept an empty declared input.');
    }catch(error){
      if(error instanceof CompositionBuildError)throw error;
      fail('front.slot-input','A front slot view must accept an empty declared input.');
    }
  }
  let frontTheme=null;
  if(composition.front.kind==='theme') {
    const owner=indexes.get(composition.front.moduleId);
    const themes=owner?.descriptor.contracts.ui.themes??[];
    const matches=themes.filter(item=>item.id===composition.front.theme);
    if(!owner||matches.length!==1)fail('front.theme','The selected theme export is unavailable.');
    themeCodeFile(root,owner,matches[0].component);
    frontTheme={id:matches[0].id,moduleId:composition.front.moduleId,slots:matches[0].slots,
      component:importCode(output,owner,matches[0].component,clientImports)};
  }
  const frontCatalog={compositionDigest,front:composition.front,
    views:frontViews.map(({component,validator,stateValidator,...metadata})=>metadata),
    navigation:frontNavigation,slots:frontSlots,
    theme:frontTheme?{id:frontTheme.id,moduleId:frontTheme.moduleId,slots:frontTheme.slots}:null};
  checkSurfaceCatalogBounds('workspace',workspaceCatalog);
  checkSurfaceCatalogBounds('front',frontCatalog);
  // Validate the complete operation registry, including operations with no HTTP exposure.
  // Only inert sentinels are supplied here; package handlers never execute during composition.
  let registry;
  try {
    const sentinel = () => { throw new Error('Build validation must never invoke contribution code.'); };
    registry = createOperationRegistry({ catalog: operationPlan.catalog,
      validators: Object.fromEntries(operationPlan.catalog.modules.flatMap(module => module.schemas.map(schema => [schema.validator, sentinel]))),
      handlers: Object.fromEntries(operationHandlers.map(item => [item.name, sentinel])) });
  } catch { fail('build.operation-registry', 'The operation registry exceeds host capabilities or contains invalid bindings.'); }
  try { createMcpCatalog(mcpCatalog, registry); }
  catch {
    const bytes=Buffer.byteLength(JSON.stringify(mcpCatalog));
    throw new CompositionBuildError('build.mcp-catalog',
      'The compiled MCP catalog exceeds host capabilities or contains invalid bindings.',
      [{code:'mcp.catalog-summary',message:`${bytes} bytes; ${mcpCatalog.tools.length} tools; ${mcpCatalog.resources.length} resources.`}]);
  }
  const banner = '// Generated from an explicit validated composition. Do not edit.\n';
  const serverModules = modules.map(module => `{ id: ${JSON.stringify(module.id)}, version: ${JSON.stringify(module.version)}, operations: [${module.operations.map(operation => {
    const { handler, ...metadata } = operation; return `{ ...${JSON.stringify(metadata)}, handler: ${handler} }`;
  }).join(',\n')}] }`);
  const clientViews = views.map(view => { const { component, validator, stateValidator, ...metadata } = view;
    return `{ ...${JSON.stringify(metadata)}, component: ${component}, validateInput: compiledValidators.${validator}${stateValidator ? `, validateState: compiledValidators.${stateValidator}` : ''} }`; });
  const clientWorkspaceViews=workspaceViews.map(view=>clientViews[views.indexOf(view)]);
  const clientFrontViews=frontViews.map(view=>clientViews[views.indexOf(view)]);
  const clientFrontTheme=frontTheme
    ? `{ ...${JSON.stringify({id:frontTheme.id,moduleId:frontTheme.moduleId,slots:frontTheme.slots})}, component: ${frontTheme.component} }`
    : 'null';
  if (clientViews.length) clientImports.unshift(`import * as compiledValidators from './operation-validators.mjs';`);
  const freezeSource = `const freeze = <T,>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };\n`;
  // Select declared exports explicitly. Bundlers may decorate a namespace with
  // enumerable Symbol.toStringTag; spreading it would not be a function registry.
  const validatorEntries = operationPlan.catalog.modules.flatMap(module => module.schemas)
    .map(schema => `${JSON.stringify(schema.validator)}: compiledValidators.${schema.validator}`).join(',\n');
  // The AJV bundle is executable JavaScript, but TypeScript's allowJs flow analysis
  // can overflow on its large generated control-flow graph. Describe the exports
  // precisely so typechecking does not need to infer the bundled implementation.
  const validatorDeclarations = [...new Set(operationPlan.catalog.modules.flatMap(module => module.schemas)
    .map(schema => schema.validator))].map(name => `export declare const ${name}: Validator;`).join('\n');
  const contextValidators = compileWidgetContextValidators(widgetCatalog);
  const widgetValidatorEntries = widgetCatalog.widgets.map((widget, index) => {
    const names = new Map(operationPlan.catalog.modules.find(module => module.moduleId === widget.moduleId)
      .schemas.map(schema => [schema.schemaId, schema.validator]));
    const validator = reference => {
      const name = names.get(reference.schemaId);
      if (!name) fail('widget.schema', 'A widget schema has no compiled validator.');
      return `compiledValidators.${name}`;
    };
    return `[widgetKey(widgetCatalog.widgets[${index}]), {input:${validator(widget.schemas.input)}, state:${validator(widget.schemas.state)}, result:${validator(widget.schemas.result)}, actionInputs:new Map([${widget.actions.map(action => `[${JSON.stringify(action.id)},${validator(action.input)}]`).join(',')}]), contextValues:new Map([${widget.actions.flatMap(action => {
      const name = contextValidators.names.get(`${index}:${action.id}`);
      return name ? [`[${JSON.stringify(action.id)},contextValidators.${name}]`] : [];
    }).join(',')}])}]`;
  }).join(',\n');
  const contextDeclarations = [...contextValidators.names.values()]
    .map(name => `export declare const ${name}: (value:unknown)=>boolean;`).join('\n') || 'export {};';
  const widgetCatalogBase = {widgets:widgetCatalog.widgets};
  const {sharedParts:widgetSharedParts,resourceSources:widgetResourceSources} =
    sharedWidgetScriptSources(widgetCatalog.resources);
  const rendered = {
    'public-pages.ts': `${banner}import type {PublicPageProjection} from ${JSON.stringify(importSpecifier(output,path.join(root,'core/runtime/public-pages.ts')))};\n${publicPageImports.join('\n')}\nexport const publicPageProjection: PublicPageProjection | null = ${publicPages.length
      ? `Object.freeze({moduleId:${JSON.stringify(publicPages[0].moduleId)},models:Object.freeze(${JSON.stringify(publicPages[0].models)}),css:${JSON.stringify(publicPages[0].stylesheet)},render:${publicPages[0].renderer} as unknown as PublicPageProjection['render'],imageIds:${publicPages[0].imageIds} as unknown as PublicPageProjection['imageIds']})`
      : 'null'};\n`,
    'widget-catalog.ts': `${banner}import {widgetKey, type CompiledWidgetCatalog, type WidgetValidatorMap} from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/widgets/catalog.ts')))};\nimport * as compiledValidators from './operation-validators.mjs';\nimport * as contextValidators from './widget-context-validators.mjs';\n${freezeSource}const widgetSharedParts = ${JSON.stringify(widgetSharedParts)};\nconst widgetResources: CompiledWidgetCatalog['resources'] = [${widgetResourceSources.join(',')}];\nconst widgetCatalogBase: Pick<CompiledWidgetCatalog,'widgets'> = ${JSON.stringify(widgetCatalogBase)};\nexport const widgetCatalog: CompiledWidgetCatalog = freeze({...widgetCatalogBase,resources:widgetResources});\nexport const widgetValidators: WidgetValidatorMap = new Map([${widgetValidatorEntries}]);\n`,
    'provider-catalog.ts': `${banner}import type {ProviderOperationSchema} from ${JSON.stringify(importSpecifier(output, path.join(root,'core/providers/tools.ts')))};\nimport type {ConnectorDescriptor} from ${JSON.stringify(importSpecifier(output,path.join(root,'sdk/connectors/types.ts')))};\nimport * as compiledValidators from './operation-validators.mjs';\n${providerImports.join('\n')}\n${freezeSource}export const toolCatalog: readonly ProviderOperationSchema[] = freeze(${JSON.stringify(providerToolCatalog)});\nexport const openAiProvider = ${providerDefinition};\nexport const connectors: readonly ConnectorDescriptor[] = freeze(${JSON.stringify(connectors)});\nexport const searchProjections = freeze(${JSON.stringify(searchProjections)});\nexport const webhookMappings = Object.freeze([${webhookMappings.map(item=>`Object.freeze({moduleId:${JSON.stringify(item.moduleId)},operationId:${JSON.stringify(item.operationId)},path:${JSON.stringify(item.path)},map:${item.mapper}})`).join(',')}]);\nexport const deliveryMappings = Object.freeze([${deliveryMappings.map(item=>`Object.freeze({id:${JSON.stringify(item.id)},moduleId:${JSON.stringify(item.moduleId)},commandId:${JSON.stringify(item.commandId)},prepareId:${JSON.stringify(item.prepareId)},providerModuleId:${JSON.stringify(item.providerModuleId)},connectorId:${JSON.stringify(item.connectorId)},resourceId:${JSON.stringify(item.resourceId)},readinessId:${JSON.stringify(item.readinessId)},configRevisionField:${JSON.stringify(item.configRevisionField)},prepareInput:freeze(${JSON.stringify(item.prepareInput)}),matchFields:freeze(${JSON.stringify(item.matchFields)}),envelopeField:${JSON.stringify(item.envelopeField)},projectorInput:freeze(${JSON.stringify(item.projectorInput)}),acceptance:freeze(${JSON.stringify(item.acceptance)}),modelIds:freeze(${JSON.stringify(item.modelIds)}),validateReceipt:compiledValidators.${item.receiptValidator},projector:${item.projector}})`).join(',')}]);\n`,
    'file-catalog.ts': `${banner}import type {RuntimeFileCatalog} from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/files/catalog.ts')))};\n${freezeSource}export const fileCatalog: RuntimeFileCatalog = freeze(${JSON.stringify(fileCatalog)});\n`,
    'module-inventory.ts': `${banner}import type { ModuleSettingsHostInventory } from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/module-settings/types.ts')))};\n${freezeSource}${runtimeInventory
      ? `const inventory: ModuleSettingsHostInventory['inventory'] = freeze(${JSON.stringify(runtimeInventory.inventory)});\nexport const runtimeInventory: ModuleSettingsHostInventory = freeze({current: {composition: ${JSON.stringify(composition)}, lock: ${JSON.stringify(lock)}, descriptors: ${JSON.stringify(currentModuleCandidateKeys(composition,lock,runtimeInventory.inventory))}.map(key => inventory.candidates.find(candidate => candidate.candidateKey === key)!.descriptor)}, inventory, currentInstalledDocuments: ${JSON.stringify(runtimeInventory.currentInstalledDocuments)}});\n`
      : 'export const runtimeInventory: ModuleSettingsHostInventory | undefined = undefined;\n'}`,
    'operation-validators.mjs': `${banner}${operationPlan.validatorsCode}`,
    'operation-validators.d.mts': `${banner}type ValidatorError = Readonly<{keyword:string;instancePath:string;schemaPath:string}>;\ntype Validator = ((data:unknown)=>boolean) & Readonly<{errors:readonly ValidatorError[]|null}>;\n${validatorDeclarations}\n`,
    'widget-context-validators.mjs': `${banner}${contextValidators.code}`,
    'widget-context-validators.d.mts': `${banner}${contextDeclarations}\n`,
    'operations.ts': `${banner}import type { RuntimeOperationCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/operations/types.ts')))};\nimport * as compiledValidators from './operation-validators.mjs';\n${operationImports.join('\n')}\nconst freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };\nexport const operationCatalog: RuntimeOperationCatalog = freeze(${JSON.stringify(operationPlan.catalog)});\nexport const operationValidators = Object.freeze({${validatorEntries}});\nexport const operationHandlers = Object.freeze({${operationHandlers.map(item => `${JSON.stringify(item.name)}: ${item.handler}`).join(',\n')}});\n`,
    'data-catalog.ts': `${banner}import type { RuntimeDataCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/data/types.ts')))};\nconst freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };\nexport const dataCatalog: RuntimeDataCatalog = freeze(${JSON.stringify(dataPlan.runtimeCatalog)});\n`,
    'server.ts': `${banner}import type { RuntimeModule, RuntimeNativeAccess } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/runtime/types.ts')))};\nimport type { OperationHttpBinding } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/operations/http-types.ts')))};\nimport type { PermissionDefinition } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/authorization/types.ts')))};\nimport type { WorkspaceAuthorizationCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/workspace/authorization.ts')))};\nimport type { WorkspaceNavigationCatalogV1 } from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/workspace/navigation-catalog.ts')))};\nimport type { McpCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/mcp/types.ts')))};\nimport type { RuntimeFrontCatalog } from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/runtime/ui.ts')))};\nimport {widgetCatalog} from './widget-catalog.ts';\nexport {widgetCatalog};\nexport {widgetValidators} from './widget-catalog.ts';\n${serverImports.join('\n')}\n${freezeSource}export const compositionDigest = ${JSON.stringify(compositionDigest)};\nexport const nativeAccess: RuntimeNativeAccess = Object.freeze(${JSON.stringify(nativeAccess)});\nexport const modules: readonly RuntimeModule[] = [${serverModules.join(',\n')}];\nexport const httpBindings: readonly OperationHttpBinding[] = freeze(${JSON.stringify(httpBindings)});\nexport const mcpCatalog: McpCatalog = freeze(${mcpCatalogLiteral});\nexport const permissions: readonly PermissionDefinition[] = freeze(${JSON.stringify(permissions)});\nexport const permissionTitles: Readonly<Record<string, string>> = freeze(${JSON.stringify(permissionTitles)});\nexport const workspaceCatalog: WorkspaceAuthorizationCatalog = freeze(${JSON.stringify(workspaceCatalog)});\nexport const workspaceNavigationCatalog: WorkspaceNavigationCatalogV1 = freeze(${JSON.stringify(workspaceNavigationCatalog)});\nexport const frontCatalog: RuntimeFrontCatalog = freeze(${JSON.stringify(frontCatalog)});\n`,
    'client.tsx': `${banner}import type { RuntimeView, RuntimeNavigation, RuntimeFrontSelection, RuntimeFrontView, RuntimeFrontNavigation, RuntimeFrontSlot, RuntimeFrontTheme } from ${JSON.stringify(importSpecifier(output, path.join(root, 'sdk/runtime/ui.ts')))};\nimport type { OperationHttpBinding } from ${JSON.stringify(importSpecifier(output, path.join(root, 'core/operations/http-types.ts')))};\n${clientImports.join('\n')}\n${freezeSource}export const compositionDigest = ${JSON.stringify(compositionDigest)};\nexport const nativeAccess = Object.freeze(${JSON.stringify(nativeAccess)});\nexport const views: readonly RuntimeView[] = freeze([${clientWorkspaceViews.join(',\n')}]);\nexport const navigation: readonly RuntimeNavigation[] = freeze(${JSON.stringify(navigation)});\nexport const front: RuntimeFrontSelection = freeze(${JSON.stringify(composition.front)});\nexport const frontViews: readonly RuntimeFrontView[] = freeze([${clientFrontViews.join(',\n')}]);\nexport const frontNavigation: readonly RuntimeFrontNavigation[] = freeze(${JSON.stringify(frontNavigation)});\nexport const frontSlots: readonly RuntimeFrontSlot[] = freeze(${JSON.stringify(frontSlots)});\nexport const frontTheme: RuntimeFrontTheme | null = ${frontTheme ? `freeze(${clientFrontTheme})` : 'null'};\nexport const httpBindings: readonly OperationHttpBinding[] = freeze(${JSON.stringify(httpBindings)});\n`,
    'composition.json': `${stringify({ schemaVersion: 1, compositionDigest, nativeAccess, applicationId: composition.application.id, hostProfile: composition.host.profile,
      operations: { schemasDigest: operationPlan.schemasDigest, validatorsDigest: operationPlan.validatorsDigest, ...operationPlan.metrics },
      modules: modules.map(({ id, version, operations }) => ({ id, version, routes: operations.map(({ handler, ...metadata }) => metadata) })),
      views: views.map(({ component, ...metadata }) => metadata), navigation, frontCatalog,
      httpBindings, packageArchivesVerified: false })}\n`,
  };
  if (publicPages.length) {
    let bundled;
    try {
      await assertWorkerBoundary({root,entryPoints:[slash(path.relative(root,publicPages[0].rendererSource))]});
      bundled=buildSync({entryPoints:[publicPages[0].rendererSource],bundle:true,write:false,
        format:'esm',platform:'browser',conditions:['worker'],jsx:'automatic',target:'es2022',
        define:{'process.env.NODE_ENV':'"production"'},minify:true,metafile:true,logLevel:'silent'});
    } catch (error) { fail('public-page.renderer-build', `Public page renderer compilation failed: ${error.message}`); }
    if (bundled.outputFiles.length!==1||Object.values(bundled.metafile.outputs)
      .some(item=>item.imports.length>0)) fail('public-page.renderer-build','Public page renderer must bundle without external imports.');
    const bytes=bundled.outputFiles[0].contents;
    const source=new TextDecoder().decode(bytes);
    if (/\b(?:eval\s*\(|new\s+Function\s*\(|import\s*\(|require\s*\(\s*['"]node:)/u.test(source))
      fail('public-page.renderer-build','Public page renderer uses dynamic code or Node imports.');
    rendered['public-page-renderer.mjs']=source;
    rendered['public-page-renderer.d.mts']=`export declare const ${publicPages[0].rendererExport}: (...args: unknown[]) => string;\n`;
    destinations['public-page-renderer.mjs']=confined(root,path.join(output,'public-page-renderer.mjs'),{missing:true});
    destinations['public-page-renderer.d.mts']=confined(root,path.join(output,'public-page-renderer.d.mts'),{missing:true});
  } else {
    for(const name of ['public-page-renderer.mjs','public-page-renderer.d.mts']){
      const stale=confined(root,path.join(output,name),{missing:true});
      if(existsSync(stale))unlinkSync(stale);
    }
  }
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
