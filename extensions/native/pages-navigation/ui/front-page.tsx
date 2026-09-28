'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import {LANDING_PREFAB_COMPONENTS} from './prefabs.tsx';
import {call,type PublishedPage,type PublishedPageSummary,type PublishedNavigation,type PageResult,type Result} from './contracts.ts';
import {pageScopeAfter,requiresPageReset} from './state.ts';
import './landing.css';

/** Authenticated front projection of the published D1 snapshot. Anonymous HTTP awaits a host port. */
export function PagesNavigationFrontView(props:RuntimeViewProps){
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
  const enabled=props.active&&props.authorized&&!!sessionId;
  const [pages,setPages]=useState<PublishedPageSummary[]>([]),[page,setPage]=useState<PublishedPage|null>(null),
    [nav,setNav]=useState<PublishedNavigation|null>(null),[selected,setSelected]=useState<string>(''),
    [cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(false),[notice,setNotice]=useState('');
  const epoch=useRef(0),listSerial=useRef(0),readSerial=useRef(0),selectedRef=useRef(selected);
  selectedRef.current=selected;
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
      setSelected(previous=>previous||props.input.pageId||result.value.items[0]?.id||'');
    }else setNotice('Pages publiées indisponibles.');
    setLoading(false);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled,props.input.pageId]);
  useEffect(()=>{
    const identity={sessionId,phase:access.pending?'loading':access.phase,client:props.client,
      access:props.access,audience:props.audience,contextId:props.contextId};
    const reset=requiresPageReset(scopeIdentity.current,identity);
    scopeIdentity.current=pageScopeAfter(scopeIdentity.current,identity);
    if(reset){listSerial.current++;readSerial.current++;setPages([]);setPage(null);setNav(null);
      setSelected('');setCursor(null);setNotice('');}
    if(!enabled){setLoading(false);return;}
    void loadPages();
    void(async()=>{const result=await call<{navigation:PublishedNavigation}>(scope,'navigation.published',{},current);
      if(current()&&result.kind==='ok')setNav(result.value.navigation);})();
  },[enabled,sessionId,access.phase,access.pending,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{if(enabled&&typeof props.input.pageId==='string'&&props.input.pageId)setSelected(props.input.pageId);
  },[enabled,props.input.pageId]);
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
  if(!enabled||!ownScope)return <div>Pages indisponibles pour cette session.</div>;
  const displayed=page?.id===selected?page:null;
  const links=(nav?.items??[]).filter(item=>!item.hidden).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  const style={...(displayed?.settings.accent?{'--lnd-accent':String(displayed.settings.accent)}:{}),
    ...(displayed?.settings.background?{'--lnd-bg':String(displayed.settings.background)}:{})} as React.CSSProperties;
  return <div className="lnd-root" style={style}>
    {links.length>0&&<nav aria-label="Navigation publiée" className="flex flex-wrap gap-3 px-6 py-3">
      {links.map(item=>{const target=pages.find(candidate=>candidate.slug===item.href);
        return target?<button type="button" key={item.id} onClick={()=>setSelected(target.id)}
          aria-current={selected===target.id?'page':undefined}>{item.label}</button>:
          <a key={item.id} href={item.href} rel="noopener noreferrer">{item.label}</a>;})}
    </nav>}
    {notice&&<p role="alert" className="lnd-empty">{notice}</p>}
    {!displayed?<p className="lnd-empty">Cette page n’est pas encore publiée.</p>:
      displayed.sections.filter(section=>section.enabled).sort((a,b)=>a.position-b.position)
        .map(section=>{const Component=LANDING_PREFAB_COMPONENTS[section.kind];return Component?
          <Component key={section.id} content={section.content} settings={displayed.settings}/>:null;})}
    <div className="flex flex-wrap gap-2 px-6 py-3" aria-label="Pages publiées">
      {pages.map(item=><button type="button" key={item.id} onClick={()=>setSelected(item.id)}
        aria-current={selected===item.id?'page':undefined}>{item.title}</button>)}
      {cursor&&<button type="button" disabled={loading} onClick={()=>void loadPages(true,cursor)}>
        {loading?'Chargement…':'Afficher plus de pages'}</button>}
    </div>
  </div>;
}
