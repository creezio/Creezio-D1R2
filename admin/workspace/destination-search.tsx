"use client";
/** Adapted from Creezio original packages/shell-ui/ui/search/global-search-provider.tsx (6bd6507).
 * Its search backend/history are absent in T-07; this palette lists only authorized destinations. */

import {useEffect, useMemo, useRef, useState} from "react";
import {ArrowRight, CornerDownLeft, Plus, Search, X} from "lucide-react";
import {cn} from "./utils";

export type WorkspaceDestination = {id: string; title: string; viewId: string; description?: string};
export interface DestinationSearchDialogProps {
  open: boolean;
  newTabMode: boolean;
  items: readonly WorkspaceDestination[];
  onOpenChange: (open: boolean) => void;
  onChoose: (item: WorkspaceDestination, newTab: boolean) => void;
}

export function filterDestinations(items: readonly WorkspaceDestination[], query: string) {
  const words = query.normalize("NFKC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const text = `${item.title} ${item.description ?? ""}`.normalize("NFKC").toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}

export function DestinationSearchDialog({open,newTabMode,items,onOpenChange,onChoose}: DestinationSearchDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [query,setQuery] = useState("");
  const [selected,setSelected] = useState(0);
  const filtered = useMemo(() => filterDestinations(items,query),[items,query]);
  const selectedItem = filtered[Math.min(selected,filtered.length-1)] ?? null;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");setSelected(0);
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) {
      element.close();
      returnFocus.current?.focus();
    }
  },[open]);

  useEffect(() => {
    const onKeyDown=(event: KeyboardEvent)=>{
      if ((event.metaKey||event.ctrlKey) && event.key.toLowerCase()==="k") {
        event.preventDefault();onOpenChange(!open);
      }
    };
    document.addEventListener("keydown",onKeyDown);
    return()=>document.removeEventListener("keydown",onKeyDown);
  },[open,onOpenChange]);

  function choose(item: WorkspaceDestination) {
    onChoose(item,newTabMode);
    onOpenChange(false);
  }

  return <dialog ref={dialog} role="dialog" aria-label="Rechercher une vue" aria-modal="true"
    style={open ? undefined : {display:'none'}} onCancel={event=>{event.preventDefault();onOpenChange(false);}}
    onClick={event=>{if(event.target===dialog.current)onOpenChange(false);}}
    onKeyDown={event=>{
      if(event.key==="ArrowDown"&&filtered.length){event.preventDefault();setSelected(value=>(value+1)%filtered.length);}
      if(event.key==="ArrowUp"&&filtered.length){event.preventDefault();setSelected(value=>(value-1+filtered.length)%filtered.length);}
      if(event.key==="Enter"&&selectedItem){event.preventDefault();choose(selectedItem);}
    }}
    className={cn(
      "creezio-search-palette fixed z-50 hidden flex-col overflow-hidden bg-white shadow-2xl outline-none open:flex backdrop:bg-slate-950/50",
      "inset-0 m-0 h-[100dvh] w-full max-w-none rounded-none p-0",
      "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[8%] md:m-0 md:h-auto md:max-h-[min(680px,85vh)] md:w-[min(920px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-xl md:border md:border-slate-200",
    )}>
    {newTabMode ? <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-medium text-slate-500">
      <Plus className="h-3 w-3" /> La vue s&apos;ouvrira dans un nouvel onglet
    </div> : null}
    <div className="relative shrink-0 border-b border-slate-100">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={input} value={query} onChange={event=>{setQuery(event.target.value);setSelected(0);}}
        placeholder="Rechercher une vue disponible…" aria-label="Rechercher une vue disponible"
        className="h-14 w-full border-0 bg-transparent pl-11 pr-14 text-sm text-slate-900 outline-none" />
      <button type="button" onClick={()=>onOpenChange(false)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:hidden"
        aria-label="Fermer"><X className="h-4 w-4" /></button>
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 md:inline">esc</kbd>
    </div>
    <div className="flex min-h-0 flex-1 md:grid md:grid-cols-[1fr_280px]">
      <div className="max-h-none flex-1 overflow-y-auto md:max-h-[min(480px,60vh)]" role="listbox" aria-label="Destinations disponibles">
        {filtered.length ? <div className="px-2 py-2">
          <p className="px-2 py-1.5 text-xs font-semibold text-slate-500">Vues disponibles</p>
          {filtered.map((item,index)=><button key={item.id} type="button" role="option" aria-selected={index===selected}
            onMouseEnter={()=>setSelected(index)} onClick={()=>choose(item)}
            className={cn("flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
              index===selected&&"bg-slate-100")}>
            <span className="min-w-0"><span className="block truncate font-medium">{item.title}</span>
              {item.description&&<span className="block truncate text-xs text-slate-500">{item.description}</span>}</span>
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
          </button>)}
        </div> : <p className="px-4 py-10 text-center text-sm text-slate-500">
          {query.trim()?`Aucune vue disponible pour « ${query.trim()} »`:"Aucune vue disponible"}
        </p>}
      </div>
      <aside className="hidden border-l border-slate-200 bg-slate-50/80 md:block">
        {selectedItem ? <div className="flex h-full flex-col p-5">
          <span className="mb-2 inline-flex w-fit rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Vue</span>
          <h3 className="text-lg font-semibold leading-snug text-slate-900">{selectedItem.title}</h3>
          {selectedItem.description&&<p className="mt-2 text-sm leading-relaxed text-slate-600">{selectedItem.description}</p>}
          <div className="mt-auto flex items-center gap-2 pt-6 text-xs text-slate-400"><CornerDownLeft className="h-3.5 w-3.5" /> Ouvrir</div>
        </div> : <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
          <Search className="h-8 w-8 opacity-40" /><p>Choisissez une vue</p>
        </div>}
      </aside>
    </div>
    <footer className="hidden shrink-0 items-center gap-4 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 md:flex">
      <span><kbd className="rounded border border-slate-200 bg-white px-1">↑</kbd> <kbd className="rounded border border-slate-200 bg-white px-1">↓</kbd> naviguer</span>
      <span><kbd className="rounded border border-slate-200 bg-white px-1">↵</kbd> ouvrir</span>
      <span><kbd className="rounded border border-slate-200 bg-white px-1">esc</kbd> fermer</span>
    </footer>
  </dialog>;
}
