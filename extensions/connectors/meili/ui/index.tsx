'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Loader2,RefreshCw,Search} from 'lucide-react';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {createCommandJournal,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {Button,Card,CardContent,CardDescription,CardHeader,CardTitle} from '@creezio/sdk/ui';
import {configRevisionChanged,indexPageFrom,panelData,preferFreshConfig,readConfigThenIndex,
  readPanel,retainedSessionId,
  scopeChange,sessionVerified,type IndexPage,type MeiliScope} from './panel-state.ts';

type Config={origin:string|null;enabled:boolean;hasKey:boolean;
  state:'missing'|'configured'|'unverified';revision:number};
type Check={authenticated:boolean;status:'connected'|'key_rejected'};
type IndexState={state:'missing'|'building'|'prepared'|'waiting'|'failed'|'ready';revision:number;
  active:string|null;building:string|null;abandoned:string|null;preparedCount:number;
  emitKey:string|null;taskUid:number|null};
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
const indexFrom=(value:unknown):IndexState|null=>{
  const row=record(value);
  return row&&['missing','building','prepared','waiting','failed','ready'].includes(String(row.state))
    &&Number.isSafeInteger(row.revision)&&Number(row.revision)>=0
    &&[row.active,row.building,row.abandoned,row.emitKey].every(item=>item===null||typeof item==='string')
    &&Number.isSafeInteger(row.preparedCount)&&Number(row.preparedCount)>=0
    &&(row.taskUid===null||Number.isSafeInteger(row.taskUid))?row as unknown as IndexState:null;
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
  const [indexPage,setIndexPage]=useState<IndexPage|null>(null);
  const [indexState,setIndexState]=useState<IndexState|null>(null);
  const [sources,setSources]=useState<string[]>([]),[source,setSource]=useState('');
  const [indexLoading,setIndexLoading]=useState(false);
  const [pending,setPending]=useState<PendingCommand|null>(null);
  const configSnapshot=useRef<Config|null>(null);
  const sourceSnapshot=useRef('');
  const originDirty=useRef(false),enabledDirty=useRef(false),keyVersion=useRef(0);
  const pendingKeyVersion=useRef<number|null>(null);
  const editRevision=useRef<number|null>(null),keyRevision=useRef<number|null>(null);
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(null);
  const journalScope=useRef({sessionId:'',audience:props.audience,contextId:props.contextId});
  const prior=useRef(scope),generation=useRef(0),readSerial=useRef(0),checkSerial=useRef(0),indexSerial=useRef(0);
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
  const read=async(token:number):Promise<{source:string}|null>=>{
    const serial=++readSerial.current;
    if(!current(token))return null;
    let indexSource=sourceSnapshot.current;
    setLoading(true);
    try{
      const result=await props.client.invoke({bindingId:binding('config.read'),contextId:props.contextId,
        input:{},isCurrent:()=>current(token)});
      if(!current(token)||serial!==readSerial.current)return null;
      const next=configFrom(output(result)?.config);
      if(!next){setNotice('Configuration indisponible ou accès refusé.');return null;}
      else if(preferFreshConfig(configSnapshot.current,next)!==next)return null;
      else{
        indexSource=sourceSnapshot.current;
        if(configRevisionChanged(configSnapshot.current,next)){
          checkSerial.current++;setChecking(false);setConnection(null);
          indexSerial.current++;setIndexLoading(false);setIndexPage(null);setIndexState(null);
          setSources([]);setSource('');sourceSnapshot.current='';indexSource='';
        }
        configSnapshot.current=next;setConfig(next);
        if(!originDirty.current)setOrigin(next.origin??'');
        if(!enabledDirty.current)setEnabled(next.enabled);
      }
    }catch{if(current(token)&&serial===readSerial.current)setNotice('Configuration indisponible.');
      return null;}
    finally{if(current(token)&&serial===readSerial.current)setLoading(false);}
    return current(token)&&serial===readSerial.current?{source:indexSource}:null;
  };
  const loadIndex=async(token:number,selectedSource=sourceSnapshot.current)=>{
    const serial=++indexSerial.current;
    if(!current(token))return;
    try{
      const result=await props.client.invoke({bindingId:binding('index.read'),contextId:props.contextId,
        input:selectedSource?{source:selectedSource}:{},isCurrent:()=>current(token)});
      if(current(token)&&serial===indexSerial.current){
        const body=output(result),available=body?.sources;
        if(Array.isArray(available)&&available.every(item=>typeof item==='string')){
          setSources(available as string[]);
          if(!selectedSource&&available.length>0){
            sourceSnapshot.current=available[0];setSource(available[0]);return;}
          if(selectedSource&&!available.includes(selectedSource)){
            sourceSnapshot.current=available[0]??'';
            setSource(sourceSnapshot.current);setIndexState(null);return;}
        }
        setIndexState(indexFrom(body?.index));
      }
    }catch{if(current(token)&&serial===indexSerial.current)setIndexState(null);}
  };
  useEffect(()=>{
    const next:MeiliScope={sessionId,audience:props.audience,contextId:props.contextId,panelId:props.panelId};
    const transition=scopeChange(prior.current,next,access.pending?'loading':access.phase);
    readSerial.current++;checkSerial.current++;indexSerial.current++;mutationSerial.current++;
    if(transition.purge){configSnapshot.current=null;setConfig(null);setIndexState(null);setSources([]);setSource('');
      sourceSnapshot.current='';
      setOrigin('');setApiKey('');setEnabled(false);
      setConnection(null);setIndexPage(null);setNotice('');setPending(null);setBusy(false);
      originDirty.current=false;enabledDirty.current=false;editRevision.current=null;
      keyRevision.current=null;keyVersion.current++;pendingKeyVersion.current=null;journal.current=null;
      journalScope.current={sessionId:'',audience:props.audience,contextId:props.contextId};}
    if(!transition.transient)prior.current=next;
    if(!allowed){setLoading(false);setChecking(false);setIndexLoading(false);setIndexPage(null);
      setBusy(false);return;}
    if(!journal.current||journalScope.current.sessionId!==sessionId||
      journalScope.current.audience!==props.audience||journalScope.current.contextId!==props.contextId){
      const restored=transition.purge?null:readPanel(initial.current?.data,next);
      journal.current=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
        restored?.pending??null);
      journalScope.current={sessionId,audience:props.audience,contextId:props.contextId};
      setPending(journal.current.pending);
      initial.current=null;
    }
    const token=generation.current;
    void readConfigThenIndex(()=>read(token),value=>loadIndex(token,value.source),()=>current(token));
  },[allowed,sessionId,access.phase,access.pending,props.client,props.access,
    props.audience,props.contextId,props.panelId]);
  useEffect(()=>{if(source&&allowed)void loadIndex(generation.current);},[source]);
  const acceptConfig=(next:Config)=>{
    const previous=configSnapshot.current;
    if(preferFreshConfig(previous,next)!==next)return false;
    configSnapshot.current=next;setConfig(next);setOrigin(next.origin??'');setEnabled(next.enabled);
    originDirty.current=false;enabledDirty.current=false;editRevision.current=null;keyRevision.current=null;
    setConnection(null);indexSerial.current++;setIndexLoading(false);setIndexPage(null);
    const changed=configRevisionChanged(previous,next);
    if(changed){setIndexState(null);setSources([]);setSource('');sourceSnapshot.current='';}
    void loadIndex(generation.current,sourceSnapshot.current);
    return true;};
  const mutate=async(name:'config.set'|'config.key.set'|'config.key.revoke',input:Record<string,unknown>)=>{
    const controller=journal.current,token=generation.current;
    if(!controller||!current(token)||controller.pending||busy||!config)return;
    const serial=++mutationSerial.current;
    const submittedKeyVersion=keyVersion.current;
    if(name==='config.key.set')pendingKeyVersion.current=submittedKeyVersion;
    readSerial.current++;checkSerial.current++;indexSerial.current++;
    setLoading(false);setChecking(false);setIndexLoading(false);setIndexPage(null);
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
      const nextIndex=outcome?indexFrom(output(outcome.result)?.index):null;
      if(nextIndex)setIndexState(nextIndex);
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
  const listIndexes=async(cursor?:string)=>{
    const token=generation.current,serial=++indexSerial.current;
    if(!current(token)||!config?.enabled||!config.hasKey||busy||!!pending)return;
    setIndexLoading(true);setNotice('');
    try{
      const result=await props.client.invoke({bindingId:binding('index.list'),contextId:props.contextId,
        input:{limit:20,...(cursor?{cursor}:{})},isCurrent:()=>current(token)});
      if(!current(token)||serial!==indexSerial.current)return;
      const page=indexPageFrom(output(result));
      if(page)setIndexPage(page);
      else{setIndexPage(null);setNotice(result.kind==='rejected'&&result.code==='forbidden'
        ?'Lecture des index refusée pour ce compte.':'Liste des index indisponible. Vérifiez la connexion.');}
    }catch{if(current(token)&&serial===indexSerial.current){setIndexPage(null);
      setNotice('Liste des index indisponible.');}}
    finally{if(current(token)&&serial===indexSerial.current)setIndexLoading(false);}
  };
  const indexCommand=async(name:'index.rebuild.start'|'index.sync.start'|'index.prepare'|'index.emit'|
    'index.reconcile'|'index.abandon')=>{
    const controller=journal.current,token=generation.current,prior=indexState;
    if(!controller||!current(token)||controller.pending||busy||!prior||!config?.enabled||!config.hasKey)return;
    if(name==='index.abandon'&&!window.confirm('Abandonner ce lot préparé ? Son effet fournisseur peut être inconnu. L’ancienne génération active sera conservée.'))return;
    const requestKey=name==='index.emit'?prior.emitKey:crypto.randomUUID();
    if(!requestKey)return;
    const serial=++mutationSerial.current;
    setBusy(true);setNotice('');
    try{
      const outcome=await controller.execute(props.client,{sessionId,audience:props.audience,
        contextId:props.contextId,bindingId:binding(name),requestKey,intent:name},
        {revision:prior.revision,source,...(name==='index.abandon'?{acknowledgeUnknown:true}:{})},
        ()=>current(token),value=>persist(value,token));
      if(!current(token)||serial!==mutationSerial.current)return;
      setPending(outcome.pending);
      const next=indexFrom(output(outcome.result)?.index);
      if(next){setIndexState(next);setNotice(next.state==='prepared'
        ?'Lot préparé et figé. Émettez-le une seule fois avec la clé enregistrée.'
        :next.state==='waiting'?'Tâche fournisseur enregistrée. Confirmez son état avant de continuer.'
          :next.state==='ready'?'Génération synchronisée.':'Progression enregistrée.');}
      else setNotice(outcome.pending?'Résultat incertain : inspectez la commande. Ne créez pas une nouvelle clé d’émission.'
        :'Commande refusée. Relisez la progression avant toute nouvelle action.');
    }finally{if(serial===mutationSerial.current)setBusy(false);}
  };
  const hydrated=prior.current.sessionId===sessionId&&prior.current.audience===props.audience
    &&prior.current.contextId===props.contextId&&prior.current.panelId===props.panelId;
  if(!allowed||!hydrated)return <p className="p-6 text-sm">Recherche indisponible pour cette session.</p>;
  return <section className="h-full overflow-y-auto p-3" data-meili-admin-view>
    {pending?<p role="alert" className="mb-3 rounded-md border border-amber-300 p-3 text-sm">
      Résultat de commande incertain. Aucune émission ne sera rejouée.
      <Button type="button" variant="outline" className="ml-2" disabled={checking||busy}
        onClick={()=>void inspect()}>Vérifier l’opération</Button></p>:null}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4" /> Recherche (Meilisearch)
        </CardTitle>
        <CardDescription>
          Connectez une instance Meilisearch externe. La projection Catalogue reste séparée
          de la recherche globale du produit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">État : {connection?.authenticated===true&&connection.status==='connected'?'Connecté':connection?.authenticated===false&&connection.status==='key_rejected'?'Clé refusée':config?stateLabel[config.state]:'Non configuré'}
          {config?.hasKey?' · clé enregistrée':' · clé absente'}</p>
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
          <label className="grid gap-1 text-sm">Source déclarée
            <select className="rounded-md border px-3 py-2 text-sm" value={source}
              disabled={busy||!!pending} onChange={event=>{
                sourceSnapshot.current=event.target.value;
                setSource(event.target.value);setIndexState(null);}}>
              {sources.length===0?<option value="">Aucune source</option>:null}
              {sources.map(item=><option key={item} value={item}>{item}</option>)}
            </select></label>
          <Button type="button" disabled={busy||!!pending||!config?.enabled||!config.hasKey
            ||!source||!indexState||!['missing','ready','failed'].includes(indexState.state)}
            onClick={()=>void indexCommand('index.rebuild.start')}>
            <RefreshCw className="mr-2 h-4 w-4" /> Nouvelle génération Catalogue</Button>
          <Button type="button" variant="outline" disabled={loading||busy||checking}
            onClick={()=>{const token=generation.current;
              void readConfigThenIndex(()=>read(token),value=>loadIndex(token,value.source),
                ()=>current(token));}}>
            {loading?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:null}
            Actualiser l’état</Button>
        </div>
        <div className="space-y-2 rounded-md border p-3" aria-label="Projection Catalogue Meili">
          <p className="text-sm">Projection : {indexState?.state??'indisponible'}
            {indexState?.taskUid!==null&&indexState?.taskUid!==undefined?` · tâche ${indexState.taskUid}`:''}
            {indexState?.abandoned?' · génération abandonnée conservée':''}</p>
          <div className="flex flex-wrap gap-2">
            {indexState?.state==='ready'&&indexState.active?<Button type="button" disabled={busy||!!pending}
              onClick={()=>void indexCommand('index.sync.start')}>Synchroniser les changements</Button>:null}
            {indexState?.state==='building'?<Button type="button" disabled={busy||!!pending}
              onClick={()=>void indexCommand('index.prepare')}>Préparer le lot suivant</Button>:null}
            {indexState?.state==='prepared'?<><Button type="button" disabled={busy||!!pending||!indexState.emitKey}
              onClick={()=>void indexCommand('index.emit')}>Émettre le lot préparé ({indexState.preparedCount})</Button>
              <Button type="button" variant="outline" disabled={busy||!!pending}
                onClick={()=>void indexCommand('index.abandon')}>Abandonner après inspection</Button></>:null}
            {indexState?.state==='waiting'?<Button type="button" disabled={busy||!!pending}
              onClick={()=>void indexCommand('index.reconcile')}>Vérifier la tâche fournisseur</Button>:null}
          </div>
          <p className="text-xs text-slate-500">Une issue inconnue exige l’inspection de la commande ;
            l’abandon explicite conserve l’ancienne génération et ne supprime aucun index distant.</p>
        </div>
        <p className="text-xs text-slate-500">Le diagnostic ci-dessous lit les noms d’index du compte connecté,
          sans consulter leurs documents.</p>
        <div className="space-y-2 rounded-md border p-3" aria-label="Diagnostic des index Meili">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Index du compte Meilisearch</h3>
            <Button type="button" size="sm" variant="outline"
              disabled={busy||!!pending||indexLoading||!config?.enabled||!config.hasKey}
              onClick={()=>void listIndexes()}>Lister les index</Button>
          </div>
          {indexPage?<><p className="text-xs text-slate-500">{indexPage.total} index signalés par Meilisearch.</p>
            <ul className="space-y-1 text-sm">{indexPage.items.map(item=><li key={item.uid} className="rounded border px-2 py-1">
              <span className="font-medium">{item.uid}</span>
              <span className="ml-2 text-xs text-slate-500">Clé primaire : {item.primaryKey??'non définie'}</span>
              <span className="block text-xs text-slate-500">Créé : {item.createdAt} · modifié : {item.updatedAt}</span>
            </li>)}</ul>
            {indexPage.nextCursor?<Button type="button" size="sm" variant="outline" disabled={indexLoading||busy}
              onClick={()=>void listIndexes(indexPage.nextCursor!)}>Page suivante</Button>:null}</>:null}
        </div>
        {notice?<p role="status" className="text-sm">{notice}</p>:null}
      </CardContent>
    </Card>
  </section>;
}
