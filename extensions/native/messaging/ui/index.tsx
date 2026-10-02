'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type ChangeEvent} from 'react';
import {Paperclip,Save,Send,X} from 'lucide-react';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {createCommandJournal,readPendingCommand} from '@creezio/sdk/operations/command-journal';
import type {PendingCommand,CommandOutcome} from '@creezio/sdk/operations/command-journal';
import type {OperationClientResult} from '@creezio/sdk/operations/client';
import {createFileClient} from '@creezio/sdk/files/client';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import {call,readableError,folders,scopeChanged,messagingPanelData,panelMatchesScope,createLatestRequest,attachmentRevision,type Attachment,type Box,type Draft,type Folder,type Message,type InboundSnapshot,
  type Outcome,type Page,type UiIdentity} from './contracts.ts';
import {FoldersPanel,ListPanel,ReaderPanel,RecipientsInput,messagingButton,messagingField} from './presentation.tsx';
import {RichEditor} from './rich-editor.tsx';

type Editor = {id:string|null;revision:number;to:string;cc:string;bcc:string;subject:string;text:string;html:string};
const blank:Editor={id:null,revision:0,to:'',cc:'',bcc:'',subject:'',text:'',html:''};
const validId=(id:string)=>/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
const page=<T,>(value:unknown):Page<T>=>{
  const row=value as {items?:unknown;nextCursor?:unknown}|null;
  if(!row||!Array.isArray(row.items))throw new Error('invalid_response');
  return {items:row.items as T[],nextCursor:typeof row.nextCursor==='string'?row.nextCursor:null};
};
const draftFrom=(item:Draft):Editor=>({id:item.id,revision:item.revision,to:item.to,cc:item.cc,
  bcc:item.bcc,subject:item.subject,text:item.text,html:item.html});
function requestKey(){return crypto.randomUUID();}

/** Original three-pane mail workspace, bound to the shared messaging operations. */
export function MessagingView(props:RuntimeViewProps) {
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
  const enabled=props.active&&props.authorized&&!!sessionId;
  const scopeKey=JSON.stringify([sessionId,props.audience,props.contextId]);
  const [hydratedScope,setHydratedScope]=useState('');
  const [boxes,setBoxes]=useState<Box[]>([]);
  const [boxId,setBoxId]=useState('');
  const [folder,setFolder]=useState<Folder>('inbox');
  const [messages,setMessages]=useState<Message[]>([]);
  const [drafts,setDrafts]=useState<Draft[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [message,setMessage]=useState<Message|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [attachments,setAttachments]=useState<Attachment[]>([]);
  const [query,setQuery]=useState('');
  const [unreadOnly,setUnreadOnly]=useState(false);
  const [busy,setBusy]=useState(false);
  const [pending,setPending]=useState<PendingCommand|null>(null);
  const [sendFollowup,setSendFollowup]=useState<PendingCommand|null>(null);
  const [inboundInput,setInboundInput]=useState('');
  const [inboundSnapshot,setInboundSnapshot]=useState<InboundSnapshot|null>(null);
  const [inboundLoading,setInboundLoading]=useState(false);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const [composer,setComposer]=useState(false);
  const [editor,setEditor]=useState<Editor>(blank);
  const [showCc,setShowCc]=useState(false);
  const [composerSeed,setComposerSeed]=useState(0);
  const [newBox,setNewBox]=useState(false);
  const [boxName,setBoxName]=useState('');
  const [boxAddress,setBoxAddress]=useState('');
  const [widths,setWidths]=useState<[number,number]>([17,31]);
  const [thread,setThread]=useState<Message[]>([]);
  const [threadCursor,setThreadCursor]=useState<string|null>(null);
  const [threadLoading,setThreadLoading]=useState(false);
  const [listRevision,setListRevision]=useState(0);
  const [selectionRevision,setSelectionRevision]=useState(0);
  const resetScope=useRef<UiIdentity|null>(null);
  const initialPanel=useRef(props.navigation.readPanelState());
  const panelRestored=useRef(false);
  const restoreDraft=useRef<string|null>(null);
  const journal=useRef<ReturnType<typeof createCommandJournal>|null>(null);
  const inboundActive=useRef('');
  const boxSerial=useRef(createLatestRequest()),listSerial=useRef(createLatestRequest());
  const selectionSerial=useRef(createLatestRequest()),threadSerial=useRef(createLatestRequest());
  const selectionIdentity=useRef(createLatestRequest());
  const busySerial=useRef(createLatestRequest());
  const inboundSerial=useRef(createLatestRequest());
  const epoch=useRef(0),prior=useRef({sessionId:'',contextId:'',audience:'',active:false,
    authorized:false,client:null as RuntimeViewProps['client']|null,access:null as RuntimeViewProps['access']|null});
  if(prior.current.sessionId!==sessionId||prior.current.contextId!==props.contextId||
    prior.current.audience!==props.audience||prior.current.active!==props.active||
    prior.current.authorized!==props.authorized||prior.current.client!==props.client||prior.current.access!==props.access){
    epoch.current++;prior.current={sessionId,contextId:props.contextId,audience:props.audience,
      active:props.active,authorized:props.authorized,client:props.client,access:props.access};
  }
  const expectedEpoch=epoch.current;
  const live=useRef({sessionId:'',boxId:'',folder:'inbox' as Folder,query:'',unreadOnly:false,
    selectedId:null as string|null,epoch:0,active:false,authorized:false,contextId:'',audience:'',
    client:null as RuntimeViewProps['client']|null,access:null as RuntimeViewProps['access']|null});
  live.current={sessionId,boxId,folder,query,unreadOnly,selectedId,epoch:expectedEpoch,
    active:props.active,authorized:props.authorized,contextId:props.contextId,audience:props.audience,
    client:props.client,access:props.access};
  const scope={client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};
  const current=()=>live.current.epoch===expectedEpoch&&live.current.active&&live.current.authorized&&
    live.current.contextId===props.contextId&&live.current.audience===props.audience&&
    live.current.client===props.client&&live.current.access===props.access&&
    live.current.sessionId===sessionId&&props.access.getSnapshot().session?.id===sessionId;
  const scoped=(id=boxId)=>current()&&live.current.boxId===id;
  const beginBusy=()=>{const serial=busySerial.current.begin();setBusy(true);return serial;};
  const finishBusy=(serial:number)=>{if(busySerial.current.accepts(serial))setBusy(false);};
  const invalidateReads=()=>{boxSerial.current.invalidate();listSerial.current.invalidate();
    selectionSerial.current.invalidate();threadSerial.current.invalidate();inboundSerial.current.invalidate();
    setLoading(false);setThreadLoading(false);setInboundLoading(false);};
  useRegisterWorkspaceMetadata(props.panelId,{title:'Messagerie',kind:'section',trail:[{label:'Messagerie'},
    ...(boxId?[{label:boxes.find(box=>box.id===boxId)?.name??'Boîte'}]:[])]});

  const loadBoxes=useCallback(async()=>{
    const serial=boxSerial.current.begin();
    const result=await call<Page<Box>>(scope,'box.list',{limit:50},current);
    if(!current()||!boxSerial.current.accepts(serial))return;
    if(result.kind==='ok'){
      try{const items=page<Box>(result.value).items.filter(item=>validId(item.id));setBoxes(items);
        setBoxId(old=>items.some(item=>item.id===old)?old:items[0]?.id??'');}
      catch{setNotice('Réponse des boîtes invalide.');}
    }else setNotice(readableError(result.code));
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{
    const next={sessionId,phase:access.phase,client:props.client,access:props.access,
      audience:props.audience,contextId:props.contextId};
    const changed=scopeChanged(resetScope.current,next);
    if(sessionId||access.phase==='anonymous'||changed||!resetScope.current)resetScope.current=next;
    if(changed){
      restoreDraft.current=null;panelRestored.current=false;initialPanel.current=null;journal.current=null;
      setHydratedScope('');
      setPending(null);setBoxes([]);setBoxId('');setFolder('inbox');setMessages([]);setDrafts([]);setSelectedId(null);
      setSendFollowup(null);
      inboundActive.current='';setInboundInput('');setInboundSnapshot(null);setInboundLoading(false);
      setMessage(null);setDraft(null);setAttachments([]);setThread([]);setThreadCursor(null);
      setQuery('');setUnreadOnly(false);setNewBox(false);setBoxName('');setBoxAddress('');
      setComposer(false);setEditor(blank);setNotice('');
    }
    if(!sessionId)return;
    if(!panelRestored.current){
      const saved=props.navigation.readPanelState()??initialPanel.current;
      const matching=panelMatchesScope(saved?.data,{sessionId,audience:props.audience,contextId:props.contextId});
      const data=matching?saved?.data:undefined;
      const restoredBox=data?.boxId,restoredDraft=data?.draftId,
        restoredFolder=matching?saved?.activeSubview:undefined;
      inboundActive.current=typeof data?.inboundEmailId==='string'
        &&validId(data.inboundEmailId)?data.inboundEmailId:'';
      setInboundInput(inboundActive.current);
      if(typeof restoredBox==='string'&&validId(restoredBox))setBoxId(restoredBox);
      if(folders.some(item=>item.id===restoredFolder))setFolder(restoredFolder as Folder);
      if(typeof restoredDraft==='string'&&validId(restoredDraft))restoreDraft.current=restoredDraft;
      journal.current=createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},data?.pending);
      const followup=readPendingCommand(data?.sendFollowup,
        {sessionId,audience:props.audience,contextId:props.contextId});
      setSendFollowup(followup?.intent==='message.send'?followup:null);
      panelRestored.current=true;initialPanel.current=null;
      setPending(journal.current.pending);
      setHydratedScope(scopeKey);
      if(!matching)props.navigation.savePanelState({activeSubview:'inbox',
        data:messagingPanelData({sessionId,audience:props.audience,contextId:props.contextId},'',null,null)});
    }else{setPending(journal.current?.pending??null);setHydratedScope(scopeKey);}
  },[sessionId,access.phase,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{if(enabled)void loadBoxes();},[enabled,sessionId,props.client,props.audience,props.contextId]);
  useEffect(()=>{if(!enabled){setBusy(false);setLoading(false);setThreadLoading(false);}},[enabled]);
  useEffect(()=>{busySerial.current.invalidate();setBusy(false);},[expectedEpoch]);

  const loadList=useCallback(async(append=false)=>{
    if(!scoped()||!boxId)return;
    const serial=listSerial.current.begin();
    const requestedQuery=query,requestedUnread=unreadOnly;
    const listCurrent=()=>scoped(boxId)&&live.current.folder===folder&&
      live.current.query===requestedQuery&&live.current.unreadOnly===requestedUnread&&
      listSerial.current.accepts(serial);
    setLoading(true);
    const operation=folder==='drafts'?'draft.list':'message.list';
    let next=append?cursor:null;const collected:(Draft|Message)[]=[];
    for(let i=0;i<20;i++){
      const result=await call<Page<Draft>|Page<Message>>(scope,operation,{boxId,limit:50,
        ...(folder==='drafts'?{}:{folder,...(folder==='inbox'&&unreadOnly?{unread:true}:{})}),
        ...(query.trim()?{query:query.trim()}:{}),...(next?{cursor:next}:{})},
        listCurrent);
      if(!listCurrent())return;
      if(result.kind!=='ok'){setLoading(false);setNotice(readableError(result.code));return;}
      try{const batch=page<Draft|Message>(result.value);collected.push(...batch.items);next=batch.nextCursor;
        if(!next||collected.length>=20)break;}
      catch{setLoading(false);setNotice('Liste invalide.');return;}
    }
    setLoading(false);setCursor(next);
    if(folder==='drafts')setDrafts(old=>append?[...old,...(collected as Draft[])]:collected as Draft[]);
    else setMessages(old=>append?[...old,...(collected as Message[])]:collected as Message[]);
    if(folder==='drafts'&&restoreDraft.current){setSelectedId(restoreDraft.current);restoreDraft.current=null;}
  },[boxId,folder,cursor,query,unreadOnly,props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{listSerial.current.invalidate();selectionSerial.current.invalidate();
    selectionIdentity.current.invalidate();threadSerial.current.invalidate();
    setLoading(false);setThreadLoading(false);setMessages([]);setDrafts([]);setCursor(null);
    setSelectedId(null);setMessage(null);setDraft(null);setAttachments([]);setThread([]);setThreadCursor(null);
  },[boxId,folder,sessionId]);
  useEffect(()=>{if(enabled&&boxId)void loadList();},[boxId,folder,enabled,sessionId,listRevision]);
  useEffect(()=>{if(enabled&&boxId&&inboundActive.current&&!journal.current?.pending)
    void loadInboundStatus();},[boxId,enabled,sessionId,pending]);
  useEffect(()=>{if(!enabled||!boxId)return;const timer=setTimeout(()=>void loadList(),180);
    return ()=>clearTimeout(timer);},[query,unreadOnly]);

  async function loadInboundStatus(){
    const emailId=inboundActive.current,requestedBox=boxId;
    if(!emailId||!scoped(requestedBox))return;
    const serial=inboundSerial.current.begin();
    const same=()=>scoped(requestedBox)&&inboundActive.current===emailId
      &&inboundSerial.current.accepts(serial);
    setInboundLoading(true);
    try{
      const result=await call<{snapshot:InboundSnapshot}>(scope,'message.inbound.status',
        {boxId:requestedBox,emailId},same);
      if(!same())return;
      if(result.kind==='ok'&&result.value.snapshot?.emailId===emailId)
        setInboundSnapshot(result.value.snapshot);
      else{setInboundSnapshot(null);setNotice(result.kind==='ok'
        ?'État de réception invalide.':readableError(result.code));}
    }finally{if(same())setInboundLoading(false);}
  }

  const loadSelection=useCallback(async(id:string)=>{
    if(!scoped()||!boxId||!validId(id))return;
    selectionIdentity.current.begin();
    const serial=selectionSerial.current.begin();
    const selectionCurrent=()=>scoped(boxId)&&live.current.folder===folder&&
      live.current.selectedId===id&&selectionSerial.current.accepts(serial);
    setLoading(true);setThreadLoading(false);setMessage(null);setDraft(null);setAttachments([]);setThread([]);setThreadCursor(null);
    const operation=folder==='drafts'?'draft.read':'message.read';
    const result=await call<{draft:Draft}|{message:Message}>(scope,operation,
      {boxId,...(folder==='drafts'?{draftId:id}:{messageId:id})},selectionCurrent);
    if(!selectionCurrent())return;
    setLoading(false);
    if(result.kind!=='ok'){setNotice(readableError(result.code));return;}
    if(folder==='drafts'){
      const found=(result.value as {draft?:Draft}).draft;
      if(!found||found.id!==id){setNotice('Brouillon introuvable.');return;}
      setDraft(found);
      const files=await call<Page<Attachment>>(scope,'attachment.list',{boxId,draftId:id,limit:50},selectionCurrent);
      if(selectionCurrent()&&files.kind==='ok')try{setAttachments(page<Attachment>(files.value).items);}catch{setNotice('Pièces jointes invalides.');}
    }else{const found=(result.value as {message?:Message}).message;
      if(!found||found.id!==id){setNotice('Message introuvable.');return;}setMessage(found);
      const files=await call<Page<Attachment>>(scope,'message.attachment.list',
        {boxId,messageId:id,limit:50},selectionCurrent);
      if(selectionCurrent()&&files.kind==='ok')try{setAttachments(page<Attachment>(files.value).items);}
      catch{setNotice('Pièces jointes du message invalides.');}
      else if(selectionCurrent()&&files.kind!=='ok')setNotice(readableError(files.code));
      if(found.threadId){
        const related:Message[]=[];let next:string|null=null;
        for(let i=0;i<20;i++){
          const listed:Outcome<Page<Message>>=await call<Page<Message>>(scope,'message.list',
            {boxId,threadId:found.threadId,limit:50,...(next?{cursor:next}:{})},selectionCurrent);
          if(!selectionCurrent()||listed.kind!=='ok')break;
          const batch:Page<Message>=page<Message>(listed.value);related.push(...batch.items);next=batch.nextCursor;
          if(!next||related.length>=20)break;
        }
        if(selectionCurrent()){setThread(related);setThreadCursor(next);}
      }
      if(found.direction==='inbound'&&!found.read&&!journal.current?.pending){
        const identityToken=selectionIdentity.current.capture();
        const selectedCurrent=()=>scoped(boxId)&&live.current.folder===folder&&
          live.current.selectedId===id&&selectionIdentity.current.accepts(identityToken);
        const marked=await executeMutation<{message:Message}>('message.update',{boxId,
          messageId:id,revision:found.revision,read:true},selectedCurrent,id);
        if(selectedCurrent()&&marked.kind==='ok'&&marked.value.message?.id===id){setMessage(marked.value.message);
          setMessages(rows=>rows.map(row=>row.id===id?marked.value.message:row));}
        else if(selectedCurrent()&&marked.kind!=='ok')setNotice(readableError(marked.code));
      }
    }
  },[boxId,folder,props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{if(selectedId&&enabled)void loadSelection(selectedId);},
    [selectedId,boxId,folder,enabled,sessionId,selectionRevision]);

  async function loadMoreThread(){
    const selected=message,after=threadCursor;if(!selected?.threadId||!after||threadLoading||!scoped())return;
    const serial=threadSerial.current.begin();
    const sameSelection=()=>scoped(boxId)&&live.current.selectedId===selected.id&&threadSerial.current.accepts(serial);
    setThreadLoading(true);let next:string|null=after;const additional:Message[]=[];
    try{for(let i=0;i<20;i++){
        const result=await call<Page<Message>>(scope,'message.list',
          {boxId,threadId:selected.threadId,limit:50,cursor:next},sameSelection);
        if(!sameSelection())return;
        if(result.kind!=='ok'){setNotice(readableError(result.code));break;}
        const batch:Page<Message>=page<Message>(result.value);
        additional.push(...batch.items);next=batch.nextCursor;
        if(!next||additional.length>=20)break;
      }
      if(!sameSelection())return;
      setThread(old=>[...old,...additional.filter(item=>!old.some(existing=>existing.id===item.id))]);
      setThreadCursor(next);
    }finally{if(threadSerial.current.accepts(serial))setThreadLoading(false);}
  }

  function savePosition(nextFolder:Folder,nextBox:string,draftId?:string,nextPending=journal.current?.pending??null,
    nextFollowup=sendFollowup){
    if(!sessionId||live.current.sessionId!==sessionId||live.current.contextId!==props.contextId||
      live.current.audience!==props.audience)return false;
    return props.navigation.savePanelState({activeSubview:nextFolder,
      data:messagingPanelData({sessionId,audience:props.audience,contextId:props.contextId},
        nextBox,draftId??null,nextPending,nextFollowup,inboundActive.current)});
  }
  async function executeMutation<T>(operation:string,input:Record<string,unknown>,isCurrent:()=>boolean,
    targetId?:string):Promise<Outcome<T>|{kind:'queued';value:T;code:string;issued:PendingCommand}>{
    const activeJournal=journal.current;
    if(!activeJournal)return {kind:'rejected',code:'client_state_unavailable'};
    if(activeJournal.pending)return {kind:'unknown',code:'in_progress'};
    const issued:PendingCommand={sessionId,audience:props.audience,contextId:props.contextId,
      bindingId:`creezio.messaging:${props.audience}.${operation}`,requestKey:requestKey(),intent:operation,
      ...(targetId?{targetId}:{})};
    invalidateReads();
    const running=activeJournal.execute(props.client,issued,input,isCurrent,value=>
      savePosition(live.current.folder,live.current.boxId,
        live.current.folder==='drafts'?live.current.selectedId??undefined:undefined,value));
    if(isCurrent())setPending(activeJournal.pending);
    const outcome=await running;
    if(journal.current===activeJournal&&live.current.sessionId===sessionId&&
      live.current.audience===props.audience&&live.current.contextId===props.contextId)
      setPending(outcome.pending);
    if(operation==='message.send'&&outcome.result.kind==='execution'
      &&outcome.result.execution.state==='waiting'){
      const value=outcome.result.execution.output as T;
      if(journal.current===activeJournal&&live.current.sessionId===sessionId){
        const retained=props.navigation.savePanelState({activeSubview:live.current.folder,
          data:messagingPanelData({sessionId,audience:props.audience,contextId:props.contextId},
            live.current.boxId,null,null,issued,inboundActive.current)});
        if(!retained)return {kind:'unknown',code:'client_state_unavailable'};
        setSendFollowup(issued);journal.current=createCommandJournal({sessionId,audience:props.audience,
          contextId:props.contextId});setPending(null);invalidateReads();
      }
      return {kind:'queued',value,code:'waiting',issued};
    }
    if(operation!=='message.send'&&outcome.result.kind==='execution'&&outcome.result.execution.state==='waiting')
      return {kind:'unknown',code:'in_progress'};
    if(outcome.pending)return {kind:'unknown',code:'in_progress'};
    if(outcome.result.kind==='rejected'||outcome.result.kind==='unknown')
      return {kind:outcome.result.kind,code:outcome.result.code};
    if(outcome.result.execution.state!=='succeeded')return {kind:'rejected',
      code:outcome.result.execution.errorCode??'unavailable'};
    if(journal.current===activeJournal&&live.current.sessionId===sessionId)invalidateReads();
    return {kind:'ok',value:outcome.result.execution.output as T};
  }
  async function inspectPending(){
    const activeJournal=journal.current,issued=activeJournal?.pending;
    if(!activeJournal||!issued||busy||!current())return;
    const busyToken=beginBusy();setNotice('');
    try{
      const outcome:CommandOutcome|null=await activeJournal.inspect(props.client,current,value=>
        savePosition(live.current.folder,live.current.boxId,
          live.current.folder==='drafts'?live.current.selectedId??undefined:undefined,value));
      if(!current())return;
      setPending(outcome?.pending??null);
      if(!outcome)return;
      if(issued.intent==='message.send'&&outcome.result.kind==='execution'
        &&outcome.result.execution.state==='waiting'){
        if(!savePosition(live.current.folder,live.current.boxId,undefined,null,issued)){
          setNotice('État local indisponible ; conservez la clé de suivi et relisez la file d’attente.');return;
        }
        setSendFollowup(issued);journal.current=createCommandJournal({sessionId,audience:props.audience,
          contextId:props.contextId});setPending(null);
        setListRevision(value=>value+1);
        setNotice('Intention durable enregistrée ; le message est en file d’attente.');return;
      }
      if(outcome.pending){setNotice('Résultat encore incertain. La clé reste conservée ; aucune commande n’a été rejouée.');return;}
      if(outcome.result.kind!=='execution'||outcome.result.execution.state!=='succeeded'){
        setNotice('La modification n’a pas été confirmée. Relisez les données avant de poursuivre.');return;}
      invalidateReads();
      const raw=outcome.result.execution.output;
      const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
      if(value?.draft&&typeof value.draft==='object'){
        const found=value.draft as Draft;
        if(editor.id===found.id||issued.intent==='draft.create'&&composer&&!editor.id)
          setEditor(old=>({...old,id:found.id,revision:found.revision}));
        if(live.current.selectedId===found.id)setDraft(found);
      }
      if(value?.message&&typeof value.message==='object'){
        const found=value.message as Message;
        if(live.current.selectedId===found.id)setMessage(found);
      }
      if(issued.intent==='draft.delete'&&live.current.selectedId===issued.targetId)setSelectedId(null);
      if(issued.intent==='message.delete'){
        if(value?.deleted===true&&live.current.selectedId===issued.targetId){
          setSelectedId(null);setMessage(null);setAttachments([]);
        }else if(value?.deleted===false&&Number.isSafeInteger(value.revision)
          &&live.current.selectedId===issued.targetId){
          setMessage(old=>old&&old.id===issued.targetId?{...old,revision:Number(value.revision)}:old);
          setSelectionRevision(number=>number+1);
          setListRevision(number=>number+1);
          setNotice('Suppression partielle confirmée. Relisez le message puis poursuivez la suppression.');
          return;
        }
      }
      if(issued.intent==='box.create'){
        const created=value?.box as Box|undefined;
        await loadBoxes();if(!current())return;
        setNewBox(false);setBoxName('');setBoxAddress('');
        if(created&&validId(created.id)&&(!issued.targetId||live.current.boxId===issued.targetId))chooseBox(created.id);
      }else if(live.current.boxId)setListRevision(value=>value+1);
      if(live.current.selectedId)setSelectionRevision(value=>value+1);
      setNotice('Modification confirmée. Liste actualisée ; relisez le détail si nécessaire.');
    }finally{finishBusy(busyToken);}
  }
  async function inspectSendFollowup(){
    const issued=sendFollowup;if(!issued||busy||!current())return;
    const busyToken=beginBusy();
    try{
      const result:OperationClientResult=await props.client.status({bindingId:issued.bindingId,
        contextId:issued.contextId,requestKey:issued.requestKey,isCurrent:current});
      if(!current())return;
      if(result.kind!=='execution'){setNotice('Statut incertain ; relisez la file d’attente avant toute reprise.');return;}
      const state=result.execution.state;
      if(state==='waiting'){setNotice('Intention d’envoi toujours en attente ; aucune réémission lancée.');return;}
      setSendFollowup(null);savePosition(live.current.folder,live.current.boxId,undefined,null,null);
      setListRevision(value=>value+1);
      setNotice(state==='succeeded'?'Acceptation fournisseur confirmée ; vérifiez les accusés.':
        state==='unknown'?'Résultat de transport inconnu ; aucune réémission automatique.':
        'Envoi non confirmé ; le brouillon est conservé.');
    }finally{finishBusy(busyToken);}
  }
  function chooseFolder(next:Folder){if(next===folder)return;invalidateReads();selectionIdentity.current.invalidate();
    setFolder(next);savePosition(next,boxId);}
  function chooseBox(next:string){if(next===boxId)return;invalidateReads();selectionIdentity.current.invalidate();
    inboundActive.current='';setInboundInput('');setInboundSnapshot(null);
    setBoxId(next);savePosition(folder,next);}
  function chooseItem(next:string){selectionSerial.current.invalidate();selectionIdentity.current.invalidate();
    threadSerial.current.invalidate();setThreadLoading(false);
    setSelectedId(next);savePosition(folder,boxId,folder==='drafts'?next:undefined);}
  function beginResize(event:React.PointerEvent<HTMLDivElement>,index:0|1){
    const parent=event.currentTarget.parentElement;if(!parent)return;
    const rect=parent.getBoundingClientRect(),start=event.clientX,original=widths;
    const move=(e:PointerEvent)=>{const delta=(e.clientX-start)/rect.width*100;
      setWidths(index===0?[Math.max(12,Math.min(28,original[0]+delta)),original[1]]:
        [original[0],Math.max(22,Math.min(45,original[1]+delta))]);};
    const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});
  }
  function openCompose(initial:Editor=blank){if(busy||journal.current?.pending){setNotice('Vérifiez la dernière modification avant une nouvelle rédaction.');return;}
    setEditor(initial);if(!initial.id)setAttachments([]);
    setShowCc(!!initial.cc||!!initial.bcc);setComposerSeed(seed=>seed+1);setComposer(true);setNotice('');}
  function reply(){if(!message)return;
    const quoted=message.text?.trim();openCompose({...blank,to:message.replyTo||message.from,
      subject:/^re\s*:/i.test(message.subject)?message.subject:`Re: ${message.subject}`,
      text:quoted?`\n\n----- ${message.from} a écrit -----\n${quoted}`:''});}
  async function saveDraft(){
    if(!boxId||busy||!current())return;const busyToken=beginBusy();setNotice('');
    try{
      let id=editor.id,revision=editor.revision;
      if(!id){const created=await executeMutation<{draft:Draft}>('draft.create',{boxId},()=>scoped(boxId),boxId);
        if(!scoped(boxId))return;
        if(created.kind!=='ok'){setNotice(readableError(created.code));return;}
        id=created.value.draft?.id;revision=created.value.draft?.revision;
        if(!id||!Number.isInteger(revision)){setNotice('Création du brouillon non confirmée. Vérifiez les brouillons.');return;}
        setEditor(old=>({...old,id,revision}));
      }
      const saved=await executeMutation<{draft:Draft}>('draft.save',{boxId,draftId:id,
        revision,to:editor.to,cc:editor.cc,bcc:editor.bcc,subject:editor.subject,text:editor.text,html:editor.html},
        ()=>scoped(boxId),id);
      if(!scoped(boxId))return;
      if(saved.kind!=='ok'){setNotice(readableError(saved.code));return;}
      if(!saved.value.draft?.id){setNotice('Sauvegarde non confirmée.');return;}
      const savedId=saved.value.draft.id;
      setEditor(draftFrom(saved.value.draft));setComposer(false);
      if(live.current.folder!=='drafts'){
        restoreDraft.current=savedId;setFolder('drafts');savePosition('drafts',boxId,savedId);
      }else{
        if(live.current.selectedId===savedId)setDraft(saved.value.draft);
        setSelectedId(savedId);savePosition('drafts',boxId,savedId);void loadList();
      }
      setNotice('Brouillon enregistré.');
    }finally{finishBusy(busyToken);}
  }
  async function sendDraft(){
    if(!editor.id||!boxId||busy||!current()||journal.current?.pending)return;
    if(sendFollowup){setNotice('Vérifiez l’intention d’envoi précédente avant une autre demande.');return;}
    if(!draft||draft.id!==editor.id||draft.sendIntentId){
      setNotice('Relisez le brouillon avant l’envoi ; une intention existe peut-être déjà.');return;
    }
    if(editor.revision!==draft.revision||editor.to!==draft.to||editor.cc!==draft.cc||editor.bcc!==draft.bcc
      ||editor.subject!==draft.subject||editor.text!==draft.text||editor.html!==draft.html){
      setNotice('Enregistrez les modifications du brouillon avant de l’envoyer.');return;
    }
    if(attachments.length>50||attachments.reduce((total,item)=>total+item.byteSize,0)>10*1024*1024){
      setNotice('L’envoi accepte au plus 50 pièces jointes et 10 Mio au total. Le brouillon est conservé.');return;
    }
    const selected=editor.id,busyToken=beginBusy();setNotice('');
    try{
      const result=await executeMutation<{message:Message;draft:Draft}>('message.send',
        {boxId,draftId:selected,revision:editor.revision},()=>scoped(boxId),selected);
      if(!scoped(boxId))return;
      if(result.kind!=='queued'){
        setNotice(result.kind==='ok'?'Statut d’envoi inattendu ; relisez la file d’attente.':readableError(result.code));return;
      }
      setComposer(false);setEditor(draftFrom(result.value.draft));setDraft(result.value.draft);
      setFolder('outbox');setSelectedId(result.value.message.id);
      savePosition('outbox',boxId,undefined,null,result.issued);setListRevision(value=>value+1);
      setNotice('Intention durable enregistrée. Le message reste en file d’attente jusqu’à confirmation du fournisseur.');
    }finally{finishBusy(busyToken);}
  }
  async function updateMessage(change:{folder?:Folder;read?:boolean}){
    if(!message||busy||!scoped())return;const prior=message,busyToken=beginBusy();
    try{const result=await executeMutation<{message:Message}>('message.update',{boxId,
        messageId:prior.id,revision:prior.revision,...change},()=>scoped(boxId),prior.id);
      if(!scoped(boxId))return;
      if(result.kind!=='ok'){setNotice(readableError(result.code));return;}
      if(!result.value.message){setNotice('Modification non confirmée.');return;}
      setMessage(result.value.message);setMessages(rows=>rows.map(row=>row.id===prior.id?result.value.message:row));
      if(change.folder&&change.folder!==folder){setSelectedId(null);void loadList();}
    }finally{finishBusy(busyToken);}
  }
  async function reconcileDelivery(){
    if(!message||message.direction!=='outbound'||busy||!scoped())return;
    const prior=message,busyToken=beginBusy();
    try{const result=await executeMutation<{message:Message}>('message.delivery.reconcile',{
      boxId,messageId:prior.id,revision:prior.revision},()=>scoped(boxId),prior.id);
      if(!scoped(boxId))return;
      if(result.kind!=='ok'||!result.value.message){setNotice(result.kind==='unknown'
        ?'Statut incertain ; vérifiez la dernière modification.':'Rapprochement refusé ou indisponible.');return;}
      setMessage(result.value.message);
      setMessages(rows=>rows.map(row=>row.id===prior.id?result.value.message:row));
      setNotice(result.value.message.state===prior.state?'Aucun nouvel accusé signé.':'Livraison rapprochée.');
    }finally{finishBusy(busyToken);}
  }
  async function deleteDraft(){if(!draft||busy||!scoped())return;const busyToken=beginBusy();
    try{const result=await executeMutation<{deleted:boolean}>('draft.delete',{boxId,
        draftId:draft.id,revision:draft.revision},()=>scoped(boxId),draft.id);
      if(!scoped(boxId))return;
      if(result.kind!=='ok'||!result.value.deleted){setNotice(result.kind==='ok'?'Suppression non confirmée.':readableError(result.code));return;}
      setSelectedId(null);setDraft(null);void loadList();
    }finally{finishBusy(busyToken);}
  }
  async function deleteMessage(){
    const selected=message,selectedBox=boxId;
    if(!selected||busy||!scoped(selectedBox)||folder!=='trash')return;
    if(selected.direction!=='inbound'){
      setNotice('L’historique d’envoi et ses accusés sont conservés.');return;
    }
    const same=()=>scoped(selectedBox)&&live.current.folder==='trash'
      &&live.current.selectedId===selected.id;
    let revision=selected.revision;
    const busyToken=beginBusy();setNotice('Suppression en cours…');
    try{
      for(let step=0;step<4;step++){
        if(!same())return;
        const result=await executeMutation<{deleted:boolean;revision:number|null;removed:number}>(
          'message.delete',{boxId:selectedBox,messageId:selected.id,revision},same,selected.id);
        if(!same())return;
        if(result.kind!=='ok'){
          setNotice(result.kind==='unknown'
            ?'Résultat de suppression incertain. Vérifiez la dernière modification avant de poursuivre.'
            :readableError(result.code));return;
        }
        if(result.value.deleted){
          setSelectedId(null);setMessage(null);setAttachments([]);setThread([]);
          setListRevision(number=>number+1);setNotice('Message local supprimé ; pièces privées détachées.');return;
        }
        if(typeof result.value.revision!=='number'||!Number.isSafeInteger(result.value.revision)
          ||result.value.revision<=revision
          ||result.value.removed<1){setNotice('Progression invalide ; relisez le message.');return;}
        revision=result.value.revision;
        setMessage(old=>old&&old.id===selected.id?{...old,revision}:old);
        setNotice(`Suppression en cours : ${step+1} lot(s) confirmé(s)…`);
      }
      setSelectionRevision(number=>number+1);
      setListRevision(number=>number+1);
      setNotice('Suppression partielle confirmée. Relisez le message puis poursuivez la suppression.');
    }finally{finishBusy(busyToken);}
  }
  async function unlinkFile(item:Attachment){if(!editor.id||busy||!scoped())return;const busyToken=beginBusy();
    try{const result=await executeMutation<{draft:Draft;removed:boolean}>('attachment.unlink',{boxId,
        draftId:editor.id,revision:editor.revision,fileId:item.fileId},()=>scoped(boxId),editor.id);
      if(!scoped(boxId))return;
      if(result.kind!=='ok'||!result.value.removed){setNotice(result.kind==='ok'?'Retrait non confirmé.':readableError(result.code));return;}
      setEditor(old=>attachmentRevision(old,result.value.draft));setAttachments(list=>list.filter(file=>file.fileId!==item.fileId));
    }finally{finishBusy(busyToken);}
  }
  async function createBox(){if(!current()||busy||!boxName.trim())return;
    const busyToken=beginBusy();
    try{const result=await executeMutation<{box:Box}>('box.create',
        {name:boxName.trim(),address:boxAddress.trim()},current,boxId||undefined);
      if(!current())return;
      if(result.kind==='ok'&&result.value.box?.id){setNewBox(false);setBoxName('');setBoxAddress('');
        await loadBoxes();if(!current())return;chooseBox(result.value.box.id);}
      else setNotice(result.kind==='ok'?'Création non confirmée.':readableError(result.code));
    }finally{finishBusy(busyToken);}}
  async function prepareInbound(){
    const emailId=inboundInput.trim(),requestedBox=boxId;
    if(!scoped(requestedBox)||busy||journal.current?.pending)return;
    if(!emailId||emailId.length>128||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(emailId)){
      setNotice('Saisissez un identifiant de courriel valide.');return;
    }
    const busyToken=beginBusy();setNotice('');setInboundSnapshot(null);
    inboundActive.current=emailId;savePosition(folder,requestedBox);
    try{
      const result=await executeMutation<{snapshot:InboundSnapshot}>('message.inbound.prepare',
        {boxId:requestedBox,emailId},()=>scoped(requestedBox)&&inboundActive.current===emailId,
        emailId);
      if(!scoped(requestedBox)||inboundActive.current!==emailId)return;
      if(result.kind!=='ok'||result.value.snapshot?.emailId!==emailId){
        setNotice(result.kind==='ok'?'Préparation non confirmée.':readableError(result.code));return;
      }
      setInboundSnapshot(result.value.snapshot);
      setNotice('Courriel préparé. Vérifiez les pièces avant l’import.');
    }finally{finishBusy(busyToken);}
  }
  async function stageInbound(childId:string){
    const emailId=inboundSnapshot?.emailId,requestedBox=boxId;
    if(!emailId||!scoped(requestedBox)||busy||journal.current?.pending)return;
    const busyToken=beginBusy();setNotice('');
    try{
      const result=await executeMutation<{childId:string;fileId:string;staged:boolean}>(
        'message.inbound.attachment.stage',{boxId:requestedBox,emailId,childId},
        ()=>scoped(requestedBox)&&inboundActive.current===emailId,childId);
      if(!scoped(requestedBox)||inboundActive.current!==emailId)return;
      if(result.kind!=='ok'||result.value.childId!==childId||!result.value.staged){
        setNotice(result.kind==='ok'?'Pièce non confirmée.':readableError(result.code));return;
      }
      await loadInboundStatus();
      if(scoped(requestedBox)&&inboundActive.current===emailId)setNotice('Pièce vérifiée et préparée.');
    }finally{finishBusy(busyToken);}
  }
  async function importInbound(){
    const snapshot=inboundSnapshot,requestedBox=boxId;
    if(!snapshot||snapshot.imported||snapshot.attachments.length!==snapshot.stagedChildIds.length
      ||!scoped(requestedBox)||busy||journal.current?.pending)return;
    const emailId=snapshot.emailId,busyToken=beginBusy();setNotice('');
    try{
      const result=await executeMutation<{message:Message}>('message.inbound.import',
        {boxId:requestedBox,emailId},()=>scoped(requestedBox)&&inboundActive.current===emailId,
        emailId);
      if(!scoped(requestedBox)||inboundActive.current!==emailId)return;
      if(result.kind!=='ok'||result.value.message?.direction!=='inbound'){
        setNotice(result.kind==='ok'?'Import non confirmé.':readableError(result.code));return;
      }
      await loadInboundStatus();
      if(!scoped(requestedBox)||inboundActive.current!==emailId)return;
      setFolder('inbox');setSelectedId(result.value.message.id);savePosition('inbox',requestedBox);
      setListRevision(value=>value+1);setNotice('Message et pièces jointes importés.');
    }finally{finishBusy(busyToken);}
  }
  async function uploadFile(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value='';
    if(!file||!editor.id||!boxId||busy||journal.current?.pending)return;
    const busyToken=beginBusy();setNotice(`Téléversement de ${file.name}…`);
    try{const files=createFileClient({access:props.access,moduleId:'creezio.messaging',categoryId:'attachments',contextId:props.contextId});
      const uploaded=await files.upload({file,filename:file.name,intentId:requestKey(),isCurrent:()=>scoped(boxId)});
      if(!scoped(boxId))return;
      if(uploaded.kind!=='ready'){setNotice('Téléversement non confirmé. Vérifiez le brouillon avant un nouvel essai.');return;}
      const linked=await executeMutation<{draft:Draft}>('attachment.link',{boxId,draftId:editor.id,
        revision:editor.revision,staged:uploaded.value.reference},()=>scoped(boxId),editor.id);
      if(!scoped(boxId))return;
      if(linked.kind!=='ok'){setNotice(readableError(linked.code));return;}
      if(linked.value.draft){setEditor(old=>attachmentRevision(old,linked.value.draft));const listed=await call<Page<Attachment>>(scope,'attachment.list',
        {boxId,draftId:editor.id,limit:50},()=>scoped(boxId));if(!scoped(boxId))return;
        if(listed.kind==='ok')setAttachments(page<Attachment>(listed.value).items);}
      setNotice(`${file.name} joint au brouillon.`);
    }finally{finishBusy(busyToken);}
  }
  async function downloadFile(item:Attachment){
    const files=createFileClient({access:props.access,moduleId:'creezio.messaging',categoryId:'attachments',contextId:props.contextId});
    const result=await files.download(item.reference,()=>scoped(boxId));
    if(!scoped(boxId))return;
    if(result.kind!=='ready'){setNotice('Téléchargement indisponible.');return;}
    const url=URL.createObjectURL(result.value),link=document.createElement('a');
    link.href=url;link.download=item.filename;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  if(!enabled)return <div className="rounded-md border p-6 text-sm">Messagerie indisponible pour cette session.</div>;
  if(hydratedScope!==scopeKey)return <div className="rounded-md border p-6 text-sm">Chargement de la messagerie…</div>;
  return <div className="flex h-[calc(100vh-8.5rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[#e6e0d4] bg-white/80 shadow-sm">
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      <span>L’import d’un courriel reçu demande une preuve Resend et une boîte autorisée. L’envoi exige aussi un transport autorisé.</span>
      <button type="button" className={messagingButton} disabled={!!pending||busy} onClick={()=>setNewBox(true)}>Nouvelle boîte</button>
    </div>
    {notice&&<div role="alert" className="border-b border-[#ebe4d8] px-4 py-2 text-sm text-[#3a4158]">{notice}</div>}
    {pending&&<div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      <span>Une modification attend confirmation. Les autres modifications sont bloquées.</span>
      <button type="button" disabled={busy} className={messagingButton} onClick={()=>void inspectPending()}>Vérifier la dernière modification</button>
    </div>}
    {sendFollowup&&<div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      <span>Une intention d’envoi attend un accusé. La boîte reste utilisable ; n’envoyez pas à nouveau ce brouillon.</span>
      <button type="button" disabled={busy} className={messagingButton} onClick={()=>void inspectSendFollowup()}>Vérifier l’envoi</button>
    </div>}
    {boxId&&<section aria-label="Importer un courriel reçu" className="border-b border-[#ebe4d8] bg-[#fcfbf8] px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="messaging-inbound-id" className="font-medium">Courriel reçu</label>
        <input id="messaging-inbound-id" className={`${messagingField} max-w-xs`} placeholder="Identifiant du courriel Resend"
          value={inboundInput} disabled={busy||!!pending} onChange={event=>setInboundInput(event.target.value)}/>
        <button type="button" className={messagingButton} disabled={busy||!!pending||!inboundInput.trim()}
          onClick={()=>void prepareInbound()}>Préparer</button>
        {inboundLoading&&<span role="status">Lecture de la préparation…</span>}
      </div>
      {inboundSnapshot&&<div className="mt-2 flex flex-wrap items-center gap-2">
        <span>{inboundSnapshot.subject||'(sans objet)'} · {inboundSnapshot.from} · {inboundSnapshot.attachments.length} pièce(s)</span>
        {inboundSnapshot.attachments.map(item=><button key={item.id} type="button" className={messagingButton}
          disabled={busy||!!pending||inboundSnapshot.imported||inboundSnapshot.stagedChildIds.includes(item.id)}
          onClick={()=>void stageInbound(item.id)}>
          {inboundSnapshot.stagedChildIds.includes(item.id)?'Préparée':`Préparer ${item.filename}`}
        </button>)}
        <button type="button" className={messagingButton} disabled={busy||!!pending||inboundSnapshot.imported
          ||inboundSnapshot.attachments.length!==inboundSnapshot.stagedChildIds.length}
          onClick={()=>void importInbound()}>{inboundSnapshot.imported?'Importé':'Importer'}</button>
      </div>}
    </section>}
    <div className="flex min-h-0 flex-1" style={{gridTemplateColumns:`${widths[0]}% ${widths[1]}% 1fr`}}>
      <div style={{width:`${widths[0]}%`}} className="min-w-0"><FoldersPanel boxes={boxes} boxId={boxId} folder={folder} onBox={chooseBox} onFolder={chooseFolder} onCompose={()=>openCompose()} unread={messages.filter(item=>item.direction==='inbound'&&!item.read).length}/></div>
      <div role="separator" aria-orientation="vertical" onPointerDown={event=>beginResize(event,0)} className="w-1 cursor-col-resize bg-[#ebe4d8] hover:bg-sky-300"/>
      <div style={{width:`${widths[1]}%`}} className="min-w-0"><ListPanel folder={folder} messages={messages} drafts={drafts} selectedId={selectedId} query={query} onQuery={setQuery} unreadOnly={unreadOnly} onUnreadOnly={setUnreadOnly} onSelect={chooseItem} onRefresh={()=>void loadList()} loading={loading} hasMore={!!cursor} onMore={()=>void loadList(true)}/></div>
      <div role="separator" aria-orientation="vertical" onPointerDown={event=>beginResize(event,1)} className="w-1 cursor-col-resize bg-[#ebe4d8] hover:bg-sky-300"/>
      <div className="min-w-0 flex-1"><ReaderPanel message={message} draft={draft} thread={thread} threadHasMore={!!threadCursor} threadLoading={threadLoading} onThreadMore={()=>void loadMoreThread()} onThreadSelect={chooseItem} attachments={attachments} loading={loading} busy={busy||!!pending} onReply={reply} onEdit={()=>draft&&openCompose(draftFrom(draft))} onDownload={item=>void downloadFile(item)} onUpdate={change=>void updateMessage(change)} onReconcile={()=>void reconcileDelivery()} onDeleteDraft={()=>void deleteDraft()} onDeleteMessage={()=>void deleteMessage()}/></div>
    </div>
    {newBox&&<div role="dialog" aria-modal="true" aria-label="Nouvelle boîte" className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4"><div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
      <div className="flex justify-between"><h2 className="font-semibold">Nouvelle boîte locale</h2><button type="button" onClick={()=>setNewBox(false)} aria-label="Fermer"><X size={18}/></button></div>
      <p className="text-sm text-[#5c6478]">L’adresse est facultative et sert de repère. Elle ne connecte pas un fournisseur de messagerie.</p>
      <input className={messagingField} placeholder="Nom de la boîte" value={boxName} disabled={busy||!!pending} onChange={e=>setBoxName(e.target.value)}/>
      <input className={messagingField} type="email" placeholder="Adresse facultative" value={boxAddress} disabled={busy||!!pending} onChange={e=>setBoxAddress(e.target.value)}/>
      <button type="button" disabled={busy||!!pending} className={messagingButton} onClick={()=>void createBox()}>Créer la boîte</button>
    </div></div>}
    {composer&&<div role="dialog" aria-modal="true" aria-label="Rédiger un message" className="absolute inset-0 z-30 flex items-end justify-center bg-black/35 p-4"><div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-[#fcfbf8] shadow-xl">
      <header className="flex items-center justify-between border-b border-[#ebe4d8] px-5 py-3"><h2 className="font-semibold">{editor.id?'Modifier le brouillon':'Nouveau message'}</h2>
        <button type="button" aria-label="Fermer" onClick={()=>setComposer(false)}><X size={18}/></button></header>
      <div className="space-y-3 overflow-y-auto p-5"><RecipientsInput label="À" value={editor.to} onChange={to=>setEditor(old=>({...old,to}))} disabled={busy||!!pending}/>
        {showCc&&<><RecipientsInput label="Cc" value={editor.cc} onChange={cc=>setEditor(old=>({...old,cc}))} disabled={busy||!!pending}/><RecipientsInput label="Cci" value={editor.bcc} onChange={bcc=>setEditor(old=>({...old,bcc}))} disabled={busy||!!pending}/></>}
        {!showCc&&<button type="button" disabled={busy||!!pending} className="text-xs text-sky-700" onClick={()=>setShowCc(true)}>Ajouter Cc / Cci</button>}
        <input aria-label="Objet" placeholder="Objet" className={messagingField} value={editor.subject} disabled={busy||!!pending} onChange={e=>setEditor(old=>({...old,subject:e.target.value}))}/>
        <RichEditor key={composerSeed} initialHtml={editor.html} initialText={editor.text} disabled={busy||!!pending}
          onChange={(html,text)=>setEditor(old=>({...old,html,text}))}/>
        {editor.id&&<label className={`${messagingButton} inline-flex cursor-pointer items-center gap-2`}><Paperclip size={15}/>Joindre un fichier<input type="file" className="sr-only" disabled={busy||!!pending} onChange={event=>void uploadFile(event)}/></label>}
        {editor.id&&attachments.length>0&&<div className="flex flex-wrap gap-2">{attachments.map(item=><span key={item.fileId} className="inline-flex items-center gap-2 rounded border border-[#e6e0d4] px-2 py-1 text-xs">{item.filename}
          <button type="button" disabled={busy||!!pending} aria-label={`Retirer ${item.filename}`} onClick={()=>void unlinkFile(item)}><X size={13}/></button></span>)}</div>}
        {!editor.id&&<p className="text-xs text-[#5c6478]">Enregistrez d’abord le brouillon pour y joindre des fichiers.</p>}
      </div><footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ebe4d8] p-4">
        <span className="text-xs text-amber-900">Le transport vérifie les droits et l’expéditeur au moment de l’envoi. Jusqu’à 50 pièces jointes et 10 Mio au total.</span>
        <div className="flex gap-2"><button type="button" disabled={busy||!!pending} onClick={()=>void saveDraft()} className={`${messagingButton} inline-flex items-center gap-2`}><Save size={15}/>Enregistrer le brouillon</button>
          <button type="button" disabled={busy||!!pending||!!sendFollowup||!editor.id||!!draft?.sendIntentId||attachments.length>50||attachments.reduce((total,item)=>total+item.byteSize,0)>10*1024*1024}
            title={attachments.length>50||attachments.reduce((total,item)=>total+item.byteSize,0)>10*1024*1024?'Limite : 50 fichiers et 10 Mio cumulés':undefined}
            onClick={()=>void sendDraft()} className={`${messagingButton} inline-flex items-center gap-2`}><Send size={15}/>Envoyer</button></div>
      </footer></div></div>}
  </div>;
}
