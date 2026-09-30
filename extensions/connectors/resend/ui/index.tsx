'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {createCommandJournal,readPendingCommand,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {panelData,readPanel,retainedSessionId,scopeChange,sessionVerified,type ResendScope} from './panel-state.ts';

type Config={origin:string|null;from:string|null;enabled:boolean;hasKey:boolean;
  hasWebhookSecret:boolean;hasWebhookService:boolean;
  state:'missing'|'configured'|'disabled';revision:number};
type Domain={id:string;name:string;status:string};
const field='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
const button=`${field} hover:bg-slate-50`;
const binding=(operation:string)=>`creezio.resend:admin.${operation}`;
const output=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>):Record<string,unknown>|null=>
  result.kind==='execution'&&result.execution.state==='succeeded'&&result.execution.output
    &&typeof result.execution.output==='object'&&!Array.isArray(result.execution.output)
    ?result.execution.output as Record<string,unknown>:null;

export function ResendAdminView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef(''),sessionId=retained.current=retainedSessionId(retained.current,access);
  const verified=sessionVerified(access,sessionId);
  const active=activity&&props.active&&props.authorized&&verified&&props.audience==='admin';
  const scope:ResendScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
  const initial=useRef(props.navigation.readPanelState());
  const restored=verified?readPanel(initial.current?.data,scope):null;
  const [config,setConfig]=useState<Config|null>(null),[from,setFrom]=useState(''),[apiKey,setApiKey]=useState('');
  const [webhookSecret,setWebhookSecret]=useState(''),[serviceToken,setServiceToken]=useState('');
  const [enabled,setEnabled]=useState(false),[domains,setDomains]=useState<Domain[]>([]);
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false);
  const [loading,setLoading]=useState(false);
  const fromDirty=useRef(false),enableDirty=useRef(false),editRevision=useRef<number|null>(null);
  const keyRevision=useRef<number|null>(null);
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(verified?
    createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
      readPendingCommand(restored?.pending,{sessionId,audience:props.audience,contextId:props.contextId})):null);
  const [pending,setPending]=useState<PendingCommand|null>(journal.current?.pending??null);
  const prior=useRef(scope),generation=useRef(0);
  const last=useRef({active,sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId,panelId:props.panelId});
  const changed=last.current.active!==active||last.current.sessionId!==sessionId||last.current.client!==props.client
    ||last.current.access!==props.access||last.current.audience!==props.audience
    ||last.current.contextId!==props.contextId||last.current.panelId!==props.panelId;
  if(changed){generation.current++;last.current={active,sessionId,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId,panelId:props.panelId};}
  const current=(token:number)=>active&&generation.current===token&&
    props.access.getSnapshot().session?.id===sessionId;
  const persist=(value:PendingCommand|null)=>props.navigation.savePanelState({activeSubview:'settings',
    data:panelData(scope,value)});
  const invoke=async(operation:string,input:Record<string,unknown>,token:number)=>{
    try{
      const result=await props.client.invoke({bindingId:binding(operation),contextId:props.contextId,
        input,isCurrent:()=>current(token)});
      if(!current(token))return null;
      const value=output(result);
      if(!value)setNotice(result.kind==='unknown'?'Lecture incertaine ; vérifiez le statut.':
        'Opération refusée ou fournisseur indisponible.');
      return value;
    }catch{if(current(token))setNotice('Connexion interrompue.');return null;}
  };
  const load=async(token:number)=>{
    const value=await invoke('config.read',{},token),next=value?.config as Config|undefined;
    if(current(token)&&next){setConfig(next);if(!fromDirty.current)setFrom(next.from??'');
      if(!enableDirty.current)setEnabled(next.enabled);}
  };
  useEffect(()=>{
    const next:ResendScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
    const phase=access.pending?'loading':access.phase,transition=scopeChange(prior.current,next,phase);
    if(transition.purge){setConfig(null);setFrom('');setApiKey('');setWebhookSecret('');
      setServiceToken('');setEnabled(false);setDomains([]);
      setNotice('');setPending(null);setBusy(false);journal.current=null;fromDirty.current=false;
      enableDirty.current=false;editRevision.current=null;keyRevision.current=null;}
    if(!transition.transient)prior.current=next;
    if(!active)return;
    if(!journal.current){const saved=transition.purge?null:readPanel(initial.current?.data,next);
      journal.current=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
        readPendingCommand(saved?.pending,{sessionId,audience:props.audience,contextId:props.contextId}));
      setPending(journal.current.pending);setBusy(!!journal.current.pending);}
    void load(generation.current);
  },[active,sessionId,access.phase,access.pending,props.client,props.access,props.audience,props.contextId,props.panelId]);
  const mutate=async(operation:string,value:Record<string,unknown>)=>{
    const controller=journal.current,token=generation.current;if(!controller||!current(token)||busy)return;
    setBusy(true);setNotice('');
    const result=await controller.execute(props.client,{sessionId,audience:props.audience,
      contextId:props.contextId,bindingId:binding(operation),requestKey:crypto.randomUUID(),intent:operation},
      value,()=>current(token),persist);
    if(!current(token))return;
    setPending(result.pending);setBusy(!!result.pending);
    const next=output(result.result)?.config as Config|undefined;
    if(next){setConfig(next);setFrom(next.from??'');setEnabled(next.enabled);setApiKey('');
      setWebhookSecret('');setServiceToken('');
      fromDirty.current=false;enableDirty.current=false;editRevision.current=null;keyRevision.current=null;
      setNotice('Configuration enregistrée.');}
    else setNotice(result.pending?'Résultat incertain ; aucun second envoi automatique.':'Modification refusée.');
  };
  const inspect=async()=>{
    const controller=journal.current,token=generation.current;if(!controller||!pending||checking)return;
    setChecking(true);const result=await controller.inspect(props.client,()=>current(token),persist);
    if(!current(token))return;setChecking(false);setPending(result?.pending??null);setBusy(!!result?.pending);
    if(result?.result.kind==='execution'&&result.result.execution.state==='succeeded'){
      setApiKey('');setWebhookSecret('');setServiceToken('');
      setNotice('Modification confirmée.');void load(token);
    }else setNotice(result?.pending?'Résultat toujours incertain ; aucune action rejouée.':'Modification refusée.');
  };
  const readDomains=async()=>{
    const token=generation.current;setLoading(true);setNotice('');
    const value=await invoke('domain.list',{},token);
    if(current(token)){setLoading(false);if(Array.isArray(value?.domains))setDomains(value.domains as Domain[]);}
  };
  const ownScope=prior.current.sessionId===sessionId&&prior.current.audience===props.audience&&
    prior.current.contextId===props.contextId&&prior.current.panelId===props.panelId;
  if(!active||!ownScope)return <div className="p-6 text-sm">Resend indisponible pour cette session.</div>;
  return <div className="flex flex-col gap-4 p-6 text-sm">
    <header><h1 className="text-2xl font-semibold">Resend</h1>
      <p className="text-slate-600">Configuration du transport. Les messages restent dans Messagerie ; aucun envoi ne part de cet écran.</p></header>
    {notice?<p role="status" className="rounded-md border p-3">{notice}</p>:null}
    {pending?<button className={button} type="button" disabled={checking} onClick={()=>void inspect()}>
      Vérifier la dernière modification</button>:null}
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-medium">Expéditeur et clé</h2>
      <p className="mb-4 text-slate-600">Origine fixe : https://api.resend.com · Clé conservée dans le coffre serveur.</p>
      <p>État : {config?.state??'non configuré'}{config?.hasKey?' · clé enregistrée':' · clé absente'}</p>
      <label className="mt-3 grid gap-1">Adresse expéditeur vérifiée
        <input className={field} type="email" value={from} maxLength={320} autoComplete="off"
          onChange={event=>{if(editRevision.current===null)editRevision.current=config?.revision??0;
            fromDirty.current=true;setFrom(event.target.value);}} disabled={busy}/></label>
      <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={enabled}
        disabled={busy||!config?.hasKey} onChange={event=>{if(editRevision.current===null)
          editRevision.current=config?.revision??0;enableDirty.current=true;setEnabled(event.target.checked);}}/>
        Transport actif</label>
      <button className={`${button} mt-3`} type="button" disabled={busy||!from.trim()}
        onClick={()=>void mutate('config.set',{from:from.trim(),enabled,
          revision:editRevision.current??config?.revision??0})}>Enregistrer</button>
      <label className="mt-5 grid gap-1">Clé API Resend
        <input className={field} type="password" autoComplete="off" value={apiKey} maxLength={4096}
          onChange={event=>{if(keyRevision.current===null)keyRevision.current=config?.revision??0;
            setApiKey(event.target.value);}} disabled={busy||!config}/></label>
      <div className="mt-3 flex flex-wrap gap-2"><button className={button} type="button"
        disabled={busy||!config||apiKey.length<8} onClick={()=>void mutate('config.key.set',
          {apiKey,revision:keyRevision.current??config!.revision})}>Enregistrer la clé</button>
        <button className={button} type="button" disabled={busy||!config?.hasKey}
          onClick={()=>void mutate('config.key.revoke',{revision:config!.revision})}>Révoquer la clé</button></div>
    </section>
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-medium">Événements signés</h2>
      <p className="text-slate-600">Point de réception : /api/webhooks/resend. Le jeton de service doit porter le droit resend.webhook.receive.</p>
      <p>Secret de signature : {config?.hasWebhookSecret?'enregistré':'absent'} · Jeton de service : {config?.hasWebhookService?'enregistré':'absent'}</p>
      <label className="mt-3 grid gap-1">Secret Svix Resend
        <input className={field} type="password" autoComplete="off" maxLength={512}
          value={webhookSecret} onChange={event=>setWebhookSecret(event.target.value)} disabled={busy||!config?.enabled}/></label>
      <div className="mt-2 flex gap-2"><button className={button} type="button" disabled={busy||!config?.enabled||webhookSecret.length<16}
        onClick={()=>void mutate('config.key.webhook.set',{webhookSecret,revision:config!.revision})}>Enregistrer le secret</button>
        <button className={button} type="button" disabled={busy||!config?.hasWebhookSecret}
          onClick={()=>void mutate('config.key.webhook.revoke',{revision:config!.revision})}>Révoquer le secret</button></div>
      <label className="mt-3 grid gap-1">Jeton API du service webhook
        <input className={field} type="password" autoComplete="off" maxLength={256}
          value={serviceToken} onChange={event=>setServiceToken(event.target.value)} disabled={busy||!config?.enabled}/></label>
      <div className="mt-2 flex gap-2"><button className={button} type="button" disabled={busy||!config?.enabled||serviceToken.length<32}
        onClick={()=>void mutate('config.key.webhook.service.set',{serviceToken,revision:config!.revision})}>Enregistrer le jeton</button>
        <button className={button} type="button" disabled={busy||!config?.hasWebhookService}
          onClick={()=>void mutate('config.key.webhook.service.revoke',{revision:config!.revision})}>Révoquer le jeton</button></div>
    </section>
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-medium">Domaines</h2>
        <button className={button} type="button" disabled={loading||!config?.enabled}
          onClick={()=>void readDomains()}>{loading?'Chargement…':'Actualiser'}</button></div>
      {domains.length?<ul className="mt-3 grid gap-2">{domains.map(item=><li key={item.id}>
        {item.name} · {item.status}</li>)}</ul>:<p className="mt-3 text-slate-600">Aucun domaine chargé.</p>}
    </section>
  </div>;
}
