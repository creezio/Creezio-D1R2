import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {deterministicModuleArchive} from '../../scripts/modules/archives.mjs';
import {loadModuleHostInventory,loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import {modulePlanDigest,solveModulePlan} from '../../sdk/modules/solver.mjs';
import {applyModulePlan,resolveOfflineNpmLock,runModuleApplyCli} from '../../scripts/modules/apply.mjs';

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
