'use client';

import type {DragEvent} from 'react';

export type Prospect={id:string;name:string;city:string|null;contactName:string|null;phone:string|null;
  notes:string|null;stage:string;position:number;revision:number};
export const stages=[
  {id:'a_contacter',label:'À contacter'},
  {id:'contacte',label:'Contacté'},
  {id:'rdv',label:'RDV / démo'},
  {id:'client',label:'Client 🎉'},
  {id:'perdu',label:'Perdu'}
] as const;

/** The original five-column Prospection layout, with server-confirmed moves. */
export function ProspectKanban({items,loading,selectedId,onSelect,onMove}:{items:readonly Prospect[];
  loading:boolean;selectedId:string|null;onSelect:(id:string)=>void;
  onMove:(item:Prospect,stage:string,position:number)=>void}){
  const drop=(event:DragEvent<HTMLElement>,stage:string)=>{
    event.preventDefault();
    const id=event.dataTransfer.getData('text/plain');
    const item=items.find(value=>value.id===id);
    if(!item||item.stage===stage)return;
    const positions=items.filter(value=>value.stage===stage).map(value=>value.position);
    onMove(item,stage,positions.length?Math.max(...positions)+1:1);
  };
  return <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
    {stages.map(stage=>{
      const cards=items.filter(item=>item.stage===stage.id).sort((a,b)=>
        a.position-b.position||a.name.localeCompare(b.name));
      return <section key={stage.id} className="flex min-h-64 flex-col gap-2 rounded-lg border bg-muted/30 p-2"
        onDragOver={event=>event.preventDefault()} onDrop={event=>drop(event,stage.id)}>
        <div className="flex items-center justify-between px-1"><span className="text-sm font-medium">{stage.label}</span>
          <span className="rounded-full bg-secondary px-2 text-xs">{cards.length}</span></div>
        {cards.map(item=><button key={item.id} type="button" draggable
          onDragStart={event=>{event.dataTransfer.setData('text/plain',item.id);event.dataTransfer.effectAllowed='move';}}
          onClick={()=>onSelect(item.id)} aria-pressed={selectedId===item.id}
          className="cursor-grab rounded-lg border bg-card p-2 text-left shadow-sm active:cursor-grabbing">
          <span className="block text-sm font-medium">{item.name}</span>
          <span className="block text-xs text-muted-foreground">
            {[item.city,item.contactName,item.phone].filter(Boolean).join(' · ')||'—'}</span>
          {item.notes?<span className="mt-1 block line-clamp-2 text-[11px] text-muted-foreground">{item.notes}</span>:null}
        </button>)}
        {!cards.length&&!loading?<div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">Déposez ici</div>:null}
      </section>;
    })}
  </div>;
}
