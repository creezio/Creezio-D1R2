import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {safeHtml,boxCreate,draftCreate,draftSave,draftDelete,messageList,messageUpdate,messageDelete,
  attachmentLink,attachmentUnlink,transportStatus,messageSend,messageDeliveryPrepare,
  boxPreviewList,messagePreviewList,draftPreviewList,messageInboundPrepare,messageInboundStatus,
  messageInboundAttachmentStage,messageInboundImport,
  messageDeliveryReconcile} from '../../module/service.ts';

const box={id:'box-one',name:'Personnel',address:'',kind:'local',revision:1};
const draft={id:'draft-one',box_id:'box-one',to_addr:'',cc_addr:'',bcc_addr:'',subject:'',text_body:'',
  html_body:'',revision:1,updated_at:'2026-09-28T00:00:00.000Z'};
function harness(rows={}){
  const calls=[];
  const context={principalId:'alice',actorPrincipalId:'alice',audience:'app',contextId:'application',
    executionId:'intent-one',providerAvailability:{providerId:'resend.api.v1',state:'ready',modelIds:[]},
    operations:{query:async()=>({state:'ready',from:'sender@example.test',configRevision:3})},
    data:{get:async(model,args)=>{calls.push({kind:'get',model,args});return rows[model]??null;},
      list:async(model,args)=>{calls.push({kind:'list',model,args});return rows[`${model}Page`]??{items:[],nextAfter:null};},
      planGet:(model,args)=>{calls.push({kind:'planGet',model,args});return {kind:'data-plan'};},
      planCreate:(model,args)=>{calls.push({kind:'planCreate',model,args});return {kind:'data-plan'};},
      planPatch:(model,args)=>{calls.push({kind:'planPatch',model,args});return {kind:'data-plan'};},
      planDelete:(model,args)=>{calls.push({kind:'planDelete',model,args});return {kind:'data-plan'};}}};
  return {context,calls};
}

test('previews omit full bodies and HTML, retain scoped cursor and fit the chat result bound',async()=>{
  const long='\\"'.repeat(8000),stamp='2026-09-28T00:00:00.000Z';
  const message={id:'message-one',box_id:'box-one',direction:'inbound',from_addr:'a@example.org',
    to_addr:'',subject:long.slice(0,240),text_body:long,html_body:long,
    state:'received',folder:'inbox',read_at:null,thread_id:null,received_at:stamp,sent_at:null,revision:1};
  const draftRow={...draft,to_addr:'a@example.org',subject:long.slice(0,240),text_body:long};
  const h=harness({box,boxPage:{items:[{...box,updated_at:stamp}],nextAfter:null},
    messagePage:{items:[message],nextAfter:{owner_id:'alice',box_id:'box-one',created_at:stamp,id:'message-one'}},
    draftPage:{items:[draftRow],nextAfter:null}});
  const boxes=await boxPreviewList({limit:5},h.context);
  const messages=await messagePreviewList({boxId:'box-one',limit:5},h.context);
  const drafts=await draftPreviewList({boxId:'box-one',limit:5},h.context);
  assert.equal(boxes.output.items[0].id,'box-one');
  assert.equal(messages.output.items[0].subjectHasMore,true);
  assert.equal(drafts.output.items[0].bodyHasMore,true);
  assert.ok(Buffer.byteLength(JSON.stringify({output:messages.output}))<8192);
  assert.doesNotMatch(JSON.stringify(messages.output),/html_body|text_body/);
  assert.ok(!JSON.stringify(messages.output).includes(long.slice(0,200)));
  assert.ok(h.calls.filter(call=>call.kind==='list').every(call=>!Object.hasOwn(call.args.where,'audience')));
  assert.ok(h.calls.filter(call=>call.kind==='list'&&call.model==='message')
    .every(call=>!call.args.fields.includes('html_body')&&!call.args.fields.includes('context_id')));
  assert.equal(typeof messages.output.nextCursor,'string');
});

test('business models use owner and context keys across authorized audiences',()=>{
  const models=JSON.parse(read('module/models.json'));
  assert.deepEqual(manifest.contracts.models,models);
  const parent=models.find(x=>x.id==='box');
  assert.deepEqual(parent.primaryKey,['context_id','owner_id','id']);
  const child=models.find(x=>x.id==='draft');
  assert.deepEqual(child.relations[0].fields,['context_id','owner_id','box_id']);
  assert.deepEqual(child.relations[0].targetFields,parent.primaryKey);
  const attachment=models.find(x=>x.id==='draft_attachment');
  assert.deepEqual(attachment.relations.find(x=>x.id==='draft').fields,
    ['context_id','owner_id','box_id','draft_id']);
  assert.ok(models.every(model=>!model.fields.some(field=>field.id==='audience')));
  assert.equal(manifest.contracts.files[0].ownerScope,'principal');
});

test('permanent message deletion is trash-only, bounded and tombstones inbound provenance',async()=>{
  const message={id:'mail-one',box_id:'box-one',direction:'inbound',folder:'trash',revision:3,
    provider_message_id:'provider-one'};
  const snapshot={id:'mail-one',email_id:'provider-one',deleted_at:null,
    snapshot_digest:'a'.repeat(64)};
  const links=Array.from({length:13},(_,i)=>({file_id:`file-${i}`}));
  const partial=harness({box,message,inbound_snapshot:snapshot,
    message_attachmentPage:{items:links,nextAfter:{file_id:'later'}}});
  const first=await messageDelete({requestKey:'delete-one',boxId:'box-one',messageId:'mail-one',revision:3},
    partial.context);
  assert.deepEqual(first.output,{deleted:false,revision:4,removed:13});
  assert.equal(first.plans.length,14);
  assert.deepEqual(partial.calls.find(call=>call.kind==='planPatch'&&call.model==='message').args.compare,
    {field:'revision',expected:3});
  assert.equal(partial.calls.some(call=>call.kind==='planDelete'&&call.model==='message'),false);
  const final=harness({box,message:{...message,revision:4},inbound_snapshot:snapshot,
    message_attachmentPage:{items:links.slice(0,1),nextAfter:null}});
  const last=await messageDelete({requestKey:'delete-two',boxId:'box-one',messageId:'mail-one',revision:4},
    final.context);
  assert.deepEqual(last.output,{deleted:true,revision:null,removed:1});
  assert.equal(last.plans.length,3);
  assert.deepEqual(final.calls.find(call=>call.kind==='planDelete'&&call.model==='message').args.compare,
    {field:'revision',expected:4});
  const tombstone=final.calls.find(call=>call.kind==='planPatch'&&call.model==='inbound_snapshot').args;
  assert.deepEqual(tombstone.where,{deleted_at:null,snapshot_digest:'a'.repeat(64)});
  assert.deepEqual([tombstone.values.subject,tombstone.values.text_body,tombstone.values.html_body,
    tombstone.values.attachments],['','','',[]]);
  assert.match(tombstone.values.deleted_at,/^\d{4}-\d\d-\d\dT/);
  for(const changed of [{...message,folder:'inbox'},{...message,direction:'outbound'}]){
    const denied=harness({box,message:changed});
    await assert.rejects(messageDelete({requestKey:'denied',boxId:'box-one',messageId:'mail-one',revision:3},
      denied.context),{code:'conflict'});
    assert.equal(denied.calls.some(call=>call.kind==='planDelete'),false);
  }
  await assert.rejects(messageDelete({requestKey:'stale',boxId:'box-one',messageId:'mail-one',revision:2},
    final.context),{code:'conflict'});
  const frozen=harness({box,message,send_snapshot:{id:'mail-one'}});
  await assert.rejects(messageDelete({requestKey:'frozen',boxId:'box-one',messageId:'mail-one',revision:3},
    frozen.context),{code:'conflict'});
  for(const source of [null,{...snapshot,email_id:'different-provider'}]){
    const legacy=harness({box,message,inbound_snapshot:source,
      message_attachmentPage:{items:links,nextAfter:null}});
    await assert.rejects(messageDelete({requestKey:'legacy',boxId:'box-one',messageId:'mail-one',revision:3},
      legacy.context),{code:'conflict'});
    assert.equal(legacy.calls.some(call=>call.kind==='planDelete'||call.kind==='planPatch'),false);
  }
});

test('HTML is safe and stable across save/read/save, links retain only HTTPS or HTTP',()=>{
  const raw='<p>Hello <strong>vous</strong> <a href="https://example.org/?a=1&b=2">ouvrir</a></p><img src=x onerror=alert(1)>';
  const once=safeHtml(raw);
  assert.equal(safeHtml(once),once);
  assert.match(once,/<a href="https:\/\/example.org\/\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">/);
  assert.doesNotMatch(once,/<img/i);
  assert.match(once,/&lt;img/);
  assert.doesNotMatch(safeHtml('<a href="javascript:alert(1)">X</a>'),/<a /);
  assert.throws(()=>safeHtml('&'.repeat(10000)),{code:'invalid_input'});
});

test('box and draft create only plan own scoped rows with a live parent guard',async()=>{
  const one=harness();
  const created=await boxCreate({requestKey:'box-one',name:' Perso ',address:''},one.context);
  assert.equal(created.output.box.kind,'local');
  assert.equal(one.calls[0].args.values.owner_id,'alice');
  const two=harness({box});
  await draftCreate({requestKey:'draft-one',boxId:'box-one'},two.context);
  assert.deepEqual(two.calls.find(x=>x.kind==='planGet').args.key,
    {owner_id:'alice',id:'box-one'});
  assert.equal(two.calls.find(x=>x.kind==='planCreate').args.values.box_id,'box-one');
});

test('draft save validates recipients, sanitizes HTML and uses a fresh CAS',async()=>{
  const h=harness({box,draft});
  const result=await draftSave({requestKey:'save-one',boxId:'box-one',draftId:'draft-one',revision:1,
    to:'a@example.org, b@example.org',cc:'',bcc:'',subject:'Bonjour',text:'Bonjour',
    html:'<p><a href="https://example.org">OK</a><script>alert(1)</script></p>'},h.context);
  assert.equal(result.output.draft.revision,2);
  assert.equal(result.output.draft.to,'a@example.org, b@example.org');
  assert.match(result.output.draft.html,/&lt;script&gt;/);
  assert.deepEqual(h.calls.find(x=>x.kind==='planPatch').args.compare,{field:'revision',expected:1});
  await assert.rejects(draftSave({requestKey:'save-two',boxId:'box-one',draftId:'draft-one',revision:0,
    to:'',cc:'',bcc:'',subject:'',text:'',html:''},h.context),{code:'conflict'});
  await assert.rejects(draftSave({requestKey:'save-three',boxId:'box-one',draftId:'draft-one',revision:1,
    to:'bad-address',cc:'',bcc:'',subject:'',text:'',html:''},h.context),{code:'invalid_input'});
});

test('draft with attachments cannot be deleted; unlink CAS removes link but keeps R2 object',async()=>{
  const link={file_id:'file-one'};
  const h=harness({box,draft,draft_attachment:link,draft_attachmentPage:{items:[link],nextAfter:null}});
  await assert.rejects(draftDelete({requestKey:'delete-one',boxId:'box-one',draftId:'draft-one',revision:1},
    h.context),{code:'conflict'});
  const unlinked=await attachmentUnlink({requestKey:'unlink-one',boxId:'box-one',draftId:'draft-one',
    revision:1,fileId:'file-one'},h.context);
  assert.equal(unlinked.output.removed,true);
  assert.deepEqual(h.calls.find(x=>x.kind==='planDelete').args.key,
    {owner_id:'alice',box_id:'box-one',draft_id:'draft-one',file_id:'file-one'});
  assert.equal(h.calls.some(x=>x.model==='file_metadata'&&x.kind==='planDelete'),false);
});

test('private file publication is paired with draft CAS and scoped link',async()=>{
  const h=harness({box,draft});
  h.context.files={preparePublication:async()=>({plan:{kind:'data-plan'},file:{fileId:'file-one',
    filename:'a.pdf',contentType:'application/pdf',byteSize:8}})};
  const linked=await attachmentLink({requestKey:'link-one',boxId:'box-one',draftId:'draft-one',revision:1,
    staged:{fileId:'file-one',intentId:'intent-one',generation:'gen-one',digest:'a'.repeat(64)}},h.context);
  assert.equal(linked.plans.length,4);
  assert.equal(linked.output.draft.revision,2);
  assert.deepEqual(h.calls.find(x=>x.kind==='planCreate').args.values.owner_id,'alice');
  assert.deepEqual(h.calls.find(x=>x.kind==='planPatch').args.compare,{field:'revision',expected:1});
});

test('message search can return empty page with continuation; mutations are CAS',async()=>{
  const row={id:'message-one',box_id:'box-one',direction:'inbound',from_addr:'a@example.org',to_addr:'',cc_addr:'',
    subject:'Autre',text_body:'Texte',html_body:'',state:'received',folder:'inbox',read_at:null,thread_id:null,
    reply_to:null,in_reply_to:null,received_at:'2026-09-28T00:00:00.000Z',sent_at:null,revision:1};
  const h=harness({box,message:row,messagePage:{items:[row],nextAfter:{...row}}});
  const page=await messageList({boxId:'box-one',limit:50,query:'introuvable'},h.context);
  assert.deepEqual(page.output.items,[]);
  assert.equal(typeof page.output.nextCursor,'string');
  assert.equal(h.calls.find(x=>x.kind==='list').args.limit,1);
  const changed=await messageUpdate({requestKey:'read-one',boxId:'box-one',messageId:'message-one',revision:1,
    read:true,folder:'archive'},h.context);
  assert.equal(changed.output.message.folder,'archive');
  assert.equal(changed.output.message.read,true);
  assert.deepEqual(h.calls.find(x=>x.kind==='planPatch').args.compare,{field:'revision',expected:1});
  await assert.rejects(messageUpdate({requestKey:'fake-send',boxId:'box-one',messageId:'message-one',
    revision:1,folder:'sent'},h.context),{code:'invalid_input'});
});
test('inbound prepare freezes an exact provider snapshot, then zero-file import has no network',async()=>{
  const selected={...box,address:'sender@example.test'};
  const mail={emailId:'mail-one',to:['sender@example.test'],from:'peer@example.test',
    subject:'Hello',text:'Line one\nLine two',html:'<p>Hello</p>',
    receivedAt:'2026-09-30T10:00:00.000Z',connectionId:'connection-one',configRevision:3,
    attachments:[],attachmentCount:0};
  const h=harness({box:selected});
  h.context.operations.query=async args=>{
    assert.deepEqual(args,{moduleId:'creezio.resend',operationId:'received.read',
      input:{emailId:'mail-one'}});
    return mail;
  };
  const prepared=await messageInboundPrepare({requestKey:'prepare-one',boxId:'box-one',
    emailId:'mail-one'},h.context);
  assert.equal(prepared.output.snapshot.attachments.length,0);
  assert.equal(prepared.plans.length,2);
  assert.equal(h.calls.some(call=>call.model==='message'&&call.kind==='planCreate'),false);
  const snapshot=h.calls.find(call=>call.model==='inbound_snapshot'&&call.kind==='planCreate').args.values;
  const ready=harness({box:selected,inbound_snapshot:snapshot});
  ready.context.operations.query=async()=>{throw Error('import must not read the provider');};
  let batch;
  ready.context.files={prepareBatchPublication:async(category,input)=>{batch={category,input};}};
  assert.equal((await messageInboundStatus({boxId:'box-one',emailId:'mail-one'},ready.context))
    .output.snapshot.imported,false);
  const answer=await messageInboundImport({requestKey:'import-one',boxId:'box-one',
    emailId:'mail-one'},ready.context);
  assert.equal(answer.output.message.folder,'inbox');
  assert.equal(answer.output.message.direction,'inbound');
  assert.equal(answer.plans.length,3);
  assert.deepEqual(batch.input.attachments,[]);
  assert.deepEqual(batch.input.sourceProof,{connectionId:'connection-one',configRevision:3});
  assert.equal(ready.calls.find(call=>call.model==='message'&&call.kind==='planCreate')
    .args.values.provider_message_id,'mail-one');
  const wrong=harness({box:{...selected,address:'other@example.test'}});
  wrong.context.operations.query=async()=>mail;
  await assert.rejects(messageInboundPrepare({requestKey:'prepare-two',boxId:'box-one',emailId:'mail-one'},
    wrong.context),{code:'unavailable'});
  assert.equal(wrong.calls.some(call=>call.kind==='planCreate'),false);
});

test('one inbound attachment stages once and imports only after the durable receipt exists',async()=>{
  const selected={...box,address:'sender@example.test'};
  const child={id:'attachment-one',filename:'preuve.pdf',contentType:'application/pdf',byteSize:8};
  const mail={emailId:'mail-two',to:[selected.address],from:'peer@example.test',
    subject:'Pièce',text:'Voir pièce',html:'<p>Voir pièce</p>',
    receivedAt:'2026-09-30T11:00:00.000Z',connectionId:'connection-one',configRevision:3,
    attachments:[child],attachmentCount:1};
  const prepared=harness({box:selected});
  prepared.context.operations.query=async()=>mail;
  await messageInboundPrepare({requestKey:'prepare-two',boxId:'box-one',emailId:'mail-two'},
    prepared.context);
  const snapshot=prepared.calls.find(call=>call.model==='inbound_snapshot'
    &&call.kind==='planCreate').args.values;
  const pending=harness({box:selected,inbound_snapshot:snapshot});
  pending.context.files={prepareBatchPublication:async()=>{throw Error('must not reach batch');}};
  await assert.rejects(messageInboundImport({requestKey:'early',boxId:'box-one',
    emailId:'mail-two'},pending.context),{code:'conflict'});
  assert.equal(pending.calls.some(call=>call.model==='message'&&call.kind==='planCreate'),false);
  const staged=harness({box:selected,inbound_snapshot:snapshot});
  let stageRequest;
  staged.context.files={stageRemote:async(category,request)=>{
    stageRequest={category,request};
    return {ref:{fileId:'file-one',intentId:request.intentId,generation:request.generation,
      digest:'a'.repeat(64)},file:{filename:child.filename,contentType:child.contentType,
      byteSize:child.byteSize}};
  }};
  const result=await messageInboundAttachmentStage({requestKey:'stage-one',boxId:'box-one',
    emailId:'mail-two',childId:child.id},staged.context);
  assert.equal(result.output.staged,true);
  assert.equal(result.plans.length,3);
  assert.deepEqual(stageRequest.request.expected,{filename:child.filename,
    contentType:child.contentType,byteSize:child.byteSize});
  assert.deepEqual(stageRequest.request.sourceProof,
    {connectionId:'connection-one',configRevision:3});
  const receipt=staged.calls.find(call=>call.model==='inbound_stage_receipt'
    &&call.kind==='planCreate').args.values;
  const ready=harness({box:selected,inbound_snapshot:snapshot,
    inbound_stage_receiptPage:{items:[receipt],nextAfter:null}});
  ready.context.operations.query=async()=>{throw Error('import must not read provider');};
  let batch;
  ready.context.files={prepareBatchPublication:async(category,input)=>{batch={category,input};}};
  const imported=await messageInboundImport({requestKey:'import-two',boxId:'box-one',
    emailId:'mail-two'},ready.context);
  assert.equal(imported.plans.length,3);
  assert.equal(batch.input.attachments.length,1);
  assert.equal(batch.input.attachments[0].fileId,'file-one');
  assert.deepEqual(batch.input.sourceScope,{box_id:'box-one',snapshot_id:snapshot.id});
  const resumed=harness({box:selected,inbound_snapshot:snapshot,
    inbound_stage_receiptPage:{items:[receipt],nextAfter:null}});
  resumed.context.files={stageRemote:async()=>{throw Error('must not download again');}};
  const repeat=await messageInboundAttachmentStage({requestKey:'repeat',boxId:'box-one',
    emailId:'mail-two',childId:child.id},resumed.context);
  assert.equal(repeat.output.fileId,'file-one');
  assert.equal(repeat.plans,undefined);
});

test('inbound snapshot rejects duplicate IDs, mismatched counts and size overflow',async()=>{
  const selected={...box,address:'sender@example.test'};
  const child={id:'attachment-one',filename:'a.pdf',contentType:'application/pdf',byteSize:8};
  const mail={emailId:'mail-three',to:[selected.address],from:'peer@example.test',subject:'',
    text:'',html:'',receivedAt:'2026-09-30T11:00:00.000Z',
    connectionId:'connection-one',configRevision:3,attachments:[child,child],attachmentCount:2};
  for(const changed of [mail,{...mail,attachmentCount:1},
    {...mail,attachments:[{...child,byteSize:10*1024*1024+1}],attachmentCount:1}]){
    const h=harness({box:selected});h.context.operations.query=async()=>changed;
    await assert.rejects(messageInboundPrepare({requestKey:'bad',boxId:'box-one',
      emailId:'mail-three'},h.context),{code:'unavailable'});
    assert.equal(h.calls.some(call=>call.kind==='planCreate'),false);
  }
});

test('absent transport cannot imply queued or sent',async()=>{
  const missing=harness();missing.context.operations=undefined;
  assert.deepEqual((await transportStatus({},missing.context)).output,
    {state:'unavailable',send:false,receive:false,from:null});
  await assert.rejects(messageSend({boxId:'box-one',draftId:'draft-one',revision:1},
    harness({box,draft}).context),{code:'invalid_input'});
});
test('send freezes text/HTML and Bcc in one durable outbox intent, never claims sent',async()=>{
  const from={...box,address:'sender@example.test'};
  const saved={...draft,to_addr:'to@example.test',bcc_addr:'hidden@example.test',subject:'Bonjour',
    text_body:'Corps',html_body:'<p>Corps</p>',send_intent_id:null};
  const h=harness({box:from,draft:saved});
  const result=await messageSend({boxId:'box-one',draftId:'draft-one',revision:1},h.context);
  assert.equal(result.output.message.state,'queued');
  assert.equal(result.output.message.folder,'outbox');
  assert.equal(result.output.draft.sendIntentId,'intent-one');
  assert.equal(result.outbox.length,1);
  assert.deepEqual(result.outbox[0].payload.kind,'mail.send.v1');
  assert.equal(result.outbox[0].providerIdempotencyKey,'intent-one');
  assert.doesNotMatch(JSON.stringify(result.outbox),/hidden@example|Corps/u);
  assert.equal(h.calls.find(x=>x.kind==='planPatch').args.compare.expected,1);
  const snapshot=h.calls.find(x=>x.kind==='planCreate'&&x.model==='send_snapshot').args.values;
  assert.equal(snapshot.bcc_addr,'hidden@example.test');
  assert.equal(snapshot.config_revision,3);
  assert.equal(result.plans.length,4);
  const reread=harness({box:from,message:h.calls.find(x=>x.kind==='planCreate'&&x.model==='message').args.values,
    send_snapshot:snapshot});
  const prepared=await messageDeliveryPrepare({intentId:'intent-one',boxId:'box-one',
    snapshotDigest:snapshot.payload_digest},reread.context);
  assert.deepEqual(prepared.output.envelope.bcc,['hidden@example.test']);
  assert.equal(prepared.output.configRevision,3);
  await assert.rejects(messageDeliveryPrepare({intentId:'intent-one',boxId:'box-one',
    snapshotDigest:'0'.repeat(64)},reread.context),{code:'unavailable'});
  const duplicate=harness({box:from,draft:{...saved,send_intent_id:'intent-one'}});
  await assert.rejects(messageSend({boxId:'box-one',draftId:'draft-one',revision:1},duplicate.context),{code:'conflict'});
  const file={file_id:'f1_'+'a'.repeat(64),filename:'a.pdf',content_type:'application/pdf',byte_size:8,
    digest:'b'.repeat(64),intent_id:'upload-one',generation:'one'};
  const attached=harness({box:from,draft:saved,draft_attachmentPage:{items:[file],nextAfter:null}});
  await assert.rejects(messageSend({boxId:'box-one',draftId:'draft-one',revision:1},attached.context),{code:'unavailable'});
  assert.equal(attached.calls.some(x=>x.kind==='planCreate'),false);
  let freezeInput;
  attached.context.files={freezeLinks:async(_category,input)=>{freezeInput=input;}};
  const withFile=await messageSend({boxId:'box-one',draftId:'draft-one',revision:1},attached.context);
  assert.equal(withFile.plans.length,4);
  assert.equal(freezeInput.attachments[0].fileId,file.file_id);
  const frozen=attached.calls.find(x=>x.kind==='planCreate'&&x.model==='send_snapshot').args.values;
  const linked=harness({box:from,message:attached.calls.find(x=>x.kind==='planCreate'&&x.model==='message').args.values,
    send_snapshot:frozen,message_attachmentPage:{items:[file],nextAfter:null}});
  const preparedFile=await messageDeliveryPrepare({intentId:'intent-one',boxId:'box-one',
    snapshotDigest:frozen.payload_digest},linked.context);
  assert.equal(preparedFile.output.envelope.attachments[0].digest,file.digest);
});
test('send freezes 50 private references and refuses a 51st before mutation',async()=>{
  const rows=Array.from({length:50},(_,index)=>({file_id:`f1_${index.toString(16).padStart(64,'0')}`,
    filename:`${index}.txt`,content_type:'text/plain',byte_size:1,digest:'a'.repeat(64),
    intent_id:`upload-${index}`,generation:'1'}));
  const saved={...draft,to_addr:'to@example.test',subject:'50',text_body:'Test',send_intent_id:null};
  const h=harness({box:{...box,address:'sender@example.test'},draft:saved,
    draft_attachmentPage:{items:rows,nextAfter:null}});
  let frozen;
  h.context.files={freezeLinks:async(_category,input)=>{frozen=input;}};
  const result=await messageSend({boxId:'box-one',draftId:'draft-one',revision:1},h.context);
  assert.equal(frozen.attachments.length,50);
  assert.equal(result.plans.length,4);
  assert.doesNotMatch(JSON.stringify(result.outbox),/upload-|\.txt/u);
  const tooMany=harness({box:{...box,address:'sender@example.test'},draft:saved,
    draft_attachmentPage:{items:rows,nextAfter:{file_id:'extra'}}});
  tooMany.context.files=h.context.files;
  await assert.rejects(messageSend({boxId:'box-one',draftId:'draft-one',revision:1},tooMany.context),
    {code:'invalid_input'});
  assert.equal(tooMany.calls.some(call=>call.kind==='planCreate'),false);
});
test('signed provider failure uses revision CAS and cannot downgrade a terminal receipt',async()=>{
  const base={id:'message-one',box_id:'box-one',direction:'outbound',from_addr:'sender@example.test',
    to_addr:'to@example.test',cc_addr:'',subject:'Bonjour',text_body:'Texte',html_body:'',
    state:'sent',folder:'sent',read_at:null,thread_id:null,reply_to:null,in_reply_to:null,
    provider_message_id:'mail-one',received_at:null,sent_at:'2026-09-30T10:00:00.000Z',revision:4};
  const failed=harness({box,message:base});
  failed.context.operations.query=async()=>({kind:'failed',eventId:'evt-failed',
    occurredAt:'2026-09-30T10:01:00.000Z'});
  const changed=await messageDeliveryReconcile({boxId:'box-one',messageId:'message-one',revision:4},
    failed.context);
  assert.equal(changed.output.message.state,'failed');
  assert.equal(changed.output.message.folder,'sent');
  assert.equal(changed.output.message.revision,5);
  assert.equal(changed.plans.length,1);
  assert.deepEqual(failed.calls.find(call=>call.kind==='planPatch').args.compare,
    {field:'revision',expected:4});
  const terminal=harness({box,message:{...base,state:'delivered',revision:5}});
  terminal.context.operations.query=failed.context.operations.query;
  const unchanged=await messageDeliveryReconcile({boxId:'box-one',messageId:'message-one',revision:5},
    terminal.context);
  assert.equal(unchanged.output.message.state,'delivered');
  assert.equal(unchanged.plans,undefined);
  const localFailure=harness({box,message:{...base,state:'failed',folder:'outbox',
    provider_message_id:null}});
  localFailure.context.operations.query=failed.context.operations.query;
  await assert.rejects(messageDeliveryReconcile({boxId:'box-one',messageId:'message-one',revision:4},
    localFailure.context),{code:'invalid_input'});
  assert.equal(localFailure.calls.some(call=>call.kind==='planPatch'),false);
});
