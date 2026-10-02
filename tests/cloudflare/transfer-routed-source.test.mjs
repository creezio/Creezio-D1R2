import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {createStorageInstallationIdentity,createLocalStorageInventory} from '../../scripts/local/storage-installation.mjs';
import {openLocalStoragePair} from '../../scripts/local/database.mjs';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema} from '../../scripts/data/apply-schema.mjs';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {captureLocalTransfer,captureLocalTransferGroup,loadCapturedTransfer,readCapturedTable}
  from '../../scripts/cloudflare/transfer/source.ts';
import {createFileTransferJournal} from '../../scripts/cloudflare/transfer/journal.ts';
import {importCapturedTransfer,verifyCapturedTransfer} from '../../scripts/cloudflare/transfer/destination.ts';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const plan=await loadCompositionSchema({root:repository,
  compositionPath:'configuration/composition.widgets-local.json'});
const targetPlan=await loadCompositionSchema({root:repository,
  compositionPath:'configuration/composition.widgets-sites.json'});
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;

test('routed capture preserves its pair and imports only a denied route snapshot',
  {timeout:90000},async t=>{
  const root=temporaryDirectory(t,'creezio-routed-capture-');
  mkdirSync(path.join(root,'.openai'));
  writeFileSync(path.join(root,'.openai','hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
  const installationId=createStorageInstallationIdentity(root);
  const resources=[{
    contextId:'tenant-a',slot:1,status:'active',databaseId:'tenant-a-d1',
    databaseName:'tenant-a-db',bucketName:'tenant-a-files'}];
  createLocalStorageInventory(root,{schemaVersion:1,storageInstallationId:installationId,resources});
  const config=loadLocalConfiguration({root,storageAuthority:true,storageResources:resources});
  const store=await openLocalStoragePair(config,'tenant-a');
  try{
    const applied=await applyCompositionSchema(store.db,plan,
      {expectedPlanDigest:plan.planDigest});
    assert.equal(applied.ok,true,JSON.stringify(applied));
    await store.db.prepare(`INSERT INTO ${routes}
      (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
      VALUES ('tenant-a',?,1,3,'active',NULL,2,0)`).bind(installationId).run();
    await store.bucket.put('tenant-a/file',new TextEncoder().encode('target-content'));
  }finally{await store.dispose();}
  const transferId='routed-capture-one',directory=path.join(root,'.wrangler','transfers',transferId);
  const target={accountId:'account-one',workerName:'creezio-t33',
    databaseId:'remote-tenant-a',bucketName:'remote-tenant-a-files',
    origin:'https://example.workers.dev'};
  const captured=await captureLocalTransfer({config,plan,transferId,sourceSha:'a'.repeat(40),
    target,directory,sourceContextId:'tenant-a',secretSelections:[]});
  const fence=captured.manifest.identity.routeFence;
  assert.deepEqual({contextId:fence.contextId,installationId:fence.installationId,
    slot:fence.slot,expectedGeneration:fence.expectedGeneration},
    {contextId:'tenant-a',installationId,slot:1,expectedGeneration:3});
  assert.equal(captured.manifest.identity.sourceContextId,'tenant-a');
  const routeTable=captured.manifest.tables.find(item=>item.table===STORAGE_AUTHORITY_TABLES.storage_routes);
  assert.equal(routeTable.rowCount,1);
  const rows=[];
  for await(const row of readCapturedTable(captured.manifest,directory,routeTable.table))rows.push(row);
  const values=Object.fromEntries(routeTable.columns.map((column,index)=>[column,rows[0].values[index]?.value]));
  assert.equal(values.state,'deny');assert.equal(values.generation,4);
  assert.equal(values.mutation_id,fence.mutationId);
  assert.equal(captured.manifest.objects.count,1);
  assert.equal((await loadCapturedTransfer({config,directory,transferId})).manifestDigest,
    captured.manifest.manifestDigest);
  const reopened=await openLocalStoragePair(config,'tenant-a');
  try{assert.equal((await reopened.db.prepare(`SELECT state,generation FROM ${routes}`).first()).state,
    'active');}
  finally{await reopened.dispose();}
  const primary=await openLocalStoragePair(config,'application');
  try{await applyCompositionSchema(primary.db,plan,{expectedPlanDigest:plan.planDigest});}
  finally{await primary.dispose();}
  const grouped=await captureLocalTransferGroup([
    {config,plan,transferId:'group-primary',sourceSha:'a'.repeat(40),
      target:{...target,databaseId:'remote-primary',bucketName:'remote-primary-files'},
      directory:path.join(root,'.wrangler','transfers','group-primary'),secretSelections:[]},
    {config,plan,transferId:'group-target',sourceSha:'a'.repeat(40),target,
      directory:path.join(root,'.wrangler','transfers','group-target'),
      sourceContextId:'tenant-a',secretSelections:[]}]);
  assert.equal(grouped.length,2);
  assert.equal(grouped[0].manifest.identity.sourceContextId,undefined);
  assert.equal(grouped[1].manifest.identity.sourceContextId,'tenant-a');
  const journalDirectory=path.join(root,'.wrangler','delivery');
  mkdirSync(journalDirectory,{recursive:true});
  const journal=createFileTransferJournal(journalDirectory);
  for(const capture of grouped){
    const checkpoint={schemaVersion:1,revision:1,identity:capture.manifest.identity,
      manifestDigest:capture.manifest.manifestDigest,phase:'captured',tableCursor:null,
      objectCursor:null,multipart:null,targetSchemaReceiptId:null,targetDeploymentId:null};
    await journal.create(checkpoint);
    assert.deepEqual(await journal.load(capture.manifest.identity.transferId),checkpoint);
  }
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    compatibilityDate:'2026-05-15',d1Databases:{DB:'routed-destination'},d1Persist:false,
    script:'export default {fetch(){return new Response(null,{status:404})}}'});
  t.after(async()=>{await runtime.dispose();});
  const db=await runtime.getD1Database('DB');
  assert.equal((await applyCompositionSchema(db,targetPlan,
    {expectedPlanDigest:targetPlan.planDigest})).ok,true);
  const saved=new Map();let uploads=0;
  const objects={
    async inspectObject(entry){
      const bytes=saved.get(entry.key);
      if(!bytes)return 'absent';
      return createHash('sha256').update(bytes).digest('hex')===entry.sha256
        &&bytes.length===entry.size?'matching':'conflict';
    },
    async putObjectIfAbsent(entry,source){
      if(saved.has(entry.key))return 'unknown';
      const chunks=[];for await(const chunk of source)chunks.push(Buffer.from(chunk));
      saved.set(entry.key,Buffer.concat(chunks));uploads++;return 'created';
    },
    async *listObjectKeys(){for(const key of saved.keys())yield key;},
  };
  const routed=grouped[1],args={config,directory:path.join(root,'.wrangler','transfers',
    'group-target'),manifest:routed.manifest,targetPlan,db,objects,journal,
    expectedTarget:target,expectedContextId:'tenant-a'};
  const verified=await importCapturedTransfer(args);
  assert.equal(verified.phase,'verified');
  assert.equal(uploads,1);
  assert.equal((await verifyCapturedTransfer(args)).ok,true);
  const repeated=await importCapturedTransfer(args);
  assert.equal(repeated.revision,verified.revision);
  assert.equal(uploads,1);
  assert.equal((await journal.load('group-primary')).revision,1);
  assert.equal((await db.prepare(`SELECT state,generation FROM ${routes} WHERE id='tenant-a'`)
    .first()).state,'deny');
});
