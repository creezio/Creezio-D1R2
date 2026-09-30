import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID,OPERATION_TABLES} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createVaultKeyring,createVaultReference} from '../../core/vault/crypto.ts';
import * as messagingHandlers from '../../extensions/native/messaging/module/operations.ts';
import * as resendHandlers from '../../extensions/connectors/resend/module/operations.ts';
import {projectDeliveryReceipt} from '../../extensions/native/messaging/module/delivery.ts';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const modules=[
  {manifest:json('../../extensions/native/messaging/module/manifest.json'),handlers:messagingHandlers},
  {manifest:json('../../extensions/connectors/resend/module/manifest.json'),handlers:resendHandlers},
];
const digest=`sha256-${'6'.repeat(64)}`;
const schemas=Object.fromEntries(modules.map(({manifest})=>[manifest.identity.id,
  generateD1Schema(manifest.identity.id,manifest.contracts.models)]));
const access=generateD1Schema('creezio.access',json('../../extensions/native/access/module/models.json'));
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permissions=modules.flatMap(({manifest})=>manifest.contracts.permissions.map(item=>({
  id:`${manifest.identity.id}:${item.id}`,audiences:item.audiences,actors:item.actors})));
const catalog={schemaVersion:1,compositionDigest:digest,modules:modules.map(({manifest})=>({
  moduleId:manifest.identity.id,version:manifest.identity.version,enabled:true,
  permissions:manifest.contracts.permissions,models:manifest.contracts.models.map(model=>({modelId:model.id,
    table:schemas[manifest.identity.id].tables[model.id],model}))}))};
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const success=value=>{assert.equal(value.execution.state,'succeeded',JSON.stringify(value));return value.execution.output;};

function registry(){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},handlers={},catalogModules=[];
  for(const {manifest,handlers:source} of modules){
    const moduleId=manifest.identity.id,names=new Map();
    for(const [index,item] of manifest.contracts.schemas.entries()){
      const name=`${moduleId}_schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
    }
    for(const op of manifest.contracts.operations)handlers[`${moduleId}:${op.id}`]=source[op.handler.export];
    catalogModules.push({moduleId,version:manifest.identity.version,enabled:true,
      schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
      operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
        inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))});
  }
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:catalogModules},
    validators,handlers});
}

test('Messaging commits one immutable snapshot and canonical outbox intent against Resend readiness in real D1',
  {timeout:40000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-messaging-delivery-proof'},d1Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      await db.batch([...access.statements,...technical.statements,
        ...modules.flatMap(({manifest})=>schemas[manifest.identity.id].statements)].map(sql=>db.prepare(sql)));
      const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
      const password='Synthetic Messaging delivery proof password';
      const owner=good(await accounts.bootstrap({token:bootstrap.token,
        loginIdentifier:'mail-delivery@example.invalid',displayName:'Mail delivery owner',password}));
      const admin=good(await accounts.login({loginIdentifier:'mail-delivery@example.invalid',password,audience:'admin'}));
      const acl=createAuthorizationService(db,{permissions}),before=good(await acl.readPolicy(admin.token));
      const policy=structuredClone(before.policy);
      policy.roles.push({id:'mail-delivery',inherits:[],permissionIds:['creezio.messaging:use','creezio.resend:use'],
        permissionOverrides:[]});
      policy.assignments.push({principalId:owner.principalId,audience:'admin',contextId:'application',
        roleId:'mail-delivery'});
      good(await acl.replacePolicy(admin.token,{expectedEpoch:before.epoch,policy}));
      const resendTable=schemas['creezio.resend'].tables.connector_config;
      const secretTable=schemas['creezio.resend'].tables.connector_secret;
      const keyring=createVaultKeyring({activeKeyId:'delivery-proof-key',
        keys:{'delivery-proof-key':new Uint8Array(32).fill(19)}});
      const reference=createVaultReference();
      const ciphertext=await keyring.seal({moduleId:'creezio.resend',contextId:'application',
        bindingId:'resend.api.v1',reference,version:1},'synthetic-resend-key');
      await db.prepare(`INSERT INTO "${resendTable}"
        (context_id,id,origin,from_address,key_ref,secret_version,enabled,revision,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind('application','resend.api.v1','https://api.resend.com',
        'sender@example.invalid',reference,1,1,4,'2026-09-30T00:00:00.000Z').run();
      await db.prepare(`INSERT INTO "${secretTable}"
        (context_id,id,binding_id,ciphertext,key_id,version,state)
        VALUES(?,?,?,?,?,?,?)`).bind('application',reference,'resend.api.v1',ciphertext,
        'delivery-proof-key',1,'active').run();
      const declaration=modules[0].manifest.contracts.deliveries[0];
      const receiptSchema=modules[0].manifest.contracts.schemas.find(item=>item.id===declaration.receipt.schemaId).schema;
      const validateReceipt=addFormats(new Ajv2020({strict:true})).compile(receiptSchema);
      let calls=0,revokeOnCall=false,loseAck=false;
      const providerKeys=[];
      const engineOptions={db,catalog,registry:registry(),permissions,
        providerAvailability:async(_request,providerId)=>({providerId,state:'ready',modelIds:[]}),
        connectors:[{descriptor:modules[1].manifest.contracts.connectors[0],keyring,
          fetcher:async(_url,init)=>{calls++;
            assert.equal(init.method,'POST');
            providerKeys.push(init.headers.get('Idempotency-Key'));
            if(revokeOnCall)await db.prepare(`UPDATE "${resendTable}" SET enabled=0,revision=revision+1
              WHERE context_id='application' AND id='resend.api.v1'`).run();
            if(loseAck)throw new Error('Synthetic transport failure after POST attempt');
            return Response.json({id:'email-proof-1'},{status:201});}}],
        deliveries:[{id:declaration.id,moduleId:'creezio.messaging',commandId:declaration.command.id,
          prepareId:declaration.prepare.id,providerModuleId:'creezio.resend',
          connectorId:declaration.provider.connectorId,resourceId:declaration.provider.resourceId,
          readinessId:declaration.provider.readiness.id,
          configRevisionField:declaration.provider.configRevisionField,
          prepareInput:declaration.prepareInput,
          matchFields:declaration.matchFields,envelopeField:declaration.envelopeField,
          projectorInput:declaration.projectorInput,acceptance:declaration.acceptance,
          modelIds:declaration.models.map(item=>item.id),validateReceipt,projector:projectDeliveryReceipt}]};
      const engine=createOperationEngine(engineOptions);
      const queueEngine=createOperationEngine({...engineOptions,deliveries:[]});
      let intentId='',secondIntentId='';
      const invoke=(operationId,input,target=engine)=>target.invoke({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',operationId,contextId:'application',audience:'admin',input});
      const box=success(await invoke('box.create',{requestKey:'delivery-box',name:'Envois',
        address:'sender@example.invalid'})).box;
      const draft=success(await invoke('draft.create',{requestKey:'delivery-draft',boxId:box.id})).draft;
      const saved=success(await invoke('draft.save',{requestKey:'delivery-save',boxId:box.id,draftId:draft.id,
        revision:draft.revision,to:'recipient@example.invalid',cc:'',bcc:'',subject:'Preuve durable',
        text:'Message de preuve sans envoi externe',html:'<p>Message de preuve</p>'})).draft;
      const sent=await invoke('message.send',{requestKey:'delivery-send',boxId:box.id,draftId:draft.id,
        revision:saved.revision});
      assert.equal(sent.execution.state,'succeeded',JSON.stringify(sent));
      assert.equal(sent.execution.output.message.state,'queued');
      intentId=sent.execution.id;
      assert.equal(providerKeys[0],`creezio-${intentId}`);
      assert.equal(sent.execution.output.draft.sendIntentId,intentId);
      const messageTable=schemas['creezio.messaging'].tables.message;
      const snapshotTable=schemas['creezio.messaging'].tables.send_snapshot;
      const message=await db.prepare(`SELECT state,folder FROM "${messageTable}" WHERE id=?`).bind(intentId).first();
      const snapshot=await db.prepare(`SELECT draft_revision,bcc_addr,payload_digest,config_revision FROM "${snapshotTable}"
        WHERE id=?`).bind(intentId).first();
      const outbox=await db.prepare(`SELECT intent_id,provider,provider_idempotency_key,state,payload
        FROM "${OPERATION_TABLES.outbox}" WHERE execution_id=?`).bind(intentId).first();
      assert.equal(message.state,'sent');assert.equal(message.folder,'sent');
      assert.equal(snapshot.draft_revision,saved.revision);assert.equal(snapshot.config_revision,4);
      assert.equal(snapshot.bcc_addr,'');assert.match(snapshot.payload_digest,/^[a-f0-9]{64}$/);
      assert.equal(outbox.intent_id,intentId);assert.equal(outbox.provider,'resend.api.v1');
      assert.equal(outbox.provider_idempotency_key,intentId);assert.equal(outbox.state,'succeeded');
      assert.equal(JSON.parse(outbox.payload).snapshotDigest,snapshot.payload_digest);
      const dispatch=()=>engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:intentId,intentId});
      const delivered=await dispatch();
      assert.equal(delivered.delivery.state,'succeeded',JSON.stringify({delivered,calls}));
      assert.equal(delivered.delivery.receipt.kind,'accepted');
      assert.equal(delivered.replayed,true);
      assert.equal(calls,1);
      const projected=await db.prepare(`SELECT state,folder,provider_message_id FROM "${messageTable}" WHERE id=?`)
        .bind(intentId).first();
      assert.deepEqual({...projected},{state:'sent',folder:'sent',provider_message_id:'email-proof-1'});
      const deliveryReplay=await dispatch();
      assert.equal(deliveryReplay.replayed,true);assert.equal(calls,1);
      const secondDraft=success(await invoke('draft.create',{requestKey:'delivery-draft-two',boxId:box.id})).draft;
      const secondSaved=success(await invoke('draft.save',{requestKey:'delivery-save-two',boxId:box.id,
        draftId:secondDraft.id,revision:secondDraft.revision,to:'recipient-two@example.invalid',
        cc:'',bcc:'',subject:'Preuve incertaine',text:'Message sans relance',html:''})).draft;
      revokeOnCall=true;
      const secondSend=await invoke('message.send',{requestKey:'delivery-send-two',boxId:box.id,
        draftId:secondDraft.id,revision:secondSaved.revision});
      assert.equal(secondSend.execution.state,'unknown');secondIntentId=secondSend.execution.id;
      assert.equal(providerKeys[1],`creezio-${secondIntentId}`);
      const unknown=await engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:secondIntentId,intentId:secondIntentId});
      assert.equal(unknown.delivery.state,'unknown');assert.equal(unknown.delivery.receipt.kind,'unknown');
      assert.equal(unknown.replayed,true);
      assert.equal(calls,2);
      const unknownMessage=await db.prepare(`SELECT state,folder FROM "${messageTable}" WHERE id=?`)
        .bind(secondIntentId).first();
      assert.deepEqual({...unknownMessage},{state:'unknown',folder:'outbox'});
      const unknownReplay=await engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:secondIntentId,intentId:secondIntentId});
      assert.equal(unknownReplay.replayed,true);assert.equal(calls,2);
      revokeOnCall=false;
      await db.prepare(`UPDATE "${resendTable}" SET enabled=1,revision=revision+1
        WHERE context_id='application' AND id='resend.api.v1'`).run();
      const queuedDraft=success(await invoke('draft.create',
        {requestKey:'delivery-draft-queued',boxId:box.id},queueEngine)).draft;
      const queuedSaved=success(await invoke('draft.save',{requestKey:'delivery-save-queued',
        boxId:box.id,draftId:queuedDraft.id,revision:queuedDraft.revision,
        to:'recipient-queued@example.invalid',cc:'',bcc:'',subject:'Configuration figée',
        text:'Le fournisseur ne doit pas recevoir ce message',html:''},queueEngine)).draft;
      const queuedSend=await invoke('message.send',{requestKey:'delivery-send-queued',boxId:box.id,
        draftId:queuedDraft.id,revision:queuedSaved.revision},queueEngine);
      assert.equal(queuedSend.execution.state,'waiting',JSON.stringify(queuedSend));
      const queuedId=queuedSend.execution.id;
      await db.prepare(`UPDATE "${resendTable}" SET from_address=?,revision=revision+1
        WHERE context_id='application' AND id='resend.api.v1'`).bind('new-sender@example.invalid').run();
      const beforeMismatch=calls;
      const mismatch=await engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:queuedId,intentId:queuedId});
      assert.equal(mismatch.delivery.state,'failed',JSON.stringify(mismatch));
      assert.equal(mismatch.delivery.receipt.kind,'rejected');
      assert.equal(calls,beforeMismatch,'changed configuration must not reach the POST fetcher');
      const mismatchReplay=await engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:queuedId,intentId:queuedId});
      assert.equal(mismatchReplay.replayed,true);assert.equal(calls,beforeMismatch);
      await db.prepare(`UPDATE "${resendTable}" SET from_address=?,revision=revision+1
        WHERE context_id='application' AND id='resend.api.v1'`).bind('sender@example.invalid').run();
      const lostDraft=success(await invoke('draft.create',
        {requestKey:'delivery-draft-lost',boxId:box.id},queueEngine)).draft;
      const lostSaved=success(await invoke('draft.save',{requestKey:'delivery-save-lost',
        boxId:box.id,draftId:lostDraft.id,revision:lostDraft.revision,
        to:'recipient-lost@example.invalid',cc:'',bcc:'',subject:'Accusé perdu',
        text:'Une seule tentative fournisseur',html:''},queueEngine)).draft;
      const lostSend=await invoke('message.send',{requestKey:'delivery-send-lost',boxId:box.id,
        draftId:lostDraft.id,revision:lostSaved.revision},queueEngine);
      assert.equal(lostSend.execution.state,'waiting',JSON.stringify(lostSend));
      const lostId=lostSend.execution.id;
      loseAck=true;
      const beforeLost=calls;
      const lost=await engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:lostId,intentId:lostId});
      assert.equal(lost.delivery.state,'unknown',JSON.stringify(lost));
      assert.equal(lost.delivery.receipt.kind,'unknown');
      assert.equal(calls,beforeLost+1);
      assert.equal(providerKeys.at(-1),`creezio-${lostId}`);
      loseAck=false;
      const lostReplay=await engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:lostId,intentId:lostId});
      assert.equal(lostReplay.replayed,true);assert.equal(lostReplay.delivery.state,'unknown');
      assert.equal(calls,beforeLost+1,'uncertain POST must never be repeated');
      const lostCommandReplay=await invoke('message.send',{requestKey:'delivery-send-lost',
        boxId:box.id,draftId:lostDraft.id,revision:lostSaved.revision});
      assert.equal(lostCommandReplay.replayed,true);
      assert.equal(lostCommandReplay.execution.id,lostId);
      assert.equal(lostCommandReplay.execution.state,'unknown');
      assert.equal(calls,beforeLost+1,'command replay must not repeat an uncertain POST');
      const replay=await invoke('message.send',{requestKey:'delivery-send',boxId:box.id,draftId:draft.id,
        revision:saved.revision});
      assert.equal(replay.replayed,true);assert.equal(replay.execution.id,intentId);
      const count=await db.prepare(`SELECT COUNT(*) AS total FROM "${snapshotTable}"`).first();
      assert.equal(count.total,4);
      const denied=await invoke('message.send',{requestKey:'delivery-send-again',boxId:box.id,draftId:draft.id,
        revision:saved.revision}).catch(error=>error);
      assert.equal(denied.code??denied.execution?.errorCode,'conflict');
    }finally{await runtime.dispose();}
  });
