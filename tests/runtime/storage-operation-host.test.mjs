import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {createStorageFixture,permissions as storagePermissions} from '../data/fixtures/storage.mjs';
import {dataSchema,catalog as operationCatalog,recordTable} from '../operations/fixtures/identity.mjs';
import {createFixtureRegistry} from '../operations/fixtures/handlers.mjs';
import {moduleId,permissions as operationPermissions} from '../operations/fixtures/operations.mjs';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {OPERATION_TABLES} from '../../core/operations/models.ts';
import {STORAGE_AUTHORITY_TABLES} from '../../core/storage-authority/models.ts';
import {resolveRuntimeEnvironment} from '../../core/runtime/environment.ts';
import {createRuntimeOperationHost} from '../../core/runtime/operation-host.ts';
import {appendStorageCompositionReceipt} from '../storage-authority/fixtures/schema-receipt.mjs';

const quote=value=>`"${value.replaceAll('"','""')}"`;
const count=async(db,table)=>(await db.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).first()).n;
const bucket=()=>({get:async()=>null,head:async()=>null,put:async()=>null,delete:async()=>undefined});
const installationId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const routedCatalog={...operationCatalog,lockDigest:`sha256-${'7'.repeat(64)}`};

test('common operation host routes journal and data to two target D1s under fresh primary authority',
  {timeout:90000},async()=>{
    const primary=await createStorageFixture();
    const targets=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      script:'export default {fetch(){return new Response(null,{status:404})}}',
      compatibilityDate:'2026-05-15',d1Databases:{A:'creezio-operation-route-a',B:'creezio-operation-route-b'},
      r2Buckets:['A_BUCKET','B_BUCKET'],d1Persist:false,r2Persist:false,
      telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
    try{
      const source=primary.db,a=await targets.getD1Database('A'),b=await targets.getD1Database('B');
      await source.batch(dataSchema.statements.map(sql=>source.prepare(sql)));
      const permissions=[...storagePermissions,...operationPermissions];
      const authorization=createAuthorizationService(source,{permissions});
      const initial=await authorization.readPolicy(primary.signed.token);
      assert.equal(initial.ok,true);
      const initialPolicy=structuredClone(initial.policy);
      initialPolicy.roles.push({id:'operation-user',inherits:[],
        permissionIds:operationPermissions.filter(row=>!row.id.endsWith(':approve')).map(row=>row.id),
        permissionOverrides:[]});
      for(const contextId of ['application','other'])initialPolicy.assignments.push({
        principalId:primary.owner.principalId,contextId,audience:'admin',roleId:'operation-user'});
      assert.equal((await authorization.replacePolicy(primary.signed.token,
        {expectedEpoch:initial.epoch,policy:initialPolicy})).ok,true);
      const aBucket=await targets.getR2Bucket('A_BUCKET'),bBucket=await targets.getR2Bucket('B_BUCKET');
      const primaryBucket=bucket();
      const routes={schemaVersion:2,storageInstallationId:installationId,routes:[
        {contextId:'other',slot:1,status:'active'},
        {contextId:'tenant-b',slot:2,status:'active'}]};
      const epoch=async()=>(await source.prepare(`SELECT epoch FROM ${quote(ACCESS_TABLES.authorization_state)}
        WHERE id='application'`).first()).epoch;
      const initialEpoch=await epoch();
      for(const [db,contextId,slot] of [[a,'other',1],[b,'tenant-b',2]]){
        await db.batch(dataSchema.statements.map(sql=>db.prepare(sql)));
        await appendStorageCompositionReceipt(db,routedCatalog.compositionDigest,routedCatalog.lockDigest);
        await db.prepare(`INSERT INTO ${quote(STORAGE_AUTHORITY_TABLES.storage_routes)}
          (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
          VALUES (?,?,?,1,'active',NULL,?,0)`)
          .bind(contextId,installationId,slot,initialEpoch).run();
      }
      const raw={CREEZIO_RUNTIME_PROFILE:'cloudflare',CREEZIO_STORAGE_ROUTES:JSON.stringify(routes),
        DB:source,BUCKET:primaryBucket,DB_RESOURCE_01:a,BUCKET_RESOURCE_01:aBucket,
        DB_RESOURCE_02:b,BUCKET_RESOURCE_02:bBucket};
      const environment=resolveRuntimeEnvironment(raw);
      assert.ok(environment?.storageAuthority);
      const fixture=await createFixtureRegistry();
      const host=createRuntimeOperationHost({catalog:routedCatalog,registry:fixture.registry,
        permissions},environment,raw);
      assert.equal(host.forContext('other').db,a);
      assert.equal(host.forContext('other').bucket,aBucket);
      assert.equal(host.forContext('tenant-b').db,b);
      assert.equal(host.forContext('tenant-b').bucket,bBucket);
      const request=(contextId,title)=>({credential:{kind:'session',token:primary.signed.token},moduleId,
        operationId:'create_record',contextId,audience:'admin',
        input:{id:'same',title,request_id:`create-${contextId}`}});
      const first=await host.engine.invoke(request('other','first target'));
      assert.equal(first.execution.state,'succeeded',JSON.stringify(first));
      const denied=await host.engine.invoke(request('tenant-b','must not write'))
        .then(value=>value.execution.errorCode,error=>error.code);
      assert.ok(['forbidden','unauthorized'].includes(denied),String(denied));
      assert.equal(await count(b,recordTable),0);
      assert.equal(await count(b,OPERATION_TABLES.executions),0);

      const current=await authorization.readPolicy(primary.signed.token);
      assert.equal(current.ok,true);
      const policy=structuredClone(current.policy);
      policy.contexts.push({id:'tenant-b',status:'active'});
      policy.memberships.push({principalId:primary.owner.principalId,contextId:'tenant-b',
        audience:'admin',status:'active'});
      policy.assignments.push({principalId:primary.owner.principalId,contextId:'tenant-b',
        audience:'admin',roleId:'operation-user'});
      assert.equal((await authorization.replacePolicy(primary.signed.token,
        {expectedEpoch:current.epoch,policy})).ok,true);
      const nextEpoch=await epoch();
      for(const db of [a,b])await db.prepare(`UPDATE ${quote(STORAGE_AUTHORITY_TABLES.storage_routes)}
        SET generation=generation+1,source_epoch=?`).bind(nextEpoch).run();
      const second=await host.engine.invoke(request('tenant-b','second target'));
      assert.equal(second.execution.state,'succeeded',JSON.stringify(second));
      assert.equal((await a.prepare(`SELECT title FROM ${quote(recordTable)} WHERE id='same'`).first()).title,'first target');
      assert.equal((await b.prepare(`SELECT title FROM ${quote(recordTable)} WHERE id='same'`).first()).title,'second target');
      assert.equal(await count(source,recordTable),0);
      assert.equal(await count(source,OPERATION_TABLES.executions),0);
      for(const db of [a,b]){
        assert.equal(await count(db,OPERATION_TABLES.executions),1);
        assert.ok(await count(db,OPERATION_TABLES.audit)>0);
      }
      const statusA=await host.engine.status({credential:{kind:'session',token:primary.signed.token},moduleId,
        operationId:'create_record',contextId:'other',audience:'admin',executionId:first.execution.id});
      assert.equal(statusA.state,'succeeded');
      assert.equal(await host.engine.status({credential:{kind:'session',token:primary.signed.token},moduleId,
        operationId:'create_record',contextId:'tenant-b',audience:'admin',executionId:first.execution.id}),null);
      assert.throws(()=>host.forContext('unmapped'),{code:'forbidden'});
      await appendStorageCompositionReceipt(a,routedCatalog.compositionDigest,`sha256-${'c'.repeat(64)}`);
      const oldWorker=await host.engine.invoke({...request('other','must not write'),
        input:{id:'stale-worker',title:'must not write',request_id:'stale-worker'}})
        .then(value=>value.execution.errorCode,error=>error.code);
      assert.ok(['conflict','unavailable'].includes(oldWorker),String(oldWorker));
      assert.equal(await count(a,recordTable),1);
      assert.equal(await count(a,OPERATION_TABLES.executions),1);
      assert.equal((await b.prepare(`SELECT title FROM ${quote(recordTable)} WHERE id='same'`).first()).title,
        'second target');

      const sitesRaw={CREEZIO_RUNTIME_PROFILE:'sites',DB:source,BUCKET:primaryBucket};
      const sites=resolveRuntimeEnvironment(sitesRaw);
      assert.ok(sites);
      const sitesHost=createRuntimeOperationHost({catalog:operationCatalog,registry:fixture.registry,
        permissions},sites,sitesRaw);
      assert.equal(sitesHost.forContext('other').db,source);
      assert.equal(sitesHost.forContext('other').bucket,primaryBucket);
      const legacy=await sitesHost.engine.invoke({...request('other','sites primary'),
        input:{id:'sites-only',title:'sites primary',request_id:'sites-primary'}});
      assert.equal(legacy.execution.state,'succeeded',JSON.stringify(legacy));
      assert.equal(await count(source,recordTable),1);
      assert.equal(await count(source,OPERATION_TABLES.executions),1);
    }finally{await targets.dispose();await primary.dispose();}
  });
