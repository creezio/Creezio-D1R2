import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,
  rmdirSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {loadLocalConfiguration,localWorkerConfiguration,assertLocalBuiltConfiguration}
  from '../../scripts/local/config.mjs';
import {initializeLocalStorageInventory} from '../../scripts/local/storage-configuration.mjs';
import {createStorageInstallationIdentity} from '../../scripts/local/storage-installation.mjs';
import {acquireLocalRuntimeLock} from '../../scripts/local/lock.mjs';
import {runLockedLocalRuntime} from '../../scripts/run-framework.mjs';

const resources=[{contextId:'tenant-a',slot:1,status:'active',databaseId:'tenant-a-db',
  databaseName:'tenant-a-db',bucketName:'tenant-a-files'},
{contextId:'tenant-b',slot:2,status:'active',databaseId:'tenant-b-db',
  databaseName:'tenant-b-db',bucketName:'tenant-b-files'}];
function fixture(t){
  const parent=realpathSync(tmpdir()),root=mkdtempSync(path.join(parent,'creezio-inventory-'));
  assert.equal(path.dirname(root),parent);
  mkdirSync(path.join(root,'.openai'));
  writeFileSync(path.join(root,'.openai','hosting.json'),'{"d1":"DB","r2":"BUCKET"}\n');
  const input=path.join(root,'operator-inventory.json');
  writeFileSync(input,JSON.stringify({schemaVersion:1,resources})+'\n');
  t.after(()=>{
    const stat=lstatSync(root);
    assert.equal(stat.isDirectory()&&!stat.isSymbolicLink(),true);
    rmSync(root,{recursive:true,force:false});
  });
  const io={interactive:true,write(){},async confirm(){return true;}};
  return {root,input,io};
}

test('absent inventory preserves v1; explicit initialization persists two exact pairs',async t=>{
  const f=fixture(t),before=loadLocalConfiguration({root:f.root});
  assert.equal(before.storageInstallationId,null);
  assert.deepEqual(before.storageResources,[]);
  assert.equal(localWorkerConfiguration(before).vars.CREEZIO_STORAGE_ROUTES,undefined);
  const result=await initializeLocalStorageInventory({root:f.root,inventoryPath:f.input,io:f.io});
  assert.deepEqual({ok:result.ok,code:result.code,effect:result.effect,resources:result.resources},
    {ok:true,code:'initialized',effect:'confirmed',resources:2});
  const file=path.join(f.root,'.wrangler','storage-resources.json');
  const bytes=readFileSync(file,'utf8'),identity=readFileSync(path.join(f.root,'.wrangler','storage-installation.json'),'utf8');
  const config=loadLocalConfiguration({root:f.root});
  assert.equal(config.storageInstallationId,result.storageInstallationId);
  assert.deepEqual(config.storageResources,resources);
  const worker=localWorkerConfiguration(config);
  assert.deepEqual(worker.d1_databases.map(item=>item.binding),['DB','DB_RESOURCE_01','DB_RESOURCE_02']);
  assert.deepEqual(worker.r2_buckets.map(item=>item.binding),['BUCKET','BUCKET_RESOURCE_01','BUCKET_RESOURCE_02']);
  assert.equal(JSON.parse(worker.vars.CREEZIO_STORAGE_ROUTES).storageInstallationId,result.storageInstallationId);
  assertLocalBuiltConfiguration(worker,config);
  assert.throws(()=>assertLocalBuiltConfiguration({...worker,r2_buckets:worker.r2_buckets.slice(0,2)},config));
  assert.throws(()=>localWorkerConfiguration(before),/inventory differs/i);
  assert.throws(()=>loadLocalConfiguration({root:f.root,storageAuthority:false}),/inventory differs/i);
  assert.throws(()=>loadLocalConfiguration({root:f.root,storageResources:[resources[1],resources[0]]}),/inventory differs/i);
  assert.deepEqual(loadLocalConfiguration({root:f.root,storageResources:resources,storageAuthority:true}).storageResources,resources);
  assert.equal((await initializeLocalStorageInventory({root:f.root,inventoryPath:f.input,io:f.io})).code,'inventory_exists');
  assert.equal(readFileSync(file,'utf8'),bytes);
  assert.equal(readFileSync(path.join(f.root,'.wrangler','storage-installation.json'),'utf8'),identity);
});

test('cancel and changed operator input make no inventory or physical identity',async t=>{
  const f=fixture(t);
  const cancelled=await initializeLocalStorageInventory({root:f.root,inventoryPath:f.input,
    io:{...f.io,async confirm(){return false;}}});
  assert.equal(cancelled.code,'cancelled');
  const changed=await initializeLocalStorageInventory({root:f.root,inventoryPath:f.input,io:f.io,
    lock:async(config,purpose)=>{
      writeFileSync(f.input,JSON.stringify({schemaVersion:1,resources:[resources[0]]})+'\n');
      return acquireLocalRuntimeLock(config,purpose);
    }});
  assert.deepEqual({code:changed.code,effect:changed.effect},{code:'source_changed',effect:'none'});
  assert.equal(existsSync(path.join(f.root,'.wrangler','storage-resources.json')),false);
  assert.equal(existsSync(path.join(f.root,'.wrangler','storage-installation.json')),false);
  assert.equal(existsSync(path.join(f.root,'.wrangler','creezio-local.lock')),false);
});

test('identity without inventory refuses startup and a second initialization instead of reverting to v1',async t=>{
  const f=fixture(t),id=createStorageInstallationIdentity(f.root);
  const identity=path.join(f.root,'.wrangler','storage-installation.json');
  const bytes=readFileSync(identity,'utf8');
  assert.match(id,/^[a-f0-9-]{36}$/);
  assert.throws(()=>loadLocalConfiguration({root:f.root}),/inventory missing/i);
  assert.deepEqual(await initializeLocalStorageInventory({root:f.root,inventoryPath:f.input,io:f.io}),
    {ok:false,code:'inventory_unavailable',effect:'none'});
  assert.equal(readFileSync(identity,'utf8'),bytes);
  assert.equal(existsSync(path.join(f.root,'.wrangler','storage-resources.json')),false);
});

test('malformed or foreign inventory and unsafe links fail closed',async t=>{
  const f=fixture(t),directory=path.join(f.root,'.wrangler');
  mkdirSync(directory);
  const inventory=path.join(directory,'storage-resources.json');
  writeFileSync(inventory,'');
  assert.throws(()=>loadLocalConfiguration({root:f.root}));
  const first=JSON.parse(readFileSync(f.input,'utf8'));
  writeFileSync(inventory,JSON.stringify({...first,
    storageInstallationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}));
  assert.throws(()=>loadLocalConfiguration({root:f.root}));
  unlinkSync(inventory);
  const external=path.join(f.root,'external');mkdirSync(external);
  rmdirSync(directory);
  symlinkSync(external,directory,process.platform==='win32'?'junction':'dir');
  try{assert.throws(()=>loadLocalConfiguration({root:f.root}));}
  finally{if(process.platform==='win32')rmdirSync(directory);else unlinkSync(directory);}
  mkdirSync(directory);
  writeFileSync(path.join(directory,'storage-installation.json'),'malformed');
  assert.throws(()=>loadLocalConfiguration({root:f.root}));
});

test('runtime start refuses a stale build and reads the persisted pair inventory without rewriting it',async t=>{
  const f=fixture(t),old=loadLocalConfiguration({root:f.root});
  const oldWorker=localWorkerConfiguration(old);
  const initialized=await initializeLocalStorageInventory({root:f.root,inventoryPath:f.input,io:f.io});
  assert.equal(initialized.ok,true);
  const config=loadLocalConfiguration({root:f.root});
  const dir=path.join(f.root,'dist','server');mkdirSync(dir,{recursive:true});
  const built=path.join(dir,'wrangler.json');
  writeFileSync(built,JSON.stringify(oldWorker));
  let spawned=0;
  const spawnChild=()=>{spawned++;const child=new EventEmitter();queueMicrotask(()=>child.emit('close',0,null));return child;};
  const options={spawnChild,startSandbox:async()=>({async close(){}})};
  await assert.rejects(runLockedLocalRuntime('start',config,options),/configuration differs/i);
  assert.equal(spawned,0);
  assert.equal(existsSync(path.join(f.root,'.wrangler','creezio-local.lock')),false);
  writeFileSync(built,JSON.stringify(localWorkerConfiguration(config)));
  const inventory=path.join(f.root,'.wrangler','storage-resources.json');
  const before=readFileSync(inventory,'utf8');
  assert.equal(await runLockedLocalRuntime('start',config,options),0);
  assert.equal(spawned,1);
  assert.equal(readFileSync(inventory,'utf8'),before);
  assert.equal(existsSync(path.join(f.root,'.wrangler','creezio-local.lock')),false);
});
