import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,unlinkSync,rmdirSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fixture} from '../contracts/helpers.mjs';
import {safePackagePath} from '../../sdk/contracts/references.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {deterministicModuleArchive,packModuleArtifacts} from '../../scripts/modules/archives.mjs';
import {loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import {compileModuleInventory,compileModuleInventoryWithDocuments} from '../../sdk/modules/inventory.mjs';
import {runModulePlanCli} from '../../scripts/modules/plan.mjs';
import {runModuleLockCli} from '../../scripts/modules/lock.mjs';

test('every shipped Conversations composition locks the current module artifacts',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const profiles=readdirSync(path.join(root,'configuration')).filter(name=>
    /^composition(?:\.[a-z-]+)?\.json$/.test(name)&&!name.endsWith('.lock.json'))
    .filter(name=>JSON.parse(readFileSync(path.join(root,'configuration',name),'utf8')).modules
      .some(module=>module.moduleId==='creezio.conversations'));
  assert.ok(profiles.length>0);
  for(const name of profiles){
    const {composition,lock,located}=loadRuntimeComposition({root,compositionPath:`configuration/${name}`});
    for(const [index,selection] of composition.modules.entries()){
      const node=lock.modules.find(item=>item.moduleId===selection.moduleId);
      assert.ok(node,`${name}: missing lock for ${selection.moduleId}`);
      const {directory,descriptor}=located[index];
      for(const kind of ['runtime','validation']){
        const files=descriptor.packaging[kind].files.map(relative=>{
          assert.ok(safePackagePath(relative),`${name}: invalid path ${relative}`);
          let absolute=directory;
          for(const part of relative.split('/')){
            absolute=path.join(absolute,part);
            assert.equal(lstatSync(absolute).isSymbolicLink(),false,`${name}: linked path ${relative}`);
          }
          assert.ok(lstatSync(absolute).isFile(),`${name}: missing file ${relative}`);
          return {path:relative,bytes:readFileSync(absolute)};
        });
        const integrity=`sha256-${createHash('sha256').update(deterministicModuleArchive(files)).digest('hex')}`;
        assert.equal(node[kind].integrity,integrity,`${name}: ${selection.moduleId} ${kind} archive mismatch`);
        assert.deepEqual(node[kind].location,{kind:'local',
          path:`.creezio/module-artifacts/${selection.moduleId}/${kind}-${integrity.slice(7)}.tgz`},
        `${name}: ${selection.moduleId} ${kind} location mismatch`);
      }
    }
  }
});

function localModule(t) {
  const root=mkdtempSync(path.join(tmpdir(),'creezio-t11-inventory-'));
  const directories=new Set([root]),files=new Set();
  const makeDirectory=absolute=>{
    const next=path.resolve(absolute);
    assert.ok(next===root||next.startsWith(`${root}${path.sep}`));
    const parts=path.relative(root,next).split(path.sep).filter(Boolean);
    let cursor=root;
    for (const part of parts){cursor=path.join(cursor,part);mkdirSync(cursor,{recursive:true});directories.add(cursor);}
  };
  const write=(absolute,content)=>{makeDirectory(path.dirname(absolute));writeFileSync(absolute,content);files.add(absolute);};
  t.after(()=>{
    for (const file of files) if(existsSync(file))unlinkSync(file);
    for (const directory of [...directories].sort((a,b)=>b.length-a.length)) if(existsSync(directory))rmdirSync(directory);
  });
  const descriptor=fixture(),source={kind:'workspace',path:'extensions/native/tasks'};
  const moduleDirectory=path.join(root,...source.path.split('/'));
  for (const name of new Set([...descriptor.packaging.runtime.files,...descriptor.packaging.validation.files]))
    write(path.join(moduleDirectory,...name.split('/')),name==='module/manifest.json'
      ? `${JSON.stringify(descriptor,null,2)}\n`:`Fixture ${name}\n`);
  const cacheDirectory=path.join(root,'.creezio','module-artifacts',descriptor.identity.id);
  makeDirectory(cacheDirectory);
  const packed=packModuleArtifacts({root,moduleDirectory,moduleId:descriptor.identity.id,descriptor});
  const runtimePath=path.join(root,...packed.runtime.path.split('/'));
  const validationPath=path.join(root,...packed.validation.path.split('/'));
  files.add(runtimePath);files.add(validationPath);
  const node=fixture('valid-composition-lock').modules[0];
  Object.assign(node,{moduleId:descriptor.identity.id,origin:descriptor.identity.origin,
    version:descriptor.identity.version,source:structuredClone(descriptor.identity.source),
    contractIntegrity:contractIntegrity(descriptor),
    runtime:{integrity:packed.runtime.integrity,location:{kind:'local',path:packed.runtime.path}},
    validation:{integrity:packed.validation.integrity,location:{kind:'local',path:packed.validation.path}},
    dependencies:[]});
  return {root,descriptor,source,node,moduleDirectory,runtimePath,write,makeDirectory,files};
}

test('Node inventory binds an available module to exact runtime and validation bytes',t=>{
  const f=localModule(t),input={root:f.root,allowedOrigins:[f.descriptor.identity.origin],
    candidates:[{source:f.source,lockNode:f.node}]};
  const inventory=compileModuleInventory(input);
  assert.equal(inventory.candidates.length,1);
  assert.equal(inventory.candidates[0].moduleId,f.descriptor.identity.id);
  assert.equal(inventory.candidates[0].lockNode.runtime.integrity,f.node.runtime.integrity);
  assert.equal(inventory.digest,contractIntegrity({schemaVersion:1,candidates:inventory.candidates}));
  const listed=spawnSync('tar',['-tzf',f.runtimePath],{encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  assert.ok(listed.stdout.split(/\r?\n/).includes('module/manifest.json'));
  const before=readFileSync(f.runtimePath);
  writeFileSync(path.join(f.moduleDirectory,'README.md'),'Changed bytes\n');
  assert.throws(()=>compileModuleInventory(input),{code:'lock_artifact'});
  assert.deepEqual(readFileSync(f.runtimePath),before,'a rejected source must not replace the verified cache');
  const newer=packModuleArtifacts({root:f.root,moduleDirectory:f.moduleDirectory,
    moduleId:f.descriptor.identity.id,descriptor:f.descriptor});
  f.files.add(path.join(f.root,...newer.runtime.path.split('/')));
  f.files.add(path.join(f.root,...newer.validation.path.split('/')));
  assert.notEqual(newer.runtime.path,f.node.runtime.location.path);
  assert.deepEqual(readFileSync(f.runtimePath),before,'new candidate bytes keep the old version intact');
});

test('workspace archive packer refuses CRLF without normalizing source bytes',t=>{
  const f=localModule(t);
  const readme=path.join(f.moduleDirectory,'README.md');
  writeFileSync(readme,'Windows line\r\n');
  assert.throws(()=>packModuleArtifacts({root:f.root,moduleDirectory:f.moduleDirectory,
    moduleId:f.descriptor.identity.id,descriptor:f.descriptor}),{code:'text_eol'});
  assert.equal(readFileSync(readme,'utf8'),'Windows line\r\n');
});

test('selected installed documents are captured from the same verified runtime archive read',t=>{
  const f=localModule(t);
  const {inventory,currentInstalledDocuments}=compileModuleInventoryWithDocuments({root:f.root,
    candidates:[{source:f.source,lockNode:f.node}],selectedCount:1,
    allowedOrigins:[f.descriptor.identity.origin]});
  assert.equal(currentInstalledDocuments.length,3);
  assert.deepEqual(currentInstalledDocuments.map(item=>item.kind),['readme','prd','changelog']);
  assert.equal(currentInstalledDocuments[0].content,'Fixture README.md\n');
  assert.equal(currentInstalledDocuments[0].runtimeIntegrity,f.node.runtime.integrity);
  assert.equal(Object.hasOwn(inventory,'currentInstalledDocuments'),false);
  assert.equal(JSON.stringify(inventory).includes('Fixture README.md'),false);
  assert.deepEqual(compileModuleInventoryWithDocuments({root:f.root,
    candidates:[{source:f.source,lockNode:f.node}],selectedCount:0,
    allowedOrigins:[f.descriptor.identity.origin]}).currentInstalledDocuments,[]);
});

test('an available other version contributes no document text to selected host data',t=>{
  const f=localModule(t),updated=structuredClone(f.descriptor);
  updated.identity.version='1.1.0';
  updated.documentation.versionBinding.moduleVersion='1.1.0';
  updated.packaging.validationBinding.moduleVersion='1.1.0';
  const source={kind:'workspace',path:'extensions/native/tasks-update'};
  const directory=path.join(f.root,...source.path.split('/'));
  for(const name of new Set([...updated.packaging.runtime.files,...updated.packaging.validation.files]))
    f.write(path.join(directory,...name.split('/')),name==='module/manifest.json'
      ? `${JSON.stringify(updated,null,2)}\n`:`Other version ${name}\n`);
  f.makeDirectory(path.join(f.root,'.creezio','module-artifacts',updated.identity.id));
  const packed=packModuleArtifacts({root:f.root,moduleDirectory:directory,moduleId:updated.identity.id,descriptor:updated});
  f.files.add(path.join(f.root,...packed.runtime.path.split('/')));
  f.files.add(path.join(f.root,...packed.validation.path.split('/')));
  const node=structuredClone(f.node);
  node.version=updated.identity.version;node.contractIntegrity=contractIntegrity(updated);
  node.runtime={integrity:packed.runtime.integrity,location:{kind:'local',path:packed.runtime.path}};
  node.validation={integrity:packed.validation.integrity,location:{kind:'local',path:packed.validation.path}};
  const {inventory,currentInstalledDocuments}=compileModuleInventoryWithDocuments({root:f.root,
    candidates:[{source:f.source,lockNode:f.node},{source,lockNode:node}],selectedCount:1,
    allowedOrigins:[f.descriptor.identity.origin]});
  assert.equal(inventory.candidates.length,2);
  assert.equal(currentInstalledDocuments.length,3);
  assert.ok(currentInstalledDocuments.every(doc=>doc.version===f.descriptor.identity.version));
  assert.equal(JSON.stringify({inventory,currentInstalledDocuments}).includes('Other version README.md'),false);
});

test('local plan command validates the current lock and resolves from exact cached artifacts',t=>{
  const f=localModule(t),candidates=[{source:f.source,lockNode:f.node}];
  const inventory=compileModuleInventory({root:f.root,candidates,
    allowedOrigins:[f.descriptor.identity.origin]});
  const composition=fixture('valid-composition'),lock=fixture('valid-composition-lock');
  lock.modules=[f.node];
  const current={composition,lock,descriptors:[f.descriptor],revision:0};
  const choices={schemaVersion:1,base:{revision:0,
    compositionDigest:contractIntegrity(composition),lockDigest:contractIntegrity(lock),
    inventoryDigest:inventory.digest},actions:[]};
  for(const [name,value] of Object.entries({current,choices,candidates,
    origins:[f.descriptor.identity.origin]}))
    f.write(path.join(f.root,`${name}.json`),`${JSON.stringify(value)}\n`);
  let output='',errors='';
  const code=runModulePlanCli(['--root',f.root,'--current','current.json','--choices','choices.json',
    '--candidates','candidates.json','--allowed-origins','origins.json'],
  {stdout:{write:chunk=>{output+=chunk;}},stderr:{write:chunk=>{errors+=chunk;}}});
  assert.equal(code,0,errors);
  const plan=JSON.parse(output);
  assert.equal(plan.summary.status,'ready');
  assert.equal(plan.inventoryDigest,inventory.digest);
  assert.equal(plan.nextLockDigest,contractIntegrity(lock));
});

test('local lock command writes verified bytes once and check mode refuses stale source',t=>{
  const f=localModule(t),composition=fixture('valid-composition');
  f.write(path.join(f.root,'composition.json'),`${JSON.stringify(composition)}\n`);
  const priorLock=fixture('valid-composition-lock');
  priorLock.modules=[];
  f.write(path.join(f.root,'composition.lock.json'),`${JSON.stringify(priorLock)}\n`);
  f.write(path.join(f.root,'module-inventory.json'),JSON.stringify({schemaVersion:1,
    allowedOrigins:[f.descriptor.identity.origin],available:[]}));
  const args=['--root',f.root,'--composition','composition.json','--lock','composition.lock.json',
    '--inventory','module-inventory.json'];
  let errors='';
  const io={stdout:{write:()=>{}},stderr:{write:value=>{errors+=value;}}};
  assert.equal(runModuleLockCli([...args,'--write'],io),0,errors);
  const locked=readFileSync(path.join(f.root,'composition.lock.json'),'utf8');
  assert.equal(runModuleLockCli(args,io),0,errors);
  writeFileSync(path.join(f.moduleDirectory,'README.md'),'Changed bytes\n');
  assert.equal(runModuleLockCli(args,io),1);
  assert.equal(readFileSync(path.join(f.root,'composition.lock.json'),'utf8'),locked);
});
