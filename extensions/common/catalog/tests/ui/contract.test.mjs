import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {createCommandJournal} from '@creezio/sdk/operations/command-journal';
import {manifest,read} from '../helpers.mjs';
import {money} from '../../ui/money.ts';
import {catalogPanelState,readCatalogPanelState} from '../../ui/panel-state.ts';
import {retainedSessionId,sameCatalogScope,sessionVerified} from '../../ui/session.ts';
import {createImageGate} from '../../ui/image-gate.ts';

test('temporary session verification suspends catalog without discarding its scope',()=>{
  const authenticated=id=>({phase:'authenticated',pending:null,session:{id}});
  const loading={phase:'loading',pending:null,session:null};
  let retained=retainedSessionId('',authenticated('session-one'));
  assert.equal(retained,'session-one');
  assert.equal(sessionVerified(authenticated('session-one'),retained),true);
  retained=retainedSessionId(retained,loading);
  assert.equal(retained,'session-one');
  assert.equal(sessionVerified(loading,retained),false);
  retained=retainedSessionId(retained,{phase:'unavailable',pending:null,session:null});
  assert.equal(retained,'session-one');
  retained=retainedSessionId(retained,authenticated('session-one'));
  assert.equal(retained,'session-one');
  assert.equal(retainedSessionId(retained,{phase:'anonymous',pending:null,session:null}),'');
  assert.equal(retainedSessionId(retained,authenticated('session-two')),'session-two');
  for(const file of ['ui/index.tsx','ui/front.tsx']){
    const source=read(file);
    assert.match(source,/retainedSessionId\(retained\.current,access\)/u);
    assert.match(source,/sessionVerified\(access,sessionId\)/u);
    assert.match(source,/if\(access\.phase==='authenticated'&&!access\.pending&&!props\.authorized\)/u);
    assert.match(source,/if\(listKey\.current!==visibleListKey\)\{listKey\.current=visibleListKey;listSerial\.current\+\+;\}/u);
  }
});

test('catalog scope guard hides old admin and front data on a direct identity change',()=>{
  const previous={sessionId:'session-one',audience:'admin',contextId:'application'};
  assert.equal(sameCatalogScope(previous,{...previous}),true);
  assert.equal(sameCatalogScope(previous,{...previous,sessionId:'session-two'}),false);
  assert.equal(sameCatalogScope(previous,{...previous,audience:'app'}),false);
  assert.equal(sameCatalogScope(previous,{...previous,contextId:'other'}),false);
});

test('admin and authenticated front use the same catalog without multiplying prices',()=>{
  const admin=read('ui/index.tsx'),front=read('ui/front.tsx');
  assert.equal(money(12345,'EUR'),'123,45 €');
  assert.match(money(12345,'JPY'),/12[.,\s ]?345/u);
  for(const phrase of ['Produits','Catégories','Rechercher SKU ou nom','Publier','Archiver','Images privées'])
    assert.ok(admin.includes(phrase),phrase);
  for(const phrase of ['Catalogue','product.search','product.get','Aucune image publique'])
    assert.ok(front.includes(phrase),phrase);
  assert.equal(manifest.contracts.ui.views.find(view=>view.id==='admin').surfaces[0],'workspace');
  assert.equal(manifest.contracts.ui.views.find(view=>view.id==='front').surfaces[0],'front');
  assert.match(front,/downloadLinked\(first\.reference,productId,current\)/u);
  assert.match(front,/IntersectionObserver/u);
  assert.match(front,/URL\.revokeObjectURL\(objectUrl\)/u);
});
test('view sessions reject late results and clear data on scope change',()=>{
  for(const file of ['ui/index.tsx','ui/front.tsx']){
    const source=read(file);
    assert.match(source,/epoch\.current\+\+/u);
    assert.match(source,/identityChanged/u);
    assert.match(source,/props\.access\.getSnapshot\(\)\.session\?\.id===sessionId/u);
    assert.match(source,/selectedRef\.current===id/u);
    assert.match(source,/setCategories\(\[\]\)/u);
  }
});
test('every admin panel save retains the unresolved SDK command',()=>{
  const admin=read('ui/index.tsx');
  assert.equal((admin.match(/savePanelState\(/gu)??[]).length,2);
  assert.equal((admin.match(/savePanelState\(catalogPanelState\(/gu)??[]).length,2);
  for(const operation of ['category.create','category.update','category.archive','product.create',
    'product.update','product.publish','product.archive','media.link','media.unlink'])
    assert.ok(admin.includes(operation),operation);
  assert.match(admin,/controller\.execute\(/u);
  assert.match(admin,/controller\.inspect\(/u);
  const schema=manifest.contracts.schemas.find(item=>item.id==='catalog-panel-state').schema;
  const valid=new Ajv2020({strict:true}).compile(schema);
  const pending={sessionId:'session-one',audience:'admin',contextId:'application',
    bindingId:'creezio.catalog:admin.product.create',requestKey:'request-one',intent:'product.create'};
  const scope={sessionId:'session-one',audience:'admin',contextId:'application'};
  const panel=catalogPanelState({...scope,tab:'products',query:'book',categoryId:'',selectedId:''},pending);
  assert.equal(valid(panel.data),true,JSON.stringify(valid.errors));
  assert.deepEqual(panel.data.pending,pending);
  assert.equal(valid(catalogPanelState({...scope,tab:'categories',query:'',categoryId:'',selectedId:''},null).data),true);
  assert.deepEqual(readCatalogPanelState(panel.data,scope),{...scope,tab:'products',query:'book',
    categoryId:'',selectedId:''});
  for(const foreign of [{...scope,sessionId:'another'}, {...scope,audience:'app'},
    {...scope,contextId:'another'},{...scope,sessionId:''}])
    assert.equal(readCatalogPanelState(panel.data,foreign),null);
  assert.equal(readCatalogPanelState({tab:'products',query:'book',categoryId:'',selectedId:''},scope),null,
    'legacy unscoped panel data is discarded rather than inherited');
  assert.match(admin,/readCatalogPanelState\(saved\?\.data/u);
  assert.match(admin,/restored=readCatalogPanelState\(savedPanel\?\.data/u);
});
test('SDK journal refuses lost persistence, blocks uncertain replay, then inspects same key',async()=>{
  const scope={sessionId:'session-one',audience:'admin',contextId:'application'};
  const issued={...scope,bindingId:'creezio.catalog:admin.product.create',requestKey:'request-one',
    intent:'product.create'};
  let invokes=0,statuses=0,saved=null;
  const client={audience:'admin',invoke:async()=>{invokes++;return {kind:'unknown',code:'outcome_unknown'};},
    status:async input=>{statuses++;assert.equal(input.requestKey,'request-one');
      return {kind:'execution',execution:{state:'succeeded',output:{product:{id:'product-one'}}}};}};
  const journal=createCommandJournal(scope);
  const unavailable=await journal.execute(client,issued,{sku:'SKU-1'},()=>true,()=>false);
  assert.equal(unavailable.result.code,'client_state_unavailable');
  assert.equal(invokes,0);
  const persist=value=>{saved=catalogPanelState({...scope,tab:'products',query:'',categoryId:'',selectedId:''},value);
    return true;};
  const first=await journal.execute(client,issued,{sku:'SKU-1'},()=>true,persist);
  assert.equal(first.pending.requestKey,'request-one');
  assert.equal(saved.data.pending.requestKey,'request-one');
  const blocked=await journal.execute(client,{...issued,requestKey:'request-two'},{sku:'SKU-2'},()=>true,persist);
  assert.equal(blocked.result.code,'in_progress');
  assert.equal(invokes,1);
  const inspected=await journal.inspect(client,()=>true,persist);
  assert.equal(inspected.pending,null);
  assert.equal(saved.data.pending,undefined);
  assert.equal(statuses,1);
  assert.equal(invokes,1);
});

test('visible image reads remain below the file throttle and queued stale views do not read',async()=>{
  let now=0,wake=null,calls=0;
  const gate=createImageGate({now:()=>now,maxConcurrent:1,maxPerMinute:2,
    delay:(run,ms)=>{wake={run,ms};return 1;},clear:()=>{wake=null;}});
  const read=()=>gate.run(()=>true,async()=>++calls);
  assert.equal(await read(),1);
  assert.equal(await read(),2);
  let stale=false;
  const third=gate.run(()=>!stale,async()=>++calls);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);
  assert.equal(wake.ms,60000);
  stale=true;now=60000;wake.run();
  assert.equal(await third,undefined);
  assert.equal(calls,2);
  assert.equal(await read(),3);
  gate.cancel();
});

test('visible image gate caps simultaneous GETs and clears queued work on unmount',async()=>{
  const releases=[];
  const gate=createImageGate({maxConcurrent:2,maxPerMinute:20});
  const run=()=>gate.run(()=>true,()=>new Promise(resolve=>releases.push(resolve)));
  const first=run(),second=run(),third=run();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(releases.length,2);
  gate.cancel();
  assert.equal(await third,undefined);
  releases[0]('one');releases[1]('two');
  assert.deepEqual(await Promise.all([first,second]),['one','two']);
});
