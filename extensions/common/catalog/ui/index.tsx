'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type ChangeEvent} from 'react';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {createCommandJournal,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {createFileClient} from '@creezio/sdk/files/client';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import {call,errorText,operationResult,requestKey,type Attribute,type Category,type Media,type Page,
  type Product,type ProductSummary,type Result} from './contracts.ts';
import {money} from './money.ts';
import {catalogPanelState,readCatalogPanelState} from './panel-state.ts';
import {retainedSessionId,sameCatalogScope,sessionVerified} from './session.ts';

type Tab='products'|'categories';
type Form={sku:string;name:string;description:string;attributesText:string;categoryId:string;
  priceMinor:string;currency:string};
const blank=():Form=>({sku:'',name:'',description:'',attributesText:'',categoryId:'',
  priceMinor:'0',currency:'EUR'});
const formFrom=(product:Product):Form=>({sku:product.sku,name:product.name,
  description:product.description,attributesText:product.attributes.map(item=>`${item.key}=${item.value}`).join('\n'),
  categoryId:product.categoryId??'',priceMinor:String(product.priceMinor),currency:product.currency});
function attributes(value:string):Attribute[]{
  if(!value.trim())return [];
  const items=value.split('\n').map(line=>line.trim()).filter(Boolean);
  if(items.length>12)throw Error('Au plus 12 attributs.');
  return items.map(line=>{const at=line.indexOf('=');if(at<1)throw Error('Un attribut doit être écrit clé=valeur.');
    return {key:line.slice(0,at).trim(),value:line.slice(at+1).trim()};});
}
const input='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
const button=`${input} hover:bg-slate-50`;
const label='grid gap-1 text-sm text-slate-700';
const panel='rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
/** WinHub's admin product/category workflow, adapted to the native SDK and D1/R2 ports. */
export function CatalogAdminView(props:RuntimeViewProps){
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const enabled=props.active&&props.authorized&&sessionVerified(access,sessionId);
  const initialPanel=useRef(props.navigation.readPanelState());
  const saved=initialPanel.current;
  const verifiedInitial=readCatalogPanelState(saved?.data,{sessionId,audience:props.audience,
    contextId:props.contextId});
  const journal=useRef(sessionId?createCommandJournal({sessionId,audience:props.audience,
    contextId:props.contextId},verifiedInitial?saved?.data?.pending:null):null);
  const journalScope=useRef({sessionId,audience:props.audience,contextId:props.contextId});
  const [pending,setPending]=useState<PendingCommand|null>(journal.current?.pending??null);
  const [checking,setChecking]=useState(false);
  const [tab,setTab]=useState<Tab>(verifiedInitial?.tab??'products');
  const [queryInput,setQueryInput]=useState(verifiedInitial?.query??''),
    [query,setQuery]=useState(verifiedInitial?.query??''),
    [categoryFilter,setCategoryFilter]=useState(verifiedInitial?.categoryId??''),
    [statusFilter,setStatusFilter]=useState('');
  const [categories,setCategories]=useState<Category[]>([]),[categoryCursor,setCategoryCursor]=useState<string|null>(null),
    [products,setProducts]=useState<ProductSummary[]>([]),
    [cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState(verifiedInitial?.selectedId??''),
    [full,setFull]=useState<Product|null>(null),[form,setForm]=useState<Form>(blank),
    [media,setMedia]=useState<Media[]>([]),[loading,setLoading]=useState(false),
    [busy,setBusy]=useState(!!journal.current?.pending),
    [notice,setNotice]=useState('');
  const [categoryName,setCategoryName]=useState(''),[categorySlug,setCategorySlug]=useState(''),
    [categoryParent,setCategoryParent]=useState(''),[categoryPosition,setCategoryPosition]=useState('0'),
    [editingCategory,setEditingCategory]=useState<Category|null>(null);
  const epoch=useRef(0),listSerial=useRef(0),categorySerial=useRef(0),detailSerial=useRef(0),selectedRef=useRef(selected),
    listKey=useRef(JSON.stringify([query,categoryFilter,statusFilter])),
    editingCategoryRef=useRef(editingCategory?.id??''),
    previous=useRef({sessionId,client:props.client,access:props.access,audience:props.audience,
      contextId:props.contextId}),live=useRef({enabled,sessionId,client:props.client,access:props.access,
      audience:props.audience,contextId:props.contextId});
  const retainedForm=useRef({full,form});retainedForm.current={full,form};
  selectedRef.current=selected;
  editingCategoryRef.current=editingCategory?.id??'';
  const visibleListKey=JSON.stringify([query,categoryFilter,statusFilter]);
  if(listKey.current!==visibleListKey){listKey.current=visibleListKey;listSerial.current++;}
  const panelRef=useRef({tab,query,categoryFilter,selected});
  panelRef.current={tab,query,categoryFilter,selected};
  const ownScope=sameCatalogScope(previous.current,{sessionId,audience:props.audience,
    contextId:props.contextId});
  const identityChanged=!ownScope||previous.current.client!==props.client||
    previous.current.access!==props.access;
  if(identityChanged||live.current.enabled!==enabled)epoch.current++;
  live.current={enabled,sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId};
  const mark=epoch.current;
  const current=()=>epoch.current===mark&&live.current.enabled&&live.current.sessionId===sessionId
    &&live.current.client===props.client&&live.current.access===props.access
    &&live.current.audience===props.audience&&live.current.contextId===props.contextId
    &&props.access.getSnapshot().session?.id===sessionId;
  const scope={client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};
  useRegisterWorkspaceMetadata(props.panelId,{title:'Catalogue',kind:'section',
    trail:[{label:'Catalogue'},...(full?[{label:full.name}]:[])]});
  const persistPending=(value:PendingCommand|null)=>{
    if(!current())return false;
    const panel=panelRef.current;
    const saved=props.navigation.savePanelState(catalogPanelState({sessionId,audience:props.audience,
      contextId:props.contextId,tab:panel.tab,query:panel.query,
      categoryId:panel.categoryFilter,selectedId:selectedRef.current},value));
    if(saved)setPending(value);
    return saved;
  };
  async function mutate<T>(operation:string,input:Record<string,unknown>,valid:()=>boolean=current):Promise<Result<T>>{
    const controller=journal.current;
    if(!controller||!current())return {kind:'error',code:'stale'};
    if(operation.startsWith('category.'))categorySerial.current++;
    if(operation.startsWith('product.')||operation.startsWith('media.'))detailSerial.current++;
    const targetId=typeof input.productId==='string'?input.productId:
      typeof input.id==='string'?input.id:undefined;
    const outcome=await controller.execute(props.client,{sessionId,audience:props.audience,
      contextId:props.contextId,bindingId:`creezio.catalog:${props.audience}.${operation}`,
      requestKey:requestKey(),intent:operation,...(targetId?{targetId}:{})},input,valid,persistPending);
    if(journal.current===controller){setPending(outcome.pending);setBusy(!!outcome.pending);}
    return operationResult<T>(outcome.result);
  }
  useEffect(()=>{if(!identityChanged)return;previous.current={sessionId,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId};
    if(ownScope){listSerial.current++;categorySerial.current++;detailSerial.current++;setLoading(false);return;}
    let restored:ReturnType<typeof readCatalogPanelState>=null;
    if(journalScope.current.sessionId!==sessionId||journalScope.current.audience!==props.audience||
      journalScope.current.contextId!==props.contextId){
      const savedPanel=props.navigation.readPanelState();
      restored=readCatalogPanelState(savedPanel?.data,{sessionId,audience:props.audience,
        contextId:props.contextId});
      journalScope.current={sessionId,audience:props.audience,contextId:props.contextId};
      journal.current=sessionId?createCommandJournal(journalScope.current,
        restored?savedPanel?.data?.pending:null):null;
      initialPanel.current=null;setPending(journal.current?.pending??null);setChecking(false);
    }
    listSerial.current++;categorySerial.current++;detailSerial.current++;setTab(restored?.tab??'products');
    setQueryInput(restored?.query??'');setQuery(restored?.query??'');
    setCategoryFilter(restored?.categoryId??'');setStatusFilter('');setCategories([]);setCategoryCursor(null);
    setProducts([]);setCursor(null);
    selectedRef.current=restored?.selectedId??'';setSelected(restored?.selectedId??'');
    panelRef.current={tab:restored?.tab??'products',query:restored?.query??'',
      categoryFilter:restored?.categoryId??'',selected:restored?.selectedId??''};
    setFull(null);setForm(blank());setMedia([]);setNotice('');setEditingCategory(null);
    setBusy(!!journal.current?.pending);setLoading(false);
  },[identityChanged,ownScope,sessionId,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{if(access.phase==='authenticated'&&!access.pending&&!props.authorized){setProducts([]);setCategories([]);setCategoryCursor(null);
    setFull(null);setMedia([]);
    setCursor(null);}},[props.authorized,access.phase,access.pending]);
  useEffect(()=>{if(enabled&&!identityChanged)props.navigation.savePanelState(catalogPanelState({
    sessionId,audience:props.audience,contextId:props.contextId,tab,query,
    categoryId:categoryFilter,selectedId:selected},journal.current?.pending??null));},
  [enabled,identityChanged,sessionId,props.audience,props.contextId,props.navigation,
    tab,query,categoryFilter,selected]);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(queryInput.trim()),300);return()=>clearTimeout(timer);},[queryInput]);
  const loadCategories=useCallback(async(next?:string)=>{
    if(!current())return;
    const serial=++categorySerial.current;
    const result:Result<Page<Category>>=await call<Page<Category>>(scope,'category.list',{limit:50,
      ...(next?{cursor:next}:{})},current);
    if(!current()||serial!==categorySerial.current)return;
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setCategories(old=>next?[...old,...result.value.items.filter(item=>
      !old.some(existing=>existing.id===item.id))]:result.value.items);
    setCategoryCursor(result.value.nextCursor);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  const loadProducts=useCallback(async(append=false,next?:string)=>{
    if(!current())return;
    const serial=++listSerial.current;setLoading(true);
    const result=await call<Page<ProductSummary>>(scope,'product.list',{limit:25,
      ...(query?{query}:{}),...(categoryFilter?{categoryId:categoryFilter}:{}),
      ...(statusFilter?{status:statusFilter}:{}),...(next?{cursor:next}:{})},current);
    if(!current()||serial!==listSerial.current)return;
    setLoading(false);
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setNotice('');setProducts(old=>append?[...old,...result.value.items.filter(item=>
      !old.some(existing=>existing.id===item.id))]:result.value.items);
    setCursor(result.value.nextCursor);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled,query,categoryFilter,statusFilter]);
  useEffect(()=>{if(enabled)void loadCategories();},[enabled,loadCategories]);
  useEffect(()=>{if(enabled)void loadProducts();},[enabled,loadProducts]);
  const loadDetail=useCallback(async(id:string)=>{
    if(!current())return;
    const serial=++detailSerial.current,valid=()=>current()&&serial===detailSerial.current
      &&selectedRef.current===id;
    const result=await call<{product:Product}>(scope,'product.read',{id},valid);
    if(!valid())return;
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setFull(result.value.product);setForm(formFrom(result.value.product));
    const images=await call<{items:Media[]}>(scope,'media.list',{productId:id},valid);
    if(valid()&&images.kind==='ok')setMedia(images.value.items);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{if(!enabled||!selected)return;
    const retained=retainedForm.current;
    if(retained.full?.id===selected&&
      JSON.stringify(retained.form)!==JSON.stringify(formFrom(retained.full)))return;
    void loadDetail(selected);
  },[selected,enabled,loadDetail]);
  const choose=(id:string)=>{selectedRef.current=id;detailSerial.current++;setSelected(id);setFull(null);
    setMedia([]);setNotice('');};
  const inspectPending=async()=>{
    const controller=journal.current,issued=controller?.pending;
    if(!controller||!issued||!current()||checking)return;
    setChecking(true);
    try{const outcome=await controller.inspect(props.client,current,persistPending);
      if(!outcome||!current()||journal.current!==controller)return;
      setPending(outcome.pending);setBusy(!!outcome.pending);
      const result=operationResult<Record<string,unknown>>(outcome.result);
      if(result.kind==='error'){setNotice(errorText(result.code));return;}
      setNotice(outcome.pending?'Action confirmée ; suivi local encore à enregistrer.':
        'Action confirmée sans réémettre la demande.');
      void loadCategories();void loadProducts();
      const product=result.value.product as Product|undefined;
      if(issued.intent==='product.create'&&product&&selectedRef.current===''){
        selectedRef.current=product.id;setSelected(product.id);setFull(product);setForm(formFrom(product));
      }else if(issued.targetId&&selectedRef.current===issued.targetId
        &&(issued.intent?.startsWith('product.')||issued.intent?.startsWith('media.')))
        void loadDetail(issued.targetId);
      if(issued.intent?.startsWith('category.')&&result.value.category){
        const category=result.value.category as Category;
        if((!issued.targetId&&editingCategoryRef.current==='')||
          (issued.targetId&&editingCategoryRef.current===category.id)){
          editingCategoryRef.current='';setEditingCategory(null);setCategoryName('');setCategorySlug('');
          setCategoryParent('');setCategoryPosition('0');
        }
      }
    }finally{if(journal.current===controller)setChecking(false);}
  };
  const edit=(name:keyof Form,value:string)=>setForm(old=>({...old,[name]:value}));
  const saveProduct=async()=>{
    if(busy||!current())return;
    const selectedAtStart=selectedRef.current,valid=()=>current()&&selectedRef.current===selectedAtStart;
    let parsed:Attribute[];
    try{parsed=attributes(form.attributesText);}catch(error){setNotice(String(error));return;}
    if(!/^\d+$/u.test(form.priceMinor)||!Number.isSafeInteger(Number(form.priceMinor))){
      setNotice('Prix en unités mineures : entier positif requis.');return;}
    const input={sku:form.sku.trim(),name:form.name.trim(),
      description:form.description,attributes:parsed,categoryId:form.categoryId||null,
      priceMinor:Number(form.priceMinor),currency:form.currency.trim().toUpperCase(),
      ...(full?{id:full.id,revision:full.revision}:{})};
    setBusy(true);
    const result=await mutate<{product:Product}>(full?'product.update':'product.create',input,valid);
    if(!current())return;setBusy(!!journal.current?.pending);if(!valid())return;
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setNotice('Produit enregistré.');setFull(result.value.product);setForm(formFrom(result.value.product));
    selectedRef.current=result.value.product.id;setSelected(result.value.product.id);void loadProducts();
  };
  const transition=async(operation:'product.publish'|'product.archive')=>{
    if(!full||busy||!current())return;
    const selectedAtStart=selectedRef.current,valid=()=>current()&&selectedRef.current===selectedAtStart;
    setBusy(true);
    const result=await mutate<{product:Product}>(operation,{id:full.id,revision:full.revision},valid);
    if(!current())return;setBusy(!!journal.current?.pending);if(!valid())return;
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setFull(result.value.product);setForm(formFrom(result.value.product));
    setNotice(operation==='product.publish'?'Produit publié.':'Produit archivé.');void loadProducts();
  };
  const saveCategory=async()=>{
    if(busy||!current())return;
    const categoryAtStart=editingCategoryRef.current,
      valid=()=>current()&&editingCategoryRef.current===categoryAtStart;
    const input={name:categoryName.trim(),slug:categorySlug.trim(),
      position:Number(categoryPosition),...(editingCategory?
        {id:editingCategory.id,revision:editingCategory.revision}:{parentId:categoryParent||null})};
    setBusy(true);
    const result=await mutate<{category:Category}>(editingCategory?'category.update':'category.create',input,valid);
    if(!current())return;setBusy(!!journal.current?.pending);if(!valid())return;
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setNotice('Catégorie enregistrée.');setEditingCategory(null);setCategoryName('');setCategorySlug('');
    setCategoryParent('');setCategoryPosition('0');void loadCategories();
  };
  const archiveCategory=async(category:Category)=>{
    if(busy||!current())return;
    setBusy(true);
    const result=await mutate<{category:Category}>('category.archive',{
      id:category.id,revision:category.revision},current);
    if(!current())return;setBusy(!!journal.current?.pending);
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setNotice('Catégorie archivée.');void loadCategories();
  };
  const upload=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';
    if(!file||!full||busy||!current())return;
    const id=full.id,revision=full.revision,controller=journal.current,
      valid=()=>current()&&selectedRef.current===id;
    setBusy(true);
    try{const files=createFileClient({access:props.access,moduleId:'creezio.catalog',categoryId:'images',
        contextId:props.contextId});
      const staged=await files.upload({file,filename:file.name,intentId:requestKey(),isCurrent:valid});
      if(!valid())return;
      if(staged.kind!=='ready'){setNotice('Dépôt R2 indisponible. Vérifiez avant de recommencer.');return;}
      const result=await mutate<{media:Media;product:Product}>('media.link',{
        productId:id,revision,staged:staged.value.reference},valid);
      if(!valid())return;
      if(result.kind==='error'){setNotice('Image déposée mais lien non confirmé. Relisez le produit avant de réessayer.');return;}
      setFull(result.value.product);setForm(formFrom(result.value.product));
      setMedia(old=>[result.value.media,...old]);setNotice('Image liée au produit.');
    }finally{if(journal.current===controller)setBusy(!!controller?.pending);}
  };
  const unlink=async(item:Media)=>{
    if(!full||busy||!current())return;
    const id=full.id,valid=()=>current()&&selectedRef.current===id;
    setBusy(true);
    const result=await mutate<{removed:true;product:Product}>('media.unlink',{
      productId:id,revision:full.revision,fileId:item.fileId},valid);
    if(!current())return;setBusy(!!journal.current?.pending);if(!valid())return;
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setFull(result.value.product);setForm(formFrom(result.value.product));
    setMedia(old=>old.filter(value=>value.fileId!==item.fileId));setNotice('Lien retiré ; fichier R2 conservé.');
  };
  const download=async(item:Media)=>{
    const files=createFileClient({access:props.access,moduleId:'creezio.catalog',categoryId:'images',
      contextId:props.contextId});
    const id=selected,valid=()=>current()&&selectedRef.current===id;
    const result=await files.download(item.reference,valid);
    if(!valid())return;
    if(result.kind!=='ready'){setNotice('Lecture privée du média indisponible.');return;}
    const url=URL.createObjectURL(result.value),anchor=document.createElement('a');anchor.href=url;
    anchor.download=item.filename;document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
  if(!enabled||!ownScope)return <p className="p-6 text-sm text-slate-500">Catalogue disponible après connexion autorisée.</p>;
  return <main className="space-y-5 p-5 text-slate-900"><header><h1 className="text-2xl font-semibold">Catalogue</h1>
    <p className="text-sm text-slate-600">Produits et catégories du contexte courant</p></header>
    <nav className="flex gap-2" aria-label="Administration catalogue">
      {(['products','categories'] as const).map(value=><button key={value} className={`${button} ${tab===value?'border-indigo-500 bg-indigo-50':''}`}
        aria-current={tab===value?'page':undefined} onClick={()=>setTab(value)}>
        {value==='products'?'Produits':'Catégories'}</button>)}</nav>
    {notice&&<p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">{notice}</p>}
    {pending&&<div role="status" className="flex items-center gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      <p>Une action attend sa confirmation. Les nouvelles modifications sont suspendues.</p>
      <button className={button} disabled={checking} onClick={()=>void inspectPending()}>
        {checking?'Vérification…':'Vérifier le résultat'}</button></div>}
    {tab==='products'&&<div className="grid gap-5 lg:grid-cols-[minmax(250px,1fr)_minmax(340px,1.3fr)]">
      <section className={`${panel} space-y-3`}><div className="flex flex-wrap gap-2">
        <input className={input} value={queryInput} maxLength={120} placeholder="Rechercher SKU ou nom"
          aria-label="Rechercher" onChange={event=>setQueryInput(event.target.value)}/>
        <select className={input} value={categoryFilter} aria-label="Filtrer par catégorie"
          onChange={event=>setCategoryFilter(event.target.value)}><option value="">Toutes catégories</option>
          {categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {categoryCursor&&<button className={button} onClick={()=>void loadCategories(categoryCursor)}>
            Plus de catégories</button>}
        <select className={input} value={statusFilter} aria-label="Statut"
          onChange={event=>setStatusFilter(event.target.value)}><option value="">Tous statuts</option>
          <option value="draft">Brouillons</option><option value="published">Publiés</option>
          <option value="archived">Archivés</option></select></div>
        <button className={button} onClick={()=>{choose('');setForm(blank());}}>+ Nouveau produit</button>
        {products.length===0&&<p className="text-sm text-slate-500">{loading?'Chargement…':'Aucun produit sur cette page.'}</p>}
        <ul className="divide-y">{products.map(item=><li key={item.id}><button className="w-full py-3 text-left"
          onClick={()=>choose(item.id)}><div className="flex justify-between gap-2"><span className="font-medium">{item.name}</span>
          <span>{money(item.priceMinor,item.currency)}</span></div><div className="flex justify-between text-xs text-slate-500">
          <span>{item.sku}</span><span>{item.status}</span></div></button></li>)}</ul>
        {cursor&&<button className={button} disabled={loading} onClick={()=>void loadProducts(true,cursor)}>
          {loading?'Chargement…':'Afficher plus'}</button>}</section>
      <section className={`${panel} space-y-3`}><h2 className="text-lg font-semibold">{full?'Modifier le produit':'Nouveau produit'}</h2>
        {selected&&!full?<p className="text-sm text-slate-500">Lecture du produit…</p>:<>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>SKU<input className={input} value={form.sku} maxLength={80}
              onChange={event=>edit('sku',event.target.value)}/></label>
            <label className={label}>Nom<input className={input} value={form.name} maxLength={160}
              onChange={event=>edit('name',event.target.value)}/></label>
            <label className={label}>Prix en unités mineures<input className={input} inputMode="numeric"
              value={form.priceMinor} onChange={event=>edit('priceMinor',event.target.value)}/></label>
            <label className={label}>Devise ISO (3 lettres)<input className={input} value={form.currency} maxLength={3}
              onChange={event=>edit('currency',event.target.value)}/></label>
            <label className={label}>Catégorie<select className={input} value={form.categoryId}
              onChange={event=>edit('categoryId',event.target.value)}><option value="">Sans catégorie</option>
              {categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div><label className={label}>Description<textarea className={input} rows={4} value={form.description}
            maxLength={1200} onChange={event=>edit('description',event.target.value)}/></label>
          <label className={label}>Attributs (une ligne clé=valeur)<textarea className={input} rows={4}
            value={form.attributesText} onChange={event=>edit('attributesText',event.target.value)}/></label>
          <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>void saveProduct()}>
            {busy?'En cours…':'Enregistrer'}</button>
            {full?.status==='draft'&&<button className={button} disabled={busy}
              onClick={()=>void transition('product.publish')}>Publier</button>}
            {full&&full.status!=='archived'&&<button className={button} disabled={busy}
              onClick={()=>void transition('product.archive')}>Archiver</button>}</div>
          {full&&<p className="text-xs text-slate-500">Statut {full.status} · révision {full.revision} · {money(full.priceMinor,full.currency)}</p>}
          {full&&<section className="space-y-2 border-t pt-3"><h3 className="font-medium">Images privées</h3>
            <p className="text-xs text-slate-500">R2 admin ; non diffusées au front. Maximum 5 images liées.</p>
            {full.status!=='archived'&&<input type="file" accept="image/png,image/jpeg,image/webp"
              disabled={busy||media.length>=5} onChange={event=>void upload(event)}/>}
            <ul className="space-y-1">{media.map(item=><li key={item.fileId} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{item.filename}</span><button className={button} onClick={()=>void download(item)}>Télécharger</button>
              {full.status!=='archived'&&<button className={button} disabled={busy}
                onClick={()=>void unlink(item)}>Détacher</button>}</li>)}</ul></section>}</>}</section></div>}
    {tab==='categories'&&<div className="grid gap-5 lg:grid-cols-2"><section className={`${panel} space-y-2`}>
      <h2 className="font-semibold">Catégories</h2><ul className="divide-y">{categories.map(item=><li key={item.id}
        className="flex items-center justify-between gap-2 py-2 text-sm"><span>{item.name} <small className="text-slate-500">/{item.slug}</small></span>
        <span className="flex gap-1"><button className={button} onClick={()=>{editingCategoryRef.current=item.id;
          setEditingCategory(item);
          setCategoryName(item.name);setCategorySlug(item.slug);setCategoryPosition(String(item.position));
          setCategoryParent(item.parentId??'');}}>Modifier</button><button className={button} disabled={busy}
          onClick={()=>void archiveCategory(item)}>Archiver</button></span></li>)}</ul>
        {categoryCursor&&<button className={button} onClick={()=>void loadCategories(categoryCursor)}>
          Plus de catégories</button>}</section>
      <section className={`${panel} space-y-3`}><h2 className="font-semibold">
        {editingCategory?'Modifier la catégorie':'Nouvelle catégorie'}</h2>
        <label className={label}>Nom<input className={input} value={categoryName} maxLength={120}
          onChange={event=>setCategoryName(event.target.value)}/></label>
        <label className={label}>Slug<input className={input} value={categorySlug} maxLength={80}
          onChange={event=>setCategorySlug(event.target.value)}/></label>
        {!editingCategory&&<label className={label}>Catégorie parente<select className={input} value={categoryParent}
          onChange={event=>setCategoryParent(event.target.value)}><option value="">Aucune</option>
          {categories.filter(item=>item.parentId===null).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className={label}>Position<input className={input} type="number" min="0" value={categoryPosition}
          onChange={event=>setCategoryPosition(event.target.value)}/></label>
        <button className={button} disabled={busy} onClick={()=>void saveCategory()}>Enregistrer</button>
        {editingCategory&&<button className={button} onClick={()=>{editingCategoryRef.current='';
          setEditingCategory(null);setCategoryName('');
          setCategorySlug('');setCategoryParent('');setCategoryPosition('0');}}>Annuler</button>}</section></div>}
  </main>;
}
