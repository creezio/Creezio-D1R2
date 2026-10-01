'use client';

import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {views, navigation, httpBindings, compositionDigest} from '../../.creezio/generated/client';
import {createBrowserAccessController} from '../../sdk/access/controller';
import {NativeAccessPanel} from '../../sdk/access/components';
import type {AccessAudience, AccessController} from '../../sdk/access/types';
import {createOperationClient} from '../../sdk/operations/client';
import {Workspace, type WorkspaceRenderProps} from '@creezio/sdk/workspace/components';
import type {WorkspaceProjection, WorkspaceNavigation} from '../../sdk/workspace/types';
import {readProjection, WorkspaceAccessRefused} from './projection-client';
import {CreezioShell} from '../../admin/workspace/workspace-shell';
import {WidgetHostProvider} from '../../sdk/widgets/provider';
import {createLocalDeliveryTransport} from '../../admin/delivery/transport';
import {resolveWorkspaceLocation} from '../../sdk/workspace/controller';
import {startAnalyticsCollection} from '../analytics/collection';
import {shouldRefreshHostAccess} from '../access/operation-refusal';

export function WorkspaceHost({audience}: {audience: AccessAudience}) {
  const [access, setAccess] = useState<AccessController | null>(null);
  useEffect(() => {
    const controller = createBrowserAccessController({audience});
    setAccess(controller); void controller.refresh();
    return () => controller.dispose();
  }, [audience]);
  return <div className="workspace-host">
    {access && access.audience === audience ? <BoundWorkspace key={audience} access={access} /> : <p role="status">Chargement…</p>}
  </div>;
}

function BoundWorkspace({access}: {access: AccessController}) {
  const [deliveryTransport,setDeliveryTransport]=useState<ReturnType<typeof createLocalDeliveryTransport>|null>(null);
  useEffect(() => {
    const transport=createLocalDeliveryTransport({access});setDeliveryTransport(transport);
    return () => transport.dispose();
  },[access]);
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const [projection, setProjection] = useState<WorkspaceProjection | null>(null);
  const [sidebar,setSidebar]=useState<{key:string;items:readonly {id:string;viewId:string;title:string;order:number}[]}|null>(null);
  const [sidebarVersion,setSidebarVersion]=useState(0);
  useEffect(()=>{const refresh=()=>setSidebarVersion(value=>value+1);
    window.addEventListener('creezio:sidebar-updated',refresh);
    return()=>window.removeEventListener('creezio:sidebar-updated',refresh);
  },[]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revocationVersion,setRevocationVersion] = useState(0);
  const selection = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('context') ?? 'application';
    return {contextId: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requested) ? requested : '', initialUrl: params.get('view') ?? undefined};
  }, []);
  const {contextId, initialUrl} = selection;
  const currentProjection = useRef(projection); currentProjection.current = projection;
  const analyticsCollector=useRef<ReturnType<typeof startAnalyticsCollection>|null>(null);
  const analyticsUrl=useRef<string|null>(null);
  const assistantSession = useRef<string | null>(null);
  if (state.phase === 'authenticated' && state.session && !state.pending) assistantSession.current=state.session.id;
  else if (state.phase === 'anonymous' || state.pending === 'logout' || state.pending === 'login') assistantSession.current=null;
  const client = useMemo(() => {
    const base = createOperationClient({origin: access.origin, audience: access.audience, access,
      bindings: httpBindings.filter(binding => binding.audience === access.audience && binding.auth.includes('session'))});
    function rejectedAccess(result: Awaited<ReturnType<typeof base.invoke>>, bindingId: string,
      source: 'invoke' | 'status' = 'invoke') {
      if (shouldRefreshHostAccess(result, bindingId, source)) {
        setRevocationVersion(value => value+1); setProjection(null); void access.refresh();
      }
    }
    return {...base, async invoke(request: Parameters<typeof base.invoke>[0]) {
      const initial = currentProjection.current;
      const result = await base.invoke({...request, isCurrent: () => !!initial && currentProjection.current === initial && (request.isCurrent?.() ?? true)});
      rejectedAccess(result, request.bindingId);
      return result;
    }, async status(request: Parameters<typeof base.status>[0]) {
      const initial = currentProjection.current;
      const result = await base.status({...request, isCurrent: () => !!initial && currentProjection.current === initial && (request.isCurrent?.() ?? true)});
      rejectedAccess(result, request.bindingId, 'status');
      return result;
    }};
  }, [access]);
  useEffect(() => {
    setProjection(null); setError(false);
    if (state.phase !== 'authenticated' || state.pending || !state.session || !contextId) return;
    const abort = new AbortController(), session = state.session;
    const timer = setTimeout(() => abort.abort(), 15000);
    let current = true;
    void readProjection({origin: access.origin, session, contextId, compositionDigest, signal: abort.signal}).then(value => {
      const fresh = access.getSnapshot();
      if (current && fresh.phase === 'authenticated' && !fresh.pending && fresh.session?.id === session.id) setProjection(value);
    }).catch(error => { if (current) {
      if (error instanceof WorkspaceAccessRefused) setRevocationVersion(value => value+1);
      setError(true);
    } }).finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); abort.abort(); };
  }, [access, state, contextId, attempt]);
  const authenticated = state.phase === 'authenticated' && state.session && !state.pending;
  const analyticsReady=!!(authenticated&&projection&&projection.sessionId===state.session?.id
    &&projection.contextId===contextId&&projection.audience===access.audience
    &&projection.compositionDigest===compositionDigest);
  useEffect(()=>{
    if(!analyticsReady||!projection||!httpBindings.some(binding=>binding.moduleId==='creezio.analytics'
      &&binding.operationId==='collection.effective'&&binding.audience===access.audience))return;
    const collector=startAnalyticsCollection({client,contextId,audience:access.audience,
      surface:'workspace',target:document});analyticsCollector.current=collector;
    const locate=(url:string|null)=>{
      const location=url?resolveWorkspaceLocation(url,views,new Set(projection.viewIds),'workspace'):null;
      const view=location&&views.find(item=>item.id===location.viewId);
      collector.location(view?{viewId:view.id,route:view.route}:null);void collector.refresh();
    };
    locate(analyticsUrl.current);
    const refresh=()=>{void collector.refresh();};
    window.addEventListener('creezio:analytics-policy-updated',refresh);
    return()=>{window.removeEventListener('creezio:analytics-policy-updated',refresh);
      if(analyticsCollector.current===collector)analyticsCollector.current=null;collector.dispose();};
  },[analyticsReady,projection,client,contextId,access.audience]);
  const sidebarKey=projection&&authenticated
    ?`${projection.sessionId}:${projection.contextId}:${projection.audience}:${projection.compositionDigest}:${projection.epoch}`:'';
  useEffect(()=>{
    setSidebar(null);
    if(!projection||!authenticated||projection.compositionDigest!==compositionDigest||
      projection.sessionId!==state.session?.id||projection.contextId!==contextId)return;
    const binding=httpBindings.find(item=>item.moduleId==='creezio.pages-navigation'
      &&item.operationId==='sidebar.resolved'&&item.audience===access.audience
      &&item.auth.includes('session')&&item.contributorModuleId==='creezio.pages-navigation');
    if(!binding)return;
    let current=true;
    void client.invoke({bindingId:`${binding.contributorModuleId}:${binding.id}`,contextId,input:{},
      isCurrent:()=>current}).then(result=>{
      if(!current||result.kind!=='execution'||result.execution.state!=='succeeded')return;
      const value=result.execution.output;
      if(!value||typeof value!=='object'||Array.isArray(value))return;
      const data=value as Record<string,unknown>;
      if(data.sessionId!==projection.sessionId||data.contextId!==contextId||
        data.audience!==access.audience||data.compositionDigest!==compositionDigest||
        data.epoch!==projection.epoch||!Array.isArray(data.items)||data.items.length>navigation.length)return;
      const visible=new Set(projection.navigationIds),known=new Map(navigation.map(item=>[item.id,item]));
      const items: {id:string;viewId:string;title:string;order:number}[]=[],seen=new Set<string>();
      for(const raw of data.items){
        if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
        const item=raw as Record<string,unknown>,source=known.get(String(item.id));
        if(!source||!visible.has(source.id)||seen.has(source.id)||item.viewId!==source.viewId
          ||typeof item.title!=='string'||!item.title||item.title.length>240||!item.title.isWellFormed()
          ||!Number.isSafeInteger(item.order)||Number(item.order)<0||Number(item.order)>10000)return;
        seen.add(source.id);items.push({id:source.id,viewId:source.viewId,title:item.title,order:Number(item.order)});
      }
      setSidebar({key:sidebarKey,items});
    }).catch(()=>{});
    return()=>{current=false;};
  },[projection,authenticated,state.session?.id,contextId,access.audience,client,sidebarKey,sidebarVersion]);
  const workspaceNavigation=useMemo(()=>{
    if(!projection||sidebar?.key!==sidebarKey)return navigation;
    const selected=new Map(sidebar.items.map(item=>[item.id,item]));
    return navigation.filter(item=>selected.has(item.id)).map(item=>({...item,
      title:selected.get(item.id)!.title,order:selected.get(item.id)!.order}));
  },[projection,sidebar,sidebarKey]);
  const assistantView = views.find(view => view.id === 'creezio.conversations:admin' && view.moduleId === 'creezio.conversations'
    && view.audiences.includes(access.audience) && view.surfaces.includes('workspace'));
  const renderShell = (shell: WorkspaceRenderProps) => {
    const Assistant = assistantView?.component;
    const input = {presentation:'assistant'};
    const viewId='creezio.conversations:admin';
    const allowed=!!(shell.authorized && projection?.viewIds.includes(viewId));
    const navigation: WorkspaceNavigation = {
      open:(...args)=>allowed&&shell.controller.open(...args),visit:(...args)=>allowed&&shell.controller.visit(...args),
      back:()=>allowed&&shell.controller.back(),forward:()=>allowed&&shell.controller.forward(),
      readPanelState:()=>null,savePanelState:()=>false,
    };
    return <CreezioShell {...shell} account={state.session ? {displayName: state.session.displayName} : null}
      deliveryTransport={access.audience==='admin'&&access.origin.startsWith('http://127.0.0.1:')?deliveryTransport:null}
      assistantScopeKey={assistantSession.current ? `${assistantSession.current}:${access.audience}:${contextId}` : 'anonymous'}
      assistant={Assistant && assistantView?.validateInput(input) ? <div hidden={!allowed} inert={!allowed}>
        <Assistant key={revocationVersion} access={access} client={client} audience={access.audience} contextId={contextId} input={input}
          panelId="creezio-native-assistant" location={{viewId,input,url:assistantView.route,identity:'creezio-native-assistant'}}
          authorized={allowed} active={allowed} navigation={navigation} />
      </div> : undefined}
      onRefreshAccess={() => {setProjection(null);void access.refresh();}}
      onLogout={() => {setProjection(null);void access.logout();}} />;
  };
  return <WidgetHostProvider origin={access.origin} audience={access.audience} contextId={contextId} access={access}
    operationClient={client} resolveOperationBinding={({moduleId,operationId,operationDigest}) => {
      const matches = httpBindings.filter(binding => binding.audience === access.audience && binding.auth.includes('session')
        && binding.moduleId === moduleId && binding.operationId === operationId && binding.contractDigest === operationDigest);
      const binding = matches.find(item => item.contributorModuleId === moduleId)
        ?? matches.sort((a,b) => `${a.contributorModuleId}:${a.id}`.localeCompare(`${b.contributorModuleId}:${b.id}`))[0];
      return binding ? `${binding.contributorModuleId}:${binding.id}` : null;
    }}>
    {!authenticated && <section className="workspace-host-access"><NativeAccessPanel audience={access.audience} controller={access} /></section>}
    {!contextId ? <p role="alert">Le contexte demandé est invalide.</p> : error ? <div role="alert">Impossible de vérifier l’accès aux vues.
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></div> : null}
    <div hidden={!authenticated} inert={!authenticated}>
    <Workspace access={access} projection={projection} views={views} navigation={workspaceNavigation} client={client} contextId={contextId}
      revocationVersion={revocationVersion}
      homeViewId={navigation.find(item => item.viewId.endsWith(':dashboard') || item.viewId.endsWith(':home'))?.viewId}
      renderShell={renderShell}
      initialUrl={initialUrl} onLocationChange={url => {
        analyticsUrl.current=url;
        if(analyticsCollector.current){
          const location=projection?resolveWorkspaceLocation(url,views,new Set(projection.viewIds),'workspace'):null;
          const view=location&&views.find(item=>item.id===location.viewId);
          analyticsCollector.current.location(view?{viewId:view.id,route:view.route}:null);
          void analyticsCollector.current.refresh();
        }
        const current = new URL(window.location.href); current.searchParams.set('context', contextId); current.searchParams.set('view', url);
        window.history.replaceState(null, '', current);
      }} />
    </div>
  </WidgetHostProvider>;
}
