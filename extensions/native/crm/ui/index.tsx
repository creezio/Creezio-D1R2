'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '../../../../sdk/workspace/types.ts';
import {useWorkspaceActivity} from '@creezio/sdk/workspace/components';
import {ProspectKanban,stages,type Prospect} from './kanban.tsx';
import {emptySubviewDraft,formFrom,saveSubviewDraft,updateFromForm,type CrmEntity as Entity,type CrmItem as Item,
  type CrmEditForm as Form,type CrmEditField,type CrmSubviewDrafts} from './editing.ts';
import {createCommandJournal,readPendingCommand,type PendingCrmCommand} from './commands.ts';

const labels:Record<Entity,string>={company:'Entreprises',contact:'Contacts',prospect:'Prospection'};
const inputStyle='rounded-md border bg-transparent px-3 py-2 text-sm';
const buttonStyle='rounded-md border px-3 py-2 text-sm disabled:opacity-50';
const validEntity=(value:unknown):value is Entity=>value==='company'||value==='contact'||value==='prospect';

function ReferencePicker({kind,value,fetch,onChange,disabled}:{kind:'company'|'contact';value:string;disabled:boolean;
  fetch:(kind:'company'|'contact',query:string,id?:string)=>Promise<Item[]|Item|null>;
  onChange:(id:string)=>void}){
  const [term,setTerm]=useState(''),[label,setLabel]=useState(''),[options,setOptions]=useState<Item[]>([]);
  useEffect(()=>{let cancelled=false;
    if(!value){setLabel('');return;}
    void fetch(kind,'',value).then(found=>{if(!cancelled)setLabel(found&&!Array.isArray(found)?found.name:'');});
    return()=>{cancelled=true;};
  },[kind,value,fetch]);
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{
    void fetch(kind,term).then(found=>{if(!cancelled)setOptions(Array.isArray(found)?found:[]);});
  },180);return()=>{cancelled=true;clearTimeout(timer);};},[kind,term,fetch]);
  return <fieldset disabled={disabled} className="min-w-52 rounded-md border p-2"><legend className="px-1 text-sm">
    {kind==='company'?'Entreprise liée':'Contact lié'}</legend>
    <div className="text-xs text-muted-foreground">{value?label||'Nom indisponible':'Aucun lien'}</div>
    <input className={`${inputStyle} mt-2 w-full`} aria-label={kind==='company'?'Chercher une entreprise':'Chercher un contact'}
      placeholder="Chercher par nom" value={term} onChange={event=>setTerm(event.target.value)}/>
    <div className="mt-2 max-h-32 overflow-y-auto"><button type="button" className={buttonStyle}
      onClick={()=>{onChange('');setTerm('');}}>Aucun lien</button>
      {options.map(item=><button key={item.id} type="button" className={`${buttonStyle} ml-1 mt-1`}
        onClick={()=>{onChange(item.id);setLabel(item.name);setTerm('');}}>{item.name}{item.city?` · ${item.city}`:''}</button>)}</div>
  </fieldset>;
}

export function CrmWorkspaceView(props:WorkspaceViewProps){
  const active=useWorkspaceActivity()&&props.active&&props.authorized;
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const session=access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
  const saved=useRef(props.navigation.readPanelState());
  const [entity,setEntity]=useState<Entity>(()=>validEntity(saved.current?.activeSubview)?saved.current.activeSubview:
    validEntity(props.input.entity)?props.input.entity:'prospect');
  const [items,setItems]=useState<Item[]>([]);
  const [loading,setLoading]=useState(false);
  const journal=useRef(createCommandJournal(readPendingCommand(saved.current?.data?.pending,
    {sessionId:session,contextId:props.contextId,audience:props.audience})));
  const [busy,setBusy]=useState(!!journal.current.pending);
  const [checking,setChecking]=useState(false);
  const [error,setError]=useState('');
  const [name,setName]=useState('');
  const [city,setCity]=useState('');
  const [query,setQuery]=useState(()=>typeof saved.current?.data?.query==='string'?saved.current.data.query:'');
  const [appliedQuery,setAppliedQuery]=useState(()=>query);
  const appliedQueryRef=useRef(appliedQuery);appliedQueryRef.current=appliedQuery;
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [archived,setArchived]=useState(saved.current?.data?.archived===true);
  const [selected,setSelected]=useState<string|null>(null);
  const [selectedSnapshot,setSelectedSnapshot]=useState<Item|null>(null);
  const selectedRef=useRef(selected);selectedRef.current=selected;
  const [form,setForm]=useState<Form|null>(null);
  const subviewDrafts=useRef<CrmSubviewDrafts>({});
  const generation=useRef(0),listSerial=useRef(0),busyRef=useRef(!!journal.current.pending);
  const panelIdentity=useRef({session,entity,archived,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId});
  const identity=useRef({active,session,entity,archived,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId});
  if(identity.current.active!==active||identity.current.session!==session||identity.current.client!==props.client||
    identity.current.access!==props.access||identity.current.audience!==props.audience||
    identity.current.contextId!==props.contextId||identity.current.entity!==entity||identity.current.archived!==archived){
    generation.current++;identity.current={active,session,entity,archived,
      client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};}
  const current=useCallback((token:number)=>active&&!!session&&generation.current===token&&
    props.access.getSnapshot().session?.id===session,[active,session,props.access]);
  const invoke=useCallback(async(target:Entity,operation:string,input:Record<string,unknown>,token:number,silent=false)=>{
    let result;
    try{result=await props.client.invoke({bindingId:`creezio.crm:${props.audience}.${target}.${operation}`,
      contextId:props.contextId,input,isCurrent:()=>current(token)});}
    catch{if(current(token)&&!silent)setError('Connexion interrompue. Vérifiez les données avant de réessayer.');
      return null;}
    if(!current(token))return null;
    if(result.kind==='execution'&&result.execution.state==='succeeded')return result.execution.output as Record<string,unknown>;
    if(!silent)setError(result.kind==='unknown'?'Résultat incertain. Vérifiez les données avant une nouvelle modification.':
      result.kind==='rejected'&&result.code==='conflict'?'Fiche modifiée ailleurs. Actualisez la liste puis rouvrez la fiche avant de reprendre vos modifications.':
      'Opération refusée ou indisponible.');
    return null;
  },[props.client,props.audience,props.contextId,current]);
  const referenceFetch=useCallback(async(kind:'company'|'contact',term:string,id?:string):Promise<Item[]|Item|null>=>{
    const token=generation.current;
    const output=await invoke(kind,id?'read':term.trim()?'search':'list',id?{id}:
      term.trim()?{limit:25,query:term.trim()}:{limit:25},token,true);
    if(!current(token)||!output)return null;
    return id?output.item as Item:Array.isArray(output.items)?output.items as Item[]:null;
  },[invoke,current]);
  const persist=(section:Entity,term:string,showArchived:boolean)=>props.navigation.savePanelState({
    activeSubview:section,data:{entity:section,query:term,archived:showArchived,
      ...(journal.current.pending?{pending:journal.current.pending}:{})}});
  const refresh=useCallback(async(token:number,section:Entity,term:string,showArchived:boolean,
    append=false,cursor?:string)=>{
    if(!current(token))return;
    const serial=++listSerial.current;
    setLoading(true);
    const trimmed=term.trim();
    const output=await invoke(section,trimmed?'search':'list',trimmed?
      {limit:25,query:trimmed,archived:showArchived,...(cursor?{cursor}:{})}:
      {limit:25,archived:showArchived,...(cursor?{cursor}:{})},token);
    if(current(token)&&serial===listSerial.current){
      if(output&&Array.isArray(output.items)){
        const rows=output.items as Item[];
        setItems(previous=>append?[...previous,...rows.filter(row=>!previous.some(old=>old.id===row.id))]:rows);
        setNextCursor(typeof output.nextCursor==='string'?output.nextCursor:null);
        setAppliedQuery(trimmed);
      }
      setLoading(false);
    }
  },[current,invoke]);
  useEffect(()=>{
    const token=generation.current;listSerial.current++;
    const prior=panelIdentity.current;
    const scopeChanged=prior.session!==session||prior.audience!==props.audience||
      prior.contextId!==props.contextId;
    const changed=scopeChanged||prior.client!==props.client||prior.access!==props.access||
      prior.entity!==entity||prior.archived!==archived;
    panelIdentity.current={session,entity,archived,client:props.client,access:props.access,
      audience:props.audience,contextId:props.contextId};
    if(scopeChanged||!session){subviewDrafts.current={};setName('');setCity('');setQuery('');setAppliedQuery('');setArchived(false);
      journal.current=createCommandJournal();busyRef.current=false;setBusy(false);setChecking(false);}
    if(changed||!session){setItems([]);setNextCursor(null);setError('');}
    if(scopeChanged||!session){setSelected(null);setSelectedSnapshot(null);setForm(null);}
    if(!active||!session){setLoading(false);setChecking(false);return;}
    busyRef.current=!!journal.current.pending;setBusy(busyRef.current);
    void refresh(token,entity,scopeChanged?'':appliedQueryRef.current,scopeChanged?false:archived);
  },[active,session,entity,archived,refresh,props.client,props.access,props.audience,props.contextId]);
  const selectedItem=items.find(item=>item.id===selected)??(selectedSnapshot?.id===selected?selectedSnapshot:null);
  const choose=(id:string)=>{const item=items.find(value=>value.id===id);if(!item)return;
    setSelected(id);setSelectedSnapshot(item);setForm(formFrom(item));};
  const changeEntity=(next:Entity)=>{if(next===entity||busyRef.current)return;
    subviewDrafts.current=saveSubviewDraft(subviewDrafts.current,entity,{name,city,query,appliedQuery,archived,
      selected,selectedSnapshot,form});
    const draft=subviewDrafts.current[next]??emptySubviewDraft();
    setEntity(next);setName(draft.name);setCity(draft.city);setQuery(draft.query);
    setAppliedQuery(draft.appliedQuery);setArchived(draft.archived);
    setSelected(draft.selected);setSelectedSnapshot(draft.selectedSnapshot);setForm(draft.form);
    setItems([]);setNextCursor(null);persist(next,draft.appliedQuery,draft.archived);};
  const changeArchived=(next:boolean)=>{if(busyRef.current)return;setArchived(next);setSelected(null);setSelectedSnapshot(null);setForm(null);
    persist(entity,appliedQuery,next);};
  const command=async(action:PendingCrmCommand['action'],input:Record<string,unknown>,syncForm=false)=>{
    if(busyRef.current)return null;busyRef.current=true;setBusy(true);setError('');
    const token=generation.current,operationJournal=journal.current;
    try{
      const result=await operationJournal.execute(props.client,props,{entity,action,requestKey:crypto.randomUUID(),
        sessionId:session,contextId:props.contextId,audience:props.audience},input,
        ()=>current(token),()=>persist(entity,appliedQuery,archived));
      if(!current(token))return null;
      const output=result.kind==='execution'&&result.execution.state==='succeeded'?
        result.execution.output as Record<string,unknown>:null;
      if(!output)setError(result.kind==='rejected'&&result.code==='client_state_unavailable'?
        'Le navigateur ne peut pas conserver le suivi de cette action. Aucune modification n’a été envoyée.':
        operationJournal.pending?'Résultat incertain. Vérifiez cette action avant une nouvelle modification.':
        'Modification refusée. Actualisez la liste puis rouvrez la fiche si elle a changé.');
      if(output&&current(token)){
        if(action==='create'){setName('');setCity('');}
        if(output.item&&selectedRef.current===(output.item as Item).id){setSelectedSnapshot(output.item as Item);
          if(syncForm)setForm(formFrom(output.item as Item));}
        await refresh(token,entity,appliedQuery,archived);
      }
      return current(token)?output:null;
    }catch{if(current(token))setError('Connexion interrompue. Vérifiez les données avant de réessayer.');return null;}
    finally{if(current(token)){busyRef.current=!!operationJournal.pending;setBusy(busyRef.current);persist(entity,appliedQuery,archived);}}
  };
  const inspectCommand=async()=>{
    const token=generation.current,operationJournal=journal.current,command=operationJournal.pending;
    if(checking||!command)return;setChecking(true);
    const result=await operationJournal.inspect(props.client,props,()=>current(token));
    if(!current(token))return;
    if(result?.kind==='execution'&&result.execution.state==='succeeded'){
      setError('Modification confirmée. Les données ont été actualisées.');
      if(command.action==='create'){setName('');setCity('');}
      const item=(result.execution.output as Record<string,unknown>).item as Item|undefined;
      if(item&&selectedRef.current===item.id){
        if(command.action==='archive'||command.action==='restore'){
          setSelected(null);setSelectedSnapshot(null);setForm(null);
        }else{
          setSelectedSnapshot(item);
          setForm(previous=>previous?.id===item.id?{...previous,revision:item.revision,
            ...(item.stage!==undefined?{stage:item.stage}:{}),
            ...(item.position!==undefined?{position:String(item.position)}:{})}:previous);
        }
      }
      await refresh(token,entity,appliedQuery,archived);
    }else setError(operationJournal.pending?'Résultat encore incertain. Aucune action n’a été rejouée.':'La modification a été refusée.');
    if(current(token)){busyRef.current=!!operationJournal.pending;setBusy(busyRef.current);setChecking(false);
      persist(entity,appliedQuery,archived);}
  };
  const create=async()=>{
    if(!name.trim()||archived)return;
    const ok=await command('create',{name:name.trim(),city:city.trim()||null,
      ...(entity==='prospect'?{stage:'a_contacter',position:Date.now()}:{} )});
    if(ok){setName('');setCity('');}
  };
  const move=async(item:Prospect,stage:string,position:number)=>{
    const output=await command('update',{id:item.id,revision:item.revision,stage,position});
    const changed=output?.item as Item|undefined;
    if(changed)setForm(previous=>previous?.id===item.id&&previous.revision===item.revision?
      {...previous,stage:String(changed.stage),position:String(changed.position),revision:changed.revision}:previous);
  };
  const loadMore=async()=>{
    if(!nextCursor||loading)return;
    const token=generation.current;
    await refresh(token,entity,appliedQuery,archived,true,nextCursor);
  };
  const changeField=(field:CrmEditField,value:string)=>setForm(previous=>previous?{...previous,[field]:value}:previous);
  const save=async()=>{if(!selectedItem||!form||form.id!==selectedItem.id||!form.name.trim()||busy)return;
    await command('update',updateFromForm(entity,form),true);
  };
  const changeState=async()=>{if(!selectedItem||!form||form.id!==selectedItem.id||busy)return;
    const output=await command(archived?'restore':'archive',{id:selectedItem.id,revision:form.revision});
    if(output&&selectedRef.current===selectedItem.id){setSelected(null);setForm(null);}
  };
  if(!active||!session)return <div className="p-6 text-sm">CRM indisponible pour cette session.</div>;
  return <div className="flex w-full flex-col gap-4 p-6">
    <nav className="flex gap-2" aria-label="Sections CRM">{(['prospect','contact','company'] as Entity[]).map(value=>
      <button key={value} type="button" disabled={busy} className={buttonStyle} aria-current={entity===value?'page':undefined}
        onClick={()=>changeEntity(value)}>{labels[value]}</button>)}</nav>
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{labels[entity]}</h1>
        {entity==='prospect'&&!archived?<p className="text-sm text-muted-foreground">Glissez-déposez les cartes d'une colonne à l'autre.</p>:null}</div>
      {!archived?<div className="flex flex-wrap items-end gap-2">
        <input className={`${inputStyle} w-56`} aria-label="Nom" placeholder={entity==='prospect'?'Nom du prospect':'Nom'}
          value={name} disabled={busy} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void create();}}/>
        <input className={`${inputStyle} w-36`} aria-label="Ville" placeholder="Ville" value={city}
          disabled={busy} onChange={event=>setCity(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void create();}}/>
        <button className={buttonStyle} type="button" disabled={!name.trim()||busy} onClick={()=>void create()}>Ajouter</button>
      </div>:null}
    </header>
    <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();persist(entity,query,archived);
      void refresh(generation.current,entity,query,archived);}}>
      <input className={inputStyle} aria-label="Rechercher" placeholder="Rechercher" value={query}
        onChange={event=>setQuery(event.target.value)}/>
      <button className={buttonStyle} type="submit">Rechercher</button>
      <button className={buttonStyle} type="button" onClick={()=>void refresh(generation.current,entity,query,archived)}>Actualiser</button>
      <button className={buttonStyle} type="button" aria-pressed={archived} onClick={()=>changeArchived(!archived)}>
        {archived?'Afficher les fiches actives':'Afficher les archives'}</button>
    </form>
    {error?<p role="alert" className="text-sm text-destructive">{error}</p>:null}
    {journal.current.pending?<button type="button" className={buttonStyle} disabled={checking}
      onClick={()=>void inspectCommand()}>Vérifier la dernière modification</button>:null}
    {entity==='prospect'&&!archived?<ProspectKanban items={items as Prospect[]} loading={loading} selectedId={selected}
      onSelect={choose} onMove={(item,stage,position)=>void move(item,stage,position)}/>:
      <div className="grid gap-2 md:grid-cols-3">{items.map(item=><button key={item.id} type="button"
        className="rounded-lg border bg-card p-3 text-left" onClick={()=>choose(item.id)}>
        <strong className="block text-sm">{item.name}</strong>
        <span className="text-xs text-muted-foreground">{[item.city,item.email,item.phone].filter(Boolean).join(' · ')||'—'}</span>
      </button>)}</div>}
    {!loading&&!items.length&&!nextCursor?<p className="text-sm text-muted-foreground">Aucune fiche.</p>:null}
    {nextCursor?<button type="button" className={buttonStyle} disabled={loading} onClick={()=>void loadMore()}>Afficher plus</button>:null}
    {selectedItem&&form?<section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{selectedItem.name}</h2>
        <div className="flex gap-2"><button type="button" className={buttonStyle} onClick={()=>{setSelected(null);setForm(null);}}>Fermer</button>
          <button type="button" className={buttonStyle} disabled={busy} onClick={()=>void changeState()}>
            {archived?'Restaurer':'Archiver'}</button></div></div>
      <fieldset disabled={busy||archived} className="grid gap-2 md:grid-cols-2">
        <input className={inputStyle} aria-label="Nom de la fiche" value={form.name} disabled={archived}
          onChange={event=>changeField('name',event.target.value)}/>
        <input className={inputStyle} aria-label="Ville de la fiche" placeholder="Ville" value={form.city} disabled={archived}
          onChange={event=>changeField('city',event.target.value)}/>
        {entity!=='company'?<><input className={inputStyle} aria-label="Adresse e-mail" placeholder="E-mail"
          value={form.email} disabled={archived} onChange={event=>changeField('email',event.target.value)}/>
          <input className={inputStyle} aria-label="Téléphone" placeholder="Téléphone" value={form.phone}
            disabled={archived} onChange={event=>changeField('phone',event.target.value)}/></>:null}
        {entity!=='contact'?<input className={inputStyle} aria-label="Site web" placeholder="Site web"
          value={form.website} disabled={archived} onChange={event=>changeField('website',event.target.value)}/>:null}
        {entity==='prospect'?<><input className={inputStyle} aria-label="Nom du contact" placeholder="Nom du contact"
          value={form.contactName} disabled={archived} onChange={event=>changeField('contactName',event.target.value)}/>
          <select className={inputStyle} aria-label="Étape" value={form.stage} disabled={archived}
            onChange={event=>changeField('stage',event.target.value)}>{stages.map(stage=><option key={stage.id} value={stage.id}>{stage.label}</option>)}</select>
          <input className={inputStyle} type="number" min="0" step="1" aria-label="Position" value={form.position}
            disabled={archived} onChange={event=>changeField('position',event.target.value)}/></>:null}
      </fieldset>
      {!archived&&entity!=='company'?<div className="flex flex-wrap gap-3">
        <ReferencePicker key={`${selectedItem.id}-company`} kind="company" value={form.companyId}
          disabled={busy} fetch={referenceFetch} onChange={id=>changeField('companyId',id)}/>
        {entity==='prospect'?<ReferencePicker key={`${selectedItem.id}-contact`} kind="contact" value={form.contactId}
          disabled={busy} fetch={referenceFetch} onChange={id=>changeField('contactId',id)}/>:null}
      </div>:null}
      <textarea className="min-h-20 w-full rounded-md border bg-transparent p-2 text-sm" aria-label="Notes"
        placeholder="Notes (contact, contexte, prochaine action…)" value={form.notes} disabled={archived||busy}
        onChange={event=>changeField('notes',event.target.value)}/>
      {!archived?<div><button type="button" className={buttonStyle} disabled={busy||!form.name.trim()}
        onClick={()=>void save()}>Enregistrer</button></div>:null}
    </section>:null}
  </div>;
}
