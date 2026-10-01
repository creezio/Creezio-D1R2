'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Activity,Clock3,Eye,Filter,MousePointerClick,RefreshCw,Trash2,Users,type LucideIcon} from 'lucide-react';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import {call,errorText,type Count,type Event,type EventPage,type ExportPage,
  type ExecutionDiagnosticsPage,type EndpointDiagnosticsPage,
  type Period,type Snapshot,type Tab} from './contracts.ts';
import {collectExportPages} from './export.ts';
import {analyticsPanelState,readAnalyticsPanelState,retainedSessionId,sameAnalyticsScope,sessionVerified} from './panel-state.ts';
import {RetentionControls} from './retention.tsx';
import {CollectionControls} from './collection.tsx';

const tabs:[Tab,string][]=[['overview','Vue d’ensemble'],['productivity','Productivité'],
  ['pages','Pages'],['clicks','Clics'],['users','Collaborateurs'],['logs','Journal']];
const periods:[Period,string][]=[['day','24 h'],['week','7 j'],['month','30 j'],['year','12 mois']];
const button='inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50';
const card='rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm';
const number=(value:number)=>new Intl.NumberFormat('fr-FR').format(value);
const date=(value:string)=>new Date(value).toLocaleString('fr-FR');
function KpiCard({label,value,hint,icon:Icon,accent}:{label:string;value:string;hint:string;
  icon:LucideIcon;accent:string}){
  return <div className={"relative overflow-hidden "+card}>
    <div className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.12] ${accent}`}/>
    <div className="flex items-start justify-between gap-3"><div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p></div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm ${accent}`}>
        <Icon className="h-5 w-5"/></div></div></div>;
}
function RankBar({value,max}:{value:number;max:number}){
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
    <div className="h-full rounded-full bg-sky-500 transition-all duration-500"
      style={{width:`${max>0?Math.max(4,Math.round(value/max*100)):0}%`}}/></div>;
}
function TopList({title,items,empty}:{title:string;items:Count[];empty:string}){
  const max=Math.max(1,...items.map(item=>item.count));
  return <section className={card}><h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    <div className="mt-3 space-y-3">{items.length===0?<p className="py-6 text-center text-sm text-slate-400">{empty}</p>:
      items.slice(0,8).map((item,index)=><div key={item.name} className="space-y-1">
        <div className="flex items-start justify-between gap-3"><p className="min-w-0 truncate text-sm font-medium text-slate-800" title={item.name}>
          <span className="mr-2 text-xs text-slate-400">{index+1}.</span>{item.name}</p>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{number(item.count)}</span></div>
        <RankBar value={item.count} max={max}/></div>)}</div></section>;
}
function DataTable({headers,rows,empty,framed=true}:{headers:string[];rows:(string|number)[][];
  empty:string;framed?:boolean}){
  return <div className={framed?'overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm':'overflow-hidden'}><div className="overflow-auto">
    <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
      <tr>{headers.map(header=><th key={header} className="px-3 py-2.5 font-medium">{header}</th>)}</tr></thead><tbody>
      {rows.length===0?<tr><td colSpan={headers.length} className="px-3 py-10 text-center text-slate-400">{empty}</td></tr>:
        rows.map((row,index)=><tr key={index} className="border-t border-slate-100 hover:bg-slate-50/70">
          {row.map((cell,column)=><td key={column} className="px-3 py-2.5 align-middle text-slate-700">{cell}</td>)}</tr>)}</tbody>
    </table></div></div>;
}
function ActivityChart({points}:{points:Count[]}){
  if(!points.length)return <p className="flex h-72 items-center justify-center text-sm text-slate-400">Aucune donnée sur cette période</p>;
  const values=points,max=Math.max(1,...values.map(item=>item.count));
  const chart=values.map((item,index)=>({label:item.name,value:item.count,
    x:values.length===1?300:32+index*536/(values.length-1),y:208-item.count/max*172}));
  const line=chart.map(({x,y})=>`${x},${y}`).join(' ');
  return <div className="h-72 w-full" role="img" aria-label="Évolution des événements déclarés sur la période">
    <svg className="h-full w-full" viewBox="0 0 600 240" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="analytics-reported-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#0ea5e9" stopOpacity="0.35"/><stop offset="95%" stopColor="#0ea5e9" stopOpacity="0"/>
      </linearGradient></defs>
      {[36,122,208].map(y=><line key={y} x1="32" x2="568" y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 3"/>)
      }<polygon points={`32,208 ${line} 568,208`} fill="url(#analytics-reported-fill)"/>
      <polyline points={line} fill="none" stroke="#0ea5e9" strokeWidth="2"/>
      {chart.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r="3" fill="#0ea5e9">
        <title>{point.label} : {number(point.value)} événements</title></circle>)}
    </svg><div className="-mt-6 flex justify-between px-4 text-[11px] text-slate-400">
      <span>{values[0]?.name}</span><span>{values[values.length-1]?.name}</span></div></div>;
}
const Unavailable=({title,detail}:{title:string;detail:string})=><div className="rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50/80 to-white px-4 py-3 text-xs leading-relaxed text-slate-600">
  <strong className="text-slate-800">{title} — </strong>{detail}</div>;
/** The original six analytics surfaces, backed only by explicitly reported events. */
export function AnalyticsAdminView(props:RuntimeViewProps){
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const enabled=props.active&&props.authorized&&sessionVerified(access,sessionId);
  const initialPanel=useRef(props.navigation.readPanelState());
  const saved=readAnalyticsPanelState(initialPanel.current,{sessionId,audience:props.audience,
    contextId:props.contextId});
  const [tab,setTab]=useState<Tab>(saved?.tab??'overview'),[period,setPeriod]=useState<Period>(saved?.period??'week');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[events,setEvents]=useState<Event[]>([]);
  const [nextCursor,setNextCursor]=useState<string|null>(null),
    [query,setQuery]=useState(saved?.query??'');
  const [appliedQuery,setAppliedQuery]=useState(saved?.query??''),
    [type,setType]=useState(saved?.type??''),
    [principal,setPrincipal]=useState(saved?.principalId??'');
  const [autoRefresh,setAutoRefresh]=useState(true);
  const [retentionOpen,setRetentionOpen]=useState(false);
  const [busy,setBusy]=useState(false),[loadingMore,setLoadingMore]=useState(false),
    [exporting,setExporting]=useState(false),[notice,setNotice]=useState('');
  const [executions,setExecutions]=useState<ExecutionDiagnosticsPage|null>(null);
  const [endpoints,setEndpoints]=useState<EndpointDiagnosticsPage|null>(null);
  const [diagnosticsBusy,setDiagnosticsBusy]=useState({executions:false,endpoints:false});
  const exportEpoch=useRef(0),diagnosticReads=useRef({executions:0,endpoints:0});
  const epoch=useRef(0),live=useRef({enabled,sessionId,contextId:props.contextId,
    audience:props.audience,client:props.client,access:props.access,period,appliedQuery,type,principal}),
    skipPersist=useRef(false),previousScope=useRef({sessionId,
      contextId:props.contextId,audience:props.audience,client:props.client});
  if(live.current.enabled!==enabled||live.current.sessionId!==sessionId
    ||live.current.contextId!==props.contextId||live.current.audience!==props.audience
    ||live.current.client!==props.client||live.current.access!==props.access
    ||live.current.period!==period||live.current.appliedQuery!==appliedQuery
    ||live.current.type!==type||live.current.principal!==principal)epoch.current++;
  live.current={enabled,sessionId,contextId:props.contextId,audience:props.audience,
    client:props.client,access:props.access,period,appliedQuery,type,principal};
  useRegisterWorkspaceMetadata(props.panelId,{title:'Analytique',kind:'section',trail:[{label:'Analytique'}]});
  const ownScope=sameAnalyticsScope(previousScope.current,{sessionId,audience:props.audience,
    contextId:props.contextId});
  useEffect(()=>{const changed=!sameAnalyticsScope(previousScope.current,{sessionId,
      audience:props.audience,contextId:props.contextId});
    previousScope.current={sessionId,contextId:props.contextId,audience:props.audience,client:props.client};
    epoch.current++;exportEpoch.current++;diagnosticReads.current.executions++;
    diagnosticReads.current.endpoints++;
    setSnapshot(null);setEvents([]);setNextCursor(null);setNotice('');
    setExecutions(null);setEndpoints(null);setDiagnosticsBusy({executions:false,endpoints:false});
    setBusy(false);setLoadingMore(false);setExporting(false);
    if(changed){setRetentionOpen(false);const restored=readAnalyticsPanelState(props.navigation.readPanelState(),
      {sessionId,audience:props.audience,contextId:props.contextId});
      skipPersist.current=true;setTab(restored?.tab??'overview');setPeriod(restored?.period??'week');
      setQuery(restored?.query??'');setAppliedQuery(restored?.query??'');
      setType(restored?.type??'');setPrincipal(restored?.principalId??'');}},
    [sessionId,props.client,props.audience,props.contextId]);
  useEffect(()=>{if(!enabled){epoch.current++;if(access.phase==='authenticated'&&!access.pending
    &&!props.authorized){setSnapshot(null);setEvents([]);setNextCursor(null);
      setExecutions(null);setEndpoints(null);}}},
    [enabled,props.authorized,access.phase,access.pending]);
  useEffect(()=>{exportEpoch.current++;setExporting(false);},[period,appliedQuery,type,principal]);
  useEffect(()=>{diagnosticReads.current.executions++;setExecutions(null);
    setDiagnosticsBusy(previous=>({...previous,executions:false}));},[period]);
  useEffect(()=>{if(skipPersist.current){skipPersist.current=false;return;}
    if(enabled)props.navigation.savePanelState(analyticsPanelState({sessionId,
      audience:props.audience,contextId:props.contextId},{tab,period,query:appliedQuery,type,
      principalId:principal},props.navigation.readPanelState()?.data?.pending));},
  [enabled,props.navigation,sessionId,props.audience,props.contextId,tab,period,appliedQuery,type,principal]);
  const scope={client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};
  const refresh=useCallback(async()=>{
    if(!enabled)return;
    const generation=++epoch.current;
    const current=()=>epoch.current===generation&&live.current.enabled
      &&live.current.sessionId===sessionId&&live.current.contextId===props.contextId
      &&live.current.audience===props.audience&&live.current.client===props.client
      &&live.current.access===props.access&&live.current.period===period
      &&live.current.appliedQuery===appliedQuery&&live.current.type===type
      &&live.current.principal===principal
      &&props.access.getSnapshot().session?.id===sessionId;
    setBusy(true);setLoadingMore(false);
    const [summary,page]=await Promise.all([
      call<Snapshot>(scope,'analytics.snapshot',{period,...(principal?{principalId:principal}:{})},current),
      call<EventPage>(scope,'event.list',{period,limit:50,...(appliedQuery?{query:appliedQuery}:{}),
        ...(type?{type}:{}),...(principal?{principalId:principal}:{})},current)]);
    if(!current())return;
    setBusy(false);
    if(summary.kind==='error'||page.kind==='error'){
      setNotice(errorText(summary.kind==='error'?summary.code:page.kind==='error'?page.code:'unavailable'));
      return;
    }
    setNotice('');setSnapshot(summary.value);setEvents(page.value.items);setNextCursor(page.value.nextCursor);
  },[enabled,sessionId,props.active,props.authorized,props.access,props.client,props.audience,
    props.contextId,period,appliedQuery,type,principal]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(!enabled||!autoRefresh||exporting||events.length>50)return;
    const timer=setInterval(()=>{void refresh();},8000);
    return()=>clearInterval(timer);},[enabled,autoRefresh,exporting,events.length,refresh]);
  const more=async()=>{
    if(!nextCursor||loadingMore)return;
    const generation=epoch.current,current=()=>epoch.current===generation&&live.current.enabled
      &&live.current.sessionId===sessionId&&live.current.contextId===props.contextId
      &&live.current.audience===props.audience&&live.current.client===props.client
      &&live.current.access===props.access&&live.current.period===period
      &&live.current.appliedQuery===appliedQuery&&live.current.type===type
      &&live.current.principal===principal&&props.access.getSnapshot().session?.id===sessionId;
    setLoadingMore(true);
    const result=await call<EventPage>(scope,'event.list',{period,limit:50,cursor:nextCursor,
      ...(appliedQuery?{query:appliedQuery}:{}),...(type?{type}:{}),
      ...(principal?{principalId:principal}:{})},current);
    if(!current())return;
    setLoadingMore(false);
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setEvents(previous=>[...previous,...result.value.items]);setNextCursor(result.value.nextCursor);
  };
  const download=async(format:'csv'|'json')=>{
    if(exporting)return;
    const generation=epoch.current,exportToken=++exportEpoch.current;
    const current=()=>exportEpoch.current===exportToken&&epoch.current===generation&&live.current.enabled
      &&live.current.sessionId===sessionId&&live.current.contextId===props.contextId
      &&live.current.audience===props.audience&&live.current.client===props.client
      &&live.current.access===props.access&&live.current.period===period
      &&live.current.appliedQuery===appliedQuery&&live.current.type===type
      &&live.current.principal===principal&&props.access.getSnapshot().session?.id===sessionId;
    setExporting(true);
    try{
      const result=await collectExportPages({period,format,isCurrent:current,fetch:async cursor=>{
        const page=await call<ExportPage>(scope,'event.export',{period,limit:50,format,
          ...(cursor?{cursor}:{}),...(appliedQuery?{query:appliedQuery}:{}),
          ...(type?{type}:{}),...(principal?{principalId:principal}:{})},current);
        if(page.kind==='error')throw new Error(page.code);
        return page.value;
      }});
      if(!current())return;
      const blob=new Blob([result.content],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'});
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download=`creezio-evenements-${period}${result.complete?'':'-partiel'}.${format}`;
      anchor.click();URL.revokeObjectURL(url);
      setNotice(result.complete?`Export terminé (${result.pages} page(s)).`:
        `Export partiel borné à ${result.pages} pages ; poursuivez avec une période ou des filtres plus précis.`);
    }catch(error){if(current())setNotice(errorText(error instanceof Error?error.message:'unavailable'));}
    finally{if(exportEpoch.current===exportToken)setExporting(false);}
  };
  const readDiagnostics=useCallback(async(kind:'executions'|'endpoints',cursor?:string)=>{
    if(!enabled)return;
    const generation=++diagnosticReads.current[kind];
    const current=()=>diagnosticReads.current[kind]===generation&&live.current.enabled&&live.current.sessionId===sessionId
      &&live.current.contextId===props.contextId&&live.current.audience===props.audience
      &&live.current.client===props.client&&live.current.access===props.access
      &&live.current.period===period&&props.access.getSnapshot().session?.id===sessionId;
    setDiagnosticsBusy(previous=>({...previous,[kind]:true}));
    const input={limit:50,...(cursor?{cursor}:{}),...(kind==='executions'?{period}:{})};
    const result=await call<ExecutionDiagnosticsPage|EndpointDiagnosticsPage>(scope,
      kind==='executions'?'diagnostics.executions':'diagnostics.endpoints',input,current);
    if(!current())return;
    setDiagnosticsBusy(previous=>({...previous,[kind]:false}));
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    if(kind==='executions'){
      const page=result.value as ExecutionDiagnosticsPage;
      setExecutions(previous=>cursor&&previous?{...page,items:[...previous.items,...page.items]}:page);
    }else{
      const page=result.value as EndpointDiagnosticsPage;
      setEndpoints(previous=>cursor&&previous?{...page,items:[...previous.items,...page.items]}:page);
    }
  },[enabled,sessionId,props.access,props.client,props.contextId,props.audience,period]);
  useEffect(()=>{if(enabled&&tab==='logs'){
    void readDiagnostics('executions');void readDiagnostics('endpoints');
  }},[enabled,tab,readDiagnostics]);
  const activate=(value:Tab)=>setTab(value);
  if(!enabled||!ownScope)return <div className="p-6 text-sm text-slate-500">Ouvrez une session autorisée pour les mesures.</div>;
  return <main className="space-y-5 p-5 text-slate-900">
    <header><h1 className="text-2xl font-bold">Analytique</h1>
      <p className="text-sm text-slate-600">Mesures fondées sur les événements déclarés dans ce contexte.</p></header>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-sky-50/60 p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" aria-label="Période">
          {periods.map(([value,label])=><button key={value} type="button" onClick={()=>setPeriod(value)}
            aria-pressed={period===value} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${period===value?
              'bg-slate-900 text-white shadow-sm':'text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</div>
        <div className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" title="La distinction Humains / IA n’est pas encore mesurée">
          <span className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500">Humains / IA indisponible</span></div>
        <label className="flex items-center gap-2 text-xs text-slate-600"><Filter className="h-3.5 w-3.5 text-slate-400"/>
          <span className="sr-only">Identifiant du collaborateur</span>
          <input className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-sm"
            value={principal} maxLength={128} onChange={event=>setPrincipal(event.target.value)}
            placeholder="Identifiant du collaborateur"/></label></div>
      <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-1.5 text-xs text-slate-600">
        <input type="checkbox" checked={autoRefresh} onChange={event=>setAutoRefresh(event.target.checked)}
          className="rounded border-slate-300"/>Auto-refresh</label>
        <button className={button} type="button" data-creezio-analytics-id="analytics.refresh"
          onClick={()=>void refresh()} disabled={busy}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy?'animate-spin':''}`}/>Actualiser</button>
        <button className={`${button} text-rose-600`} type="button" aria-expanded={retentionOpen}
          onClick={()=>setRetentionOpen(value=>!value)}>
          <Trash2 className="h-3.5 w-3.5"/>Rétention et purge</button></div></div>
    {retentionOpen&&enabled&&<RetentionControls
      key={`${sessionId}:${props.audience}:${props.contextId}`} props={props} sessionId={sessionId}
      onChanged={()=>{void refresh();}}/>}
    {notice&&<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{notice}</p>}
    {busy&&!snapshot&&<p className="text-sm text-slate-500">Chargement des mesures…</p>}
    {snapshot&&<p className="text-xs text-slate-500">Période : {date(snapshot.period.from)} au {date(snapshot.period.to)} ·
      données déclarées {snapshot.complete?'sur toute la période':'partielles (500 événements au plus par calcul)'}.
      {snapshot.totals.events===0?' Aucun événement déclaré ne signifie pas absence d’activité.':''}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Pages vues" value={snapshot?number(snapshot.totals.pageViews):'—'}
        hint="Pages déclarées" icon={Eye} accent="bg-sky-500"/>
      <KpiCard label="Clics" value={snapshot?number(snapshot.totals.clicks):'—'}
        hint="Actions déclarées" icon={MousePointerClick} accent="bg-violet-500"/>
      <KpiCard label="Émetteurs déclarés" value={snapshot?number(snapshot.activePrincipals):'—'}
        hint="Identités ayant transmis un événement" icon={Users} accent="bg-emerald-500"/>
      <KpiCard label="Temps passé" value="—" hint="Mesure de présence indisponible" icon={Clock3} accent="bg-amber-500"/>
    </div>
    <nav className="inline-flex flex-wrap items-center justify-start gap-1 rounded-lg bg-slate-100 p-1 text-slate-600" aria-label="Analytique">
      {tabs.map(([value,label])=><button key={value} type="button" className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all ${tab===value?'bg-white text-slate-900 shadow-sm':''}`}
        aria-current={tab===value?'page':undefined} onClick={()=>activate(value)}>{label}</button>)}</nav>
    {tab==='overview'&&snapshot&&<div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3"><section className={`${card} xl:col-span-2`}>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-slate-900">Activité</h2>
          <p className="text-xs text-slate-500">Évolution des événements déclarés</p></div>
          <Activity className="h-4 w-4 text-slate-400"/></div><ActivityChart points={snapshot.timeline}/></section>
        <section className={card}><h2 className="text-sm font-semibold text-slate-900">Répartition</h2>
          <p className="mb-4 text-xs text-slate-500">Événements par type d’acteur</p>
          <p className="py-6 text-sm text-slate-400">La distinction entre humains et IA n’est pas disponible.</p></section></div>
      <div className="grid gap-4 lg:grid-cols-2"><TopList title="Pages les plus vues" items={snapshot.pages}
        empty="Aucune page déclarée"/><TopList title="Boutons les plus cliqués" items={snapshot.clicks}
        empty="Aucun clic déclaré"/></div></div>}
    {tab==='productivity'&&snapshot&&<div className="space-y-4">
      <Unavailable title="Comment c’est calculé" detail="Le temps actif, les pauses et le score demandent une mesure de présence qui n’est pas encore disponible. Aucun temps de travail n’est estimé à partir des événements."/>
      <section className={card}><div className="mb-3 flex items-center justify-between"><div>
        <h2 className="text-sm font-semibold text-slate-900">Classement collaborateurs</h2>
        <p className="text-xs text-slate-500">Le classement de productivité attend les mesures de présence.</p></div></div>
        <DataTable headers={['#','Collaborateur','Score','Actif / jour','Pauses','Focus']} rows={[]} framed={false}
          empty="Le classement sera disponible lorsque la présence sera mesurée."/></section>
      <div className="grid gap-4 xl:grid-cols-2"><section className={card}><h2 className="text-sm font-semibold">Heatmap d’activité</h2>
        <p className="py-10 text-center text-sm text-slate-400">Détail horaire de présence indisponible</p></section>
        <section className={card}><h2 className="text-sm font-semibold">Heures actives / jour</h2>
          <p className="py-10 text-center text-sm text-slate-400">Série quotidienne de présence indisponible</p></section></div>
      <div className="grid gap-4 xl:grid-cols-2"><section className={card}><h2 className="text-sm font-semibold">Pauses détectées</h2>
        <p className="py-8 text-center text-sm text-slate-400">Aucune mesure de pause disponible</p></section>
        <section className={card}><h2 className="text-sm font-semibold">Blocs de focus</h2>
          <p className="py-8 text-center text-sm text-slate-400">Aucune mesure de focus disponible</p></section></div>
      <TopList title="Événements par heure déclarée" items={snapshot.hours} empty="Aucun événement déclaré"/>
      <p className="text-xs text-slate-500">Durée fournie par les émetteurs : {number(snapshot.totals.reportedDurationMs)} ms. Elle ne mesure pas le temps de travail.</p></div>}
    {tab==='pages'&&snapshot&&<div className="space-y-4"><Unavailable title="Suivi des pages"
      detail="Les pages sont déclarées par un client autorisé. La navigation des vues du catalogue est collectée seulement si l’administrateur l’active."/>
      <DataTable headers={['Page','Vues déclarées']} rows={snapshot.pages.map(item=>[item.name,number(item.count)])}
        empty="Aucune page déclarée"/></div>}
    {tab==='clicks'&&snapshot&&<div className="space-y-4"><Unavailable title="Suivi des clics"
      detail="Les clics sont déclarés par un client autorisé. Seuls les composants avec un identifiant data-creezio-analytics-id stable sont collectés si l’administrateur l’active."/>
      <DataTable headers={['Élément','Clics déclarés']} rows={snapshot.clicks.map(item=>[item.name,number(item.count)])}
        empty="Aucun clic déclaré"/></div>}
    {tab==='users'&&snapshot&&<div className="space-y-4"><Unavailable title="Présence des collaborateurs"
      detail="Les sessions et le temps de présence ne sont pas encore mesurés. Ce tableau montre les identités qui ont déclaré des événements, y compris les applications."/>
      <DataTable headers={['Émetteur','Événements déclarés']} rows={snapshot.users.map(item=>[item.name,number(item.count)])}
        empty="Aucun événement déclaré"/></div>}
    {tab==='logs'&&<div className="space-y-4">{props.contextId==='application'
      ?<CollectionControls key={`${sessionId}:${props.audience}:${props.contextId}`} props={props} sessionId={sessionId}/>
      :<p className="text-xs text-slate-500">La collecte et les refus avant moteur se gèrent dans le contexte d’installation application.</p>}
      <Unavailable title="Journal des événements"
      detail="La liste ci-dessous contient les événements déclarés. Les exécutions et les refus avant moteur sont présentés séparément."/>
      <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-slate-600">Rechercher<br/>
        <input className={button} value={query} maxLength={120} onChange={event=>setQuery(event.target.value)}
          onKeyDown={event=>{if(event.key==='Enter')setAppliedQuery(query.trim());}}/></label>
        <button className={button} onClick={()=>setAppliedQuery(query.trim())}>Rechercher</button>
        <label className="text-xs text-slate-600">Type<br/><select className={button} value={type} onChange={event=>setType(event.target.value)}>
          <option value="">Tous</option><option value="page_view">Page</option><option value="click">Clic</option>
          <option value="activity">Activité</option><option value="error">Erreur</option></select></label>
        <button className={button} disabled={exporting} onClick={()=>void download('csv')}>
          {exporting?'Export…':'Exporter CSV (≤ 500 événements)'}</button>
        <button className={button} disabled={exporting} onClick={()=>void download('json')}>
          {exporting?'Export…':'Exporter JSON (≤ 500 événements)'}</button></div>
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"><div className="max-h-[560px] overflow-auto">
        <table className="w-full text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{['Quand','Type','Acteur','Label','Path','Durée'].map(label=><th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr>
        </thead><tbody>{events.length===0?<tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">
          Aucun événement déclaré correspondant aux filtres</td></tr>:events.map((event:Event)=><tr key={event.id}
            className="border-t border-slate-100 hover:bg-slate-50/80">
            <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">{date(event.occurredAt)}</td>
            <td className="px-3 py-2"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{event.type}</code></td>
            <td className="px-3 py-2 text-xs text-slate-700">{event.principalId}</td>
            <td className="max-w-[220px] truncate px-3 py-2 text-slate-800">{event.actionId??event.errorCode??'—'}</td>
            <td className="max-w-[180px] truncate px-3 py-2 text-xs text-slate-500">{event.path??event.surface}</td>
            <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">
              {event.reportedDurationMs!=null?`${number(event.reportedDurationMs)} ms`:'—'}</td></tr>)}</tbody></table></div></div>
      {nextCursor&&<button className={button} disabled={loadingMore} onClick={()=>void more()}>
        {loadingMore?'Chargement…':'Afficher la suite'}</button>}
      <section className={card}><div className="mb-3 flex items-center justify-between gap-2">
        <div><h2 className="text-sm font-semibold">Exécutions techniques</h2>
          <p className="text-xs text-slate-500">Journal existant de ce contexte, sans entrée ni contenu des opérations.</p></div>
        <button className={button} disabled={diagnosticsBusy.executions} onClick={()=>void readDiagnostics('executions')}>
          Actualiser</button></div>
        <DataTable headers={['Quand','Module','Opération','Audience','État','Code','Durée']}
          rows={(executions?.period.period===period?executions.items:[]).map(item=>[date(item.createdAt),item.moduleId,item.operationId,
            item.audience,item.state,item.errorCode??'—',item.durationMs===null?'—':`${number(item.durationMs)} ms`])}
          empty="Aucune exécution dans cette période" framed={false}/>
        {executions?.period.period===period&&executions.nextCursor&&<button className={button} disabled={diagnosticsBusy.executions}
          onClick={()=>void readDiagnostics('executions',executions.nextCursor!)}>Afficher la suite</button>}
      </section>
      <section className={card}><div className="mb-3 flex items-center justify-between gap-2">
        <div><h2 className="text-sm font-semibold">Endpoints déclarés</h2>
          <p className="text-xs text-slate-500">Routes du catalogue HTTP compilé, sans scan réseau.</p></div>
        <button className={button} disabled={diagnosticsBusy.endpoints} onClick={()=>void readDiagnostics('endpoints')}>
          Actualiser</button></div>
        {endpoints?.source==='unavailable'&&<p className="text-xs text-amber-700">Catalogue HTTP indisponible sur cet hôte.</p>}
        <DataTable headers={['Méthode','Route','Module','Opération','Audience','Type']}
          rows={(endpoints?.items??[]).map(item=>[item.method,item.path,item.moduleId,item.operationId,
            item.audience,item.kind])} empty="Aucune route déclarée" framed={false}/>
        {endpoints?.nextCursor&&<button className={button} disabled={diagnosticsBusy.endpoints}
          onClick={()=>void readDiagnostics('endpoints',endpoints.nextCursor!)}>Afficher la suite</button>}
      </section></div>}
  </main>;
}
