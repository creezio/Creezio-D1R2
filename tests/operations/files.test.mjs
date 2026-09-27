import test from 'node:test';
import assert from 'node:assert/strict';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createFileService} from '../../core/files/service.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';
import {createStorageFixture,moduleId,catalog,category,permissions,table} from '../data/fixtures/storage.mjs';

const fileCatalog={compositionDigest:catalog.compositionDigest,categories:[{moduleId,category,audiences:['admin']}]} ;
const ref=(kind,id)=>({moduleId,kind,id});
const bytes=new TextEncoder().encode('Synthetic operation attachment');
const declaration=(id,{fileEffect=true}={})=>({id,title:id,kind:'command',input:{schemaId:'file-input'},output:{schemaId:'file-output'},
  permissions:[ref('permission','files')],audiences:['admin'],actors:['user'],context:'required',
  handler:{path:'module/files.ts',export:id},effects:{reads:[],writes:[ref('model','record'),
    ...(fileEffect?[ref('file','attachment')]:[])],emits:[],calls:[],providers:[]},
  errors:[{code:'conflict',retryable:false,outcome:'rejected'}],pagination:{mode:'none'},
  idempotency:{mode:'required',keyField:'requestKey',scope:'actor-context-operation',retentionSeconds:86400},
  approval:{mode:'none'},concurrency:{mode:'none'},execution:{maxDurationMs:5000,maxItems:10,resumable:false},
  audit:{required:true,redactFields:[]},public:false});
const validInput=value=>value && typeof value==='object' && typeof value.id==='string' && value.id.length>0
  && typeof value.requestKey==='string' && value.requestKey.length>0 && value.reference
  && ['fileId','intentId','generation','digest'].every(key=>typeof value.reference[key]==='string');
const validOutput=value=>value && typeof value==='object' && typeof value.id==='string' && typeof value.fileId==='string';

function engine(fixture,implementations,options={}) {
  const operations=Object.entries(implementations).map(([id,handler])=>({operation:declaration(id,{fileEffect:options.fileEffect?.[id]!==false}),
    active:true,contractDigest:`sha256-${'a'.repeat(64)}`,inputValidator:'fileInput',outputValidator:'fileOutput'}));
  const operationCatalog={schemaVersion:1,compositionDigest:catalog.compositionDigest,modules:[{moduleId,version:'1.0.0',enabled:true,
    schemas:[{schemaId:'file-input',validator:'fileInput'},{schemaId:'file-output',validator:'fileOutput'}],operations}]};
  const handlers=Object.fromEntries(Object.entries(implementations).map(([id,handler])=>[`${moduleId}:${id}`,handler]));
  const registry=createOperationRegistry({catalog:operationCatalog,validators:{fileInput:validInput,fileOutput:validOutput},handlers});
  return createOperationEngine({db:fixture.db,catalog,registry,permissions,
    ...(options.noFiles?{}:{files:{catalog:fileCatalog,bucket:options.bucket??fixture.bucket}})});
}
const request=(fixture,operationId,id,reference,key)=>({credential:{kind:'session',token:fixture.signed.token},
  moduleId,operationId,contextId:'application',audience:'admin',input:{id,reference,requestKey:key}});
const record=(fixture,id)=>fixture.db.prepare(`SELECT * FROM ${table('record')} WHERE context_id='application' AND id=?`).bind(id).first();
const metadata=(fixture,fileId)=>fixture.db.prepare(`SELECT * FROM ${table('file_metadata')} WHERE context_id='application' AND id=?`).bind(fileId).first();

test('operation file proof and business link share guarded D1 commit', {timeout:60000},async()=>{
  const fixture=await createStorageFixture();
  try {
    const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
    await fixture.db.batch(technical.statements.map(sql=>fixture.db.prepare(sql)));
    const lease=await fixture.lease(),ownerId=await fileOwnerId(fixture.owner.principalId,'admin');
    const files=createFileService({data:fixture.data,catalog,moduleId,category,bucket:fixture.bucket,ownerId});
    const stage=intent=>files.stage(lease,{ownerId,intentId:intent,generation:'1',filename:'operation.pdf',contentType:'application/pdf',bytes});
    const link=async (input,context)=>{
      const prepared=await context.files.preparePublication('attachment',input.reference);
      return {output:{id:input.id,fileId:prepared.file.fileId},plans:[prepared.plan,
        context.data.planCreate('record',{values:{id:input.id,title:prepared.file.filename}})]};
    };
    const normal=engine(fixture,{link});
    const first=await stage('operation-success');
    const response=await normal.invoke(request(fixture,'link','linked',first,'success-1'));
    assert.equal(response.execution.state,'succeeded');assert.equal(response.replayed,false);
    assert.equal(response.execution.output.fileId,first.fileId);
    assert.equal((await metadata(fixture,first.fileId)).state,'available');
    assert.equal((await record(fixture,'linked')).title,'operation.pdf');
    const replay=await normal.invoke(request(fixture,'link','linked',first,'success-1'));
    assert.equal(replay.replayed,true);assert.equal(replay.execution.id,response.execution.id);

    const second=await stage('operation-rollback');
    const conflict=await normal.invoke(request(fixture,'link','linked',second,'conflict-1')).catch(error=>error);
    assert.notEqual(conflict?.execution?.state,'succeeded');
    assert.equal((await metadata(fixture,second.fileId)).state,'staged');
    assert.equal((await record(fixture,'linked')).title,'operation.pdf');

    const withoutEffects=engine(fixture,{denied:link},{fileEffect:{denied:false}});
    const third=await stage('operation-no-effect');
    const denied=await withoutEffects.invoke(request(fixture,'denied','forbidden',third,'forbidden-1'));
    assert.equal(denied.execution.state,'failed');assert.equal(denied.execution.errorCode,'forbidden');
    assert.equal((await metadata(fixture,third.fileId)).state,'staged');
    assert.equal(await record(fixture,'forbidden'),null);

    const withoutFiles=engine(fixture,{unavailable:link},{noFiles:true});
    await assert.rejects(()=>withoutFiles.invoke(request(fixture,'unavailable','no-files',third,'no-files-1')),
      error=>error.code==='unsupported');
    assert.equal(await record(fixture,'no-files'),null);

    const foreignOwner='owner_foreign_fixture';
    const foreignFiles=createFileService({data:fixture.data,catalog,moduleId,category,bucket:fixture.bucket,ownerId:foreignOwner});
    const foreign=await foreignFiles.stage(lease,{ownerId:foreignOwner,intentId:'operation-foreign-owner',generation:'1',
      filename:'foreign.pdf',contentType:'application/pdf',bytes});
    const foreignResult=await normal.invoke(request(fixture,'link','foreign',foreign,'foreign-1')).catch(error=>error);
    assert.notEqual(foreignResult?.execution?.state,'succeeded');
    assert.equal(await record(fixture,'foreign'),null);
    assert.equal((await metadata(fixture,foreign.fileId)).state,'staged');
    const wrongContext={...request(fixture,'link','wrong-context',third,'context-1'),contextId:'other'};
    const contextResult=await normal.invoke(wrongContext).catch(error=>error);
    assert.notEqual(contextResult?.execution?.state,'succeeded');
    assert.equal(await record(fixture,'wrong-context'),null);
    assert.equal(await fixture.db.prepare(`SELECT id FROM ${table('record')} WHERE context_id='other' AND id='wrong-context'`).first(),null);

    let emptyReads=0,objectCancelled=false;
    const emptyObjectBucket={put:(...args)=>fixture.bucket.put(...args),delete:(...args)=>fixture.bucket.delete(...args),
      async get(){return {size:bytes.length,body:new ReadableStream({pull(controller){emptyReads++;controller.enqueue(new Uint8Array());},
        cancel(){objectCancelled=true;}})};}};
    const emptyObjectEngine=engine(fixture,{read_empty:link},{bucket:emptyObjectBucket});
    const emptyRef=await stage('operation-empty-r2');
    const emptyOutcome=await emptyObjectEngine.invoke(request(fixture,'read_empty','empty-object',emptyRef,'empty-1')).catch(error=>error);
    assert.notEqual(emptyOutcome?.execution?.state,'succeeded');
    assert.equal(objectCancelled,true);assert.ok(emptyReads<=16386,`unbounded empty R2 stream: ${emptyReads}`);
    assert.equal((await metadata(fixture,emptyRef.fileId)).state,'staged');
    assert.equal(await record(fixture,'empty-object'),null);

    const fileOnly=engine(fixture,{proof_only:async(input,context)=>{
      const prepared=await context.files.preparePublication('attachment',input.reference);
      return {output:{id:input.id,fileId:prepared.file.fileId},plans:[prepared.plan]};
    }});
    const onlyRef=await stage('operation-proof-only');
    const only=await fileOnly.invoke(request(fixture,'proof_only','no-link',onlyRef,'only-1')).catch(error=>error);
    assert.notEqual(only?.execution?.state,'succeeded');
    assert.equal((await metadata(fixture,onlyRef.fileId)).state,'staged');
    assert.equal(await record(fixture,'no-link'),null);

    const omitted=engine(fixture,{omit:async(input,context)=>{
      const prepared=await context.files.preparePublication('attachment',input.reference);
      return {output:{id:input.id,fileId:prepared.file.fileId},plans:[context.data.planCreate('record',
        {values:{id:input.id,title:'must not link an unavailable file'}})]};
    }});
    const omittedRef=await stage('operation-omitted-proof');
    const omission=await omitted.invoke(request(fixture,'omit','omitted',omittedRef,'omit-1')).catch(error=>error);

    let revokeAfterProof=false;
    const racing=engine(fixture,{race:async(input,context)=>{
      const prepared=await context.files.preparePublication('attachment',input.reference);
      const business=context.data.planCreate('record',{values:{id:input.id,title:'raced'}});
      if(revokeAfterProof) await fixture.revoke();
      return {output:{id:input.id,fileId:prepared.file.fileId},plans:[prepared.plan,business]};
    }});
    const fourth=await stage('operation-revoked');
    revokeAfterProof=true;
    const revoked=await racing.invoke(request(fixture,'race','revoked',fourth,'revoked-1')).catch(error=>error);
    assert.notEqual(revoked?.execution?.state,'succeeded');
    assert.equal((await metadata(fixture,fourth.fileId)).state,'staged');
    assert.equal(await record(fixture,'revoked'),null);
    assert.notEqual(omission?.execution?.state,'succeeded');
    assert.equal(await record(fixture,'omitted'),null);
    assert.equal((await metadata(fixture,omittedRef.fileId)).state,'staged');
  } finally {await fixture.dispose();}
});
