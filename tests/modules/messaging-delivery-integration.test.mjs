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
  {timeout:240000},async()=>{
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
      let calls=0,inboundGets=0,revokeOnCall=false,loseAck=false;
      const providerKeys=[],providerBodies=[];
      const receivedFixtures=new Map([['received-proof-zero',{count:0}]]);
      const engineOptions={db,catalog,registry:registry(),permissions,
        files:{catalog:fileCatalog,bucket},
        providerAvailability:async(_request,providerId)=>({providerId,state:'ready',modelIds:[]}),
        connectors:[{descriptor:modules[1].manifest.contracts.connectors[0],keyring,
          fetcher:async(url,init)=>{
            if(init.method==='GET'){
              inboundGets++;
              const parsed=new URL(String(url)),parts=parsed.pathname.split('/').filter(Boolean);
              if(parsed.hostname==='api.resend.com'&&parts[0]==='emails'&&parts[1]==='receiving'){
                const emailId=parts[2],fixture=receivedFixtures.get(emailId);
                if(!fixture)return Response.json({message:'unknown email'},{status:404});
                if(parts.length===3)return Response.json({id:emailId,to:['sender@example.invalid'],
                  from:'peer@example.invalid',subject:'Courriel reçu',text:'Bonjour\nCreezio',
                  html:'<p>Bonjour</p><script>bad()</script>',
                  created_at:'2026-09-30T02:00:00.000Z',attachments:Array.from({length:fixture.count},(_,index)=>({
                    id:`child-${index}`,filename:`proof-${index}.txt`,content_type:'text/plain',size:8}))});
                if(parts[3]==='attachments'&&parts.length===5){
                  const childId=parts[4];
                  return Response.json({id:childId,filename:`proof-${Number(childId.slice(6))}.txt`,
                    content_type:'text/plain',size:8,
                    download_url:`https://inbound-cdn.resend.com/${emailId}/attachments/${childId}?token=synthetic`});
                }
              }
              if(parsed.hostname==='inbound-cdn.resend.com'&&parts[1]==='attachments')
                return new Response(new Uint8Array([112,114,111,111,102,45,48,49]),
                  {status:200,headers:{'content-length':'8','content-type':'text/plain'}});
              return Response.json({message:'unknown GET'},{status:404});
            }
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
        'connection-proof','email.received','received-proof-zero','b'.repeat(64),
        '2026-09-30T02:00:00.000Z','2026-09-30T02:00:01.000Z').run();
      const prepared=success(await invoke('message.inbound.prepare',{
        requestKey:'delivery-prepare-one',boxId:box.id,emailId:'received-proof-zero'})).snapshot;
      assert.equal(prepared.emailId,'received-proof-zero');
      assert.deepEqual(prepared.attachments,[]);
      assert.equal(prepared.imported,false);
      const imported=success(await invoke('message.inbound.import',{
        requestKey:'delivery-import-one',boxId:box.id,emailId:'received-proof-zero'})).message;
      assert.equal(imported.direction,'inbound');
      assert.equal(imported.folder,'inbox');
      assert.equal(imported.text,'Bonjour\nCreezio');
      assert.doesNotMatch(imported.html,/<script>/u);
      const importedStatus=success(await invoke('message.inbound.status',{
        boxId:box.id,emailId:'received-proof-zero'})).snapshot;
      assert.equal(importedStatus.imported,true);
      assert.equal(calls,1,'inbound GET must not issue a send POST');
      const inboundSnapshotTable=schemas['creezio.messaging'].tables.inbound_snapshot;
      await db.prepare(`DELETE FROM "${inboundSnapshotTable}" WHERE id=?`).bind(imported.id).run();
      const legacyTrash=success(await invoke('message.update',{
        requestKey:'received-legacy-trash',boxId:box.id,messageId:imported.id,
        revision:imported.revision,folder:'trash'})).message;
      const legacyDelete=await invoke('message.delete',{
        requestKey:'received-legacy-delete-denied',boxId:box.id,
        messageId:legacyTrash.id,revision:legacyTrash.revision});
      assert.equal(legacyDelete.execution.errorCode,'conflict');
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${messageTable}" WHERE id=?`)
        .bind(imported.id).first()).n,1,'legacy row without snapshot cannot be removed');
      let fiftyMessage=null,fiftyFile=null,fiftyInboundRefs=[];
      for(const count of [1,50]){
        const emailId=`received-proof-${count}`,beforeGets=inboundGets;
        receivedFixtures.set(emailId,{count});
        await db.prepare(`INSERT INTO "${eventTable}" (context_id,id,connection_id,event_type,email_id,
          body_digest,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?)`).bind('application',
          `evt-received-${count}`,'connection-proof','email.received',emailId,
          'c'.repeat(64),'2026-09-30T02:00:00.000Z','2026-09-30T02:00:01.000Z').run();
        const before=await invoke('message.inbound.import',{
          requestKey:`delivery-import-early-${count}`,boxId:box.id,emailId});
        assert.equal(before.execution.state,'failed');
        assert.equal(before.execution.errorCode,'not_found');
        const ready=success(await invoke('message.inbound.prepare',{
          requestKey:`delivery-prepare-${count}`,boxId:box.id,emailId})).snapshot;
        assert.equal(ready.attachments.length,count);
        assert.equal(ready.stagedChildIds.length,0);
        for(const child of ready.attachments){
          const stageResult=await invoke('message.inbound.attachment.stage',{
            requestKey:`delivery-stage-${count}-${child.id}`,boxId:box.id,emailId,
            childId:child.id});
          assert.equal(stageResult.execution.state,'succeeded',JSON.stringify({stageResult,inboundGets}));
          const stage=stageResult.execution.output;
          assert.equal(stage.childId,child.id);
          assert.equal(stage.staged,true);
        }
        const staged=success(await invoke('message.inbound.status',{boxId:box.id,emailId})).snapshot;
        assert.equal(staged.stagedChildIds.length,count);
        const stageGets=inboundGets;
        const published=success(await invoke('message.inbound.import',{
          requestKey:`delivery-import-${count}`,boxId:box.id,emailId})).message;
        assert.equal(published.direction,'inbound');
        assert.equal(inboundGets,stageGets,'import must use the frozen snapshot and receipts only');
        const listed=success(await invoke('message.attachment.list',{
          boxId:box.id,messageId:published.id,limit:50}));
        assert.equal(listed.items.length,count);
        assert.equal(listed.nextCursor,null);
        assert.equal(new Set(listed.items.map(item=>item.fileId)).size,count);
        if(count===50){
          fiftyMessage=published;
          fiftyFile=listed.items[0].fileId;
          fiftyInboundRefs=listed.items.map(item=>item.reference);
        }
        const replay=success(await invoke('message.inbound.import',{
          requestKey:`delivery-import-replay-${count}`,boxId:box.id,emailId})).message;
        assert.equal(replay.id,published.id);
        assert.equal(inboundGets,stageGets);
        assert.ok(stageGets-beforeGets>=1+2*count);
      }
      const trashed=success(await invoke('message.update',{requestKey:'received-50-trash',
        boxId:box.id,messageId:fiftyMessage.id,revision:fiftyMessage.revision,folder:'trash'})).message;
      const staleDelete=await invoke('message.delete',{requestKey:'received-50-delete-stale',
        boxId:box.id,messageId:trashed.id,revision:fiftyMessage.revision});
      assert.equal(staleDelete.execution.state,'failed');
      assert.equal(staleDelete.execution.errorCode,'conflict');
      const firstDeleteInput={requestKey:'received-50-delete-1',boxId:box.id,
        messageId:trashed.id,revision:trashed.revision};
      const firstDelete=success(await invoke('message.delete',firstDeleteInput));
      assert.deepEqual({...firstDelete},{deleted:false,revision:trashed.revision+1,removed:13});
      const replayedDelete=success(await invoke('message.delete',firstDeleteInput));
      assert.deepEqual({...replayedDelete},{...firstDelete},'same key must not remove a second batch');
      const attachmentTable=schemas['creezio.messaging'].tables.message_attachment;
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${attachmentTable}" WHERE message_id=?`)
        .bind(trashed.id).first()).n,37);
      let progress=firstDelete;
      for(let step=2;step<=4;step++){
        progress=success(await invoke('message.delete',{requestKey:`received-50-delete-${step}`,
          boxId:box.id,messageId:trashed.id,revision:progress.revision}));
        assert.equal(progress.removed,step===4?11:13);
        assert.equal(progress.deleted,step===4);
      }
      assert.equal(progress.revision,null);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${attachmentTable}" WHERE message_id=?`)
        .bind(trashed.id).first()).n,0);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${messageTable}" WHERE id=?`)
        .bind(trashed.id).first()).n,0);
      const deletedRead=await invoke('message.read',{boxId:box.id,messageId:trashed.id});
      assert.equal(deletedRead.execution.errorCode,'not_found');
      const tombstone=await db.prepare(`SELECT deleted_at,subject,text_body,html_body,attachments
        FROM "${inboundSnapshotTable}" WHERE id=?`).bind(trashed.id).first();
      assert.match(tombstone.deleted_at,/^\d{4}-\d\d-\d\dT/);
      assert.deepEqual([tombstone.subject,tombstone.text_body,tombstone.html_body,
        JSON.parse(tombstone.attachments)],['','','',[]]);
      const beforeBlocked=inboundGets;
      for(const operationId of ['message.inbound.status','message.inbound.import','message.inbound.prepare']){
        const denied=await invoke(operationId,{boxId:box.id,emailId:'received-proof-50',
          ...(operationId==='message.inbound.status'?{}:{requestKey:`deleted-${operationId}`})});
        assert.equal(denied.execution.errorCode,'not_found',operationId);
      }
      assert.equal(inboundGets,beforeBlocked,'deleted snapshot must not re-read the provider');
      const metadataTable=schemas['creezio.messaging'].tables.file_metadata;
      assert.equal((await db.prepare(`SELECT state FROM "${metadataTable}" WHERE file_id=?`)
        .bind(fiftyFile).first()).state,'available','private R2 file lifecycle remains separate');
      const secondBox=success(await invoke('box.create',{requestKey:'delivery-second-box',
        name:'Réception bis',address:'sender@example.invalid'})).box;
      const secondSnapshot=success(await invoke('message.inbound.prepare',{
        requestKey:'delivery-second-box-prepare',boxId:secondBox.id,
        emailId:'received-proof-1'})).snapshot;
      assert.equal(secondSnapshot.attachments.length,1);
      const secondStage=success(await invoke('message.inbound.attachment.stage',{
        requestKey:'delivery-second-box-stage',boxId:secondBox.id,
        emailId:'received-proof-1',childId:'child-0'}));
      const firstLink=success(await invoke('message.attachment.list',{
        boxId:box.id,messageId:secondSnapshot.id,limit:50})).items[0];
      assert.notEqual(secondStage.fileId,firstLink.fileId,
        'the same received email and child in another box must have a distinct R2 identity');
      const secondMessage=success(await invoke('message.inbound.import',{
        requestKey:'delivery-second-box-import',boxId:secondBox.id,
        emailId:'received-proof-1'})).message;
      const secondLink=success(await invoke('message.attachment.list',{
        boxId:secondBox.id,messageId:secondMessage.id,limit:50})).items[0];
      assert.equal(secondLink.fileId,secondStage.fileId);
      assert.notEqual(secondLink.fileId,firstLink.fileId);
      const receiptTable=schemas['creezio.messaging'].tables.inbound_stage_receipt;
      const prepareFixture=async(emailId,count)=>{
        receivedFixtures.set(emailId,{count});
        await db.prepare(`INSERT INTO "${eventTable}" (context_id,id,connection_id,event_type,email_id,
          body_digest,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?)`).bind('application',
          `evt-${emailId}`,'connection-proof','email.received',emailId,
          'd'.repeat(64),'2026-09-30T02:00:00.000Z','2026-09-30T02:00:01.000Z').run();
        const snapshot=success(await invoke('message.inbound.prepare',{
          requestKey:`prepare-${emailId}`,boxId:box.id,emailId})).snapshot;
        for(const child of snapshot.attachments)success(await invoke('message.inbound.attachment.stage',{
          requestKey:`stage-${emailId}-${child.id}`,boxId:box.id,emailId,childId:child.id}));
        return snapshot;
      };
      let raceMode=null;
      const inboundRaceEngine=createOperationEngine({...engineOptions,registry:registry({
        'creezio.messaging:message.inbound.import':async(value,context)=>{
          const result=await messagingHandlers.messageInboundImport(value,context);
          if(raceMode?.kind==='extra')await db.prepare(`INSERT INTO "${receiptTable}"
            (context_id,owner_id,box_id,snapshot_id,child_id,file_id,filename,content_type,
              byte_size,digest,intent_id,generation,created_at)
            SELECT context_id,owner_id,box_id,snapshot_id,'unexpected-child',?,filename,content_type,
              byte_size,digest,intent_id,generation,created_at FROM "${receiptTable}"
            WHERE snapshot_id=? LIMIT 1`).bind(`f1_${'d'.repeat(64)}`,raceMode.snapshotId).run();
          if(raceMode?.kind==='substitute')await db.prepare(`UPDATE "${receiptTable}"
            SET filename='substituted.txt' WHERE snapshot_id=?`).bind(raceMode.snapshotId).run();
          if(raceMode?.kind==='remove')await db.prepare(`DELETE FROM "${receiptTable}"
            WHERE snapshot_id=?`).bind(raceMode.snapshotId).run();
          return result;
        }})});
      for(const kind of ['extra','substitute','remove']){
        const emailId=`received-race-${kind}`,snapshot=await prepareFixture(emailId,1);
        raceMode={kind,snapshotId:snapshot.id};
        let failed=null,commitError=null;
        try{failed=await invoke('message.inbound.import',{
          requestKey:`import-race-${kind}`,boxId:box.id,emailId},inboundRaceEngine);}
        catch(error){commitError=error;}
        raceMode=null;
        assert.ok(commitError||failed?.execution.state!=='succeeded',JSON.stringify(failed));
        assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM "${messageTable}" WHERE id=?`)
          .bind(snapshot.id).first().then(row=>row.n),0);
        assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM "${attachmentTable}" WHERE message_id=?`)
          .bind(snapshot.id).first().then(row=>row.n),0);
      }
      for(const kind of ['revision','secret']){
        const emailId=`received-stale-${kind}`,snapshot=await prepareFixture(emailId,0);
        if(kind==='revision')await db.prepare(`UPDATE "${resendTable}" SET revision=revision+1
          WHERE context_id='application' AND id='resend.api.v1'`).run();
        else await db.prepare(`UPDATE "${secretTable}" SET state='revoked'
          WHERE context_id='application' AND id=?`).bind(reference).run();
        const failed=await invoke('message.inbound.import',{
          requestKey:`import-stale-${kind}`,boxId:box.id,emailId});
        assert.equal(failed.execution.state,'failed',JSON.stringify(failed));
        assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM "${messageTable}" WHERE id=?`)
          .bind(snapshot.id).first().then(row=>row.n),0);
        if(kind==='revision')await db.prepare(`UPDATE "${resendTable}" SET revision=4
          WHERE context_id='application' AND id='resend.api.v1'`).run();
        else await db.prepare(`UPDATE "${secretTable}" SET state='active'
          WHERE context_id='application' AND id=?`).bind(reference).run();
      }
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
      const stagedFiles=[staged,...fiftyInboundRefs.slice(0,49)];
      for(const [index,next] of fiftyInboundRefs.slice(0,49).entries()){
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
      const outboundTrash=success(await invoke('message.update',{
        requestKey:'delivery-outbound-trash',boxId:box.id,messageId:attachedSend.execution.id,
        revision:repeated.revision,folder:'trash'})).message;
      const outboundDelete=await invoke('message.delete',{
        requestKey:'delivery-outbound-delete-denied',boxId:box.id,
        messageId:outboundTrash.id,revision:outboundTrash.revision});
      assert.equal(outboundDelete.execution.errorCode,'conflict');
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${OPERATION_TABLES.outbox}"
        WHERE execution_id=?`).bind(attachedSend.execution.id).first()).n,1);
      assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM "${messageTable}"
        WHERE id=?`).bind(attachedSend.execution.id).first()).n,1);
      success(await invoke('message.update',{requestKey:'delivery-outbound-restore',
        boxId:box.id,messageId:outboundTrash.id,revision:outboundTrash.revision,folder:'sent'}));
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
