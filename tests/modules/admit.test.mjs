import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {compositionCase,fixture} from '../contracts/helpers.mjs';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {deterministicModuleArchive} from '../../scripts/modules/archives.mjs';
import {externalPackageCandidate,loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import {admitExternalPackage,runModuleAdmitCli} from '../../scripts/modules/admit.mjs';

const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;
function setup(t){
  const root=temporaryDirectory(t,'creezio-admit-');
  const write=(relative,bytes)=>{
    const target=path.join(root,...relative.split('/'));
    mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);
    return target;
  };
  const composition=compositionCase([]),descriptor=fixture();
  write('configuration/composition.json',`${JSON.stringify(composition.composition,null,2)}\n`);
  write('configuration/composition.lock.json',`${JSON.stringify(composition.lock,null,2)}\n`);
  write('configuration/module-inventory.json',JSON.stringify({schemaVersion:1,
    allowedOrigins:[descriptor.identity.origin],available:[]},null,2)+'\n');
  descriptor.identity.version='1.0.1';
  descriptor.identity.source.revision='fixture-admit';
  descriptor.documentation.versionBinding.moduleVersion='1.0.1';
  descriptor.documentation.versionBinding.sourceRevision='fixture-admit';
  descriptor.packaging.validationBinding.moduleVersion='1.0.1';
  descriptor.packaging.validationBinding.sourceRevision='fixture-admit';
  descriptor.packaging.runtime.files.push('package.json');
  const packageName='@creezio/tasks';
  const pkg={name:packageName,version:'1.0.1',exports:Object.fromEntries(
    descriptor.packaging.runtime.files.map(name=>[`./${name}`,`./${name}`]))};
  const runtime=deterministicModuleArchive(descriptor.packaging.runtime.files.map(name=>({
    path:`package/${name}`,bytes:Buffer.from(name==='package.json'?JSON.stringify(pkg)
      :name==='module/manifest.json'?JSON.stringify(descriptor)
      :name.includes('entry.server')?'throw new Error("candidate code executed");\n'
      :`runtime ${name}\n`)})));
  const validation=deterministicModuleArchive(descriptor.packaging.validation.files.map(name=>({
    path:name,bytes:Buffer.from(`validation ${name}\n`)})));
  const receipt={schemaVersion:'1.0.0',module:{id:descriptor.identity.id,
    origin:descriptor.identity.origin,version:'1.0.1',source:descriptor.identity.source},
    contractIntegrity:contractIntegrity(descriptor),
    runtime:{integrity:sha(runtime),location:{kind:'local',path:'.creezio/packages/tasks-1.0.1.tgz'}},
    validation:{integrity:sha(validation),location:{kind:'local',
      path:'.creezio/packages/tasks-1.0.1-validation.tgz'}},policy:descriptor.validation.policy};
  const receiptBytes=Buffer.from(`${JSON.stringify(receipt)}\n`);
  write('.creezio/packages/tasks-1.0.1.tgz',runtime);
  write('.creezio/packages/tasks-1.0.1-validation.tgz',validation);
  write('.creezio/packages/manifest-1.0.1.json',receiptBytes);
  const args={root,moduleId:descriptor.identity.id,origin:descriptor.identity.origin,
    packageName,version:'1.0.1',runtimePath:'.creezio/packages/tasks-1.0.1.tgz',
    runtimeIntegrity:sha(runtime),validationPath:'.creezio/packages/tasks-1.0.1-validation.tgz',
    validationIntegrity:sha(validation),receiptPath:'.creezio/packages/manifest-1.0.1.json',
    receiptIntegrity:sha(receiptBytes)};
  return {root,args,write,descriptor};
}

test('operator admission is read-only by default, writes verified metadata atomically, and never selects a module',t=>{
  const {root,args}=setup(t);
  const inventoryPath=path.join(root,'configuration','module-inventory.json');
  const activeLock=path.join(root,'.creezio','module-apply','active.json');
  const compositionPath=path.join(root,'configuration','composition.json');
  const beforeInventory=readFileSync(inventoryPath),beforeComposition=readFileSync(compositionPath);
  const simulated=admitExternalPackage(args);
  assert.equal(simulated.status,'would_admit');
  assert.deepEqual(readFileSync(inventoryPath),beforeInventory);
  const printed=[];
  const cli=['--module-id',args.moduleId,'--origin',args.origin,'--package-name',args.packageName,
    '--version',args.version,'--runtime',args.runtimePath,'--runtime-sha256',args.runtimeIntegrity,
    '--validation',args.validationPath,'--validation-sha256',args.validationIntegrity,
    '--receipt',args.receiptPath,'--receipt-sha256',args.receiptIntegrity];
  assert.equal(runModuleAdmitCli(cli,{cwd:root,stdout:value=>printed.push(value)}),0);
  assert.equal(JSON.parse(printed[0]).status,'would_admit');
  assert.deepEqual(readFileSync(inventoryPath),beforeInventory);
  assert.equal(runModuleAdmitCli([...cli,'--write'],{cwd:root,stdout:value=>printed.push(value)}),0);
  assert.equal(JSON.parse(printed[1]).status,'admitted');
  assert.equal(existsSync(activeLock),false);
  assert.deepEqual(readFileSync(compositionPath),beforeComposition);
  const declared=JSON.parse(readFileSync(inventoryPath,'utf8')).externalPackages;
  assert.equal(declared.length,1);
  assert.equal(declared[0].moduleId,args.moduleId);
  const loaded=loadRuntimeComposition({root});
  const candidate=externalPackageCandidate(root,declared[0],loaded.composition,loaded.lock,[args.origin]);
  assert.equal(candidate.candidateKey,simulated.candidateKey);
  assert.equal(loaded.composition.modules.length,0);
  assert.throws(()=>admitExternalPackage({...args,write:true}),{code:'candidate_collision'});
  assert.equal(JSON.parse(readFileSync(inventoryPath,'utf8')).externalPackages.length,1);
});

test('a newer candidate may reuse identical validation bytes and path',t=>{
  const {root,args,write,descriptor}=setup(t);
  assert.equal(admitExternalPackage({...args,write:true}).status,'admitted');
  const next=structuredClone(descriptor);
  next.identity.version='1.0.2';next.identity.source.revision='fixture-admit-v2';
  next.documentation.versionBinding.moduleVersion='1.0.2';
  next.documentation.versionBinding.sourceRevision='fixture-admit-v2';
  next.packaging.validationBinding.moduleVersion='1.0.2';
  next.packaging.validationBinding.sourceRevision='fixture-admit-v2';
  const pkg={name:args.packageName,version:'1.0.2',exports:Object.fromEntries(
    next.packaging.runtime.files.map(name=>[`./${name}`,`./${name}`]))};
  const runtime=deterministicModuleArchive(next.packaging.runtime.files.map(name=>({
    path:`package/${name}`,bytes:Buffer.from(name==='package.json'?JSON.stringify(pkg)
      :name==='module/manifest.json'?JSON.stringify(next):`runtime ${name}\n`)})));
  const validation=readFileSync(path.join(root,args.validationPath));
  const runtimePath='.creezio/packages/tasks-1.0.2.tgz',
    receiptPath='.creezio/packages/manifest-1.0.2.json';
  const receipt={schemaVersion:'1.0.0',module:{id:next.identity.id,
    origin:next.identity.origin,version:'1.0.2',source:next.identity.source},
    contractIntegrity:contractIntegrity(next),
    runtime:{integrity:sha(runtime),location:{kind:'local',path:runtimePath}},
    validation:{integrity:sha(validation),location:{kind:'local',path:args.validationPath}},
    policy:next.validation.policy};
  const receiptBytes=Buffer.from(`${JSON.stringify(receipt)}\n`);
  write(runtimePath,runtime);write(receiptPath,receiptBytes);
  const updated={...args,version:'1.0.2',runtimePath,runtimeIntegrity:sha(runtime),
    receiptPath,receiptIntegrity:sha(receiptBytes)};
  assert.equal(admitExternalPackage({...updated,write:true}).status,'admitted');
  const inventory=JSON.parse(readFileSync(path.join(root,'configuration','module-inventory.json'),'utf8'));
  assert.deepEqual(inventory.externalPackages.map(item=>item.version),['1.0.1','1.0.2']);
  assert.deepEqual(inventory.externalPackages.map(item=>item.validation),
    [inventory.externalPackages[0].validation,inventory.externalPackages[0].validation]);
});

test('an occupied admission lock is never removed and an oversized resulting inventory is refused',t=>{
  const {root,args,write}=setup(t),file=path.join(root,'configuration','module-inventory.json');
  const before=readFileSync(file),lock=path.join(root,'.creezio','module-apply','active.json');
  mkdirSync(path.dirname(lock),{recursive:true});
  const applyLock=JSON.stringify({schemaVersion:1,planId:'active-apply',
    planDigest:'sha256-'+'a'.repeat(64),pid:123});
  writeFileSync(lock,applyLock);
  assert.throws(()=>admitExternalPackage({...args,write:true}),{code:'inventory_locked'});
  assert.deepEqual(readFileSync(file),before);
  assert.equal(readFileSync(lock,'utf8'),applyLock);
  unlinkSync(lock);
  const config=JSON.parse(before);
  config.allowedOrigins.push(`https://example.invalid/${'x'.repeat(65100)}`);
  const large=Buffer.from(`${JSON.stringify(config)}\n`);
  assert.ok(large.length<64*1024);
  write('configuration/module-inventory.json',large);
  assert.throws(()=>admitExternalPackage({...args,write:true}),{code:'inventory_size'});
  assert.deepEqual(readFileSync(file),large);
  assert.equal(existsSync(lock),false);
});

test('admission refuses wrong trust, identity, version, bytes and paths before any write',t=>{
  const {root,args,write}=setup(t);
  const inventoryPath=path.join(root,'configuration','module-inventory.json');
  const before=readFileSync(inventoryPath);
  for(const change of [
    {origin:'https://example.invalid/untrusted'},
    {moduleId:'creezio.other'},
    {version:'1.0.0'},
    {runtimeIntegrity:'sha256-'+'0'.repeat(64)},
    {runtimePath:'../tasks-1.0.1.tgz'},
    {receiptPath:args.runtimePath},
  ]){
    assert.throws(()=>admitExternalPackage({...args,...change,write:true}));
    assert.deepEqual(readFileSync(inventoryPath),before);
  }
  write('package.json',JSON.stringify({dependencies:{[args.packageName]:'0.0.1'}}));
  assert.throws(()=>admitExternalPackage({...args,write:true}),{code:'package_collision'});
  write('package.json','{}');
  write('package-lock.json',JSON.stringify({packages:{[`node_modules/${args.packageName}`]:{version:'0.0.1'}}}));
  assert.throws(()=>admitExternalPackage({...args,write:true}),{code:'package_collision'});
  write('package-lock.json',JSON.stringify({packages:{}}));
  write('.creezio/packages/manifest-1.0.1.json','{"forged":true}\n');
  assert.throws(()=>admitExternalPackage({...args,write:true}),{code:'candidate_digest'});
  assert.deepEqual(readFileSync(inventoryPath),before);
});
