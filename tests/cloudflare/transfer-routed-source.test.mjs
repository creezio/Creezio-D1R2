import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {createStorageInstallationIdentity,createLocalStorageInventory} from '../../scripts/local/storage-installation.mjs';
import {openLocalStoragePair} from '../../scripts/local/database.mjs';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema} from '../../scripts/data/apply-schema.mjs';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {captureLocalTransfer,captureLocalTransferGroup,loadCapturedTransfer,readCapturedTable}
  from '../../scripts/cloudflare/transfer/source.ts';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const plan=await loadCompositionSchema({root:repository,
  compositionPath:'configuration/composition.widgets-local.json'});
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
});
