import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStorageInstallationIdentity,loadStorageInstallationIdentity}
  from '../../scripts/local/storage-installation.mjs';

test('operator creates one durable storage identity; reads and restarts never rotate it',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'creezio-storage-identity-'));
  const directory=path.join(root,'.wrangler'),file=path.join(directory,'storage-installation.json');
  try{
    assert.throws(()=>loadStorageInstallationIdentity(root),{code:'ENOENT'});
    assert.equal(existsSync(directory),false);
    const id=createStorageInstallationIdentity(root);
    assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(createStorageInstallationIdentity(root),id);
    assert.equal(loadStorageInstallationIdentity(root),id);
    const original=readFileSync(file,'utf8');
    writeFileSync(file,'{"schemaVersion":1,"storageInstallationId":"foreign"}\n');
    assert.throws(()=>createStorageInstallationIdentity(root),/Invalid storage installation identity/);
    assert.notEqual(readFileSync(file,'utf8'),original);
  }finally{
    if(existsSync(file))unlinkSync(file);
    if(existsSync(directory))rmdirSync(directory);
    rmdirSync(root);
  }
});
