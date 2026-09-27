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
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const [projection, setProjection] = useState<WorkspaceProjection | null>(null);
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
  const assistantSession = useRef<string | null>(null);
  if (state.phase === 'authenticated' && state.session && !state.pending) assistantSession.current=state.session.id;
  else if (state.phase === 'anonymous' || state.pending === 'logout' || state.pending === 'login') assistantSession.current=null;
  const client = useMemo(() => {
    const base = createOperationClient({origin: access.origin, audience: access.audience, access,
      bindings: httpBindings.filter(binding => binding.audience === access.audience && binding.auth.includes('session'))});
    function rejectedAccess(result: Awaited<ReturnType<typeof base.invoke>>) {
      if (result.kind === 'rejected' && ['unauthorized','forbidden','authentication_required'].includes(result.code)) {
        setRevocationVersion(value => value+1); setProjection(null); void access.refresh();
      }
    }
    return {...base, async invoke(request: Parameters<typeof base.invoke>[0]) {
      const initial = currentProjection.current;
      const result = await base.invoke({...request, isCurrent: () => !!initial && currentProjection.current === initial && (request.isCurrent?.() ?? true)});
      rejectedAccess(result);
      return result;
    }, async status(request: Parameters<typeof base.status>[0]) {
      const initial = currentProjection.current;
      const result = await base.status({...request, isCurrent: () => !!initial && currentProjection.current === initial && (request.isCurrent?.() ?? true)});
      rejectedAccess(result);
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
    <Workspace access={access} projection={projection} views={views} navigation={navigation} client={client} contextId={contextId}
      revocationVersion={revocationVersion}
      homeViewId={navigation.find(item => item.viewId.endsWith(':dashboard') || item.viewId.endsWith(':home'))?.viewId}
      renderShell={renderShell}
      initialUrl={initialUrl} onLocationChange={url => {
        const current = new URL(window.location.href); current.searchParams.set('context', contextId); current.searchParams.set('view', url);
        window.history.replaceState(null, '', current);
      }} />
    </div>
  </WidgetHostProvider>;
}
