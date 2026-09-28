'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {createCommandJournal,readPendingCommand,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {panelData,readPanel,retainedSessionId,scopeChange,sessionVerified,
  type N8nScope,type N8nTab} from './panel-state.ts';

type Config={origin:string|null;enabled:boolean;hasKey:boolean;
  state:'missing'|'configured'|'unavailable'|'unverified';revision:number};
type Workflow={id:string;name:string;active:boolean;isArchived:boolean;updatedAt:string|null;versionId:string|null};
type Execution={id:string;workflowId:string|null;status:string;startedAt:string|null;stoppedAt:string|null};
type Page<T>={items:T[];nextCursor:string|null};
const input='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
const button=`${input} hover:bg-slate-50`;
const card='rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
const binding=(audience:string,operation:string)=>`creezio.n8n:${audience}.${operation}`;
const output=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>):Record<string,unknown>|null=>
  result.kind==='execution'&&result.execution.state==='succeeded'&&result.execution.output
    &&typeof result.execution.output==='object'&&!Array.isArray(result.execution.output)
    ?result.execution.output as Record<string,unknown>:null;

/** Original n8n status-card workflow adapted for a user-owned external instance. */
export function N8nAdminView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const verified=sessionVerified(access,sessionId);
  const active=activity&&props.active&&props.authorized&&verified;
  const initial=useRef(props.navigation.readPanelState());
  const scope:N8nScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
  const restored=verified?readPanel(initial.current?.data,scope):null;
  const [tab,setTab]=useState<N8nTab>(restored?.tab??'settings');
  const [config,setConfig]=useState<Config|null>(null),[origin,setOrigin]=useState(''),[apiKey,setApiKey]=useState('');
  const [enableInput,setEnableInput]=useState(false),originDirty=useRef(false),enableDirty=useRef(false);
  const editRevision=useRef<number|null>(null),keyEditRevision=useRef<number|null>(null);
  const [workflows,setWorkflows]=useState<Workflow[]>([]),[workflowCursor,setWorkflowCursor]=useState<string|null>(null);
  const [executions,setExecutions]=useState<Execution[]>([]),[executionCursor,setExecutionCursor]=useState<string|null>(null);
  const [selected,setSelected]=useState<{kind:'workflow'|'execution';value:Workflow|Execution}|null>(null);
  const [busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(verified?
    createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
      readPendingCommand(restored?.pending,{sessionId,audience:props.audience,contextId:props.contextId})):null);
  const journalScope=useRef({sessionId:verified?sessionId:'',audience:props.audience,contextId:props.contextId});
  const [pending,setPending]=useState<PendingCommand|null>(journal.current?.pending??null);
  const prior=useRef(scope),generation=useRef(0),listSerial=useRef(0),detailSerial=useRef(0);
  const last=useRef({active,sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId,panelId:props.panelId});
  const tabRef=useRef(tab),cursorRef=useRef({workflowCursor,executionCursor});
  tabRef.current=tab;cursorRef.current={workflowCursor,executionCursor};
  const changed=last.current.active!==active||last.current.sessionId!==sessionId||last.current.client!==props.client
    ||last.current.access!==props.access||last.current.audience!==props.audience||
    last.current.contextId!==props.contextId||last.current.panelId!==props.panelId;
  if(changed){generation.current++;last.current={active,sessionId,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId,panelId:props.panelId};}
  const current=(token:number)=>active&&generation.current===token&&
    props.access.getSnapshot().session?.id===sessionId;
  const persist=(value:PendingCommand|null)=>props.navigation.savePanelState({activeSubview:tabRef.current,
    data:panelData(scope,tabRef.current,cursorRef.current.workflowCursor,cursorRef.current.executionCursor,value)});
  const invoke=async(operation:string,input:Record<string,unknown>,token:number)=>{
    try{
      const result=await props.client.invoke({bindingId:binding(props.audience,operation),
        contextId:props.contextId,input,isCurrent:()=>current(token)});
      if(!current(token))return null;
      const value=output(result);
      if(!value)setNotice(result.kind==='unknown'?'Lecture incertaine. Vérifiez la connexion avant de réessayer.':
        'Opération refusée ou n8n indisponible.');
      return value;
    }catch{if(current(token))setNotice('Connexion interrompue.');return null;}
  };
  const loadConfig=async(token:number)=>{
    const value=await invoke('config.read',{},token),next=value?.config as Config|undefined;
    if(current(token)&&next){setConfig(next);if(!enableDirty.current)setEnableInput(next.enabled);
      if(!originDirty.current)setOrigin(next.origin??'');}
  };
  const loadList=async(kind:'workflow'|'execution',token:number,cursor?:string,append=false)=>{
    const serial=++listSerial.current;
    setLoading(true);
    const value=await invoke(`${kind}.list`,{limit:20,...(cursor?{cursor}:{})},token);
    if(!current(token)||serial!==listSerial.current)return;
    const page=value as Page<Workflow|Execution>|null;
    if(page&&Array.isArray(page.items)){
      if(kind==='workflow'){
        const rows=page.items as Workflow[];
        setWorkflows(previous=>append?[...previous,...rows.filter(item=>!previous.some(old=>old.id===item.id))]:rows);
        setWorkflowCursor(page.nextCursor);cursorRef.current.workflowCursor=page.nextCursor;
      }else{
        const rows=page.items as Execution[];
        setExecutions(previous=>append?[...previous,...rows.filter(item=>!previous.some(old=>old.id===item.id))]:rows);
        setExecutionCursor(page.nextCursor);cursorRef.current.executionCursor=page.nextCursor;
      }
      persist(journal.current?.pending??null);
    }
    setLoading(false);
  };
  useEffect(()=>{
    const next:N8nScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
    const phase=access.pending?'loading':access.phase;
    const transition=scopeChange(prior.current,next,phase);
    if(transition.purge){setTab('settings');setConfig(null);setOrigin('');setApiKey('');
      setEnableInput(false);originDirty.current=false;enableDirty.current=false;
      editRevision.current=null;keyEditRevision.current=null;
      setWorkflows([]);setExecutions([]);setWorkflowCursor(null);setExecutionCursor(null);
      setSelected(null);setPending(null);setNotice('');journal.current=null;
      journalScope.current={sessionId:'',audience:props.audience,contextId:props.contextId};}
    if(!transition.transient)prior.current=next;
    if(!active){setLoading(false);return;}
    if(!journal.current||journalScope.current.sessionId!==sessionId||
      journalScope.current.audience!==props.audience||journalScope.current.contextId!==props.contextId){
      const saved=transition.purge?null:readPanel(initial.current?.data,next);
      journal.current=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
        readPendingCommand(saved?.pending,{sessionId,audience:props.audience,contextId:props.contextId}));
      journalScope.current={sessionId,audience:props.audience,contextId:props.contextId};
      setPending(journal.current.pending);setBusy(!!journal.current.pending);
      if(saved){setTab(saved.tab);tabRef.current=saved.tab;}
    }
    const token=generation.current;
    void loadConfig(token);
    if(tabRef.current==='workflows')void loadList('workflow',token);
    if(tabRef.current==='executions')void loadList('execution',token);
  },[active,sessionId,access.phase,access.pending,props.client,props.access,props.audience,props.contextId,props.panelId]);
  const selectTab=(next:N8nTab)=>{
    setTab(next);tabRef.current=next;setSelected(null);detailSerial.current++;listSerial.current++;
    if(next==='settings')setLoading(false);
    persist(journal.current?.pending??null);
    const token=generation.current;
    if(next==='workflows')void loadList('workflow',token);
    if(next==='executions')void loadList('execution',token);
  };
  const mutate=async(operation:string,input:Record<string,unknown>)=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!current(token)||busy)return;
    setBusy(true);setNotice('');
    const result=await controller.execute(props.client,{sessionId,audience:props.audience,
      contextId:props.contextId,bindingId:binding(props.audience,operation),requestKey:crypto.randomUUID(),intent:operation},
      input,()=>current(token),value=>persist(value));
    if(!current(token))return;
    setPending(result.pending);setBusy(!!result.pending);
    const value=output(result.result);
    if(value?.config){const next=value.config as Config;setConfig(next);setOrigin(next.origin??'');
      setEnableInput(next.enabled);originDirty.current=false;enableDirty.current=false;
      editRevision.current=null;keyEditRevision.current=null;
      if(operation.startsWith('config.key.'))setApiKey('');setNotice('Configuration enregistrée.');}
    else setNotice(result.result.kind==='rejected'&&result.result.code==='client_state_unavailable'
      ?'Le suivi local est indisponible. Aucune modification envoyée.'
      :result.pending?'Résultat incertain. Vérifiez le statut ; aucun second envoi.':'Modification refusée.');
  };
  const inspect=async()=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!pending||checking)return;
    setChecking(true);
    const result=await controller.inspect(props.client,()=>current(token),value=>persist(value));
    if(!current(token))return;
    setChecking(false);setPending(result?.pending??null);setBusy(!!result?.pending);
    if(result?.result.kind==='execution'&&result.result.execution.state==='succeeded'){
      const next=(result.result.execution.output as Record<string,unknown>).config as Config|undefined;
      if(next){setConfig(next);setOrigin(next.origin??'');setEnableInput(next.enabled);
        originDirty.current=false;enableDirty.current=false;editRevision.current=null;
        keyEditRevision.current=null;setApiKey('');}
      setNotice('Modification confirmée.');
    }else setNotice(result?.pending?'Résultat toujours incertain ; aucune action rejouée.':'Modification refusée.');
  };
  const check=async()=>{
    const token=generation.current;setNotice('');
    const result=await invoke('connection.check',{},token);
    if(current(token)&&result?.reachable===true)setNotice('Instance n8n joignable.');
  };
  const openDetail=async(kind:'workflow'|'execution',id:string)=>{
    const serial=++detailSerial.current,token=generation.current;
    setSelected(null);setNotice('');
    const value=await invoke(`${kind}.read`,{id},token);
    if(!current(token)||serial!==detailSerial.current||tabRef.current!==`${kind}s`)return;
    const item=value?.[kind] as Workflow|Execution|undefined;
    if(item&&item.id===id)setSelected({kind,value:item});
  };
  const ownScope=prior.current.sessionId===sessionId&&prior.current.audience===props.audience&&
    prior.current.contextId===props.contextId&&prior.current.panelId===props.panelId;
  if(!active||!ownScope)return <div className="p-6 text-sm">n8n indisponible pour cette session.</div>;
  return <div className="flex flex-col gap-4 p-6">
    <header><h1 className="text-2xl font-semibold">n8n</h1>
      <p className="text-sm text-slate-600">Connectez votre instance existante et consultez ses workflows.</p></header>
    <nav className="flex flex-wrap gap-2" aria-label="Sections n8n">{(['settings','workflows','executions'] as const).map(value=>
      <button key={value} className={button} aria-current={tab===value?'page':undefined} type="button"
        onClick={()=>selectTab(value)}>{value==='settings'?'Connexion':value==='workflows'?'Workflows':'Exécutions'}</button>)}</nav>
    {notice?<p role="status" className="rounded-md border p-3 text-sm">{notice}</p>:null}
    {pending?<button className={button} type="button" disabled={checking} onClick={()=>void inspect()}>
      Vérifier la dernière modification</button>:null}
    {tab==='settings'?<section className={card}>
      <h2 className="mb-2 text-lg font-medium">Instance externe</h2>
      <p className="mb-4 text-sm text-slate-600">Aucune installation de n8n. La clé reste dans le coffre serveur.</p>
      <div className="mb-3 text-sm">Statut : {config?.state??'non configuré'}{config?.hasKey?' · clé enregistrée':' · clé absente'}</div>
      <label className="grid gap-1 text-sm">URL HTTPS de l’instance
        <input className={input} value={origin} maxLength={512} placeholder="https://mon-instance.app.n8n.cloud"
          onChange={event=>{if(editRevision.current===null)editRevision.current=config?.revision??0;
            originDirty.current=true;setOrigin(event.target.value);}} disabled={busy}/></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={enableInput}
        disabled={busy||!config?.hasKey} onChange={event=>{if(editRevision.current===null)editRevision.current=config?.revision??0;
          enableDirty.current=true;setEnableInput(event.target.checked);}}/>
        Connexion active</label>
      <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy||!origin.trim()} type="button"
        onClick={()=>void mutate('config.set',{origin:origin.trim(),enabled:enableInput,
          revision:editRevision.current??config?.revision??0})}>
        Enregistrer l’instance</button>
        <button className={button} disabled={!config?.enabled} type="button" onClick={()=>void check()}>
          Vérifier la connexion</button></div>
      <label className="mt-5 grid gap-1 text-sm">Clé API n8n
        <input className={input} type="password" autoComplete="off" value={apiKey} maxLength={4096}
          onChange={event=>{if(keyEditRevision.current===null)keyEditRevision.current=config?.revision??0;
            setApiKey(event.target.value);}} disabled={busy||!config}/></label>
      <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy||!config||apiKey.length<8}
        type="button" onClick={()=>void mutate('config.key.set',{apiKey,
          revision:keyEditRevision.current??config!.revision})}>Enregistrer la clé</button>
        <button className={button} disabled={busy||!config?.hasKey} type="button"
          onClick={()=>void mutate('config.key.revoke',{revision:config!.revision})}>Révoquer la clé</button></div>
    </section>:null}
    {tab==='workflows'?<section className={card}><div className="mb-3 flex justify-between gap-2">
      <h2 className="text-lg font-medium">Workflows</h2><button className={button} type="button"
        disabled={loading} onClick={()=>void loadList('workflow',generation.current)}>Actualiser</button></div>
      {workflows.length===0?<p className="text-sm text-slate-600">{loading?'Chargement…':'Aucun workflow disponible.'}</p>:null}
      <ul className="grid gap-2">{workflows.map(item=><li key={item.id}><button className={`${button} w-full text-left`}
        type="button" onClick={()=>void openDetail('workflow',item.id)}>{item.name||item.id}
        <span className="ml-2 text-xs text-slate-600">{item.active?'actif':'inactif'}{item.isArchived?' · archivé':''}</span>
      </button></li>)}</ul>{workflowCursor?<button className={`${button} mt-3`} disabled={loading} type="button"
        onClick={()=>void loadList('workflow',generation.current,workflowCursor,true)}>Suite</button>:null}</section>:null}
    {tab==='executions'?<section className={card}><div className="mb-3 flex justify-between gap-2">
      <h2 className="text-lg font-medium">Exécutions</h2><button className={button} type="button"
        disabled={loading} onClick={()=>void loadList('execution',generation.current)}>Actualiser</button></div>
      {executions.length===0?<p className="text-sm text-slate-600">{loading?'Chargement…':'Aucune exécution disponible.'}</p>:null}
      <ul className="grid gap-2">{executions.map(item=><li key={item.id}><button className={`${button} w-full text-left`}
        type="button" onClick={()=>void openDetail('execution',item.id)}>#{item.id} · {item.status}
        <span className="ml-2 text-xs text-slate-600">{item.startedAt??'date inconnue'}</span>
      </button></li>)}</ul>{executionCursor?<button className={`${button} mt-3`} disabled={loading} type="button"
        onClick={()=>void loadList('execution',generation.current,executionCursor,true)}>Suite</button>:null}</section>:null}
    {selected?<aside className={card}><div className="flex justify-between"><h2 className="font-medium">
      {selected.kind==='workflow'?'Workflow':'Exécution'} {selected.value.id}</h2>
      <button className={button} type="button" onClick={()=>setSelected(null)}>Fermer</button></div>
      <dl className="mt-2 grid gap-2 text-sm">{Object.entries(selected.value).filter(([name])=>name!=='id').map(([name,value])=>
        <div key={name}><dt className="font-medium">{name}</dt><dd>{String(value??'—')}</dd></div>)}</dl>
    </aside>:null}
  </div>;
}
