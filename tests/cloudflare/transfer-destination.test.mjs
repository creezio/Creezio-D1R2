import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {loadLocalConfiguration} from '../../scripts/local/config.mjs';
import {openLocalStorage} from '../../scripts/local/database.mjs';
import {loadCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {applyCompositionSchema,inspectCompositionSchema} from '../../scripts/data/apply-schema.mjs';
import {captureLocalTransfer} from '../../scripts/cloudflare/transfer/source.ts';
import {createFileTransferJournal} from '../../scripts/cloudflare/transfer/journal.ts';
import {importCapturedTransfer,verifyCapturedTransfer} from '../../scripts/cloudflare/transfer/destination.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const sourcePlan=await loadCompositionSchema({root:repository,
  compositionPath:'configuration/composition.widgets-local.json'});
const targetPlan=await loadCompositionSchema({root:repository,
  compositionPath:'configuration/composition.widgets-sites.json'});
const target={accountId:'account-one',workerName:'creezio-t32',databaseId:'database-one',
  bucketName:'bucket-one',origin:'https://example.workers.dev'};
const ownerCredentials={loginIdentifier:'transfer-owner@example.invalid',displayName:'Transfer owner',
  password:'Synthetic transfer qualification password'};
const recordTable=sourcePlan.runtimeCatalog.modules.find(item=>item.moduleId==='example.widgets-witness')
  .models.find(item=>item.modelId==='record').table;
const table=(moduleId,modelId)=>[sourcePlan.host,...sourcePlan.runtimeCatalog.modules]
  .find(item=>item.moduleId===moduleId)
  .models.find(item=>item.modelId===modelId).table;

function objectPort({loseReply=false,onPut=null}={}){
  const saved=new Map();let uploads=0;
  return {
    saved,get uploads(){return uploads;},
    async inspectObject(entry){
      const actual=saved.get(entry.key);if(!actual)return 'absent';
      const hash=createHash('sha256').update(actual.bytes).digest('hex');
      return hash===entry.sha256&&actual.bytes.length===entry.size
        &&JSON.stringify(actual.httpMetadata)===JSON.stringify(entry.httpMetadata)
        &&JSON.stringify(actual.customMetadata)===JSON.stringify(entry.customMetadata)?'matching':'conflict';
    },
    async putObjectIfAbsent(entry,source,checkpoint){
      if(saved.has(entry.key))return 'unknown';
      const chunks=[];for await(const chunk of source)chunks.push(Buffer.from(chunk));
      const bytes=Buffer.concat(chunks);uploads++;
      saved.set(entry.key,{bytes,httpMetadata:entry.httpMetadata,customMetadata:entry.customMetadata});
      if(onPut)await onPut(checkpoint);
      if(loseReply){loseReply=false;throw new Error('response lost after object creation');}
      return 'created';
    },
    async *listObjectKeys(){for(const key of saved.keys())yield key;},
  };
}
async function fixture(t,{relatedRows=false}={}){
  const root=temporaryDirectory(t,'creezio-transfer-destination-');
  mkdirSync(path.join(root,'.openai'));
  writeFileSync(path.join(root,'.openai','hosting.json'),JSON.stringify({d1:'DB',r2:'BUCKET'}));
  const config=loadLocalConfiguration({root}),transferId='import-one',
    directory=path.join(config.root,'.wrangler','transfers',transferId);
  const source=await openLocalStorage(config);
  let auditId=null,sessionId=null,principalId=null;
  try{
    assert.equal((await applyCompositionSchema(source.db,sourcePlan,
      {expectedPlanDigest:sourcePlan.planDigest})).ok,true);
    if(relatedRows){
      const accounts=createAccountService(source.db),capability=await provisionBootstrapCapability(source.db);
      assert.ok(capability);
      const installed=await accounts.bootstrap({token:capability.token,...ownerCredentials});
      assert.equal(installed.ok,true);principalId=installed.principalId;
      const signed=await accounts.login({loginIdentifier:ownerCredentials.loginIdentifier,
        password:ownerCredentials.password,audience:'admin'});
      assert.equal(signed.ok,true);
      const audit=await source.db.prepare(`SELECT id,session_id FROM "${table('creezio.access','access_audit')}"
        WHERE session_id IS NOT NULL LIMIT 1`).first();
      assert.ok(audit?.session_id);auditId=audit.id;sessionId=audit.session_id;
      await source.db.prepare(`INSERT INTO "${table('creezio.runtime','executions')}"
        (id,scope_hash,input_hash,module_id,operation_id,operation_version,actor_principal_id,
          principal_id,context_id,audience,state,claim_nonce,attempt_number,created_at_ms,
          updated_at_ms,claim_expires_at_ms,retained_until_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind('execution-one','sha256-test-scope','sha256-test-input','creezio.access','test','1',
          principalId,principalId,'application','admin','succeeded','claim-one',1,1,2,3,4).run();
      await source.db.prepare(`INSERT INTO "${table('creezio.runtime','attempts')}"
        (id,execution_id,claim_nonce,number,state,created_at_ms,settled_at_ms)
        VALUES (?,?,?,?,?,?,?)`).bind('attempt-one','execution-one','claim-one',1,'succeeded',1,2).run();
      const stamp='2026-09-27T00:00:00.000Z';
      await source.db.prepare(`INSERT INTO "${table('creezio.conversations','conversation')}"
        (context_id,owner_id,audience,id,title,mode,created_at,updated_at,revision)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind('application',principalId,'admin','conversation-one',
          'Transferred conversation','chat',stamp,stamp,1).run();
      await source.db.prepare(`INSERT INTO "${table('creezio.conversations','turn')}"
        (context_id,owner_id,audience,conversation_id,id,state,created_at,updated_at,revision,last_sequence)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind('application',principalId,'admin','conversation-one',
          'turn-one','succeeded',stamp,stamp,1,1).run();
      await source.db.prepare(`INSERT INTO "${table('creezio.conversations','event')}"
        (context_id,owner_id,audience,conversation_id,turn_id,sequence,kind,payload,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind('application',principalId,'admin','conversation-one',
          'turn-one',1,'turn.completed','{}',stamp).run();
    }
    await source.db.prepare(`INSERT INTO "${recordTable}"
      (context_id,id,title,revision,internal_secret) VALUES (?,?,?,?,?)`)
      .bind('application','record-one','Transferred record',1,'private-business-value').run();
    await source.bucket.put('creezio/files/v1/test-object',new TextEncoder().encode('r2-bytes'),
      {httpMetadata:{contentType:'application/octet-stream'},customMetadata:{source:'local'}});
  }finally{await source.dispose();}
  const capture=await captureLocalTransfer({config,plan:sourcePlan,transferId,
    sourceSha:'a'.repeat(40),target,directory,secretSelections:[]});
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'t32-destination'},d1Persist:false});
  t.after(async()=>{await runtime.dispose();});
  const db=await runtime.getD1Database('DB');
  assert.equal((await applyCompositionSchema(db,targetPlan,
    {expectedPlanDigest:targetPlan.planDigest})).ok,true);
  const journal=createFileTransferJournal(path.join(config.root,'.wrangler'));
  return {config,directory,manifest:capture.manifest,targetPlan,db,journal,
    relationSeed:{auditId,sessionId,principalId}};
}

test('copies an owner, execution and conversation with parents first; excludes live sessions but retains audit',
  {timeout:120000},async t=>{
    const args=await fixture(t,{relatedRows:true}),objects=objectPort();
    const tables=args.manifest.tables.map(item=>item.table);
    for(const [parent,child] of [
      [table('creezio.access','principals'),table('creezio.access','human_accounts')],
      [table('creezio.runtime','executions'),table('creezio.runtime','attempts')],
      [table('creezio.conversations','turn'),table('creezio.conversations','event')],
    ])assert.ok(tables.indexOf(parent)<tables.indexOf(child));
    const auditTable=table('creezio.access','access_audit');
    assert.equal(args.manifest.tables.find(item=>item.table===auditTable).policy,'transform');
    const source=await openLocalStorage(args.config);
    try{assert.equal((await source.db.prepare(`SELECT session_id FROM "${auditTable}" WHERE id=?`)
      .bind(args.relationSeed.auditId).first()).session_id,args.relationSeed.sessionId);}
    finally{await source.dispose();}
    const imported=await importCapturedTransfer({...args,objects});
    assert.equal(imported.phase,'verified');
    assert.equal((await verifyCapturedTransfer({...args,objects})).ok,true);
    assert.equal((await args.db.prepare(`SELECT principal_id FROM "${table('creezio.access','human_accounts')}"
      WHERE principal_id=?`).bind(args.relationSeed.principalId).first()).principal_id,
      args.relationSeed.principalId);
    assert.equal((await args.db.prepare(`SELECT COUNT(*) AS count FROM "${table('creezio.access','sessions')}"`)
      .first()).count,0);
    assert.equal((await args.db.prepare(`SELECT session_id FROM "${auditTable}" WHERE id=?`)
      .bind(args.relationSeed.auditId).first()).session_id,null);
    const exportedAudit=await args.db.prepare(`SELECT action,principal_id,created_at_ms
      FROM "${auditTable}" WHERE id=?`).bind(args.relationSeed.auditId).first();
    assert.equal(exportedAudit.action,'session-created');
    assert.equal(exportedAudit.principal_id,args.relationSeed.principalId);
    assert.ok(Number.isSafeInteger(exportedAudit.created_at_ms));
    assert.equal((await args.db.prepare(`SELECT execution_id FROM "${table('creezio.runtime','attempts')}"
      WHERE id='attempt-one'`).first()).execution_id,'execution-one');
    assert.equal((await args.db.prepare(`SELECT turn_id FROM "${table('creezio.conversations','event')}"
      WHERE conversation_id='conversation-one'`).first()).turn_id,'turn-one');
    const login=await createAccountService(args.db).login({loginIdentifier:ownerCredentials.loginIdentifier,
      password:ownerCredentials.password,audience:'admin'});
    assert.equal(login.ok,true);
  });

test('imports different profiles with exact model and SQL objects, recovers lost D1 and R2 replies',
  {timeout:120000},async t=>{
    assert.notEqual(sourcePlan.compositionDigest,targetPlan.compositionDigest);
    assert.equal(sourcePlan.modelDigest,targetPlan.modelDigest);
    const args=await fixture(t),objects=objectPort({loseReply:true});
    let lost=true;
    const db=new Proxy(args.db,{get(target,key){
      if(key==='batch')return async statements=>{
        const result=await target.batch(statements);
        if(lost&&result.some(item=>item.meta?.changes>0)){
          lost=false;throw new Error('response lost after D1 commit');
        }
        return result;
      };
      const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
    }});
    assert.equal((await inspectCompositionSchema(args.db,args.targetPlan)).state,'ready');
    assert.equal((await inspectCompositionSchema(db,args.targetPlan)).state,'ready');
    const first=await importCapturedTransfer({...args,db,objects});
    assert.equal(first.phase,'verified');assert.equal(lost,false);assert.equal(objects.uploads,1);
    assert.equal((await args.db.prepare(`SELECT title,internal_secret FROM "${recordTable}"
      WHERE id='record-one'`).first()).internal_secret,'private-business-value');
    const proof=await verifyCapturedTransfer({...args,objects});
    assert.equal(proof.ok,true);assert.equal(proof.objects,1);assert.equal(proof.bytes,8);
    const second=await importCapturedTransfer({...args,objects});
    assert.equal(second.revision,first.revision);assert.equal(objects.uploads,1);
    objects.saved.set('unexpected-object',{bytes:Buffer.from('x'),httpMetadata:{},customMetadata:{}});
    await assert.rejects(verifyCapturedTransfer({...args,objects}),error=>error.code==='conflict');
    objects.saved.delete('unexpected-object');
    const object=objects.saved.get('creezio/files/v1/test-object');
    object.customMetadata={source:'changed'};
    await assert.rejects(verifyCapturedTransfer({...args,objects}),error=>error.code==='conflict');
    object.customMetadata={source:'local'};
    await args.db.prepare(`UPDATE "${recordTable}" SET title='tampered' WHERE id='record-one'`).run();
    await assert.rejects(verifyCapturedTransfer({...args,objects}),error=>error.code==='conflict');
  });

test('conflicting target row blocks import without overwrite',{timeout:120000},async t=>{
  const args=await fixture(t),objects=objectPort();
  await args.db.prepare(`INSERT INTO "${recordTable}"
    (context_id,id,title,revision,internal_secret) VALUES (?,?,?,?,?)`)
    .bind('application','record-one','Target owns this row',1,'target-value').run();
  await assert.rejects(importCapturedTransfer({...args,objects,journal:args.journal}),
    error=>error.code==='conflict');
  assert.equal((await args.db.prepare(`SELECT title FROM "${recordTable}" WHERE id='record-one'`).first()).title,
    'Target owns this row');
  assert.equal(objects.uploads,0);
});

test('object upload may advance the shared journal before its cursor is saved',
  {timeout:120000},async t=>{
    const args=await fixture(t);
    const objects=objectPort({onPut:async checkpoint=>{
      const previous=await args.journal.load(checkpoint.identity.transferId);
      assert.equal(previous.revision,checkpoint.revision);
      await args.journal.compareAndSave(previous,{...previous,revision:previous.revision+1});
    }});
    const result=await importCapturedTransfer({...args,objects});
    assert.equal(result.phase,'verified');
    assert.equal(objects.uploads,1);
    assert.equal((await verifyCapturedTransfer({...args,objects})).ok,true);
  });
