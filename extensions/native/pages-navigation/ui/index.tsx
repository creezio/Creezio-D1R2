'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type ChangeEvent} from 'react';
import {ArchiveRestore,ChevronDown,ChevronUp,Eye,ImagePlus,Plus,RefreshCw,Save,Trash2,Upload} from 'lucide-react';
import {useRegisterWorkspaceMetadata} from '@creezio/sdk/workspace/metadata';
import {createCommandJournal,type PendingCommand} from '@creezio/sdk/operations/command-journal';
import {createFileClient} from '@creezio/sdk/files/client';
import type {WorkspaceViewProps as RuntimeViewProps} from '@creezio/sdk/workspace/types';
import type {LandingSectionView,LandingSettingsView} from './types.ts';
import {LANDING_PREFAB_COMPONENTS} from './prefabs.tsx';
import {call,operationResult,errorText,requestKey,type DraftPage,type Media,type Navigation,type NavItem,
  type PageResult,type PageSummary,type PublishedPage,type Seo,type Result} from './contracts.ts';
import {createReadGeneration,pageScopeAfter,panelBelongsToScope,parseContentInput,requiresPageReset,samePageSelection} from './state.ts';
import {createPublishedImageLoad,publishedImageIds,referencedMedia,type ImageStates} from './published-images.ts';
import {SidebarEditor,type SidebarCatalog,type SidebarEdit} from './sidebar.tsx';
import './landing.css';

const button='rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50';
const input='w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';
const card='rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
const kinds=['hero','features','pricing','cta','footer'] as const;
const defaults:Record<string,Record<string,unknown>>={
  hero:{title:'Titre principal',subtitle:'Votre présentation',ctaLabel:'En savoir plus',ctaHref:'/'},
  features:{title:'Fonctionnalités',items:[]},pricing:{title:'Offres',plans:[]},
  cta:{title:'Passez à l’action',text:'',ctaLabel:'Découvrir',ctaHref:'/'},
  footer:{text:'',links:[]}};
const blankNav:Navigation={items:[],revision:0,publishedRevision:0,updatedAt:null,publishedAt:null};
const asPage=(value:unknown):DraftPage|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const page=value as DraftPage;
  return typeof page.id==='string'&&Array.isArray(page.sections)&&Number.isInteger(page.revision)?page:null;
};
const sorted=(items:LandingSectionView[])=>[...items].sort((a,b)=>a.position-b.position);
const cleanOrder=(items:LandingSectionView[])=>items.map((item,index)=>({...item,position:index}));
const navOrder=(items:NavItem[])=>items.map((item,index)=>({...item,order:index}));
function ContentField(props:{name:string;value:unknown;onChange:(value:unknown)=>void;onValidity:(valid:boolean)=>void}){
  const complex=props.value!==null&&typeof props.value==='object';
  const [raw,setRaw]=useState(()=>complex?JSON.stringify(props.value,null,2):''),[invalid,setInvalid]=useState(false);
  useEffect(()=>{if(complex)setRaw(JSON.stringify(props.value,null,2));},[props.value,complex]);
  return <label className="grid gap-1 text-xs text-slate-600">{props.name}{invalid&&' — JSON invalide'}
    {complex?<textarea className={`${input} font-mono`} rows={Math.min(10,Math.max(3,raw.split('\n').length))} value={raw}
      onChange={event=>{setRaw(event.target.value);const parsed=parseContentInput(event.target.value);
        setInvalid(!parsed.valid);props.onValidity(parsed.valid);if(parsed.valid)props.onChange(parsed.value);}}/>:
      <input className={input} value={String(props.value??'')} onChange={event=>props.onChange(event.target.value)}/>}</label>;
}
function LandingPreview(props:{page:DraftPage|PublishedPage;local?:boolean;images:ImageStates}){
  const style={...(props.page.settings.accent?{'--lnd-accent':String(props.page.settings.accent)}:{}),
    ...(props.page.settings.background?{'--lnd-bg':String(props.page.settings.background)}:{})} as React.CSSProperties;
  return <div className="overflow-hidden rounded-lg border border-slate-200">
    <p className="bg-amber-50 px-4 py-2 text-xs text-amber-900">{props.local?'Aperçu du brouillon enregistré — non public':'Snapshot éditorial publié'}</p>
    <div className="lnd-root" style={style}>{sorted(props.page.sections).filter(section=>section.enabled)
      .map(section=>{const Component=LANDING_PREFAB_COMPONENTS[section.kind];return Component?
        <Component key={section.id} content={section.content} settings={props.page.settings} images={props.images}/>:null;})}</div>
  </div>;
}

/** Adaptation of the original landing and navigation editors to native D1/R2 operations. */
export function PagesNavigationAdminView(props:RuntimeViewProps){
  const access=useSyncExternalStore(props.access.subscribe,props.access.getSnapshot,props.access.getSnapshot);
  const sessionId=access.phase==='authenticated'&&!access.pending?access.session?.id??'':'';
  const enabled=props.active&&props.authorized&&!!sessionId;
  const initialPanel=useRef(props.navigation.readPanelState());
  const initialPanelOwned=panelBelongsToScope(initialPanel.current?.data,
    {sessionId,audience:props.audience,contextId:props.contextId});
  const journal=useRef(sessionId?createCommandJournal({sessionId,audience:props.audience,contextId:props.contextId},
    initialPanel.current?.data?.pending):null);
  const journalScope=useRef({sessionId,audience:props.audience,contextId:props.contextId});
  const [pending,setPending]=useState<PendingCommand|null>(journal.current?.pending??null);
  const [checking,setChecking]=useState(false);
  const [tab,setTab]=useState<'pages'|'navigation'|'sidebar'>(()=>initialPanelOwned&&
    ['navigation','sidebar'].includes(initialPanel.current?.activeSubview??'')
      ?initialPanel.current!.activeSubview as 'navigation'|'sidebar':'pages');
  const [pages,setPages]=useState<PageSummary[]>([]),[selected,setSelected]=useState(()=>
    initialPanelOwned&&typeof initialPanel.current?.data?.pageId==='string'?initialPanel.current.data.pageId:'') ,
    [saved,setSaved]=useState<DraftPage|null>(null),[edited,setEdited]=useState<DraftPage|null>(null),
    [preview,setPreview]=useState<DraftPage|PublishedPage|null>(null),
    [previewImages,setPreviewImages]=useState<{key:string;states:ImageStates}>({key:'',states:{}}),
    [navigation,setNavigation]=useState<Navigation>(blankNav),[navEdited,setNavEdited]=useState<Navigation>(blankNav),
    [sidebar,setSidebar]=useState<SidebarCatalog|null>(null),[sidebarUnavailable,setSidebarUnavailable]=useState(false),
    [media,setMedia]=useState<Media[]>([]),[notice,setNotice]=useState(''),
    [newSlug,setNewSlug]=useState('/'),[newTitle,setNewTitle]=useState(''),
    [publicVisibility,setPublicVisibility]=useState<boolean|null>(null),
    [publicSlug,setPublicSlug]=useState<string|null>(null),
    [newKind,setNewKind]=useState<string>('hero'),[busy,setBusy]=useState(!!journal.current?.pending),[loading,setLoading]=useState(false);
  const [pageCursor,setPageCursor]=useState<string|null>(null);
  const [invalidContent,setInvalidContent]=useState<ReadonlySet<string>>(()=>new Set());
  const tabRef=useRef(tab);tabRef.current=tab;
  const epoch=useRef(0),selectionEpoch=useRef(0),listSerial=useRef(0),busySerial=useRef(0),busyRef=useRef(!!journal.current?.pending);
  const pageReadSerial=useRef(createReadGeneration()),navReadSerial=useRef(createReadGeneration()),
    sidebarReadSerial=useRef(createReadGeneration());
  const selectedRef=useRef(selected);
  if(selectedRef.current!==selected){selectionEpoch.current++;selectedRef.current=selected;}
  const live=useRef({active:props.active,authorized:props.authorized,sessionId,client:props.client,
    access:props.access,audience:props.audience,contextId:props.contextId});
  if(live.current.active!==props.active||live.current.authorized!==props.authorized||
    live.current.sessionId!==sessionId||live.current.client!==props.client||live.current.access!==props.access||
    live.current.audience!==props.audience||live.current.contextId!==props.contextId)epoch.current++;
  live.current={active:props.active,authorized:props.authorized,sessionId,client:props.client,
    access:props.access,audience:props.audience,contextId:props.contextId};
  const scopeIdentity=useRef({sessionId,client:props.client,access:props.access,audience:props.audience,
    contextId:props.contextId});
  const skipSelectionOnce=useRef(false),pendingPanelReset=useRef(false);
  const mark=epoch.current;
  const current=()=>epoch.current===mark&&live.current.active&&live.current.authorized&&
    live.current.sessionId===sessionId&&live.current.client===props.client&&live.current.access===props.access&&
    live.current.audience===props.audience&&live.current.contextId===props.contextId&&
    props.access.getSnapshot().session?.id===sessionId;
  const pageCurrent=(pageId:string,serial:number)=>current()&&samePageSelection(pageId,selectedRef.current,serial,selectionEpoch.current);
  const scope={client:props.client,access:props.access,audience:props.audience,contextId:props.contextId};
  useRegisterWorkspaceMetadata(props.panelId,{title:'Pages et navigation',kind:'section',
    trail:[{label:'Pages et navigation'},...(selected?[{label:edited?.title??'Page'}]:[])]});
  const dirty=!!saved&&!!edited&&JSON.stringify(saved)!==JSON.stringify(edited);
  const navDirty=JSON.stringify(navigation.items)!==JSON.stringify(navEdited.items);
  const navDirtyRef=useRef(navDirty);navDirtyRef.current=navDirty;
  const hasInvalidContent=!!edited&&[...invalidContent].some(key=>edited.sections.some(section=>key.startsWith(`${section.id}:`)));
  const beginBusy=()=>{if(busyRef.current||journal.current?.pending)return null;busyRef.current=true;const serial=++busySerial.current;
    setBusy(true);return serial;};
  const finishBusy=(serial:number)=>{if(busySerial.current===serial){busyRef.current=!!journal.current?.pending;setBusy(busyRef.current);}};
  const persistPending=(value:PendingCommand|null)=>{
    if(live.current.sessionId!==sessionId||live.current.contextId!==props.contextId||live.current.audience!==props.audience)return false;
    const savedTab=pendingPanelReset.current?'pages':tabRef.current;
    const retained=props.navigation.savePanelState({activeSubview:savedTab,data:{
      sessionId,audience:props.audience,contextId:props.contextId,
      ...(!pendingPanelReset.current&&selectedRef.current?{pageId:selectedRef.current}:{}),
      tab:savedTab,...(value?{pending:{...value}}:{})}});
    if(retained)setPending(value);
    return retained;
  };
  async function mutate<T>(operation:string,input:Record<string,unknown>,valid:()=>boolean=current):Promise<Result<T>>{
    const controller=journal.current;
    if(!controller||!current())return {kind:'rejected',code:'stale'};
    if(operation.startsWith('page.')||operation.startsWith('media.'))pageReadSerial.current.invalidate();
    if(operation.startsWith('navigation.'))navReadSerial.current.invalidate();
    if(operation.startsWith('sidebar.'))sidebarReadSerial.current.invalidate();
    const targetId=typeof input.pageId==='string'?input.pageId:typeof input.id==='string'?input.id:undefined;
    const outcome=await controller.execute(props.client,{sessionId,audience:props.audience,contextId:props.contextId,
      bindingId:`creezio.pages-navigation:${props.audience}.${operation}`,requestKey:requestKey(),intent:operation,
      ...(targetId?{targetId}:{})},input,valid,persistPending);
    if(journal.current===controller)setPending(outcome.pending);
    return operationResult<T>(outcome.result);
  }
  async function inspectPending(){
    const controller=journal.current,issued=controller?.pending;
    if(!controller||!issued||!current()||checking)return;
    busyRef.current=true;setBusy(true);setChecking(true);
    try{const outcome=await controller.inspect(props.client,current,persistPending);
      if(!current()||journal.current!==controller||!outcome)return;
      setPending(outcome.pending);
      const result=operationResult<Record<string,unknown>>(outcome.result);
      if(result.kind!=='ok'){setNotice(errorText(result.code));return;}
      setNotice(outcome.pending?'Action confirmée ; le suivi local doit encore être enregistré.':
        'Action confirmée. La demande n’a pas été relancée.');
      if(issued.intent==='page.create'&&issued.targetId){
        if(!selectedRef.current)setSelected(issued.targetId);
      }
      await loadPages();
      if(issued.intent?.startsWith('navigation.'))await loadNavigation(true);
      else if(issued.intent?.startsWith('sidebar.'))await loadSidebar();
      else if(issued.targetId&&issued.targetId===selectedRef.current){
        const pageId=issued.targetId,selection=selectionEpoch.current,readSerial=pageReadSerial.current.begin(),
          valid=()=>pageCurrent(pageId,selection)&&pageReadSerial.current.accepts(readSerial);
        const read=await call<{page:DraftPage}>(scope,'page.read',{pageId},valid);
        if(valid()&&read.kind==='ok'){setSaved(read.value.page);setEdited(read.value.page);setPreview(null);
          const files=await call<PageResult<Media>>(scope,'media.list',{pageId,limit:50},valid);
          if(valid()&&files.kind==='ok')setMedia(files.value.items);
          else if(valid())setNotice('Action confirmée. La liste des médias reste à actualiser.');}
        else if(valid())setNotice('Action confirmée. La page doit être relue avant une nouvelle modification.');
      }
    }finally{if(journal.current===controller){busyRef.current=!!controller.pending;setBusy(busyRef.current);
      setChecking(false);}}
  }

  const loadPages=useCallback(async(append=false,cursor?:string)=>{
    if(!current())return;const serial=++listSerial.current;setLoading(true);
    const result:Result<PageResult<PageSummary>>=await call<PageResult<PageSummary>>(scope,'page.list',
      {limit:50,...(cursor?{cursor}:{})},current);
    if(!current()||serial!==listSerial.current)return;
    if(result.kind==='ok'){
      setPages(previous=>append?[...previous,...result.value.items.filter(item=>!previous.some(old=>old.id===item.id))]:result.value.items);
      setPageCursor(result.value.nextCursor);
      setSelected(old=>old||result.value.items[0]?.id||'');
    }else setNotice(errorText(result.code));
    setLoading(false);
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  const loadNavigation=useCallback(async(force=false)=>{
    const serial=navReadSerial.current.begin();
    const result=await call<{navigation:Navigation}>(scope,'navigation.read',{},current);
    if(!current()||!navReadSerial.current.accepts(serial)||!force&&navDirtyRef.current)return;
    if(result.kind==='ok'){setNavigation(result.value.navigation);setNavEdited(result.value.navigation);}
    else setNotice(errorText(result.code));
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  const loadSidebar=useCallback(async()=>{
    if(!current())return;
    const serial=sidebarReadSerial.current.begin();
    const result=await call<SidebarCatalog>(scope,'sidebar.catalog',{},current);
    if(!current()||!sidebarReadSerial.current.accepts(serial))return;
    if(result.kind==='ok'){setSidebar(result.value);setSidebarUnavailable(false);}
    else {setSidebar(null);setSidebarUnavailable(true);setNotice(errorText(result.code));}
  },[props.client,props.access,props.audience,props.contextId,sessionId,enabled]);
  useEffect(()=>{const phase=access.pending?'loading':access.phase;
    const next={sessionId,phase,client:props.client,access:props.access,audience:props.audience,
      contextId:props.contextId};
    const reset=requiresPageReset(scopeIdentity.current,next);
    scopeIdentity.current=pageScopeAfter(scopeIdentity.current,next);
    const transient=!sessionId&&(phase==='loading'||phase==='unavailable');
    if((journalScope.current.sessionId!==sessionId||journalScope.current.audience!==props.audience||
      journalScope.current.contextId!==props.contextId)&&
      !(transient&&journalScope.current.audience===props.audience&&
        journalScope.current.contextId===props.contextId)){
      const fromAnonymous=!journalScope.current.sessionId&&!!sessionId;
      journalScope.current={sessionId,audience:props.audience,contextId:props.contextId};
      const savedPanel=fromAnonymous?props.navigation.readPanelState():null;
      const restored=savedPanel?.data?.pending;
      journal.current=sessionId?createCommandJournal(journalScope.current,restored):null;
      busySerial.current++;busyRef.current=!!journal.current?.pending;setBusy(busyRef.current);
      setPending(journal.current?.pending??null);setChecking(false);
      if(fromAnonymous&&panelBelongsToScope(savedPanel?.data,journalScope.current)){
        const pageId=savedPanel?.data?.pageId;
        if(typeof pageId==='string'&&pageId){selectedRef.current=pageId;selectionEpoch.current++;setSelected(pageId);}
        setTab(savedPanel?.activeSubview==='navigation'?'navigation':
          savedPanel?.activeSubview==='sidebar'?'sidebar':'pages');
      }
    }
    if(reset){listSerial.current++;selectionEpoch.current++;pageReadSerial.current.invalidate();
      navReadSerial.current.invalidate();sidebarReadSerial.current.invalidate();selectedRef.current='';busySerial.current++;busyRef.current=false;
      busyRef.current=!!journal.current?.pending;setBusy(busyRef.current);setPages([]);setPageCursor(null);setSelected('');setSaved(null);setEdited(null);
      setPreview(null);setNavigation(blankNav);setNavEdited(blankNav);setSidebar(null);setSidebarUnavailable(false);
      setMedia([]);setInvalidContent(new Set());
      setNotice('');setNewTitle('');setNewSlug('/');setPublicVisibility(null);setPublicSlug(null);
      tabRef.current='pages';setTab('pages');skipSelectionOnce.current=true;
      pendingPanelReset.current=true;}
    if(!enabled){setLoading(false);return;}
    if(pendingPanelReset.current){persistPending(journal.current?.pending??null);
      pendingPanelReset.current=false;}
    void loadPages();
    if(reset||!navDirty)void loadNavigation(reset);
  },[enabled,sessionId,access.phase,access.pending,props.client,props.access,props.audience,props.contextId]);
  useEffect(()=>{if(enabled&&tab==='sidebar')void loadSidebar();},[enabled,tab,loadSidebar]);
  useEffect(()=>{
    if(skipSelectionOnce.current){skipSelectionOnce.current=false;return;}
    if(!enabled||!selected)return;
    if(saved?.id===selected&&edited?.id===selected&&(dirty||hasInvalidContent))return;
    const generation=selectionEpoch.current,wanted=selected,readSerial=pageReadSerial.current.begin();
    const valid=()=>pageCurrent(wanted,generation)&&pageReadSerial.current.accepts(readSerial);
    setSaved(null);setEdited(null);setPreview(null);setMedia([]);setInvalidContent(new Set());setPublicVisibility(null);setPublicSlug(null);
    void(async()=>{
      const result=await call<{page:DraftPage}>(scope,'page.read',{pageId:wanted},valid);
      if(!valid())return;
      if(result.kind==='ok'&&asPage(result.value.page)){setSaved(result.value.page);setEdited(result.value.page);setPreview(null);}
      else setNotice(result.kind==='ok'?'Page invalide.':errorText(result.code));
      const visibility=await call<{visibility:'protected'|'public';slug:string|null}>(scope,'page.visibility',{pageId:wanted},valid);
      if(valid()&&visibility.kind==='ok'){
        setPublicVisibility(visibility.value.visibility==='public');setPublicSlug(visibility.value.slug);}
      else if(valid())setNotice('Visibilité indisponible. Actualisez la page avant de publier.');
      const files=await call<PageResult<Media>>(scope,'media.list',{pageId:wanted,limit:50},valid);
      if(valid()&&files.kind==='ok')setMedia(files.value.items);
    })();
  },[selected,enabled,sessionId,props.client,props.audience,props.contextId]);

  async function createPage(){if(!current()||!newTitle.trim())return;
    const serial=beginBusy();if(serial===null)return;setNotice('');
    const pageId=crypto.randomUUID(),title=newTitle.trim(),slug=newSlug;
    try{const result=await mutate<{page:DraftPage}>('page.create',
      {requestKey:requestKey(),id:pageId,slug,title},current);
      if(!current())return;
      if(result.kind!=='ok'){setNotice(errorText(result.code));return;}
      setNewTitle(value=>value.trim()===title?'':value);setNewSlug(value=>value===slug?'/':value);
      await loadPages();if(current())setSelected(pageId);
    }finally{finishBusy(serial);}
  }
  async function savePage(){if(!current()||!edited||hasInvalidContent)return;
    const serial=beginBusy();if(serial===null)return;setNotice('');
    const page=edited,selection=selectionEpoch.current,valid=()=>pageCurrent(page.id,selection);
    try{const result=await mutate<{page:DraftPage}>('page.save',{requestKey:requestKey(),pageId:page.id,
      revision:page.revision,slug:page.slug,title:page.title,sections:cleanOrder(page.sections),
      settings:page.settings,seo:page.seo},valid);
      if(!valid())return;
      if(result.kind==='ok'&&asPage(result.value.page)){setSaved(result.value.page);setEdited(result.value.page);
        setPreview(null);setNotice('Brouillon enregistré.');void loadPages();}
      else setNotice(result.kind==='ok'?'Sauvegarde non confirmée.':errorText(result.code));
    }finally{finishBusy(serial);}
  }
  async function previewPage(){if(!saved||dirty||hasInvalidContent)return;
    const serial=beginBusy();if(serial===null)return;
    const pageId=saved.id,selection=selectionEpoch.current,valid=()=>pageCurrent(pageId,selection);
    try{const result=await call<{page:DraftPage}>(scope,'page.preview',{pageId},valid);
      if(!valid())return;
      if(result.kind==='ok'){setPreview(result.value.page);setNotice('Aperçu du brouillon enregistré.');}
      else setNotice(errorText(result.code));
    }finally{finishBusy(serial);}
  }
  async function publishPage(){if(!saved||dirty||hasInvalidContent||publicVisibility===null)return;
    if(publicVisibility&&!window.confirm('Rendre ce snapshot et ses images sélectionnées accessibles sans connexion ?'))return;
    const serial=beginBusy();if(serial===null)return;setNotice('');
    const pageId=saved.id,selection=selectionEpoch.current,valid=()=>pageCurrent(pageId,selection);
    try{const result=await mutate<{page:PublishedPage}>('page.publish',
      {requestKey:requestKey(),pageId,revision:saved.revision,
        visibility:publicVisibility?'public':'protected'},valid);
      if(!valid())return;
      if(result.kind==='ok'){setPreview(result.value.page);
        setPublicSlug(publicVisibility?result.value.page.slug:null);
        setNotice(publicVisibility?'Snapshot public confirmé. Le lien public suit le chemin publié.':
          'Snapshot publié pour les lecteurs connectés ; toute exposition anonyme précédente est retirée.');
        const readSerial=pageReadSerial.current.begin(),readValid=()=>valid()&&pageReadSerial.current.accepts(readSerial);
        const read=await call<{page:DraftPage}>(scope,'page.read',{pageId},readValid);
        if(readValid()&&read.kind==='ok'){setSaved(read.value.page);setEdited(read.value.page);void loadPages();}}
      else setNotice(errorText(result.code));
    }finally{finishBusy(serial);}
  }
  async function resetPage(){if(!saved||!window.confirm('Rétablir le brouillon depuis le snapshot publié ? Les données publiées restent conservées.'))return;
    const serial=beginBusy();if(serial===null)return;
    const pageId=saved.id,selection=selectionEpoch.current,valid=()=>pageCurrent(pageId,selection);
    try{const result=await mutate<{page:DraftPage}>('page.reset',
      {requestKey:requestKey(),pageId,revision:saved.revision},valid);
      if(!valid())return;
      if(result.kind==='ok'){setSaved(result.value.page);setEdited(result.value.page);setPreview(null);
        setInvalidContent(new Set());setNotice('Brouillon rétabli.');void loadPages();}else setNotice(errorText(result.code));
    }finally{finishBusy(serial);}
  }
  async function saveNav(){if(!current())return;
    const serial=beginBusy();if(serial===null)return;
    try{const result=await mutate<{navigation:Navigation}>('navigation.save',
      {requestKey:requestKey(),revision:navigation.revision,items:navOrder(navEdited.items)},current);
      if(!current())return;
      if(result.kind==='ok'){setNavigation(result.value.navigation);setNavEdited(result.value.navigation);
        setNotice('Navigation enregistrée en brouillon.');}else setNotice(errorText(result.code));
    }finally{finishBusy(serial);}
  }
  async function publishNav(){if(navDirty||navigation.revision<1)return;
    const serial=beginBusy();if(serial===null)return;
    try{const result=await mutate<{navigation:{items:NavItem[];publishedRevision:number}}>('navigation.publish',
      {requestKey:requestKey(),revision:navigation.revision},current);
      if(!current())return;
      if(result.kind==='ok'){setNotice('Navigation publiée dans D1.');void loadNavigation();}
      else setNotice(errorText(result.code));
    }finally{finishBusy(serial);}
  }
  async function resetNav(){if(navigation.revision<1||!window.confirm('Rétablir la navigation brouillon depuis la version publiée ?'))return;
    const serial=beginBusy();if(serial===null)return;
    try{const result=await mutate<{navigation:Navigation}>('navigation.reset',
      {requestKey:requestKey(),revision:navigation.revision},current);
      if(!current())return;
      if(result.kind==='ok'){setNavigation(result.value.navigation);setNavEdited(result.value.navigation);
        setNotice('Navigation brouillon rétablie.');}else setNotice(errorText(result.code));
    }finally{finishBusy(serial);}
  }
  async function uploadMedia(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value='';
    if(!file||!saved||dirty)return;
    const serial=beginBusy();if(serial===null)return;
    const pageId=saved.id,revision=saved.revision,selection=selectionEpoch.current;
    const valid=()=>pageCurrent(pageId,selection);
    setNotice(`Téléversement de ${file.name}…`);
    try{const files=createFileClient({access:props.access,moduleId:'creezio.pages-navigation',categoryId:'media',contextId:props.contextId});
      const uploaded=await files.upload({file,filename:file.name,intentId:requestKey(),isCurrent:valid});
      if(!valid())return;
      if(uploaded.kind!=='ready'){setNotice('Téléversement non confirmé. Vérifiez les médias avant de réessayer.');return;}
      const result=await mutate<{media:Media;page:PageSummary}>('media.link',
        {requestKey:requestKey(),pageId,revision,staged:uploaded.value.reference},valid);
      if(!valid())return;
      if(result.kind!=='ok'){setNotice(result.kind==='unknown'?
        'Média téléversé ; la liaison à la page est incertaine. Vérifiez le résultat avant tout nouvel essai.':
        errorText(result.code));return;}
      const readSerial=pageReadSerial.current.begin(),readValid=()=>valid()&&pageReadSerial.current.accepts(readSerial);
      const read=await call<{page:DraftPage}>(scope,'page.read',{pageId},readValid);
      if(readValid()&&read.kind==='ok'){setSaved(read.value.page);setEdited(read.value.page);setMedia(items=>[result.value.media,...items]);
        setNotice('Média joint à la page. Sélectionnez-le dans une section, puis enregistrez et publiez.');}
    }finally{finishBusy(serial);}
  }
  async function unlinkMedia(item:Media){if(!saved||dirty||!window.confirm(`Détacher ${item.filename} ? Le fichier privé reste conservé.`))return;
    const serial=beginBusy();if(serial===null)return;
    const pageId=saved.id,revision=saved.revision,selection=selectionEpoch.current,valid=()=>pageCurrent(pageId,selection);
    try{const result=await mutate<{removed:boolean;page:PageSummary}>('media.unlink',
      {requestKey:requestKey(),pageId,revision,fileId:item.fileId},valid);
      if(!valid())return;
      if(result.kind!=='ok'){setNotice(errorText(result.code));return;}
      const readSerial=pageReadSerial.current.begin(),readValid=()=>valid()&&pageReadSerial.current.accepts(readSerial);
      const read=await call<{page:DraftPage}>(scope,'page.read',{pageId},readValid);
      if(readValid()&&read.kind==='ok'){setSaved(read.value.page);setEdited(read.value.page);
        setMedia(items=>items.filter(value=>value.fileId!==item.fileId));}
    }finally{finishBusy(serial);}
  }
  async function downloadMedia(item:Media){const files=createFileClient({access:props.access,moduleId:'creezio.pages-navigation',
    categoryId:'media',contextId:props.contextId});const pageId=selected,selection=selectionEpoch.current;
    const valid=()=>pageCurrent(pageId,selection);const result=await files.download(item.reference,valid);
    if(!valid())return;
    if(result.kind!=='ready'){setNotice('Lecture du média indisponible.');return;}
    const url=URL.createObjectURL(result.value),link=document.createElement('a');link.href=url;link.download=item.filename;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function updateSection(sectionId:string,change:Partial<LandingSectionView>){setEdited(page=>page?{...page,
    sections:page.sections.map(section=>section.id===sectionId?{...section,...change}:section)}:page);}
  function moveSection(index:number,direction:-1|1){setEdited(page=>{if(!page)return page;const items=sorted(page.sections);
    const target=index+direction;if(target<0||target>=items.length)return page;
    [items[index],items[target]]=[items[target]!,items[index]!];return {...page,sections:cleanOrder(items)};});}
  function moveNav(index:number,direction:-1|1){setNavEdited(nav=>{const items=[...nav.items],target=index+direction;
    if(target<0||target>=items.length)return nav;[items[index],items[target]]=[items[target]!,items[index]!];
    return {...nav,items:navOrder(items)};});}
  async function reloadSelected(){if(!selectedRef.current||busyRef.current)return;
    if((dirty||hasInvalidContent)&&!window.confirm('Relire la page et abandonner les modifications locales ?'))return;
    const serial=beginBusy();if(serial===null)return;
    const pageId=selectedRef.current,selection=selectionEpoch.current,readSerial=pageReadSerial.current.begin(),
      valid=()=>pageCurrent(pageId,selection)&&pageReadSerial.current.accepts(readSerial);
    try{const read=await call<{page:DraftPage}>(scope,'page.read',{pageId},valid);
      if(!valid())return;
      if(read.kind!=='ok'){setNotice(errorText(read.code));return;}
      setSaved(read.value.page);setEdited(read.value.page);setPreview(null);setInvalidContent(new Set());
      const files=await call<PageResult<Media>>(scope,'media.list',{pageId,limit:50},valid);
      if(!valid())return;
      if(files.kind==='ok'){setMedia(files.value.items);setNotice('Page et médias relus.');}
      else setNotice('Page relue. La liste des médias reste à actualiser.');
    }finally{finishBusy(serial);}
  }
  function choosePage(pageId:string){if(pageId!==selectedRef.current&&(dirty||hasInvalidContent)&&
      !window.confirm('Changer de page et abandonner les modifications locales ?'))return;
    if(selectedRef.current!==pageId){selectedRef.current=pageId;selectionEpoch.current++;
      setPublicVisibility(false);}
    setSelected(pageId);props.navigation.savePanelState({activeSubview:'pages',data:{
      sessionId,audience:props.audience,contextId:props.contextId,pageId,tab:'pages',
      ...(journal.current?.pending?{pending:{...journal.current.pending}}:{})}});}
  function changeTab(next:'pages'|'navigation'|'sidebar'){tabRef.current=next;setTab(next);props.navigation.savePanelState({activeSubview:next,
    data:{sessionId,audience:props.audience,contextId:props.contextId,
      ...(selected?{pageId:selected}:{}),tab:next,...(journal.current?.pending?{pending:{...journal.current.pending}}:{})}});}
  async function saveSidebar(edits:SidebarEdit[],resetIds:string[]):Promise<boolean>{
    if(!current()||!sidebar||sidebarUnavailable)return false;
    const serial=beginBusy();if(serial===null)return false;setNotice('');
    try{
      const result=await mutate<{revision:number}>('sidebar.save',{
        requestKey:requestKey(),expectedRevision:sidebar.revision,edits,resetIds},current);
      if(!current())return false;
      if(result.kind!=='ok'){setNotice(errorText(result.code));return false;}
      setNotice('Sidebar enregistrée ; droits et routes inchangés.');
      window.dispatchEvent(new Event('creezio:sidebar-updated'));
      await loadSidebar();return true;
    }finally{finishBusy(serial);}
  }
  const ownScope=scopeIdentity.current.sessionId===sessionId&&
    scopeIdentity.current.audience===props.audience&&scopeIdentity.current.contextId===props.contextId;
  const previewKey=preview?JSON.stringify([sessionId,props.audience,props.contextId,preview.id,
    'revision' in preview?`draft:${preview.revision}`:`published:${preview.publishedRevision}`]):'';
  useEffect(()=>{
    if(!enabled||!ownScope||!preview||!previewKey)return;
    const pageId=preview.id,selection=selectionEpoch.current,draft='revision' in preview,
      imageIds=publishedImageIds(preview);
    const valid=()=>pageCurrent(pageId,selection);
    let files:ReturnType<typeof createFileClient>|null=null;
    try{files=createFileClient({access:props.access,moduleId:'creezio.pages-navigation',
      categoryId:'media',contextId:props.contextId});}catch{ /* The loader reports unavailable. */ }
    const loader=createPublishedImageLoad({ids:imageIds,isCurrent:valid,
      list:()=>draft?Promise.resolve({kind:'ok' as const,value:{items:referencedMedia(media,imageIds)}}):
        call<{items:Media[]}>(scope,'media.published.list',{pageId},valid),
      download:item=>files?(draft?files.download(item.reference,valid):
        files.downloadLinked(item.reference,pageId,valid)):Promise.resolve({kind:'rejected'}),
      createUrl:(blob,mime)=>URL.createObjectURL(new Blob([blob],{type:mime})),
      revokeUrl:url=>URL.revokeObjectURL(url),
      update:states=>{if(valid())setPreviewImages({key:previewKey,states});}});
    void loader.run();return()=>loader.dispose();
  },[previewKey,preview,media,enabled,ownScope,props.client,props.access,props.contextId,props.audience,sessionId]);
  if(!enabled||!ownScope)return <div className={card}>Éditeur indisponible pour cette session.</div>;
  return <div className="space-y-4 p-4 text-slate-900">
    <header className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">Pages et navigation</h1>
      <p className="text-sm text-slate-600">Édition native, brouillons et snapshots publiés conservés en D1.</p>
      <div className="ml-auto flex gap-2"><button type="button" className={button} onClick={()=>changeTab('pages')}>Landing</button>
        <button type="button" className={button} onClick={()=>changeTab('navigation')}>Navigation</button>
        <button type="button" className={button} onClick={()=>changeTab('sidebar')}>Sidebar</button></div></header>
    <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
      Publier enregistre une version de la page. Avec « Accès public sans connexion », cette version et les images qu’elle utilise sont visibles sans connexion ; sinon, elles restent réservées aux lecteurs autorisés.</p>
    {notice&&<p role="status" className="rounded-md border border-sky-200 bg-sky-50 p-2 text-sm">{notice}</p>}
    {pending&&<div role="status" className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
      <p>Une action attend sa confirmation. Les nouvelles modifications sont suspendues.</p>
      <button type="button" className={button} disabled={checking} onClick={()=>void inspectPending()}>
        {checking?'Vérification…':'Vérifier le résultat'}</button></div>}
    <div className={tab==='pages'?'grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]':'hidden'}>
      <aside className={`${card} space-y-3`}><h2 className="font-semibold">Pages</h2>
        <button type="button" className={button} onClick={()=>void loadPages()}><RefreshCw size={14}/> Actualiser</button>
        <button type="button" className={button} disabled={!selected||busy} onClick={()=>void reloadSelected()}>
          <RefreshCw size={14}/> Relire la sélection</button>
        {loading&&<p className="text-xs">Chargement…</p>}
        <div className="grid gap-1">{pages.map(page=><button key={page.id} type="button"
          className={`rounded px-2 py-2 text-left text-sm ${selected===page.id?'bg-sky-100':'hover:bg-slate-100'}`}
          onClick={()=>choosePage(page.id)}>
          <span className="block font-medium">{page.title}</span><span className="text-xs text-slate-500">{page.slug} · v{page.revision}</span></button>)}</div>
        {pageCursor&&<button type="button" className={button} disabled={loading} onClick={()=>void loadPages(true,pageCursor)}>Afficher plus de pages</button>}
        <div className="border-t pt-3"><label className="block text-xs">Titre<input className={input} disabled={busy} value={newTitle} onChange={e=>setNewTitle(e.target.value)}/></label>
          <label className="mt-2 block text-xs">Chemin<input className={input} disabled={busy} value={newSlug} onChange={e=>setNewSlug(e.target.value)}/></label>
          <button type="button" disabled={busy||!newTitle.trim()} className={`${button} mt-2`} onClick={()=>void createPage()}><Plus size={14}/> Créer</button></div>
      </aside>
      <main className="min-w-0 space-y-4"><fieldset disabled={busy} className="min-w-0 space-y-4">{edited?<>
        <div className={`${card} flex flex-wrap items-center gap-2`}><div className="mr-auto"><h2 className="font-semibold">{edited.title}</h2>
          <p className="text-xs text-slate-500">Brouillon v{edited.revision} · publié v{edited.publishedRevision}{dirty?' · modifications locales':''}</p></div>
          <button type="button" className={button} disabled={!dirty||busy||hasInvalidContent} onClick={()=>void savePage()}><Save size={14}/> Enregistrer</button>
          <button type="button" className={button} disabled={dirty||busy||hasInvalidContent} onClick={()=>void previewPage()}><Eye size={14}/> Aperçu</button>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={publicVisibility===true}
            disabled={publicVisibility===null}
            onChange={e=>setPublicVisibility(e.target.checked)}/> Accès public sans connexion</label>
          {publicSlug&&<a className="text-xs underline" href={`/p?slug=${encodeURIComponent(publicSlug)}`}
            target="_blank" rel="noreferrer">Ouvrir la page publique</a>}
          <button type="button" className={button} disabled={dirty||busy||hasInvalidContent||publicVisibility===null} onClick={()=>void publishPage()}><Upload size={14}/> Publier</button>
          <button type="button" className={button} disabled={busy} onClick={()=>void resetPage()}><ArchiveRestore size={14}/> Reset brouillon</button></div>
        <section className={`${card} grid gap-3 md:grid-cols-2`}><h3 className="md:col-span-2 font-semibold">Réglages et SEO</h3>
          <label className="text-xs">Titre<input className={input} value={edited.title} onChange={e=>setEdited({...edited,title:e.target.value})}/></label>
          <label className="text-xs">Chemin<input className={input} value={edited.slug} onChange={e=>setEdited({...edited,slug:e.target.value})}/></label>
          {(['brandName','tagline','accent','background','logoUrl'] as const).map(name=><label key={name} className="text-xs">{name}
            <input className={input} value={String(edited.settings[name]??'')} onChange={e=>setEdited({...edited,
              settings:{...edited.settings,[name]:e.target.value}})}/></label>)}
          <label className="text-xs">Logo privé de la page
            <select className={input} value={edited.settings.logoFileId??''} onChange={e=>setEdited({...edited,
              settings:{...edited.settings,logoFileId:e.target.value}})}>
              <option value="">Aucun — conserver l’URL si renseignée</option>
              {media.map(item=><option key={item.fileId} value={item.fileId}>{item.filename}</option>)}
            </select></label>
          {(['title','description','canonical'] as const).map(name=><label key={name} className="text-xs">SEO {name}
            <input className={input} value={String(edited.seo[name]??'')} onChange={e=>setEdited({...edited,
              seo:{...edited.seo,[name]:e.target.value}})}/></label>)}
        </section>
        {hasInvalidContent&&<p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-900">Corrigez le JSON invalide avant d’enregistrer ou de publier.</p>}
        {sorted(edited.sections).map((section,index)=><section key={section.id} className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-center gap-2"><strong className="mr-auto">{section.kind} · {section.id}</strong>
            <label className="text-xs"><input type="checkbox" checked={section.enabled}
              onChange={e=>updateSection(section.id,{enabled:e.target.checked})}/> Actif</label>
            <button type="button" className={button} disabled={index===0} onClick={()=>moveSection(index,-1)} aria-label="Monter"><ChevronUp size={14}/></button>
            <button type="button" className={button} disabled={index===edited.sections.length-1} onClick={()=>moveSection(index,1)} aria-label="Descendre"><ChevronDown size={14}/></button>
            <button type="button" className={button} onClick={()=>setEdited({...edited,sections:edited.sections.filter(item=>item.id!==section.id)})}><Trash2 size={14}/> Retirer</button></div>
          <div className="grid gap-3 md:grid-cols-2">{Object.entries(section.content)
            .filter(([name])=>section.kind!=='hero'||name!=='imageFileId'&&name!=='logoFileId')
            .map(([name,value])=><ContentField key={`${section.id}-${name}`}
            name={name} value={value} onValidity={valid=>setInvalidContent(previous=>{const next=new Set(previous),key=`${section.id}:${name}`;
              if(valid)next.delete(key);else next.add(key);return next;})}
            onChange={next=>updateSection(section.id,{content:{...section.content,[name]:next}})}/>)}</div>
          {section.kind==='hero'&&<div className="grid gap-3 md:grid-cols-2">
            {(['imageFileId','logoFileId'] as const).map(name=><label key={name} className="text-xs">
              {name==='imageFileId'?'Image privée du hero':'Logo privé du hero'}
              <select className={input} value={String(section.content[name]??'')}
                onChange={e=>updateSection(section.id,{content:{...section.content,[name]:e.target.value}})}>
                <option value="">Aucune — conserver l’URL si renseignée</option>
                {media.map(item=><option key={item.fileId} value={item.fileId}>{item.filename}</option>)}
              </select></label>)}</div>}
        </section>)}
        <div className={`${card} flex gap-2`}><select aria-label="Type de section" className={input} value={newKind} onChange={e=>setNewKind(e.target.value)}>
          {kinds.map(kind=><option key={kind} value={kind}>{kind}</option>)}</select>
          <button type="button" className={button} onClick={()=>setEdited({...edited,sections:[...edited.sections,
            {id:crypto.randomUUID(),kind:newKind,position:edited.sections.length,enabled:true,content:{...defaults[newKind]}}]})}>
            <Plus size={14}/> Section</button></div>
        <section className={`${card} space-y-2`}><h3 className="font-semibold">Médias privés</h3>
          <p className="text-xs text-slate-600">Vos fichiers restent privés. Sélectionnez les images dans les champs de la page ;
            jusqu’à cinq images différentes peuvent apparaître dans une page publiée. Seules les images utilisées par une page avec accès public sont visibles sans connexion.</p>
          <label className={button}><ImagePlus size={14}/> Joindre un média<input hidden type="file" accept="image/png,image/jpeg,image/webp"
            disabled={busy||dirty} onChange={event=>void uploadMedia(event)}/></label>
          {media.map(item=><div key={item.fileId} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{item.filename}
            <span className="block truncate text-xs text-slate-500" title={item.fileId}>{item.fileId}</span></span>
            <button type="button" className={button} onClick={()=>void downloadMedia(item)}>Télécharger</button>
            <button type="button" className={button} onClick={()=>void unlinkMedia(item)}>Détacher</button></div>)}</section>
        {preview&&<LandingPreview page={preview} local={'revision' in preview}
          images={previewImages.key===previewKey?previewImages.states:{}}/>}
      </>:<div className={card}>Créez ou choisissez une page.</div>}</fieldset></main>
    </div><section className={tab==='navigation'?`${card} space-y-4`:'hidden'}><fieldset disabled={busy} className="space-y-4"><div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Navigation éditoriale</h2>
      <button type="button" className={button} disabled={!navDirty||busy} onClick={()=>void saveNav()}><Save size={14}/> Enregistrer</button>
      <button type="button" className={button} disabled={navDirty||busy||navigation.revision<1} onClick={()=>void publishNav()}><Upload size={14}/> Publier</button>
      <button type="button" className={button} disabled={busy||navigation.revision<1} onClick={()=>void resetNav()}><ArchiveRestore size={14}/> Reset brouillon</button></div>
      <p className="text-xs text-slate-600">Liens publiés du front. La présentation du menu du workspace se règle dans l’onglet Sidebar.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500">
        <th className="p-2">Lien</th><th className="p-2">Libellé</th><th className="p-2">Visible</th><th className="p-2">Ordre</th><th className="p-2">Actions</th></tr></thead>
        <tbody>{navEdited.items.map((item,index)=><tr key={item.id} className="border-b">
          <td className="p-2"><input className={input} aria-label="Lien ou route" value={item.href} disabled={!!item.pageSlug} onChange={e=>setNavEdited({...navEdited,
            items:navEdited.items.map(row=>row.id===item.id?{...row,href:e.target.value}:row)})}/>
            <input className={input} aria-label="Chemin de page publiée (facultatif)" placeholder="Page publiée : /aide"
              value={item.pageSlug??''} onChange={e=>setNavEdited({...navEdited,
                items:navEdited.items.map(row=>row.id===item.id?{...row,
                  ...(e.target.value?{href:e.target.value,pageSlug:e.target.value}:{pageSlug:undefined})}:row)})}/></td>
          <td className="p-2"><input className={input} value={item.label} onChange={e=>setNavEdited({...navEdited,
            items:navEdited.items.map(row=>row.id===item.id?{...row,label:e.target.value}:row)})}/></td>
          <td className="p-2"><input type="checkbox" checked={!item.hidden} onChange={e=>setNavEdited({...navEdited,
            items:navEdited.items.map(row=>row.id===item.id?{...row,hidden:!e.target.checked}:row)})}/></td>
          <td className="p-2">{item.order}</td><td className="p-2 whitespace-nowrap">
            <button type="button" className={button} disabled={index===0} onClick={()=>moveNav(index,-1)}><ChevronUp size={14}/></button>
            <button type="button" className={button} disabled={index===navEdited.items.length-1} onClick={()=>moveNav(index,1)}><ChevronDown size={14}/></button>
            <button type="button" className={button} onClick={()=>setNavEdited({...navEdited,
              items:navEdited.items.filter(row=>row.id!==item.id)})}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div>
      <button type="button" className={button} onClick={()=>setNavEdited({...navEdited,
        items:[...navEdited.items,{id:crypto.randomUUID(),label:'Nouveau lien',href:'/',icon:'Circle',
          group:'brand',order:navEdited.items.length,hidden:false}]})}><Plus size={14}/> Ajouter un lien</button>
    </fieldset></section>
    <div className={tab==='sidebar'?'':'hidden'}>{sidebarUnavailable?
      <section role="alert" className={card}>Catalogue sidebar indisponible pour cette session.
        <button type="button" className={button} onClick={()=>void loadSidebar()}>Relire</button></section>:
      <SidebarEditor catalog={sidebar} busy={busy||!!pending} reload={()=>void loadSidebar()} save={saveSidebar}/>}</div>
  </div>;
}
