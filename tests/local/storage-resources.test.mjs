import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {loadLocalConfiguration,localWorkerConfiguration,assertLocalBuiltConfiguration} from '../../scripts/local/config.mjs';

const resources=[{contextId:'tenant-a',slot:1,status:'active',databaseId:'creezio-t33-a',
  databaseName:'creezio-t33-a',bucketName:'creezio-t33-a-files'},
  {contextId:'tenant-b',slot:2,status:'active',databaseId:'creezio-t33-b',
    databaseName:'creezio-t33-b',bucketName:'creezio-t33-b-files'}];

test('local configuration retains primary bindings and declares two separate storage pairs',()=>{
  const config=loadLocalConfiguration({storageResources:resources});
  const worker=localWorkerConfiguration(config);
  assert.deepEqual(worker.d1_databases.map(item=>item.binding),['DB','DB_RESOURCE_01','DB_RESOURCE_02']);
  assert.deepEqual(worker.r2_buckets.map(item=>item.binding),['BUCKET','BUCKET_RESOURCE_01','BUCKET_RESOURCE_02']);
  assertLocalBuiltConfiguration(worker,config);
  const identified=localWorkerConfiguration({...config,
    storageInstallationId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'});
  assert.equal(JSON.parse(identified.vars.CREEZIO_STORAGE_ROUTES).schemaVersion,2);
  assert.equal(JSON.parse(identified.vars.CREEZIO_STORAGE_ROUTES).storageInstallationId,
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.throws(()=>assertLocalBuiltConfiguration({...worker,r2_buckets:worker.r2_buckets.slice(0,2)},config));
  assert.throws(()=>loadLocalConfiguration({storageResources:[resources[0],
    {...resources[1],databaseId:resources[0].databaseId}]}));
  assert.throws(()=>loadLocalConfiguration({storageResources:[{...resources[0],
    bucketName:{toString:()=>resources[0].bucketName}}]}));
});

test('Miniflare keeps two D1 and R2 resources physically separate',async()=>{
  const worker=localWorkerConfiguration(loadLocalConfiguration({storageResources:resources}));
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404});}}',
    compatibilityDate:worker.compatibility_date,
    d1Databases:Object.fromEntries(worker.d1_databases.map(item=>[item.binding,item.database_id])),
    r2Buckets:Object.fromEntries(worker.r2_buckets.map(item=>[item.binding,item.bucket_name])),
    unsafeLocalExplorer:false,unsafeTriggerHandlers:false,telemetry:{enabled:false},
    logRequests:false,log:new Log(LogLevel.NONE)});
  try{
    const a=await runtime.getD1Database('DB_RESOURCE_01');
    const b=await runtime.getD1Database('DB_RESOURCE_02');
    await a.prepare('CREATE TABLE witness (id TEXT PRIMARY KEY, value TEXT)').run();
    await b.prepare('CREATE TABLE witness (id TEXT PRIMARY KEY, value TEXT)').run();
    await a.prepare('INSERT INTO witness (id,value) VALUES (?,?)').bind('same','a').run();
    await b.prepare('INSERT INTO witness (id,value) VALUES (?,?)').bind('same','b').run();
    assert.equal((await a.prepare('SELECT value FROM witness WHERE id=?').bind('same').first()).value,'a');
    assert.equal((await b.prepare('SELECT value FROM witness WHERE id=?').bind('same').first()).value,'b');
    const first=await runtime.getR2Bucket('BUCKET_RESOURCE_01');
    const second=await runtime.getR2Bucket('BUCKET_RESOURCE_02');
    await first.put('same.txt','a');await second.put('same.txt','b');
    assert.equal(await (await first.get('same.txt')).text(),'a');
    assert.equal(await (await second.get('same.txt')).text(),'b');
  }finally{await runtime.dispose();}
});
