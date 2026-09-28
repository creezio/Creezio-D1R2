import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseArchiveValidationArgs,assertArchiveValidationStage,inspectSdkTarEntries,runArchiveValidation}
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
