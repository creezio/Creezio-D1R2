'use client';

import {useEffect,useMemo,useState} from 'react';
import {ChevronDown,ChevronUp,RotateCcw,Save} from 'lucide-react';

export type SidebarEntry={id:string;moduleId:string;viewId:string;title:string;order:number;
  route:string;permissionIds:string[];available:boolean;hidden:boolean;
  displayTitle:string;displayOrder:number};
export type SidebarCatalog={compositionDigest:string;contextId:string;audience:'admin'|'app';
  sessionId:string|null;epoch:number|null;revision:number;entries:SidebarEntry[]};
export type SidebarEdit={id:string;hidden?:boolean;title?:string;order?:number};
const button='rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50 disabled:opacity-50';
const field='w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm';

/** Original nav-admin table interactions on a fixed, host-projected workspace catalogue. */
export function SidebarEditor(props:{catalog:SidebarCatalog|null;busy:boolean;reload:()=>void;
  save:(edits:SidebarEdit[],resetIds:string[])=>Promise<boolean>}){
  const [titles,setTitles]=useState<Record<string,string>>({});
  const [orders,setOrders]=useState<Record<string,string>>({});
  useEffect(()=>{
    setTitles(Object.fromEntries((props.catalog?.entries??[]).map(entry=>[entry.id,entry.displayTitle])));
    setOrders(Object.fromEntries((props.catalog?.entries??[]).map(entry=>[entry.id,String(entry.displayOrder)])));
  },[props.catalog]);
  const rows=useMemo(()=>[...(props.catalog?.entries??[])]
    .sort((a,b)=>a.displayOrder-b.displayOrder||a.id.localeCompare(b.id)),[props.catalog]);
  const available=rows.filter(entry=>entry.available);
  const saveRow=async(entry:SidebarEntry)=>{
    const title=(titles[entry.id]??entry.displayTitle).trim(),order=Number(orders[entry.id]??entry.displayOrder);
    if(!title||title.length>120||!Number.isSafeInteger(order)||order<0||order>10000)return;
    await props.save([{id:entry.id,title,order}],[]);
  };
  const move=async(entry:SidebarEntry,direction:-1|1)=>{
    const index=available.findIndex(item=>item.id===entry.id),next=index+direction;
    if(next<0||next>=available.length||available.length>100)return;
    const reordered=[...available];[reordered[index],reordered[next]]=[reordered[next],reordered[index]];
    await props.save(reordered.map((item,position)=>({id:item.id,order:(position+1)*10})),[]);
  };
  return <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2"><h2 className="mr-auto font-semibold">Sidebar du workspace</h2>
      <button type="button" className={button} disabled={props.busy} onClick={props.reload}>Relire</button></div>
    <p className="text-xs text-slate-600">Source, lien et permissions viennent du catalogue actif ; seuls visibilité, libellé et ordre sont modifiables. Une entrée absente ou sans droit reste indisponible.</p>
    {!props.catalog?<p role="status" className="text-sm">Chargement du catalogue…</p>:rows.length===0?
      <p className="text-sm">Aucune entrée autorisée dans le catalogue.</p>:
      <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
        <thead><tr className="border-b text-left text-slate-500">
          <th className="p-2">Source</th><th className="p-2">Lien</th><th className="p-2">Libellé</th>
          <th className="p-2">Visible</th><th className="p-2">Permission</th>
          <th className="p-2">Ordre</th><th className="p-2">Actions</th></tr></thead>
        <tbody>{rows.map(entry=>{const disabled=props.busy||!entry.available;
          const position=available.findIndex(item=>item.id===entry.id);
          return <tr key={entry.id} className="border-b last:border-0">
            <td className="p-2 font-mono text-xs">{entry.moduleId}</td>
            <td className="p-2 font-mono text-xs" title={entry.viewId}>{entry.route}</td>
            <td className="p-2"><label className="sr-only" htmlFor={`sidebar-title-${entry.id}`}>Libellé {entry.id}</label>
              <input id={`sidebar-title-${entry.id}`} className={field} value={titles[entry.id]??entry.displayTitle}
                disabled={disabled} maxLength={120} onChange={event=>setTitles(old=>({...old,[entry.id]:event.target.value}))}
                onBlur={()=>{if(!disabled&&titles[entry.id]!==entry.displayTitle)void saveRow(entry);}}/></td>
            <td className="p-2">{entry.available?<label className="flex items-center gap-2 text-xs">
              <input type="checkbox" aria-label={`Visible ${entry.displayTitle}`} checked={!entry.hidden}
                disabled={disabled} onChange={()=>void props.save([{id:entry.id,hidden:!entry.hidden}],[])}/>
              {entry.hidden?'Masquée':'Oui'}</label>:<span>Indisponible</span>}</td>
            <td className="p-2 font-mono text-xs">{entry.permissionIds.join(', ')||'—'}</td>
            <td className="p-2"><label className="sr-only" htmlFor={`sidebar-order-${entry.id}`}>Ordre {entry.id}</label>
              <input id={`sidebar-order-${entry.id}`} className={`${field} w-20`} inputMode="numeric"
                value={orders[entry.id]??entry.displayOrder} disabled={disabled}
                onChange={event=>setOrders(old=>({...old,[entry.id]:event.target.value}))}
                onBlur={()=>{if(!disabled&&orders[entry.id]!==String(entry.displayOrder))void saveRow(entry);}}/></td>
            <td className="p-2"><div className="flex items-center gap-1">
              <button type="button" className={button} aria-label={`Monter ${entry.displayTitle}`}
                disabled={disabled||position<=0||available.length>100} onClick={()=>void move(entry,-1)}><ChevronUp size={14}/></button>
              <button type="button" className={button} aria-label={`Descendre ${entry.displayTitle}`}
                disabled={disabled||position<0||position>=available.length-1||available.length>100}
                onClick={()=>void move(entry,1)}><ChevronDown size={14}/></button>
              <button type="button" className={button} disabled={disabled} onClick={()=>void saveRow(entry)}>
                <Save size={14}/> Enregistrer</button>
              <button type="button" className={button} disabled={disabled}
                onClick={()=>void props.save([],[entry.id])}><RotateCcw size={14}/> Défaut</button>
            </div></td>
          </tr>;})}</tbody></table></div>}
  </section>;
}
