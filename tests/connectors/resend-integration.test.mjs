import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import * as handlers from '../../extensions/connectors/resend/module/operations.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/connectors/resend/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'7'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
  enabled:true,permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({
    modelId:model.id,table:generated.tables[model.id],model}))}]};
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const success=value=>{assert.equal(value.execution.state,'succeeded',JSON.stringify(value));return value.execution.output;};

function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},names=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,
    schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]},
    validators,handlers:Object.fromEntries(manifest.contracts.operations.map(op=>[
      `${moduleId}:${op.id}`,handlers[op.handler.export]]))});
}

test('Resend readiness uses real D1, scoped grants and a secret-free output without provider egress',
  {timeout:30000},async()=>{
    const secretModel=manifest.contracts.models.find(item=>item.id==='connector_secret');
    const use=manifest.contracts.permissions.find(item=>item.id==='use');
    assert.ok(secretModel.fields.every(item=>item.id==='context_id'||item.protected===true));
    assert.ok(secretModel.permissions.some(item=>item.id==='use'));
    assert.deepEqual(use.actions,['read','execute']);
    assert.ok(use.resources.some(item=>item.id==='connector_secret'));
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-resend-readiness-proof'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Resend readiness proof password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'resend-proof@example.invalid',
        displayName:'Resend owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'resend-proof@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'resend-proof@example.invalid',password,audience:'app'}));
      const acl=createAuthorizationService(db,{permissions}),before=good(await acl.readPolicy(admin.token));
      const policy=structuredClone(before.policy);
      policy.roles.push({id:'resend-admin',inherits:[],permissionIds:[`${moduleId}:manage`,`${moduleId}:use`],
        permissionOverrides:[]});
      policy.roles.push({id:'resend-app',inherits:[],permissionIds:[`${moduleId}:use`],permissionOverrides:[]});
      if(!policy.memberships.some(item=>item.principalId===owner.principalId&&item.audience==='app'
        &&item.contextId==='application'))policy.memberships.push({principalId:owner.principalId,
        audience:'app',contextId:'application',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId:'application',
        roleId:'resend-admin'},{principalId:owner.principalId,audience:'app',contextId:'application',
        roleId:'resend-app'});
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const engine=createOperationEngine({db,catalog,registry:registry(),permissions});
      const invoke=(operationId,token,audience='admin')=>engine.invoke({credential:{kind:'session',token},
        moduleId,operationId,contextId:'application',audience,input:{}});
      assert.deepEqual({...success(await invoke('delivery.readiness',app.token,'app'))},
        {state:'missing',from:null,configRevision:0});
      await db.prepare(`INSERT INTO "${generated.tables.connector_config}"
        (context_id,id,origin,from_address,key_ref,secret_version,enabled,revision,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind('application','resend.api.v1','https://api.resend.com',
        'sender@example.invalid','sealed-reference',1,1,4,'2026-09-30T00:00:00.000Z').run();
      await db.prepare(`INSERT INTO "${generated.tables.connector_secret}"
        (context_id,id,binding_id,ciphertext,key_id,version,state) VALUES(?,?,?,?,?,?,?)`)
        .bind('application','sealed-reference','resend.api.v1','synthetic-ciphertext-never-public',
          'synthetic-key',1,'active').run();
      const ready=success(await invoke('delivery.readiness',app.token,'app'));
      assert.deepEqual({...ready},{state:'ready',from:'sender@example.invalid',configRevision:4});
      assert.ok(!JSON.stringify(ready).includes('sealed-reference'));
      assert.ok(!JSON.stringify(ready).includes('synthetic-ciphertext-never-public'));
      const forbidden=await invoke('config.read',app.token,'app').catch(error=>error);
      assert.equal(forbidden.code??forbidden.execution?.errorCode,'forbidden');
      const deniedWrite=await engine.invoke({credential:{kind:'session',token:app.token},moduleId,
        operationId:'config.key.set',contextId:'application',audience:'app',
        input:{requestKey:'app-must-not-write-secret',apiKey:'synthetic-key-only',revision:4}})
        .catch(error=>error);
      assert.equal(deniedWrite.code??deniedWrite.execution?.errorCode,'forbidden');
      assert.equal(success(await invoke('config.read',admin.token)).config.hasKey,true);
      const now=good(await acl.readPolicy(admin.token)),revoked=structuredClone(now.policy);
      revoked.assignments=revoked.assignments.filter(item=>!(item.principalId===owner.principalId
        &&item.audience==='app'&&item.roleId==='resend-app'));
      good(await acl.replacePolicy(admin.token,{expectedEpoch:now.epoch,policy:revoked}));
      const denied=await invoke('delivery.readiness',app.token,'app').catch(error=>error);
      assert.equal(denied.code??denied.execution?.errorCode,'forbidden');
    }finally{await runtime.dispose();}
  });
