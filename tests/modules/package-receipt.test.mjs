import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fixture} from '../contracts/helpers.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {deterministicModuleArchive} from '../../scripts/modules/archives.mjs';
import {verifyPackageReceipt,PackageReceiptError} from '../../scripts/modules/package-receipt.mjs';

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
