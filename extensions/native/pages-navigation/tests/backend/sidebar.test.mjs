import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarCatalog,sidebarResolved,sidebarSave} from '../../module/sidebar.ts';
import {manifest} from '../helpers.mjs';

const digest=`sha256-${'7'.repeat(64)}`;
const entries=[{id:'module:one',moduleId:'module',viewId:'view:one',title:'Original',order:10,
  route:'/original',audiences:['admin','app'],permissionIds:['module:read'],available:true},
  {id:'module:private',moduleId:'module',viewId:'view:private',title:'Privé',order:20,
    route:'/private',audiences:['admin'],permissionIds:['module:manage'],available:false}];
const projection={compositionDigest:digest,contextId:'application',audience:'admin',
  sessionId:'session-1',epoch:5,entries};
function harness(saved=null,selected=projection){
  const plans=[];
  const context={principalId:'owner-1',audience:'admin',data:{
    async get(name,input){assert.equal(name,'sidebar_overrides');assert.deepEqual(input.key,{id:'workspace'});return saved;},
    planCreate(name,input){plans.push({name,input,kind:'create'});return {kind:'data-plan'};},
    planPatch(name,input){plans.push({name,input,kind:'patch'});return {kind:'data-plan'};}},
    workspaceNavigation:{async read(){return selected;}}};
  return {context,plans};
}
test('sidebar contract stores only bounded cosmetic overrides under a separate permission',()=>{
  const model=manifest.contracts.models.find(item=>item.id==='sidebar_overrides');
  assert.deepEqual(model.primaryKey,['context_id','id']);
  assert.deepEqual(model.fields.map(field=>field.id),
    ['context_id','id','overrides','revision','updated_at','updated_by']);
  assert.deepEqual(manifest.contracts.operations.filter(op=>op.id.startsWith('sidebar.'))
    .map(op=>[op.id,op.permissions[0].id,op.audiences]),[
      ['sidebar.catalog','sidebar.manage',['admin']],
      ['sidebar.resolved','sidebar.read',['admin','app']],
      ['sidebar.save','sidebar.manage',['admin']]]);
});
test('catalogue retains static route and permission; resolved output filters unavailable and hidden IDs',async()=>{
  const stored={id:'workspace',revision:2,overrides:{'module:one':{hidden:true,title:'Renommé',order:30},
    'missing:module':{hidden:true}},updated_at:'2026-09-30T00:00:00.000Z',updated_by:'owner-1'};
  const h=harness(stored);
  const catalog=(await sidebarCatalog({},h.context)).output;
  assert.equal(catalog.entries[0].route,'/original');
  assert.deepEqual(catalog.entries[0].permissionIds,['module:read']);
  assert.equal(catalog.entries[0].displayTitle,'Renommé');
  assert.equal(catalog.entries[0].hidden,true);
  assert.equal(catalog.entries.length,1,'catalogue does not expose inaccessible routes or permissions');
  assert.deepEqual((await sidebarResolved({},h.context)).output.items,[]);
  assert.equal(JSON.stringify(catalog).includes('missing:module'),false,'dormant IDs are not displayed');
});
test('save validates current visible IDs, preserves dormant overrides and uses a revision CAS',async()=>{
  const prior={id:'workspace',revision:2,overrides:{'missing:module':{hidden:true}},
    updated_at:'2026-09-30T00:00:00.000Z',updated_by:'owner-0'};
  const h=harness(prior);
  const result=await sidebarSave({expectedRevision:2,edits:[{id:'module:one',hidden:true,
    title:'Nouveau',order:5}],resetIds:[]},h.context);
  assert.equal(result.output.revision,3);
  assert.equal(h.plans[0].kind,'patch');assert.equal(h.plans[0].input.compare.expected,2);
  assert.deepEqual(h.plans[0].input.values.overrides['missing:module'],{hidden:true});
  assert.deepEqual(h.plans[0].input.values.overrides['module:one'],
    {hidden:true,title:'Nouveau',order:5});
  assert.doesNotMatch(JSON.stringify(h.plans),/\/original|module:read|view:one/u);
  await assert.rejects(sidebarSave({expectedRevision:1,edits:[],resetIds:[]},harness(prior).context),
    {code:'conflict'});
  await assert.rejects(sidebarSave({expectedRevision:2,edits:[{id:'module:private',hidden:true}],
    resetIds:[]},harness(prior).context),{code:'invalid_input'});
  await assert.rejects(sidebarSave({expectedRevision:2,edits:[],resetIds:['missing:module']},
    harness(prior).context),{code:'invalid_input'});
  const reset=harness({...prior,overrides:{...prior.overrides,'module:one':{hidden:true}}});
  await sidebarSave({expectedRevision:2,edits:[],resetIds:['module:one']},reset.context);
  assert.deepEqual(reset.plans[0].input.values.overrides,{'missing:module':{hidden:true}});
});
