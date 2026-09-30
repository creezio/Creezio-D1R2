'use client';

import {useEffect,useMemo,useRef,useState,useSyncExternalStore,type ChangeEvent} from 'react';
import {FileText,Folder,Link2,RefreshCw,Search,ShieldCheck} from 'lucide-react';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {createCommandJournal,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {Button,Card,CardContent,CardHeader,CardTitle,Tabs,TabsContent,TabsList,TabsTrigger} from '@creezio/sdk/ui';
import {createSelectionFence} from './selection.ts';

type Note={id:string;title:string|null;owner:string|null;note_created_at:string|null;
  note_updated_at:string|null;folder_id?:string|null;summary_text?:string|null;web_url?:string|null;synced_at:string};
type FolderRow={id:string;name:string;parent_folder_id:string|null};
type Segment={id:string;note_id:string;text:string;speaker_name:string|null;start_time:string;end_time:string};
type Config={origin:string;enabled:boolean;hasKey:boolean;hasWebhookSecret:boolean;
  hasWebhookService:boolean;state:'missing'|'configured'|'unverified';revision:number};
type SyncState={collection:'notes'|'folders';runId:string|null;cursor:string|null;
  status:'partial'|'pages_exhausted';revision:number;updatedAt:string|null};
const binding=(audience:'admin'|'app',operation:string)=>`creezio.granola:${audience}.${operation}`;
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;
const resultOutput=(result:Awaited<ReturnType<WorkspaceViewProps['client']['invoke']>>)=>
  result.kind==='execution'&&result.execution.state==='succeeded'?record(result.execution.output):null;
const session=(access:ReturnType<WorkspaceViewProps['access']['getSnapshot']>)=>
  access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
const date=(value:string|null|undefined)=>value?new Date(value).toLocaleString('fr-FR'):'—';
const box='rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';

/** The source Notes panel's list, folder filter and summary/transcript detail are retained. */
export function GranolaNotesView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=session(access),allowed=!!activity&&props.active&&props.authorized&&!!sessionId
    &&props.client.audience===props.audience;
  const [notes,setNotes]=useState<Note[]>([]),[folders,setFolders]=useState<FolderRow[]>([]);
  const [query,setQuery]=useState(''),[folderId,setFolderId]=useState(''),[selected,setSelected]=useState<Note|null>(null);
  const [segments,setSegments]=useState<Segment[]>([]),[notesCursor,setNotesCursor]=useState<string|null>(null);
  const [foldersCursor,setFoldersCursor]=useState<string|null>(null),[transcriptCursor,setTranscriptCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[detailBusy,setDetailBusy]=useState(false),[notice,setNotice]=useState('');
  const generation=useRef(0),selection=useRef(createSelectionFence()),prior=useRef({sessionId,contextId:props.contextId,audience:props.audience,
    client:props.client,allowed}),live=useRef({sessionId,contextId:props.contextId,audience:props.audience,
    client:props.client,allowed});
  if(Object.keys(prior.current).some(key=>
    (prior.current as Record<string,unknown>)[key]!==({sessionId,contextId:props.contextId,
      audience:props.audience,client:props.client,allowed} as Record<string,unknown>)[key])){
    generation.current++;prior.current={sessionId,contextId:props.contextId,audience:props.audience,
      client:props.client,allowed};
  }
  live.current={sessionId,contextId:props.contextId,audience:props.audience,client:props.client,allowed};
  const current=(token:number)=>token===generation.current&&live.current.allowed&&
    props.access.getSnapshot().session?.id===sessionId;
  useRegisterWorkspaceMetadata(props.panelId,{title:'Notes Granola',kind:'section',trail:[{label:'Granola'},{label:'Notes'}]});
  const call=async(operation:string,input:Record<string,unknown>,token:number)=>{
    const result=await props.client.invoke({bindingId:binding(props.audience,operation),
      contextId:props.contextId,input,isCurrent:()=>current(token)});
    return current(token)?resultOutput(result):null;
  };
  const load=async(kind:'note'|'folder',cursor:string|null=null,append=false)=>{
    const token=generation.current;if(!current(token))return;
    setBusy(true);setNotice('');
    try{
      const output=await call(`${kind}.list`,{limit:25,...(cursor?{cursor}:{})},token);
      if(!current(token))return;
      if(!output||!Array.isArray(output.items)){setNotice('Lecture indisponible ou accès refusé.');return;}
      if(kind==='note'){
        setNotes(old=>append?[...old,...output.items as Note[]]:output.items as Note[]);
        setNotesCursor(typeof output.nextCursor==='string'?output.nextCursor:null);
      }else{
        setFolders(old=>append?[...old,...output.items as FolderRow[]]:output.items as FolderRow[]);
        setFoldersCursor(typeof output.nextCursor==='string'?output.nextCursor:null);
      }
    }catch{if(current(token))setNotice('Lecture indisponible.');}
    finally{if(current(token))setBusy(false);}
  };
  const open=async(note:Note)=>{
    const token=generation.current;if(!current(token))return;
    const serial=selection.current.open(note.id);
    const selectedNow=()=>current(token)&&selection.current.matches(serial,note.id);
    setSelected(note);setSegments([]);setTranscriptCursor(null);setDetailBusy(true);
    try{
      const [detail,transcript]=await Promise.all([
        call('note.detail',{id:note.id},token),
        call('transcript.page',{id:note.id,cursor:null,limit:25},token)
      ]);
      if(!selectedNow())return;
      if(detail?.note&&record(detail.note)?.id===note.id)setSelected(detail.note as Note);
      if(transcript&&Array.isArray(transcript.segments)){
        setSegments(transcript.segments as Segment[]);
        setTranscriptCursor(typeof transcript.nextCursor==='string'?transcript.nextCursor:null);
      }else setNotice('Transcription indisponible ou accès refusé.');
    }catch{if(selectedNow())setNotice('Fiche indisponible.');}
    finally{if(selectedNow())setDetailBusy(false);}
  };
  const moreTranscript=async()=>{
    if(!selected||!transcriptCursor)return;
    const token=generation.current,cursor=transcriptCursor,id=selected.id;
    const serial=selection.current.open(id);
    const selectedNow=()=>current(token)&&selection.current.matches(serial,id);
    if(!selectedNow())return;
    setDetailBusy(true);
    try{
      const output=await call('transcript.page',{id,cursor,limit:25},token);
      if(!selectedNow()||!output||!Array.isArray(output.segments))return;
      setSegments(old=>[...old,...output.segments as Segment[]]);
      setTranscriptCursor(typeof output.nextCursor==='string'?output.nextCursor:null);
    }finally{if(selectedNow())setDetailBusy(false);}
  };
  useEffect(()=>{
    generation.current++;selection.current.reset();
    setNotes([]);setFolders([]);setSelected(null);setSegments([]);
    setNotesCursor(null);setFoldersCursor(null);setTranscriptCursor(null);setNotice('');setBusy(false);
    if(allowed){void load('note');void load('folder');}
  },[sessionId,props.contextId,props.audience,props.client,allowed]);
  const visible=useMemo(()=>notes.filter(note=>(!folderId||note.folder_id===folderId)&&
    (!query||String(note.title??'').toLocaleLowerCase().includes(query.toLocaleLowerCase()))),
  [notes,folderId,query]);
  if(!allowed)return <p className={box}>Accès aux notes Granola indisponible.</p>;
  return <main className="space-y-4 p-4 text-slate-900">
    <header className="flex flex-wrap items-center justify-between gap-3"><div>
      <h1 className="text-xl font-semibold">Notes Granola</h1>
      <p className="text-sm text-slate-500">Notes, dossiers et transcriptions synchronisés dans ce contexte.</p></div>
      <Button disabled={busy} onClick={()=>{void load('note');void load('folder');}}><RefreshCw className="mr-2 h-4 w-4"/>Actualiser</Button></header>
    {notice&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr]"><section className={box}>
      <div className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-400"/>
        <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          aria-label="Rechercher une note" value={query} onChange={(event:ChangeEvent<HTMLInputElement>)=>setQuery(event.target.value)}
          placeholder="Rechercher une note"/></div>
      <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor="granola-folder">Dossier</label>
      <select id="granola-folder" className="mt-1 w-full rounded-md border border-slate-200 bg-white p-2 text-sm"
        value={folderId} onChange={event=>setFolderId(event.target.value)}>
        <option value="">Tous les dossiers</option>{folders.map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
      <div className="mt-3 max-h-[60vh] space-y-1 overflow-auto">
        {visible.map(note=><button key={note.id} type="button" onClick={()=>void open(note)}
          className={`w-full rounded-lg border p-3 text-left hover:bg-slate-50 ${selected?.id===note.id?'border-sky-300 bg-sky-50':'border-slate-100'}`}>
          <span className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4 shrink-0"/>{note.title||'Sans titre'}</span>
          <span className="mt-1 block text-xs text-slate-500">{date(note.note_created_at)} · {note.owner||'Auteur inconnu'}</span>
        </button>)}
        {!visible.length&&<p className="py-8 text-center text-sm text-slate-500">Aucune note accessible.</p>}
      </div>
      {notesCursor&&<Button variant="outline" disabled={busy} onClick={()=>void load('note',notesCursor,true)}>Plus de notes</Button>}
      {foldersCursor&&<Button variant="outline" disabled={busy} onClick={()=>void load('folder',foldersCursor,true)}>Plus de dossiers</Button>}
    </section><section className={box}>
      {!selected?<div className="flex min-h-80 flex-col items-center justify-center text-slate-500"><Folder className="mb-3 h-8 w-8"/>Sélectionnez une note.</div>:
        <><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{selected.title||'Sans titre'}</h2>
          <p className="text-xs text-slate-500">{date(selected.note_created_at)} · {selected.owner||'Auteur inconnu'}</p></div>
          {selected.web_url&&<a className="text-sky-700" href={selected.web_url} target="_blank" rel="noopener noreferrer"
            aria-label="Ouvrir dans Granola"><Link2 className="h-4 w-4"/></a>}</div>
          <Tabs defaultValue="summary" className="mt-4"><TabsList><TabsTrigger value="summary">Résumé</TabsTrigger>
            <TabsTrigger value="transcript">Transcription</TabsTrigger></TabsList>
            <TabsContent value="summary"><p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {selected.summary_text||'Résumé non synchronisé.'}</p></TabsContent>
            <TabsContent value="transcript"><div className="max-h-[55vh] space-y-3 overflow-auto">
              {segments.map(segment=><div key={segment.id} className="border-b border-slate-100 pb-2 text-sm">
                <p className="text-xs text-slate-500">{segment.speaker_name||'Intervenant'} · {date(segment.start_time)}</p>
                <p className="whitespace-pre-wrap">{segment.text}</p></div>)}
              {!segments.length&&!detailBusy&&<p className="text-sm text-slate-500">Aucun segment accessible.</p>}</div>
              {transcriptCursor&&<Button variant="outline" disabled={detailBusy} onClick={()=>void moreTranscript()}>Suite de la transcription</Button>}
            </TabsContent></Tabs></>}
    </section></div>
  </main>;
}

/** Original Connect panel adapted to host-owned secret sealing and command journal. */
export function GranolaConnectView(props:WorkspaceViewProps){
  const activity=useWorkspaceActivity();
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=session(access),allowed=!!activity&&props.active&&props.authorized&&props.audience==='admin'
    &&props.client.audience==='admin'&&!!sessionId;
  const [config,setConfig]=useState<Config|null>(null),[apiKey,setApiKey]=useState(''),
    [webhookSecret,setWebhookSecret]=useState(''),[serviceToken,setServiceToken]=useState(''),
    [notice,setNotice]=useState('');
  const [states,setStates]=useState<SyncState[]>([]),[busy,setBusy]=useState(false),[pending,setPending]=useState<PendingCommand|null>(null);
  const token=useRef(0),journal=useRef<ReturnType<typeof createCommandJournal>|null>(null),
    initial=useRef(props.navigation.readPanelState()?.data),
    prior=useRef({sessionId,contextId:props.contextId,allowed});
  if(prior.current.sessionId!==sessionId||prior.current.contextId!==props.contextId||prior.current.allowed!==allowed){
    token.current++;prior.current={sessionId,contextId:props.contextId,allowed};
  }
  const current=(value:number)=>value===token.current&&allowed&&props.access.getSnapshot().session?.id===sessionId;
  useRegisterWorkspaceMetadata(props.panelId,{title:'Connexion Granola',kind:'section',trail:[{label:'Granola'},{label:'Connexion'}]});
  const invoke=async(name:string,input:Record<string,unknown>,value:number)=>{
    const result=await props.client.invoke({bindingId:binding('admin',name),contextId:props.contextId,
      input,isCurrent:()=>current(value)});
    return current(value)?resultOutput(result):null;
  };
  const read=async()=>{
    const value=token.current;if(!current(value))return;
    const [cfg,sync]=await Promise.all([invoke('config.read',{},value),invoke('sync.state',{},value)]);
    if(!current(value))return;
    if(record(cfg?.config))setConfig(cfg!.config as Config);
    if(Array.isArray(sync?.states))setStates(sync.states as SyncState[]);
  };
  useEffect(()=>{token.current++;setConfig(null);setStates([]);setApiKey('');setWebhookSecret('');
    setServiceToken('');setNotice('');setBusy(false);
    const scope={sessionId,audience:'admin' as const,contextId:props.contextId};
    const restored=initial.current?.sessionId===sessionId&&initial.current?.contextId===props.contextId
      ?initial.current.pending:null;
    journal.current=allowed?createCommandJournal(scope,restored):null;
    setPending(journal.current?.pending??null);initial.current=undefined;
    if(allowed)void read();
  },[sessionId,props.contextId,allowed,props.client]);
  const persist=(next:PendingCommand|null,value:number)=>{
    if(!current(value))return false;
    const saved=props.navigation.savePanelState({data:{sessionId,audience:'admin',contextId:props.contextId,
      ...(next?{pending:next}:{})}});
    if(saved)setPending(next);
    return saved;
  };
  const command=async(name:string,input:Record<string,unknown>)=>{
    const value=token.current,controller=journal.current;
    if(!controller||!current(value)||controller.pending||busy)return;
    setBusy(true);setNotice('');
    try{
      const outcome=await controller.execute(props.client,{sessionId,audience:'admin',contextId:props.contextId,
        bindingId:binding('admin',name),requestKey:crypto.randomUUID(),intent:name},input,
      ()=>current(value),next=>persist(next,value));
      if(!current(value))return;
      setPending(outcome.pending);
      const output=outcome.result?resultOutput(outcome.result):null;
      if(output){if(record(output.config))setConfig(output.config as Config);
        if(record(output.state))setStates(old=>old.map(item=>item.collection===record(output.state)?.collection
          ?output.state as SyncState:item));
        if(name==='config.key.set')setApiKey('');
        if(name==='config.key.webhook.set')setWebhookSecret('');
        if(name==='config.key.webhook.service.set')setServiceToken('');
        setNotice('Opération confirmée.');}
      else setNotice(outcome.pending?'Résultat incertain. Inspectez le statut avant un nouvel envoi.':'Opération refusée.');
    }finally{if(current(value))setBusy(false);}
  };
  const inspect=async()=>{
    const value=token.current,controller=journal.current;if(!controller?.pending||!current(value))return;
    const outcome=await controller.inspect(props.client,()=>current(value),next=>persist(next,value));
    if(!current(value))return;setPending(outcome?.pending??null);
    setNotice(outcome?.pending?'Résultat toujours incertain.':'Statut relu.');
    if(!outcome?.pending)void read();
  };
  if(!allowed)return <p className={box}>Administration Granola indisponible.</p>;
  return <main className="space-y-4 p-4"><header><h1 className="text-xl font-semibold">Connexion Granola</h1>
    <p className="text-sm text-slate-500">Clé scellée et synchronisation explicite du compte.</p></header>
    {notice&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">{notice}</p>}
    {pending&&<Button variant="outline" onClick={()=>void inspect()}>Vérifier l’opération en attente</Button>}
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5"/>Accès API</CardTitle></CardHeader>
      <CardContent className="space-y-3"><p className="text-sm">Origine : {config?.origin||'—'} · {config?.hasKey?'Clé enregistrée':'Clé absente'}
        · {config?.enabled?'Activé':'Désactivé'}</p>
        <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" type="password"
          autoComplete="off" aria-label="Clé API Granola" value={apiKey}
          onChange={(event:ChangeEvent<HTMLInputElement>)=>setApiKey(event.target.value)} placeholder="Nouvelle clé API"/>
        <div className="flex flex-wrap gap-2"><Button disabled={!config||busy||!!pending||apiKey.length<8}
          onClick={()=>void command('config.key.set',{apiKey,revision:config?.revision})}>Enregistrer la clé</Button>
          <Button variant="outline" disabled={!config||busy||!!pending||!config.hasKey}
            onClick={()=>void command('config.key.revoke',{revision:config?.revision})}>Révoquer</Button>
          <Button variant="outline" disabled={!config||busy||!!pending||!config.hasKey}
            onClick={()=>void command('config.set',{enabled:!config?.enabled,revision:config?.revision})}>
            {config?.enabled?'Désactiver':'Activer'}</Button>
          <Button variant="outline" disabled={busy} onClick={()=>void read()}>Relire</Button></div>
        {!config&&<Button disabled={busy} onClick={()=>void command('config.set',{enabled:false,revision:0})}>Initialiser</Button>}
      </CardContent></Card>
    <Card><CardHeader><CardTitle>Réception webhook</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-xs text-slate-500">Adresse à enregistrer dans Granola : /api/webhooks/granola. Les événements signés sont enregistrés ; actualisez ensuite la note concernée.</p>
      <p className="text-sm">Signature : {config?.hasWebhookSecret?'secret enregistré':'secret absent'} · Jeton de service : {config?.hasWebhookService?'enregistré':'absent'}</p>
      <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" type="password"
        autoComplete="off" aria-label="Secret de signature webhook Granola" value={webhookSecret}
        onChange={(event:ChangeEvent<HTMLInputElement>)=>setWebhookSecret(event.target.value)} placeholder="whsec_…"/>
      <div className="flex flex-wrap gap-2"><Button disabled={!config?.enabled||busy||!!pending||webhookSecret.length<22}
        onClick={()=>void command('config.key.webhook.set',{webhookSecret,revision:config?.revision})}>Enregistrer le secret</Button>
        <Button variant="outline" disabled={!config?.hasWebhookSecret||busy||!!pending}
          onClick={()=>void command('config.key.webhook.revoke',{revision:config?.revision})}>Révoquer le secret</Button></div>
      <input className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm" type="password"
        autoComplete="off" aria-label="Jeton de service du webhook Granola" value={serviceToken}
        onChange={(event:ChangeEvent<HTMLInputElement>)=>setServiceToken(event.target.value)} placeholder="cz1a_…"/>
      <div className="flex flex-wrap gap-2"><Button disabled={!config?.enabled||busy||!!pending||!/^cz1a_[A-Za-z0-9_-]{43}$/u.test(serviceToken)}
        onClick={()=>void command('config.key.webhook.service.set',{serviceToken,revision:config?.revision})}>Enregistrer le jeton</Button>
        <Button variant="outline" disabled={!config?.hasWebhookService||busy||!!pending}
          onClick={()=>void command('config.key.webhook.service.revoke',{revision:config?.revision})}>Révoquer le jeton</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Synchronisation</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-xs text-slate-500">Chaque page est déclenchée explicitement. Aucun serveur permanent.</p>
      {(['notes','folders'] as const).map(kind=>{const state=states.find(item=>item.collection===kind);
        return <div key={kind} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <div><p className="font-medium">{kind==='notes'?'Notes':'Dossiers'}</p>
            <p className="text-xs text-slate-500">{state?.status||'Aucun parcours'} · {date(state?.updatedAt)}</p></div>
          <div className="flex gap-2"><Button variant="outline" disabled={!config?.enabled||busy||!!pending}
            onClick={()=>void command('sync.start',{collection:kind,runId:crypto.randomUUID(),revision:state?.revision??0})}>
            Nouveau parcours</Button>
            <Button disabled={!config?.enabled||!state?.runId||state.status!=='partial'||busy||!!pending}
              onClick={()=>void command('sync.page',{collection:kind,runId:state?.runId,
                cursor:state?.cursor??null,limit:8,expectedRevision:state?.revision})}>Lire une page</Button></div>
        </div>;})}
    </CardContent></Card>
  </main>;
}
