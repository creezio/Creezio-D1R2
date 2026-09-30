'use client';

import {useEffect,useRef,useState} from 'react';
import {createCommandJournal,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {call,type RetentionPolicy,type RetentionPreview,type RetentionPurgeResult} from './contracts.ts';
import {analyticsPanelState,readAnalyticsPanelState} from './panel-state.ts';

const button='rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 disabled:opacity-50';
const message=(code:string)=>code==='forbidden'||code==='unauthorized'
  ?'La gestion de la rétention exige le droit dédié analytics.purge.'
  :code==='conflict'?'La politique ou le lot a changé. Relisez l’aperçu avant de continuer.'
  :'Résultat indisponible. Vérifiez la commande avant toute nouvelle modification.';

/** Manual-only retention controls. No timer or background dispatch can delete events. */
export function RetentionControls({props,sessionId,onChanged}:{props:WorkspaceViewProps;
  sessionId:string;onChanged:()=>void}){
  const scope={sessionId,audience:props.audience,contextId:props.contextId};
  const journal=useRef(createCommandJournal(scope,props.navigation.readPanelState()?.data?.pending));
  const [pending,setPending]=useState<PendingCommand|null>(journal.current.pending);
  const [preview,setPreview]=useState<RetentionPreview|null>(null);
  const [draft,setDraft]=useState('30');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&props.active&&props.authorized&&props.audience==='admin'
    &&props.access.getSnapshot().phase==='authenticated'
    &&!props.access.getSnapshot().pending
    &&props.access.getSnapshot().session?.id===sessionId;
  const persist=(value:PendingCommand|null)=>{
    const saved=readAnalyticsPanelState(props.navigation.readPanelState(),scope);
    if(!saved||!current())return false;
    const ok=props.navigation.savePanelState(analyticsPanelState(scope,saved,value));
    if(ok)setPending(value);
    return ok;
  };
  const load=async()=>{
    if(!current())return false;
    setBusy(true);
    const result=await call<RetentionPreview>(props,'retention.preview',{},current);
    if(!current())return false;
    setBusy(false);
    if(result.kind==='error'){setNotice(message(result.code));setPreview(null);return false;}
    setNotice('');setPreview(result.value);
    if(result.value.retentionDays!==null)setDraft(String(result.value.retentionDays));
    return true;
  };
  useEffect(()=>{void load();},[sessionId,props.contextId,props.client]);
  const execute=async(operation:'retention.configure'|'retention.purge',input:Record<string,unknown>)=>{
    if(!current()||busy||journal.current.pending)return;
    setBusy(true);setNotice('');
    const issued={...scope,bindingId:`creezio.analytics:admin.${operation}`,
      requestKey:crypto.randomUUID(),intent:operation};
    const outcome=await journal.current.execute(props.client,issued,input,current,persist);
    if(!current())return;
    setPending(outcome.pending);setBusy(false);
    if(outcome.result.kind==='execution'&&outcome.result.execution.state==='succeeded'){
      const output=outcome.result.execution.output as RetentionPolicy|RetentionPurgeResult;
      const refreshed=await load();
      if(refreshed)setNotice(operation==='retention.purge'
        ?`${(output as RetentionPurgeResult).deleted} événement(s) supprimé(s) dans ce lot.`
        :'Politique enregistrée. Aucune purge automatique n’est programmée.');
      onChanged();
    }else setNotice(outcome.pending?'Résultat incertain : inspectez la commande, sans la rejouer.'
      :message(outcome.result.kind==='rejected'?outcome.result.code:
        outcome.result.kind==='execution'?outcome.result.execution.errorCode??'unavailable':'unavailable'));
  };
  const configure=()=>{
    const days=Number(draft);
    if(!Number.isSafeInteger(days)||days<1||days>3650||!preview){
      setNotice('Choisissez de 1 à 3 650 jours et relisez la politique.');return;
    }
    void execute('retention.configure',{retentionDays:days,expectedRevision:preview.revision});
  };
  const purge=()=>{
    if(!preview?.configured||!preview.cutoff||!preview.items.length)return;
    if(!window.confirm(`Supprimer ${preview.items.length} événement(s) antérieurs au ${
      new Date(preview.cutoff).toLocaleString('fr-FR')} dans ce contexte ?`))return;
    void execute('retention.purge',{revision:preview.revision,cutoff:preview.cutoff,items:preview.items});
  };
  const inspect=async()=>{
    if(!current()||!pending||busy)return;
    setBusy(true);
    const outcome=await journal.current.inspect(props.client,current,persist);
    if(!current())return;
    setPending(outcome?.pending??null);setBusy(false);
    if(outcome?.result.kind==='execution'&&outcome.result.execution.state==='succeeded'){
      const refreshed=await load();
      if(refreshed)setNotice('Commande confirmée. Relisez le lot avant une autre purge.');
      onChanged();
    }else setNotice(outcome?.pending?'Issue encore incertaine. Aucune commande n’a été rejouée.'
      :'Commande refusée. Relisez la politique et le lot.');
  };
  return <section className="rounded-2xl border border-rose-200 bg-white p-4 text-sm shadow-sm">
    <h2 className="font-semibold text-slate-900">Rétention des événements déclarés</h2>
    <p className="mt-1 text-xs text-slate-600">Aucune suppression automatique. La politique et chaque lot sont propres à ce contexte.
      Le journal technique et les logs de transport ne sont pas concernés.</p>
    {notice&&<p role="alert" className="mt-3 text-xs text-rose-700">{notice}</p>}
    {pending&&<div className="mt-3 flex items-center gap-2"><span className="text-xs text-amber-700">
      Commande {pending.intent} en attente de vérification.</span><button className={button} type="button"
      disabled={busy} onClick={()=>void inspect()}>Vérifier le statut</button></div>}
    <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs text-slate-700">
      Conserver au moins (jours)<br/><input className="mt-1 w-32 rounded-md border border-slate-200 px-2 py-1.5"
      type="number" min={1} max={3650} step={1} value={draft} onChange={event=>setDraft(event.target.value)}/></label>
      <button className={button} type="button" disabled={busy||!!pending||!preview}
        onClick={configure}>Enregistrer la politique</button>
      <button className={button} type="button" disabled={busy||!!pending}
        onClick={()=>void load()}>Actualiser l’aperçu</button></div>
    {!preview?<p className="mt-3 text-xs text-slate-500">Politique et aperçu en attente de lecture.</p>:
      !preview.configured?<p className="mt-3 text-xs text-slate-600">Aucune politique définie : purge indisponible.</p>:
      <div className="mt-3 space-y-2 text-xs text-slate-700">
        <p>Révision {preview.revision} · conservation {preview.retentionDays} jours ·
          avant le {preview.cutoff?new Date(preview.cutoff).toLocaleString('fr-FR'):'—'}.</p>
        <p>Lot prévisualisé : {preview.items.length} événement(s){preview.hasMore?' ; d’autres lots peuvent suivre':''}.
          La quantité totale n’est pas estimée.</p>
        <button className={`${button} text-rose-700`} type="button"
          disabled={busy||!!pending||preview.items.length===0} onClick={purge}>
          Supprimer ce lot de {preview.items.length} au maximum</button>
      </div>}
  </section>;
}
