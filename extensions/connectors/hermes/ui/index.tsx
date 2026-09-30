'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {createCommandJournal,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {hermesPanelData,readHermesPanel,scopeChange,sessionVerified,retainedSessionId,type HermesScope} from './panel-state.ts';

type Config={origin:string|null;enabled:boolean;hasKey:boolean;state:string;revision:number;generation:number};
type Capabilities={model:string;features:Record<'run_submission'|'run_status'|'run_events_sse'|'run_stop',boolean>;observedAt:string};
type Run={id:string;revision:number;status?:string;remote:null|{runId:string;status:string;output:string|null;model:string|null;sessionId:string|null}};
const card='rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
const control='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
const binding=(audience:string,operation:string)=>`creezio.hermes:${audience}.${operation}`;
const output=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>):Record<string,unknown>|null=>
  result.kind==='execution'&&result.execution.state==='succeeded'&&result.execution.output
    &&typeof result.execution.output==='object'&&!Array.isArray(result.execution.output)
    ?result.execution.output as Record<string,unknown>:null;

/** Existing workspace status-card pattern; no second chat transport or implicit local Hermes. */
export function HermesAdminView(props:WorkspaceViewProps){
  const administrator=props.audience==='admin';
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const active=activity&&props.active&&props.authorized&&sessionVerified(access,sessionId);
  const scope:HermesScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
  const initial=useRef(props.navigation.readPanelState());
  const [config,setConfig]=useState<Config|null>(null),[origin,setOrigin]=useState(''),[key,setKey]=useState('');
  const [capabilities,setCapabilities]=useState<Capabilities|null>(null),[models,setModels]=useState<string[]>([]);
  const [runId,setRunId]=useState(''),[run,setRun]=useState<Run|null>(null),[notice,setNotice]=useState('');
  const [prompt,setPrompt]=useState('');
  const [busy,setBusy]=useState(false),[pending,setPending]=useState<PendingCommand|null>(null);
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(null);
  const selectedRun=useRef<string|null>(null);
  const prior=useRef(scope),epoch=useRef(0),latest=useRef({active,sessionId,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId,panelId:props.panelId});
  const changed=latest.current.active!==active||latest.current.sessionId!==sessionId
    ||latest.current.client!==props.client||latest.current.access!==props.access
    ||latest.current.audience!==props.audience||latest.current.contextId!==props.contextId
    ||latest.current.panelId!==props.panelId;
  if(changed){epoch.current++;latest.current={active,sessionId,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId,panelId:props.panelId};}
  const current=(token:number)=>active&&epoch.current===token&&props.access.getSnapshot().session?.id===sessionId;
  const persist=(next:PendingCommand|null)=>props.navigation.savePanelState({activeSubview:'runs',
    data:hermesPanelData(scope,selectedRun.current,next)});
  const invoke=async(operation:string,input:Record<string,unknown>,token:number)=>{
    try{
      const result=await props.client.invoke({bindingId:binding(props.audience,operation),contextId:props.contextId,
        input,isCurrent:()=>current(token)});
      if(!current(token))return null;
      const data=output(result);
      if(!data)setNotice(result.kind==='unknown'?'Issue inconnue : vérifiez l’état avant toute nouvelle action.':
        'Opération refusée ou service Hermes indisponible.');
      return data;
    }catch{if(current(token))setNotice('Connexion interrompue.');return null;}
  };
  useEffect(()=>{
    const transition=scopeChange(prior.current,scope,access.pending?'loading':access.phase);
    if(transition.purge){setConfig(null);setOrigin('');setKey('');setCapabilities(null);setModels([]);
      setRun(null);setRunId('');setPrompt('');setNotice('');setBusy(false);setPending(null);
      selectedRun.current=null;journal.current=null;
      if(prior.current.sessionId)initial.current=null;}
    if(!transition.transient)prior.current=scope;
    if(!active)return;
    if(!journal.current){
      const saved=readHermesPanel(initial.current?.data,scope);
      selectedRun.current=saved?.selectedRunId??null;
      if(saved?.selectedRunId)setRunId(saved.selectedRunId);
      journal.current=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
        saved?.pending??null);
      setPending(journal.current.pending);
      initial.current=null;
    }
    const token=epoch.current;
    if(administrator)void invoke('config.read',{},token).then(data=>{if(current(token)&&data?.config){const next=data.config as Config;
      setConfig(next);setOrigin(next.origin??'');}});
    return ()=>{epoch.current++;};
  },[active,sessionId,props.audience,props.contextId,props.panelId,props.client,props.access]);
  const confirmed=(operation:string,result:Record<string,unknown>)=>{
    if(result.config){const next=result.config as Config;
      setConfig(next);setOrigin(next.origin??'');setKey('');setCapabilities(null);setModels([]);
      setRun(null);selectedRun.current=null;persist(null);}
    if(operation==='capabilities.capture'&&result.capabilities)
      setCapabilities(result.capabilities as Capabilities);
    if(operation==='run.prepare'&&typeof result.id==='string'){
      selectedRun.current=result.id;setRunId(result.id);
      setRun({id:result.id,revision:1,status:'prepared',remote:null});setPrompt('');persist(null);
      setNotice('Intention locale préparée. Vérifiez-la puis soumettez explicitement.');}
    if(operation==='run.submit'&&typeof result.remoteId==='string'){
      setRun(null);setNotice('Run accepté. Relisez son état pour suivre le résultat.');}
    if(operation==='run.stop'&&result.status==='stopping'){
      setRun(null);setNotice('Arrêt demandé ; le run reste actif jusqu’à son état terminal.');}
    if(operation==='run.refresh'&&result.run)setRun(result.run as Run);
  };
  const command=async(operation:string,input:Record<string,unknown>)=>{
    const controller=journal.current;
    if(!active||busy||controller?.pending||!controller)return null;
    const token=epoch.current;setBusy(true);setNotice('');
    const requestKey=typeof input.requestKey==='string'?input.requestKey:crypto.randomUUID();
    const issued={sessionId,audience:props.audience,contextId:props.contextId,
      bindingId:binding(props.audience,operation),requestKey,intent:operation,
      ...(typeof input.id==='string'?{targetId:input.id}:{})};
    const result=await controller.execute(props.client,issued,input,()=>current(token),persist);
    if(!current(token))return null;
    setBusy(false);setPending(result.pending);
    const data=output(result.result);
    if(data){confirmed(operation,data);return data;}
    setNotice(result.pending?'Résultat incertain ; vérifiez la même clé sans rejouer la commande.':
      'Opération refusée ou service Hermes indisponible.');
    return null;
  };
  const inspect=async()=>{
    const controller=journal.current,issued=controller?.pending;
    if(!controller||!issued||busy||!active)return;
    const token=epoch.current;setBusy(true);setNotice('');
    const result=await controller.inspect(props.client,()=>current(token),persist);
    if(!current(token))return;
    setBusy(false);setPending(result?.pending??null);
    const data=result?output(result.result):null;
    if(data){confirmed(issued.intent??'',data);setNotice('Statut confirmé ; relisez le run si nécessaire.');return;}
    setNotice(result?.pending?'Issue toujours incertaine ; la clé est conservée, aucun POST rejoué.':
      'Opération échouée ; aucun nouvel envoi automatique.');
  };
  const refresh=async()=>{
    if(!active)return;const token=epoch.current;setNotice('');
    const discovered=await command('capabilities.capture',{requestKey:crypto.randomUUID()});
    if(!current(token)||!discovered)return;
    const found=await invoke('models.list',{},token);
    if(current(token)&&Array.isArray(found?.models))setModels((found.models as {id:string}[]).map(x=>x.id));
  };
  const readRun=async()=>{
    if(!active||!runId.trim())return;const token=epoch.current;setNotice('');
    const result=await invoke('run.read',{id:runId.trim()},token);
    if(current(token)&&result?.run){const next=result.run as Run;
      selectedRun.current=next.id;setRun(next);persist(journal.current?.pending??null);}
  };
  if(!active)return <section className={card}>Hermes indisponible pour cette session.</section>;
  return <section className="space-y-4" aria-label="Hermes externe">
    <header className={card}><h1 className="text-lg font-semibold">Hermes externe</h1>
      <p className="text-sm text-slate-600">Service fourni par votre administrateur. Aucun agent n’est lancé dans Creezio.</p></header>
    {pending&&<div className={card}><p className="text-sm">Issue incertaine : {pending.intent??'commande'}.
      La clé est conservée pour vérifier le statut sans rejouer la commande.</p>
      <button className={control} disabled={busy} onClick={()=>void inspect()}>Vérifier la dernière commande</button></div>}
    {administrator&&<div className={card}><h2 className="font-semibold">Connexion</h2>
      <p className="text-sm">{config?.state??'Chargement'} · génération {config?.generation??0}</p>
      <label className="block text-sm">Origine HTTPS<input className={`${control} block w-full`} value={origin}
        onChange={event=>setOrigin(event.target.value)} placeholder="https://hermes.example.org"/></label>
      <button className={control} disabled={busy||!!pending||!config} onClick={()=>void command('config.set',
        {requestKey:crypto.randomUUID(),revision:config?.revision??0,origin,enabled:false})}>Enregistrer l’origine</button>
      <label className="block text-sm">Clé API<input className={`${control} block w-full`} type="password" value={key}
        autoComplete="new-password" onChange={event=>setKey(event.target.value)}/></label>
      <button className={control} disabled={busy||!!pending||!config||key.length<8} onClick={()=>void command('config.key.set',
        {requestKey:crypto.randomUUID(),revision:config?.revision??0,apiKey:key})}>Enregistrer la clé</button>
      <button className={control} disabled={busy||!!pending||!config||!config.hasKey} onClick={()=>void command('config.set',
        {requestKey:crypto.randomUUID(),revision:config?.revision??0,origin:config?.origin,enabled:true})}>Activer</button>
      <button className={control} disabled={busy||!!pending||!config||!config.hasKey} onClick={()=>void command('config.key.revoke',
        {requestKey:crypto.randomUUID(),revision:config?.revision??0})}>Révoquer la clé</button></div>}
    {administrator&&<div className={card}><h2 className="font-semibold">Capacités et modèles</h2>
      <button className={control} disabled={busy||!!pending} onClick={()=>void refresh()}>Vérifier la connexion</button>
      {capabilities&&<><p className="text-sm">Modèle {capabilities.model} · lu le {capabilities.observedAt}</p>
        <ul>{Object.entries(capabilities.features).map(([name,available])=><li key={name}>
          {name} : {available?'disponible':'absent'}</li>)}</ul></>}
      <ul>{models.map(id=><li key={id}>{id}</li>)}</ul></div>}
    <div className={card}><h2 className="font-semibold">Suivi d’un run Creezio</h2>
      <label className="block text-sm">Nouvelle intention<textarea className={`${control} block w-full`} value={prompt}
        onChange={event=>setPrompt(event.target.value)} maxLength={8192}/></label>
      <button className={control} disabled={busy||!!pending||(administrator&&!capabilities?.features.run_submission)||!prompt.trim()}
        onClick={()=>void command('run.prepare',{requestKey:crypto.randomUUID(),input:prompt})}>Préparer</button>
      <p className="text-sm text-slate-600">Saisissez l’identifiant local du run autorisé. Un identifiant Hermes seul ne donne aucun accès.</p>
      <input className={control} value={runId} onChange={event=>setRunId(event.target.value)} aria-label="Identifiant local du run"/>
      <button className={control} onClick={()=>void readRun()}>Relire</button>
      {run&&<article><strong>{run.id}</strong><p>{run.remote?.status??run.status??'En attente'}</p>
        {run.remote&&<button className={control} disabled={busy||!!pending||(administrator&&!capabilities?.features.run_status)}
          onClick={()=>void command('run.refresh',{id:run.id,requestKey:crypto.randomUUID(),revision:run.revision})}>
          Enregistrer l’état</button>}
        {run.status==='prepared'&&<button className={control} disabled={busy||!!pending}
          onClick={()=>void command('run.submit',{id:run.id,requestKey:run.id,revision:run.revision})}>
          Soumettre explicitement</button>}
        {run.remote&&['started','queued','running','waiting_for_approval'].includes(run.remote.status)
          &&<button className={control} disabled={busy||!!pending||(administrator&&!capabilities?.features.run_stop)}
            onClick={()=>void command('run.stop',{id:run.id,requestKey:`${run.id}:stop`,revision:run.revision})}>
            Demander l’arrêt</button>}
        {run.remote?.output&&<pre className="whitespace-pre-wrap break-words">{run.remote.output}</pre>}</article>}</div>
    {notice&&<p role="status" className={card}>{notice}</p>}
  </section>;
}
