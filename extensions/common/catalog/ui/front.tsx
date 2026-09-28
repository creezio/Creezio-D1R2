'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import {call,errorText,type Category,type Media,type Page,type Product,type ProductSummary} from './contracts.ts';
import {money} from './money.ts';
import {retainedSessionId,sameCatalogScope,sessionVerified} from './session.ts';

const button='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50';
function ProductCard({item,onOpen}:{item:ProductSummary;onOpen:()=>void}){
  return <button type="button" onClick={onOpen} className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm hover:border-indigo-400">
    <div className="flex aspect-square items-center justify-center bg-slate-100 text-xs text-slate-500">
      Image privée indisponible</div><div className="space-y-1 p-3"><p className="text-xs text-slate-500">{item.sku}</p>
      <h3 className="font-semibold">{item.name}</h3><p className="font-medium text-indigo-700">
        {money(item.priceMinor,item.currency)}</p></div></button>;
}
/** Authenticated front catalog, structurally adapted from WinHub's storefront grid/detail. */
export function CatalogFrontView(props:RuntimeViewProps){
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const retained=useRef('');
  const sessionId=retained.current=retainedSessionId(retained.current,access);
  const enabled=props.active&&props.authorized&&sessionVerified(access,sessionId);
  const previous=useRef({sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId});
  const live=useRef({enabled,sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId});
  const epoch=useRef(0),listSerial=useRef(0),detailSerial=useRef(0),selectedRef=useRef('');
  const ownScope=sameCatalogScope(previous.current,{sessionId,audience:props.audience,
    contextId:props.contextId});
  const identityChanged=!ownScope||previous.current.client!==props.client||
    previous.current.access!==props.access;
  const [queryInput,setQueryInput]=useState(''),[query,setQuery]=useState(''),
    [categoryId,setCategoryId]=useState(''),[categories,setCategories]=useState<Category[]>([]),
    [categoryCursor,setCategoryCursor]=useState<string|null>(null),
    [items,setItems]=useState<ProductSummary[]>([]),[cursor,setCursor]=useState<string|null>(null),
    [selected,setSelected]=useState(typeof props.input.id==='string'?props.input.id:''),
    [product,setProduct]=useState<Product|null>(null),[media,setMedia]=useState<Media[]>([]),
    [loading,setLoading]=useState(false),[notice,setNotice]=useState('');
  const listKey=useRef(JSON.stringify([query,categoryId]));
  selectedRef.current=selected;
  const visibleListKey=JSON.stringify([query,categoryId]);
  if(listKey.current!==visibleListKey){listKey.current=visibleListKey;listSerial.current++;}
  if(identityChanged||live.current.enabled!==enabled)epoch.current++;
  live.current={enabled,sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId};
  const mark=epoch.current;
  const current=()=>epoch.current===mark&&live.current.enabled&&live.current.sessionId===sessionId
    &&live.current.client===props.client&&live.current.access===props.access
    &&live.current.audience===props.audience&&live.current.contextId===props.contextId
    &&props.access.getSnapshot().session?.id===sessionId;
  const scope={client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};
  useEffect(()=>{if(!identityChanged)return;previous.current={sessionId,client:props.client,access:props.access,
    audience:props.audience,contextId:props.contextId};
    listSerial.current++;detailSerial.current++;setQueryInput('');setQuery('');setCategoryId('');
    setCategories([]);setCategoryCursor(null);setItems([]);setCursor(null);setSelected('');setProduct(null);setMedia([]);setNotice('');
  },[identityChanged,sessionId,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{if(access.phase==='authenticated'&&!access.pending&&!props.authorized){setItems([]);setCategories([]);setCategoryCursor(null);
    setProduct(null);setMedia([]);setCursor(null);}},
    [props.authorized,access.phase,access.pending]);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(queryInput.trim()),300);return()=>clearTimeout(timer);},[queryInput]);
  const load=useCallback(async(append=false,next?:string)=>{
    if(!current())return;
    const serial=++listSerial.current;setLoading(true);
    const result=await call<Page<ProductSummary>>(scope,'product.search',{limit:25,
      ...(query?{query}:{}),...(categoryId?{categoryId}:{}),...(next?{cursor:next}:{})},current);
    if(!current()||serial!==listSerial.current)return;
    setLoading(false);
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setNotice('');setItems(old=>append?[...old,...result.value.items.filter(item=>
      !old.some(existing=>existing.id===item.id))]:result.value.items);
    setCursor(result.value.nextCursor);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled,query,categoryId]);
  const loadCategories=useCallback(async(next?:string)=>{
    if(!current())return;
    const result=await call<Page<Category>>(scope,'category.list',{limit:50,
      ...(next?{cursor:next}:{})},current);
    if(!current())return;
    if(result.kind==='error'){setNotice(errorText(result.code));return;}
    setCategories(old=>next?[...old,...result.value.items.filter(item=>
      !old.some(existing=>existing.id===item.id))]:result.value.items);
    setCategoryCursor(result.value.nextCursor);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{if(!enabled)return;void load();void loadCategories();},[enabled,load,loadCategories]);
  useEffect(()=>{if(!enabled||!selected)return;
    const serial=++detailSerial.current,id=selected;
    const valid=()=>current()&&serial===detailSerial.current&&selectedRef.current===id;
    setProduct(null);setMedia([]);
    void(async()=>{const result=await call<{product:Product}>(scope,'product.get',{id},valid);
      if(!valid())return;
      if(result.kind==='error'){setNotice(errorText(result.code));return;}
      setProduct(result.value.product);
      const linked=await call<{items:Media[]}>(scope,'media.list',{productId:id},valid);
      if(valid()&&linked.kind==='ok')setMedia(linked.value.items);
    })();
  },[enabled,selected,sessionId,props.client,props.access,props.audience,props.contextId]);
  if(!enabled||!ownScope)return <p className="p-6 text-sm text-slate-500">Catalogue disponible après connexion autorisée.</p>;
  return <main className="space-y-5 p-5 text-slate-900"><header><h1 className="text-2xl font-semibold">Catalogue</h1>
    <p className="text-sm text-slate-600">Produits publiés</p></header>
    {notice&&<p role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm">{notice}</p>}
    {selected&&product?<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <button className={button} onClick={()=>{detailSerial.current++;selectedRef.current='';setSelected('');setProduct(null);setMedia([]);}}>
        ← Retour aux produits</button><div className="mt-4 grid gap-5 md:grid-cols-[minmax(180px,1fr)_2fr]">
        <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
          {media.length?'Image privée : accès limité au propriétaire':'Aucune image publique'}</div>
        <div><p className="text-sm text-slate-500">{product.sku}</p><h2 className="text-2xl font-semibold">{product.name}</h2>
          <p className="mt-2 text-xl font-medium text-indigo-700">{money(product.priceMinor,product.currency)}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm">{product.description}</p>
          {product.attributes.length>0&&<dl className="mt-4 divide-y border-y text-sm">
            {product.attributes.map(item=><div key={item.key} className="flex justify-between gap-4 py-2">
              <dt className="font-medium">{item.key}</dt><dd>{item.value}</dd></div>)}</dl>}</div></div></section>:
      <><div className="flex flex-wrap gap-2"><input className={button} value={queryInput} maxLength={120}
        onChange={event=>setQueryInput(event.target.value)} placeholder="Rechercher un produit" aria-label="Rechercher"/>
        <select className={button} value={categoryId} aria-label="Catégorie"
          onChange={event=>setCategoryId(event.target.value)}><option value="">Toutes catégories</option>
          {categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
        {categoryCursor&&<button className={button} onClick={()=>void loadCategories(categoryCursor)}>
          Plus de catégories</button>}</div>
        {selected&&<p className="text-sm text-slate-500">Chargement de la fiche publiée…</p>}
        {items.length===0&&<p className="text-sm text-slate-500">{loading?'Chargement…':
          'Aucun produit publié sur cette page de résultats.'}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map(item=><ProductCard key={item.id} item={item} onOpen={()=>{selectedRef.current=item.id;
            setSelected(item.id);}}/>)}</div>
        {cursor&&<button className={button} disabled={loading} onClick={()=>void load(true,cursor)}>
          {loading?'Chargement…':'Afficher plus'}</button>}</>}
  </main>;
}
