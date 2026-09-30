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
import {createVaultKeyring} from '../../core/vault/crypto.ts';
import {hermesConnectorDescriptor} from '../../extensions/connectors/hermes/module/storage.ts';
import * as handlers from '../../extensions/connectors/hermes/module/operations.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const manifest=json('../../extensions/connectors/hermes/module/manifest.json');
const moduleId=manifest.identity.id,digest=`sha256-${'6'.repeat(64)}`;
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
function registry(probeSecret=false){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},names=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:[{moduleId,
    version:manifest.identity.version,enabled:true,
    schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation:probeSecret&&operation.id==='run.read'
      ?{...operation,effects:{...operation.effects,reads:[...operation.effects.reads,
        {moduleId,kind:'model',id:'connector_secret'}]}}:operation,active:true,contractDigest:digest,
      inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))}]},
    validators,handlers:Object.fromEntries(manifest.contracts.operations.map(op=>[
      `${moduleId}:${op.id}`,probeSecret&&op.id==='run.read'
        ?async(_input,context)=>({output:await context.data.get('connector_secret',
          {key:{id:'hermes.api.v1'},fields:['ciphertext']})})
        :handlers[op.handler.export]]))});
}

test('Hermes D1/host preserves owner, generation, GET capture, one POST and unknown non-replay',
  {timeout:30000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-hermes-proof'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Hermes integration password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'hermes-proof@example.invalid',
        displayName:'Hermes owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'hermes-proof@example.invalid',password,audience:'admin'}));
      const app=good(await accounts.login({loginIdentifier:'hermes-proof@example.invalid',password,audience:'app'}));
      const acl=createAuthorizationService(db,{permissions}),before=good(await acl.readPolicy(admin.token));
      const policy=structuredClone(before.policy);
      policy.roles.push({id:'hermes-admin',inherits:[],permissionIds:[`${moduleId}:manage`,`${moduleId}:use`,
        `${moduleId}:connect`],permissionOverrides:[]});
      policy.roles.push({id:'hermes-app',inherits:[],permissionIds:[`${moduleId}:use`,`${moduleId}:connect`],
        permissionOverrides:[]});
      if(!policy.memberships.some(item=>item.principalId===owner.principalId&&item.audience==='app'
        &&item.contextId==='application'))policy.memberships.push({principalId:owner.principalId,
        audience:'app',contextId:'application',status:'active'});
      policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId:'application',roleId:'hermes-admin'},
        {principalId:owner.principalId,audience:'app',contextId:'application',roleId:'hermes-app'});
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const keyring=createVaultKeyring({activeKeyId:'proof-key',keys:{'proof-key':new Uint8Array(32).fill(29)}});
      let calls=[],failNext=false;
      const fetcher=async(url,options)=>{
        const path=new URL(url).pathname;calls.push({path,method:options.method,headers:options.headers});
        if(path==='/v1/capabilities')return Response.json({object:'hermes.api_server.capabilities',model:'hermes-agent',
          features:{run_submission:true,run_status:true,run_events_sse:false,run_stop:true}});
        if(path==='/v1/runs'&&options.method==='POST'){
          if(failNext){failNext=false;throw new Error('simulated lost acknowledgement');}
          return Response.json({run_id:'run_001',status:'started'},{status:202});
        }
        if(path==='/v1/runs/run_001/stop')return Response.json({status:'stopping'},{status:202});
        if(path==='/v1/runs/run_001')return Response.json({object:'hermes.run',run_id:'run_001',
          status:'running',output:null,model:'hermes-agent',session_id:'session-1'});
        return Response.json({error:'unexpected fixture route'},{status:404});
      };
      const engine=createOperationEngine({db,catalog,registry:registry(),permissions,
        connectors:[{descriptor:hermesConnectorDescriptor,keyring,fetcher}]});
      const invoke=(operationId,input,token=admin.token,audience='admin')=>engine.invoke({
        credential:{kind:'session',token},moduleId,operationId,contextId:'application',audience,input});
      const configured=success(await invoke('config.set',{requestKey:'origin-1',origin:'https://hermes.example.org',
        enabled:false,revision:0}));
      assert.equal(configured.config.generation,1);
      const keyed=success(await invoke('config.key.set',{requestKey:'key-1',apiKey:'synthetic-bearer-key',revision:1}));
      assert.equal(keyed.config.generation,2);
      const enabled=success(await invoke('config.set',{requestKey:'enable-1',origin:'https://hermes.example.org',
        enabled:true,revision:2}));
      assert.equal(enabled.config.generation,3);
      const denied=await invoke('config.read',{},app.token,'app').catch(error=>error);
      assert.equal(denied.code??denied.execution?.errorCode,'forbidden');
      const protectedEngine=createOperationEngine({db,catalog,registry:registry(true),permissions,
        connectors:[{descriptor:hermesConnectorDescriptor,keyring,fetcher}]});
      const secretProbe=await protectedEngine.invoke({credential:{kind:'session',token:app.token},moduleId,
        operationId:'run.read',contextId:'application',audience:'app',input:{id:'synthetic'}});
      assert.equal(secretProbe.execution.state,'failed');
      assert.equal(secretProbe.execution.errorCode,'forbidden');
      assert.equal(JSON.stringify(secretProbe).includes('synthetic-bearer-key'),false);
      const captured=success(await invoke('capabilities.capture',{requestKey:'capture-1'}));
      assert.equal(captured.capabilities.features.run_submission,true);
      const prepared=success(await invoke('run.prepare',{requestKey:'prepare-1',input:'Summarize the report'},app.token,'app'));
      const submission=success(await invoke('run.submit',{id:prepared.id,requestKey:prepared.id,revision:1},app.token,'app'));
      assert.equal(submission.remoteId,'run_001');
      const writes=()=>calls.filter(x=>x.path==='/v1/runs'&&x.method==='POST');
      assert.equal(writes().length,1);assert.match(writes()[0].headers.get('Idempotency-Key'),/^creezio-/);
      const replay=await invoke('run.submit',{id:prepared.id,requestKey:prepared.id,revision:1},app.token,'app');
      assert.equal(replay.replayed,true);assert.equal(writes().length,1);
      const read=success(await invoke('run.read',{id:prepared.id},app.token,'app'));
      assert.equal(read.run.remote.status,'running');
      const refreshed=success(await invoke('run.refresh',{id:prepared.id,requestKey:'refresh-1',revision:2},app.token,'app'));
      assert.equal(refreshed.run.revision,3);
      const stopped=success(await invoke('run.stop',{id:prepared.id,requestKey:`${prepared.id}:stop`,revision:3},app.token,'app'));
      assert.equal(stopped.status,'stopping');
      const second=success(await invoke('run.prepare',{requestKey:'prepare-2',input:'A second task'},app.token,'app'));
      failNext=true;
      const unknown=await invoke('run.submit',{id:second.id,requestKey:second.id,revision:1},app.token,'app').catch(error=>error);
      assert.equal(unknown.execution?.state??unknown.code,'unknown');
      const count=writes().length;
      const repeated=await invoke('run.submit',{id:second.id,requestKey:second.id,revision:1},app.token,'app').catch(error=>error);
      assert.equal(repeated.execution?.state??repeated.code,'unknown');assert.equal(writes().length,count);
      const stamp=await db.prepare(`SELECT generation FROM "${generated.tables.connection_stamp}" WHERE context_id=? AND id=?`)
        .bind('application','hermes.api.v1').first();
      assert.equal(stamp.generation,3);
      const revoked=success(await invoke('config.key.revoke',{requestKey:'revoke-1',revision:3}));
      assert.equal(revoked.config.generation,4);
      const revokedStamp=await db.prepare(`SELECT generation FROM "${generated.tables.connection_stamp}"
        WHERE context_id=? AND id=?`).bind('application','hermes.api.v1').first();
      assert.equal(revokedStamp.generation,4,'the compared stamp field increments atomically');
      const remoteReads=()=>calls.filter(x=>x.path==='/v1/runs/run_001'&&x.method==='GET').length;
      const readsBefore=remoteReads();
      const stale=await invoke('run.read',{id:prepared.id},app.token,'app').catch(error=>error);
      assert.equal(stale.execution?.errorCode??stale.code,'unavailable');
      assert.equal(remoteReads(),readsBefore);
      success(await invoke('config.key.set',{requestKey:'key-2',apiKey:'synthetic-bearer-key-2',revision:4}));
      success(await invoke('config.set',{requestKey:'enable-2',origin:'https://hermes.example.org',
        enabled:true,revision:5}));
      const recaptured=success(await invoke('capabilities.capture',{requestKey:'capture-2'}));
      assert.equal(recaptured.revision,2);
      const capturedGeneration=await db.prepare(`SELECT connection_generation AS generation FROM
        "${generated.tables.capability_snapshot}" WHERE context_id=? AND id=?`)
        .bind('application','current').first();
      assert.equal(capturedGeneration.generation,6);
      const stillStale=await invoke('run.read',{id:prepared.id},app.token,'app').catch(error=>error);
      assert.equal(stillStale.execution?.errorCode??stillStale.code,'unavailable');
      assert.equal(remoteReads(),readsBefore);
    }finally{await runtime.dispose();}
  });
