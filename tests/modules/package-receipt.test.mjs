import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {compositionCase,fixture} from '../contracts/helpers.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {deterministicModuleArchive} from '../../scripts/modules/archives.mjs';
import {externalPackageCandidate,mergeExternalPackageCandidates} from '../../scripts/build/compose-runtime.mjs';
import {solveModulePlan} from '../../sdk/modules/solver.mjs';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {verifyCandidatePackageReceipt,verifyPackageReceipt,PackageReceiptError}
  from '../../scripts/modules/package-receipt.mjs';

const sha=bytes=>`sha256-${createHash('sha256').update(bytes).digest('hex')}`;

test('a detached receipt binds real package bytes and rejects archive or installation tampering',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'creezio-receipt-'));
  const files=new Set(),directories=new Set([root]);
  const write=(relative,bytes)=>{
    const absolute=path.join(root,...relative.split('/'));
    let cursor=root;
    for(const part of path.relative(root,path.dirname(absolute)).split(path.sep).filter(Boolean)){
      cursor=path.join(cursor,part);mkdirSync(cursor,{recursive:true});directories.add(cursor);
    }
    writeFileSync(absolute,bytes);files.add(absolute);
  };
  t.after(()=>{
    for(const file of files)if(existsSync(file))unlinkSync(file);
    for(const directory of [...directories].sort((a,b)=>b.length-a.length))if(existsSync(directory))rmdirSync(directory);
  });
  const descriptor=fixture(),moduleDirectory=path.join(root,'node_modules','creezio.tasks');
  const runtimeFiles=descriptor.packaging.runtime.files.map(name=>{
    const bytes=Buffer.from(`runtime ${name}\n`);
    write(`node_modules/creezio.tasks/${name}`,bytes);
    return {path:`package/${name}`,bytes};
  });
  const validationFiles=descriptor.packaging.validation.files.map(name=>({path:name,bytes:Buffer.from(`test ${name}\n`)}));
  const runtime=deterministicModuleArchive(runtimeFiles),validation=deterministicModuleArchive(validationFiles);
  const receipt={schemaVersion:'1.0.0',module:{id:descriptor.identity.id,origin:descriptor.identity.origin,
    version:descriptor.identity.version,source:descriptor.identity.source},
    contractIntegrity:contractIntegrity(descriptor),
    runtime:{integrity:sha(runtime),location:{kind:'local',path:'.creezio/packages/runtime.tgz'}},
    validation:{integrity:sha(validation),location:{kind:'local',path:'.creezio/packages/validation.tgz'}},
    policy:descriptor.validation.policy};
  write('.creezio/packages/runtime.tgz',runtime);
  write('.creezio/packages/validation.tgz',validation);
  write('.creezio/packages/manifest.json',`${JSON.stringify(receipt)}\n`);
  const verify=()=>verifyPackageReceipt({root,receiptPath:'.creezio/packages/manifest.json',moduleDirectory,descriptor});
  assert.deepEqual(verify().validation,{integrity:sha(validation),path:'.creezio/packages/validation.tgz'});
  const installed=path.join(moduleDirectory,...descriptor.packaging.runtime.files[0].split('/'));
  const original=readFileSync(installed);
  writeFileSync(installed,'tampered runtime');
  assert.throws(verify,error=>error instanceof PackageReceiptError&&error.code==='installed_runtime');
  writeFileSync(installed,original);
  const bad=Buffer.from(validation);bad[bad.length-1]^=1;
  writeFileSync(path.join(root,'.creezio','packages','validation.tgz'),bad);
  assert.throws(verify,error=>error instanceof PackageReceiptError&&error.code==='receipt_integrity');
  writeFileSync(path.join(root,'.creezio','packages','validation.tgz'),validation);
  const extra=deterministicModuleArchive([...validationFiles,{path:'tests/hidden.js',bytes:Buffer.from('extra')}]);
  writeFileSync(path.join(root,'.creezio','packages','validation.tgz'),extra);
  receipt.validation.integrity=sha(extra);
  writeFileSync(path.join(root,'.creezio','packages','manifest.json'),`${JSON.stringify(receipt)}\n`);
  assert.throws(verify,error=>error instanceof PackageReceiptError&&error.code==='archive_inventory');
});

test('an external candidate is previewed beside the unchanged selected version',t=>{
  const installed=fixture(),updated=structuredClone(installed);
  updated.identity.version='1.0.1';
  updated.identity.source.revision='fixture-v2';
  updated.documentation.versionBinding.moduleVersion='1.0.1';
  updated.documentation.versionBinding.sourceRevision='fixture-v2';
  updated.packaging.validationBinding.moduleVersion='1.0.1';
  updated.packaging.validationBinding.sourceRevision='fixture-v2';
  updated.packaging.runtime.files.push('package.json');
  const packageName='@creezio/tasks';
  const packageJson={name:packageName,version:'1.0.1',
    exports:Object.fromEntries(updated.packaging.runtime.files.map(name=>[`./${name}`,`./${name}`]))};
  const runtimeFor=pkg=>deterministicModuleArchive(updated.packaging.runtime.files.map(name=>({
    path:`package/${name}`,bytes:Buffer.from(name==='package.json'
      ?JSON.stringify(pkg)
      :name==='module/manifest.json'?JSON.stringify(updated)
      :name.includes('entry.server')?'throw new Error("candidate code was evaluated");\n'
      :`runtime ${name}\n`),
  })));
  const runtime=runtimeFor(packageJson);
  const validation=deterministicModuleArchive(updated.packaging.validation.files.map(name=>({
    path:name,bytes:Buffer.from(`validation ${name}\n`),
  })));
  const receipt={schemaVersion:'1.0.0',module:{id:updated.identity.id,
    origin:updated.identity.origin,version:'1.0.1',source:updated.identity.source},
    contractIntegrity:contractIntegrity(updated),
    runtime:{integrity:sha(runtime),location:{kind:'local',path:'.creezio/packages/tasks-1.0.1.tgz'}},
    validation:{integrity:sha(validation),location:{kind:'local',
      path:'.creezio/packages/tasks-1.0.1-validation.tgz'}},policy:updated.validation.policy};
  const receiptBytes=Buffer.from(`${JSON.stringify(receipt)}\n`);
  const base=compositionCase([installed]);
  base.composition.modules[0].source={kind:'package',name:packageName};
  base.lock.compositionIntegrity=contractIntegrity(base.composition);
  base.lock.modules[0].validation.location.path='.creezio/packages/tasks-1.0.0-validation.tgz';
  const current={...base,descriptors:base.modules,revision:3};
  const before=structuredClone(current);
  const input={currentNode:current.lock.modules[0],packageName,version:'1.0.1',
    allowedOrigins:[updated.identity.origin],runtimeBytes:runtime,validationBytes:validation,
    receiptBytes,expected:{runtime:sha(runtime),validation:sha(validation),receipt:sha(receiptBytes)}};
  const candidate=verifyCandidatePackageReceipt(input);
  for(const badPackage of [
    {name:packageName,version:'1.0.1'},
    {...packageJson,exports:Object.fromEntries(Object.entries(packageJson.exports)
      .filter(([name])=>name!=='./ui/workspace/tasks.ts'))},
  ]){
    const badRuntime=runtimeFor(badPackage);
    const badReceipt={...receipt,runtime:{...receipt.runtime,integrity:sha(badRuntime)}};
    const badReceiptBytes=Buffer.from(`${JSON.stringify(badReceipt)}\n`);
    assert.throws(()=>verifyCandidatePackageReceipt({...input,runtimeBytes:badRuntime,
      receiptBytes:badReceiptBytes,expected:{runtime:sha(badRuntime),validation:sha(validation),
        receipt:sha(badReceiptBytes)}}),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_exports');
  }
  const externalRoot=temporaryDirectory(t,'creezio-candidate-');
  const externalDirectory=path.join(externalRoot,'.creezio','packages');
  mkdirSync(externalDirectory,{recursive:true});
  const files=[['runtime.tgz',runtime],['validation.tgz',validation],['receipt.json',receiptBytes]];
  for(const [name,bytes] of files)writeFileSync(path.join(externalDirectory,name),bytes);
  const external={moduleId:updated.identity.id,packageName,version:'1.0.1',
    runtime:{path:'.creezio/packages/runtime.tgz',integrity:sha(runtime)},
    validation:{path:'.creezio/packages/validation.tgz',integrity:sha(validation)},
    receipt:{path:'.creezio/packages/receipt.json',integrity:sha(receiptBytes)}};
  assert.deepEqual(externalPackageCandidate(externalRoot,external,base.composition,base.lock,
    [updated.identity.origin]),candidate);
  assert.throws(()=>externalPackageCandidate(externalRoot,{...external,
    receipt:{...external.receipt,path:external.runtime.path}},base.composition,base.lock,
  [updated.identity.origin]),{code:'inventory.external-package'});
  assert.throws(()=>externalPackageCandidate(externalRoot,{...external,version:'1.0.0'},
    base.composition,base.lock,[updated.identity.origin]),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_input');
  writeFileSync(path.join(externalDirectory,'runtime.tgz'),Buffer.concat([runtime,Buffer.from('x')]));
  assert.throws(()=>externalPackageCandidate(externalRoot,external,base.composition,base.lock,
    [updated.identity.origin]),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_digest');
  writeFileSync(path.join(externalDirectory,'runtime.tgz'),runtime);
  assert.equal(candidate.version,'1.0.1');
  assert.equal(candidate.source.kind,'package');
  assert.equal(candidate.lockNode.runtime.location.path,
    `.creezio/module-artifacts/${updated.identity.id}/runtime-${candidate.lockNode.runtime.integrity.slice(7)}.tgz`);
  assert.equal(candidate.lockNode.validation.location.path,
    `.creezio/module-artifacts/${updated.identity.id}/validation-${sha(validation).slice(7)}.tgz`);
  assert.notEqual(candidate.lockNode.runtime.location.path,receipt.runtime.location.path);
  assert.notEqual(candidate.lockNode.validation.location.path,receipt.validation.location.path);
  assert.notEqual(candidate.lockNode.runtime.location.path,current.lock.modules[0].runtime.location.path);
  assert.notEqual(candidate.lockNode.validation.location.path,current.lock.modules[0].validation.location.path);
  const aliasedReceipt={...receipt,runtime:{...receipt.runtime,
    location:structuredClone(current.lock.modules[0].runtime.location)}};
  const aliasedReceiptBytes=Buffer.from(`${JSON.stringify(aliasedReceipt)}\n`);
  const aliased=verifyCandidatePackageReceipt({...input,receiptBytes:aliasedReceiptBytes,
    expected:{...input.expected,receipt:sha(aliasedReceiptBytes)}});
  assert.equal(aliased.lockNode.runtime.location.path,candidate.lockNode.runtime.location.path);
  assert.notEqual(aliased.lockNode.runtime.location.path,current.lock.modules[0].runtime.location.path);
  const selectedCore={moduleId:installed.identity.id,origin:installed.identity.origin,
    version:installed.identity.version,source:base.composition.modules[0].source,
    descriptor:installed,lockNode:base.lock.modules[0]};
  const selected={candidateKey:contractIntegrity({moduleId:selectedCore.moduleId,
    origin:selectedCore.origin,version:selectedCore.version,source:selectedCore.source,
    contractIntegrity:selectedCore.lockNode.contractIntegrity,
    runtime:selectedCore.lockNode.runtime.integrity,
    validation:selectedCore.lockNode.validation.integrity}),...selectedCore};
  const inventory=mergeExternalPackageCandidates({root:externalRoot,composition:base.composition,
    lock:base.lock,installedInventory:{candidates:[selected]},externalPackages:[external],
    allowedOrigins:[updated.identity.origin]});
  assert.equal(inventory.candidates.length,2);
  assert.equal(inventory.digest,contractIntegrity({schemaVersion:1,candidates:inventory.candidates}));
  assert.throws(()=>mergeExternalPackageCandidates({root:externalRoot,composition:base.composition,
    lock:base.lock,installedInventory:{candidates:[selected]},externalPackages:[external,external],
    allowedOrigins:[updated.identity.origin]}),{code:'inventory.external-package'});
  const choices={schemaVersion:1,base:{revision:3,
    compositionDigest:contractIntegrity(current.composition),lockDigest:contractIntegrity(current.lock),
    inventoryDigest:inventory.digest},actions:[{kind:'update',moduleId:installed.identity.id,
    candidateKey:candidate.candidateKey}]};
  const plan=solveModulePlan(current,choices,inventory);
  assert.equal(plan.summary.status,'ready',JSON.stringify(plan.diagnostics));
  assert.equal(plan.next.lock.modules[0].version,'1.0.1');
  assert.equal(plan.next.composition.modules[0].source.name,packageName);
  assert.deepEqual(current,before);
  assert.throws(()=>verifyCandidatePackageReceipt({...input,version:'1.0.0'}),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_input');
  assert.throws(()=>verifyCandidatePackageReceipt({...input,allowedOrigins:[]}),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_identity');
  assert.throws(()=>verifyCandidatePackageReceipt({...input,currentNode:{...input.currentNode,
    validation:{location:{kind:'local',path:receipt.validation.location.path}}}}),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_receipt');
  assert.throws(()=>verifyCandidatePackageReceipt({...input,runtimeBytes:Buffer.concat([runtime,Buffer.from('x')])}),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_digest');
  assert.throws(()=>verifyCandidatePackageReceipt({...input,
    receiptBytes:Buffer.from(`${JSON.stringify({...receipt,contractIntegrity:sha('foreign')})}\n`)}),
    error=>error instanceof PackageReceiptError&&error.code==='candidate_digest');
});
