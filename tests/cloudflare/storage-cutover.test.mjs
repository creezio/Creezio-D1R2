import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createStorageFixture} from '../data/fixtures/storage.mjs';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {cloudflareWorkerConfiguration} from '../../scripts/cloudflare/config.mjs';
import {createStorageCompositionCutover} from '../../scripts/cloudflare/storage-cutover.mjs';

const digest=letter=>`sha256-${letter.repeat(64)}`;
const accountId='a'.repeat(32),installationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const primaryId='11111111-1111-4111-8111-111111111111';
const ids=['22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const resource=(contextId,slot,databaseId,status='active')=>({contextId,slot,databaseId,
  databaseName:`tenant-${slot}-db`,bucketName:`tenant-${slot}-files`,status});
const base={schemaVersion:3,accountId,workerName:'creezio-cutover',databaseId:primaryId,
  databaseName:'creezio-cutover-db',bucketName:'creezio-cutover-files',
  origin:'https://creezio-cutover.example.workers.dev',
  widgetSandboxOrigin:'https://creezio-cutover-widgets.example.workers.dev',storageInstallationId:installationId};
const previous={...base,resources:[resource('tenant-a',1,ids[0]),resource('tenant-b',2,ids[1])]};
const next={...base,resources:[resource('tenant-a',1,ids[0]),
  resource('tenant-b',2,ids[1],'revoked'),resource('tenant-c',3,ids[2])]};
const plan={planDigest:digest('1'),compositionDigest:digest('2'),lockDigest:digest('3'),
  modelDigest:digest('4'),sqlDigest:digest('5')};
const artifact={sourceSha:'b'.repeat(40),artifactDigest:digest('6'),
  compositionDigest:plan.compositionDigest,coreVersion:'1.1.0',contractVersion:'1.0.0'};
const previousArtifact={sourceSha:'a'.repeat(40),artifactDigest:digest('7'),
  compositionDigest:digest('8'),coreVersion:'1.0.0',contractVersion:'1.0.0'};
const tables=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
const routes=`"${STORAGE_AUTHORITY_TABLES.storage_routes}"`;

function deployedBindings(target){
  const config=cloudflareWorkerConfiguration(target);
  return [...config.d1_databases.map(item=>({name:item.binding,type:'d1',id:item.database_id})),
    ...config.r2_buckets.map(item=>({name:item.binding,type:'r2_bucket',
      bucket_name:item.bucket_name})),
    ...Object.entries(config.vars).map(([name,text])=>({name,type:'plain_text',text})),
    {name:'CREEZIO_VAULT_KEYRING',type:'secret_text'}];
}

async function fixture(){
  const principal=await createStorageFixture();
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    compatibilityDate:'2026-05-15',d1Databases:{A:'cutover-a',B:'cutover-b',C:'cutover-c'},
    d1Persist:false,telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
  try{
    const source=principal.db,a=await runtime.getD1Database('A'),
      b=await runtime.getD1Database('B'),c=await runtime.getD1Database('C');
    await source.batch(tables.statements.map(sql=>source.prepare(sql)));
    const epoch=(await source.prepare(`SELECT epoch FROM "${ACCESS_TABLES.authorization_state}"
      WHERE id='application'`).first()).epoch;
    for(const db of [a,b,c])await db.batch(tables.statements.map(sql=>db.prepare(sql)));
    for(const [db,entry] of [[a,previous.resources[0]],[b,previous.resources[1]]])
      await db.prepare(`INSERT INTO ${routes}
        (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
        VALUES (?,?,?,1,'active',NULL,?,0)`)
        .bind(entry.contextId,installationId,entry.slot,epoch).run();
    const databases=new Map([[primaryId,source],[ids[0],a],[ids[1],b],[ids[2],c]]);
    const sourceSha='b'.repeat(40),sourceFingerprint='c'.repeat(64);
    let sourceCurrent={head:sourceSha,sha256:sourceFingerprint,dirty:false};
    const saved={schemaVersion:1,revision:1,updateId:'cutover-one',stage:'prepared',
      target:previous,nextTarget:next,artifact,targetPlanDigest:plan.planDigest,
      targetCompositionDigest:plan.compositionDigest,sourceSha,sourceFingerprint,
      previousDeploymentId:'deployment-previous',previousVersionId:'version-previous',
      previousArtifact};
    const journal={record:structuredClone(saved),async load(){return structuredClone(this.record);},
      async compareAndSave(before,after){assert.deepEqual(this.record,before);
        assert.equal(after.revision,before.revision+1);this.record=structuredClone(after);}};
    const schemaState=new Map(),applies=new Map();
    const native=db=>db.native??db;
    const schema={
      async inspect(db){return {state:schemaState.get(native(db))==='ready'?'ready':'additive'};},
      async apply(db){db=native(db);applies.set(db,(applies.get(db)??0)+1);schemaState.set(db,'ready');
        return {ok:true,observedState:'ready',receiptId:digest('a')};},
      async managed(db){db=native(db);return schemaState.get(db)==='ready'
        ?{ok:true,receiptId:digest(db===source?'a':db===a?'b':'c'),receipt:{...plan}}
        :{ok:false};}};
    let proof=null,deliveries=0;
    let oldProof={target:previous,artifact:previousArtifact,
      deploymentId:'deployment-previous',versionId:'version-previous',percentage:100,
      bindings:deployedBindings(previous)};
    const publication={async inspectPrevious(){return oldProof;},
      async deliver(input){
      assert.equal(input.expectedPreviousDeploymentId,'deployment-previous');
      assert.equal(input.expectedPreviousVersionId,'version-previous');
      deliveries++;proof={target:next,artifact,
      deploymentId:'deployment-cutover',versionId:'version-cutover',percentage:100,
      bindings:deployedBindings(next)};},async inspect(){return proof;}};
    const options={updateJournal:journal,updateId:'cutover-one',
      previousTarget:previous,nextTarget:next,plan,artifact,
      databaseFor:async databaseId=>({db:databases.get(databaseId),metadata:{uuid:databaseId}}),
      schema,publication,sourceIdentity:()=>sourceCurrent};
    return {source,a,b,c,journal,schema,applies,publication,options,
      setProof:value=>{proof=value;},setOldProof:value=>{oldProof=value;},
      setSource:value=>{sourceCurrent=value;},
      get proof(){return proof;},get oldProof(){return oldProof;},
      get deliveries(){return deliveries;},
      cutover:()=>createStorageCompositionCutover(options),
      async dispose(){await runtime.dispose();await principal.dispose();}};
  }catch(error){await runtime.dispose();await principal.dispose();throw error;}
}

test('isolated cutover fences old routes, receipts each new D1, and opens only deployed routes',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const first=await f.cutover().advance();
    assert.equal(first.state,'ready',JSON.stringify(first));
    assert.deepEqual(first.receipts.map(item=>item.databaseId),[primaryId,ids[0],ids[2]]);
    assert.notEqual(first.receipts[0].receiptId,first.receipts[1].receiptId);
    assert.equal(f.deliveries,1);
    for(const [db,state] of [[f.a,'active'],[f.b,'deny'],[f.c,'active']]){
      const route=await db.prepare(`SELECT state,generation FROM ${routes}`).first();
      assert.equal(route.state,state);assert.equal(route.generation,2);
    }
    assert.deepEqual(await f.cutover().advance(),first);
    assert.equal(f.deliveries,1);
    assert.equal(f.applies.get(f.b),undefined,'retired D1 is retained without new schema writes');
  }finally{await f.dispose();}
});

test('old deployment must have exact bindings before the first fence',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    f.setOldProof({...f.oldProof,bindings:f.oldProof.bindings.filter(item=>
      item.name!=='BUCKET_RESOURCE_02')});
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'preflight'});
    assert.equal(f.journal.record.cutover,undefined);
    for(const db of [f.a,f.b])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'active');
    assert.equal(f.deliveries,0);
  }finally{await f.dispose();}
});

test('unverified primary D1 identity blocks source journaling before effects',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const databaseFor=f.options.databaseFor;
    f.options.databaseFor=async id=>id===primaryId
      ?{db:f.source,metadata:{uuid:ids[0]}}:databaseFor(id);
    await assert.rejects(f.cutover().advance(),{code:'database_changed'});
    assert.equal(f.journal.record.cutover,undefined);
    for(const db of [f.a,f.b])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'active');
  }finally{await f.dispose();}
});

test('an existing context cannot silently change its physical data pair',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const moved={...next,resources:[{...next.resources[0],bucketName:'tenant-a-moved'},
      ...next.resources.slice(1)]};
    assert.throws(()=>createStorageCompositionCutover({...f.options,nextTarget:moved}),
      {code:'data_transfer_required'});
    for(const db of [f.a,f.b])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'active');
  }finally{await f.dispose();}
});

test('old Worker version changing after schema leaves every route denied',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const apply=f.schema.apply;
    f.schema.apply=async(db,...args)=>{
      const result=await apply(db,...args);
      if(db===f.c)f.setOldProof({...f.oldProof,versionId:'mixed-version'});
      return result;
    };
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'schema-ready'});
    for(const db of [f.a,f.b,f.c])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.equal(f.deliveries,0);
  }finally{await f.dispose();}
});

test('routed publication cannot open a route when its sandbox prerequisite is unconfirmed',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const deliver=f.publication.deliver;
    let sandboxConfirmed=false;
    f.publication.deliver=async input=>{
      assert.equal((await f.a.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
      assert.equal((await f.b.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
      assert.equal((await f.c.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
      if(!sandboxConfirmed)throw new Error('sandbox receipt unconfirmed');
      return deliver(input);
    };
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'publishing'});
    assert.equal(f.deliveries,0);
    for(const db of [f.a,f.b,f.c])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    sandboxConfirmed=true;
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'publishing'},
      'an unknown publication intent may only be inspected, never blindly uploaded');
    assert.equal(f.deliveries,0);
  }finally{await f.dispose();}
});

test('partial fence and partial DDL stay denied until each target is inspected',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const normalDatabase=f.options.databaseFor;
    let bCalls=0;
    f.options.databaseFor=async id=>{
      if(id===ids[1]&&++bCalls===2)throw new Error('B target unavailable');
      return normalDatabase(id);
    };
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'fencing'});
    assert.equal((await f.a.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.equal((await f.b.prepare(`SELECT state FROM ${routes}`).first()).state,'active');
    assert.equal(f.deliveries,0);
    const normalApply=f.schema.apply;
    let cUnavailable=true;
    f.schema.apply=async(db,...args)=>{
      if(db===f.c&&cUnavailable){cUnavailable=false;throw new Error('C DDL unavailable');}
      return normalApply(db,...args);
    };
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'schema-applying'});
    assert.equal((await f.b.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.equal(f.deliveries,0);
    assert.equal((await f.c.prepare(`SELECT state FROM ${routes} WHERE id='tenant-c'`).first()),null);
    assert.equal((await f.cutover().advance()).state,'ready');
    assert.equal(f.deliveries,1);
    assert.equal(f.applies.get(f.source),1);
    assert.equal(f.applies.get(f.a),1);
    assert.equal(f.applies.get(f.c),1);
  }finally{await f.dispose();}
});

test('same composition with an unconfirmed lock receipt cannot publish',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const managed=f.schema.managed;
    let stale=true;
    f.schema.managed=async db=>{
      const result=await managed(db);
      return db===f.c&&stale&&result.ok
        ?{...result,receipt:{...result.receipt,lockDigest:digest('f')}}:result;
    };
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'schema-applying'});
    assert.equal(f.deliveries,0);
    for(const db of [f.a,f.b])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    stale=false;
    assert.equal((await f.cutover().advance()).state,'ready');
    assert.equal(f.applies.get(f.c),1);
  }finally{await f.dispose();}
});

test('lost schema and publication replies are inspected without replay',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const apply=f.schema.apply;
    let lostDdl=true;
    f.schema.apply=async(db,...args)=>{
      const result=await apply(db,...args);
      if(db===f.c&&lostDdl){lostDdl=false;throw new Error('DDL ACK lost');}
      return result;
    };
    const deliver=f.publication.deliver,inspect=f.publication.inspect;
    let lostUpload=true,hiddenProof=true;
    f.publication.deliver=async(...args)=>{
      await deliver(...args);
      if(lostUpload){lostUpload=false;throw new Error('upload ACK lost');}
    };
    f.publication.inspect=async()=>hiddenProof?null:inspect();
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'publishing'});
    assert.equal(f.applies.get(f.c),1);
    assert.equal(f.deliveries,1);
    for(const db of [f.a,f.b,f.c])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    hiddenProof=false;
    assert.equal((await f.cutover().advance()).state,'ready');
    assert.equal(f.deliveries,1);
    assert.equal(f.applies.get(f.c),1);
  }finally{await f.dispose();}
});

test('routed retry checks the preserved fenced routes and receipts without effects',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    f.publication.inspect=async()=>null;
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'publishing'});
    assert.equal(f.deliveries,1);
    assert.equal(await f.cutover().assertRetryReady(),true);
    assert.equal(f.deliveries,1);
    for(const db of [f.a,f.b,f.c])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    await f.a.prepare(`UPDATE ${routes} SET state='active'`).run();
    await assert.rejects(f.cutover().assertRetryReady(),{code:'retry_not_ready'});
    assert.equal(f.deliveries,1);
  }finally{await f.dispose();}
});

test('wrong version or missing R2 binding never opens routed targets',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const inspect=f.publication.inspect;
    let wrong=true;
    f.publication.inspect=async()=>{
      const proof=await inspect();
      return proof&&wrong?{...proof,percentage:50,
        bindings:proof.bindings.filter(item=>item.name!=='BUCKET_RESOURCE_03')}:proof;
    };
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'publishing'});
    for(const db of [f.a,f.b,f.c])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    wrong=false;
    assert.equal((await f.cutover().advance()).state,'ready');
    assert.equal(f.deliveries,1);
  }finally{await f.dispose();}
});

test('lost route-open acknowledgement is inspected and never increments generation twice',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const inspect=f.publication.inspect;
    let hidden=true;
    f.publication.inspect=async()=>hidden?null:inspect();
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'publishing'});
    hidden=false;
    const original=f.options.databaseFor;
    let lost=true;
    const delayed={native:f.c,prepare(sql){
      const statement=f.c.prepare(sql);
      if(!sql.includes("SET state='active'"))return statement;
      return {bind(...values){const bound=statement.bind(...values);
        return {async run(){const result=await bound.run();
          if(lost){lost=false;throw new Error('route ACK lost');}
          return result;}};}};
    },batch(statements){return f.c.batch(statements)}};
    f.options.databaseFor=async id=>id===ids[2]
      ?{db:delayed,metadata:{uuid:id}}:original(id);
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'opening'});
    assert.equal((await f.c.prepare(`SELECT state,generation FROM ${routes}`).first()).state,'active');
    assert.equal((await f.cutover().advance()).state,'ready');
    assert.equal((await f.c.prepare(`SELECT generation FROM ${routes}`).first()).generation,2);
    assert.equal(f.deliveries,1);
  }finally{await f.dispose();}
});

test('a retired route drifting active before opening blocks every new opening',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    const saved=f.journal.compareAndSave;
    f.journal.compareAndSave=async function(before,after){
      await saved.call(this,before,after);
      if(after.cutover?.phase==='opening')
        await f.b.prepare(`UPDATE ${routes} SET state='active' WHERE id='tenant-b'`).run();
    };
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'opening'});
    assert.equal((await f.a.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.equal((await f.c.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    await f.b.prepare(`UPDATE ${routes} SET state='deny' WHERE id='tenant-b'`).run();
    assert.equal((await f.cutover().advance()).state,'ready');
  }finally{await f.dispose();}
});

test('completed cutover readiness rejects later route-state drift',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.cutover().advance()).state,'ready');
    await f.b.prepare(`UPDATE ${routes} SET state='active' WHERE id='tenant-b'`).run();
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'open'});
    await f.b.prepare(`UPDATE ${routes} SET state='deny' WHERE id='tenant-b'`).run();
    await f.c.prepare(`UPDATE ${routes} SET state='deny' WHERE id='tenant-c'`).run();
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'open'});
    await f.c.prepare(`UPDATE ${routes} SET state='active' WHERE id='tenant-c'`).run();
    assert.equal((await f.cutover().advance()).state,'ready');
  }finally{await f.dispose();}
});

test('changed source plan during publication wait retains denied routes',
  {timeout:60000},async()=>{
  const f=await fixture();
  try{
    f.publication.inspect=async()=>null;
    assert.deepEqual(await f.cutover().advance(),{state:'pending',phase:'publishing'});
    f.setSource({head:'f'.repeat(40),sha256:'c'.repeat(64),dirty:false});
    await assert.rejects(f.cutover().advance(),{code:'source_changed'});
    for(const db of [f.a,f.b,f.c])
      assert.equal((await db.prepare(`SELECT state FROM ${routes}`).first()).state,'deny');
    assert.equal(f.deliveries,1);
  }finally{await f.dispose();}
});
