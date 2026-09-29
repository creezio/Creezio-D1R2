'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import {LANDING_PREFAB_COMPONENTS} from './prefabs.tsx';
import {call,type PublishedPage,type PublishedPageSummary,type PageResult,type Result} from './contracts.ts';
import {pageScopeAfter,requiresPageReset} from './state.ts';
import {activatePublishedSeo} from './seo.ts';
import './landing.css';

/** Authenticated front projection of the published D1 snapshot. Anonymous HTTP awaits a host port. */
export function PagesNavigationFrontView(props:RuntimeViewProps){
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
  const enabled=props.active&&props.authorized&&!!sessionId;
  const routeSlug=typeof props.input.slug==='string'?props.input.slug:'';
  const routePageId=typeof props.input.pageId==='string'?props.input.pageId:'';
  const [pages,setPages]=useState<PublishedPageSummary[]>([]),[page,setPage]=useState<PublishedPage|null>(null),
    [selected,setSelected]=useState<string>(''),
    [cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[notice,setNotice]=useState('');
  const epoch=useRef(0),listSerial=useRef(0),readSerial=useRef(0),resolveSerial=useRef(0),
    selectedRef=useRef(selected),routeRef=useRef({slug:routeSlug,pageId:routePageId});
  selectedRef.current=selected;
  routeRef.current={slug:routeSlug,pageId:routePageId};
  const live=useRef({active:props.active,authorized:props.authorized,sessionId,client:props.client,
    access:props.access,audience:props.audience,contextId:props.contextId});
  if(live.current.active!==props.active||live.current.authorized!==props.authorized||
    live.current.sessionId!==sessionId||live.current.client!==props.client||live.current.access!==props.access||
    live.current.audience!==props.audience||live.current.contextId!==props.contextId)epoch.current++;
  live.current={active:props.active,authorized:props.authorized,sessionId,client:props.client,
    access:props.access,audience:props.audience,contextId:props.contextId};
  const scopeIdentity=useRef({sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId});
  const mark=epoch.current;
  const current=()=>epoch.current===mark&&live.current.active&&live.current.authorized&&
    live.current.sessionId===sessionId&&live.current.client===props.client&&live.current.access===props.access&&
    live.current.audience===props.audience&&live.current.contextId===props.contextId&&
    props.access.getSnapshot().session?.id===sessionId;
  const scope={client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};
  const loadPages=useCallback(async(append=false,next?:string)=>{
    if(!current())return;
    const serial=++listSerial.current;setLoading(true);
    const result:Result<PageResult<PublishedPageSummary>>=await call<PageResult<PublishedPageSummary>>(scope,'page.published.list',
      {limit:50,...(next?{cursor:next}:{})},current);
    if(!current()||serial!==listSerial.current)return;
    if(result.kind==='ok'){
      setPages(previous=>append?[...previous,...result.value.items.filter(item=>!previous.some(old=>old.id===item.id))]:result.value.items);
      setCursor(result.value.nextCursor);
      if(!routeRef.current.slug&&!routeRef.current.pageId)
        setSelected(previous=>previous||result.value.items[0]?.id||'');
    }else setNotice('Pages publiées indisponibles.');
    setLoading(false);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{
    const identity={sessionId,phase:access.pending?'loading':access.phase,client:props.client,
      access:props.access,audience:props.audience,contextId:props.contextId};
    const reset=requiresPageReset(scopeIdentity.current,identity);
    scopeIdentity.current=pageScopeAfter(scopeIdentity.current,identity);
    if(reset){listSerial.current++;readSerial.current++;resolveSerial.current++;setPages([]);setPage(null);
      setSelected('');setCursor(null);setNotice('');}
    if(!enabled){setLoading(false);return;}
    void loadPages();
  },[enabled,sessionId,access.phase,access.pending,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{
    if(!enabled)return;
    const serial=++resolveSerial.current;
    setNotice('');
    if(routeSlug){
      ++readSerial.current;setPage(null);setSelected('');
      if(!/^\/[A-Za-z0-9/_-]*$/u.test(routeSlug)){setNotice('Lien de page invalide.');return;}
      void(async()=>{const result=await call<{pageId:string;slug:string}>(scope,'page.published.resolve',
        {slug:routeSlug},current);
        if(!current()||resolveSerial.current!==serial||routeRef.current.slug!==routeSlug)return;
        if(result.kind==='ok'&&result.value.slug===routeSlug)setSelected(result.value.pageId);
        else setNotice('Cette page n’est pas publiée.');})();
    }else if(routePageId){++readSerial.current;setPage(null);setSelected(routePageId);}
    else setSelected(previous=>previous||pages[0]?.id||'');
  },[enabled,routeSlug,routePageId,sessionId,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{
    if(!enabled||!selected)return;
    const serial=++readSerial.current,pageId=selected;
    const valid=()=>current()&&readSerial.current===serial&&selectedRef.current===pageId;
    setPage(null);
    void(async()=>{const result=await call<{page:PublishedPage}>(scope,'page.published.read',{pageId},valid);
      if(!valid())return;
      if(result.kind==='ok')setPage(result.value.page);else setNotice('Page publiée indisponible.');})();
  },[selected,enabled,sessionId,props.client,props.access,props.audience,props.contextId]);
  const ownScope=scopeIdentity.current.sessionId===sessionId&&
    scopeIdentity.current.audience===props.audience&&scopeIdentity.current.contextId===props.contextId;
  const displayed=enabled&&ownScope&&page?.id===selected&&
    (!routeSlug||page.slug===routeSlug)&&(!routePageId||page.id===routePageId)?page:null;
  useEffect(()=>{
    if(!displayed)return;
    return activatePublishedSeo(document,displayed);
  },[displayed]);
  if(!enabled||!ownScope)return <div>Pages indisponibles pour cette session.</div>;
  const style={...(displayed?.settings.accent?{'--lnd-accent':String(displayed.settings.accent)}:{}),
    ...(displayed?.settings.background?{'--lnd-bg':String(displayed.settings.background)}:{})} as React.CSSProperties;
  return <div className="lnd-root" style={style}>
    {notice&&<p role="alert" className="lnd-empty">{notice}</p>}
    {!displayed?<p className="lnd-empty">Cette page n’est pas encore publiée.</p>:
      displayed.sections.filter(section=>section.enabled).sort((a,b)=>a.position-b.position)
        .map(section=>{const Component=LANDING_PREFAB_COMPONENTS[section.kind];return Component?
          <Component key={section.id} content={section.content} settings={displayed.settings}/>:null;})}
    <div className="flex flex-wrap gap-2 px-6 py-3" aria-label="Pages publiées">
      {pages.map(item=><button type="button" key={item.id}
        onClick={()=>{if(!props.navigation.open('creezio.pages-navigation:front',{slug:item.slug}))
          setNotice('Navigation vers cette page indisponible.');}}
        aria-current={selected===item.id?'page':undefined}>{item.title}</button>)}
      {cursor&&<button type="button" disabled={loading} onClick={()=>void loadPages(true,cursor)}>
        {loading?'Chargement…':'Afficher plus de pages'}</button>}
    </div>
  </div>;
}
