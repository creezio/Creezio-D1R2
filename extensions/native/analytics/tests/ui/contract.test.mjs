import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {manifest,read} from '../helpers.mjs';
import {analyticsPanelState,readAnalyticsPanelState,retainedSessionId,sameAnalyticsScope,
  sessionVerified} from '../../ui/panel-state.ts';

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

test('the original analytics layout remains while unavailable measures stay explicit',()=>{
  const ui=read('ui/index.tsx');
  for(const title of ['Vue d’ensemble','Productivité','Pages','Clics','Collaborateurs','Journal'])
    assert.ok(ui.includes(title),title);
  for(const structure of ['bg-gradient-to-r from-slate-50 via-white to-sky-50/60',
    'KpiCard','ActivityChart','Répartition','TopList','DataTable','Heatmap d’activité','Pauses détectées','Blocs de focus'])
    assert.ok(ui.includes(structure),structure);
  for(const missing of ['mesure de présence indisponible','suivi automatique n’est pas encore disponible',
    'Les requêtes et opérations techniques ne figurent pas encore'])
    assert.ok(ui.toLocaleLowerCase().includes(missing.toLocaleLowerCase()),missing);
  assert.match(ui,/value="—" hint="Mesure de présence indisponible"/u);
  assert.match(ui,/setInterval\(.*8000/u);
  assert.match(ui,/URL\.revokeObjectURL/u);
  assert.deepEqual(manifest.contracts.ui.views[0].surfaces,['workspace']);
});
