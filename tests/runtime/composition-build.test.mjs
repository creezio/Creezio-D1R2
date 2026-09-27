import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { composeRuntime, loadRuntimeComposition } from '../../scripts/build/compose-runtime.mjs';
import { contractIntegrity } from '../../sdk/contracts/validate.mjs';
import { temporaryDirectory } from '../quality/temporary.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const witnessPath = 'tests/runtime/fixtures/module-witness';
const accessPath = 'extensions/native/access';
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function fixture(t, witness = true) {
  const root = temporaryDirectory(t, 'creezio-compose-');
  write(path.join(root, 'package.json'), { type: 'module' });
  mkdirSync(path.join(root, 'configuration'));
  if (witness === true) cpSync(path.join(repository, witnessPath), path.join(root, witnessPath), { recursive: true });
  if (witness === 'access') {
    const descriptor = read(path.join(repository, accessPath, 'module/manifest.json'));
    // Copy only the declared runtime inventory, never dependencies or a checkout.
    for (const file of descriptor.packaging.runtime.files) {
      const destination = path.join(root, accessPath, file);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(repository, accessPath, file), destination);
    }
  }
  const suffix = witness === true ? '.witness' : '';
  const composition = read(path.join(repository, `configuration/composition${suffix}.json`));
  const lock = read(path.join(repository, `configuration/composition${suffix}.lock.json`));
  if (witness === false) {
    composition.modules = []; lock.modules = [];
    composition.exposure.admin.moduleIds = []; composition.exposure.app.moduleIds = [];
    lock.compositionIntegrity = contractIntegrity(composition);
  }
  write(path.join(root, 'configuration/composition.json'), composition);
  write(path.join(root, 'configuration/composition.lock.json'), lock);
  const modulePath = witness === true ? witnessPath : accessPath;
  const module = witness ? read(path.join(root, modulePath, 'module/manifest.json')) : undefined;
  const save = () => {
    if (module) { write(path.join(root, modulePath, 'module/manifest.json'), module); lock.modules[0].contractIntegrity = contractIntegrity(module); }
    lock.compositionIntegrity = contractIntegrity(composition);
    write(path.join(root, 'configuration/composition.json'), composition);
    write(path.join(root, 'configuration/composition.lock.json'), lock);
  };
  return { root, composition, lock, module, save };
}
const generated = (root, name) => path.join(root, '.creezio/generated', name);
async function clientRegistry(root) {
  const source = readFileSync(generated(root, 'client.tsx'), 'utf8');
  const { code } = await transform(source, { loader: 'tsx', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('operator composition read validates the same lock without generating files or running module code', t => {
  const f = fixture(t, 'access');
  // A source file that throws would expose accidental import/execution of module code.
  writeFileSync(path.join(f.root, accessPath, 'module/entry.server.ts'), 'throw new Error("Module code must remain inert during inspection");');
  const loaded = loadRuntimeComposition({ root: f.root });
  assert.deepEqual(loaded.composition, f.composition);
  assert.equal(loaded.located[0].descriptor.identity.id, 'creezio.access');
  assert.equal(existsSync(path.join(f.root, '.creezio')), false);
  f.lock.compositionIntegrity = `sha256-${'0'.repeat(64)}`;
  write(path.join(f.root, 'configuration/composition.lock.json'), f.lock);
  assert.throws(() => loadRuntimeComposition({ root: f.root }), error => error.code === 'composition.invalid');
  assert.equal(existsSync(path.join(f.root, '.creezio')), false);
});

test('an explicitly empty composition builds no module, view, native access or witness import', async t => {
  const f = fixture(t, false), result = await composeRuntime({ root: f.root });
  assert.equal(result.moduleCount, 0); assert.equal(result.viewCount, 0);
  assert.deepEqual(result.nativeAccess, {admin:false,app:false});
  assert.deepEqual(read(generated(f.root,'composition.json')).nativeAccess, {admin:false,app:false});
  assert.deepEqual((await clientRegistry(f.root)).nativeAccess, {admin:false,app:false});
  assert.doesNotMatch(readFileSync(generated(f.root, 'server.ts'), 'utf8'), /example\.witness|fixtures\/module-witness/);
  assert.doesNotMatch(readFileSync(generated(f.root, 'client.tsx'), 'utf8'), /fixtures\/module-witness/);
});

test('default native access composition explicitly enables both audiences without synthetic module APIs', async t => {
  const f=fixture(t,'access'), result=await composeRuntime({root:f.root});
  assert.equal(result.moduleCount,1);assert.equal(result.viewCount,0);
  assert.deepEqual(f.composition.modules.map(module=>module.moduleId),['creezio.access']);
  assert.deepEqual(f.module.contracts.api,[]);assert.deepEqual(f.module.contracts.operations,[]);
  const registry=await import(pathToFileURL(generated(f.root,'server.ts')).href);
  assert.deepEqual(registry.nativeAccess,{admin:true,app:true});assert.ok(Object.isFrozen(registry.nativeAccess));
  assert.throws(()=>{registry.nativeAccess.admin=false;},TypeError);
  const client = await clientRegistry(f.root);
  assert.deepEqual(client.nativeAccess, registry.nativeAccess);
  assert.ok(Object.isFrozen(client.nativeAccess));
  assert.throws(() => { client.nativeAccess.app = false; }, TypeError);
  assert.deepEqual(registry.modules,[{id:'creezio.access',version:'0.0.0',operations:[]}]);
  assert.deepEqual(result.nativeAccess,registry.nativeAccess);assert.ok(Object.isFrozen(result.nativeAccess));
  assert.deepEqual(read(generated(f.root,'composition.json')).nativeAccess,registry.nativeAccess);
  assert.doesNotMatch(readFileSync(generated(f.root,'server.ts'),'utf8'),/module\/entry\.server|example\.witness|fixtures\/module-witness/);
});

test('native access audiences require independent explicit exposures and an active access module', async t => {
  const f=fixture(t,'access');
  for(const [admin,app] of [[false,false],[true,false],[false,true],[true,true]]) {
    f.composition.exposure.admin.moduleIds=admin?['creezio.access']:[];
    f.composition.exposure.app.moduleIds=app?['creezio.access']:[];f.save();
    await composeRuntime({root:f.root});
    assert.deepEqual(read(generated(f.root,'composition.json')).nativeAccess,{admin,app});
    assert.deepEqual((await clientRegistry(f.root)).nativeAccess,{admin,app});
  }
  f.composition.modules[0].enabled=false;
  f.composition.exposure.admin.moduleIds=[];f.composition.exposure.app.moduleIds=[];f.save();
  const disabled=await composeRuntime({root:f.root});
  assert.equal(disabled.moduleCount,0);assert.deepEqual(disabled.nativeAccess,{admin:false,app:false});
  f.composition.exposure.app.moduleIds=['creezio.access'];f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='composition.invalid');
  assert.deepEqual(read(generated(f.root,'composition.json')).nativeAccess,{admin:false,app:false});
});

test('explicit witness emits static typed imports and an executable public handler deterministically', async t => {
  const f = fixture(t), first = await composeRuntime({ root: f.root });
  const server = readFileSync(generated(f.root, 'server.ts'), 'utf8');
  const before = statSync(generated(f.root, 'server.ts')).mtimeMs;
  const second = await composeRuntime({ root: f.root });
  assert.deepEqual(second, first); assert.equal(statSync(generated(f.root, 'server.ts')).mtimeMs, before);
  assert.match(server, /import \{ read_status as contribution_/); assert.doesNotMatch(server, /node_modules|https:\/\//);
  const registry = await import(pathToFileURL(generated(f.root, 'server.ts')).href);
  assert.equal(registry.modules.length, 1);
  const status = registry.modules[0].operations.find(operation => operation.id === 'status-http');
  assert.equal(status.ownerModuleId, 'example.witness'); assert.equal(status.access, 'public-read');
  assert.equal(status.maxDurationMs, 1000);
  assert.deepEqual(await status.handler().json(), { module: 'example.witness', version: '1.0.0', status: 'ready' });
  assert.equal(registry.modules[0].operations.find(operation => operation.id === 'protected-http').access, 'protected');
  const metadata = read(generated(f.root, 'composition.json'));
  assert.deepEqual(metadata.nativeAccess,{admin:false,app:false},'another active module does not enable native access');
  assert.equal(metadata.views[0].access, 'public-read'); assert.equal(metadata.packageArchivesVerified, false);
});

test('a protected view never acquires public access from its front surface', async t => {
  const f = fixture(t); f.module.contracts.ui.views[0].permissions = [{ moduleId: 'example.witness', kind: 'permission', id: 'inspect' }]; f.save();
  await composeRuntime({ root: f.root });
  assert.equal(read(generated(f.root, 'composition.json')).views[0].access, 'protected');
});

test('disabled modules are validated but contribute no imports, routes or views', async t => {
  const f = fixture(t); f.composition.modules[0].enabled = false; f.composition.exposure.app.moduleIds = []; f.save();
  const result = await composeRuntime({ root: f.root });
  assert.equal(result.moduleCount, 0); assert.equal(result.viewCount, 0);
  assert.doesNotMatch(readFileSync(generated(f.root, 'server.ts'), 'utf8'), /operations\.ts/);
});

test('missing selected module source fails before any output is written', async t => {
  const f = fixture(t); f.composition.modules[0].source.path = 'missing/module'; f.save();
  await assert.rejects(composeRuntime({ root: f.root }), error => error.code === 'source.missing');
  assert.equal(existsSync(generated(f.root, 'server.ts')), false);
});

test('a required missing dependency and stale lock prevent generation', async t => {
  const f = fixture(t); f.module.dependencies.push({moduleId:'example.catalogue',origin:'https://example.invalid/catalogue',versionRange:'^1.0.0',optional:false,contracts:[],whenAbsent:'block',whenIncompatible:'block',autoInstall:false}); f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='composition.invalid'&&error.diagnostics.some(item=>item.code==='dependency.missing'));
  f.module.dependencies = []; f.save(); f.lock.compositionIntegrity = 'sha256-' + '0'.repeat(64); write(path.join(f.root,'configuration/composition.lock.json'),f.lock);
  await assert.rejects(composeRuntime({root:f.root}),error=>error.diagnostics.some(item=>item.code==='lock.integrity'));
});

test('invalid declarations and colliding routes cannot reach generated code', async t => {
  const f = fixture(t); f.module.contracts.api.push({...f.module.contracts.api[0],id:'colliding-http'}); f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='composition.invalid'&&error.diagnostics.some(item=>item.code==='composition.collision'));
  f.module.contracts.api.pop(); delete f.module.documentation.installed.prd; f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='composition.invalid');
});

test('host operation budget is validated before replacing an existing generated composition', async t => {
  const f = fixture(t); await composeRuntime({ root: f.root });
  const names = ['server.ts', 'client.tsx', 'composition.json', 'data-catalog.ts'];
  const before = names.map(name => readFileSync(generated(f.root, name), 'utf8'));
  f.module.contracts.operations[0].execution.maxDurationMs = 30001; f.save();
  await assert.rejects(composeRuntime({ root: f.root }), error => error.code === 'build.operation-budget');
  assert.deepEqual(names.map(name => readFileSync(generated(f.root, name), 'utf8')), before);
});

test('runtime route conflicts and reserved routes fail host preflight without writing outputs', async t => {
  const f = fixture(t);
  f.module.contracts.schemas.find(schema => schema.id === 'empty-input').schema.properties = { x: { type: 'string' }, y: { type: 'string' } };
  f.module.contracts.api[0].path = '/api/business/{x}/a';
  f.module.contracts.api[1].path = '/api/business/b/{y}';
  f.module.contracts.api[0].parameters = [{ name: 'x', in: 'path', inputField: 'x', required: true }];
  f.module.contracts.api[1].parameters = [{ name: 'y', in: 'path', inputField: 'y', required: true }]; f.save();
  await assert.rejects(composeRuntime({ root: f.root }), error => error.code === 'build.route-conflict');
  assert.equal(existsSync(generated(f.root, 'server.ts')), false);
  f.module.contracts.api[0].path = '/api/health';
  f.module.contracts.api[1].path = '/api/b/private';
  f.module.contracts.api[0].parameters = []; f.module.contracts.api[1].parameters = []; f.save();
  await assert.rejects(composeRuntime({ root: f.root }), error => error.code === 'build.route-reserved');
  assert.equal(existsSync(generated(f.root, 'server.ts')), false);
});

test('native access entry views are reserved without replacing the previous valid composition', async t => {
  const f = fixture(t); await composeRuntime({ root: f.root });
  const names = ['server.ts', 'client.tsx', 'composition.json', 'data-catalog.ts'];
  const before = names.map(name => readFileSync(generated(f.root, name), 'utf8'));
  for (const route of ['/access', '/access/admin', '/access/app', '/{surface}/admin', '/:surface/admin']) {
    f.module.contracts.ui.views[0].route = route; f.save();
    await assert.rejects(composeRuntime({ root: f.root }), error => error.code === (route.includes(':') ? 'composition.invalid' : 'view.reserved'), route);
    assert.deepEqual(names.map(name => readFileSync(generated(f.root, name), 'utf8')), before);
  }
});

test('native access namespace is reserved even when access is absent, including parameter captures', async t => {
  const f=fixture(t);await composeRuntime({root:f.root});
  const names=['server.ts','client.tsx','composition.json','data-catalog.ts'],before=names.map(name=>readFileSync(generated(f.root,name),'utf8'));
  f.module.contracts.schemas.find(schema=>schema.id==='empty-input').schema.properties={area:{type:'string'}};
  for(const route of ['/api/access','/api/access/app/login','/api/{area}','/api/{area}/app/login','/api/{area}/elsewhere']) {
    f.module.contracts.api[0].path=route;
    f.module.contracts.api[0].parameters=route.includes('{area}')?[{name:'area',in:'path',inputField:'area',required:true}]:[];f.save();
    await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='build.route-reserved',route);
    assert.deepEqual(names.map(name=>readFileSync(generated(f.root,name),'utf8')),before);
  }
  f.module.contracts.api[0].path='/api/accessibility';f.module.contracts.api[0].parameters=[];f.save();
  await composeRuntime({root:f.root});
  assert.equal(read(generated(f.root,'composition.json')).modules[0].routes[0].path,'/api/accessibility');
});

test('workspace and output traversal are rejected', async t => {
  const f = fixture(t); f.composition.modules[0].source.path = '../outside'; f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='source.path');
  f.composition.modules[0].source.path = witnessPath; f.save();
  await assert.rejects(composeRuntime({root:f.root,outputDir:'../outside'}),error=>error.code==='source.escape');
});

test('linked selected directories are rejected without traversal', async t => {
  const f = fixture(t), linked = path.join(f.root,'linked-module');
  symlinkSync(path.join(f.root,witnessPath),linked,process.platform==='win32'?'junction':'dir');
  try { f.composition.modules[0].source.path='linked-module'; f.save(); await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='source.link'); }
  finally { unlinkSync(linked); }
});

test('generated outputs cannot overwrite module sources or the input composition', async t => {
  const f = fixture(t), before = readFileSync(path.join(f.root, 'configuration/composition.json'), 'utf8');
  await assert.rejects(composeRuntime({ root: f.root, outputDir: 'configuration' }), error => error.code === 'output.source-collision');
  await assert.rejects(composeRuntime({ root: f.root, outputDir: witnessPath }), error => error.code === 'output.source-collision');
  assert.equal(readFileSync(path.join(f.root, 'configuration/composition.json'), 'utf8'), before);
  assert.equal(existsSync(path.join(f.root, witnessPath, 'server.ts')), false);
});

test('an undeclared handler and a non-static export are rejected before import', async t => {
  const f = fixture(t); f.module.packaging.runtime.files=f.module.packaging.runtime.files.filter(name=>name!=='module/operations.ts');f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='composition.invalid'&&error.diagnostics.some(item=>item.code==='path.missing'));
  f.module.packaging.runtime.files.push('module/operations.ts');f.module.contracts.operations[0].handler.export='private.entry';f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='source.export');
});

test('composition reads declarations without evaluating module factories or handlers', async t => {
  const f = fixture(t); writeFileSync(path.join(f.root,witnessPath,'module/operations.ts'), 'throw new Error("must not run during composition");\n');
  const result = await composeRuntime({root:f.root}); assert.equal(result.moduleCount,1);
});

test('installed packages must expose selected code explicitly and match their descriptor version', async t => {
  const f = fixture(t), directory=path.join(f.root,'node_modules/@example/witness');mkdirSync(path.dirname(directory),{recursive:true});
  cpSync(path.join(f.root,witnessPath),directory,{recursive:true});
  const exported=Object.fromEntries(f.module.packaging.runtime.files.filter(name=>name!=='module/operations.ts').map(name=>['./'+name,'./'+name]));
  write(path.join(directory,'package.json'),{name:'@example/witness',version:'1.0.0',exports:exported});
  f.composition.modules[0].source={kind:'package',name:'@example/witness'};f.save();
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='source.private-entry');
  write(path.join(directory,'package.json'),{name:'@example/witness',version:'9.0.0',exports:exported});
  await assert.rejects(composeRuntime({root:f.root}),error=>error.code==='source.package-version');
});
