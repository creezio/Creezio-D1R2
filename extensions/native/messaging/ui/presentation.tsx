'use client';

import {useMemo, useState, type KeyboardEvent} from 'react';
import {Archive, ArchiveRestore, FileText, Inbox, Mail, MailOpen, Paperclip, RefreshCw, Search, Send,
  SquarePen, Timer, Trash2, X} from 'lucide-react';
import {dateLabel, folders, previewText, type Attachment, type Box, type Draft,
  type Folder, type Message} from './contracts.ts';

const icons={inbox:Inbox,sent:Send,drafts:FileText,outbox:Timer,archive:Archive,trash:Trash2};
const button='rounded-md border border-[#e6e0d4] bg-white px-3 py-1.5 text-sm text-[#14182f] hover:bg-[#f3eee4] disabled:cursor-not-allowed disabled:opacity-50';
const field='w-full rounded-md border border-[#e6e0d4] bg-white px-3 py-2 text-sm text-[#14182f] outline-none focus:border-sky-400';

export function FoldersPanel(props:{boxes:Box[];boxId:string;folder:Folder;onBox:(id:string)=>void;
  onFolder:(folder:Folder)=>void;onCompose:()=>void;unread:number}) {
  return <aside className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto bg-[#faf7f1]/60 p-3">
    <button type="button" className="mb-2 flex w-full items-center justify-center gap-2 rounded-md bg-[#14182f] px-3 py-2 text-sm font-medium text-white hover:bg-[#232946]" onClick={props.onCompose}>
      <SquarePen size={16}/> Nouveau message</button>
    <label className="px-2 text-[11px] font-semibold uppercase tracking-wide text-[#9aa1b2]" htmlFor="messaging-box">Boîte</label>
    <select id="messaging-box" className={field} value={props.boxId} onChange={e=>props.onBox(e.target.value)}>
      {props.boxes.map(box=><option key={box.id} value={box.id}>{box.name} · {box.address}</option>)}
    </select>
    <nav aria-label="Dossiers de messagerie" className="mt-3 flex flex-col gap-0.5">
      {folders.map(item=>{const Icon=icons[item.id],active=props.folder===item.id;
        return <button key={item.id} type="button" onClick={()=>props.onFolder(item.id)}
          aria-current={active?'page':undefined} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${active?'bg-[#14182f] font-medium text-white':'text-[#3a4158] hover:bg-[#f3eee4]'}`}>
          <Icon size={16}/><span className="flex-1 truncate">{item.label}</span>
          {item.id==='inbox'&&props.unread>0&&<span className="rounded bg-sky-100 px-1.5 text-xs text-sky-800">{props.unread}</span>}
        </button>;})}
    </nav>
    <p className="mt-auto px-2 pt-3 text-[11px] text-[#9aa1b2]">Boîte locale · envoi et réception indisponibles sans transport</p>
  </aside>;
}

export function ListPanel(props:{folder:Folder;messages:Message[];drafts:Draft[];selectedId:string|null;
  query:string;onQuery:(query:string)=>void;unreadOnly:boolean;onUnreadOnly:(value:boolean)=>void;
  onSelect:(id:string)=>void;onRefresh:()=>void;loading:boolean;hasMore:boolean;onMore:()=>void}) {
  const [search,setSearch]=useState(props.query);
  const rows=useMemo(()=>{
    if(props.folder==='drafts')return props.drafts.filter(item=>`${item.to} ${item.subject} ${item.text}`.toLowerCase().includes(props.query.toLowerCase())).map(item=>({id:item.id,who:`À ${item.to||'(destinataire à saisir)'}`,subject:item.subject,preview:item.text,date:item.updatedAt,attachments:false,status:'Brouillon',unread:false}));
    return props.messages.filter(item=>item.folder===props.folder&&(!props.unreadOnly||props.folder!=='inbox'||!item.read)
      &&`${item.from} ${item.to} ${item.subject} ${item.text}`.toLowerCase().includes(props.query.toLowerCase()))
      .map(item=>({id:item.id,who:item.direction==='inbound'?item.from:`À ${item.to}`,subject:item.subject,preview:item.text||previewText(item.html),date:item.receivedAt||item.sentAt,attachments:false,status:item.state,unread:item.direction==='inbound'&&!item.read}));
  },[props.folder,props.drafts,props.messages,props.query,props.unreadOnly]);
  return <section aria-label="Liste des messages" className="flex h-full min-h-0 flex-col bg-white/80">
    <div className="flex items-center gap-2 border-b border-[#ebe4d8] px-3 py-2.5">
      <div className="relative flex-1"><Search size={15} className="absolute left-2.5 top-2.5 text-[#9aa1b2]"/>
        <input aria-label="Rechercher" value={search} onChange={e=>{setSearch(e.target.value);props.onQuery(e.target.value);}}
          placeholder="Rechercher…" className={`${field} pl-8`}/></div>
      {props.folder==='inbox'&&<button type="button" aria-pressed={props.unreadOnly} onClick={()=>props.onUnreadOnly(!props.unreadOnly)}
        className={`${button} ${props.unreadOnly?'bg-[#14182f] text-white':''}`}>Non lus</button>}
      <button type="button" title="Actualiser" aria-label="Actualiser" onClick={props.onRefresh} className={button}><RefreshCw size={16}/></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      {props.loading&&rows.length===0?<p className="p-8 text-center text-sm text-[#5c6478]">Chargement…</p>:
        rows.length===0?<div className="space-y-2 p-8 text-center"><Mail size={32} className="mx-auto text-[#c9c2b4]"/>
          <p className="text-sm font-medium">Aucun mail</p><p className="text-xs text-[#5c6478]">{props.folder==='inbox'?'La réception est indisponible sans transport configuré.':props.folder==='sent'||props.folder==='outbox'?'Aucun envoi confirmé : le transport est indisponible.':props.folder==='trash'?'Aucun message dans la corbeille.':props.folder==='archive'?'Aucun message archivé.':'Créez un brouillon depuis Nouveau message.'}</p></div>:
        <ul className="divide-y divide-[#f0ebe1]">{rows.map(row=><li key={row.id}><button type="button" onClick={()=>props.onSelect(row.id)}
          className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-[#faf7f1] ${props.selectedId===row.id?'bg-sky-50':''}`}>
          <span className="flex w-full items-baseline justify-between gap-2"><span className={`truncate text-sm ${row.unread?'font-semibold':'font-medium'}`}>{row.who}</span><span className="shrink-0 text-[11px] text-[#9aa1b2]">{dateLabel(row.date)}</span></span>
          <span className="flex items-center gap-1.5"><span className="truncate text-[13px] text-[#3a4158]">{row.subject||'(sans objet)'}</span>{row.attachments&&<Paperclip size={12}/>}</span>
          {row.status!=='inbound'&&row.status!=='Brouillon'&&<span className="w-fit rounded bg-amber-100 px-1.5 text-[10px] text-amber-900">{row.status}</span>}
          <span className="truncate text-xs text-[#9aa1b2]">{previewText(row.preview)}</span>
        </button></li>)}</ul>}
      {props.hasMore&&<div className="m-3 space-y-1">{props.query.trim()&&<p className="text-xs text-[#5c6478]">Recherche partielle : d’autres pages peuvent contenir des résultats.</p>}
        <button type="button" className={button} onClick={props.onMore}>Afficher plus de résultats</button></div>}
    </div>
    <p className="border-t border-[#ebe4d8] px-4 py-2 text-[11px] text-[#9aa1b2]">{rows.length} message{rows.length>1?'s':''} affiché{rows.length>1?'s':''}</p>
  </section>;
}

export function ReaderPanel(props:{message:Message|null;draft:Draft|null;thread:Message[];threadHasMore:boolean;
  threadLoading:boolean;onThreadMore:()=>void;onThreadSelect:(id:string)=>void;
  attachments:Attachment[];loading:boolean;busy:boolean;
  onReply:()=>void;onEdit:()=>void;onDownload:(item:Attachment)=>void;
  onUpdate:(change:{folder?:Folder;read?:boolean})=>void;onReconcile:()=>void;
  onDeleteDraft:()=>void;onDeleteMessage:()=>void}) {
  if(!props.message&&!props.draft)return <section aria-label="Lecture du message" className="flex h-full flex-col items-center justify-center gap-2 bg-[#fcfbf8] p-8 text-center">
    <MailOpen size={40} className="text-[#d5cec0]"/><p className="text-sm text-[#5c6478]">{props.loading?'Ouverture…':'Sélectionnez un message'}</p></section>;
  const item=props.message??props.draft!;
  return <section aria-label="Lecture du message" className="flex h-full min-h-0 flex-col bg-[#fcfbf8]">
    <header className="flex flex-wrap items-start gap-3 border-b border-[#ebe4d8] px-5 py-4"><div className="min-w-0 flex-1">
      <h2 className="text-lg font-semibold text-[#14182f]">{item.subject||'(sans objet)'}</h2>
      <p className="mt-1 text-sm text-[#3a4158]">{props.message?.direction==='inbound'?`De ${props.message.from}`:`À ${item.to||'(destinataire à saisir)'}`}{item.cc?` · Cc ${item.cc}`:''}</p>
      <p className="text-xs text-[#9aa1b2]">{props.draft?'Brouillon':props.message?.state} · {dateLabel(props.draft?.updatedAt||props.message?.receivedAt||props.message?.sentAt)}</p>
    </div><div className="flex flex-wrap gap-1">{props.draft?<><button type="button" className={button} onClick={props.onEdit}>Reprendre le brouillon</button>
      <button type="button" disabled={props.busy} className={button} onClick={props.onDeleteDraft}>Supprimer</button></>:
      props.message?<>
        {props.message.direction==='outbound'&&['sent','delivered','bounced'].includes(props.message.state)
          &&<button type="button" disabled={props.busy} className={button}
            onClick={props.onReconcile}>Rapprocher la livraison</button>}
        {props.message.direction==='inbound'&&<button type="button" className={button} onClick={props.onReply}>Répondre</button>}
        {props.message.direction==='inbound'&&<button type="button" disabled={props.busy} className={button} onClick={()=>props.onUpdate({read:!props.message!.read})}>{props.message.read?'Marquer non lu':'Marquer lu'}</button>}
        {props.message.folder==='archive'||props.message.folder==='trash'?<button type="button" disabled={props.busy} className={button} onClick={()=>props.onUpdate({folder:props.message!.direction==='inbound'?'inbox':'sent'})}><ArchiveRestore size={14}/> Restaurer</button>:
          <button type="button" disabled={props.busy} className={button} onClick={()=>props.onUpdate({folder:'archive'})}><Archive size={14}/> Archiver</button>}
        {props.message.folder!=='trash'&&<button type="button" disabled={props.busy} className={button} onClick={()=>props.onUpdate({folder:'trash'})}><Trash2 size={14}/> Corbeille</button>}
        {props.message.folder==='trash'&&<button type="button" className={button}
          disabled={props.busy||props.message.direction!=='inbound'}
          title={props.message.direction==='inbound'?'Supprimer le message local et détacher ses pièces privées':'Historique d’envoi et accusés conservés'}
          onClick={props.onDeleteMessage}><Trash2 size={14}/> Supprimer définitivement</button>}
      </>:null}</div></header>
    {props.message&&(props.thread.length>1||props.threadHasMore)&&<div className="border-b border-[#ebe4d8] px-4 py-2">
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9aa1b2]">Fil ({props.thread.length} chargés{props.threadHasMore?', suite disponible':''})</p>
      <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">{props.thread.map(item=><button type="button" key={item.id}
        onClick={()=>props.onThreadSelect(item.id)} className={`flex w-full items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${item.id===props.message!.id?'bg-sky-50':'hover:bg-[#faf7f1]'}`}>
        <span className="truncate">{item.direction==='inbound'?item.from:`→ ${item.to}`}</span><span className="shrink-0 text-[#9aa1b2]">{dateLabel(item.receivedAt||item.sentAt)}</span>
      </button>)}</div>
      {props.threadHasMore&&<button type="button" disabled={props.threadLoading} className={`${button} mt-2`} onClick={props.onThreadMore}>
        {props.threadLoading?'Chargement…':'Afficher la suite du fil'}</button>}
    </div>}
    {props.attachments.length>0&&<div className="flex flex-wrap gap-2 border-b border-[#ebe4d8] px-5 py-3">{props.attachments.map(att=><button type="button" key={att.fileId} onClick={()=>props.onDownload(att)} className={`${button} flex items-center gap-1.5`}>
      <Paperclip size={12}/>{att.filename}<span className="text-[#9aa1b2]">({Math.max(1,Math.round(att.byteSize/1024))} Ko)</span></button>)}</div>}
    {item.html?.trim()?<iframe title={item.subject||'Message'} sandbox="allow-popups" referrerPolicy="no-referrer" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'"><base target="_blank"></head><body>${item.html}</body></html>`} className="min-h-0 w-full flex-1 border-0 bg-white"/>:
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4"><pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#14182f]">{item.text||'(message vide)'}</pre></div>}
  </section>;
}

export function RecipientsInput(props:{label:string;value:string;onChange:(value:string)=>void;disabled:boolean}) {
  const [entry,setEntry]=useState('');const values=props.value.split(',').map(v=>v.trim()).filter(Boolean);
  function commit(raw:string){const additions=raw.split(/[;,\s]+/).map(v=>v.trim()).filter(Boolean);
    if(additions.length)props.onChange([...new Set([...values,...additions])].join(', '));setEntry('');}
  function key(e:KeyboardEvent<HTMLInputElement>){if(['Enter',',',';'].includes(e.key)){e.preventDefault();commit(entry);}
    else if(e.key==='Backspace'&&!entry&&values.length)props.onChange(values.slice(0,-1).join(', '));}
  return <label className="flex items-start gap-3 text-sm"><span className="w-10 shrink-0 pt-2 text-[#5c6478]">{props.label}</span>
    <span className="flex min-h-9 flex-1 flex-wrap items-center gap-1 rounded-md border border-[#e6e0d4] bg-white px-2 py-1">
      {values.map(value=><span key={value} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?'bg-[#f3eee4] text-[#3a4158]':'bg-red-100 text-red-800'}`}>{value}
        <button type="button" aria-label={`Retirer ${value}`} disabled={props.disabled} onClick={()=>props.onChange(values.filter(v=>v!==value).join(', '))}><X size={12}/></button></span>)}
      <input value={entry} disabled={props.disabled} onChange={e=>setEntry(e.target.value)} onKeyDown={key} onBlur={()=>commit(entry)}
        aria-label={props.label} placeholder={values.length?'':`Adresse ${props.label.toLowerCase()}`} className="min-w-[120px] flex-1 bg-transparent py-1 text-sm outline-none"/>
    </span></label>;
}

export const messagingButton=button;
export const messagingField=field;
