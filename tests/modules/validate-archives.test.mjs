import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,rmdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseArchiveValidationArgs,assertArchiveValidationStage,inspectSdkTarEntries,
  packArchiveValidationArtifacts,runArchiveValidation,runClosedArchiveNode}
  from '../../scripts/modules/validate-archives.mjs';

const digest='a'.repeat(64);
test('closed archive CLI binds one SDK digest to selected module directories',()=>{
  const parsed=parseArchiveValidationArgs(['--sdk-archive','sdk.tgz','--sdk-sha256',digest,
    'extensions/native/pages-navigation','extensions/native/analytics']);
  assert.equal(parsed.sdkArchive,path.resolve('sdk.tgz'));
  assert.equal(parsed.sdkSha256,digest);
  assert.deepEqual(parsed.modules,['extensions/native/pages-navigation','extensions/native/analytics']);
  assert.throws(()=>parseArchiveValidationArgs(['--sdk-archive','sdk.tgz','--sdk-sha256','invalid',
    'extensions/native/analytics']),/SHA-256/);
  assert.throws(()=>parseArchiveValidationArgs(['--sdk-archive','sdk.tgz','--sdk-sha256',digest,
    'extensions/native/analytics','extensions/native/analytics']),/module list/);
  assert.throws(()=>parseArchiveValidationArgs(['--sdk-archive','sdk.tgz','--sdk-sha256',digest,
    'extensions/native/../crm']),/Unsupported module directory/);
});

test('cleanup guard confines the exact run and rejects the shared validation root',t=>{
  const temp=mkdtempSync(path.join(tmpdir(),'creezio-archive-guard-'));
  const base=path.join(temp,'archive-validation'),run=path.join(base,'run-1');
  mkdirSync(run,{recursive:true});
  const file=path.join(run,'proof.txt');writeFileSync(file,'test');
  t.after(()=>{unlinkSync(file);rmdirSync(run);rmdirSync(base);rmdirSync(temp);});
  assert.equal(assertArchiveValidationStage(run,base),run);
  assert.throws(()=>assertArchiveValidationStage(base,base),/Unsafe validation stage/);
  assert.throws(()=>assertArchiveValidationStage(temp,base),/Unsafe validation stage/);
  assert.throws(()=>assertArchiveValidationStage(path.join(temp,'other'),base),/Unsafe validation stage/);
});

test('wrong SDK digest refuses before creating an assembly',t=>{
  const temp=mkdtempSync(path.join(tmpdir(),'creezio-archive-digest-'));
  const fake=path.join(temp,'sdk.tgz');writeFileSync(fake,'not an archive');
  t.after(()=>{unlinkSync(fake);rmdirSync(temp);});
  assert.throws(()=>runArchiveValidation(['--sdk-archive',fake,'--sdk-sha256',digest,
    'extensions/native/pages-navigation']),/SDK archive digest mismatch/);
});

test('archive validation children and their descendants do not inherit ambient secrets',t=>{
  const stage=mkdtempSync(path.join(tmpdir(),'creezio-archive-child-env-'));
  const marker='CREEZIO_ARCHIVE_TEST_SECRET';
  const prior=process.env[marker];
  t.after(()=>{
    if(prior===undefined)delete process.env[marker];else process.env[marker]=prior;
    rmdirSync(path.join(stage,'child-tmp'));
    rmdirSync(stage);
  });
  process.env[marker]='sentinel-not-a-real-secret';
  const script=`const {execFileSync}=require('node:child_process');
    const nested=execFileSync(process.execPath,['-e','process.stdout.write(String(process.env.${marker}??"absent"))'],{encoding:'utf8'});
    process.stdout.write(JSON.stringify({direct:process.env.${marker}??'absent',nested,
      nodeOptions:process.env.NODE_OPTIONS??'absent',temporary:require('node:os').tmpdir()}));`;
  const observed=JSON.parse(runClosedArchiveNode(stage,['-e',script],
    {cwd:stage,encoding:'utf8',timeout:10000}));
  assert.deepEqual({direct:observed.direct,nested:observed.nested,nodeOptions:observed.nodeOptions},
    {direct:'absent',nested:'absent',nodeOptions:'absent'});
  assert.equal(observed.temporary,path.join(stage,'child-tmp'));
});

test('closed validation packs deterministic runtime and validation archives on an empty cache',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'creezio-archive-empty-cache-'));
  const moduleDirectory=path.join(root,'module-source');
  const file=path.join(moduleDirectory,'module','manifest.json');
  const descriptor={identity:{id:'sample'},packaging:{
    runtime:{files:['module/manifest.json']},validation:{files:['module/manifest.json']}}};
  mkdirSync(path.dirname(file),{recursive:true});
  writeFileSync(file,`${JSON.stringify(descriptor)}\n`);
  const cache=path.join(root,'.creezio','module-artifacts','sample');
  let packed;
  t.after(()=>{
    if(packed){
      unlinkSync(path.join(root,...packed.runtime.path.split('/')));
      unlinkSync(path.join(root,...packed.validation.path.split('/')));
      rmdirSync(cache);
      rmdirSync(path.dirname(cache));
      rmdirSync(path.join(root,'.creezio'));
    }
    unlinkSync(file);rmdirSync(path.dirname(file));rmdirSync(moduleDirectory);rmdirSync(root);
  });
  assert.equal(existsSync(cache),false);
  packed=packArchiveValidationArtifacts({root,moduleDirectory,descriptor});
  assert.ok(existsSync(path.join(root,...packed.runtime.path.split('/'))));
  assert.ok(existsSync(path.join(root,...packed.validation.path.split('/'))));
  assert.deepEqual(packArchiveValidationArtifacts({root,moduleDirectory,descriptor}).runtime,packed.runtime);
  assert.deepEqual(packArchiveValidationArtifacts({root,moduleDirectory,descriptor}).validation,packed.validation);
});

test('SDK tar inventory refuses traversal and non-file links before extraction',()=>{
  const files='package/package.json\npackage/dist/index.js\n';
  const regular='-rw-r--r-- package/package.json\n-rw-r--r-- package/dist/index.js\n';
  assert.equal(inspectSdkTarEntries(files,regular),2);
  assert.throws(()=>inspectSdkTarEntries('package/package.json\npackage/../escape\n',regular),
    /entry refused/);
  assert.throws(()=>inspectSdkTarEntries(files,
    '-rw-r--r-- package/package.json\nlrwxrwxrwx package/dist/index.js\n'),/entry refused/);
  assert.throws(()=>inspectSdkTarEntries('package/package.json\npackage/package.json\n',regular),
    /inventory refused/);
});
