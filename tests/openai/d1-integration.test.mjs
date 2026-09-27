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
import {createOpenAiProviderHost} from '../../core/providers/host.ts';
import {createOpenAITransport} from '../../extensions/native/openai/module/transport.ts';
import {openAiConfigStorage,openAiVaultStorage} from '../../extensions/native/openai/module/storage.ts';
import * as handlers from '../../extensions/native/openai/module/operations.ts';

const manifest=JSON.parse(readFileSync(new URL('../../extensions/native/openai/module/manifest.json',import.meta.url),'utf8'));
const accessModels=JSON.parse(readFileSync(new URL('../../extensions/native/access/module/models.json',import.meta.url),'utf8'));
const moduleId=manifest.identity.id,digest=`sha256-${'a'.repeat(64)}`;
const schema=generateD1Schema(moduleId,manifest.contracts.models);
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=manifest.contracts.permissions.map(item=>({id:`${moduleId}:${item.id}`,
  audiences:item.audiences,actors:item.actors}));
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,enabled:true,
  permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({modelId:model.id,
    table:schema.tables[model.id],model}))}]};
function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},schemaNames=new Map();
  for(const [index,item] of manifest.contracts.schemas.entries()){
    const name=`schema_${index}`;schemaNames.set(item.id,name);validators[name]=ajv.compile(item.schema);
  }
  const operationCatalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,
    enabled:true,schemas:[...schemaNames].map(([schemaId,validator])=>({schemaId,validator})),
    operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
      inputValidator:schemaNames.get(operation.input.schemaId),outputValidator:schemaNames.get(operation.output.schemaId)}))}]};
  const mapped=Object.fromEntries(manifest.contracts.operations.map(op=>[
    `${moduleId}:${op.id}`,handlers[op.handler.export]]));
  return createOperationRegistry({catalog:operationCatalog,validators,handlers:mapped});
}
const output=result=>{assert.equal(result.execution.state,'succeeded',JSON.stringify(result));return result.execution.output;};

test('OpenAI key and config commit atomically in D1 without exposing plaintext',{timeout:90000},async()=>{
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-openai-integration'},d1Persist:false});
  try{
    const db=await runtime.getD1Database('DB');
    const access=generateD1Schema('creezio.access',accessModels);
    await db.batch([...access.statements,...technical.statements,...schema.statements].map(sql=>db.prepare(sql)));
    const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
    const password='Synthetic OpenAI integration password';
    const owner=await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'openai-owner@example.invalid',
      displayName:'OpenAI owner',password});
    assert.equal(owner.ok,true);
    const login=await accounts.login({loginIdentifier:'openai-owner@example.invalid',password,audience:'admin'});
    assert.equal(login.ok,true);
    const acl=createAuthorizationService(db,{permissions}),before=await acl.readPolicy(login.token);
    assert.equal(before.ok,true);
    const policy=structuredClone(before.policy);
    policy.roles.push({id:'openai-admin',inherits:[],permissionIds:permissions.map(item=>item.id),permissionOverrides:[]});
    if(!policy.contexts.some(item=>item.id==='application'))policy.contexts.push({id:'application',status:'active'});
    if(!policy.memberships.some(item=>item.principalId===owner.principalId&&item.audience==='admin'
      &&item.contextId==='application'))policy.memberships.push({principalId:owner.principalId,
        audience:'admin',contextId:'application',status:'active'});
    policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId:'application',roleId:'openai-admin'});
    assert.equal((await acl.replacePolicy(login.token,{expectedEpoch:before.epoch,policy})).ok,true);
    const keyring=createVaultKeyring({activeKeyId:'test',keys:{test:new Uint8Array(32).fill(29)}});
    const provider=createOpenAiProviderHost({db,catalog,permissions,config:openAiConfigStorage,
      vault:openAiVaultStorage,keyring,transport:createOpenAITransport});
    const engine=createOperationEngine({db,catalog,registry:registry(),permissions,
      providerSecrets:{storage:openAiVaultStorage,keyring,providerId:'openai.responses.v1'},
      providerAvailability:async request=>provider.availability(request)});
    const invoke=(operationId,input)=>engine.invoke({credential:{kind:'session',token:login.token},
      moduleId,operationId,contextId:'application',audience:'admin',input});
    assert.equal(output(await invoke('config.read',{})).config.state,'missing');
    const secret='Synthetic test key with enough entropy to inspect ciphertext';
    const saved=output(await invoke('config.key.set',{requestKey:'key-create',apiKey:secret,
      modelId:'model-a',enabled:true,revision:0}));
    assert.equal(saved.config.revision,1);
    assert.doesNotMatch(JSON.stringify(saved),/Synthetic test key|creezio-secret/);
    const config=await db.prepare(`SELECT * FROM "${schema.tables.provider_config}"`).first();
    const vault=await db.prepare(`SELECT * FROM "${schema.tables.provider_secret}"`).first();
    assert.equal(config.secret_version,1);
    assert.equal(vault.binding_id,'openai.responses.v1');
    assert.equal(vault.version,1);
    assert.equal(vault.state,'active');
    assert.doesNotMatch(JSON.stringify(vault),/Synthetic test key/);
    assert.equal(output(await invoke('config.read',{})).config.state,'ready');
    const wrongKeyring=createVaultKeyring({activeKeyId:'test',keys:{test:new Uint8Array(32).fill(31)}});
    const unreadableProvider=createOpenAiProviderHost({db,catalog,permissions,config:openAiConfigStorage,
      vault:openAiVaultStorage,keyring:wrongKeyring,transport:createOpenAITransport});
    const providerRequest={credential:{kind:'session',token:login.token},contextId:'application',audience:'admin'};
    assert.equal((await unreadableProvider.availability(providerRequest)).state,'invalid');
    let enteredTransport=false;
    await assert.rejects(unreadableProvider.withTransport(providerRequest,async()=>{
      enteredTransport=true;return null;
    }),{code:'unavailable'});
    assert.equal(enteredTransport,false);
    const stale=await invoke('config.key.set',{requestKey:'key-stale',apiKey:'Synthetic stale key',
      modelId:'model-a',enabled:true,revision:0});
    assert.notEqual(stale.execution.state,'succeeded');
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${schema.tables.provider_secret}"`).first()).n,1);
    assert.equal((await db.prepare(`SELECT revision FROM "${schema.tables.provider_config}"`).first()).revision,1);
    const rotations=await Promise.allSettled(['A','B'].map(suffix=>invoke('config.key.set',{
      requestKey:`key-rotate-${suffix}`,apiKey:`Synthetic replacement secret ${suffix}`,
      modelId:'model-a',enabled:true,revision:1})));
    assert.equal(rotations.filter(result=>result.status==='fulfilled'
      &&result.value.execution.state==='succeeded').length,1,JSON.stringify(rotations));
    assert.equal(rotations.filter(result=>result.status==='rejected'
      ||result.value.execution.state==='failed').length,1,JSON.stringify(rotations));
    const rotatedConfig=await db.prepare(`SELECT revision,secret_version FROM "${schema.tables.provider_config}"`).first();
    const rotatedVault=await db.prepare(`SELECT version,ciphertext FROM "${schema.tables.provider_secret}"`).first();
    assert.equal(rotatedConfig.revision,2);
    assert.equal(rotatedConfig.secret_version,2);
    assert.equal(rotatedVault.version,2);
    assert.doesNotMatch(rotatedVault.ciphertext,/Synthetic replacement secret/);
    const revisions=await Promise.allSettled([false,true].map((enabled,index)=>invoke('config.set',{
      requestKey:`model-race-${index}`,modelId:'model-a',enabled,revision:2})));
    assert.equal(revisions.filter(result=>result.status==='fulfilled'
      &&result.value.execution.state==='succeeded').length,1,JSON.stringify(revisions));
    assert.equal(revisions.filter(result=>result.status==='rejected'
      ||result.value.execution.state==='failed').length,1,JSON.stringify(revisions));
    assert.equal((await db.prepare(`SELECT revision FROM "${schema.tables.provider_config}"`).first()).revision,3);
    const changedModel=output(await invoke('config.set',{requestKey:'model-exact-change',
      modelId:'model-new-exact',enabled:true,revision:3}));
    assert.equal(changedModel.config.modelId,'model-new-exact');
    assert.equal(changedModel.config.revision,4);
    assert.deepEqual((await provider.availability({credential:{kind:'session',token:login.token},
      contextId:'application',audience:'admin'})).modelIds,['model-new-exact']);
  }finally{await runtime.dispose();}
});
