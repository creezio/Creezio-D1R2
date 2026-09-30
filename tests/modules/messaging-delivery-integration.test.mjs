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
import {createDataAccess} from '../../core/data/service.ts';
import {createFileService} from '../../core/files/service.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';
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
const fileCatalog={compositionDigest:digest,categories:modules[0].manifest.contracts.files.map(category=>({
  moduleId:'creezio.messaging',category,audiences:['admin','app']}))};
const good=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value;};
const success=value=>{assert.equal(value.execution.state,'succeeded',JSON.stringify(value));return value.execution.output;};

function registry(overrides={}){
  const ajv=addFormats(new Ajv2020({strict:true,allErrors:false,coerceTypes:false,removeAdditional:false}));
  const validators={},handlers={},catalogModules=[];
  for(const {manifest,handlers:source} of modules){
    const moduleId=manifest.identity.id,names=new Map();
    for(const [index,item] of manifest.contracts.schemas.entries()){
      const name=`${moduleId}_schema_${index}`;names.set(item.id,name);validators[name]=ajv.compile(item.schema);
    }
    for(const op of manifest.contracts.operations)handlers[`${moduleId}:${op.id}`]=
      overrides[`${moduleId}:${op.id}`]??source[op.handler.export];
    catalogModules.push({moduleId,version:manifest.identity.version,enabled:true,
      schemas:[...names].map(([schemaId,validator])=>({schemaId,validator})),
      operations:manifest.contracts.operations.map(operation=>({operation,active:true,contractDigest:digest,
        inputValidator:names.get(operation.input.schemaId),outputValidator:names.get(operation.output.schemaId)}))});
  }
  return createOperationRegistry({catalog:{schemaVersion:1,compositionDigest:digest,modules:catalogModules},
    validators,handlers});
}

test('Messaging commits one immutable snapshot and canonical outbox intent against Resend readiness in real D1',
  {timeout:120000},async()=>{
    const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
      compatibilityDate:'2026-05-15',script:'export default {fetch(){return new Response(null,{status:404})}}',
      d1Databases:{DB:'creezio-messaging-delivery-proof'},r2Buckets:['BUCKET'],
      d1Persist:false,r2Persist:false});
    try{
      const db=await runtime.getD1Database('DB');
      const bucket=await runtime.getR2Bucket('BUCKET');
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
        (context_id,id,origin,from_address,key_ref,secret_version,connection_id,enabled,revision,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind('application','resend.api.v1','https://api.resend.com',
        'sender@example.invalid',reference,1,'connection-proof',1,4,'2026-09-30T00:00:00.000Z').run();
      await db.prepare(`INSERT INTO "${secretTable}"
        (context_id,id,binding_id,ciphertext,key_id,version,state)
        VALUES(?,?,?,?,?,?,?)`).bind('application',reference,'resend.api.v1',ciphertext,
        'delivery-proof-key',1,'active').run();
      const declaration=modules[0].manifest.contracts.deliveries[0];
      const receiptSchema=modules[0].manifest.contracts.schemas.find(item=>item.id===declaration.receipt.schemaId).schema;
      const validateReceipt=addFormats(new Ajv2020({strict:true})).compile(receiptSchema);
      let calls=0,revokeOnCall=false,loseAck=false;
      const providerKeys=[],providerBodies=[];
      const engineOptions={db,catalog,registry:registry(),permissions,
        files:{catalog:fileCatalog,bucket},
        providerAvailability:async(_request,providerId)=>({providerId,state:'ready',modelIds:[]}),
        connectors:[{descriptor:modules[1].manifest.contracts.connectors[0],keyring,
          fetcher:async(url,init)=>{
            if(init.method==='GET'&&String(url).endsWith('/emails/receiving/received-proof-1'))
              return Response.json({id:'received-proof-1',to:['sender@example.invalid'],
                from:'peer@example.invalid',subject:'Courriel reçu',text:'Bonjour\nCreezio',
                html:'<p>Bonjour</p><script>bad()</script>',
                created_at:'2026-09-30T02:00:00.000Z',attachments:[]});
            calls++;
            assert.equal(init.method,'POST');
            providerKeys.push(init.headers.get('Idempotency-Key'));
            providerBodies.push(JSON.parse(init.body));
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
      const eventTable=schemas['creezio.resend'].tables.webhook_event;
      await db.prepare(`INSERT INTO "${eventTable}" (context_id,id,connection_id,event_type,email_id,
        body_digest,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?)`).bind('application','evt-delivered',
        'connection-proof','email.delivered','email-proof-1','a'.repeat(64),
        '2026-09-30T01:00:00.000Z','2026-09-30T01:00:01.000Z').run();
      const beforeReconcile=await db.prepare(`SELECT revision FROM "${messageTable}" WHERE id=?`)
        .bind(intentId).first();
      const reconciled=success(await invoke('message.delivery.reconcile',{
        requestKey:'delivery-reconcile-one',boxId:box.id,messageId:intentId,
        revision:beforeReconcile.revision})).message;
      assert.equal(reconciled.state,'delivered');
      assert.equal(calls,1,'signed receipt projection must not resend');
      await db.prepare(`INSERT INTO "${eventTable}" (context_id,id,connection_id,event_type,email_id,
        body_digest,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?)`).bind('application','evt-received',
        'connection-proof','email.received','received-proof-1','b'.repeat(64),
        '2026-09-30T02:00:00.000Z','2026-09-30T02:00:01.000Z').run();
      const imported=success(await invoke('message.inbound.import',{
        requestKey:'delivery-import-one',boxId:box.id,emailId:'received-proof-1'})).message;
      assert.equal(imported.direction,'inbound');
      assert.equal(imported.folder,'inbox');
      assert.equal(imported.text,'Bonjour\nCreezio');
      assert.doesNotMatch(imported.html,/<script>/u);
      assert.equal(calls,1,'inbound GET must not issue a send POST');
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
      const attachedDraft=success(await invoke('draft.create',
        {requestKey:'delivery-draft-attached',boxId:box.id})).draft;
      const attachedSaved=success(await invoke('draft.save',{requestKey:'delivery-save-attached',
        boxId:box.id,draftId:attachedDraft.id,revision:attachedDraft.revision,
        to:'file-recipient@example.invalid',cc:'',bcc:'',subject:'Pièce privée',
        text:'Binaire seulement dans le POST',html:''})).draft;
      const data=createDataAccess(db,{catalog,permissions});
      const lease=await data.authorize({kind:'session',token:admin.token},{contextId:'application',
        audience:'admin',actors:['user'],requiredPermissionIds:['creezio.messaging:use'],
        purpose:'operation'},{moduleId:'creezio.messaging'});
      const category=modules[0].manifest.contracts.files[0];
      const ownerId=await fileOwnerId(owner.principalId,'admin',category.ownerScope);
      const emptyDraft=success(await invoke('draft.create',
        {requestKey:'delivery-draft-empty-file',boxId:box.id})).draft;
      const emptySaved=success(await invoke('draft.save',{requestKey:'delivery-save-empty-file',
        boxId:box.id,draftId:emptyDraft.id,revision:emptyDraft.revision,
        to:'empty@example.invalid',cc:'',bcc:'',subject:'Pièce vide',
        text:'Envoi refusé avant intention',html:''})).draft;
      const bytes=new Uint8Array([0,1,2,42,127,128,254,255]);
      let staged,emptyStaged;
      try{
        const files=createFileService({data,catalog,moduleId:'creezio.messaging',
          category,bucket,ownerId});
        emptyStaged=await files.stage(lease,{ownerId,intentId:'delivery-empty-file',generation:'one',
          filename:'empty.txt',contentType:'text/plain',bytes:new Uint8Array(0)});
        staged=await files.stage(lease,{ownerId,intentId:'delivery-binary',generation:'one',
          filename:'preuve.bin',contentType:'application/pdf',bytes});
      }
      finally{data.dispose(lease);}
      const emptyLinked=success(await invoke('attachment.link',{requestKey:'delivery-link-empty-file',
        boxId:box.id,draftId:emptyDraft.id,revision:emptySaved.revision,staged:emptyStaged})).draft;
      const beforeEmpty=calls;
      const emptySend=await invoke('message.send',{requestKey:'delivery-send-empty-file',
        boxId:box.id,draftId:emptyDraft.id,revision:emptyLinked.revision});
      assert.equal(emptySend.execution.state,'failed');
      assert.equal(emptySend.execution.errorCode,'invalid_input');
      assert.equal(calls,beforeEmpty,'zero-byte attachment must fail before provider POST');
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${OPERATION_TABLES.outbox}"
        WHERE execution_id=?`).bind(emptySend.execution.id).first()).n,0);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${messageTable}"
        WHERE id=?`).bind(emptySend.execution.id).first()).n,0);
      const draftTable=schemas['creezio.messaging'].tables.draft;
      const preserved=await db.prepare(`SELECT revision,send_intent_id FROM "${draftTable}"
        WHERE id=?`).bind(emptyDraft.id).first();
      assert.equal(preserved.revision,emptyLinked.revision);
      assert.equal(preserved.send_intent_id,null);
      let attachedLinked=success(await invoke('attachment.link',{requestKey:'delivery-link-attached',
        boxId:box.id,draftId:attachedDraft.id,revision:attachedSaved.revision,staged})).draft;
      const stagedFiles=[staged];
      for(let index=1;index<50;index++){
        const nextLease=await data.authorize({kind:'session',token:admin.token},{contextId:'application',
          audience:'admin',actors:['user'],requiredPermissionIds:['creezio.messaging:use'],
          purpose:'operation'},{moduleId:'creezio.messaging'});
        let next;
        try{next=await createFileService({data,catalog,moduleId:'creezio.messaging',category,
          bucket,ownerId}).stage(nextLease,{ownerId,intentId:`delivery-binary-${index}`,generation:'one',
          filename:`preuve-${index}.bin`,contentType:'application/pdf',bytes:new Uint8Array([index])});}
        finally{data.dispose(nextLease);}
        stagedFiles.push(next);
        attachedLinked=success(await invoke('attachment.link',{requestKey:`delivery-link-${index}`,
          boxId:box.id,draftId:attachedDraft.id,revision:attachedLinked.revision,staged:next})).draft;
      }
      const attachedSend=await invoke('message.send',{requestKey:'delivery-send-attached',
        boxId:box.id,draftId:attachedDraft.id,revision:attachedLinked.revision});
      assert.equal(attachedSend.execution.state,'succeeded',JSON.stringify(attachedSend));
      assert.equal(providerBodies.at(-1).attachments.length,50);
      assert.deepEqual(providerBodies.at(-1).attachments.find(item=>item.filename==='preuve.bin'),
        {filename:'preuve.bin',content:Buffer.from(bytes).toString('base64')});
      const linkTable=schemas['creezio.messaging'].tables.message_attachment;
      const links=await db.prepare(`SELECT file_id,digest FROM "${linkTable}" WHERE message_id=?`)
        .bind(attachedSend.execution.id).all();
      assert.deepEqual(new Set(links.results.map(row=>row.file_id)),
        new Set(stagedFiles.map(file=>file.fileId)));
      assert.equal(links.results.find(row=>row.file_id===staged.fileId).digest,staged.digest);
      const attachmentOutbox=await db.prepare(`SELECT payload FROM "${OPERATION_TABLES.outbox}"
        WHERE execution_id=?`).bind(attachedSend.execution.id).first();
      assert.doesNotMatch(attachmentOutbox.payload,/preuve\.bin|AAECKn\+A\/v8=/u);
      const attachedCurrent=await db.prepare(`SELECT state,revision,provider_message_id FROM "${messageTable}"
        WHERE id=?`).bind(attachedSend.execution.id).first();
      assert.equal(attachedCurrent.state,'sent');
      await db.prepare(`INSERT INTO "${eventTable}" (context_id,id,connection_id,event_type,email_id,
        body_digest,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?)`).bind('application','evt-failed',
        'connection-proof','email.failed',attachedCurrent.provider_message_id,'c'.repeat(64),
        '2026-09-30T03:00:00.000Z','2026-09-30T03:00:01.000Z').run();
      const beforeFailed=calls;
      const failed=success(await invoke('message.delivery.reconcile',{
        requestKey:'delivery-reconcile-failed',boxId:box.id,messageId:attachedSend.execution.id,
        revision:attachedCurrent.revision})).message;
      assert.equal(failed.state,'failed');
      assert.equal(failed.folder,'sent','provider failure follows a known accepted send');
      assert.equal(failed.revision,attachedCurrent.revision+1);
      assert.equal(calls,beforeFailed,'webhook failure must not resend');
      await db.prepare(`INSERT INTO "${eventTable}" (context_id,id,connection_id,event_type,email_id,
        body_digest,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?)`).bind('application','evt-late-delivered',
        'connection-proof','email.delivered',attachedCurrent.provider_message_id,'d'.repeat(64),
        '2026-09-30T02:59:00.000Z','2026-09-30T03:01:00.000Z').run();
      const repeated=success(await invoke('message.delivery.reconcile',{
        requestKey:'delivery-reconcile-failed-repeat',boxId:box.id,messageId:attachedSend.execution.id,
        revision:failed.revision})).message;
      assert.equal(repeated.state,'failed');
      assert.equal(repeated.revision,failed.revision,'older late arrival cannot revise a terminal failure');
      const raceDraft=success(await invoke('draft.create',
        {requestKey:'delivery-draft-race',boxId:box.id})).draft;
      const raceLinked=success(await invoke('attachment.link',{requestKey:'delivery-link-race',
        boxId:box.id,draftId:raceDraft.id,revision:raceDraft.revision,staged})).draft;
      const raceEngine=createOperationEngine({...engineOptions,registry:registry({
        'creezio.messaging:message.send':async(_input,context)=>{
          const frozen={sourceModel:'draft_attachment',destinationModel:'message_attachment',
            sourceScope:{box_id:box.id,draft_id:raceDraft.id},
            destinationScope:{box_id:box.id,message_id:context.executionId},
            attachments:[{...staged,filename:'preuve.bin',contentType:'application/pdf',byteSize:8}]};
          await Promise.all([context.files.freezeLinks('attachments',frozen),
            context.files.freezeLinks('attachments',frozen)]);
          return {output:{}};
        }})});
      const race=await invoke('message.send',{requestKey:'delivery-send-race',boxId:box.id,
        draftId:raceDraft.id,revision:raceLinked.revision},raceEngine);
      assert.equal(race.execution.state,'failed');
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${OPERATION_TABLES.outbox}"
        WHERE execution_id=?`).bind(race.execution.id).first()).n,0);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${messageTable}"
        WHERE id=?`).bind(race.execution.id).first()).n,0);
      const revokedDraft=success(await invoke('draft.create',
        {requestKey:'delivery-draft-revoked',boxId:box.id},queueEngine)).draft;
      const revokedSaved=success(await invoke('draft.save',{requestKey:'delivery-save-revoked',
        boxId:box.id,draftId:revokedDraft.id,revision:revokedDraft.revision,
        to:'revoked@example.invalid',cc:'',bcc:'',subject:'Droits révoqués',text:'Privé',html:''},queueEngine)).draft;
      const revokedLinked=success(await invoke('attachment.link',{requestKey:'delivery-link-revoked',
        boxId:box.id,draftId:revokedDraft.id,revision:revokedSaved.revision,staged},queueEngine)).draft;
      const revokedSend=await invoke('message.send',{requestKey:'delivery-send-revoked',boxId:box.id,
        draftId:revokedDraft.id,revision:revokedLinked.revision},queueEngine);
      assert.equal(revokedSend.execution.state,'waiting');
      const currentPolicy=good(await acl.readPolicy(admin.token)),withoutGrant=structuredClone(currentPolicy.policy);
      withoutGrant.assignments=withoutGrant.assignments.filter(item=>item.roleId!=='mail-delivery');
      good(await acl.replacePolicy(admin.token,{expectedEpoch:currentPolicy.epoch,policy:withoutGrant}));
      const beforeRevoked=calls;
      const revokedDelivery=await engine.deliver({credential:{kind:'session',token:admin.token},
        moduleId:'creezio.messaging',deliveryId:'message-send',contextId:'application',audience:'admin',
        executionId:revokedSend.execution.id,intentId:revokedSend.execution.id}).catch(error=>error);
      assert.equal(revokedDelivery.code,'forbidden');
      assert.equal(calls,beforeRevoked,'revoked delivery rights must stop before R2 and Resend');
    }finally{await runtime.dispose();}
  });
