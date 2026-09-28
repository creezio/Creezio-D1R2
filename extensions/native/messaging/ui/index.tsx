'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type ChangeEvent} from 'react';
import {Paperclip,Save,Send,X} from 'lucide-react';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {createFileClient} from '../../../../sdk/files/client.ts';
import type {RuntimeViewProps} from '../../../../sdk/runtime/ui.ts';
import {call,readableError,folders,scopeChanged,type Attachment,type Box,type Draft,type Folder,type Message,
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
  const [boxes,setBoxes]=useState<Box[]>([]);
  const [boxId,setBoxId]=useState(()=>{
    const saved=props.navigation.readPanelState()?.data?.boxId;
    return typeof saved==='string'&&validId(saved)?saved:'';
  });
  const [folder,setFolder]=useState<Folder>(()=>{
    const saved=props.navigation.readPanelState()?.activeSubview;
    return folders.some(item=>item.id===saved)?saved as Folder:'inbox';
  });
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
  const resetScope=useRef<UiIdentity|null>(null);
  const restoreDraft=useRef<string|null>((()=>{const saved=props.navigation.readPanelState()?.data?.draftId;
    return typeof saved==='string'&&validId(saved)?saved:null;})());
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
  useRegisterWorkspaceMetadata(props.panelId,{title:'Messagerie',kind:'section',trail:[{label:'Messagerie'},
    ...(boxId?[{label:boxes.find(box=>box.id===boxId)?.name??'Boîte'}]:[])]});

  const loadBoxes=useCallback(async()=>{
    const result=await call<Page<Box>>(scope,'box.list',{limit:50},current);
    if(!current())return;
    if(result.kind==='ok'){
      try{const items=page<Box>(result.value).items.filter(item=>validId(item.id));setBoxes(items);
        setBoxId(old=>items.some(item=>item.id===old)?old:items[0]?.id??'');}
      catch{setNotice('Réponse des boîtes invalide.');}
    }else setNotice(readableError(result.code));
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{
    const next={sessionId,client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};
    const changed=scopeChanged(resetScope.current,next);resetScope.current=next;
    if(!changed)return;
    restoreDraft.current=null;setBoxes([]);setBoxId('');setMessages([]);setDrafts([]);setSelectedId(null);
    setMessage(null);setDraft(null);setAttachments([]);setThread([]);setThreadCursor(null);setComposer(false);setEditor(blank);setNotice('');
  },[sessionId,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{if(enabled)void loadBoxes();},[enabled,sessionId,props.client,props.audience,props.contextId]);
  useEffect(()=>{if(!enabled){setBusy(false);setLoading(false);setThreadLoading(false);}},[enabled]);

  const loadList=useCallback(async(append=false)=>{
    if(!scoped()||!boxId)return;
    const requestedQuery=query,requestedUnread=unreadOnly;
    const listCurrent=()=>scoped(boxId)&&live.current.folder===folder&&
      live.current.query===requestedQuery&&live.current.unreadOnly===requestedUnread;
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
  useEffect(()=>{setMessages([]);setDrafts([]);setCursor(null);setSelectedId(null);setMessage(null);setDraft(null);setAttachments([]);setThread([]);setThreadCursor(null);
  },[boxId,folder,sessionId]);
  useEffect(()=>{if(enabled&&boxId)void loadList();},[boxId,folder,enabled,sessionId]);
  useEffect(()=>{if(!enabled||!boxId)return;const timer=setTimeout(()=>void loadList(),180);
    return ()=>clearTimeout(timer);},[query,unreadOnly]);

  const loadSelection=useCallback(async(id:string)=>{
    if(!scoped()||!boxId||!validId(id))return;
    const selectionCurrent=()=>scoped(boxId)&&live.current.folder===folder&&live.current.selectedId===id;
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
      if(found.direction==='inbound'&&!found.read){
        const marked=await call<{message:Message}>(scope,'message.update',{requestKey:requestKey(),boxId,
          messageId:id,revision:found.revision,read:true},selectionCurrent);
        if(selectionCurrent()&&marked.kind==='ok'&&marked.value.message?.id===id){setMessage(marked.value.message);
          setMessages(rows=>rows.map(row=>row.id===id?marked.value.message:row));}
        else if(selectionCurrent()&&marked.kind!=='ok')setNotice(readableError(marked.code));
      }
    }
  },[boxId,folder,props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{if(selectedId&&enabled)void loadSelection(selectedId);},[selectedId,boxId,folder,enabled,sessionId]);

  async function loadMoreThread(){
    const selected=message,after=threadCursor;if(!selected?.threadId||!after||threadLoading||!scoped())return;
    const sameSelection=()=>scoped(boxId)&&live.current.selectedId===selected.id;
    setThreadLoading(true);let next:string|null=after;const additional:Message[]=[];
    for(let i=0;i<20;i++){
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
    setThreadCursor(next);setThreadLoading(false);
  }

  function savePosition(nextFolder:Folder,nextBox:string,draftId?:string){
    props.navigation.savePanelState({activeSubview:nextFolder,
      ...(nextBox?{data:{boxId:nextBox,...(draftId?{draftId}:{})}}:{})});
  }
  function chooseFolder(next:Folder){if(next===folder)return;setFolder(next);savePosition(next,boxId);}
  function chooseBox(next:string){if(next===boxId)return;setBoxId(next);savePosition(folder,next);}
  function chooseItem(next:string){setSelectedId(next);savePosition(folder,boxId,folder==='drafts'?next:undefined);}
  function beginResize(event:React.PointerEvent<HTMLDivElement>,index:0|1){
    const parent=event.currentTarget.parentElement;if(!parent)return;
    const rect=parent.getBoundingClientRect(),start=event.clientX,original=widths;
    const move=(e:PointerEvent)=>{const delta=(e.clientX-start)/rect.width*100;
      setWidths(index===0?[Math.max(12,Math.min(28,original[0]+delta)),original[1]]:
        [original[0],Math.max(22,Math.min(45,original[1]+delta))]);};
    const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});
  }
  function openCompose(initial:Editor=blank){setEditor(initial);if(!initial.id)setAttachments([]);
    setShowCc(!!initial.cc||!!initial.bcc);setComposerSeed(seed=>seed+1);setComposer(true);setNotice('');}
  function reply(){if(!message)return;
    const quoted=message.text?.trim();openCompose({...blank,to:message.replyTo||message.from,
      subject:/^re\s*:/i.test(message.subject)?message.subject:`Re: ${message.subject}`,
      text:quoted?`\n\n----- ${message.from} a écrit -----\n${quoted}`:''});}
  async function saveDraft(){
    if(!boxId||busy||!current())return;setBusy(true);setNotice('');
    let id=editor.id,revision=editor.revision;
    if(!id){const created=await call<{draft:Draft}>(scope,'draft.create',{requestKey:requestKey(),boxId},()=>scoped(boxId));
      if(!scoped(boxId))return;
      if(created.kind!=='ok'){setBusy(false);setNotice(readableError(created.code));
        if(created.kind==='unknown')setComposer(false);return;}
      id=created.value.draft?.id;revision=created.value.draft?.revision;
      if(!id||!Number.isInteger(revision)){setBusy(false);setNotice('Création du brouillon non confirmée. Vérifiez les brouillons.');return;}
      setEditor(old=>({...old,id,revision}));
    }
    const saved=await call<{draft:Draft}>(scope,'draft.save',{requestKey:requestKey(),boxId,draftId:id,
      revision,to:editor.to,cc:editor.cc,bcc:editor.bcc,subject:editor.subject,text:editor.text,html:editor.html},()=>scoped(boxId));
    if(!scoped(boxId))return;
    setBusy(false);if(saved.kind!=='ok'){setNotice(readableError(saved.code));
      if(saved.kind==='unknown')setComposer(false);return;}
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
  }
  async function updateMessage(change:{folder?:Folder;read?:boolean}){
    if(!message||busy||!scoped())return;const prior=message;setBusy(true);
    const result=await call<{message:Message}>(scope,'message.update',{requestKey:requestKey(),boxId,
      messageId:prior.id,revision:prior.revision,...change},()=>scoped(boxId));if(!scoped(boxId))return;setBusy(false);
    if(result.kind!=='ok'){setNotice(readableError(result.code));return;}
    if(!result.value.message){setNotice('Modification non confirmée.');return;}
    setMessage(result.value.message);setMessages(rows=>rows.map(row=>row.id===prior.id?result.value.message:row));
    if(change.folder&&change.folder!==folder){setSelectedId(null);void loadList();}
  }
  async function deleteDraft(){if(!draft||busy||!scoped())return;setBusy(true);
    const result=await call<{deleted:boolean}>(scope,'draft.delete',{requestKey:requestKey(),boxId,
      draftId:draft.id,revision:draft.revision},()=>scoped(boxId));if(!scoped(boxId))return;setBusy(false);
    if(result.kind!=='ok'||!result.value.deleted){setNotice(result.kind==='ok'?'Suppression non confirmée.':readableError(result.code));return;}
    setSelectedId(null);setDraft(null);void loadList();
  }
  async function unlinkFile(item:Attachment){if(!editor.id||busy||!scoped())return;setBusy(true);
    const result=await call<{draft:Draft;removed:boolean}>(scope,'attachment.unlink',{requestKey:requestKey(),boxId,
      draftId:editor.id,revision:editor.revision,fileId:item.fileId},()=>scoped(boxId));if(!scoped(boxId))return;setBusy(false);
    if(result.kind!=='ok'||!result.value.removed){setNotice(result.kind==='ok'?'Retrait non confirmé.':readableError(result.code));return;}
    setEditor(draftFrom(result.value.draft));setAttachments(list=>list.filter(file=>file.fileId!==item.fileId));
  }
  async function createBox(){if(!current()||busy||!boxName.trim())return;
    setBusy(true);const result=await call<{box:Box}>(scope,'box.create',{requestKey:requestKey(),name:boxName.trim(),address:boxAddress.trim()},current);
    if(!current())return;setBusy(false);if(result.kind==='ok'&&result.value.box?.id){setNewBox(false);setBoxName('');setBoxAddress('');await loadBoxes();if(!current())return;chooseBox(result.value.box.id);}
    else setNotice(result.kind==='ok'?'Création non confirmée.':readableError(result.code));}
  async function uploadFile(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value='';
    if(!file||!editor.id||!boxId||busy)return;
    setBusy(true);setNotice(`Téléversement de ${file.name}…`);
    const files=createFileClient({access:props.access,moduleId:'creezio.messaging',categoryId:'attachments',contextId:props.contextId});
    const uploaded=await files.upload({file,filename:file.name,intentId:requestKey(),isCurrent:()=>scoped(boxId)});
    if(!scoped(boxId))return;
    if(uploaded.kind!=='ready'){setBusy(false);setNotice('Téléversement non confirmé. Vérifiez le brouillon avant un nouvel essai.');return;}
    const linked=await call<{draft:Draft}>(scope,'attachment.link',{requestKey:requestKey(),boxId,draftId:editor.id,
      revision:editor.revision,staged:uploaded.value.reference},()=>scoped(boxId));
    if(!scoped(boxId))return;
    setBusy(false);
    if(linked.kind!=='ok'){setNotice(readableError(linked.code));return;}
    if(linked.value.draft){setEditor(draftFrom(linked.value.draft));const listed=await call<Page<Attachment>>(scope,'attachment.list',
      {boxId,draftId:editor.id,limit:50},()=>scoped(boxId));if(!scoped(boxId))return;
      if(listed.kind==='ok')setAttachments(page<Attachment>(listed.value).items);}
    setNotice(`${file.name} joint au brouillon.`);
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
  return <div className="flex h-[calc(100vh-8.5rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[#e6e0d4] bg-white/80 shadow-sm">
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
      <span>Envoi et réception indisponibles sans transport de messagerie. La lecture des données existantes et la rédaction de brouillons restent disponibles.</span>
      <button type="button" className={messagingButton} onClick={()=>setNewBox(true)}>Nouvelle boîte</button>
    </div>
    {notice&&<div role="alert" className="border-b border-[#ebe4d8] px-4 py-2 text-sm text-[#3a4158]">{notice}</div>}
    <div className="flex min-h-0 flex-1" style={{gridTemplateColumns:`${widths[0]}% ${widths[1]}% 1fr`}}>
      <div style={{width:`${widths[0]}%`}} className="min-w-0"><FoldersPanel boxes={boxes} boxId={boxId} folder={folder} onBox={chooseBox} onFolder={chooseFolder} onCompose={()=>openCompose()} unread={messages.filter(item=>item.direction==='inbound'&&!item.read).length}/></div>
      <div role="separator" aria-orientation="vertical" onPointerDown={event=>beginResize(event,0)} className="w-1 cursor-col-resize bg-[#ebe4d8] hover:bg-sky-300"/>
      <div style={{width:`${widths[1]}%`}} className="min-w-0"><ListPanel folder={folder} messages={messages} drafts={drafts} selectedId={selectedId} query={query} onQuery={setQuery} unreadOnly={unreadOnly} onUnreadOnly={setUnreadOnly} onSelect={chooseItem} onRefresh={()=>void loadList()} loading={loading} hasMore={!!cursor} onMore={()=>void loadList(true)}/></div>
      <div role="separator" aria-orientation="vertical" onPointerDown={event=>beginResize(event,1)} className="w-1 cursor-col-resize bg-[#ebe4d8] hover:bg-sky-300"/>
      <div className="min-w-0 flex-1"><ReaderPanel message={message} draft={draft} thread={thread} threadHasMore={!!threadCursor} threadLoading={threadLoading} onThreadMore={()=>void loadMoreThread()} onThreadSelect={setSelectedId} attachments={attachments} loading={loading} busy={busy} onReply={reply} onEdit={()=>draft&&openCompose(draftFrom(draft))} onDownload={item=>void downloadFile(item)} onUpdate={change=>void updateMessage(change)} onDeleteDraft={()=>void deleteDraft()}/></div>
    </div>
    {newBox&&<div role="dialog" aria-modal="true" aria-label="Nouvelle boîte" className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 p-4"><div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
      <div className="flex justify-between"><h2 className="font-semibold">Nouvelle boîte locale</h2><button type="button" onClick={()=>setNewBox(false)} aria-label="Fermer"><X size={18}/></button></div>
      <p className="text-sm text-[#5c6478]">L’adresse est facultative et sert de repère. Elle ne connecte pas un fournisseur de messagerie.</p>
      <input className={messagingField} placeholder="Nom de la boîte" value={boxName} onChange={e=>setBoxName(e.target.value)}/>
      <input className={messagingField} type="email" placeholder="Adresse facultative" value={boxAddress} onChange={e=>setBoxAddress(e.target.value)}/>
      <button type="button" disabled={busy} className={messagingButton} onClick={()=>void createBox()}>Créer la boîte</button>
    </div></div>}
    {composer&&<div role="dialog" aria-modal="true" aria-label="Rédiger un message" className="absolute inset-0 z-30 flex items-end justify-center bg-black/35 p-4"><div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-[#fcfbf8] shadow-xl">
      <header className="flex items-center justify-between border-b border-[#ebe4d8] px-5 py-3"><h2 className="font-semibold">{editor.id?'Modifier le brouillon':'Nouveau message'}</h2>
        <button type="button" aria-label="Fermer" onClick={()=>setComposer(false)}><X size={18}/></button></header>
      <div className="space-y-3 overflow-y-auto p-5"><RecipientsInput label="À" value={editor.to} onChange={to=>setEditor(old=>({...old,to}))} disabled={busy}/>
        {showCc&&<><RecipientsInput label="Cc" value={editor.cc} onChange={cc=>setEditor(old=>({...old,cc}))} disabled={busy}/><RecipientsInput label="Cci" value={editor.bcc} onChange={bcc=>setEditor(old=>({...old,bcc}))} disabled={busy}/></>}
        {!showCc&&<button type="button" className="text-xs text-sky-700" onClick={()=>setShowCc(true)}>Ajouter Cc / Cci</button>}
        <input aria-label="Objet" placeholder="Objet" className={messagingField} value={editor.subject} onChange={e=>setEditor(old=>({...old,subject:e.target.value}))}/>
        <RichEditor key={composerSeed} initialHtml={editor.html} initialText={editor.text} disabled={busy}
          onChange={(html,text)=>setEditor(old=>({...old,html,text}))}/>
        {editor.id&&<label className={`${messagingButton} inline-flex cursor-pointer items-center gap-2`}><Paperclip size={15}/>Joindre un fichier<input type="file" className="sr-only" disabled={busy} onChange={event=>void uploadFile(event)}/></label>}
        {editor.id&&attachments.length>0&&<div className="flex flex-wrap gap-2">{attachments.map(item=><span key={item.fileId} className="inline-flex items-center gap-2 rounded border border-[#e6e0d4] px-2 py-1 text-xs">{item.filename}
          <button type="button" disabled={busy} aria-label={`Retirer ${item.filename}`} onClick={()=>void unlinkFile(item)}><X size={13}/></button></span>)}</div>}
        {!editor.id&&<p className="text-xs text-[#5c6478]">Enregistrez d’abord le brouillon pour y joindre des fichiers.</p>}
      </div><footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ebe4d8] p-4">
        <span className="text-xs text-amber-900">Envoi indisponible : aucun transport configuré.</span>
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>void saveDraft()} className={`${messagingButton} inline-flex items-center gap-2`}><Save size={15}/>Enregistrer le brouillon</button>
          <button type="button" disabled title="Envoi indisponible sans transport" className={`${messagingButton} inline-flex items-center gap-2`}><Send size={15}/>Envoyer</button></div>
      </footer></div></div>}
  </div>;
}
