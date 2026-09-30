'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {createCommandJournal} from '@creezio/sdk/operations/command-journal';
import type {PendingCommand,CommandOutcome} from '@creezio/sdk/operations/command-journal';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {clearSubmittedReply,putReply,requiresSupportReset,supportPanelBelongsToScope,supportPanelData,supportScopeForAccess} from './state.ts';

type Ticket={id:string;requesterId:string;subject:string;status:'ouvert'|'repondu'|'resolu'|'ferme';
  assignedTo:string|null;createdAt:string;updatedAt:string;lastMessageAt:string|null;
  lastPreview:string|null;messageCount:number;revision:number;
  contactId:string|null;messageBoxId:string|null;messageId:string|null};
type Message={id:string;ticketId:string;origin:'client'|'support';authorId:string;body:string;createdAt:string};
type ContactReference={id:string;name:string;email:string|null;companyId:string|null};
type MessageReference={id:string;boxId:string;subject:string;from:string;text:string};
type Page<T>={items:T[];nextCursor:string|null};
const statusLabel:Record<Ticket['status'],string>={ouvert:'Ouvert',repondu:'Répondu',resolu:'Résolu',ferme:'Fermé'};
const statusBadge=(status:Ticket['status'])=>`rounded-full px-2 text-xs ${status==='ouvert'?
  'bg-destructive/10 text-destructive':status==='repondu'?'bg-primary text-primary-foreground':'bg-secondary'}`;
const button='rounded-md border px-3 py-2 text-sm disabled:opacity-50';
const field='rounded-md border bg-transparent px-3 py-2 text-sm';
const date=(value:string|null)=>value?new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'—';
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

export function SupportWorkspaceView(props:WorkspaceViewProps){
  const active=useWorkspaceActivity()&&props.active&&props.authorized;
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const session=access.phase==='authenticated'&&!access.pending?access.session:null;
  const audience=props.audience,admin=audience==='admin';
  const [tickets,setTickets]=useState<Ticket[]>([]),[ticketCursor,setTicketCursor]=useState<string|null>(null);
  const [selected,setSelected]=useState<Ticket|null>(null),[messages,setMessages]=useState<Message[]>([]);
  const [messageCursor,setMessageCursor]=useState<string|null>(null),[query,setQuery]=useState('');
  const [appliedQuery,setAppliedQuery]=useState(''),[subject,setSubject]=useState(''),[body,setBody]=useState('');
  const [replies,setReplies]=useState<ReadonlyMap<string,string>>(()=>new Map());
  const reply=selected?replies.get(selected.id)??'':'';
  const [loading,setLoading]=useState(false),[threadLoading,setThreadLoading]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [pending,setPending]=useState<PendingCommand|null>(null);
  const [contactTerm,setContactTerm]=useState(''),[contacts,setContacts]=useState<ContactReference[]>([]);
  const [contactReference,setContactReference]=useState<ContactReference|null>(null);
  const [referenceBox,setReferenceBox]=useState(''),[referenceMessage,setReferenceMessage]=useState('');
  const [messageReference,setMessageReference]=useState<MessageReference|null>(null);
  const [referenceBusy,setReferenceBusy]=useState(false);
  const busyRef=useRef(false),busySerial=useRef(0),epoch=useRef(0),listSerial=useRef(0),selectionSerial=useRef(0);
  const initialPanel=useRef(props.navigation.readPanelState()?.data);
  const initialScope={sessionId:session?.id??'',audience,contextId:props.contextId};
  const savedId=useRef<string|null>(supportPanelBelongsToScope(initialPanel.current,initialScope)&&
    validId(initialPanel.current?.ticketId)?initialPanel.current.ticketId:null);
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(null);
  const clearPanelState=useRef(false);
  const selectedIdRef=useRef<string|null>(null);
  const subjectVersion=useRef(0),bodyVersion=useRef(0),replyVersions=useRef(new Map<string,number>());
  const pendingCreate=useRef<{requestKey:string;subjectVersion:number;bodyVersion:number;selection:string|null}|null>(null);
  const pendingReply=useRef<{ticketId:string;version:number}|null>(null);
  const scope=useRef({sessionId:session?.id??'',client:props.client,access:props.access,audience,
    contextId:props.contextId});
  const identity=useRef({active,sessionId:session?.id??'',client:props.client,access:props.access,
    audience,contextId:props.contextId});
  if(identity.current.active!==active||identity.current.sessionId!==(session?.id??'')||
    identity.current.client!==props.client||identity.current.access!==props.access||
    identity.current.audience!==audience||identity.current.contextId!==props.contextId){
    epoch.current++;identity.current={active,sessionId:session?.id??'',client:props.client,
      access:props.access,audience,contextId:props.contextId};}
  useRegisterWorkspaceMetadata(props.panelId,{title:'Support',kind:'section',trail:[{label:'Support'}]});
  const current=useCallback((token:number)=>active&&!!session&&epoch.current===token&&
    props.access.getSnapshot().session?.id===session.id,[active,session,props.access]);
  const persistPanel=useCallback((next:PendingCommand|null)=>{
    const captured={sessionId:session?.id??'',audience,contextId:props.contextId};
    if(!captured.sessionId||scope.current.sessionId!==captured.sessionId||
      scope.current.audience!==captured.audience||scope.current.contextId!==captured.contextId)return false;
    const saved=props.navigation.savePanelState({data:supportPanelData(captured,
      selectedIdRef.current??savedId.current,next)});
    if(saved)clearPanelState.current=false;
    return saved;
  },[props.navigation,session?.id,audience,props.contextId]);
  const invoke=useCallback(async(operation:string,input:Record<string,unknown>,token:number)=>{
    try{const result=await props.client.invoke({bindingId:`creezio.support:${audience}.${operation}`,
      contextId:props.contextId,input,isCurrent:()=>current(token)});
      if(!current(token))return null;
      if(result.kind==='execution'&&result.execution.state==='succeeded')return result.execution.output as Record<string,unknown>;
      setError(result.kind==='unknown'?'Résultat incertain. Vérifiez le fil avant une nouvelle action.':
        result.kind==='rejected'&&result.code==='conflict'?'Ticket modifié ailleurs. Actualisez-le.':
        'Opération refusée ou indisponible.');return null;
    }catch{if(current(token))setError('Connexion interrompue. Vérifiez le ticket avant de réessayer.');return null;}
  },[props.client,props.contextId,audience,current]);
  const refresh=useCallback(async(token:number,term:string,append=false,cursor?:string)=>{
    if(!current(token))return;const serial=++listSerial.current;setLoading(true);
    const normalized=term.trim();
    const output=await invoke('ticket.list',{limit:25,...(normalized?{query:normalized}:{}),
      ...(cursor?{cursor}:{})},token);
    if(!current(token)||serial!==listSerial.current)return;
    if(output&&Array.isArray(output.items)){
      const rows=output.items as Ticket[];
      setTickets(previous=>append?[...previous,...rows.filter(row=>!previous.some(old=>old.id===row.id))]:rows);
      setTicketCursor(typeof output.nextCursor==='string'?output.nextCursor:null);setAppliedQuery(normalized);
    }
    setLoading(false);
  },[current,invoke]);
  const readTicket=useCallback(async(id:string,token:number,retain=false)=>{
    if(!validId(id)||!current(token))return;
    selectedIdRef.current=id;
    const serial=++selectionSerial.current;setThreadLoading(true);
    if(!retain){setSelected(null);setMessages([]);setMessageCursor(null);}
    const detail=await invoke('ticket.read',{id},token);
    if(!current(token)||serial!==selectionSerial.current)return;
    if(!detail?.item){selectedIdRef.current=null;setSelected(null);setMessages([]);setMessageCursor(null);
      setThreadLoading(false);return;}
    setSelected(detail.item as Ticket);
    const thread=await invoke('message.list',{ticketId:id,limit:50},token);
    if(!current(token)||serial!==selectionSerial.current)return;
    if(thread&&Array.isArray(thread.items)){setMessages([...(thread.items as Message[])].reverse());
      setMessageCursor(typeof thread.nextCursor==='string'?thread.nextCursor:null);}
    setThreadLoading(false);
  },[current,invoke]);
  useEffect(()=>{const token=epoch.current;listSerial.current++;selectionSerial.current++;
    const nextScope=supportScopeForAccess(scope.current,
      {sessionId:session?.id??'',client:props.client,access:props.access,audience,
        contextId:props.contextId},access.phase);
    const reset=requiresSupportReset(scope.current,nextScope);
    const restoredPanel=!journal.current&&nextScope.sessionId?
      props.navigation.readPanelState()?.data:initialPanel.current;
    scope.current=nextScope;
    if(reset){busySerial.current++;busyRef.current=false;setBusy(false);
      setTickets([]);setSelected(null);setMessages([]);setTicketCursor(null);setMessageCursor(null);
      setError('');setSubject('');setBody('');setReplies(new Map());setQuery('');setAppliedQuery('');
      selectedIdRef.current=null;savedId.current=null;clearPanelState.current=true;
      pendingCreate.current=null;pendingReply.current=null;replyVersions.current.clear();
      subjectVersion.current++;bodyVersion.current++;
      journal.current=null;setPending(null);initialPanel.current=undefined;}
    if(reset){setContacts([]);setContactReference(null);setMessageReference(null);
      setContactTerm('');setReferenceBox('');setReferenceMessage('');setReferenceBusy(false);}
    if(!active||!session){setLoading(false);setThreadLoading(false);return;}
    if(!journal.current){
      if(!reset&&supportPanelBelongsToScope(restoredPanel,nextScope)&&!selectedIdRef.current)
        savedId.current=validId(restoredPanel?.ticketId)?restoredPanel.ticketId:null;
      journal.current=createCommandJournal({sessionId:session.id,audience,
      contextId:props.contextId},reset?null:restoredPanel?.pending);initialPanel.current=undefined;
    }
    setPending(journal.current.pending);
    if(clearPanelState.current&&props.navigation.savePanelState({data:supportPanelData(nextScope,
      null,journal.current.pending)}))
      clearPanelState.current=false;
    void refresh(token,reset?'':appliedQuery);
    const id=reset?null:selectedIdRef.current??savedId.current;
    if(id){const retain=selectedIdRef.current===id;savedId.current=null;void readTicket(id,token,retain);}
  },[active,session?.id,access.phase,audience,props.client,props.access,props.contextId,refresh,readTicket]);
  const choose=(id:string)=>{selectedIdRef.current=id;savedId.current=null;
    setContacts([]);setContactReference(null);setMessageReference(null);
    if(!persistPanel(journal.current?.pending??null))setError('État du panneau indisponible. Les modifications sont bloquées.');
    void readTicket(id,epoch.current);};
  const readReference=async(operation:'reference.contact.search'|'reference.contact.read'|'reference.message.read',
    input:Record<string,unknown>)=>{
    if(!selected||referenceBusy||!current(epoch.current))return;
    const token=epoch.current,ticketId=selected.id,serial=selectionSerial.current;
    setReferenceBusy(true);
    try{const output=await invoke(operation,{ticketId,...input},token);
      if(!current(token)||selectionSerial.current!==serial||selectedIdRef.current!==ticketId)return;
      if(!output){setError('Lien indisponible ou accès refusé. Vérifiez les droits du module lié.');return;}
      if(operation==='reference.contact.search'){
        if(!Array.isArray(output.items)){setError('Réponse CRM invalide.');return;}
        setContacts(output.items as ContactReference[]);setContactReference(null);
      }else if(operation==='reference.contact.read'){
        if(!output.item){setError('Contact introuvable.');return;}
        setContactReference(output.item as ContactReference);
      }else{
        if(!output.message){setError('Message introuvable.');return;}
        setMessageReference(output.message as MessageReference);
      }
    }finally{if(current(token))setReferenceBusy(false);}
  };
  const loadMoreTickets=()=>{if(ticketCursor&&!loading)void refresh(epoch.current,appliedQuery,true,ticketCursor);};
  const loadMoreMessages=async()=>{if(!selected||!messageCursor||threadLoading)return;
    const token=epoch.current,id=selected.id,serial=selectionSerial.current;setThreadLoading(true);
    const result=await invoke('message.list',{ticketId:id,limit:50,cursor:messageCursor},token);
    if(!current(token)||serial!==selectionSerial.current)return;
    if(result&&Array.isArray(result.items)){const older=[...(result.items as Message[])].reverse();
      setMessages(previous=>[...older.filter(row=>!previous.some(old=>old.id===row.id)),...previous]);
      setMessageCursor(typeof result.nextCursor==='string'?result.nextCursor:null);}
    setThreadLoading(false);
  };
  const reconcile=async(result:CommandOutcome['result'],issued:PendingCommand,token:number)=>{
    if(!current(token)||result.kind!=='execution'||result.execution.state!=='succeeded')return null;
    const raw=result.execution.output;
    const output=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
    if(!output)setError('Modification confirmée. Actualisez pour relire le ticket.');
    if(issued.intent==='ticket.create'){
      const created=output?.item as Ticket|undefined;
      if(!validId(created?.id))setError('Création confirmée. Actualisez la liste pour retrouver le ticket.');
      else{
        const draft=pendingCreate.current?.requestKey===issued.requestKey?pendingCreate.current:null;
        if(draft){
          if(subjectVersion.current===draft.subjectVersion)setSubject('');
          if(bodyVersion.current===draft.bodyVersion)setBody('');
          pendingCreate.current=null;
        }
        if(selectedIdRef.current===(draft?.selection??null))choose(created.id);
      }
    }
    if(issued.intent?.startsWith('message.')&&issued.targetId){
      const draft=pendingReply.current;
      if(draft?.ticketId===issued.targetId){
        const version=replyVersions.current.get(issued.targetId)??0;
        setReplies(previous=>clearSubmittedReply(previous,issued.targetId!,draft.version,version));
        pendingReply.current=null;
      }
    }
    if(output&&issued.targetId&&selectedIdRef.current===issued.targetId){
      if(output.ticket)setSelected(output.ticket as Ticket);
      else if(output.item&&(issued.intent?.startsWith('ticket.')||issued.intent?.startsWith('reference.')))
        setSelected(output.item as Ticket);
      if(output.item&&issued.intent?.startsWith('message.')){
        const message=output.item as Message;
        setMessages(rows=>rows.some(row=>row.id===message.id)?rows:[...rows,message]);
      }
    }
    await refresh(token,appliedQuery);
    return current(token)?output:null;
  };
  const explainOutcome=(result:CommandOutcome['result'],stillPending:boolean)=>{
    if(stillPending){setError(result.kind==='rejected'&&
      ['forbidden','unauthorized','not_found'].includes(result.code)?
      'Statut inaccessible. La modification peut avoir abouti ; le suivi reste conservé jusqu’au retour des droits.':
      'Résultat incertain. Vérifiez la dernière modification avant toute nouvelle action.');return;}
    if(result.kind==='rejected')setError(result.code==='conflict'?'Ticket modifié ailleurs. Actualisez-le.':
      result.code==='client_state_unavailable'?'État du panneau indisponible. Aucune modification envoyée.':
      'Opération refusée ou indisponible.');
    else if(result.kind==='execution'&&result.execution.state==='failed')setError('Modification non confirmée. Actualisez le ticket.');
  };
  const command=async(operation:string,input:Record<string,unknown>,requestedKey?:string)=>{
    const currentJournal=journal.current;
    if(busyRef.current||!currentJournal||currentJournal.pending)return null;
    busyRef.current=true;setBusy(true);setError('');
    const token=epoch.current,serial=++busySerial.current,startedScope=scope.current;
    const targetId=typeof input.ticketId==='string'?input.ticketId:typeof input.id==='string'?input.id:undefined;
    if(targetId&&selectedIdRef.current===targetId){selectionSerial.current++;setThreadLoading(false);}
    const issued:PendingCommand={sessionId:session!.id,audience,contextId:props.contextId,
      bindingId:`creezio.support:${audience}.${operation}`,requestKey:requestedKey??crypto.randomUUID(),
      intent:operation,...(targetId?{targetId}:{})};
    try{const outcome=await currentJournal.execute(props.client,issued,input,()=>current(token),persistPanel);
      if(!current(token))return null;
      setPending(outcome.pending);explainOutcome(outcome.result,!!outcome.pending);
      return await reconcile(outcome.result,issued,token);
    }finally{if(busySerial.current===serial){busyRef.current=false;setBusy(false);
      if(!current(token)&&identity.current.active&&!!scope.current.sessionId&&
        !requiresSupportReset(startedScope,scope.current))void refresh(epoch.current,appliedQuery);}}
  };
  const inspect=async()=>{
    const currentJournal=journal.current,issued=currentJournal?.pending;
    if(busyRef.current||!currentJournal||!issued)return;
    busyRef.current=true;setBusy(true);setError('');
    const token=epoch.current,serial=++busySerial.current;
    if(issued.targetId&&selectedIdRef.current===issued.targetId){selectionSerial.current++;setThreadLoading(false);}
    try{const outcome=await currentJournal.inspect(props.client,()=>current(token),persistPanel);
      if(!outcome||!current(token))return;
      setPending(outcome.pending);explainOutcome(outcome.result,!!outcome.pending);
      await reconcile(outcome.result,issued,token);
    }finally{if(busySerial.current===serial){busyRef.current=false;setBusy(false);}}
  };
  const create=async()=>{if(!subject.trim()||busyRef.current||journal.current?.pending)return;
    const key=crypto.randomUUID();
    pendingCreate.current={requestKey:key,subjectVersion:subjectVersion.current,
      bodyVersion:bodyVersion.current,selection:selectedIdRef.current};
    await command('ticket.create',{subject:subject.trim(),body:body.trim()},key);
  };
  const send=async()=>{if(!selected||!reply.trim()||busyRef.current||journal.current?.pending)return;
    const ticketId=selected.id;
    pendingReply.current={ticketId,version:replyVersions.current.get(ticketId)??0};
    await command(admin?'message.reply':'message.customer',
      {ticketId,revision:selected.revision,body:reply.trim()});
  };
  const status=async(value:Ticket['status'])=>{if(!selected)return;
    await command(admin?'ticket.status':'ticket.resolve',admin?
      {id:selected.id,revision:selected.revision,status:value}:{id:selected.id,revision:selected.revision});
  };
  const claim=async()=>{if(!selected||!admin)return;
    await command('ticket.claim',{id:selected.id,revision:selected.revision,claim:!selected.assignedTo});
  };
  const changeReference=async(kind:'contact'|'message',remove:boolean)=>{
    if(!selected||busy||pending)return;
    const operation=`reference.${kind}.${remove?'unlink':'link'}`;
    const details=remove?{}:kind==='contact'?{contactId:contactReference?.id}:
      {boxId:messageReference?.boxId,messageId:messageReference?.id};
    if(!remove&&Object.values(details).some(value=>!validId(value)))return;
    await command(operation,{ticketId:selected.id,revision:selected.revision,...details});
  };
  const ownScope=scope.current.sessionId===session?.id&&scope.current.audience===audience&&
    scope.current.contextId===props.contextId;
  if(!active||!session||!ownScope)return <div className="p-6 text-sm">Support indisponible pour cette session.</div>;
  return <div className={`mx-auto flex w-full flex-col p-6 ${admin?'max-w-6xl gap-4':'max-w-5xl gap-6'}`}>
    <header className="flex items-center justify-between gap-3"><div>
      <h1 className="text-2xl font-semibold">{admin?'Tickets support':'Support'}</h1>
      <p className="text-sm text-muted-foreground">{admin?'File partagée de ce contexte. Les réponses sont visibles ici par le demandeur.':
        'Une question, un problème ? Ouvrez un ticket ; la réponse apparaît dans ce fil.'}</p></div>
      <button type="button" className={button} onClick={()=>void refresh(epoch.current,query)}>Actualiser</button></header>
    {!admin?<section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <input className={field} maxLength={240} aria-label="Sujet du ticket"
        placeholder="Sujet (ex. : impossible d'imprimer les commandes)"
        value={subject} onChange={event=>{subjectVersion.current++;setSubject(event.target.value);}}/>
      <textarea className={`${field} min-h-24`} maxLength={4000} aria-label="Description du ticket"
        placeholder="Décrivez le problème…" value={body} onChange={event=>{bodyVersion.current++;setBody(event.target.value);}}/>
      <div><button type="button" className={button} disabled={busy||!!pending||!subject.trim()}
        onClick={()=>void create()}>Ouvrir un ticket</button></div></section>:null}
    {error?<p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>:null}
    {pending?<div className="rounded-md border p-3 text-sm" role="status">
      <p>Une modification est en attente de confirmation. Aucune autre modification ne sera envoyée.</p>
      <button type="button" className={`${button} mt-2`} disabled={busy}
        onClick={()=>void inspect()}>Vérifier la dernière modification</button></div>:null}
    <form className="flex gap-2" onSubmit={event=>{event.preventDefault();void refresh(epoch.current,query);}}>
      <input className={field} maxLength={120} aria-label="Rechercher les tickets" placeholder="Rechercher"
        value={query} onChange={event=>setQuery(event.target.value)}/>
      <button className={button} type="submit">Rechercher</button></form>
    <div className={`grid gap-4 ${admin?'lg:grid-cols-[1fr_1.2fr]':'md:grid-cols-2'}`}><div className="flex flex-col gap-2">
      {!admin?<h2 className="text-sm font-medium text-muted-foreground">Mes tickets {loading?'…':`(${tickets.length})`}</h2>:null}
      {loading?<p className="text-sm">Chargement…</p>:null}
      {!loading&&!tickets.length?<p className="rounded-md border p-4 text-sm text-muted-foreground">Aucun ticket.</p>:null}
      {tickets.map(row=><button key={row.id} type="button" onClick={()=>choose(row.id)}
        className={`rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent ${selected?.id===row.id?'border-primary':''}`}>
        <div className="flex justify-between gap-2"><strong className="truncate text-sm">{row.subject}</strong>
          <span className={statusBadge(row.status)}>{statusLabel[row.status]}</span></div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{row.lastPreview??'—'}</div>
        <div className="mt-1 text-xs text-muted-foreground">{date(row.updatedAt)} · {row.messageCount} message(s)</div>
      </button>)}
      {ticketCursor?<button type="button" className={button} disabled={loading} onClick={loadMoreTickets}>Afficher plus</button>:null}
    </div><section className="rounded-lg border bg-card p-4">
      {selected?<><div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">{selected.subject}</h2>
        <p className="text-xs text-muted-foreground">Ouvert le {date(selected.createdAt)} · {statusLabel[selected.status]}</p></div>
        <span className={statusBadge(selected.status)}>{statusLabel[selected.status]}</span></div>
        {admin?<div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button}
          disabled={busy||!!pending||!!selected.assignedTo&&selected.assignedTo!==session.principalId}
          onClick={()=>void claim()}>{selected.assignedTo===session.principalId?'Libérer':'Prendre en charge'}</button>
          {(['ouvert','repondu','resolu','ferme'] as Ticket['status'][]).map(value=><button key={value}
            type="button" className={button} disabled={busy||!!pending||selected.status===value}
            onClick={()=>void status(value)}>{statusLabel[value]}</button>)}</div>:
          selected.status!=='resolu'?<button type="button" className={`${button} mt-3`} disabled={busy||!!pending}
            onClick={()=>void status('resolu')}>Marquer résolu</button>:null}
        <div className={`mt-4 flex flex-col gap-2 overflow-y-auto ${admin?'max-h-[28rem]':'max-h-96'}`}>
          {messages.map(row=><div key={row.id} className={`rounded-md p-2 text-sm ${row.origin==='support'?'bg-primary/10':'bg-muted'}`}>
            <div className="mb-1 text-[11px] text-muted-foreground">{row.origin==='support'?(admin?'Support':'Équipe support'):(admin?'Client':'Vous')} · {date(row.createdAt)}</div>
            <div className="whitespace-pre-wrap">{row.body}</div></div>)}
          {!messages.length&&!threadLoading?<p className="text-sm text-muted-foreground">Aucun message.</p>:null}
          {messageCursor?<button type="button" className={button} disabled={threadLoading}
            onClick={()=>void loadMoreMessages()}>Afficher la suite du fil</button>:null}
        </div>
        <textarea className={`${field} mt-3 min-h-20 w-full`} maxLength={4000} aria-label="Réponse"
          placeholder={admin?'Répondre au client…':'Votre message…'} value={reply}
          onChange={event=>{replyVersions.current.set(selected.id,(replyVersions.current.get(selected.id)??0)+1);
            setReplies(previous=>putReply(previous,selected.id,event.target.value));}}/>
        <button type="button" className={`${button} mt-2`} disabled={busy||!!pending||threadLoading||!reply.trim()}
          onClick={()=>void send()}>{admin?'Enregistrer la réponse':'Envoyer le message'}</button>
        <p className="mt-2 text-xs text-muted-foreground">Fil local partagé. Aucun e-mail externe n’est envoyé.</p>
        <section aria-label="Liens avec les modules" className="mt-4 space-y-3 border-t pt-4 text-sm">
          <h3 className="font-medium">Consulter une référence autorisée</h3>
          <p className="text-xs text-muted-foreground">Références explicites dans le même contexte. Leur lecture dépend des droits CRM ou Messagerie actuels.</p>
          {selected.contactId?<div className="flex items-center gap-2"><span>Contact lié : {selected.contactId}</span>
            <button type="button" className={button} disabled={referenceBusy} onClick={()=>void readReference('reference.contact.read',{contactId:selected.contactId})}>Relire</button>
            <button type="button" className={button} disabled={busy||!!pending} onClick={()=>void changeReference('contact',true)}>Retirer le lien</button></div>:null}
          {selected.messageBoxId&&selected.messageId?<div className="flex items-center gap-2"><span>Message lié : {selected.messageBoxId} / {selected.messageId}</span>
            <button type="button" className={button} disabled={referenceBusy} onClick={()=>void readReference('reference.message.read',
              {boxId:selected.messageBoxId,messageId:selected.messageId})}>Relire</button>
            <button type="button" className={button} disabled={busy||!!pending} onClick={()=>void changeReference('message',true)}>Retirer le lien</button></div>:null}
          <form className="flex gap-2" onSubmit={event=>{event.preventDefault();if(contactTerm.trim())void readReference('reference.contact.search',{query:contactTerm.trim()});}}>
            <input className={`${field} min-w-0 flex-1`} aria-label="Rechercher un contact CRM" maxLength={120}
              value={contactTerm} onChange={event=>setContactTerm(event.target.value)} placeholder="Nom du contact"/>
            <button type="submit" className={button} disabled={referenceBusy||!contactTerm.trim()}>Chercher</button>
          </form>
          {contacts.length>0?<div className="flex flex-wrap gap-2">{contacts.map(item=><button key={item.id} type="button"
            className={button} disabled={referenceBusy} onClick={()=>void readReference('reference.contact.read',{contactId:item.id})}>
            {item.name}{item.email?` · ${item.email}`:''}</button>)}</div>:null}
          {contactReference?<div role="status" className="flex items-center gap-2"><span>Contact : {contactReference.name}{contactReference.email?` · ${contactReference.email}`:''}</span>
            <button type="button" className={button} disabled={busy||!!pending} onClick={()=>void changeReference('contact',false)}>Lier au ticket</button></div>:null}
          <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();
            if(validId(referenceBox)&&validId(referenceMessage))void readReference('reference.message.read',
              {boxId:referenceBox,messageId:referenceMessage});}}>
            <input className={`${field} min-w-0 flex-1`} aria-label="Identifiant de boîte" maxLength={128}
              value={referenceBox} onChange={event=>setReferenceBox(event.target.value)} placeholder="ID de boîte"/>
            <input className={`${field} min-w-0 flex-1`} aria-label="Identifiant de message" maxLength={128}
              value={referenceMessage} onChange={event=>setReferenceMessage(event.target.value)} placeholder="ID de message"/>
            <button type="submit" className={button} disabled={referenceBusy||!validId(referenceBox)||!validId(referenceMessage)}>Lire</button>
          </form>
          {messageReference?<div role="status" className="rounded-md border p-2"><strong>{messageReference.subject||'(sans objet)'}</strong>
            <p>De {messageReference.from}</p><p className="whitespace-pre-wrap">{messageReference.text}</p>
            <button type="button" className={button} disabled={busy||!!pending} onClick={()=>void changeReference('message',false)}>Lier au ticket</button></div>:null}
        </section>
      </>:<p className="text-sm text-muted-foreground">Sélectionnez un ticket pour voir la conversation.</p>}
    </section></div>
  </div>;
}
