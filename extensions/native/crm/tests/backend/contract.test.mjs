import test from 'node:test';
import assert from 'node:assert/strict';
import {companyCreate,companyArchive,contactCreate,prospectCreate,prospectUpdate,
  prospectSearch} from '../../module/service.ts';
import {manifest} from '../helpers.mjs';

const stamp='2026-09-28T00:00:00.000Z';
const company={context_id:'ctx-a',id:'co-a',name:'Atlas',city:null,website:null,notes:null,
  created_at:stamp,updated_at:stamp,archived_at:null,revision:2};
const contact={context_id:'ctx-a',id:'ct-a',name:'Ana',city:null,email:null,phone:null,
  notes:null,company_id:'co-a',created_at:stamp,updated_at:stamp,archived_at:null,revision:1};
const prospect={context_id:'ctx-a',id:'pr-a',name:'Aventure',city:null,contact_name:null,
  email:null,phone:null,website:null,notes:null,stage:'a_contacter',position:1,company_id:'co-a',contact_id:'ct-a',
  created_at:stamp,updated_at:stamp,archived_at:null,revision:3};
function context(rows={company,contact,prospect}){
  const calls=[],scope={contextId:'ctx-a',audience:'admin',principalId:'user-a'};
  return {...scope,calls,data:{async get(model,input){calls.push(['get',model,input]);return rows[model]??null;},
    async list(model,input){calls.push(['list',model,input]);const row=rows[model];
      return {items:row&&Object.entries(input.where??{}).every(([key,value])=>row[key]===value)?[row]:[],nextAfter:null};},
    planGet(model,input){calls.push(['guard',model,input]);return {kind:'data-plan'};},
    planCreate(model,input){calls.push(['create',model,input]);return {kind:'data-plan'};},
    planPatch(model,input){calls.push(['patch',model,input]);return {kind:'data-plan',model,input};}}};
}

test('models share records across audiences and restrict relations to the same context',()=>{
  for(const entity of ['contact','prospect']){
    const model=manifest.contracts.models.find(item=>item.id===entity);
    assert.deepEqual(model.primaryKey,['context_id','id']);
    for(const relation of model.relations){
      assert.equal(relation.fields[0],'context_id');
      assert.equal(relation.targetFields[0],'context_id');
      assert.equal(relation.onDelete,'restrict');
    }
  }
});
test('creation validates names, stage and same-scope references before a plan',async()=>{
  const c=context();
  await assert.rejects(companyCreate({requestKey:'x',name:'   '},c),{code:'invalid_input'});
  await assert.rejects(prospectCreate({requestKey:'x',name:'Valid',stage:'invented'},c),{code:'invalid_input'});
  const created=await prospectCreate({requestKey:'y',name:'Prospect',companyId:'co-a',contactId:'ct-a'},c);
  assert.equal(created.plans.length,5);
  assert.deepEqual(c.calls.filter(call=>call[0]==='guard').map(call=>call[2].where),
    [{archived_at:null},{archived_at:null}]);
  assert.deepEqual(c.calls.filter(call=>call[0]==='patch').map(call=>call[1]),['company','contact']);
  assert.equal(c.calls.at(-1)[2].values.context_id,undefined,'context comes from the data lease');
  assert.equal(c.calls.at(-1)[2].values.audience,undefined);
  assert.equal(c.calls.at(-1)[2].values.stage,'a_contacter');
  const archived=context({...{company},contact:{...contact,archived_at:stamp},prospect});
  await assert.rejects(contactCreate({requestKey:'x',name:'New',companyId:'missing'},
    context({company:null,contact:null,prospect:null})),{code:'not_found'});
  await assert.rejects(prospectCreate({requestKey:'x',name:'New',contactId:'ct-a'},archived),{code:'conflict'});
});
test('revision conflict, guarded patch and referenced company archive',async()=>{
  const c=context();
  await assert.rejects(prospectUpdate({requestKey:'x',id:'pr-a',revision:2,name:'Changed'},c),{code:'conflict'});
  const changed=await prospectUpdate({requestKey:'x',id:'pr-a',revision:3,stage:'rdv'},c);
  assert.equal(changed.output.item.revision,4);
  assert.equal(c.calls.at(-1)[2].compare.expected,3);
  assert.equal(Object.hasOwn(c.calls.at(-1)[2].values,'revision'),false,
    'the data engine increments the compared revision in the same guarded write');
  assert.deepEqual(c.calls.at(-1)[2].where,{archived_at:null});
  await assert.rejects(companyArchive({requestKey:'x',id:'co-a',revision:2},c),{code:'conflict'});
});
test('search relies on the data-port context and credential permission, not a data audience split',async()=>{
  const c=context();
  const result=await prospectSearch({query:'aventure',limit:5},c);
  assert.equal(result.output.items.length,1);
  assert.equal(c.calls.find(call=>call[0]==='list')[2].where,undefined);
  assert.equal(c.calls.find(call=>call[0]==='list')[2].limit,5);
});
test('search cursor resumes after the last inspected match, not the end of a larger page',async()=>{
  const rows=[{...prospect,id:'pr-1',name:'Match one',notes:'private-marker'},
    {...prospect,id:'pr-2',name:'Match two'},
    {...prospect,id:'pr-3',name:'Other'}];
  const c={contextId:'ctx-a',audience:'admin',principalId:'user-a',data:{
    async list(_model,input){const from=input.after?rows.findIndex(row=>row.id===input.after.id)+1:0;
      return {items:rows.slice(from),nextAfter:null};}}};
  const first=await prospectSearch({query:'match',limit:1},c);
  assert.equal(first.output.items[0].id,'pr-1');
  assert.ok(first.output.nextCursor);
  assert.ok(!atob(first.output.nextCursor.replaceAll('-','+').replaceAll('_','/')).includes('private-marker'),
    'cursor contains only ordering keys, not the private CRM record');
  const second=await prospectSearch({query:'match',limit:1,cursor:first.output.nextCursor},c);
  assert.equal(second.output.items[0].id,'pr-2');
  await assert.rejects(prospectSearch({query:'other',limit:1,cursor:first.output.nextCursor},c),
    {code:'invalid_input'});
});
test('parent revision CAS makes a newly linked contact conflict with a concurrent archive',async()=>{
  const c=context({company,contact:null,prospect:null});
  const archive=await companyArchive({requestKey:'archive',id:'co-a',revision:2},c);
  const link=await contactCreate({requestKey:'link',name:'New',companyId:'co-a'},c);
  const archivePatch=archive.plans.find(plan=>plan.model==='company');
  const linkPatch=link.plans.find(plan=>plan.model==='company');
  assert.equal(archivePatch.input.compare.expected,2);
  assert.equal(linkPatch.input.compare.expected,2);
  assert.deepEqual(linkPatch.input.where,{archived_at:null});
  const stored={...company};
  const commit=plan=>{
    if(stored.revision!==plan.input.compare.expected||stored.archived_at!==plan.input.where?.archived_at
      && plan.input.where?.archived_at!==undefined)return false;
    stored.revision++;
    if(Object.hasOwn(plan.input.values,'archived_at'))stored.archived_at=plan.input.values.archived_at;
    return true;
  };
  assert.equal(commit(linkPatch),true);
  assert.equal(commit(archivePatch),false);
  stored.revision=2;
  assert.equal(commit(archivePatch),true);
  assert.equal(commit(linkPatch),false);
});
