import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare,Log,LogLevel} from 'miniflare';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {compileOperationSchemas} from '../../scripts/operations/schemas.mjs';
import {describeD1Schema} from '../../scripts/data/d1-schema.mjs';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {OPERATION_TABLES} from '../../core/operations/models.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {hostOnly} from '../../extensions/native/access/module/operations.ts';
import {STORAGE_AUTHORITY_MODELS,STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_TABLES}
  from '../../core/storage-authority/models.ts';
import {createStorageMutationPort} from '../../core/storage-authority/native-mutation.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const q=value=>`"${value.replaceAll('"','""')}"`;
const moduleId='creezio.access';
const manifest=json('../../extensions/native/access/module/manifest.json');
const composition=json('../../configuration/composition.json');
const lock=json('../../configuration/composition.lock.json');
composition.modules=composition.modules.filter(item=>item.moduleId===moduleId);
for(const audience of ['admin','app'])composition.exposure[audience].moduleIds=
  composition.exposure[audience].moduleIds.filter(id=>id===moduleId);
lock.modules=lock.modules.filter(item=>item.moduleId===moduleId);
lock.modules[0].contractIntegrity=contractIntegrity(manifest);
lock.compositionIntegrity=contractIntegrity(composition);
const input={composition,lock,modules:[manifest]};
const appSchema=compileCompositionSchema(input);
const authority=describeD1Schema(STORAGE_AUTHORITY_MODULE_ID,STORAGE_AUTHORITY_MODELS);
const routeTable=q(STORAGE_AUTHORITY_TABLES.storage_routes);
const executionTable=q(OPERATION_TABLES.executions);
const auditTable=q(ACCESS_TABLES.access_audit);
const detailTable=q(ACCESS_TABLES.access_policy_audit_details);
const epochTable=q(ACCESS_TABLES.authorization_state);
const route=async(db)=>db.prepare(`SELECT state,generation,source_epoch AS sourceEpoch FROM ${routeTable}`).first();
const epoch=async(db)=>(await db.prepare(`SELECT epoch FROM ${epochTable} WHERE id='application'`).first()).epoch;
const count=async(db,table,predicate)=>
  (await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${predicate}`).first()).n;

test('native operation engine with two target D1s gates invoke, replay, status and lookup on target ACKs',
  {timeout:60000},async()=>{
    const compiled=compileOperationSchemas(input);
    const validators={...await import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`)};
    const handlers=Object.fromEntries(manifest.contracts.operations.map(item=>[`${moduleId}:${item.id}`,hostOnly]));
    const registry=createOperationRegistry({catalog:compiled.catalog,validators,handlers});
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{SOURCE:'t33-operation-source',A:'t33-operation-a',B:'t33-operation-b'},d1Persist:false,
      telemetry:{enabled:false},logRequests:false,log:new Log(LogLevel.NONE)});
    try{
      const source=await runtime.getD1Database('SOURCE');
      const a=await runtime.getD1Database('A'),b=await runtime.getD1Database('B');
      await source.batch(appSchema.statements.map(sql=>source.prepare(sql)));
      const accounts=createAccountService(source),bootstrap=await provisionBootstrapCapability(source);
      assert.ok(bootstrap);
      const password='Synthetic routed native operation password';
      const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'routed-operation@example.invalid',
        displayName:'Routed operation owner',password});
      assert.equal(owner.ok,true,JSON.stringify(owner));
      const session=await accounts.login({loginIdentifier:'routed-operation@example.invalid',password,audience:'admin'});
      assert.equal(session.ok,true,JSON.stringify(session));
      const sourceEpoch=await epoch(source);
      const identities=[{installationId:'t33-operation-installation',contextId:'other',slot:1},
        {installationId:'t33-operation-installation',contextId:'tenant-b',slot:2}];
      for(const [db,identity] of [[a,identities[0]],[b,identities[1]]]){
        await db.batch(authority.statements.map(sql=>db.prepare(sql)));
        await db.prepare(`INSERT INTO ${routeTable}
          (id,installation_id,slot,generation,state,mutation_id,source_epoch,updated_at_ms)
          VALUES (?,?,?,1,'active',NULL,?,0)`)
          .bind(identity.contextId,identity.installationId,identity.slot,sourceEpoch).run();
      }
      let loseAck=true;
      const delayed={prepare(sql){
        if(loseAck&&sql.includes("SET state='active'"))throw new Error('synthetic target B ACK loss');
        return b.prepare(sql);
      },batch(statements){return b.batch(statements)}};
      const storageMutation=createStorageMutationPort(source,[{identity:identities[0],db:a},
        {identity:identities[1],db:delayed}]);
      const engine=createOperationEngine({db:source,catalog:appSchema.runtimeCatalog,registry,permissions:[],
        storageMutation});
      const body={requestKey:'routed-policy-one',expectedEpoch:sourceEpoch,
        changes:[{kind:'role-grant',roleId:'administrator',permissionId:'creezio.access:impersonate',present:true}]};
      const request={credential:{kind:'session',token:session.token},moduleId,operationId:'policy.apply-delta',
        contextId:'application',audience:'admin',input:body};
      await assert.rejects(engine.invoke(request),{code:'unknown'});
      assert.equal(await epoch(source),sourceEpoch+1,'the source policy commits exactly once');
      assert.equal(await count(source,auditTable,"action='authorization-updated'"),1);
      assert.equal(await count(source,detailTable,'1=1'),1);
      const row=await source.prepare(`SELECT id,state FROM ${executionTable}
        WHERE module_id=? AND operation_id=?`).bind(moduleId,'policy.apply-delta').first();
      assert.ok(row?.id);assert.equal(row.state,'succeeded','source receipt is durable while target ACK is pending');
      assert.equal((await route(b)).state,'deny');
      const status={credential:request.credential,moduleId,operationId:request.operationId,
        contextId:request.contextId,audience:request.audience,executionId:row.id};
      const lookup={credential:request.credential,moduleId,operationId:request.operationId,
        contextId:request.contextId,audience:request.audience,requestKey:body.requestKey};
      await assert.rejects(engine.invoke(request),{code:'unknown'});
      await assert.rejects(engine.status(status),{code:'unknown'});
      await assert.rejects(engine.lookup(lookup),{code:'unknown'});
      assert.equal(await epoch(source),sourceEpoch+1);
      assert.equal(await count(source,auditTable,"action='authorization-updated'"),1);
      assert.equal(await count(source,detailTable,'1=1'),1);
      loseAck=false;
      const recovered=await engine.lookup(lookup);
      assert.equal(recovered?.state,'succeeded');assert.equal(recovered.id,row.id);
      assert.equal((await engine.status(status))?.state,'succeeded');
      const replay=await engine.invoke(request);
      assert.equal(replay.replayed,true);assert.equal(replay.execution.id,row.id);
      assert.equal(replay.execution.state,'succeeded');
      assert.equal(await epoch(source),sourceEpoch+1);
      assert.equal(await count(source,auditTable,"action='authorization-updated'"),1);
      assert.equal(await count(source,detailTable,'1=1'),1);
      for(const db of [a,b]){
        const state=await route(db);assert.equal(state.state,'active');
        assert.equal(state.generation,2);assert.equal(state.sourceEpoch,sourceEpoch+1);
      }
    }finally{await runtime.dispose();}
  });
