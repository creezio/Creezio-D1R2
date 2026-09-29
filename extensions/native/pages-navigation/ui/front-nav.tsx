'use client';

import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {WorkspaceViewProps} from '@creezio/sdk/workspace/types';
import {call,type PublishedNavigation} from './contracts.ts';
import {currentFrontLocation,editorialHref,editorialLinkActive,serverFrontLocation,
  subscribeFrontLocation} from './front-link.ts';
import {pageScopeAfter,requiresPageReset} from './state.ts';

/** The themes already render front.header; this view supplies the published editorial links. */
export function PublishedEditorialNavigation(props:WorkspaceViewProps){
  const frontLocation=useSyncExternalStore(subscribeFrontLocation,currentFrontLocation,serverFrontLocation);
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
  const enabled=props.active&&props.authorized&&!!sessionId;
  const [navigation,setNavigation]=useState<PublishedNavigation|null>(null);
  const [notice,setNotice]=useState('');
  const [following,setFollowing]=useState('');
  const epoch=useRef(0),serial=useRef(0);
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
  useEffect(()=>{
    const identity={sessionId,phase:access.pending?'loading':access.phase,client:props.client,
      access:props.access,audience:props.audience,contextId:props.contextId};
    const reset=requiresPageReset(scopeIdentity.current,identity);
    scopeIdentity.current=pageScopeAfter(scopeIdentity.current,identity);
    ++serial.current;
    if(reset){setNavigation(null);setNotice('');}
    if(!enabled){setFollowing('');return;}
    const request=serial.current;
    void(async()=>{const result=await call<{navigation:PublishedNavigation}>(scope,'navigation.published',{},current);
      if(!current()||serial.current!==request)return;
      if(result.kind==='ok'){setNavigation(result.value.navigation);setNotice('');}
      else setNotice('Navigation publiée indisponible.');})();
  },[enabled,sessionId,access.phase,access.pending,props.client,props.access,props.audience,props.contextId]);
  const ownScope=scopeIdentity.current.sessionId===sessionId&&
    scopeIdentity.current.audience===props.audience&&scopeIdentity.current.contextId===props.contextId;
  if(!enabled||!ownScope)return null;
  const links=(navigation?.items??[]).filter(item=>!item.hidden)
    .sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  if(!links.length&&!notice)return null;
  return <nav aria-label="Navigation publiée" className="flex flex-wrap gap-3 px-6 py-3">
    {links.map(item=><a key={item.id}
      href={editorialHref(item)} aria-current={editorialLinkActive(item,frontLocation)?'page':undefined}
      rel="noopener noreferrer"
      aria-disabled={following===item.id||undefined}
      onClick={event=>{
        if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
        if(item.pageSlug){
          event.preventDefault();
          if(!props.navigation.visit(`/pages?slug=${encodeURIComponent(item.pageSlug)}`))
            setNotice('Navigation vers cette page indisponible.');
          return;
        }
        if(!/^\/[A-Za-z0-9/_-]*$/u.test(item.href))return;
        event.preventDefault();
        if(following)return;
        const request=++serial.current,href=item.href;
        setFollowing(item.id);setNotice('');
        void(async()=>{
          const result=await call<{pageId:string;slug:string}>(scope,'page.published.resolve',{slug:href},current);
          if(!current()||serial.current!==request)return;
          setFollowing('');
          if(result.kind==='ok'&&result.value.slug===href){
            if(!props.navigation.visit(`/pages?slug=${encodeURIComponent(href)}`))
              setNotice('Navigation vers cette page indisponible.');
          }else if(result.kind==='rejected'&&result.code==='not_found'){
            if(!props.navigation.visit(href))window.location.assign(href);
          }
          else setNotice('Lien publié indisponible. Réessayez après actualisation.');
        })();
      }}>{item.label}</a>)}
    {notice&&<span role="alert">{notice}</span>}
  </nav>;
}
