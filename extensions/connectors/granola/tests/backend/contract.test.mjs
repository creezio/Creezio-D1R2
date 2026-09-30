import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest} from '../helpers.mjs';
import {granolaConnectorDescriptor} from '../../module/storage.ts';
import {projectNoteList,projectFolderList,projectNoteDetail,projectTranscript} from '../../module/projection.ts';
import {configSet,configKeySet,configKeyRevoke,syncStart,syncPage,noteRefresh,transcriptPage} from '../../module/service.ts';
import {configWebhookSet,configWebhookRevoke,configWebhookServiceSet,
  configWebhookServiceRevoke,eventReceive} from '../../module/service.ts';
import {granolaWebhookInput} from '../../module/webhook.ts';

const noteId='not_1d3tmYTlCICgjy',folderId='fol_4y6LduVdwSKC27';
const note={id:noteId,object:'note',title:'Réunion',owner:{name:'Alice',email:'secret@example.invalid'},
  created_at:'2026-01-27T15:30:00Z',updated_at:'2026-01-27T16:45:00Z',metadata:{token:'hidden'}};
const config={id:'granola.api.v1',origin:'https://public-api.granola.ai',key_ref:'ref',secret_version:1,
  connection_id:'connection-a',enabled:true,revision:3,updated_at:'2026-09-30T00:00:00Z'};
const state={id:'notes',run_id:'run-a',connection_id:'connection-a',cursor:null,status:'partial',
  revision:4,updated_at:'2026-09-30T00:00:00Z'};
function harness({configuration=config,run=state,body={notes:[],hasMore:false,cursor:null},rows={}}={}){
  const calls=[];
  const context={signal:new AbortController().signal,data:{
    async get(model,{key}){calls.push({get:model,key});return model==='connector_config'?configuration:
      model==='sync_state'?run:rows[key.id]??null;},
    planCreate(model,args){calls.push({create:model,args});return {model,kind:'create'};},
    planPatch(model,args){calls.push({patch:model,args});return {model,kind:'patch'};},
    planGet(model,args){calls.push({guard:model,args});return {model,kind:'guard'};}
  },providerSecrets:{async preparePut(){return {plan:{secret:true},reference:'new-ref',version:1};},
    async prepareReplace(){return {plan:{secret:true},reference:'next-ref',version:2};},
    async prepareRevoke(){return {plan:{secret:true}};}},
  connector:{async request(request){calls.push({request});return {kind:'ok',status:200,body};}}};
  return {context,calls};
}
test('only official fixed HTTPS Granola GET routes and declared filters are exposed',()=>{
  assert.equal(granolaConnectorDescriptor.fixedOrigin,'https://public-api.granola.ai');
  assert.deepEqual(granolaConnectorDescriptor.resources.map(row=>[row.id,row.method,row.path]),[
    ['notes','GET','/v1/notes'],['note','GET','/v1/notes/{id}'],
    ['transcript','GET','/v1/notes/{id}/transcript'],['folders','GET','/v1/folders']]);
  assert.deepEqual(granolaConnectorDescriptor.resources[0].query.fields.map(row=>row.wireName),
    ['folder_id','created_after','created_before','updated_after']);
  assert.deepEqual(manifest.contracts.connectors,[granolaConnectorDescriptor]);
  assert.ok(manifest.contracts.permissions.every(row=>row.default==='deny'&&row.context==='required'));
});
test('whole supplier pages are validated; metadata and private owner email are discarded',()=>{
  const page=projectNoteList({notes:[note],hasMore:true,cursor:'opaque'},8);
  assert.equal(page.nextCursor,'opaque');assert.equal(page.rows[0].owner,'Alice');
  assert.doesNotMatch(JSON.stringify(page),/secret@example|metadata|hidden/u);
  assert.throws(()=>projectNoteList({notes:[note,note],hasMore:false,cursor:null},8),{code:'unavailable'});
  assert.throws(()=>projectNoteList({notes:[note],hasMore:true,cursor:null},8),{code:'unavailable'});
  assert.throws(()=>projectNoteList({notes:[{...note,id:'../bad'}],hasMore:false,cursor:null},8),{code:'unavailable'});
  const folders=projectFolderList({folders:[{id:folderId,object:'folder',name:'Équipe',parent_folder_id:null}],
    hasMore:false,cursor:null},8);
  assert.equal(folders.rows[0].name,'Équipe');
});
test('detail excludes private notes/transcript and transcript pages use unique stable IDs',()=>{
  const detail=projectNoteDetail({...note,web_url:'https://notes.granola.ai/d/example',
    folder_membership:[{id:folderId}],summary_text:'Résumé',private_notes_text:'ne pas projeter',
    transcript:[{text:'ne pas projeter'}]},noteId);
  assert.equal(detail.folder_id,folderId);
  assert.doesNotMatch(JSON.stringify(detail),/ne pas projeter|secret@example/u);
  const segment={speaker:{name:'Alice'},text:'Bonjour',start_time:'2026-01-27T15:30:00Z',
    end_time:'2026-01-27T15:30:01Z'};
  const first=projectTranscript({transcript:[segment],hasMore:true,cursor:'next'},noteId,25,null);
  const second=projectTranscript({transcript:[segment],hasMore:false,cursor:null},noteId,25,'next');
  assert.notEqual(first.rows[0].id,second.rows[0].id);
  assert.equal(first.rows[0].start_time,'2026-01-27T15:30:00.000Z');
});
test('key rotation invalidates generation and commands carry fresh config/CAS guards',async()=>{
  const initial=harness({configuration:null});
  const created=await configSet({enabled:false,revision:0},initial.context);
  assert.equal(created.output.config.revision,1);
  const keyed=harness();const result=await configKeySet({apiKey:'synthetic-key',revision:3},keyed.context);
  assert.equal(result.output.config.enabled,false);
  assert.notEqual(keyed.calls.find(row=>row.patch).args.values.connection_id,config.connection_id);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-key/u);
  const revoked=harness();await configKeyRevoke({revision:3},revoked.context);
  assert.equal(revoked.calls.find(row=>row.patch).args.values.connection_id,null);
  const start=harness({run:null});
  await syncStart({collection:'notes',runId:'run-a',revision:0},start.context);
  assert.deepEqual(start.calls.find(row=>row.guard).args.where,{connection_id:'connection-a',enabled:true});
  const page=harness({body:{notes:[note],hasMore:false,cursor:null}});
  const output=await syncPage({collection:'notes',runId:'run-a',cursor:null,limit:8,expectedRevision:4},page.context);
  assert.equal(output.output.processed,1);assert.equal(output.plans.length,3);
  assert.equal(page.calls.find(row=>row.create==='note').args.values.connection_id,'connection-a');
  assert.equal(page.calls.find(row=>row.patch==='sync_state').args.compare.expected,4);
  await assert.rejects(syncPage({collection:'notes',runId:'run-a',cursor:null,limit:8,expectedRevision:3},
    harness().context),{code:'conflict'});
});
test('specific note refresh is bounded and never persists the whole provider body',async()=>{
  const h=harness({body:{...note,web_url:'https://notes.granola.ai/d/example',
    folder_membership:[],summary_text:'Résumé',private_notes_text:'secret note'}});
  const result=await noteRefresh({id:noteId},h.context);
  assert.equal(result.output.note.summary_text,'Résumé');
  assert.equal(h.calls.find(row=>row.request).request.resource,'note');
  assert.doesNotMatch(JSON.stringify(result),/secret note|secret@example/u);
});
test('transcript GET requires a note in the current connection before outbound access',async()=>{
  const body={transcript:[{speaker:{name:'Alice'},text:'Bonjour',
    start_time:'2026-01-27T15:30:00Z',end_time:'2026-01-27T15:30:01Z'}],hasMore:false,cursor:null};
  const missing=harness({body});
  await assert.rejects(transcriptPage({id:noteId,cursor:null,limit:25},missing.context),{code:'not_found'});
  assert.equal(missing.calls.filter(row=>row.request).length,0);
  const stale=harness({body,rows:{[noteId]:{id:noteId,connection_id:'old'}}});
  await assert.rejects(transcriptPage({id:noteId,cursor:null,limit:25},stale.context),{code:'not_found'});
  assert.equal(stale.calls.filter(row=>row.request).length,0);
  const current=harness({body,rows:{[noteId]:{id:noteId,connection_id:'connection-a'}}});
  const result=await transcriptPage({id:noteId,cursor:null,limit:25},current.context);
  assert.equal(result.output.segments[0].text,'Bonjour');
  assert.equal(current.calls.filter(row=>row.request).length,1);
});
test('verified Standard Webhooks payload maps only bounded identifiers; receipt is idempotent and scoped',async()=>{
  const eventId='8f1c2a4e-6b3d-4e8f-9a2b-1c5d7e9f0a3b',bodyDigest='a'.repeat(64);
  const payload={event_id:eventId,event_type:'note.generated',note_id:noteId,
    occurred_at:'2026-01-27T15:30:00Z',summary:'must not persist'};
  const input=granolaWebhookInput(payload,eventId,bodyDigest);
  assert.deepEqual(input,{requestKey:eventId,eventId,bodyDigest,eventType:'note.generated',
    noteId,occurredAt:'2026-01-27T15:30:00.000Z'});
  assert.throws(()=>granolaWebhookInput({...payload,event_id:'other'},eventId,bodyDigest));
  assert.throws(()=>granolaWebhookInput({...payload,event_type:'note.deleted'},eventId,bodyDigest));
  const enabled={...config,webhook_key_ref:'signing-ref',webhook_secret_version:1};
  const h=harness({configuration:enabled});
  const receipt=await eventReceive(input,h.context);
  assert.equal(receipt.output.recorded,true);
  assert.deepEqual(receipt.plans.map(row=>row.kind),['guard','create']);
  assert.doesNotMatch(JSON.stringify(receipt),/must not persist|summary/u);
  assert.equal(h.calls.find(row=>row.guard).args.where.connection_id,'connection-a');
  const replay=harness({configuration:enabled,rows:{[eventId]:{id:eventId,
    connection_id:'connection-a',body_digest:bodyDigest}}});
  assert.equal((await eventReceive(input,replay.context)).plans,undefined);
  await assert.rejects(eventReceive({...input,bodyDigest:'b'.repeat(64)},replay.context),{code:'conflict'});
});
test('webhook signing and service credentials are sealed, rotatable and revoked with API key',async()=>{
  const enabled={...config,webhook_key_ref:'old-sign',webhook_secret_version:1,
    webhook_previous_key_ref:'older-sign',webhook_previous_secret_version:1,
    webhook_service_token_ref:'service-ref',webhook_service_token_version:1};
  const secret='whsec_'+'A'.repeat(32),token='cz1a_'+'a'.repeat(43);
  const set=harness({configuration:enabled});
  const sealed=await configWebhookSet({webhookSecret:secret,revision:3},set.context);
  assert.equal(sealed.output.config.hasWebhookSecret,true);
  assert.equal(set.calls.filter(row=>row.patch).length,1);
  assert.doesNotMatch(JSON.stringify(sealed),/whsec_A/u);
  const revoke=harness({configuration:enabled});
  const revoked=await configWebhookRevoke({revision:3},revoke.context);
  assert.equal(revoked.output.config.hasWebhookSecret,false);
  const service=harness({configuration:enabled});
  assert.equal((await configWebhookServiceSet({serviceToken:token,revision:3},service.context))
    .output.config.hasWebhookService,true);
  assert.equal((await configWebhookServiceRevoke({revision:3},service.context))
    .output.config.hasWebhookService,false);
  const rotate=harness({configuration:enabled});
  const key=await configKeySet({apiKey:'synthetic-key',revision:3},rotate.context);
  assert.equal(key.output.config.hasWebhookSecret,false);
  assert.equal(key.output.config.hasWebhookService,false);
  assert.equal(key.plans.length,5);
  for(const id of ['config.key.set','config.key.revoke'])
    assert.ok(manifest.contracts.operations.find(row=>row.id===id).execution.maxItems>=6);
  assert.ok(manifest.contracts.operations.find(row=>row.id==='sync.page').execution.maxItems>=21);
});
