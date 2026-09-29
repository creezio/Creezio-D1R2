import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {pageCreate,pageSave,pagePublish,pageReset,pagePublishedRead,pagePublishedList,pagePublishedResolve,navigationSave,
  navigationPublish,navigationReset,mediaLink,mediaUnlink} from '../../module/service.ts';

const page={id:'home',slug:'/',title:'Accueil',draft_sections:[],draft_settings:{},draft_seo:{},
  published_slug:null,published_title:null,published_sections:null,published_settings:null,
  published_seo:null,revision:1,published_revision:0,updated_at:'2026-09-28T00:00:00.000Z',
  published_at:null,created_at:'2026-09-28T00:00:00.000Z'};
function harness(rows={}){
  const calls=[];
  const data={get:async(model)=>rows[model]??null,
    list:async(model,args)=>{calls.push({kind:'list',model,args});return rows[`${model}Page`]??{items:[],nextAfter:null};},
    planGet:(model,args)=>{calls.push({kind:'get',model,args});return {kind:'plan'};},
    planCreate:(model,args)=>{calls.push({kind:'create',model,args});return {kind:'plan'};},
    planPatch:(model,args)=>{calls.push({kind:'patch',model,args});return {kind:'plan'};},
    planDelete:(model,args)=>{calls.push({kind:'delete',model,args});return {kind:'plan'};}};
  return {context:{contextId:'workspace',principalId:'alice',actorPrincipalId:'alice',audience:'admin',data},calls};
}
const content={sections:[{id:'hero-one',kind:'hero',position:0,enabled:true,
  content:{headline:'Bonjour',linkUrl:'https://example.org'}}],settings:{brandName:'Creezio'},
  seo:{title:'Accueil',canonical:'https://example.org/'}};

test('context-scoped page, navigation and private media have generated D1 relations',()=>{
  const models=JSON.parse(read('module/models.json'));
  assert.deepEqual(manifest.contracts.models,models);
  assert.deepEqual(models.find(model=>model.id==='page').primaryKey,['context_id','id']);
  assert.deepEqual(models.find(model=>model.id==='page_media').relations[0].fields,['context_id','page_id']);
  assert.equal(manifest.contracts.files[0].public,false);
});

test('save and publish use CAS; reset changes draft only',async()=>{
  const h=harness({page});
  const saved=await pageSave({pageId:'home',revision:1,slug:'/accueil',title:'Nouveau',...content},h.context);
  assert.equal(saved.output.page.revision,2);
  assert.deepEqual(h.calls.at(-1).args.compare,{field:'revision',expected:1});
  assert.equal(h.calls.at(-1).args.values.published_slug,undefined);
  const published=await pagePublish({pageId:'home',revision:1},h.context);
  assert.equal(published.output.page.slug,'/');
  assert.equal(published.output.page.publishedRevision,1);
  assert.deepEqual(h.calls.at(-1).args.compare,{field:'revision',expected:1});
  const reset=await pageReset({pageId:'home',revision:1},h.context);
  assert.equal(reset.output.page.revision,2);
  assert.equal(h.calls.at(-1).args.values.published_sections,undefined);
  await assert.rejects(pageSave({pageId:'home',revision:0,slug:'/',title:'X',...content},h.context),
    {code:'conflict'});
  await assert.rejects(pagePublishedRead({pageId:'home'},h.context),{code:'not_found'});
});

test('server rejects unsafe links, including nested section content',async()=>{
  const h=harness({page});
  await assert.rejects(pageSave({pageId:'home',revision:1,slug:'/',title:'Accueil',...content,
    sections:[{...content.sections[0],content:{cards:[{href:'javascript:alert(1)'}]}}]},h.context),
  {code:'invalid_input'});
  await assert.rejects(pageSave({pageId:'home',revision:1,slug:'/',title:'Accueil',...content,
    seo:{canonical:'javascript:alert(1)'}},h.context),{code:'invalid_input'});
  await assert.rejects(pageSave({pageId:'home',revision:1,slug:'/',title:'Accueil',...content,
    settings:{background:'url(https://external.example/pixel)'}},h.context),{code:'invalid_input'});
  await assert.rejects(pageCreate({id:'bad/id',slug:'/',title:'Accueil'},h.context),{code:'invalid_input'});
});

test('published listing projects summaries and preserves cursor across unpublished rows',async()=>{
  const unpublished={...page,id:'newer',published_at:null};
  const published={...page,id:'home',published_slug:'/',published_title:'Accueil',
    published_at:'2026-09-28T00:00:00.000Z',published_revision:1};
  const h=harness({pagePage:{items:[unpublished,published],nextAfter:{updated_at:published.updated_at,id:'home'}}});
  const result=await pagePublishedList({limit:50},h.context);
  assert.deepEqual(result.output.items,[{id:'home',slug:'/',title:'Accueil',publishedRevision:1,
    publishedAt:'2026-09-28T00:00:00.000Z'}]);
  assert.equal(typeof result.output.nextCursor,'string');
  assert.deepEqual(h.calls.find(call=>call.kind==='list').args.fields,
    ['id','updated_at','published_slug','published_title','published_revision','published_at']);
});

test('slug resolution uses the published unique index and never returns a draft',async()=>{
  const published={...page,published_slug:'/accueil',published_at:'2026-09-28T00:00:00.000Z'};
  const h=harness({pagePage:{items:[published],nextAfter:null}});
  assert.deepEqual((await pagePublishedResolve({slug:'/accueil'},h.context)).output,
    {pageId:'home',slug:'/accueil'});
  assert.deepEqual(h.calls[0].args.where,{published_slug:'/accueil'});
  assert.equal(h.calls[0].args.order,undefined,
    'the nullable published slug can filter through the index but cannot be a port sort key');
  assert.equal(h.calls[0].args.limit,1);
  const unpublished=harness({pagePage:{items:[{...published,published_at:null}],nextAfter:null}});
  await assert.rejects(pagePublishedResolve({slug:'/accueil'},unpublished.context),{code:'not_found'});
  await assert.rejects(pagePublishedResolve({slug:'/admin'},harness().context),{code:'not_found'});
  await assert.rejects(pagePublishedResolve({slug:'//other.example'},h.context),{code:'invalid_input'});
});

test('navigation starts empty, publishes a snapshot and reset preserves published items',async()=>{
  const item={id:'home',label:'Accueil',href:'/',icon:'Home',group:'brand',order:0,hidden:false};
  const h=harness();
  const saved=await navigationSave({revision:0,items:[item]},h.context);
  assert.equal(saved.output.navigation.revision,1);
  assert.equal(h.calls.at(-1).kind,'create');
  const existing={id:'primary',draft_items:[item],published_items:[],revision:1,published_revision:0,
    updated_at:'2026-09-28T00:00:00.000Z',published_at:null};
  const h2=harness({navigation:existing});
  const published=await navigationPublish({revision:1},h2.context);
  assert.deepEqual(published.output.navigation.items,[item]);
  assert.equal(published.output.navigation.publishedRevision,1);
  const reset=await navigationReset({revision:1},h2.context);
  assert.equal(reset.output.navigation.revision,2);
  assert.equal(h2.calls.at(-1).args.values.published_items,undefined);
  await assert.rejects(navigationSave({revision:1,items:[{...item,href:'//evil.test'}]},h2.context),
    {code:'invalid_input'});
});

test('explicit page links publish only a matching published slug; legacy routes remain unchanged',async()=>{
  const linked={id:'help',label:'Aide',href:'/aide',pageSlug:'/aide',icon:'',group:'',order:0,hidden:false};
  const h=harness({navigation:{id:'primary',draft_items:[linked],published_items:[],revision:1,
    published_revision:0,updated_at:'2026-09-28T00:00:00.000Z',published_at:null},
    pagePage:{items:[{...page,published_slug:'/aide',published_at:'2026-09-28T00:00:00.000Z'}]}});
  assert.deepEqual((await navigationPublish({revision:1},h.context)).output.navigation.items,[linked]);
  assert.deepEqual(h.calls.find(call=>call.kind==='list').args.where,{published_slug:'/aide'});
  const missing=harness({navigation:{
    id:'primary',draft_items:[linked],published_items:[],revision:1,published_revision:0}});
  await assert.rejects(navigationPublish({revision:1},missing.context),{code:'not_found'});
  await assert.rejects(navigationSave({revision:0,items:[{...linked,href:'/other'}]},harness().context),
    {code:'invalid_input'});
  const hundred=Array.from({length:100},(_,index)=>({...linked,id:`link-${index}`,
    href:`/page-${index}`,pageSlug:`/page-${index}`}));
  const budget=harness({navigation:{id:'primary',draft_items:hundred,published_items:[],revision:1,
    published_revision:0},pagePage:{items:[{...page,published_at:'2026-09-28T00:00:00.000Z'}]}});
  await navigationPublish({revision:1},budget.context);
  assert.equal(budget.calls.filter(call=>call.kind==='list').length,100);
  assert.equal(manifest.contracts.operations.find(op=>op.id==='navigation.publish').execution.maxItems,102);
});

test('private R2 link and unlink pair page CAS with relation, without deleting file',async()=>{
  const h=harness({page,page_media:{page_id:'home',file_id:'f1'}});
  h.context.files={preparePublication:async()=>({plan:{kind:'file-plan'},file:{filename:'a.png',
    contentType:'image/png',byteSize:123}})};
  const reference={fileId:'f1',intentId:'i1',generation:'g1',digest:'a'.repeat(64)};
  const linked=await mediaLink({pageId:'home',revision:1,staged:reference},h.context);
  assert.equal(linked.plans.length,4);
  assert.deepEqual(h.calls.find(call=>call.kind==='patch').args.compare,{field:'revision',expected:1});
  const removed=await mediaUnlink({pageId:'home',revision:1,fileId:'f1'},h.context);
  assert.equal(removed.output.removed,true);
  assert.equal(h.calls.some(call=>call.model==='file_metadata'&&call.kind==='delete'),false);
  assert.deepEqual(h.calls.find(call=>call.kind==='delete').args.key,{page_id:'home',file_id:'f1'});
});
