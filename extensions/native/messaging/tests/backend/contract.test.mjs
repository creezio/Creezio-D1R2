import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {safeHtml,boxCreate,draftCreate,draftSave,draftDelete,messageList,messageUpdate,
  attachmentLink,attachmentUnlink,transportStatus,messageSend,boxPreviewList,messagePreviewList,draftPreviewList} from '../../module/service.ts';

const box={id:'box-one',name:'Personnel',address:'',kind:'local',revision:1};
const draft={id:'draft-one',box_id:'box-one',to_addr:'',cc_addr:'',bcc_addr:'',subject:'',text_body:'',
  html_body:'',revision:1,updated_at:'2026-09-28T00:00:00.000Z'};
function harness(rows={}){
  const calls=[];
  const context={principalId:'alice',actorPrincipalId:'alice',audience:'app',contextId:'application',
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

test('absent transport cannot imply queued or sent',()=>{
  assert.deepEqual(transportStatus().output,{state:'unavailable',send:false,receive:false});
  assert.throws(()=>messageSend(),{code:'unavailable'});
});
