import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build,transform} from 'esbuild';
import {namedModule,dependsOn,compositionCase,lockFor} from '../contracts/helpers.mjs';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {contractIntegrity,validateModule} from '../../sdk/contracts/validate.mjs';
import {checkComposition} from '../../sdk/contracts/semantics.mjs';
import {deterministicModuleArchive,packModuleArtifacts} from '../../scripts/modules/archives.mjs';
import {verifyPackageReceipt} from '../../scripts/modules/package-receipt.mjs';
import {composeRuntime,loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';

// These publishers, domains and operations belong only to the isolated test host.
// The released purchase-requests module and its application data are not changed.
const identities=[['alpha.cart','alpha'],['beta.catalog','beta'],['gamma.source','gamma']];
const publicSdkSha='3196390908a13cf32290f100584a3edb20931c8b3f56c37c6fab131c3fe4b37d';
const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const json=value=>`${JSON.stringify(value,null,2)}\n`;
const write=(root,name,bytes)=>{
  const file=path.join(root,...name.split('/'));
  mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes);return file;
};
const npmCli=()=>{
  if(process.env.npm_execpath&&existsSync(process.env.npm_execpath))
    return {program:process.execPath,prefix:[process.env.npm_execpath]};
  if(process.platform==='win32'){
    const cli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
    assert.ok(existsSync(cli),'npm CLI must be installed beside Node');
    return {program:process.execPath,prefix:[cli]};
  }
  return {program:'npm',prefix:[]};
};
function npm(args,cwd){
  const cli=npmCli();
  const result=spawnSync(cli.program,[...cli.prefix,...args],{cwd,encoding:'utf8',timeout:60000,
    env:{...process.env,npm_config_audit:'false',npm_config_fund:'false'},maxBuffer:1024*1024});
  assert.equal(result.status,0,`${args[0]} failed: ${result.stderr??result.error?.message}`);
  return result.stdout;
}
function modules(){
  const values=identities.map(([id,publisher])=>namedModule(id,publisher));
  dependsOn(values[0],values[1]);dependsOn(values[1],values[2]);
  // An absent fourth publisher is only a disabled, guarded contribution. It
  // is never silently installed and does not weaken the required A -> B -> C chain.
  const optional=namedModule('delta.optional','delta');
  dependsOn(values[0],optional,{optional:true,usesOperation:false});
  values[0].contracts.ui.navigation[0].requiresModules=[optional.identity.id];
  for(const descriptor of values){
    descriptor.compatibility.sdk='^1.4.1';
    for(const endpoint of descriptor.contracts.api)
      endpoint.path=`/api/fixture-${descriptor.identity.publisher}${endpoint.path}`;
    // The declaration fixture predates the host GET input mapping rules.
    // Keep the test-only HTTP inputs representable by its declared route.
    descriptor.contracts.schemas.find(item=>item.id==='list-input').schema.required=[];
    descriptor.contracts.schemas.find(item=>item.id==='get-input').schema.required=['id'];
    descriptor.contracts.widgets=descriptor.contracts.widgets.filter(widget=>widget.id==='task-summary');
    for(const tool of descriptor.contracts.mcp.tools)
      if(tool.widget?.id==='task-edit')delete tool.widget;
    descriptor.contracts.mcp.resources=descriptor.contracts.mcp.resources.filter(resource=>resource.widget?.id!=='task-edit');
    for(const skill of descriptor.contracts.mcp.skills)
      skill.resources=skill.resources.filter(resource=>resource!=='task-edit-ui');
    descriptor.packaging.runtime.files.push('package.json');
    assert.deepEqual(validateModule(descriptor).errors,[],descriptor.identity.id);
  }
  return values;
}
function createPackage(root,descriptor){
  const id=descriptor.identity.id,publisher=descriptor.identity.publisher;
  const name=`@fixture-${publisher}/${id.split('.')[1]}`;
  const directory=path.join(root,'authors',publisher);
  const packageJson={name,version:descriptor.identity.version,private:true,
    files:descriptor.packaging.runtime.files.filter(file=>file!=='package.json'),
    exports:Object.fromEntries(descriptor.packaging.runtime.files
      .filter(file=>file!=='package.json').map(file=>[`./${file}`,`./${file}`]))};
  for(const file of new Set([...descriptor.packaging.runtime.files,...descriptor.packaging.validation.files])){
    const content=file==='package.json'?json(packageJson):file==='module/manifest.json'?json(descriptor):
      file.endsWith('.json')?'{}\n':file.endsWith('.html')?'<!doctype html><html><body><main id="fixture"></main></body></html>\n':
      file.endsWith('.css')?'body { color: black; }\n':
      file.endsWith('/view.ts')?'export const render = () => { document.getElementById("fixture").textContent = "fixture"; };\n':
      file==='module/operations.ts'?`const task={id:${JSON.stringify(id)},context_id:'fixture',owner_id:'fixture',title:'Fixture',record_version:0};\nexport const list = () => ({items:[]});\nexport const get = () => ({...task});\nexport const update = () => ({...task});\nexport const adminConfigure = () => ({ok:true});\nexport const rebuildIndex = () => ({ok:true});\n`:
      file.endsWith('.ts')?'export const create = () => null;\n':
        file.endsWith('.mjs')?'export const fixture = true;\n':`Test-only ${id}: ${file}\n`;
    write(directory,file,content);
  }
  const archiveDir=path.join(root,'archives');mkdirSync(archiveDir,{recursive:true});
  const packed=JSON.parse(npm(['pack',directory,'--ignore-scripts','--json','--pack-destination',archiveDir],root));
  assert.equal(packed.length,1);
  const runtimePath=path.join(archiveDir,packed[0].filename);
  const validation=deterministicModuleArchive(descriptor.packaging.validation.files.map(file=>({
    path:file,bytes:readFileSync(path.join(directory,...file.split('/')))})));
  const validationPath=write(root,`archives/${publisher}-validation.tgz`,validation);
  const runtime=readFileSync(runtimePath);
  const receipt={schemaVersion:'1.0.0',module:{id,origin:descriptor.identity.origin,
    version:descriptor.identity.version,source:descriptor.identity.source},
    contractIntegrity:contractIntegrity(descriptor),
    runtime:{integrity:sha(runtime),location:{kind:'local',path:`archives/${packed[0].filename}`}},
    validation:{integrity:sha(validation),location:{kind:'local',path:`archives/${publisher}-validation.tgz`}},
    policy:descriptor.validation.policy};
  const receiptPath=write(root,`archives/${publisher}-receipt.json`,json(receipt));
  return {descriptor,name,runtimePath,validationPath,receiptPath,receipt,packageDirectory:directory};
}
function installedHost(t){
  const root=temporaryDirectory(t,'creezio-three-publishers-');
  const descriptors=modules(),packages=descriptors.map(descriptor=>createPackage(root,descriptor));
  const sdkArchive=process.env.CREEZIO_T30_SDK_ARCHIVE;
  if(sdkArchive){
    assert.equal(createHash('sha256').update(readFileSync(sdkArchive)).digest('hex'),publicSdkSha,
      'SDK 1.4.1 must be the exact public archive');
  }
  write(root,'package.json',json({name:'three-publishers-test-host',private:true,version:'1.0.0'}));
  npm(['install','--offline','--ignore-scripts','--no-save','--package-lock=false',
    ...packages.map(item=>item.runtimePath)],root);
  const packed=packages.map(item=>{
    const moduleDirectory=path.join(root,'node_modules',...item.name.split('/'));
    const verified=verifyPackageReceipt({root,receiptPath:path.relative(root,item.receiptPath)
      .replaceAll('\\','/'),moduleDirectory,descriptor:item.descriptor});
    assert.equal(verified.validation.integrity,item.receipt.validation.integrity);
    const artifacts=packModuleArtifacts({root,moduleDirectory,moduleId:item.descriptor.identity.id,
      descriptor:item.descriptor,detachedValidation:{integrity:item.receipt.validation.integrity,
        path:path.relative(root,item.validationPath).replaceAll('\\','/')},cacheDetachedValidation:true});
    return {...item,moduleDirectory,artifacts};
  });
  const composition=compositionCase(descriptors).composition;
  composition.sdk.version='1.4.1';
  composition.modules=packed.map(item=>({moduleId:item.descriptor.identity.id,
    origin:item.descriptor.identity.origin,versionRange:'1.0.0',
    source:{kind:'package',name:item.name},enabled:true,configuration:[],
    integrations:item.descriptor.dependencies.filter(dep=>dep.optional)
      .map(dep=>({moduleId:dep.moduleId,enabled:false}))}));
  const lock=lockFor(composition,descriptors);
  for(const node of lock.modules){
    const item=packed.find(pkg=>pkg.descriptor.identity.id===node.moduleId);
    node.runtime={integrity:item.artifacts.runtime.integrity,
      location:{kind:'local',path:item.artifacts.runtime.path}};
    node.validation={integrity:item.artifacts.validation.integrity,
      location:{kind:'local',path:item.artifacts.validation.path}};
  }
  lock.compositionIntegrity=contractIntegrity(composition);
  const check=(selected=descriptors,next=composition,nextLock=lock)=>{
    const errors=[];
    const metrics=checkComposition(next,selected,nextLock,(code,where)=>errors.push({code,where}));
    return {errors,metrics};
  };
  return {root,descriptors,packed,composition,lock,check,sdkArchive};
}

test('three test publishers install once from npm archives and enforce their dependency graph',async t=>{
  const host=installedHost(t);
  await t.test('closed runtime and validation receipts install A -> B -> C',async()=>{
    assert.equal(host.packed.length,3);
    assert.equal(new Set(host.packed.map(item=>item.descriptor.identity.origin)).size,3);
    assert.deepEqual(host.check().errors,[]);
    assert.deepEqual(host.check().metrics.dependencyOrder,
      ['gamma.source','beta.catalog','alpha.cart']);
    write(host.root,'configuration/composition.json',json(host.composition));
    write(host.root,'configuration/composition.lock.json',json(host.lock));
    const loaded=loadRuntimeComposition({root:host.root});
    assert.deepEqual(loaded.located.map(item=>item.descriptor.identity.id),
      host.descriptors.map(item=>item.identity.id));
    assert.ok(host.packed.every(item=>existsSync(path.join(host.root,
      ...item.artifacts.runtime.path.split('/')))));
    const compiled=await composeRuntime({root:host.root});
    assert.equal(compiled.moduleCount,3);
    const generated=JSON.parse(readFileSync(path.join(host.root,'.creezio/generated/composition.json'),'utf8'));
    assert.equal(generated.modules.length,3);
    assert.ok(generated.httpBindings.length>=3);
  });
  const [a,b,c]=host.descriptors;
  const changed=mutate=>{const composition=structuredClone(host.composition),
    lock=structuredClone(host.lock),descriptors=host.descriptors.map(item=>structuredClone(item));
    mutate(composition,lock,descriptors);lock.compositionIntegrity=contractIntegrity(composition);
    return host.check(descriptors,composition,lock).errors.map(item=>item.code);};
  await t.test('missing B or C, foreign origin, wrong version and public port refuse',()=>{
    assert.ok(changed((composition,lock,descriptors)=>{
      composition.modules=composition.modules.filter(item=>item.moduleId!==b.identity.id);
      lock.modules=lock.modules.filter(item=>item.moduleId!==b.identity.id);
      descriptors.splice(1,1);
    }).includes('dependency.missing'));
    assert.ok(changed((composition,lock,descriptors)=>{
      composition.modules=composition.modules.filter(item=>item.moduleId!==c.identity.id);
      lock.modules=lock.modules.filter(item=>item.moduleId!==c.identity.id);
      descriptors.splice(2,1);
    }).includes('dependency.missing'));
    assert.ok(changed(composition=>{
      composition.modules[1].origin='https://example.invalid/another-publisher';
    }).includes('dependency.origin'));
    assert.ok(changed(composition=>{
      composition.modules[2].versionRange='^2.0.0';
    }).includes('dependency.version'));
    assert.ok(changed((composition,lock,descriptors)=>{
      descriptors[2].contracts.publicContracts[0].version='2.0.0';
      lock.modules[2].contractIntegrity=contractIntegrity(descriptors[2]);
    }).includes('dependency.contract-version'));
    assert.ok(changed((composition,lock,descriptors)=>{
      const conflict=structuredClone(a.dependencies[0]);
      conflict.moduleId=c.identity.id;conflict.origin=c.identity.origin;
      conflict.versionRange='^2.0.0';
      descriptors[0].dependencies.push(conflict);
      lock.modules[0].contractIntegrity=contractIntegrity(descriptors[0]);
    }).includes('dependency.version'));
    assert.equal(a.dependencies[0].moduleId,b.identity.id);
  });
  await t.test('optional absence disables only its guarded UI contribution',()=>{
    const result=host.check();
    assert.deepEqual(result.errors,[]);
    assert.ok(result.metrics.disabledContributions.some(item=>item.moduleId===a.identity.id&&
      item.path==='/contracts/ui/navigation/0'));
    assert.ok(!result.metrics.disabledContributions.some(item=>item.moduleId===a.identity.id&&
      item.path==='/contracts/operations/0'));
  });
  await t.test('backend: packaged read handlers execute from installed bytes',async()=>{
    for(const item of host.packed){
      const transformed=await transform(readFileSync(path.join(item.moduleDirectory,'module/operations.ts'),'utf8'),
        {loader:'ts',format:'esm'});
      const operations=await import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`);
      assert.deepEqual(operations.list(),{items:[]});
      assert.equal(operations.get().id,item.descriptor.identity.id);
      assert.equal(operations.get().record_version,0);
    }
  });
  if(host.sdkArchive)await t.test('distributed SDK 1.4.1 validates the three installed contracts',async()=>{
    const sdkDirectory=path.join(host.root,'sdk-public');mkdirSync(sdkDirectory);
    const extracted=spawnSync('tar',['-xf',host.sdkArchive,'-C',sdkDirectory,'--strip-components=1'],
      {encoding:'utf8',timeout:30000});
    assert.equal(extracted.status,0,extracted.stderr??extracted.error?.message);
    const bundled=path.join(sdkDirectory,'dist/esm/contracts/sdk-validator.mjs');
    await build({entryPoints:[path.join(sdkDirectory,'dist/esm/contracts/validate.js')],
      outfile:bundled,bundle:true,platform:'node',format:'esm',logLevel:'silent',
      nodePaths:[path.resolve('node_modules')]});
    const sdk=await import(pathToFileURL(bundled).href);
    for(const item of host.packed){
      const manifest=JSON.parse(readFileSync(path.join(item.moduleDirectory,'module/manifest.json'),'utf8'));
      assert.deepEqual(sdk.validateModule(manifest).errors,[],item.name);
    }
  });
  await t.test('ui: generated view metadata and guarded optional navigation reflect the installed graph',()=>{
    const generated=JSON.parse(readFileSync(path.join(host.root,'.creezio/generated/composition.json'),'utf8'));
    assert.equal(generated.views.length,3);
    assert.equal(generated.navigation.some(item=>item.moduleId==='alpha.cart'),false);
  });
  await t.test('api-mcp: compiler emits the installed routes and public read tools',()=>{
    const generated=JSON.parse(readFileSync(path.join(host.root,'.creezio/generated/composition.json'),'utf8'));
    assert.equal(generated.httpBindings.length,12);
    const server=readFileSync(path.join(host.root,'.creezio/generated/server.ts'),'utf8');
    const tools=JSON.parse(server.match(/export const mcpCatalog: McpCatalog = freeze\(\{tools:(\[[^\n]+\]),resources:/)?.[1]??'null');
    assert.ok(tools.length>=6);
    assert.equal(new Set(tools.map(item=>item.moduleId)).size,3);
  });
  await t.test('widgets: compiler bundles one read-only resource per publisher',()=>{
    const source=readFileSync(path.join(host.root,'.creezio/generated/widget-catalog.ts'),'utf8');
    const catalog=JSON.parse(source.match(/export const widgetCatalog: CompiledWidgetCatalog = freeze\(([^\n]+)\);/)?.[1]??'null');
    assert.equal(catalog.widgets.length,3);
    assert.equal(new Set(catalog.widgets.map(item=>item.moduleId)).size,3);
    assert.ok(catalog.resources.every(item=>item.text?.includes('<!doctype html>')));
  });
  await t.test('package: each installed runtime and detached validation retain receipt bytes',()=>{
    for(const item of host.packed)assert.doesNotThrow(()=>verifyPackageReceipt({root:host.root,
      receiptPath:path.relative(host.root,item.receiptPath).replaceAll('\\','/'),
      moduleDirectory:item.moduleDirectory,descriptor:item.descriptor}));
  });
  await t.test('docs: installed public documentation belongs to each exact package',()=>{
    for(const item of host.packed)for(const file of ['README.md','prd.md','CHANGELOG.md'])
      assert.match(readFileSync(path.join(item.moduleDirectory,file),'utf8'),
        new RegExp(item.descriptor.identity.id.replaceAll('.','\\.')));
  });
  await t.test('an altered installed byte fails receipt verification',()=>{
    const installed=path.join(host.packed[0].moduleDirectory,'README.md');
    writeFileSync(installed,'changed after npm install\n');
    assert.throws(()=>verifyPackageReceipt({root:host.root,
      receiptPath:path.relative(host.root,host.packed[0].receiptPath).replaceAll('\\','/'),
      moduleDirectory:host.packed[0].moduleDirectory,descriptor:host.packed[0].descriptor}),
    {code:'installed_runtime'});
  });
});
