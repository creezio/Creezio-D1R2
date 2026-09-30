'use client';

import {useEffect,useRef,useState} from 'react';
import {createCommandJournal,readPendingCommand,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {call,type CollectionPolicy,type RefusalPage,type RefusalPreview} from './contracts.ts';
import {analyticsPanelState,readAnalyticsPanelState} from './panel-state.ts';

const button='rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 disabled:opacity-50';
const ours=(pending:PendingCommand|null)=>!!pending&&['collection.configure','refusals.purge'].includes(pending.intent??'');

/** Collection settings and installation refusals stay inside the original Journal. */
export function CollectionControls({props,sessionId}:{props:WorkspaceViewProps;sessionId:string}){
  const scope={sessionId,audience:props.audience,contextId:props.contextId};
  const savedPending=readPendingCommand(props.navigation.readPanelState()?.data?.pending,scope);
  const journal=useRef(createCommandJournal(scope,ours(savedPending)?savedPending:null));
  const [pending,setPending]=useState<PendingCommand|null>(journal.current.pending);
  const [policy,setPolicy]=useState<CollectionPolicy|null>(null);
  const [draft,setDraft]=useState({navigation:false,clicks:false,refusals:false,refusalRetentionDays:7});
  const [page,setPage]=useState<RefusalPage|null>(null),[preview,setPreview]=useState<RefusalPreview|null>(null);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&props.active&&props.authorized&&props.audience==='admin'
    &&props.access.getSnapshot().phase==='authenticated'&&!props.access.getSnapshot().pending
    &&props.access.getSnapshot().session?.id===sessionId;
  const persist=(value:PendingCommand|null)=>{
    const state=readAnalyticsPanelState(props.navigation.readPanelState(),scope);
    if(!state||!current())return false;
    const existing=readPendingCommand(props.navigation.readPanelState()?.data?.pending,scope);
    if(existing&&!ours(existing))return false;
    const ok=props.navigation.savePanelState(analyticsPanelState(scope,state,value));
    if(ok)setPending(value);return ok;
  };
  const load=async()=>{
    if(!current())return;
    setBusy(true);
    const [p,r]=await Promise.all([call<CollectionPolicy>(props,'collection.policy',{},current),
      call<RefusalPage>(props,'refusals.list',{limit:50},current)]);
    if(!current())return;
    setBusy(false);
    if(p.kind==='ok'){
      setPolicy(p.value);setDraft({navigation:p.value.navigation,clicks:p.value.clicks,
        refusals:p.value.refusals,refusalRetentionDays:p.value.refusalRetentionDays});
    }else setNotice('Politique de collecte indisponible.');
    if(r.kind==='ok')setPage(r.value);
    else setNotice('Diagnostic des refus indisponible.');
  };
  useEffect(()=>{void load();},[sessionId,props.contextId,props.client]);
  const execute=async(operation:'collection.configure'|'refusals.purge',input:Record<string,unknown>)=>{
    const existing=readPendingCommand(props.navigation.readPanelState()?.data?.pending,scope);
    if(!current()||busy||journal.current.pending||existing&&!ours(existing))return;
    setBusy(true);setNotice('');
    const issued={...scope,bindingId:`creezio.analytics:admin.${operation}`,
      requestKey:crypto.randomUUID(),intent:operation};
    const result=await journal.current.execute(props.client,issued,input,current,persist);
    if(!current())return;
    setPending(result.pending);setBusy(false);
    if(result.result.kind==='execution'&&result.result.execution.state==='succeeded'){
      if(operation==='collection.configure')window.dispatchEvent(new Event('creezio:analytics-policy-updated'));
      setPreview(null);await load();setNotice(operation==='collection.configure'
        ?'Politique enregistrée. Les clients autorisés la relisent à la prochaine navigation.'
        :'Lot de refus expirés supprimé. Les événements et journaux d’exécution restent conservés.');
    }else setNotice(result.pending?'Issue incertaine : vérifiez la commande avant toute nouvelle action.'
      :'Commande refusée. Relisez la politique et l’aperçu.');
  };
  const inspect=async()=>{
    if(!current()||!pending||busy)return;
    setBusy(true);const result=await journal.current.inspect(props.client,current,persist);
    if(!current())return;
    setPending(result?.pending??null);setBusy(false);
    if(result?.result.kind==='execution'&&result.result.execution.state==='succeeded'){
      if(pending.intent==='collection.configure')window.dispatchEvent(new Event('creezio:analytics-policy-updated'));
      setPreview(null);await load();setNotice('Commande confirmée.');
    }else setNotice(result?.pending?'Issue encore incertaine. Aucune commande n’a été rejouée.':'Commande refusée.');
  };
  const previewPurge=async()=>{
    if(!current()||busy)return;
    setBusy(true);const result=await call<RefusalPreview>(props,'refusals.preview',{},current);
    if(!current())return;
    setBusy(false);
    if(result.kind==='ok'){setPreview(result.value);setNotice('');}
    else setNotice('L’aperçu exige le droit analytics.purge.');
  };
  const purge=()=>{
    if(!preview?.items.length||!window.confirm(`Supprimer ${preview.items.length} refus avant moteur antérieurs au ${
      new Date(preview.cutoff).toLocaleString('fr-FR')} ?`))return;
    void execute('refusals.purge',{revision:preview.revision,cutoff:preview.cutoff,items:preview.items});
  };
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
    <header><h2 className="font-semibold text-slate-900">Collecte optionnelle et refus avant moteur</h2>
      <p className="text-xs text-slate-600">Installation : collecte désactivée par défaut. Vues déclarées et identifiants de clic explicites seulement.
        Les refus sont des diagnostics sans identité attribuée, séparés des événements de contexte.</p></header>
    {notice&&<p role="alert" className="text-xs text-rose-700">{notice}</p>}
    {pending&&ours(pending)&&<p className="text-xs text-amber-700">Commande {pending.intent} à vérifier.
      <button className={button} disabled={busy} onClick={()=>void inspect()}>Vérifier le statut</button></p>}
    <div className="flex flex-wrap items-end gap-3">
      {(['navigation','clicks','refusals'] as const).map(key=><label key={key} className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={draft[key]} onChange={event=>setDraft(value=>({...value,[key]:event.target.checked}))}/>
        {key==='navigation'?'Navigation':key==='clicks'?'Clics identifiés':'Refus avant moteur'}</label>)}
      <label className="text-xs">Refus conservés (jours)<br/><input type="number" min={1} max={365} step={1}
        className="w-24 rounded border border-slate-200 p-1" value={draft.refusalRetentionDays}
        onChange={event=>setDraft(value=>({...value,refusalRetentionDays:Number(event.target.value)}))}/></label>
      <button className={button} disabled={busy||!policy||!!pending||!!savedPending&&!ours(savedPending)
        ||!Number.isSafeInteger(draft.refusalRetentionDays)||draft.refusalRetentionDays<1||draft.refusalRetentionDays>365}
        onClick={()=>void execute('collection.configure',{expectedRevision:policy?.revision??0,...draft})}>Enregistrer</button>
      <button className={button} disabled={busy} onClick={()=>void load()}>Actualiser</button>
    </div>
    <p className="text-xs text-slate-500">Révision {policy?.revision??'—'} · purge manuelle des refus après {policy?.refusalRetentionDays??7} jours.
      Aucune purge automatique ni modification des événements déclarés.</p>
    <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr>
      {['Date','Transport','Méthode','Route déclarée','Statut','Code','Durée'].map(label=><th key={label} className="p-2">{label}</th>)}
    </tr></thead><tbody>{page?.items.map(item=><tr key={item.id} className="border-t border-slate-100">
      <td className="p-2">{new Date(item.occurredAt).toLocaleString('fr-FR')}</td><td className="p-2">{item.transport}</td>
      <td className="p-2">{item.method}</td><td className="p-2">{item.routeTemplate}</td>
      <td className="p-2">{item.status}</td><td className="p-2">{item.errorCode}</td>
      <td className="p-2">{item.durationMs} ms</td></tr>)}</tbody></table></div>
    {!page?.items.length&&<p className="text-xs text-slate-500">Aucun refus collecté.</p>}
    {page?.nextCursor&&<button className={button} disabled={busy} onClick={async()=>{
      const result=await call<RefusalPage>(props,'refusals.list',{limit:50,cursor:page.nextCursor},current);
      if(current()&&result.kind==='ok')setPage({...result.value,items:[...page.items,...result.value.items]});
    }}>Afficher la suite</button>}
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} disabled={busy||!!pending} onClick={()=>void previewPurge()}>Prévisualiser les refus expirés</button>
      {preview&&<><span className="text-xs text-slate-600">{preview.items.length} dans le lot, avant le {
        new Date(preview.cutoff).toLocaleString('fr-FR')}{preview.hasMore?' ; autres lots disponibles':''}.</span>
        <button className={button} disabled={busy||!!pending||!preview.items.length} onClick={purge}>Supprimer ce lot</button></>}
    </div>
  </section>;
}
