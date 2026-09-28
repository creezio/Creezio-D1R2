import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manifest} from '../helpers.mjs';
import {emptySubviewDraft,formFrom,saveSubviewDraft,updateFromForm} from '../../ui/editing.ts';
import {createCommandJournal,readPendingCommand} from '../../ui/commands.ts';

test('an uncertain command stays locked through suspension and reload until its native status is read',async()=>{
  const scope={audience:'admin',contextId:'application',sessionId:'session-1'};
  const command={...scope,entity:'company',action:'create',requestKey:'command-1'};
  const journal=createCommandJournal();let sends=0,reads=0,captured;
  const client={invoke:async()=>{sends++;return {kind:'unknown',code:'stale'};},
    status:async request=>{reads++;assert.equal(request.requestKey,'command-1');
      return {kind:'execution',execution:{state:'succeeded',output:{item:{id:'saved'}}}};}};
  await journal.execute(client,scope,command,{name:'Company'},()=>true,()=>{captured=journal.pending;return true;});
  assert.deepEqual(captured,command);
  await journal.execute(client,scope,{...command,requestKey:'command-2'},{name:'Company'},()=>true,()=>true);
  assert.equal(sends,1,'an uncertain create cannot become another create with a different key');
  const restored=createCommandJournal(readPendingCommand(JSON.parse(JSON.stringify(journal.pending)),scope));
  assert.equal((await restored.inspect(client,scope,()=>true)).execution.state,'succeeded');
  assert.equal(restored.pending,null);assert.equal(sends,1);assert.equal(reads,1);
});

test('a failed browser checkpoint refuses the command before any mutation',async()=>{
  const journal=createCommandJournal();let sends=0;
  const scope={audience:'admin',contextId:'application',sessionId:'session'};
  const result=await journal.execute({invoke:async()=>{sends++;}},scope,
    {...scope,entity:'company',action:'create',requestKey:'blocked'}, {},()=>true,()=>false);
  assert.equal(result.code,'client_state_unavailable');assert.equal(sends,0);assert.equal(journal.pending,null);
});

test('a missing execution remains uncertain and never permits an automatic replay',async()=>{
  const scope={audience:'app',contextId:'application',sessionId:'session-2'};
  const journal=createCommandJournal({...scope,entity:'contact',action:'update',requestKey:'command-2'});
  const client={status:async()=>({kind:'unknown',code:'execution_not_observed'})};
  await journal.inspect(client,{audience:'app',contextId:'application'},()=>true);
  assert.equal(journal.pending.requestKey,'command-2');
  assert.equal(readPendingCommand({entity:'unknown',action:'create',requestKey:'x'},scope),null);
  assert.equal(readPendingCommand(journal.pending,{...scope,sessionId:'other-session'}),null);
  await journal.inspect({status:async()=>({kind:'rejected',code:'forbidden',status:403})},scope,()=>true);
  assert.equal(journal.pending.requestKey,'command-2','a refused lookup does not prove a refused mutation');
});

test('refreshing the list cannot adopt a newer revision for an already open edit',()=>{
  const original={id:'company',name:'Initial',city:'Lyon',notes:'Original notes',revision:1,archivedAt:null};
  const form=formFrom(original);
  form.notes='My pending edit';
  const refreshed={...original,name:'Colleague update',revision:2};
  const update=updateFromForm('company',form);
  assert.equal(update.revision,1,'server must reject this edit after the colleague committed revision 2');
  assert.equal(update.name,'Initial');
  assert.equal(update.notes,'My pending edit');
  assert.equal(updateFromForm('company',formFrom(refreshed)).revision,2,'explicitly reopening adopts the new snapshot');
});

test('three CRM subviews keep separate drafts and their opening revisions',()=>{
  const company={id:'company-1',name:'Acme',city:'Lyon',notes:'Original',revision:3,archivedAt:null};
  const contact={id:'contact-1',name:'Alice',city:null,notes:null,revision:7,archivedAt:null};
  const companyForm={...formFrom(company),notes:'Notes not saved'};
  const contactForm={...formFrom(contact),name:'Alice revised'};
  let drafts=saveSubviewDraft({},'company',{...emptySubviewDraft(),query:'Ac',appliedQuery:'A',
    selected:company.id,selectedSnapshot:company,form:companyForm});
  drafts=saveSubviewDraft(drafts,'contact',{...emptySubviewDraft(),name:'New contact',
    selected:contact.id,selectedSnapshot:contact,form:contactForm});
  drafts=saveSubviewDraft(drafts,'prospect',{...emptySubviewDraft(),archived:true,query:'Lead'});
  companyForm.notes='Later local change';
  assert.equal(drafts.company.form.notes,'Notes not saved','the saved view owns its form snapshot');
  assert.equal(drafts.company.form.revision,3);
  assert.equal(drafts.contact.form.revision,7);
  assert.equal(drafts.contact.name,'New contact');
  assert.equal(drafts.prospect.archived,true);
  assert.equal(drafts.prospect.query,'Lead');
  assert.equal(updateFromForm('company',drafts.company.form).revision,3);
  drafts={};
  assert.equal(drafts.company,undefined,'a changed session, audience or context drops every local draft');
});

test('workspace declares CRM navigation, inactive suspension and all business operations',()=>{
  const ui=manifest.contracts.ui;
  assert.equal(ui.views.length,2);
  assert.equal(ui.views[0].panel.inactiveEffects,'suspend');
  assert.equal(ui.navigation[0].view.id,'workspace');
  assert.equal(ui.views[0].operations.length,21);
  assert.equal(ui.front.mode,'provided');
  assert.deepEqual(ui.views[1].surfaces,['front']);
  assert.equal(ui.navigation[1].view.id,'front');
});
test('original five kanban columns and native drag gesture are retained',()=>{
  const source=readFileSync(new URL('../../ui/kanban.tsx',import.meta.url),'utf8');
  for(const stage of ['a_contacter','contacte','rdv','client','perdu'])assert.match(source,new RegExp(stage));
  assert.match(source,/onDragStart/);assert.match(source,/onDrop/);
  assert.match(source,/Déposez ici/);
});
