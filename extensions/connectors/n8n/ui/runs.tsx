'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {createCommandJournal,readPendingCommand,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {retainedSessionId,sessionVerified} from './panel-state.ts';

type Run={id:string;workflowId:string;status:'prepared'|'accepted';remoteExecutionId:string|null;
  remoteStatus:string|null;revision:number;createdAt:string;updatedAt:string};
type Panel={sessionId:string;audience:'admin'|'app';contextId:string;runId?:string;pending?:PendingCommand};
const binding=(audience:string,operation:string)=>`creezio.n8n:${audience}.${operation}`;
const output=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>):Record<string,unknown>|null=>
  result.kind==='execution'&&result.execution.state==='succeeded'&&result.execution.output&&
  typeof result.execution.output==='object'&&!Array.isArray(result.execution.output)
    ?result.execution.output as Record<string,unknown>:null;
const readPanel=(value:unknown,scope:Panel):Panel|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(row.sessionId!==scope.sessionId||row.audience!==scope.audience||row.contextId!==scope.contextId||
    row.runId!==undefined&&(typeof row.runId!=='string'||row.runId.length>128))return null;
  return row as Panel;
};
const button='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50';

export function N8nRunView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const verified=sessionVerified(access,sessionId);
  const active=activity&&props.active&&props.authorized&&verified&&props.client.audience===props.audience;
  const scope:Panel={sessionId,audience:props.audience,contextId:props.contextId};
  const saved=readPanel(props.navigation.readPanelState()?.data,scope);
  const [run,setRun]=useState<Run|null>(null),[runId,setRunId]=useState(saved?.runId??'');
  const [draft,setDraft]=useState('{}'),[busy,setBusy]=useState(false),
    [checking,setChecking]=useState(false),[notice,setNotice]=useState('');
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(null);
  const [pending,setPending]=useState<PendingCommand|null>(null);
  const lastScope=useRef(''),generation=useRef(0);
  const scopeKey=`${sessionId}\u0000${props.audience}\u0000${props.contextId}\u0000${props.panelId}`;
  if(lastScope.current!==scopeKey){lastScope.current=scopeKey;generation.current++;}
  const current=(token:number)=>active&&generation.current===token&&
    props.access.getSnapshot().session?.id===sessionId;
  const persist=(nextRunId:string,nextPending:PendingCommand|null)=>props.navigation.savePanelState({
    activeSubview:'run',data:{sessionId,audience:props.audience,contextId:props.contextId,
      ...(nextRunId?{runId:nextRunId}:{}),...(nextPending?{pending:nextPending}:{})}});
  const load=async(id:string,token:number)=>{
    if(!id)return;
    try{
      const result=await props.client.invoke({bindingId:binding(props.audience,'run.read'),
        contextId:props.contextId,input:{id},isCurrent:()=>current(token)});
      if(!current(token))return;
      const next=output(result)?.run as Run|undefined;
      if(next?.id===id)setRun(next);
      else setNotice('Intention indisponible dans ce contexte.');
    }catch{if(current(token))setNotice('Lecture de l’intention interrompue.');}
  };
  useEffect(()=>{
    if(!active){setBusy(false);return;}
    const token=generation.current;
    const state=readPanel(props.navigation.readPanelState()?.data,scope);
    const controller=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
      readPendingCommand(state?.pending,{sessionId,audience:props.audience,contextId:props.contextId}));
    journal.current=controller;setPending(controller.pending);setBusy(!!controller.pending);
    setRun(null);setRunId(state?.runId??'');setNotice('');
    if(state?.runId)void load(state.runId,token);
    return ()=>{generation.current++;journal.current=null;};
  },[active,sessionId,props.audience,props.contextId,props.panelId,props.client]);
  const command=async(operation:'run.prepare'|'run.trigger'|'run.refresh',input:Record<string,unknown>,key:string)=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!current(token)||busy||pending)return;
    setBusy(true);setNotice('');
    const result=await controller.execute(props.client,{sessionId,audience:props.audience,
      contextId:props.contextId,bindingId:binding(props.audience,operation),requestKey:key,
      intent:operation,targetId:operation==='run.prepare'?undefined:runId},input,()=>current(token),
    next=>persist(runId,next));
    if(!current(token))return;
    setPending(result.pending);setBusy(!!result.pending);
    const next=output(result.result)?.run as Run|undefined;
    if(next){setRun(next);setRunId(next.id);persist(next.id,result.pending);
      setNotice(operation==='run.trigger'?'Webhook accepté ; exécution non encore terminée.':
        operation==='run.prepare'?'Intention enregistrée. Vous pouvez confirmer le déclenchement.':
          'Statut distant actualisé.');}
    else setNotice(result.pending?'Issue incertaine. Inspectez la même commande ; aucun nouveau POST.':
      'Commande refusée.');
  };
  const inspect=async()=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!pending||checking)return;
    setChecking(true);
    const result=await controller.inspect(props.client,()=>current(token),next=>persist(runId,next));
    if(!current(token))return;
    setChecking(false);
    setPending(result?.pending??null);setBusy(!!result?.pending);
    const next=result?output(result.result)?.run as Run|undefined:undefined;
    if(next){setRun(next);setRunId(next.id);persist(next.id,result?.pending??null);
      setNotice(next.status==='accepted'?'Webhook accepté ; exécution à suivre.':'Intention conservée.');}
    else setNotice(result?.pending?'Issue toujours incertaine ; aucun nouvel envoi.':'Commande refusée.');
  };
  const prepare=()=>{
    let parsed:unknown;
    try{parsed=JSON.parse(draft);}catch{setNotice('Le corps doit être un objet JSON valide.');return;}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
      new TextEncoder().encode(JSON.stringify(parsed)).length>8192){
      setNotice('Le corps doit être un objet JSON de 8 Kio au maximum.');return;}
    void command('run.prepare',{input:parsed},crypto.randomUUID());
  };
  if(!active)return <div className="p-6 text-sm">Déclenchement n8n indisponible pour cette session.</div>;
  return <div className="flex flex-col gap-4 p-6">
    <header><h1 className="text-2xl font-semibold">Déclencher n8n</h1>
      <p className="text-sm text-slate-600">Webhook de production configuré par l’administrateur. Une réponse HTTP accepte
        la demande ; le résultat du workflow se consulte ensuite séparément.</p></header>
    {notice?<p role="status" className="rounded-md border p-3 text-sm">{notice}</p>:null}
    {pending?<button className={button} type="button" disabled={checking}
      onClick={()=>void inspect()}>Inspecter la dernière commande sans renvoi</button>:null}
    <section className="rounded-lg border p-4">
      <h2 className="font-medium">Nouvelle intention</h2>
      <label className="mt-2 grid gap-1 text-sm">Entrée JSON pour le workflow
        <textarea className="rounded-md border p-2 font-mono text-sm" rows={6} maxLength={8192}
          value={draft} onChange={event=>setDraft(event.target.value)} disabled={busy||!!pending}/></label>
      <button className={`${button} mt-3`} type="button" disabled={busy||!!pending}
        onClick={prepare}>Préparer sans envoyer</button>
    </section>
    {run?<section className="rounded-lg border p-4"><h2 className="font-medium">Intention {run.id}</h2>
      <dl className="mt-2 text-sm"><dt>Workflow</dt><dd>{run.workflowId}</dd><dt>Envoi</dt><dd>{run.status}</dd>
        <dt>Exécution n8n</dt><dd>{run.remoteExecutionId??'non corrélée'}</dd>
        <dt>Statut distant</dt><dd>{run.remoteStatus??'non lu'}</dd></dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {run.status==='prepared'?<button className={button} type="button" disabled={busy||!!pending}
          onClick={()=>void command('run.trigger',{id:run.id,revision:run.revision},run.id)}>
          Confirmer le déclenchement unique</button>:null}
        <button className={button} type="button" disabled={busy||!!pending}
          onClick={()=>void load(run.id,generation.current)}>Relire l’intention</button>
        {run.remoteExecutionId?<button className={button} type="button" disabled={busy||!!pending}
          onClick={()=>void command('run.refresh',{id:run.id,revision:run.revision},crypto.randomUUID())}>
          Lire le statut n8n</button>:null}
      </div></section>:null}
  </div>;
}
