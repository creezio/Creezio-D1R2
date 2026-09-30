import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {manifest,read} from '../helpers.mjs';
import {analyticsPanelState,readAnalyticsPanelState,retainedSessionId,sameAnalyticsScope,
  sessionVerified} from '../../ui/panel-state.ts';
import {collectExportPages} from '../../ui/export.ts';
import {createCommandJournal} from '@creezio/sdk/operations/command-journal';

test('session verification suspends analytics while same scoped filters survive',()=>{
  const scope={sessionId:'session-one',audience:'admin',contextId:'application'};
  const panel=analyticsPanelState(scope,{tab:'logs',period:'year',query:'checkout',
    type:'click',principalId:'author-one'});
  const schema=manifest.contracts.schemas.find(item=>item.id==='analytics-panel-state').schema;
  const valid=new Ajv2020({strict:true}).compile(schema);
  assert.equal(valid(panel.data),true,JSON.stringify(valid.errors));
  assert.deepEqual(readAnalyticsPanelState(panel,scope),{tab:'logs',period:'year',
    query:'checkout',type:'click',principalId:'author-one'});
  let retained=retainedSessionId('',{phase:'authenticated',pending:null,session:{id:'session-one'}});
  retained=retainedSessionId(retained,{phase:'loading',pending:null,session:null});
  assert.equal(retained,'session-one');
  assert.equal(sessionVerified({phase:'loading',pending:null,session:null},retained),false);
  retained=retainedSessionId(retained,{phase:'unavailable',pending:null,session:null});
  assert.equal(retained,'session-one');
  assert.equal(sessionVerified({phase:'authenticated',pending:null,session:{id:'session-one'}},retained),true);
  assert.equal(readAnalyticsPanelState(panel,{...scope,sessionId:'session-two'}),null);
  assert.equal(readAnalyticsPanelState(panel,{...scope,contextId:'another'}),null);
  assert.equal(readAnalyticsPanelState(panel,{...scope,audience:'app'}),null);
  assert.equal(readAnalyticsPanelState({activeSubview:'logs',data:{period:'year',query:'old',type:'',
    principalId:''}},scope),null);
  retained=retainedSessionId(retained,{phase:'anonymous',pending:null,session:null});
  assert.equal(retained,'');
  assert.equal(readAnalyticsPanelState(panel,{...scope,sessionId:retained}),null);
  const source=read('ui/index.tsx');
  assert.match(source,/retainedSessionId\(retained\.current,access\)/u);
  assert.match(source,/readAnalyticsPanelState\(props\.navigation\.readPanelState\(\)/u);
  assert.match(source,/epoch\.current\+\+/u);
  assert.match(source,/live\.current\.period!==period\|\|live\.current\.appliedQuery!==appliedQuery/u);
});

test('analytics hides a previous session or context before its reset effect runs',()=>{
  const previous={sessionId:'session-one',audience:'admin',contextId:'application'};
  assert.equal(sameAnalyticsScope(previous,{...previous}),true);
  assert.equal(sameAnalyticsScope(previous,{...previous,sessionId:'session-two'}),false);
  assert.equal(sameAnalyticsScope(previous,{...previous,audience:'app'}),false);
  assert.equal(sameAnalyticsScope(previous,{...previous,contextId:'other'}),false);
});

test('retention command journal persists only scoped metadata and inspects unknown without replay',async()=>{
  const scope={sessionId:'session-one',audience:'admin',contextId:'application'};
  const filters={tab:'logs',period:'month',query:'',type:'',principalId:''};
  const issued={...scope,bindingId:'creezio.analytics:admin.retention.purge',
    requestKey:'retention-request-one',intent:'retention.purge'};
  let panel=analyticsPanelState(scope,filters),allowSave=false,invocations=0,statusReads=0;
  const persist=value=>{if(!allowSave)return false;
    panel=analyticsPanelState(scope,filters,value);return true;};
  const client={audience:'admin',async invoke(){invocations++;return {kind:'unknown',code:'outcome_unknown'};},
    async status(){statusReads++;return {kind:'rejected',code:'unavailable',status:503};}};
  let journal=createCommandJournal(scope);
  const input={revision:2,cutoff:'2025-01-01T00:00:00.000Z',
    items:[{id:'event-one',occurredAt:'2024-01-01T00:00:00.000Z'}]};
  const blocked=await journal.execute(client,issued,input,()=>true,persist);
  assert.equal(blocked.result.code,'client_state_unavailable');assert.equal(invocations,0);
  allowSave=true;
  const unknown=await journal.execute(client,issued,input,()=>true,persist);
  assert.equal(unknown.result.kind,'unknown');assert.equal(invocations,1);
  const schema=manifest.contracts.schemas.find(item=>item.id==='analytics-panel-state').schema;
  const valid=new Ajv2020({strict:true}).compile(schema);
  assert.equal(valid(panel.data),true,JSON.stringify(valid.errors));
  assert.deepEqual(Object.keys(panel.data.pending).sort(),Object.keys(issued).sort());
  assert.equal(JSON.stringify(panel).includes('event-one'),false);
  assert.deepEqual(readAnalyticsPanelState(panel,scope),filters);
  journal=createCommandJournal(scope,JSON.parse(JSON.stringify(panel.data.pending)));
  assert.equal(journal.pending.requestKey,issued.requestKey);
  const refused=await journal.execute(client,{...issued,requestKey:'another-request'},input,()=>true,persist);
  assert.equal(refused.result.code,'in_progress');assert.equal(invocations,1);
  const inspected=await journal.inspect(client,()=>true,persist);
  assert.equal(inspected.result.code,'unavailable');assert.equal(statusReads,1);
  assert.equal(journal.pending.requestKey,issued.requestKey);
  for(const changed of [{sessionId:'another-session'},{audience:'app'},{contextId:'other'}]){
    const foreign={...scope,...changed};
    assert.equal(readAnalyticsPanelState(panel,foreign),null);
    assert.equal(createCommandJournal(foreign,panel.data.pending).pending,null);
  }
});

test('the original analytics layout remains while unavailable measures stay explicit',()=>{
  const ui=read('ui/index.tsx');
  for(const title of ['Vue d’ensemble','Productivité','Pages','Clics','Collaborateurs','Journal'])
    assert.ok(ui.includes(title),title);
  for(const structure of ['bg-gradient-to-r from-slate-50 via-white to-sky-50/60',
    'KpiCard','ActivityChart','Répartition','TopList','DataTable','Heatmap d’activité','Pauses détectées','Blocs de focus'])
    assert.ok(ui.includes(structure),structure);
  for(const missing of ['mesure de présence indisponible','data-creezio-analytics-id',
    'les exécutions et les refus avant moteur sont présentés séparément'])
    assert.ok(ui.toLocaleLowerCase().includes(missing.toLocaleLowerCase()),missing);
  assert.match(ui,/value="—" hint="Mesure de présence indisponible"/u);
  assert.match(ui,/setInterval\(.*8000/u);
  assert.match(ui,/URL\.revokeObjectURL/u);
  assert.deepEqual(manifest.contracts.ui.views[0].surfaces,['workspace']);
});

test('multi-page export keeps the server period, bounds pages and rejects stale or cycling reads',async()=>{
  const period={period:'week',from:'2026-09-23T00:00:00.000Z',to:'2026-09-30T00:00:00.000Z'};
  const pages=[{format:'json',period,content:'[{"id":"one"}]',complete:false,nextCursor:'next'},
    {format:'json',period,content:'[{"id":"two"}]',complete:true,nextCursor:null}];
  const result=await collectExportPages({period:'week',format:'json',fetch:async cursor=>pages[cursor?1:0],
    isCurrent:()=>true});
  assert.equal(result.complete,true);assert.equal(result.pages,2);
  assert.deepEqual(JSON.parse(result.content),[{id:'one'},{id:'two'}]);
  await assert.rejects(collectExportPages({period:'week',format:'json',fetch:async()=>({...pages[0],
    period:{...period,to:'2026-09-29T00:00:00.000Z'}}),isCurrent:()=>true}),/invalid_export/);
  await assert.rejects(collectExportPages({period:'week',format:'json',fetch:async()=>pages[0],
    isCurrent:()=>true}),/invalid_export/);
  await assert.rejects(collectExportPages({period:'week',format:'json',fetch:async()=>pages[0],
    isCurrent:()=>false}),/stale/);
  let active=true;
  await assert.rejects(collectExportPages({period:'week',format:'json',
    fetch:async()=>{active=false;return pages[0];},isCurrent:()=>active}),/stale/);
  const view=read('ui/index.tsx');
  assert.match(view,/exportEpoch\.current\+\+;setExporting\(false\)/u);
  assert.match(view,/if\(exportEpoch\.current===exportToken\)setExporting\(false\)/u);
  const partial=await collectExportPages({period:'week',format:'json',fetch:async(_cursor)=>({
    ...pages[0],nextCursor:crypto.randomUUID()}),isCurrent:()=>true});
  assert.equal(partial.pages,10);assert.equal(partial.complete,false);
  assert.equal(JSON.parse(partial.content).length,10);
});
