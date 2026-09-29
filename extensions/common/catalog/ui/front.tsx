'use client';

import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import {createFileClient} from '@creezio/sdk/files/client';
import {call,errorText,type Category,type Media,type Page,type Product,type ProductSummary} from './contracts.ts';
import {money} from './money.ts';
import {retainedSessionId,sameCatalogScope,sessionVerified} from './session.ts';
import {createImageGate,type ImageGate} from './image-gate.ts';

const button='rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50';
function ProductImage({productId,item,scope,isCurrent,className,gate}:{productId:string;item?:Media;
  scope:Pick<RuntimeViewProps,'client'|'access'|'audience'|'contextId'>;
  isCurrent:()=>boolean;className:string;gate:ImageGate}){
  const element=useRef<HTMLDivElement>(null),currentRef=useRef(isCurrent);
  currentRef.current=isCurrent;
  const [visible,setVisible]=useState(false),[state,setState]=useState<'loading'|'missing'|'unavailable'|'ready'>('loading');
  const [url,setUrl]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const target=element.current;if(!target)return;
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),
      {rootMargin:'150px'});
    observer.observe(target);return()=>observer.disconnect();
  },[productId]);
  useEffect(()=>{
    if(!visible){setUrl('');setState('loading');return;}
    let active=true,objectUrl='',retryTimer:ReturnType<typeof setTimeout>|undefined;
    const current=()=>active&&currentRef.current();
    setState('loading');setUrl('');
    void(async()=>{
      let first=item;
      if(!first){
        const media=await call<{items:Media[]}>(scope,'media.list',{productId},current);
        if(!current())return;
        if(media.kind==='error'){setState('unavailable');return;}
        first=media.value.items[0];
      }
      if(!first){setState('missing');return;}
      if(!['image/png','image/jpeg','image/webp'].includes(first.contentType)){
        setState('unavailable');return;
      }
      let files;
      try{files=createFileClient({access:scope.access,moduleId:'creezio.catalog',categoryId:'images',
        contextId:scope.contextId});}catch{setState('unavailable');return;}
      const result=await gate.run(current,()=>files.downloadLinked(first.reference,productId,current));
      if(!current())return;
      if(!result||result.kind!=='ready'){
        setState('unavailable');
        if(result?.kind==='rejected'&&result.code==='rate_limited'&&retry===0){
          retryTimer=setTimeout(()=>{if(current())setRetry(1);},61000);
        }
        return;
      }
      objectUrl=URL.createObjectURL(new Blob([result.value],{type:first.contentType}));
      if(!current()){URL.revokeObjectURL(objectUrl);objectUrl='';return;}
      setUrl(objectUrl);setState('ready');
    })();
    return()=>{active=false;if(retryTimer)clearTimeout(retryTimer);if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[visible,productId,item,gate,scope.client,scope.access,scope.audience,scope.contextId,retry]);
  return <div ref={element} className={className}>
    {state==='ready'&&url?<img src={url} alt="" className="h-full w-full object-cover"
      onError={()=>{URL.revokeObjectURL(url);setUrl('');setState('unavailable');}}/>:
      <span className="px-2 text-center text-xs text-slate-500">{state==='loading'?'Chargement de l’image…':
        state==='missing'?'Aucune image publique':'Image indisponible'}</span>}
  </div>;
}
function ProductCard({item,onOpen,scope,isCurrent,gate}:{item:ProductSummary;onOpen:()=>void;
  scope:Pick<RuntimeViewProps,'client'|'access'|'audience'|'contextId'>;isCurrent:()=>boolean;
  gate:ImageGate}){
  return <button type="button" onClick={onOpen} className="overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm hover:border-indigo-400">
    <ProductImage productId={item.id} scope={scope} isCurrent={isCurrent} gate={gate}
      className="flex aspect-square items-center justify-center overflow-hidden bg-slate-100"/>
    <div className="space-y-1 p-3"><p className="text-xs text-slate-500">{item.sku}</p>
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
  // The file throttle is per credential/category/audience, across contexts.
  const imageScope=JSON.stringify([sessionId,props.audience]);
  const imageGate=useMemo(()=>createImageGate(),[imageScope]);
  useEffect(()=>()=>imageGate.cancel(),[imageGate]);
  const ownScope=sameCatalogScope(previous.current,{sessionId,audience:props.audience,
    contextId:props.contextId});
  const identityChanged=!ownScope||previous.current.client!==props.client||
    previous.current.access!==props.access;
  const [queryInput,setQueryInput]=useState(''),[query,setQuery]=useState(''),
    [categoryId,setCategoryId]=useState(''),[categories,setCategories]=useState<Category[]>([]),
    [categoryCursor,setCategoryCursor]=useState<string|null>(null),
    [items,setItems]=useState<ProductSummary[]>([]),[cursor,setCursor]=useState<string|null>(null),
    [selected,setSelected]=useState(typeof props.input.id==='string'?props.input.id:''),
    [product,setProduct]=useState<Product|null>(null),[media,setMedia]=useState<Media[]|null|'error'>(null),
    [loading,setLoading]=useState(false),[notice,setNotice]=useState(''),
    [listStamp,setListStamp]=useState(-1),[listQueryStamp,setListQueryStamp]=useState(''),
    [productStamp,setProductStamp]=useState(-1);
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
    setCategories([]);setCategoryCursor(null);setItems([]);setCursor(null);setSelected('');setProduct(null);setMedia(null);setNotice('');
  },[identityChanged,sessionId,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{if(access.phase==='authenticated'&&!access.pending&&!props.authorized){setItems([]);setCategories([]);setCategoryCursor(null);
    setProduct(null);setMedia(null);setCursor(null);}},
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
    setCursor(result.value.nextCursor);setListStamp(mark);setListQueryStamp(JSON.stringify([query,categoryId]));
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
    setProduct(null);setMedia(null);
    void(async()=>{const result=await call<{product:Product}>(scope,'product.get',{id},valid);
      if(!valid())return;
      if(result.kind==='error'){setNotice(errorText(result.code));return;}
      setProduct(result.value.product);setProductStamp(mark);
      const linked=await call<{items:Media[]}>(scope,'media.list',{productId:id},valid);
      if(valid())setMedia(linked.kind==='ok'?linked.value.items:'error');
    })();
  },[enabled,selected,sessionId,props.client,props.access,props.audience,props.contextId]);
  if(!enabled||!ownScope)return <p className="p-6 text-sm text-slate-500">Catalogue disponible après connexion autorisée.</p>;
  const visibleProduct=productStamp===mark?product:null;
  const listCurrent=listStamp===mark&&listQueryStamp===visibleListKey;
  const visibleItems=listCurrent?items:[];
  return <main className="space-y-5 p-5 text-slate-900"><header><h1 className="text-2xl font-semibold">Catalogue</h1>
    <p className="text-sm text-slate-600">Produits publiés</p></header>
    {notice&&<p role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm">{notice}</p>}
    {selected&&visibleProduct?<section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <button className={button} onClick={()=>{detailSerial.current++;selectedRef.current='';setSelected('');setProduct(null);setMedia(null);}}>
        ← Retour aux produits</button><div className="mt-4 grid gap-5 md:grid-cols-[minmax(180px,1fr)_2fr]">
        <div className="grid grid-cols-2 gap-2 self-start">
          {media===null?<div className="col-span-2 flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500">Chargement des images…</div>:
            media==='error'?<div className="col-span-2 flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500">Images indisponibles</div>:
            media.length?media.map((item,index)=><ProductImage key={item.fileId} productId={visibleProduct.id}
              item={item} scope={scope} isCurrent={current} gate={imageGate}
              className={`flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-slate-100 ${index===0?'col-span-2':''}`}/>):
              <div className="col-span-2 flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500">Aucune image publique</div>}
        </div>
        <div><p className="text-sm text-slate-500">{visibleProduct.sku}</p><h2 className="text-2xl font-semibold">{visibleProduct.name}</h2>
          <p className="mt-2 text-xl font-medium text-indigo-700">{money(visibleProduct.priceMinor,visibleProduct.currency)}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm">{visibleProduct.description}</p>
          {visibleProduct.attributes.length>0&&<dl className="mt-4 divide-y border-y text-sm">
            {visibleProduct.attributes.map(item=><div key={item.key} className="flex justify-between gap-4 py-2">
              <dt className="font-medium">{item.key}</dt><dd>{item.value}</dd></div>)}</dl>}</div></div></section>:
      <><div className="flex flex-wrap gap-2"><input className={button} value={queryInput} maxLength={120}
        onChange={event=>setQueryInput(event.target.value)} placeholder="Rechercher un produit" aria-label="Rechercher"/>
        <select className={button} value={categoryId} aria-label="Catégorie"
          onChange={event=>setCategoryId(event.target.value)}><option value="">Toutes catégories</option>
          {categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
        {categoryCursor&&<button className={button} onClick={()=>void loadCategories(categoryCursor)}>
          Plus de catégories</button>}</div>
        {selected&&<p className="text-sm text-slate-500">Chargement de la fiche publiée…</p>}
        {visibleItems.length===0&&!notice&&<p className="text-sm text-slate-500">{loading||!listCurrent?'Chargement…':
          'Aucun produit publié sur cette page de résultats.'}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleItems.map(item=><ProductCard key={`${item.id}:${item.revision}`} item={item} scope={scope}
            isCurrent={current} gate={imageGate}
            onOpen={()=>{selectedRef.current=item.id;
            setSelected(item.id);}}/>)}</div>
        {listCurrent&&cursor&&<button className={button} disabled={loading} onClick={()=>void load(true,cursor)}>
          {loading?'Chargement…':'Afficher plus'}</button>}</>}
  </main>;
}
