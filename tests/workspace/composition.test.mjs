import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {composeRuntime} from '../../scripts/build/compose-runtime.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {temporaryDirectory} from '../quality/temporary.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const witnessPath = 'tests/runtime/fixtures/module-witness';
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const output = (root, name) => path.join(root, '.creezio/generated', name);
function fixture(t) {
  // Copy only the small declared witness module; never a project or dependency tree.
  const root = temporaryDirectory(t, 'creezio-workspace-compose-');
  write(path.join(root, 'package.json'), {type: 'module'});
  mkdirSync(path.join(root, 'configuration'));
  cpSync(path.join(repository, witnessPath), path.join(root, witnessPath), {recursive: true});
  const composition = read(path.join(repository, 'configuration/composition.witness.json'));
  const lock = read(path.join(repository, 'configuration/composition.witness.lock.json'));
  const manifest = path.join(root, witnessPath, 'module/manifest.json');
  const module = read(manifest);
  const save = () => {
    write(manifest, module);
    lock.modules[0].contractIntegrity = contractIntegrity(module);
    lock.compositionIntegrity = contractIntegrity(composition);
    write(path.join(root, 'configuration/composition.json'), composition);
    write(path.join(root, 'configuration/composition.lock.json'), lock);
  };
  save();
  return {root, module, composition, save};
}
function frozen(root, filename, name) {
  const source = readFileSync(output(root, filename), 'utf8');
  const match = source.match(new RegExp(`export const ${name}[^\\n]*?= freeze\\(([^\\n]*)\\);`));
  assert.ok(match, `${filename} must export a frozen ${name}`);
  return JSON.parse(match[1]);
}
function workspaceView(f) {
  const view = f.module.contracts.ui.views[0];
  f.module.contracts.schemas.push({id: 'panel-input', schema: {type: 'object',
    properties: {'record-id': {type: 'string'}}, required: ['record-id'], additionalProperties: false}});
  view.surfaces = ['workspace', 'front'];
  view.permissions = [{moduleId: 'example.witness', kind: 'permission', id: 'inspect'}];
  view.panel.identityFields = ['record-id'];
  view.input = {schemaId: 'panel-input'};
  const nav = f.module.contracts.ui.navigation[0];
  nav.surfaces = ['workspace', 'front'];
  nav.permissions = [{moduleId: 'example.witness', kind: 'permission', id: 'inspect'}];
  f.save();
}

test('composition emits static binding, permission, workspace view, navigation and panel contracts', async t => {
  const f = fixture(t); workspaceView(f);
  const result = await composeRuntime({root: f.root});
  assert.equal(result.viewCount, 1);
  const metadata = read(output(f.root, 'composition.json'));
  const [view] = metadata.views, [nav] = metadata.navigation;
  assert.equal(view.id, 'example.witness:witness-view');
  assert.deepEqual(view.permissions, [{moduleId: 'example.witness', kind: 'permission', id: 'inspect'}]);
  assert.deepEqual(view.operations, [{moduleId: 'example.witness', kind: 'operation', id: 'status'}]);
  assert.deepEqual(view.input, {schemaId: 'panel-input'});
  assert.deepEqual(view.panel, {identityFields: ['record-id'], navigation: 'sdk', retention: 'preserve', inactiveEffects: 'suspend'});
  assert.equal(nav.id, 'example.witness:witness-nav'); assert.equal(nav.viewId, view.id);
  assert.deepEqual(nav.permissions, view.permissions);
  const permission = frozen(f.root, 'server.ts', 'permissions').find(item => item.id === 'example.witness:inspect');
  assert.deepEqual(permission.audiences, ['app']);
  const bindings = frozen(f.root, 'server.ts', 'httpBindings');
  assert.deepEqual(bindings.map(item => `${item.contributorModuleId}:${item.id}`),
    ['example.witness:status-http', 'example.witness:protected-http']);
  assert.deepEqual(frozen(f.root, 'client.tsx', 'httpBindings'), bindings);
  const projection = frozen(f.root, 'server.ts', 'workspaceCatalog');
  assert.equal(projection.compositionDigest, metadata.compositionDigest);
  assert.deepEqual(projection.views, [{id: view.id, surfaces: view.surfaces, audiences: ['app'], permissions: view.permissions}]);
  assert.deepEqual(projection.navigation, [{id: nav.id, viewId: view.id, surfaces: nav.surfaces,
    audiences: ['app'], permissions: nav.permissions}]);
  const client = readFileSync(output(f.root, 'client.tsx'), 'utf8');
  assert.match(client, /import \{ view as contribution_\d+ \} from/);
  assert.match(client, /validateInput: compiledValidators\.[A-Za-z0-9_]+/);
  assert.doesNotMatch(client, /validateState: compiledValidators\./);
});

test('declared panel state schema is opt-in and compiles a client validator', async t => {
  const f = fixture(t); workspaceView(f);
  f.module.contracts.schemas.push({id: 'panel-state', schema: {type: 'object',
    properties: {draft: {type: 'string', maxLength: 64}}, required: ['draft'], additionalProperties: false}});
  f.module.contracts.ui.views[0].panel.stateSchema = {schemaId: 'panel-state'};
  f.save();
  await composeRuntime({root: f.root});
  const metadata = read(output(f.root, 'composition.json'));
  assert.deepEqual(metadata.views[0].panel.stateSchema, {schemaId: 'panel-state'});
  const client = readFileSync(output(f.root, 'client.tsx'), 'utf8');
  const validatorName = client.match(/validateState: compiledValidators\.([A-Za-z0-9_]+)/)?.[1];
  assert.ok(validatorName, 'client view must receive its compiled state validator');
  const validators = await import(pathToFileURL(output(f.root, 'operation-validators.mjs')).href);
  assert.equal(validators[validatorName]({draft: 'Brouillon'}), true);
  assert.equal(validators[validatorName]({draft: 4}), false);
  assert.equal(validators[validatorName]({draft: 'Brouillon', secret: 'unexpected'}), false);
});

test('composition refuses a panel state schema reference with no declaration', async t => {
  const f = fixture(t); workspaceView(f);
  f.module.contracts.ui.views[0].panel.stateSchema = {schemaId: 'missing-panel-state'};
  f.save();
  await assert.rejects(composeRuntime({root: f.root}), error =>
    error.code === 'composition.invalid' && error.diagnostics.some(item => item.code === 'ref.missing'));
  assert.equal(existsSync(output(f.root, 'client.tsx')), false);
});

test('composition gates every view and navigation audience by selected exposure', async t => {
  const f = fixture(t); workspaceView(f);
  f.composition.exposure.admin.moduleIds = ['example.witness']; f.save();
  await composeRuntime({root: f.root});
  let projection = frozen(f.root, 'server.ts', 'workspaceCatalog');
  assert.deepEqual(projection.views[0].audiences, ['admin', 'app']);
  assert.deepEqual(projection.navigation[0].audiences, ['admin', 'app']);
  f.composition.exposure.app.moduleIds = []; f.save();
  await composeRuntime({root: f.root});
  projection = frozen(f.root, 'server.ts', 'workspaceCatalog');
  assert.deepEqual(projection.views[0].audiences, ['admin']);
  assert.deepEqual(projection.navigation[0].audiences, ['admin']);
  assert.deepEqual(frozen(f.root, 'server.ts', 'httpBindings'), []);
});

test('disabled optional integration emits no guarded API, view or navigation', async t => {
  const f = fixture(t); workspaceView(f);
  f.module.dependencies.push({moduleId: 'example.optional', origin: 'https://example.invalid/optional', versionRange: '^1.0.0',
    optional: true, contracts: [], whenAbsent: 'disable-contributions', whenIncompatible: 'block', autoInstall: false});
  f.composition.modules[0].integrations.push({moduleId: 'example.optional', enabled: false});
  f.module.contracts.ui.views[0].requiresModules = ['example.optional'];
  f.module.contracts.ui.navigation[0].requiresModules = ['example.optional'];
  f.module.contracts.api[1].requiresModules = ['example.optional']; f.save();
  await composeRuntime({root: f.root});
  const metadata = read(output(f.root, 'composition.json'));
  assert.deepEqual(metadata.views, []); assert.deepEqual(metadata.navigation, []);
  assert.deepEqual(frozen(f.root, 'server.ts', 'workspaceCatalog').views, []);
  assert.deepEqual(frozen(f.root, 'server.ts', 'workspaceCatalog').navigation, []);
  assert.deepEqual(frozen(f.root, 'server.ts', 'httpBindings').map(item => item.id), ['status-http']);
});

test('host workspace namespaces stay reserved for module routes', async t => {
  const f = fixture(t); workspaceView(f);
  for (const route of ['/workspace', '/workspace/app', '/workspace/{audience}']) {
    f.module.contracts.ui.views[0].route = route; f.save();
    await assert.rejects(composeRuntime({root: f.root}), error => error.code === 'view.reserved', route);
    assert.equal(existsSync(output(f.root, 'server.ts')), false);
  }
  f.module.contracts.ui.views[0].route = '/witness';
  f.module.contracts.api[0].path = '/api/workspace/app/projection'; f.save();
  await assert.rejects(composeRuntime({root: f.root}), error => error.code === 'build.route-reserved', 'API workspace namespace');
  assert.equal(existsSync(output(f.root, 'server.ts')), false);
});

test('declared UI styles are imported into generated client entry from the runtime inventory', async t => {
  const f = fixture(t); workspaceView(f);
  const relative = 'ui/front/witness.css';
  writeFileSync(path.join(f.root, witnessPath, relative), '.witness-view { display: block; }\n');
  f.module.packaging.runtime.files.push(relative);
  f.module.contracts.ui.styles.push(relative); f.save();
  await composeRuntime({root: f.root});
  const client = readFileSync(output(f.root, 'client.tsx'), 'utf8');
  assert.match(client, /import ["'][^"']*\/ui\/front\/witness\.css["'];/);
});
