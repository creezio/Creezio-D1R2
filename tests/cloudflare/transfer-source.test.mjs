import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {openLocalStorage} from '../../scripts/local/database.mjs';
import {acquireLocalRuntimeLock} from '../../scripts/local/lock.mjs';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema} from '../../scripts/data/apply-schema.mjs';
import {createVaultKeyring,createVaultReference} from '../../core/vault/crypto.ts';
import {captureLocalTransfer,loadCapturedTransfer,readCapturedObjects,readCapturedTable}
  from '../../scripts/cloudflare/transfer/source.ts';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const plan=await loadCompositionSchema({root:repository,compositionPath:'configuration/composition.widgets-local.json'});
const target={accountId:'account-one',workerName:'creezio-t32',databaseId:'database-one',
  bucketName:'bucket-one',origin:'https://example.workers.dev'};
function fixture(t){
  const root=temporaryDirectory(t,'creezio-transfer-source-');
  mkdirSync(path.join(root,'.openai'));
  writeFileSync(path.join(root,'.openai','hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
  return loadLocalConfiguration({root});
}

test('capture refuses a model cycle or a copied child of an excluded model before creating a snapshot',
  async t=>{
    const config=fixture(t),transferId='unsafe-graph',directory=path.join(config.root,'.wrangler','transfers',transferId),
      request={config,transferId,sourceSha:'a'.repeat(40),target,directory,secretSelections:[]};
    const cyclic=structuredClone(plan),record=cyclic.runtimeCatalog.modules
      .find(item=>item.moduleId==='example.widgets-witness').models.find(item=>item.modelId==='record');
    record.model.relations.push({id:'self',fields:['id'],target:{moduleId:'example.widgets-witness',
      kind:'model',id:'record'},targetFields:['id'],onDelete:'restrict'});
    await assert.rejects(captureLocalTransfer({...request,plan:cyclic}),error=>error.code==='invalid_input');
    const excluded=structuredClone(plan),account=excluded.runtimeCatalog.modules
      .find(item=>item.moduleId==='creezio.access').models.find(item=>item.modelId==='human_accounts');
    account.model.relations.push({id:'unsupported-session',fields:['principal_id'],
      target:{moduleId:'creezio.access',kind:'model',id:'sessions'},targetFields:['id'],onDelete:'restrict'});
    await assert.rejects(captureLocalTransfer({...request,plan:excluded}),error=>error.code==='invalid_input');
    assert.equal(existsSync(directory),false);
  });

test('a real persistent Miniflare D1/R2 capture is immutable, checked and leaves source intact',
  {timeout:90000},async t=>{
    const config=fixture(t),transferId='capture-one',directory=path.join(config.root,'.wrangler','transfers',transferId),
      entry=plan.runtimeCatalog.modules.find(item=>item.moduleId==='example.widgets-witness').models
        .find(item=>item.modelId==='record');
    const store=await openLocalStorage(config);
    try{
      const applied=await applyCompositionSchema(store.db,plan,{expectedPlanDigest:plan.planDigest});
      assert.equal(applied.ok,true,JSON.stringify(applied));
      await store.db.prepare(`INSERT INTO "${entry.table}" (context_id,id,title,revision,internal_secret)
        VALUES (?,?,?,?,?)`).bind('application','record-one','Transferred record',1,'private-value').run();
      await store.bucket.put('creezio/files/v1/test-object',new TextEncoder().encode('r2-bytes'),
        {httpMetadata:{contentType:'application/octet-stream'},customMetadata:{source:'local'}});
    }finally{await store.dispose();}
    const request={config,plan,transferId,sourceSha:'a'.repeat(40),target,directory,secretSelections:[]};
    const captured=await captureLocalTransfer(request);
    await captured.release();await captured.release();
    assert.equal(captured.manifest.identity.planDigest,plan.planDigest);
    assert.equal(captured.manifest.objects.count,1);
    const table=captured.manifest.tables.find(item=>item.table===entry.table);
    assert.equal(table.rowCount,1);
    const rows=[];for await(const row of readCapturedTable(captured.manifest,directory,entry.table))rows.push(row);
    assert.equal(rows[0].values[2].value,'Transferred record');
    const objects=[];for await(const object of readCapturedObjects(captured.manifest,directory))objects.push(object);
    assert.equal(objects[0].key,'creezio/files/v1/test-object');
    assert.equal(objects[0].size,8);
    assert.equal((await loadCapturedTransfer({config,directory,transferId})).manifestDigest,
      captured.manifest.manifestDigest);
    assert.equal((await captureLocalTransfer(request)).manifest.manifestDigest,captured.manifest.manifestDigest);
    writeFileSync(path.join(directory,objects[0].bodyFile),'tampered');
    await assert.rejects(loadCapturedTransfer({config,directory,transferId}),error=>error.code==='integrity_error');
    const reopened=await openLocalStorage(config);
    try{
      assert.equal((await reopened.db.prepare(`SELECT title FROM "${entry.table}" WHERE id='record-one'`).first()).title,
        'Transferred record');
      assert.equal(await (await reopened.bucket.get('creezio/files/v1/test-object')).text(),'r2-bytes');
    }finally{await reopened.dispose();}
  });

test('the export lock refuses a second operator before reading storage',{timeout:30000},async t=>{
  const config=fixture(t),lease=await acquireLocalRuntimeLock(config,'export');
  try{
    await assert.rejects(captureLocalTransfer({config,plan,transferId:'busy-one',sourceSha:'a'.repeat(40),target,
      directory:path.join(config.root,'.wrangler','transfers','busy-one'),secretSelections:[]}),
    error=>error.code==='source_busy');
  }finally{await lease.release();}
});

test('active conversation state blocks capture without changing the source',{timeout:90000},async t=>{
  const config=fixture(t),store=await openLocalStorage(config);
  const table=plan.runtimeCatalog.modules.find(item=>item.moduleId==='creezio.conversations').models
    .find(item=>item.modelId==='conversation').table;
  try{
    assert.equal((await applyCompositionSchema(store.db,plan,{expectedPlanDigest:plan.planDigest})).ok,true);
    const at=new Date().toISOString();
    await store.db.prepare(`INSERT INTO "${table}"
      (context_id,owner_id,audience,id,title,mode,created_at,updated_at,archived_at,active_turn_id,revision)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind('application','owner-one','admin','conversation-one','Active',
      'chat',at,at,null,'turn-live',1).run();
  }finally{await store.dispose();}
  await assert.rejects(captureLocalTransfer({config,plan,transferId:'active-one',sourceSha:'a'.repeat(40),target,
    directory:path.join(config.root,'.wrangler','transfers','active-one'),secretSelections:[]}),
  error=>error.code==='active_effect');
  const reopened=await openLocalStorage(config);
  try{assert.equal((await reopened.db.prepare(`SELECT active_turn_id FROM "${table}" WHERE id='conversation-one'`).first())
    .active_turn_id,'turn-live');}finally{await reopened.dispose();}
});

test('selected provider secret is rekeyed; unselected connection is disabled',{timeout:90000},async t=>{
  const config=fixture(t),store=await openLocalStorage(config),reference=createVaultReference(),
    sourceKeyring=createVaultKeyring({activeKeyId:'local',keys:{local:new Uint8Array(32).fill(1)}}),
    targetKeyring=createVaultKeyring({activeKeyId:'remote',keys:{remote:new Uint8Array(32).fill(2)}}),
    bindingId='openai.responses.v1',contextId='application',
    vaultContext={moduleId:'creezio.openai',contextId,reference,bindingId,version:1};
  const provider=plan.runtimeCatalog.modules.find(item=>item.moduleId==='creezio.openai'),
    configTable=provider.models.find(item=>item.modelId==='provider_config').table,
    secretTable=provider.models.find(item=>item.modelId==='provider_secret').table;
  try{
    assert.equal((await applyCompositionSchema(store.db,plan,{expectedPlanDigest:plan.planDigest})).ok,true);
    const ciphertext=await sourceKeyring.seal(vaultContext,'synthetic-private-key');
    await store.db.prepare(`INSERT INTO "${secretTable}"
      (context_id,id,binding_id,ciphertext,key_id,version,state) VALUES (?,?,?,?,?,?,?)`)
      .bind(contextId,reference,bindingId,ciphertext,'local',1,'active').run();
    await store.db.prepare(`INSERT INTO "${configTable}"
      (context_id,id,model_id,api_key_ref,secret_version,enabled,revision,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .bind(contextId,bindingId,'gpt-test',reference,1,1,1,new Date().toISOString()).run();
  }finally{await store.dispose();}
  const selectedId='rekey-one',selectedDir=path.join(config.root,'.wrangler','transfers',selectedId);
  const selected=await captureLocalTransfer({config,plan,transferId:selectedId,sourceSha:'a'.repeat(40),target,
    directory:selectedDir,secretSelections:[{contextId,reference,bindingId,mode:'rewrap'}],sourceKeyring,targetKeyring});
  const secrets=[];for await(const row of readCapturedTable(selected.manifest,selectedDir,secretTable))secrets.push(row);
  const secretMeta=selected.manifest.tables.find(item=>item.table===secretTable),
    secret=Object.fromEntries(secretMeta.columns.map((name,index)=>[name,secrets[0].values[index]?.value]));
  assert.equal(secret.key_id,'remote');
  assert.equal(await targetKeyring.open(vaultContext,secret.ciphertext),'synthetic-private-key');
  await assert.rejects(sourceKeyring.open(vaultContext,secret.ciphertext));
  assert.equal(JSON.stringify(selected.manifest).includes('synthetic-private-key'),false);
  const disabledId='disabled-one',disabledDir=path.join(config.root,'.wrangler','transfers',disabledId),
    disabled=await captureLocalTransfer({config,plan,transferId:disabledId,sourceSha:'a'.repeat(40),target,
      directory:disabledDir,secretSelections:[]});
  const disabledSecret=disabled.manifest.tables.find(item=>item.table===secretTable);
  assert.equal(disabledSecret.sourceRowCount,1);assert.equal(disabledSecret.rowCount,0);
  const configs=[];for await(const row of readCapturedTable(disabled.manifest,disabledDir,configTable))configs.push(row);
  const configMeta=disabled.manifest.tables.find(item=>item.table===configTable),
    projected=Object.fromEntries(configMeta.columns.map((name,index)=>[name,configs[0].values[index]?.value??null]));
  assert.equal(projected.api_key_ref,null);assert.equal(projected.secret_version,null);
  assert.equal(projected.enabled,0);
});
