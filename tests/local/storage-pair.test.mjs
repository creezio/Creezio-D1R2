import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {createStorageInstallationIdentity,createLocalStorageInventory} from '../../scripts/local/storage-installation.mjs';
import {openLocalStorage,openLocalStoragePair} from '../../scripts/local/database.mjs';

test('explicit local pair selects only an active context and preserves the primary alias',
  {timeout:60000},async()=>{
  const base=path.resolve(tmpdir()),root=mkdtempSync(path.join(base,'creezio-pair-'));
  assert.equal(path.dirname(root),base);
  const opened=[];
  try{
    mkdirSync(path.join(root,'.openai'));
    writeFileSync(path.join(root,'.openai','hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
    const legacy=await openLocalStorage(loadLocalConfiguration({root}));opened.push(legacy);
    assert.ok(legacy.db&&legacy.bucket,'v1 primary opens without a resource inventory');
    const resources=[{contextId:'tenant-a',slot:1,status:'active',databaseId:'pair-a',
      databaseName:'pair-a',bucketName:'pair-a-files'},
    {contextId:'tenant-b',slot:2,status:'revoked',databaseId:'pair-b',
      databaseName:'pair-b',bucketName:'pair-b-files'}];
    const installationId=createStorageInstallationIdentity(root);
    createLocalStorageInventory(root,{schemaVersion:1,storageInstallationId:installationId,resources});
    const config=loadLocalConfiguration({root,storageResources:resources,storageAuthority:true});
    assert.equal(config.storageInstallationId,installationId);
    const primary=await openLocalStorage(config);opened.push(primary);
    const alias=await openLocalStoragePair(config);opened.push(alias);
    const tenant=await openLocalStoragePair(config,'tenant-a');opened.push(tenant);
    await primary.db.prepare('CREATE TABLE witness (value TEXT)').run();
    await primary.db.prepare("INSERT INTO witness VALUES ('primary')").run();
    await tenant.db.prepare('CREATE TABLE witness (value TEXT)').run();
    await tenant.db.prepare("INSERT INTO witness VALUES ('tenant')").run();
    assert.equal((await alias.db.prepare('SELECT value FROM witness').first()).value,'primary');
    assert.equal((await tenant.db.prepare('SELECT value FROM witness').first()).value,'tenant');
    await primary.bucket.put('same.txt','primary');await tenant.bucket.put('same.txt','tenant');
    assert.equal(await (await alias.bucket.get('same.txt')).text(),'primary');
    assert.equal(await (await tenant.bucket.get('same.txt')).text(),'tenant');
    await assert.rejects(openLocalStoragePair(config,'tenant-b'),{code:'local_path'});
    await assert.rejects(openLocalStoragePair(config,'missing'),{code:'local_path'});
    const identity=path.join(root,'.wrangler','storage-installation.json');
    const saved=readFileSync(identity,'utf8');
    writeFileSync(identity,JSON.stringify({schemaVersion:1,
      storageInstallationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})+'\n');
    await assert.rejects(openLocalStoragePair(config,'tenant-a'),/Invalid local storage inventory/);
    writeFileSync(identity,saved);
  }finally{
    for(const connection of opened.reverse())await connection.dispose();
    assert.equal(lstatSync(root).isSymbolicLink(),false);
    rmSync(root,{recursive:true,force:false});
  }
});
