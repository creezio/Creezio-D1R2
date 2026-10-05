import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {deterministicModuleArchive} from '../../scripts/modules/archives.mjs';
import {packModuleArtifacts} from '../../scripts/modules/archives.mjs';
import {loadModuleHostInventory,loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import {modulePlanDigest,solveModulePlan} from '../../sdk/modules/solver.mjs';
import {contractIntegrity,validateComposition} from '../../sdk/contracts/validate.mjs';
import {compositionCase,fixture} from '../contracts/helpers.mjs';
import {applyModulePlan,inspectApprovedNpmArchive,readApprovedNpmArchives,resolveOfflineNpmLock,
  runModuleApplyCli} from '../../scripts/modules/apply.mjs';

test('npm archive inspection bounds inflated bytes without retaining files for approval',()=>{
  const archive=deterministicModuleArchive([
    {path:'package/package.json',bytes:Buffer.from('{"name":"@creezio/limit","version":"1.0.0"}')},
    {path:'package/payload.txt',bytes:Buffer.alloc(8192,65)},
  ]);
  const inspected=inspectApprovedNpmArchive(archive,{maxInflatedBytes:16*1024});
  assert.ok(inspected.inflatedBytes>8192);
  assert.deepEqual(inspected.files,[]);
  assert.throws(()=>inspectApprovedNpmArchive(archive,{maxInflatedBytes:8192}),
    {code:'npm_archive'});
});

test('npm approval bounds aggregate inflated bytes across individually valid archives',t=>{
  const root=temporaryDirectory(t,'creezio-apply-aggregate-');
  const declarations=[];
  for(const name of ['one','two']){
    const bytes=deterministicModuleArchive([
      {path:'package/package.json',bytes:Buffer.from(JSON.stringify({
        name:`@creezio/${name}`,version:'1.0.0'}))},
      {path:'package/payload.txt',bytes:Buffer.alloc(8192,65)},
    ]);
    const relative=`.creezio/packages/${name}.tgz`;
    mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});
    writeFileSync(path.join(root,relative),bytes);
    declarations.push({name:`@creezio/${name}`,version:'1.0.0',path:relative,
      integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`});
  }
  const approval='.creezio/approved.json';
  writeFileSync(path.join(root,approval),JSON.stringify({schemaVersion:1,archives:declarations}));
  assert.throws(()=>readApprovedNpmArchives(root,approval,{maxTotalInflatedBytes:16*1024}),
    {code:'npm_approval'});
  const accepted=readApprovedNpmArchives(root,approval,{maxTotalInflatedBytes:32*1024});
  assert.equal(accepted.archives.length,2);
  assert.ok(accepted.archives.every(item=>!Object.hasOwn(item,'files')));
});

test('npm approval refuses boolean bundleDependencies even without bundled files',t=>{
  const root=temporaryDirectory(t,'creezio-apply-bundle-');
  const relative='.creezio/packages/bundle.tgz';
  mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});
  const bytes=deterministicModuleArchive([{path:'package/package.json',
    bytes:Buffer.from(JSON.stringify({name:'@creezio/bundle',version:'1.0.0',
      bundleDependencies:true}))}]);
  writeFileSync(path.join(root,relative),bytes);
  const approval='.creezio/approved.json';
  writeFileSync(path.join(root,approval),JSON.stringify({schemaVersion:1,archives:[{
    name:'@creezio/bundle',version:'1.0.0',path:relative,
    integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`
  }]}));
  assert.throws(()=>readApprovedNpmArchives(root,approval),{code:'npm_approval'});
});

test('offline npm lock entry reconstructs the exact local package without scripts or registry',t=>{
  const root=temporaryDirectory(t,'creezio-apply-npm-');
  const archivePath='.creezio/packages/tiny-1.0.0.tgz';
  mkdirSync(path.join(root,'.creezio','packages'),{recursive:true});
  const archive=deterministicModuleArchive([
    {path:'package/package.json',bytes:Buffer.from(JSON.stringify({name:'@creezio/tiny',
      version:'1.0.0',exports:{'.':'./index.js'}}))},
    {path:'package/index.js',bytes:Buffer.from('export const value = 1;\n')},
  ]);
  writeFileSync(path.join(root,archivePath),archive);
  const spec=`file:${archivePath}`;
  const pkg={name:'fixture',version:'1.0.0',private:true,dependencies:{'@creezio/tiny':spec}};
  const oldLock={name:'fixture',version:'1.0.0',lockfileVersion:3,requires:true,
    packages:{'':{name:'fixture',version:'1.0.0',dependencies:{}}}};
  const lock=resolveOfflineNpmLock(root,'.creezio/stage',pkg,oldLock,['@creezio/tiny']);
  const entry=lock.packages['node_modules/@creezio/tiny'];
  assert.equal(entry.version,'1.0.0');
  assert.equal(entry.resolved,`file:${archivePath}`);
  assert.equal(entry.integrity,`sha512-${createHash('sha512').update(archive).digest('base64')}`);
  writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));
  writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(lock));
  const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  const command=existsSync(npmCli)?process.execPath:'npm';
  const result=spawnSync(command,[...(existsSync(npmCli)?[npmCli]:[]),
    'ci','--offline','--ignore-scripts','--no-audit','--no-fund'],
    {cwd:root,encoding:'utf8',timeout:120000,
      env:{...process.env,npm_config_cache:path.join(root,'.creezio','npm-cache'),
        npm_config_update_notifier:'false'}});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  assert.equal(readFileSync(path.join(root,'node_modules','@creezio','tiny','index.js'),'utf8'),
    'export const value = 1;\n');
});

test('offline npm lock admits an explicitly archived transitive closure without changing old nodes',t=>{
  const root=temporaryDirectory(t,'creezio-apply-transitive-lock-');
  const directory=path.join(root,'.creezio','packages');mkdirSync(directory,{recursive:true});
  const pack=(name,dependencies={})=>deterministicModuleArchive([
    {path:'package/package.json',bytes:Buffer.from(JSON.stringify({name,version:'1.0.0',dependencies}))},
    {path:'package/index.js',bytes:Buffer.from('export default 1;\n')},
  ]);
  const archives=[['@creezio/lib-b',pack('@creezio/lib-b')],
    ['@creezio/lib-a',pack('@creezio/lib-a',{'@creezio/lib-b':'^1.0.0'})]];
  for(const [name,bytes] of archives)writeFileSync(path.join(directory,`${name.split('/')[1]}.tgz`),bytes);
  const module=pack('@creezio/candidate',{'@creezio/lib-a':'^1.0.0'});
  writeFileSync(path.join(directory,'candidate.tgz'),module);
  const base={name:'fixture',version:'1.0.0',private:true,dependencies:{}};
  const empty={name:'fixture',version:'1.0.0',lockfileVersion:3,requires:true,
    packages:{'':{name:'fixture',version:'1.0.0',dependencies:{}}}};
  const target=structuredClone(base);
  target.dependencies['@creezio/candidate']='file:.creezio/packages/candidate.tgz';
  const approved=archives.map(([name,bytes])=>({name,version:'1.0.0',
    path:`.creezio/packages/${name.split('/')[1]}.tgz`,
    integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`}));
  const lock=resolveOfflineNpmLock(root,'.creezio/next',target,empty,['@creezio/candidate'],approved);
  assert.deepEqual(lock.packages[''].dependencies,target.dependencies);
  assert.deepEqual(empty.packages[''],{name:'fixture',version:'1.0.0',dependencies:{}});
  for(const item of approved){
    const entry=lock.packages[`node_modules/${item.name}`];
    assert.equal(entry.version,'1.0.0');
    assert.equal(entry.integrity,item.integrity);
    assert.equal(entry.resolved,`file:${item.path}`);
  }
  writeFileSync(path.join(root,'package.json'),JSON.stringify(target));
  writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(lock));
  const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  const result=spawnSync(existsSync(npmCli)?process.execPath:'npm',
    [...(existsSync(npmCli)?[npmCli]:[]),'ci','--offline','--ignore-scripts','--no-audit','--no-fund'],
    {cwd:root,encoding:'utf8',timeout:120000,
      env:{...process.env,npm_config_cache:path.join(root,'.creezio','ci-cache'),
        npm_config_update_notifier:'false'}});
  assert.equal(result.status,0,result.stderr||result.error?.message);
});

test('malformed or stale handoff refuses before writing an apply journal',t=>{
  const root=temporaryDirectory(t,'creezio-apply-stale-');
  mkdirSync(path.join(root,'configuration'));
  writeFileSync(path.join(root,'configuration','composition.json'),'{}\n');
  writeFileSync(path.join(root,'plan.json'),JSON.stringify({schemaVersion:1,
    status:'accepted_pending_publication',planId:'test',revision:1}));
  let output='';
  const code=runModuleApplyCli(['--plan','plan.json','--composition','configuration/composition.json',
    '--write'],{cwd:root,stdout:{write:()=>{}},stderr:{write:value=>{output+=value;}}});
  assert.equal(code,1);
  assert.match(output,/handoff/);
  assert.equal(existsSync(path.join(root,'.creezio','module-apply')),false);
});

test('offline npm lock retains already present dependency and peer nodes for normal npm ci',t=>{
  const root=temporaryDirectory(t,'creezio-apply-peers-');
  const dir=path.join(root,'.creezio','packages');mkdirSync(dir,{recursive:true});
  const pack=(name,version,extra={})=>deterministicModuleArchive([
    {path:'package/package.json',bytes:Buffer.from(JSON.stringify({name,version,...extra}))},
    {path:'package/index.js',bytes:Buffer.from('export default true;\n')},
  ]);
  const files=[['peer',pack('@creezio/peer','1.0.0')],
    ['dependency',pack('@creezio/dependency','1.0.0')],
    ['candidate',pack('@creezio/candidate','1.0.0',{dependencies:{'@creezio/dependency':'^1.0.0'},
      peerDependencies:{'@creezio/peer':'^1.0.0'}})]];
  for(const [name,bytes] of files)writeFileSync(path.join(dir,`${name}.tgz`),bytes);
  const base={name:'fixture',version:'1.0.0',private:true,dependencies:{
    '@creezio/peer':'file:.creezio/packages/peer.tgz',
    '@creezio/dependency':'file:.creezio/packages/dependency.tgz'}};
  const empty={name:'fixture',version:'1.0.0',lockfileVersion:3,requires:true,
    packages:{'':{name:'fixture',version:'1.0.0',dependencies:{}}}};
  const oldLock=resolveOfflineNpmLock(root,'.creezio/base',base,empty,
    ['@creezio/peer','@creezio/dependency']);
  const target=structuredClone(base);
  target.dependencies['@creezio/candidate']='file:.creezio/packages/candidate.tgz';
  const nextLock=resolveOfflineNpmLock(root,'.creezio/next',target,oldLock,['@creezio/candidate']);
  assert.deepEqual(nextLock.packages['node_modules/@creezio/peer'],
    oldLock.packages['node_modules/@creezio/peer']);
  assert.deepEqual(nextLock.packages['node_modules/@creezio/dependency'],
    oldLock.packages['node_modules/@creezio/dependency']);
  writeFileSync(path.join(root,'package.json'),JSON.stringify(target));
  writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(nextLock));
  const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  const result=spawnSync(existsSync(npmCli)?process.execPath:'npm',
    [...(existsSync(npmCli)?[npmCli]:[]),'ci','--offline','--ignore-scripts','--no-audit','--no-fund'],
    {cwd:root,encoding:'utf8',timeout:120000,
      env:{...process.env,npm_config_cache:path.join(root,'.creezio','ci-cache'),
        npm_config_update_notifier:'false'}});
  assert.equal(result.status,0,result.stderr||result.error?.message);
  assert.equal(JSON.parse(readFileSync(path.join(root,'node_modules','@creezio','candidate','package.json'))).version,'1.0.0');
});

test('revalidated native plan applies a local composition change and refuses a stale replay',t=>{
  const source=path.resolve(import.meta.dirname,'../..');
  const root=temporaryDirectory(t,'creezio-apply-native-');
  const loaded=loadRuntimeComposition({root:source});
  for(const item of loaded.located){
    const descriptor=item.descriptor,base=item.directory;
    for(const name of new Set([...descriptor.packaging.runtime.files,
      ...descriptor.packaging.validation.files,'module/manifest.json'])){
      const destination=path.join(root,path.relative(source,base),...name.split('/'));
      mkdirSync(path.dirname(destination),{recursive:true});
      copyFileSync(path.join(base,...name.split('/')),destination);
    }
  }
  for(const name of ['configuration/composition.json','configuration/composition.lock.json',
    'configuration/module-inventory.json','package.json','package-lock.json']){
    const destination=path.join(root,name);mkdirSync(path.dirname(destination),{recursive:true});
    copyFileSync(path.join(source,name),destination);
  }
  const current=loadRuntimeComposition({root});
  const host=loadModuleHostInventory({root,composition:current.composition,lock:current.lock,
    located:current.located,writeCache:false,allowUncached:true});
  const choices={schemaVersion:1,base:{revision:0,
    compositionDigest:modulePlanDigest(current.composition),lockDigest:modulePlanDigest(current.lock),
    inventoryDigest:host.inventory.digest},actions:[{kind:'disable',moduleId:'creezio.analytics'}]};
  const solved=solveModulePlan({revision:0,composition:current.composition,lock:current.lock,
    descriptors:current.located.map(item=>item.descriptor)},choices,host.inventory);
  assert.ok(solved.next,JSON.stringify(solved.diagnostics));
  const plan={schemaVersion:1,status:'accepted_pending_publication',planId:'test-native',revision:1,
    planDigest:modulePlanDigest({base:solved.base,inventoryDigest:solved.inventoryDigest,
      choicesDigest:solved.choicesDigest,summaryDigest:solved.summaryDigest,
      targetCompositionDigest:solved.nextCompositionDigest,targetLockDigest:solved.nextLockDigest}),
    inventoryDigest:solved.inventoryDigest,baseCompositionDigest:choices.base.compositionDigest,
    baseLockDigest:choices.base.lockDigest,targetCompositionDigest:solved.nextCompositionDigest,
    targetLockDigest:solved.nextLockDigest,choices,summary:solved.summary,
    summaryDigest:solved.summaryDigest};
  writeFileSync(path.join(root,'plan.json'),JSON.stringify(plan));
  const preview=applyModulePlan({root,planPath:'plan.json',compositionPath:'configuration/composition.json'});
  assert.equal(preview.status,'plan_revalidated');
  assert.equal(existsSync(path.join(root,'.creezio','module-apply')),false);
  const preserved=['configuration/composition.json','configuration/composition.lock.json',
    'configuration/module-inventory.json','package.json','package-lock.json'];
  const before=preserved.map(name=>readFileSync(path.join(root,name)));
  const preload=path.join(root,'inject-rename-failure.cjs');
  writeFileSync(preload,`const fs=require('node:fs');
const {syncBuiltinESMExports}=require('node:module');
const original=fs.renameSync;
let injected=false;
fs.renameSync=(from,to)=>{
  const source=String(from).replaceAll('\\\\','/');
  const target=String(to).replaceAll('\\\\','/');
  if(!injected&&source.includes('/.creezio/module-apply/')
    &&source.endsWith('/new/json-0')&&target.endsWith('/configuration/composition.json')){
    injected=true;throw new Error('injected composition rename failure');
  }
  return original(from,to);
};
syncBuiltinESMExports();\n`);
  const moduleUrl=pathToFileURL(path.join(source,'scripts/modules/apply.mjs')).href;
  const child=spawnSync(process.execPath,['--require',preload,'--input-type=module','--eval',
    `import {applyModulePlan} from ${JSON.stringify(moduleUrl)};\n`
      +`applyModulePlan(${JSON.stringify({root,planPath:'plan.json',
        compositionPath:'configuration/composition.json',write:true})});`],
  {cwd:root,encoding:'utf8',timeout:120000});
  assert.equal(child.status,1,child.stderr||child.error?.message);
  assert.match(child.stderr,/injected composition rename failure/);
  preserved.forEach((name,index)=>assert.deepEqual(readFileSync(path.join(root,name)),before[index],name));
  assert.equal(existsSync(path.join(root,'.creezio','module-apply','active.json')),false);
  assert.equal(existsSync(path.join(root,'.creezio','module-apply',plan.planDigest.slice(7))),false);
  const applied=applyModulePlan({root,planPath:'plan.json',compositionPath:'configuration/composition.json',write:true});
  assert.equal(applied.status,'applied_locally');
  assert.equal(loadRuntimeComposition({root}).composition.modules.find(item=>item.moduleId==='creezio.analytics').enabled,false);
  assert.throws(()=>applyModulePlan({root,planPath:'plan.json',
    compositionPath:'configuration/composition.json',write:true}),/does not match this checkout/);
});

function sharedPackageFixture(t,{incompatible=false,transitive=false}={}){
  const root=temporaryDirectory(t,'creezio-apply-shared-');
  const source=path.resolve(import.meta.dirname,'../..');
  const composition=JSON.parse(readFileSync(path.join(source,'configuration/composition.json')));
  const lock=JSON.parse(readFileSync(path.join(source,'configuration/composition.lock.json')));
  composition.sdk.version='1.9.1';lock.sdkVersion='1.9.1';
  const nativeIds=new Set(['creezio.access','creezio.modules-settings']);
  composition.modules=composition.modules.filter(item=>nativeIds.has(item.moduleId));
  lock.modules=lock.modules.filter(item=>nativeIds.has(item.moduleId));
  for(const audience of ['admin','app'])composition.exposure[audience].moduleIds=
    composition.exposure[audience].moduleIds.filter(id=>nativeIds.has(id));
  const natives=composition.modules.map(selection=>{
    const descriptor=JSON.parse(readFileSync(path.join(source,selection.source.path,'module/manifest.json')));
    for(const file of new Set([...descriptor.packaging.runtime.files,
      ...descriptor.packaging.validation.files,'module/manifest.json'])){
      const relative=`${selection.source.path}/${file}`;
      const destination=path.join(root,...relative.split('/'));
      mkdirSync(path.dirname(destination),{recursive:true});
      copyFileSync(path.join(source,...relative.split('/')),destination);
    }
    packModuleArtifacts({root,moduleDirectory:path.join(root,selection.source.path),
      moduleId:selection.moduleId,descriptor});
    return descriptor;
  });
  const installed=fixture();
  installed.compatibility.core='^0.0.0';
  installed.compatibility.sdk='^1.9.0';
  installed.validation.policy=structuredClone(composition.sdk.policy);
  const updated=structuredClone(installed);
  updated.compatibility.sdk='^1.9.1';
  for(const descriptor of [installed,updated])descriptor.packaging.runtime.files.push('package.json');
  updated.identity.version='1.0.1';updated.identity.source.revision='fixture-v2';
  updated.documentation.versionBinding.moduleVersion='1.0.1';
  updated.documentation.versionBinding.sourceRevision='fixture-v2';
  updated.packaging.validationBinding.moduleVersion='1.0.1';
  updated.packaging.validationBinding.sourceRevision='fixture-v2';
  const name='@creezio/tasks';
  const write=(relative,bytes)=>{const file=path.join(root,...relative.split('/'));
    mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes);return file;};
  const packageJson=descriptor=>({name,version:descriptor.identity.version,
    ...(transitive&&descriptor===updated?{dependencies:{'@creezio/lib-a':'^1.0.0'}}:{}),
    exports:Object.fromEntries(descriptor.packaging.runtime.files
      .map(file=>[`./${file}`,`./${file}`]))});
  const fileBytes=(descriptor,file)=>Buffer.from(file==='package.json'?JSON.stringify(packageJson(descriptor))
    :file==='module/manifest.json'?JSON.stringify(descriptor)
      :file.endsWith('.md')?`# ${descriptor.identity.id} ${descriptor.identity.version}\n`
        :file.endsWith('.json')?'{}\n':'export const fixture = true;\n');
  const materialize=(descriptor,base)=>{
    for(const file of new Set([...descriptor.packaging.runtime.files,...descriptor.packaging.validation.files]))
      write(`${base}/${file}`,fileBytes(descriptor,file));
  };
  materialize(installed,'node_modules/@creezio/tasks');
  const installedArtifacts=packModuleArtifacts({root,moduleDirectory:path.join(root,'node_modules/@creezio/tasks'),
    moduleId:installed.identity.id,descriptor:installed});
  const runtime=deterministicModuleArchive(updated.packaging.runtime.files.map(file=>({
    path:`package/${file}`,bytes:fileBytes(updated,file)})));
  const validation=deterministicModuleArchive(updated.packaging.validation.files.map(file=>({
    path:file,bytes:fileBytes(updated,file)})));
  const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
  const receipt={schemaVersion:'1.0.0',module:{id:updated.identity.id,origin:updated.identity.origin,
    version:updated.identity.version,source:updated.identity.source},
    contractIntegrity:contractIntegrity(updated),
    runtime:{integrity:sha(runtime),location:{kind:'local',path:'.creezio/packages/tasks-1.0.1.tgz'}},
    validation:{integrity:sha(validation),location:{kind:'local',path:'.creezio/packages/tasks-1.0.1-validation.tgz'}},
    policy:updated.validation.policy};
  const receiptBytes=Buffer.from(`${JSON.stringify(receipt)}\n`);
  const oldRuntime=readFileSync(path.join(root,installedArtifacts.runtime.path));
  write('.creezio/packages/tasks-1.0.0.tgz',oldRuntime);
  write('.creezio/packages/tasks-1.0.1.tgz',runtime);
  write('.creezio/packages/tasks-1.0.1-validation.tgz',validation);
  write('.creezio/packages/tasks-1.0.1-receipt.json',receiptBytes);
  const taskCase=compositionCase([installed]);
  const taskSelection=taskCase.composition.modules[0];
  taskSelection.source={kind:'package',name};
  composition.modules.push(taskSelection);
  for(const audience of ['admin','app'])composition.exposure[audience].moduleIds.push(installed.identity.id);
  const taskNode=taskCase.lock.modules[0];
  taskNode.contractIntegrity=contractIntegrity(installed);
  taskNode.runtime={integrity:installedArtifacts.runtime.integrity,
    location:{kind:'local',path:installedArtifacts.runtime.path}};
  taskNode.validation={integrity:installedArtifacts.validation.integrity,
    location:{kind:'local',path:installedArtifacts.validation.path}};
  lock.modules.push(taskNode);
  lock.compositionIntegrity=contractIntegrity(composition);
  const base={composition,lock};
  const files=[];
  const profile=(suffix,mutate=()=>{})=>{
    const composition=structuredClone(base.composition),lock=structuredClone(base.lock);
    composition.application.id=`example.${suffix}`;
    lock.applicationId=composition.application.id;
    mutate(composition,lock);
    lock.compositionIntegrity=contractIntegrity(composition);
    const compositionPath=`configuration/composition.${suffix}.json`;
    const lockPath=`configuration/composition.${suffix}.lock.json`;
    write(compositionPath,JSON.stringify(composition));write(lockPath,JSON.stringify(lock));
    files.push(compositionPath,lockPath);
    assert.deepEqual(validateComposition(composition,{modules:[...natives,installed],lock}).errors,[]);
    return {compositionPath,lockPath,composition,lock};
  };
  const primary=profile('primary');
  const companions=[
    profile('alpha',(composition)=>{composition.modules.find(item=>item.moduleId===installed.identity.id).enabled=false;
      for(const audience of ['admin','app'])composition.exposure[audience].moduleIds=
        composition.exposure[audience].moduleIds.filter(id=>id!==installed.identity.id);}),
    profile('beta',(composition)=>{composition.modules.find(item=>item.moduleId===installed.identity.id).configuration=[{setting:{moduleId:installed.identity.id,
      kind:'setting',id:'task-label'},valueRef:'label-ref'}];}),
    profile('gamma',(composition,lock)=>{if(incompatible){composition.sdk.version='1.9.0';lock.sdkVersion='1.9.0';}
      composition.modules.find(item=>item.moduleId===installed.identity.id).integrations=[{moduleId:'example.catalogue',enabled:false}];
      composition.exposure.admin.moduleIds=composition.exposure.admin.moduleIds.filter(id=>id!==installed.identity.id);}),
  ];
  const config={schemaVersion:1,allowedOrigins:[...new Set([
    ...natives.map(item=>item.identity.origin),installed.identity.origin])],
    available:[],externalPackages:[{moduleId:updated.identity.id,origin:updated.identity.origin,
      packageName:name,version:updated.identity.version,
      runtime:{path:'.creezio/packages/tasks-1.0.1.tgz',integrity:sha(runtime)},
      validation:{path:'.creezio/packages/tasks-1.0.1-validation.tgz',integrity:sha(validation)},
      receipt:{path:'.creezio/packages/tasks-1.0.1-receipt.json',integrity:sha(receiptBytes)}}]};
  write('configuration/module-inventory.json',JSON.stringify(config));
  let npmArchivesPath;
  if(transitive){
    const pack=(packageName,dependencies={})=>deterministicModuleArchive([
      {path:'package/package.json',bytes:Buffer.from(JSON.stringify({
        name:packageName,version:'1.0.0',dependencies}))},
      {path:'package/index.js',bytes:Buffer.from('export default true;\n')},
    ]);
    const archives=[['@creezio/lib-a',pack('@creezio/lib-a',{'@creezio/lib-b':'^1.0.0'})],
      ['@creezio/lib-b',pack('@creezio/lib-b')]];
    const declarations=archives.map(([packageName,bytes])=>{
      const archivePath=`.creezio/packages/${packageName.split('/')[1]}.tgz`;
      write(archivePath,bytes);
      return {name:packageName,version:'1.0.0',path:archivePath,
        integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`};
    });
    npmArchivesPath='.creezio/npm-approval.json';
    write(npmArchivesPath,JSON.stringify({schemaVersion:1,archives:declarations}));
  }
  const npmPackage={name:'shared-test-host',version:'1.0.0',private:true,
    dependencies:{[name]:'file:.creezio/packages/tasks-1.0.0.tgz'}};
  write('package.json',JSON.stringify(npmPackage));
  write('package-lock.json',JSON.stringify({name:npmPackage.name,version:npmPackage.version,
    lockfileVersion:3,requires:true,packages:{'':{name:npmPackage.name,version:npmPackage.version,
      dependencies:npmPackage.dependencies},[`node_modules/${name}`]:{version:'1.0.0',
        resolved:npmPackage.dependencies[name],integrity:`sha512-${createHash('sha512').update(oldRuntime).digest('base64')}`}}}));
  const loaded=loadRuntimeComposition({root,compositionPath:primary.compositionPath});
  const host=loadModuleHostInventory({root,composition:loaded.composition,lock:loaded.lock,
    located:loaded.located,writeCache:false,allowUncached:true});
  const candidate=host.inventory.candidates.find(item=>item.moduleId===installed.identity.id
    &&item.version===updated.identity.version);
  assert.ok(candidate);
  const choices={schemaVersion:1,base:{revision:0,
    compositionDigest:modulePlanDigest(loaded.composition),lockDigest:modulePlanDigest(loaded.lock),
    inventoryDigest:host.inventory.digest},actions:[{kind:'update',moduleId:installed.identity.id,
      candidateKey:candidate.candidateKey}]};
  const solved=solveModulePlan({revision:0,composition:loaded.composition,lock:loaded.lock,
    descriptors:loaded.located.map(item=>item.descriptor)},choices,host.inventory);
  assert.ok(solved.next,JSON.stringify(solved.diagnostics));
  const handoff={schemaVersion:1,status:'accepted_pending_publication',planId:'shared-package',revision:1,
    planDigest:modulePlanDigest({base:solved.base,inventoryDigest:solved.inventoryDigest,
      choicesDigest:solved.choicesDigest,summaryDigest:solved.summaryDigest,
      targetCompositionDigest:solved.nextCompositionDigest,targetLockDigest:solved.nextLockDigest}),
    inventoryDigest:solved.inventoryDigest,baseCompositionDigest:choices.base.compositionDigest,
    baseLockDigest:choices.base.lockDigest,targetCompositionDigest:solved.nextCompositionDigest,
    targetLockDigest:solved.nextLockDigest,choices,summary:solved.summary,
    summaryDigest:solved.summaryDigest};
  write('plan.json',JSON.stringify(handoff));
  return {root,primary,companions,files,installed,updated,natives,handoff,write,npmArchivesPath};
}

test('shared package update requires every companion opt-in and preserves each profile state',t=>{
  const f=sharedPackageFixture(t);
  const options={root:f.root,planPath:'plan.json',compositionPath:f.primary.compositionPath};
  const named=f.companions.map(item=>item.compositionPath);
  const before=new Map(f.files.map(file=>[file,readFileSync(path.join(f.root,file))]));
  assert.throws(()=>applyModulePlan({...options,syncProfiles:named.slice(0,2),write:true}),
    /Another composition profile uses a changed package/);
  for(const [file,bytes] of before)assert.deepEqual(readFileSync(path.join(f.root,file)),bytes,file);
  assert.equal(existsSync(path.join(f.root,'.creezio/module-apply/active.json')),false);
  const preview=applyModulePlan({...options,syncProfiles:named});
  assert.equal(preview.status,'plan_revalidated');
  assert.deepEqual(preview.profiles.map(item=>item.appId),
    [f.primary,...f.companions].map(item=>item.composition.application.id));
  const applied=applyModulePlan({...options,syncProfiles:named,write:true});
  assert.equal(applied.status,'applied_locally');
  for(const profile of [f.primary,...f.companions]){
    const current=loadRuntimeComposition({root:f.root,compositionPath:profile.compositionPath});
    const old=profile.composition.modules.find(item=>item.moduleId===f.installed.identity.id);
    const next=current.composition.modules.find(item=>item.moduleId===f.installed.identity.id);
    assert.equal(current.lock.modules.find(item=>item.moduleId===f.installed.identity.id).version,'1.0.1');
    assert.equal(next.versionRange,'1.0.1');
    assert.equal(next.enabled,old.enabled);
    assert.deepEqual(next.configuration,old.configuration);
    assert.deepEqual(next.integrations,old.integrations);
    assert.deepEqual(current.composition.exposure,profile.composition.exposure);
    for(const native of f.natives)assert.deepEqual(
      current.composition.modules.find(item=>item.moduleId===native.identity.id),
      profile.composition.modules.find(item=>item.moduleId===native.identity.id));
    assert.equal(current.composition.application.id,profile.composition.application.id);
  }
});

test('module apply requires exact approved transitive archives and installs their closure',t=>{
  const f=sharedPackageFixture(t,{transitive:true});
  const options={root:f.root,planPath:'plan.json',compositionPath:f.primary.compositionPath,
    syncProfiles:f.companions.map(item=>item.compositionPath),npmArchivesPath:f.npmArchivesPath};
  const before=readFileSync(path.join(f.root,'package-lock.json'));
  assert.throws(()=>applyModulePlan({...options,npmArchivesPath:undefined,write:true}),
    {code:'package_dependency'});
  assert.deepEqual(readFileSync(path.join(f.root,'package-lock.json')),before);
  assert.equal(existsSync(path.join(f.root,'.creezio/module-apply/active.json')),false);
  const approvalFile=path.join(f.root,f.npmArchivesPath);
  const approval=JSON.parse(readFileSync(approvalFile));
  approval.archives[1].integrity='sha512-'+ 'A'.repeat(86)+'==';
  writeFileSync(approvalFile,JSON.stringify(approval));
  assert.throws(()=>applyModulePlan({...options,write:true}),{code:'npm_approval'});
  assert.equal(existsSync(path.join(f.root,'.creezio/module-apply/active.json')),false);
  const actual=readFileSync(path.join(f.root,approval.archives[1].path));
  approval.archives[1].integrity=`sha512-${createHash('sha512').update(actual).digest('base64')}`;
  approval.archives[1].version='2.0.0';
  writeFileSync(approvalFile,JSON.stringify(approval));
  assert.throws(()=>applyModulePlan({...options,write:true}),{code:'npm_approval'});
  approval.archives[1].version='1.0.0';
  approval.archives[1].path='.creezio/packages/missing.tgz';
  writeFileSync(approvalFile,JSON.stringify(approval));
  assert.throws(()=>applyModulePlan({...options,write:true}),{code:'path_missing'});
  approval.archives[1].path='.creezio/packages/lib-b.tgz';
  const scripted=deterministicModuleArchive([
    {path:'package/package.json',bytes:Buffer.from(JSON.stringify({
      name:'@creezio/lib-b',version:'1.0.0',scripts:{postinstall:'exit 1'}}))},
    {path:'package/index.js',bytes:Buffer.from('export default true;\n')},
  ]);
  writeFileSync(path.join(f.root,approval.archives[1].path),scripted);
  approval.archives[1].integrity=`sha512-${createHash('sha512').update(scripted).digest('base64')}`;
  writeFileSync(approvalFile,JSON.stringify(approval));
  assert.throws(()=>applyModulePlan({...options,write:true}),{code:'npm_approval'});
  writeFileSync(path.join(f.root,approval.archives[1].path),actual);
  approval.archives[1].integrity=`sha512-${createHash('sha512').update(actual).digest('base64')}`;
  writeFileSync(approvalFile,JSON.stringify(approval));
  const preview=applyModulePlan(options);
  assert.match(preview.npmArchivesDigest,/^sha256-[a-f0-9]{64}$/);
  assert.deepEqual(preview.npmArchives.map(item=>item.name),
    ['@creezio/lib-a','@creezio/lib-b']);
  const result=applyModulePlan({...options,write:true});
  assert.equal(result.status,'applied_locally');
  assert.equal(result.npmArchivesDigest,preview.npmArchivesDigest);
  const next=JSON.parse(readFileSync(path.join(f.root,'package-lock.json')));
  for(const name of ['lib-a','lib-b']){
    assert.equal(next.packages[`node_modules/@creezio/${name}`].version,'1.0.0');
    assert.equal(JSON.parse(readFileSync(path.join(f.root,'node_modules','@creezio',name,
      'package.json'))).version,'1.0.0');
  }
  assert.equal(existsSync(path.join(f.root,'.creezio/module-apply/active.json')),false);
});

test('an incompatible companion refuses the shared package update before any write',t=>{
  const f=sharedPackageFixture(t,{incompatible:true});
  const files=[...f.files,'package.json','package-lock.json','configuration/module-inventory.json'];
  const before=files.map(file=>readFileSync(path.join(f.root,file)));
  assert.throws(()=>applyModulePlan({root:f.root,planPath:'plan.json',
    compositionPath:f.primary.compositionPath,syncProfiles:f.companions.map(item=>item.compositionPath),
    write:true}),{code:'profile_incompatible'});
  files.forEach((file,index)=>assert.deepEqual(readFileSync(path.join(f.root,file)),before[index],file));
  assert.equal(existsSync(path.join(f.root,'.creezio/module-apply')),false);
  assert.equal(JSON.parse(readFileSync(path.join(f.root,'node_modules/@creezio/tasks/package.json'))).version,'1.0.0');
});

test('a failed companion write rolls back every profile and the shared installed package',t=>{
  const f=sharedPackageFixture(t,{transitive:true});
  const files=[...f.files,'package.json','package-lock.json','configuration/module-inventory.json',
    ...f.installed.packaging.runtime.files.map(file=>`node_modules/@creezio/tasks/${file}`)];
  const before=files.map(file=>readFileSync(path.join(f.root,file)));
  const preload=path.join(f.root,'fail-companion-write.cjs');
  writeFileSync(preload,`const fs=require('node:fs');
const {syncBuiltinESMExports}=require('node:module');
const original=fs.renameSync;let injected=false;
fs.renameSync=(from,to)=>{
  const source=String(from).replaceAll('\\\\','/');
  const target=String(to).replaceAll('\\\\','/');
  if(!injected&&source.includes('/.creezio/module-apply/')&&source.includes('/new/')
    &&target.endsWith('/configuration/composition.beta.json')){
    injected=true;throw new Error('injected companion write failure');
  }
  return original(from,to);
};syncBuiltinESMExports();\n`);
  const options={root:f.root,planPath:'plan.json',compositionPath:f.primary.compositionPath,
    syncProfiles:f.companions.map(item=>item.compositionPath),
    npmArchivesPath:f.npmArchivesPath,write:true};
  const moduleUrl=pathToFileURL(path.resolve(import.meta.dirname,'../../scripts/modules/apply.mjs')).href;
  const child=spawnSync(process.execPath,['--require',preload,'--input-type=module','--eval',
    `import {applyModulePlan} from ${JSON.stringify(moduleUrl)};applyModulePlan(${JSON.stringify(options)});`],
    {cwd:f.root,encoding:'utf8',timeout:120000});
  assert.equal(child.status,1,child.stderr||child.error?.message);
  assert.match(child.stderr,/injected companion write failure/);
  files.forEach((file,index)=>assert.deepEqual(readFileSync(path.join(f.root,file)),before[index],file));
  assert.equal(existsSync(path.join(f.root,'.creezio/module-apply/active.json')),false);
  assert.equal(existsSync(path.join(f.root,'.creezio/module-apply',f.handoff.planDigest.slice(7))),false);
  assert.equal(existsSync(path.join(f.root,'node_modules/@creezio/lib-a')),false);
  assert.equal(existsSync(path.join(f.root,'node_modules/@creezio/lib-b')),false);
  for(const profile of [f.primary,...f.companions])assert.equal(
    loadRuntimeComposition({root:f.root,compositionPath:profile.compositionPath}).lock.modules
      .find(item=>item.moduleId===f.installed.identity.id).version,'1.0.0');
});
