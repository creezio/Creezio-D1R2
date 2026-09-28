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
function table(moduleId,modelId){
  return [plan.host,...plan.runtimeCatalog.modules].find(group=>group.moduleId===moduleId)
    .models.find(model=>model.modelId===modelId).table;
}
async function seedQuietUnknown(db){
  const now=Date.now(),at=new Date(now-60_000).toISOString();
  const executionId='execution-quiet',turnId='turn-quiet',conversationId='conversation-quiet',
    owner='owner-one',actor='owner-one',context='application',audience='admin',nonce='claim-quiet';
  await db.prepare(`INSERT INTO "${table('creezio.conversations','conversation')}"
    (context_id,owner_id,audience,id,title,mode,created_at,updated_at,archived_at,active_turn_id,revision)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(context,owner,audience,conversationId,'Quiet uncertainty','chat',at,at,null,turnId,2).run();
  await db.prepare(`INSERT INTO "${table('creezio.conversations','turn')}"
    (context_id,owner_id,audience,conversation_id,id,state,provider_id,created_at,updated_at,
      revision,last_sequence,error_code,widget_context_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(context,owner,audience,conversationId,turnId,'unknown','openai.responses.v1',at,at,
      2,2,'provider_unknown',null).run();
  await db.prepare(`INSERT INTO "${table('creezio.conversations','message')}"
    (context_id,owner_id,audience,conversation_id,id,role,body,content,created_at,revision)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(context,owner,audience,conversationId,'message-quiet','user','Uncertain request',null,at,1).run();
  for(const [sequence,kind,payload] of [[1,'queued',{modelId:'gpt-4o'}],[2,'unknown',{}]]){
    await db.prepare(`INSERT INTO "${table('creezio.conversations','event')}"
      (context_id,owner_id,audience,conversation_id,turn_id,sequence,kind,payload,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(context,owner,audience,conversationId,turnId,sequence,kind,JSON.stringify(payload),at).run();
  }
  await db.prepare(`INSERT INTO "${table('creezio.runtime','executions')}"
    (id,scope_hash,input_hash,module_id,operation_id,operation_version,actor_principal_id,
      principal_id,context_id,audience,state,output,error_code,claim_nonce,attempt_number,
      created_at_ms,updated_at_ms,claim_expires_at_ms,retained_until_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(executionId,'sha256:'+'a'.repeat(64),'sha256:'+'b'.repeat(64),'creezio.conversations',
      'turn.start','sha256-'+'c'.repeat(64),actor,owner,context,audience,'unknown',
      JSON.stringify({turn:{id:turnId,conversationId},
        message:{id:'message-quiet',conversationId,role:'user',body:'Uncertain request'}}),null,nonce,1,
      now-60_000,now-30_000,now-10_000,now+86_400_000).run();
  await db.prepare(`INSERT INTO "${table('creezio.runtime','attempts')}"
    (id,execution_id,claim_nonce,number,state,created_at_ms,settled_at_ms)
    VALUES (?,?,?,?,?,?,?)`)
    .bind('attempt-quiet',executionId,nonce,1,'succeeded',now-60_000,now-59_000).run();
  await db.prepare(`INSERT INTO "${table('creezio.runtime','outbox')}"
    (id,execution_id,intent_id,provider,provider_idempotency_key,payload,state,receipt,
      claim_nonce,created_at_ms,updated_at_ms,claim_expires_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind('outbox-quiet',executionId,turnId,'openai.responses.v1',turnId,
      JSON.stringify({conversationId,turnId,messageId:'message-quiet',modelId:'gpt-4o',step:0}),
      'unknown',null,'delivery-quiet',now-59_000,now-30_000,now-10_000).run();
  for(const [index,event,outboxId,auditNonce] of [[1,'started',null,nonce],
    [2,'committed',null,nonce],[3,'delivery-claimed',turnId,'delivery-quiet'],
    [4,'delivery-unknown',turnId,'delivery-quiet']]){
    await db.prepare(`INSERT INTO "${table('creezio.runtime','audit')}"
      (id,execution_id,attempt_nonce,outbox_id,event,actor_principal_id,principal_id,
        context_id,audience,code,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(`audit-${index}`,executionId,auditNonce,outboxId,event,actor,owner,context,audience,null,
        now-60_000+index*1000).run();
  }
  return {executionId,turnId,conversationId};
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

test('a quiescent unknown OpenAI turn is copied exactly with its uncertainty evidence',
  {timeout:90000},async t=>{
    const config=fixture(t),transferId='quiet-unknown',directory=path.join(config.root,'.wrangler','transfers',transferId),
      store=await openLocalStorage(config);
    let source;
    try{
      assert.equal((await applyCompositionSchema(store.db,plan,{expectedPlanDigest:plan.planDigest})).ok,true);
      source=await seedQuietUnknown(store.db);
    }finally{await store.dispose();}
    const result=await captureLocalTransfer({config,plan,transferId,sourceSha:'a'.repeat(40),target,
      directory,secretSelections:[]});
    assert.equal(result.manifest.uncertainHistoryCount,1);
    const preserved=await loadCapturedTransfer({config,directory,transferId});
    assert.equal(preserved.uncertainHistoryCount,1);
    for(const [model,field,wanted] of [['executions','id',source.executionId],
      ['outbox','intent_id',source.turnId]]){
      const meta=result.manifest.tables.find(item=>item.moduleId==='creezio.runtime'&&item.modelId===model);
      const rows=[];for await(const row of readCapturedTable(result.manifest,directory,meta.table))rows.push(row);
      assert.equal(rows.length,1);
      assert.equal(rows[0].values[meta.columns.indexOf(field)].value,wanted);
      assert.equal(rows[0].values[meta.columns.indexOf('state')].value,'unknown');
    }
    const parent=result.manifest.tables.find(item=>item.moduleId==='creezio.conversations'
      &&item.modelId==='conversation');
    const rows=[];for await(const row of readCapturedTable(result.manifest,directory,parent.table))rows.push(row);
    assert.equal(rows[0].values[parent.columns.indexOf('active_turn_id')].value,source.turnId);
    const message=result.manifest.tables.find(item=>item.moduleId==='creezio.conversations'
      &&item.modelId==='message');
    const savedMessages=[];for await(const row of readCapturedTable(result.manifest,directory,message.table))
      savedMessages.push(row);
    assert.equal(savedMessages.length,1);
    assert.equal(savedMessages[0].values[message.columns.indexOf('body')].value,'Uncertain request');
    const event=result.manifest.tables.find(item=>item.moduleId==='creezio.conversations'
      &&item.modelId==='event');
    const savedEvents=[];for await(const row of readCapturedTable(result.manifest,directory,event.table))
      savedEvents.push(row);
    assert.deepEqual(savedEvents.map(row=>row.values[event.columns.indexOf('kind')].value),
      ['queued','unknown']);
    const reopened=await openLocalStorage(config);
    try{
      const original=await reopened.db.prepare(`SELECT state,receipt FROM "${table('creezio.runtime','outbox')}"
        WHERE intent_id=?`).bind(source.turnId).first();
      assert.deepEqual(original,{state:'unknown',receipt:null});
    }finally{await reopened.dispose();}
  });

test('a resumed turn claim and duplicate message ID in another conversation remain exportable',
  {timeout:90000},async t=>{
    const config=fixture(t),transferId='quiet-resumed',directory=path.join(config.root,'.wrangler','transfers',transferId),
      store=await openLocalStorage(config);
    try{
      assert.equal((await applyCompositionSchema(store.db,plan,{expectedPlanDigest:plan.planDigest})).ok,true);
      await seedQuietUnknown(store.db);
      await store.db.prepare(`UPDATE "${table('creezio.runtime','executions')}"
        SET claim_nonce='claim-resumed',attempt_number=2`).run();
      await store.db.prepare(`UPDATE "${table('creezio.runtime','attempts')}"
        SET state='unknown' WHERE id='attempt-quiet'`).run();
      await store.db.prepare(`INSERT INTO "${table('creezio.runtime','attempts')}"
        (id,execution_id,claim_nonce,number,state,created_at_ms,settled_at_ms)
        VALUES (?,?,?,?,?,?,?)`)
        .bind('attempt-resumed','execution-quiet','claim-resumed',2,'succeeded',Date.now()-20_000,
          Date.now()-19_000).run();
      await store.db.prepare(`UPDATE "${table('creezio.runtime','audit')}"
        SET attempt_nonce='claim-resumed' WHERE event='committed'`).run();
      await store.db.prepare(`INSERT INTO "${table('creezio.runtime','audit')}"
        (id,execution_id,attempt_nonce,outbox_id,event,actor_principal_id,principal_id,
          context_id,audience,code,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind('audit-resumed','execution-quiet','claim-resumed',null,'resumed','owner-one',
          'owner-one','application','admin',null,Date.now()-20_000).run();
      const at=new Date().toISOString();
      await store.db.prepare(`INSERT INTO "${table('creezio.conversations','conversation')}"
        (context_id,owner_id,audience,id,title,mode,created_at,updated_at,archived_at,active_turn_id,revision)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind('application','owner-one','admin','another-conversation','Other','chat',at,at,null,null,1).run();
      await store.db.prepare(`INSERT INTO "${table('creezio.conversations','message')}"
        (context_id,owner_id,audience,conversation_id,id,role,body,content,created_at,revision)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind('application','owner-one','admin','another-conversation','message-quiet','user',
          'Independent message',null,at,1).run();
    }finally{await store.dispose();}
    const result=await captureLocalTransfer({config,plan,transferId,sourceSha:'a'.repeat(40),target,
      directory,secretSelections:[]});
    assert.equal(result.manifest.uncertainHistoryCount,1);
  });

test('unknown history with a receipt, live claim, or broken audit chain is refused before capture files',
  {timeout:90000},async t=>{
    for(const [name,mutation] of [
      ['receipt',db=>db.prepare(`UPDATE "${table('creezio.runtime','outbox')}" SET receipt=?`)
        .bind(JSON.stringify({providerReference:'known',cursor:0})).run()],
      ['live-claim',db=>db.prepare(`UPDATE "${table('creezio.runtime','outbox')}"
        SET claim_expires_at_ms=?`).bind(Date.now()+60_000).run()],
      ['actor-mismatch',db=>db.prepare(`UPDATE "${table('creezio.runtime','audit')}"
        SET actor_principal_id=? WHERE event='delivery-unknown'`).bind('other-actor').run()],
      ['nonce-mismatch',db=>db.prepare(`UPDATE "${table('creezio.runtime','outbox')}"
        SET claim_nonce=?`).bind('other-claim').run()],
      ['missing-message',db=>db.prepare(`DELETE FROM "${table('creezio.conversations','message')}"
        WHERE id=?`).bind('message-quiet').run()],
      ['message-scope',async db=>{
        const at=new Date().toISOString();
        await db.prepare(`INSERT INTO "${table('creezio.conversations','conversation')}"
          (context_id,owner_id,audience,id,title,mode,created_at,updated_at,archived_at,
            active_turn_id,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .bind('application','owner-one','admin','another-conversation','Other','chat',at,at,null,
            null,1).run();
        await db.prepare(`UPDATE "${table('creezio.conversations','message')}"
          SET conversation_id=? WHERE id=?`).bind('another-conversation','message-quiet').run();
      }],
    ]){
      await t.test(name,{timeout:90000},async nested=>{
        const config=fixture(nested),transferId=`refuse-${name}`,
          directory=path.join(config.root,'.wrangler','transfers',transferId),store=await openLocalStorage(config);
        try{
          assert.equal((await applyCompositionSchema(store.db,plan,{expectedPlanDigest:plan.planDigest})).ok,true);
          await seedQuietUnknown(store.db);await mutation(store.db);
        }finally{await store.dispose();}
        await assert.rejects(captureLocalTransfer({config,plan,transferId,sourceSha:'a'.repeat(40),
          target,directory,secretSelections:[]}),error=>error.code==='active_effect');
        assert.equal(existsSync(directory),false);
      });
    }
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
