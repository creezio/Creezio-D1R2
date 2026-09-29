'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Loader2,RefreshCw,Search} from 'lucide-react';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {createCommandJournal,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {Button,Card,CardContent,CardDescription,CardHeader,CardTitle} from '@creezio/sdk/ui';
import {configRevisionChanged,panelData,preferFreshConfig,readPanel,retainedSessionId,scopeChange,sessionVerified,
  type MeiliScope} from './panel-state.ts';

type Config={origin:string|null;enabled:boolean;hasKey:boolean;
  state:'missing'|'configured'|'unverified';revision:number};
type Check={authenticated:boolean;status:'connected'|'key_rejected'};
const stateLabel:Record<Config['state'],string>={
  missing:'Non configuré',configured:'Configuré',unverified:'Non vérifié'
};
const binding=(name:string)=>`creezio.meili:admin.${name}`;
const record=(value:unknown):Record<string,unknown>|null=>
  value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const configFrom=(value:unknown):Config|null=>{
  const row=record(value);
  return row&&(row.origin===null||typeof row.origin==='string')&&typeof row.enabled==='boolean'
    &&typeof row.hasKey==='boolean'&&['missing','configured','unverified'].includes(String(row.state))
    &&Number.isSafeInteger(row.revision)&&Number(row.revision)>=0?row as unknown as Config:null;
};

export function MeiliAdminView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const verified=sessionVerified(access,sessionId);
  const allowed=activity&&props.active&&props.authorized&&props.audience==='admin'
    &&props.client.audience==='admin'&&verified;
  const scope:MeiliScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
  const initial=useRef(props.navigation.readPanelState());
  const [config,setConfig]=useState<Config|null>(null),[origin,setOrigin]=useState(''),[apiKey,setApiKey]=useState('');
  const [enabled,setEnabled]=useState(false),[notice,setNotice]=useState('');
  const [checking,setChecking]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [connection,setConnection]=useState<Check|null>(null);
  const [pending,setPending]=useState<PendingCommand|null>(null);
  const configSnapshot=useRef<Config|null>(null);
  const originDirty=useRef(false),enabledDirty=useRef(false),keyVersion=useRef(0);
  const pendingKeyVersion=useRef<number|null>(null);
  const editRevision=useRef<number|null>(null),keyRevision=useRef<number|null>(null);
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(null);
  const journalScope=useRef({sessionId:'',audience:props.audience,contextId:props.contextId});
  const prior=useRef(scope),generation=useRef(0),readSerial=useRef(0),checkSerial=useRef(0);
  const mutationSerial=useRef(0),currentState=useRef({allowed,sessionId,client:props.client,
    access:props.access,audience:props.audience,contextId:props.contextId,panelId:props.panelId});
  const changed=currentState.current.allowed!==allowed||currentState.current.sessionId!==sessionId
    ||currentState.current.client!==props.client||currentState.current.access!==props.access
    ||currentState.current.audience!==props.audience||currentState.current.contextId!==props.contextId
    ||currentState.current.panelId!==props.panelId;
  if(changed){generation.current++;currentState.current={allowed,sessionId,client:props.client,
    access:props.access,audience:props.audience,contextId:props.contextId,panelId:props.panelId};}
  const current=(token:number)=>allowed&&generation.current===token&&
    props.access.getSnapshot().session?.id===sessionId;
  const persist=(value:PendingCommand|null,token:number)=>current(token)&&
    props.navigation.savePanelState({data:panelData(scope,value)});
  const output=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>)=>
    result.kind==='execution'&&result.execution.state==='succeeded'?record(result.execution.output):null;
  const read=async(token:number)=>{
    const serial=++readSerial.current;
    if(!current(token))return;
    setLoading(true);
    try{
      const result=await props.client.invoke({bindingId:binding('config.read'),contextId:props.contextId,
        input:{},isCurrent:()=>current(token)});
      if(!current(token)||serial!==readSerial.current)return;
      const next=configFrom(output(result)?.config);
      if(!next){setNotice('Configuration indisponible ou accès refusé.');return;}
      if(preferFreshConfig(configSnapshot.current,next)===next){
        if(configRevisionChanged(configSnapshot.current,next)){
          checkSerial.current++;setChecking(false);setConnection(null);
        }
        configSnapshot.current=next;setConfig(next);
        if(!originDirty.current)setOrigin(next.origin??'');
        if(!enabledDirty.current)setEnabled(next.enabled);
      }
    }catch{if(current(token)&&serial===readSerial.current)setNotice('Configuration indisponible.');}
    finally{if(current(token)&&serial===readSerial.current)setLoading(false);}
  };
  useEffect(()=>{
    const next:MeiliScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
    const transition=scopeChange(prior.current,next,access.pending?'loading':access.phase);
    readSerial.current++;checkSerial.current++;mutationSerial.current++;
    if(transition.purge){configSnapshot.current=null;setConfig(null);setOrigin('');setApiKey('');setEnabled(false);
      setConnection(null);setNotice('');setPending(null);setBusy(false);
      originDirty.current=false;enabledDirty.current=false;editRevision.current=null;
      keyRevision.current=null;keyVersion.current++;pendingKeyVersion.current=null;journal.current=null;
      journalScope.current={sessionId:'',audience:props.audience,contextId:props.contextId};}
    if(!transition.transient)prior.current=next;
    if(!allowed){setLoading(false);setChecking(false);setBusy(false);return;}
    if(!journal.current||journalScope.current.sessionId!==sessionId||
      journalScope.current.audience!==props.audience||journalScope.current.contextId!==props.contextId){
      const restored=transition.purge?null:readPanel(initial.current?.data,next);
      journal.current=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
        restored?.pending??null);
      journalScope.current={sessionId,audience:props.audience,contextId:props.contextId};
      setPending(journal.current.pending);
      initial.current=null;
    }
    void read(generation.current);
  },[allowed,sessionId,access.phase,access.pending,props.client,props.access,
    props.audience,props.contextId,props.panelId]);
  const acceptConfig=(next:Config)=>{
    if(preferFreshConfig(configSnapshot.current,next)!==next)return false;
    configSnapshot.current=next;setConfig(next);setOrigin(next.origin??'');setEnabled(next.enabled);
    originDirty.current=false;enabledDirty.current=false;editRevision.current=null;keyRevision.current=null;
    setConnection(null);return true;};
  const mutate=async(name:'config.set'|'config.key.set'|'config.key.revoke',input:Record<string,unknown>)=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!current(token)||controller.pending||busy||!config)return;
    const serial=++mutationSerial.current;
    const submittedKeyVersion=keyVersion.current;
    if(name==='config.key.set')pendingKeyVersion.current=submittedKeyVersion;
    readSerial.current++;checkSerial.current++;setLoading(false);setChecking(false);
    setConnection(null);setBusy(true);setNotice('');
    try{
      const outcome=await controller.execute(props.client,{sessionId,audience:props.audience,
        contextId:props.contextId,bindingId:binding(name),requestKey:crypto.randomUUID(),intent:name},
        input,()=>current(token),value=>persist(value,token));
      if(!current(token)||serial!==mutationSerial.current)return;
      setPending(outcome.pending);
      const next=configFrom(output(outcome.result)?.config);
      if(next){const adopted=acceptConfig(next);
        if(name!=='config.set'&&keyVersion.current===submittedKeyVersion)setApiKey('');
        pendingKeyVersion.current=null;
        setNotice(adopted?(name==='config.key.revoke'?'Clé révoquée.':'Configuration enregistrée.'):
          'Modification confirmée ; une configuration plus récente reste affichée.');}
      else setNotice(outcome.result.kind==='rejected'&&outcome.result.code==='client_state_unavailable'
        ?'Le suivi local est indisponible. Aucune commande envoyée.'
        :outcome.pending?'Résultat incertain. Vérifiez son statut ; aucun nouvel envoi.'
          :'Modification refusée. Actualisez la configuration.');
    }finally{if(serial===mutationSerial.current)setBusy(false);}
  };
  const inspect=async()=>{
    const controller=journal.current,token=generation.current;
    if(!controller?.pending||!current(token)||checking||busy)return;
    const serial=++mutationSerial.current;
    setChecking(true);
    try{
      const outcome=await controller.inspect(props.client,()=>current(token),value=>persist(value,token));
      if(!current(token)||serial!==mutationSerial.current)return;
      setPending(outcome?.pending??null);
      const next=outcome?configFrom(output(outcome.result)?.config):null;
      if(next){const adopted=acceptConfig(next);
        if(pendingKeyVersion.current!==null&&pendingKeyVersion.current===keyVersion.current)setApiKey('');
        pendingKeyVersion.current=null;setNotice(adopted?'Modification confirmée.':
          'Modification confirmée ; une configuration plus récente reste affichée.');}
      else setNotice(outcome?.pending?'Résultat toujours incertain ; aucune commande rejouée.'
        :'Modification refusée. Actualisez la configuration.');
    }finally{if(serial===mutationSerial.current)setChecking(false);}
  };
  const check=async()=>{
    const token=generation.current,serial=++checkSerial.current;
    if(!current(token)||!config?.enabled||!config.hasKey)return;
    setChecking(true);setNotice('');
    try{
      const result=await props.client.invoke({bindingId:binding('connection.check'),contextId:props.contextId,
        input:{},isCurrent:()=>current(token)});
      if(!current(token)||serial!==checkSerial.current)return;
      const row=output(result);
      if(row?.authenticated===true&&row.status==='connected'){
        setConnection({authenticated:true,status:'connected'});setNotice('Connexion Meilisearch vérifiée.');}
      else if(row?.authenticated===false&&row.status==='key_rejected'){
        setConnection({authenticated:false,status:'key_rejected'});setNotice('Clé refusée par Meilisearch.');}
      else{setConnection(null);setNotice('Connexion indisponible.');}
    }catch{if(current(token)&&serial===checkSerial.current)setNotice('Connexion indisponible.');}
    finally{if(current(token)&&serial===checkSerial.current)setChecking(false);}
  };
  const hydrated=prior.current.sessionId===sessionId&&prior.current.audience===props.audience
    &&prior.current.contextId===props.contextId&&prior.current.panelId===props.panelId;
  if(!allowed||!hydrated)return <p className="p-6 text-sm">Recherche indisponible pour cette session.</p>;
  return <section className="h-full overflow-y-auto p-3" data-meili-admin-view>
    {pending?<p role="alert" className="mb-3 rounded-md border border-amber-300 p-3 text-sm">
      Résultat de configuration incertain. Aucune commande ne sera rejouée.
      <Button type="button" variant="outline" className="ml-2" disabled={checking||busy}
        onClick={()=>void inspect()}>Vérifier l’opération</Button></p>:null}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4" /> Recherche (Meilisearch)
        </CardTitle>
        <CardDescription>
          Connectez une instance Meilisearch externe. Cette étape vérifie la connexion ;
          l’indexation externe et la recherche globale ne sont pas encore actives.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">État : {config?stateLabel[config.state]:'Non configuré'}
          {config?.hasKey?' · clé enregistrée':' · clé absente'}
          {connection?.authenticated?' · connexion vérifiée':''}</p>
        <label className="grid gap-1 text-sm">URL HTTPS de l’instance
          <input className="rounded-md border px-3 py-2 text-sm" type="url" maxLength={512}
            value={origin} disabled={busy||!!pending}
            onChange={event=>{if(editRevision.current===null)editRevision.current=config?.revision??0;
              originDirty.current=true;setOrigin(event.target.value);}} /></label>
        <p className="text-xs text-slate-500">Pour changer d’instance, révoquez d’abord la clé enregistrée,
          puis ajoutez une clé pour la nouvelle URL.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled}
          disabled={busy||!!pending||!config?.hasKey}
          onChange={event=>{if(editRevision.current===null)editRevision.current=config?.revision??0;
            enabledDirty.current=true;setEnabled(event.target.checked);}} />Connexion active</label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy||!!pending||!config||!origin.trim()}
            onClick={()=>void mutate('config.set',{origin:origin.trim(),enabled,
              revision:editRevision.current??config!.revision})}>Enregistrer l’instance</Button>
          <Button type="button" variant="outline" disabled={busy||checking||!!pending||!config?.enabled||!config.hasKey}
            onClick={()=>void check()}>Vérifier la connexion</Button>
        </div>
        <label className="grid gap-1 text-sm">Clé API Meilisearch
          <input className="rounded-md border px-3 py-2 text-sm" type="password" autoComplete="off"
            maxLength={4096} value={apiKey} disabled={busy||!!pending||!config}
            onChange={event=>{if(keyRevision.current===null)keyRevision.current=config?.revision??0;
              keyVersion.current++;setApiKey(event.target.value);}} /></label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy||!!pending||!config||apiKey.length<8}
            onClick={()=>void mutate('config.key.set',{apiKey,revision:keyRevision.current??config!.revision})}>
            Enregistrer la clé</Button>
          <Button type="button" variant="outline" disabled={busy||!!pending||!config?.hasKey}
            onClick={()=>void mutate('config.key.revoke',{revision:config!.revision})}>Révoquer la clé</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled title="Indexeur externe non disponible dans cette étape">
            <RefreshCw className="mr-2 h-4 w-4" /> Réindexer la recherche</Button>
          <Button type="button" variant="outline" disabled={loading||busy||checking}
            onClick={()=>void read(generation.current)}>
            {loading?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:null}
            Actualiser l’état</Button>
        </div>
        <p className="text-xs text-slate-500">Indexation externe indisponible pour le moment.
          La connexion vérifie uniquement l’accès à l’instance.</p>
        {notice?<p role="status" className="text-sm">{notice}</p>:null}
      </CardContent>
    </Card>
  </section>;
}
