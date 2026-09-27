import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS,OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService,provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createDataAccess} from '../../core/data/service.ts';
import {createFileService} from '../../core/files/service.ts';
import {dispatchFileHttp} from '../../core/files/http.ts';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';
import * as handlers from '../../extensions/native/conversations/module/operations.ts';

const manifest=JSON.parse(readFileSync(new URL('../../extensions/native/conversations/module/manifest.json',import.meta.url),'utf8'));
const accessModels=JSON.parse(readFileSync(new URL('../../extensions/native/access/module/models.json',import.meta.url),'utf8'));
const accessSchema=generateD1Schema('creezio.access',accessModels);
const moduleId=manifest.identity.id, digest=`sha256-${'c'.repeat(64)}`;
const generated=generateD1Schema(moduleId,manifest.contracts.models);
const technical=generateD1Schema(OPERATION_STORAGE_MODULE_ID,OPERATION_MODELS);
const permission=manifest.contracts.permissions.find(item=>item.id==='use');
const permissions=[{id:`${moduleId}:use`,audiences:permission.audiences,actors:permission.actors}];
const catalog={schemaVersion:1,compositionDigest:digest,modules:[{moduleId,version:manifest.identity.version,enabled:true,
  permissions:[permission],models:manifest.contracts.models.map(model=>({modelId:model.id,table:generated.tables[model.id],model}))}]};
const fileCatalog={compositionDigest:digest,categories:[{moduleId,category:manifest.contracts.files[0],audiences:['admin','app']}]};
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
const good=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result;};
const success=result=>{assert.equal(result.execution.state,'succeeded',JSON.stringify(result));return result.execution.output;};

test('Conversations operations use real D1 authority, CAS, cursors and atomic file publication',{timeout:90000},async t=>{
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,compatibilityDate:'2026-05-15',
    script:'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases:{DB:'creezio-conversations-integration'},r2Buckets:['BUCKET'],d1Persist:false,r2Persist:false});
  try{
    const db=await runtime.getD1Database('DB'),bucket=await runtime.getR2Bucket('BUCKET');
    await db.batch([...accessSchema.statements,...technical.statements,...generated.statements].map(sql=>db.prepare(sql)));
    const accounts=createAccountService(db),bootstrap=await provisionBootstrapCapability(db);
    const password='Synthetic conversations integration password';
    const owner=good(await accounts.bootstrap({token:bootstrap.token,loginIdentifier:'conversations-owner@example.invalid',
      displayName:'Conversation owner',password}));
    const ownerAdmin=good(await accounts.login({loginIdentifier:'conversations-owner@example.invalid',password,audience:'admin'}));
    const lifecycle=createAccountLifecycleService(db,{permissions});
    const invitation=good(await lifecycle.issueInvitation(ownerAdmin.token,{loginIdentifier:'conversations-other@example.invalid',
      displayName:'Other user'}));
    const other=good(await lifecycle.redeem({token:invitation.token,purpose:'invitation',password}));
    const otherAdmin=good(await accounts.login({loginIdentifier:'conversations-other@example.invalid',password,audience:'admin'}));
    const ownerApp=good(await accounts.login({loginIdentifier:'conversations-owner@example.invalid',password,audience:'app'}));
    const acl=createAuthorizationService(db,{permissions}),before=good(await acl.readPolicy(ownerAdmin.token));
    const policy=structuredClone(before.policy),permissionId=`${moduleId}:use`;
    policy.roles.push({id:'conversation-user',inherits:[],permissionIds:[permissionId],permissionOverrides:[]});
    for(const [principalId,audience,contextId] of [
      [owner.principalId,'admin','application'],[owner.principalId,'app','application'],
      [owner.principalId,'admin','other'],[other.principalId,'admin','application']]){
      if(contextId==='other'&&!policy.contexts.some(row=>row.id==='other'))policy.contexts.push({id:'other',status:'active'});
      if(!policy.memberships.some(row=>row.principalId===principalId&&row.audience===audience&&row.contextId===contextId))
        policy.memberships.push({principalId,audience,contextId,status:'active'});
      policy.assignments.push({principalId,audience,contextId,roleId:'conversation-user'});
    }
    good(await acl.replacePolicy(ownerAdmin.token,{expectedEpoch:before.epoch,policy}));
    let providerState='ready';
    const engine=createOperationEngine({db,catalog,registry:registry(),permissions,files:{catalog:fileCatalog,bucket},
      providerAvailability:async(_request,providerId)=>({providerId,state:providerState,modelIds:['model-a']})});
    const invoke=(operationId,input,{token=ownerAdmin.token,audience='admin',contextId='application'}={})=>
      engine.invoke({credential:{kind:'session',token},moduleId,operationId,contextId,audience,input});
    const first=success(await invoke('conversation.create',{requestKey:'create-first',mode:'chat',title:'Premier fil'})).conversation;
    const second=success(await invoke('conversation.create',{requestKey:'create-second',mode:'work',title:'Deuxième fil'})).conversation;
    assert.equal(first.revision,1);
    const privateRead={conversationId:first.id};
    for(const scope of [{token:otherAdmin.token},{token:ownerApp.token,audience:'app'},
      {token:ownerAdmin.token,contextId:'other'}]){
      const result=await invoke('conversation.read',privateRead,scope).catch(error=>error);
      assert.notEqual(result?.execution?.state,'succeeded');
    }
    const draft=success(await invoke('draft.save',{requestKey:'draft-first',conversationId:first.id,text:'Brouillon',revision:0}));
    assert.equal(draft.revision,1);
    const draftAgain=success(await invoke('draft.read',{conversationId:first.id}));
    assert.equal(draftAgain.text,'Brouillon');
    const updatedDraft=success(await invoke('draft.save',{requestKey:'draft-second',conversationId:first.id,
      text:'Brouillon repris',revision:1}));
    assert.equal(updatedDraft.revision,2);
    const added=success(await invoke('message.add',{requestKey:'message-first',conversationId:first.id,
      id:'user-message-1',body:'Contenu recherché',revision:1}));
    assert.equal(added.message.id,'user-message-1');
    const stale=await invoke('message.add',{requestKey:'message-stale',conversationId:first.id,
      id:'user-message-stale',body:'Ne pas écrire',revision:1}).catch(error=>error);
    assert.notEqual(stale?.execution?.state,'succeeded');
    const messages=success(await invoke('message.list',{conversationId:first.id,limit:1}));
    assert.deepEqual(messages.items.map(item=>item.id),['user-message-1']);
    const read=success(await invoke('conversation.read',{conversationId:first.id}));
    assert.equal(read.conversation.revision,2);
    const page=success(await invoke('conversation.list',{limit:1}));
    assert.equal(page.items.length,1);assert.ok(page.nextCursor);
    const next=success(await invoke('conversation.list',{limit:1,cursor:page.nextCursor}));
    assert.equal(next.items.length,1);assert.notEqual(page.items[0].id,next.items[0].id);
    const titleSearch=success(await invoke('conversation.search',{limit:2,query:'Premier'}));
    assert.equal(titleSearch.items[0].id,first.id);
    let messageSearchCursor,foundMessage=false;
    for(let pageNumber=0;pageNumber<8;pageNumber++){
      const searched=success(await invoke('conversation.search',{limit:2,query:'recherché',
        ...(messageSearchCursor?{cursor:messageSearchCursor}:{})}));
      if(searched.items.some(item=>item.id===first.id)){foundMessage=true;break;}
      if(!searched.nextCursor)break;
      messageSearchCursor=searched.nextCursor;
    }
    assert.equal(foundMessage,true);
    const archived=success(await invoke('conversation.archive',{requestKey:'archive-first',conversationId:first.id,revision:2}));
    assert.ok(archived.conversation.archivedAt);
    const active=success(await invoke('conversation.list',{limit:2}));
    assert.ok(active.items.every(item=>item.id!==first.id));
    const archivePage=success(await invoke('conversation.list',{limit:2,archived:true}));
    assert.equal(archivePage.items[0].id,first.id);
    const restored=success(await invoke('conversation.restore',{requestKey:'restore-first',conversationId:first.id,revision:3}));
    assert.equal(restored.conversation.archivedAt,null);
    const renamed=success(await invoke('conversation.rename',{requestKey:'rename-first',conversationId:first.id,
      title:'Fil renommé',revision:4}));
    assert.equal(renamed.conversation.revision,5);
    const data=createDataAccess(db,{catalog,permissions});
    const lease=await data.authorize({kind:'session',token:ownerAdmin.token},
      {contextId:'application',audience:'admin',actors:['user'],requiredPermissionIds:[permissionId],purpose:'operation'},
      {moduleId});
    const ownerId=await fileOwnerId(owner.principalId,'admin');
    const files=createFileService({data,catalog,moduleId,category:manifest.contracts.files[0],bucket,ownerId});
    const staged=await files.stage(lease,{ownerId,intentId:'conversation-file-1',generation:'1',
      filename:'note.txt',contentType:'text/plain',bytes:new TextEncoder().encode('private note')});
    const linked=success(await invoke('attachment.link',{requestKey:'attachment-first',conversationId:first.id,
      revision:5,staged}));
    assert.equal(linked.fileId,staged.fileId);
    const attachment=success(await invoke('attachment.list',{conversationId:first.id,limit:50}));
    assert.equal(attachment.items[0].reference.fileId,staged.fileId);
    const metadataTable=`"${generated.tables.file_metadata}"`;
    const metadata=await db.prepare(`SELECT state FROM ${metadataTable} WHERE file_id=?`).bind(staged.fileId).first();
    assert.equal(metadata.state,'available');
    const rejectedStage=await files.stage(lease,{ownerId,intentId:'conversation-file-rejected',generation:'1',
      filename:'rejected.txt',contentType:'text/plain',bytes:new TextEncoder().encode('unpublished')});
    const badLink=await invoke('attachment.link',{requestKey:'attachment-stale',conversationId:first.id,
      revision:5,staged:rejectedStage}).catch(error=>error);
    assert.notEqual(badLink?.execution?.state,'succeeded');
    assert.equal((await db.prepare(`SELECT state FROM ${metadataTable} WHERE file_id=?`).bind(rejectedStage.fileId).first()).state,'staged');
    const origin='http://127.0.0.1:8787';
    const deleteUrl=`${origin}/api/files/admin/${moduleId}/attachments?${new URLSearchParams(rejectedStage)}`;
    const removed=await dispatchFileHttp(new Request(deleteUrl,{method:'DELETE',headers:{
      cookie:`creezio-local-admin=${ownerAdmin.token}`,'x-creezio-context':'application',origin,
      'x-creezio-request':'1'}}),{profile:'local',bindings:{DB:db,BUCKET:bucket}},
      {CREEZIO_APP_ORIGIN:origin},'conversation-abandon',{catalog,files:fileCatalog,permissions});
    assert.equal(removed.status,200,await removed.clone().text());
    assert.equal((await db.prepare(`SELECT state FROM ${metadataTable} WHERE file_id=?`).bind(rejectedStage.fileId).first()).state,'abandoned');
    const utf8='漢'.repeat(16000);
    let revision=6;
    for(let index=0;index<5;index++){
      const message=success(await invoke('message.add',{requestKey:`utf8-message-${index}`,conversationId:first.id,
        id:`utf8-message-${index}`,body:utf8,revision:revision++}));
      assert.equal(message.message.body,utf8);
    }
    const escaped='\u0001'.repeat(10000);
    success(await invoke('message.add',{requestKey:'escaped-message',conversationId:first.id,
      id:'escaped-message',body:escaped,revision}));
    const seenMessages=[];let messageCursor;
    for(let pageNumber=0;pageNumber<8;pageNumber++){
      const page=success(await invoke('message.list',{conversationId:first.id,limit:50,
        ...(messageCursor?{cursor:messageCursor}:{})}));
      assert.equal(page.items.length,1);
      seenMessages.push(...page.items);
      if(!page.nextCursor)break;
      messageCursor=page.nextCursor;
    }
    assert.equal(seenMessages.length,7);
    assert.equal(new Set(seenMessages.map(item=>item.id)).size,7);
    assert.deepEqual(seenMessages.map(item=>item.id),[...seenMessages].sort((a,b)=>
      b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).map(item=>item.id));
    assert.notEqual(seenMessages[0].id,'user-message-1');
    assert.equal(seenMessages.filter(item=>item.body===utf8).length,5);
    assert.equal(seenMessages.find(item=>item.id==='escaped-message')?.body,escaped);
    const utf8Draft=success(await invoke('draft.save',{requestKey:'utf8-draft',conversationId:first.id,
      text:utf8,revision:2}));
    assert.equal(utf8Draft.revision,3);
    assert.equal(success(await invoke('draft.read',{conversationId:first.id})).text,utf8);
    const secondDraft=success(await invoke('draft.save',{requestKey:'turn-draft',conversationId:second.id,
      text:'Question en attente',revision:0}));
    assert.equal(secondDraft.revision,1);
    const startInput={conversationId:second.id,messageId:'turn-user-message',body:'Question en attente',
      revision:1,draftRevision:1,modelId:'model-a'};
    providerState='missing';
    const unavailable=await invoke('turn.start',{requestKey:'turn-unavailable',...startInput}).catch(error=>error);
    assert.notEqual(unavailable?.execution?.state,'succeeded');
    assert.equal(success(await invoke('draft.read',{conversationId:second.id})).text,'Question en attente');
    assert.deepEqual(success(await invoke('message.list',{conversationId:second.id,limit:1})).items,[]);
    providerState='ready';
    const startedExecution=await invoke('turn.start',{requestKey:'turn-start',...startInput});
    assert.equal(startedExecution.execution.state,'waiting');
    const started=startedExecution.execution.output;
    assert.equal(started.message.id,startInput.messageId);
    assert.equal(started.turn.state,'queued');
    assert.equal(started.turn.providerId,'openai.responses.v1');
    assert.equal(success(await invoke('draft.read',{conversationId:second.id})).text,'');
    assert.equal(success(await invoke('conversation.read',{conversationId:second.id})).provider,'configured');
    assert.equal(success(await invoke('conversation.read',{conversationId:second.id})).conversation.revision,2);
    assert.equal(success(await invoke('turn.read',{conversationId:second.id,turnId:started.turn.id})).turn.state,'queued');
    const turnEvents=success(await invoke('event.list',{conversationId:second.id,turnId:started.turn.id,
      limit:50,afterSequence:0}));
    assert.deepEqual(turnEvents.items.map(item=>item.kind),['queued']);
    const blocked=await invoke('turn.start',{requestKey:'turn-concurrent',...startInput,
      messageId:'turn-second-message',revision:2,draftRevision:2}).catch(error=>error);
    assert.notEqual(blocked?.execution?.state,'succeeded');
    assert.deepEqual(success(await invoke('message.list',{conversationId:second.id,limit:1})).items.map(item=>item.id),
      ['turn-user-message']);
    const outboxTable=`"${technical.tables.outbox}"`;
    const delivery=await db.prepare(`SELECT provider,intent_id,state,payload FROM ${outboxTable} WHERE intent_id=?`)
      .bind(started.turn.id).all();
    assert.equal(delivery.results.length,1);
    assert.equal(delivery.results[0].provider,'openai.responses.v1');
    assert.equal(delivery.results[0].state,'queued');
    assert.equal(JSON.parse(delivery.results[0].payload).messageId,startInput.messageId);
    const eventTable=`"${generated.tables.event}"`,now=new Date().toISOString();
    await db.batch(Array.from({length:50},(_,index)=>db.prepare(`INSERT INTO ${eventTable}
      (context_id,owner_id,audience,conversation_id,turn_id,sequence,kind,payload,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind('application',owner.principalId,'admin',second.id,
      started.turn.id,index+2,'text_delta',JSON.stringify({text:'x'}),now)));
    const eventPage=success(await invoke('event.list',{conversationId:second.id,turnId:started.turn.id,
      limit:50,afterSequence:0}));
    assert.equal(eventPage.items.length,50);
    assert.equal(eventPage.nextSequence,50);
    const eventRemainder=success(await invoke('event.list',{conversationId:second.id,turnId:started.turn.id,
      limit:50,afterSequence:eventPage.nextSequence}));
    assert.deepEqual(eventRemainder.items.map(item=>item.sequence),[51]);
    assert.equal(eventRemainder.nextSequence,null);
    const escapedBody='\\'.repeat(16000);
    await db.prepare(`UPDATE ${eventTable} SET payload=? WHERE context_id=? AND owner_id=? AND audience=?
      AND conversation_id=? AND turn_id=? AND sequence>1`).bind(JSON.stringify({text:'x',body:escapedBody}),
      'application',owner.principalId,'admin',second.id,started.turn.id).run();
    const escapedEvents=[];let escapedAfter=1;
    for(let pageNumber=0;pageNumber<20;pageNumber++){
      const page=success(await invoke('event.list',{conversationId:second.id,turnId:started.turn.id,
        limit:50,afterSequence:escapedAfter}));
      assert.ok(new TextEncoder().encode(JSON.stringify(page)).length<=128*1024);
      assert.ok(page.items.every(item=>item.payload.body===escapedBody));
      escapedEvents.push(...page.items);
      if(page.nextSequence===null)break;
      assert.ok(page.nextSequence>escapedAfter);
      escapedAfter=page.nextSequence;
    }
    assert.deepEqual(escapedEvents.map(item=>item.sequence),Array.from({length:50},(_,index)=>index+2));
    data.dispose(lease);
    assert.equal(second.revision,1);
  }finally{await runtime.dispose();}
});

test('the declared Conversations MCP list tool is callable through the native transport',async()=>{
  const registered=registry(),origin='https://conversations.example.invalid';
  const composition={modules:[{moduleId,enabled:true}],exposure:{admin:{moduleIds:[moduleId]},app:{moduleIds:[moduleId]}}};
  const mcpCatalog=compileMcpBindings({composition,modules:[manifest],operationCatalog:registered.catalog});
  const calls=[];
  const engine={async invoke(request){calls.push(request);return {execution:{id:'mcp-execution',state:'succeeded',
    output:{items:[],nextCursor:null},errorCode:null},replayed:false};}};
  const transport=createMcpHttpTransport(mcpCatalog,registered,engine,{origin,
    resourceMetadataUrl:audience=>`${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
    authenticate:async(_request,audience,resource)=>({credential:{kind:'oauth',token:'synthetic-oauth',resource},
      contextId:audience==='app'?'application':'other'}),
    canDiscover:async(_identity,target)=>target.permissionIds.includes(`${moduleId}:use`)});
  const fetcher=(input,init)=>{const request=new Request(input,init);return transport.dispatch(request,
    new URL(request.url).pathname.endsWith('/admin')?'admin':'app','conversations-mcp');};
  const client=new Client({name:'conversations-integration',version:'1.0.0'});
  const wire=new StreamableHTTPClientTransport(new URL(`${origin}/mcp/app`),
    {fetch:fetcher,authProvider:{token:async()=>'synthetic-oauth'}});
  try{
    await client.connect(wire);
    const listed=await client.listTools();
    assert.ok(listed.tools.some(tool=>tool.name==='conversations_conversation_list'));
    const result=await client.callTool({name:'conversations_conversation_list',arguments:{limit:2}});
    assert.deepEqual(result.structuredContent,{items:[],nextCursor:null});
    assert.equal(calls.length,1);
    assert.equal(calls[0].operationId,'conversation.list');
    assert.equal(calls[0].audience,'app');
    assert.equal(calls[0].credential.kind,'oauth');
  }finally{await client.close();}
});
