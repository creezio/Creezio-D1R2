'use client';

import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {compositionDigest, front, frontViews, frontNavigation, frontSlots, frontTheme, httpBindings}
  from '../../.creezio/generated/client';
import {frontBrand, frontContextId, FrontCustomTheme} from '../../application/frontend';
import {createBrowserAccessController} from '../../sdk/access/controller';
import {NativeAccessPanel} from '../../sdk/access/components';
import type {AccessController} from '../../sdk/access/types';
import {createOperationClient} from '../../sdk/operations/client';
import {Workspace} from '@creezio/sdk/workspace/components';
import {createWorkspaceLocation, resolveWorkspaceLocation, type WorkspaceController}
  from '../../sdk/workspace/controller';
import type {WorkspaceInput, WorkspaceLocation, WorkspaceView, WorkspaceViewProps} from '../../sdk/workspace/types';
import type {RuntimeFrontView} from '../../sdk/runtime/ui';
import type {FrontProjection, FrontThemeProps, PublicFrontViewProps} from '../../sdk/front/types';
import {shouldNavigateFromPanel} from '../../sdk/front/navigation';
import {FrontAccessRefused, readFrontProjection} from './projection-client';
import styles from './host.module.css';
import {WidgetHostProvider} from '../../sdk/widgets/provider';

const contextId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(frontContextId) ? frontContextId : '';
const emptyInput: WorkspaceInput = Object.freeze({});
const browserUrl = () => `${window.location.pathname}${window.location.search}`;
const appViews = frontViews.filter(view => view.surfaces.includes('front') && view.audiences.includes('app'));
const appViewIds = new Set(appViews.map(view => view.id));
const publicViewIds = new Set(appViews.filter(view => view.access === 'public-read').map(view => view.id));
const publicView = (viewId: string) => appViews.find(view => view.id === viewId && view.access === 'public-read');

/** Public components stay presentational even when a native app session exists. */
function workspaceAdapter(view: RuntimeFrontView): WorkspaceView {
  if (view.access === 'protected') return view;
  const PublicComponent = view.component;
  function PublicViewAdapter({input, location, active, navigation}: WorkspaceViewProps) {
    const publicNavigation: PublicFrontViewProps['navigation'] = {
      open: (id, values, options) => navigation.open(id, values, options),
      visit: (url, options) => navigation.visit(url, options),
    };
    return <PublicComponent input={input} location={location} audience="app" active={active} navigation={publicNavigation} />;
  }
  return {...view, component: PublicViewAdapter};
}

function ProtectedSlot({slotName, slotId, view, access, projection, client, visible, revocationVersion}: {
  slotName: string; slotId: string; view: Extract<RuntimeFrontView, {access:'protected'}>;
  access: AccessController; projection: FrontProjection | null;
  client: ReturnType<typeof createOperationClient>; visible: boolean; revocationVersion: number;
}) {
  const views = useMemo<readonly WorkspaceView[]>(() => [view], [view]);
  return <section className={styles.flow} data-front-slot={slotName} data-slot-id={slotId} hidden={!visible} inert={!visible}>
    <Workspace access={access} projection={visible ? projection : null} views={views}
      navigation={[]} client={client} contextId={contextId} surface="front" persist={false}
      hostActive={visible} homeViewId={view.id} revocationVersion={revocationVersion} />
  </section>;
}

export function FrontHost({initialUrl}: {initialUrl?: string}) {
  const [access, setAccess] = useState<AccessController | null>(null);
  useEffect(() => {
    const controller = createBrowserAccessController({audience: 'app'});
    setAccess(controller); void controller.refresh();
    return () => controller.dispose();
  }, []);
  if (front.kind !== 'theme') return null;
  return access ? <BoundFront access={access} initialUrl={initialUrl} /> : <p role="status">Chargement du front…</p>;
}

function BoundFront({access, initialUrl}: {access: AccessController; initialUrl?: string}) {
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getSnapshot);
  const [projection, setProjection] = useState<FrontProjection | null>(null);
  const [retainedProjection, setRetainedProjection] = useState<FrontProjection | null>(null);
  const [projectionError, setProjectionError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revocationVersion, setRevocationVersion] = useState(0);
  const [showLogin, setShowLogin] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(() => typeof window === 'undefined' ? initialUrl ?? '/' : browserUrl());
  const [activePanelUrl, setActivePanelUrl] = useState<string | null>(null);
  const activePanelUrlRef = useRef<string | null>(null);
  const controllerRef = useRef<WorkspaceController | null>(null);
  const currentProjection = useRef(projection); currentProjection.current = projection;
  const lastRevocation = useRef(revocationVersion);

  useEffect(() => {
    const onPopState = () => setCurrentUrl(browserUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const authenticated = state.phase === 'authenticated' && state.pending === null && state.session?.audience === 'app';
  useEffect(() => {
    setProjection(null); setProjectionError(false);
    if (!authenticated || !state.session || !contextId) return;
    const session = state.session, abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    let current = true;
    void readFrontProjection({origin: access.origin, session, contextId, compositionDigest, signal: abort.signal}).then(value => {
      const fresh = access.getSnapshot();
      if (current && fresh.phase === 'authenticated' && !fresh.pending && fresh.session?.id === session.id) setProjection(value);
    }).catch(error => { if (current) {
      if (error instanceof FrontAccessRefused) setRevocationVersion(value => value + 1);
      setProjectionError(true);
    }}).finally(() => clearTimeout(timer));
    return () => { current = false; clearTimeout(timer); abort.abort(); };
  }, [access, authenticated, state.session, attempt]);
  useEffect(() => { if (authenticated) setShowLogin(false); }, [authenticated]);

  const authorized = !!(authenticated && state.session && projection
    && projection.sessionId === state.session.id && projection.principalId === state.session.principalId
    && projection.audience === 'app' && projection.contextId === contextId
    && projection.compositionDigest === compositionDigest);
  useEffect(() => {
    if (lastRevocation.current !== revocationVersion) {
      lastRevocation.current = revocationVersion;
      setRetainedProjection(null);
    } else if (authorized && projection) setRetainedProjection(projection);
    else if (state.phase === 'anonymous' || state.pending
      || state.phase === 'authenticated' && retainedProjection
        && (state.session?.id !== retainedProjection.sessionId
          || state.session.principalId !== retainedProjection.principalId)) setRetainedProjection(null);
  }, [authorized, projection, state.phase, state.pending, state.session, retainedProjection, revocationVersion]);
  const client = useMemo(() => {
    const base = createOperationClient({origin: access.origin, audience: 'app', access,
      bindings: httpBindings.filter(binding => binding.audience === 'app' && binding.auth.includes('session'))});
    const rejection = (result: Awaited<ReturnType<typeof base.invoke>>) => {
      if (result.kind === 'rejected' && ['unauthorized','forbidden','authentication_required'].includes(result.code)) {
        setProjection(null); setRevocationVersion(value => value + 1); void access.refresh();
      }
    };
    return {...base,
      async invoke(request: Parameters<typeof base.invoke>[0]) {
        const initial = currentProjection.current;
        const result = await base.invoke({...request, isCurrent: () => !!initial && currentProjection.current === initial
          && (request.isCurrent?.() ?? true)});
        rejection(result); return result;
      },
      async status(request: Parameters<typeof base.status>[0]) {
        const initial = currentProjection.current;
        const result = await base.status({...request, isCurrent: () => !!initial && currentProjection.current === initial
          && (request.isCurrent?.() ?? true)});
        rejection(result); return result;
      },
    };
  }, [access]);

  const visibleIds = useMemo(() => new Set([...publicViewIds, ...(authorized ? projection?.viewIds ?? [] : [])]),
    [authorized, projection]);
  const allLocation = resolveWorkspaceLocation(currentUrl, appViews, appViewIds, 'front');
  const currentView = allLocation && appViews.find(view => view.id === allLocation.viewId);
  const currentPermitted = !!(currentView && visibleIds.has(currentView.id));
  const workspaceViews = useMemo(() => appViews.map(workspaceAdapter), []);
  const routeTo = useCallback((location: WorkspaceLocation, replace = false) => {
    if (browserUrl() !== location.url) window.history[replace ? 'replaceState' : 'pushState'](null, '', location.url);
    setCurrentUrl(location.url);
  }, []);
  const navigate = useCallback((viewId: string, input: WorkspaceInput = {}): boolean => {
    const view = appViews.find(item => item.id === viewId);
    const location = view && createWorkspaceLocation(view, input);
    if (!location) return false;
    if (!visibleIds.has(viewId)) {
      if (view.access === 'protected' && !authorized) { routeTo(location); return true; }
      return false;
    }
    if (view.access === 'protected' && controllerRef.current?.open(viewId, input)) {
      routeTo(location);
      return true;
    }
    routeTo(location);
    return true;
  }, [authorized, routeTo, visibleIds]);
  const visit = useCallback((url: string): boolean => {
    const location = resolveWorkspaceLocation(url, appViews, appViewIds, 'front');
    return location ? navigate(location.viewId, location.input) : false;
  }, [navigate]);
  useEffect(() => {
    if (!authorized || !allLocation || currentView?.access !== 'protected' || activePanelUrl === allLocation.url) return;
    const timer = setTimeout(() => { controllerRef.current?.visit(allLocation.url); }, 0);
    return () => clearTimeout(timer);
  }, [authorized, currentUrl, allLocation?.url, currentView?.access, activePanelUrl]);

  const navigation: FrontThemeProps['navigation'] = frontNavigation.filter(item => {
    if (!item.surfaces.includes('front') || !item.audiences.includes('app') || !visibleIds.has(item.viewId)) return false;
    const target = appViews.find(view => view.id === item.viewId);
    return target?.access === 'public-read' && item.permissions.length === 0
      || !!(authorized && projection?.navigationIds.includes(item.id));
  }).map(item => ({id:item.id,title:item.title,viewId:item.viewId,order:item.order,
    active:allLocation?.viewId === item.viewId})).sort((a,b) => a.order-b.order || a.title.localeCompare(b.title));

  const renderSlot = (slotName: string): ReactNode => {
    if (!frontTheme?.slots.includes(slotName)) return null;
    return frontSlots.filter(slot => slot.slot === slotName && slot.surfaces.includes('front')
      && slot.audiences.includes('app')).map(slot => {
      const view = appViews.find(item => item.id === slot.viewId);
      if (!view) return null;
      const currentSlot = !!(authorized && visibleIds.has(view.id) && projection?.slotIds.includes(slot.id));
      const retainedSlot = !!(retainedProjection?.viewIds.includes(view.id)
        && retainedProjection.slotIds.includes(slot.id));
      if (view.access === 'public-read' && !(slot.permissions.length === 0 || currentSlot)) return null;
      if (view.access === 'protected' && !(currentSlot || retainedSlot)) return null;
      const location = createWorkspaceLocation(view, emptyInput);
      if (!location) return <p key={slot.id} role="alert">Emplacement front invalide : {slot.id}</p>;
      if (view.access === 'public-read') {
        const PublicComponent = view.component;
        return <section key={slot.id} data-front-slot={slotName} data-slot-id={slot.id}>
          <PublicComponent input={location.input} location={location} audience="app" active
            navigation={{open: navigate, visit}} />
        </section>;
      }
      return <ProtectedSlot key={slot.id} slotName={slotName} slotId={slot.id} view={view}
        access={access} projection={projection} client={client} visible={currentSlot}
        revocationVersion={revocationVersion} />;
    });
  };

  const Theme = FrontCustomTheme ?? frontTheme?.component;
  if (!Theme) return <p role="alert">Le thème front sélectionné est indisponible.</p>;
  let content: ReactNode;
  if (!allLocation || !currentView) content = currentUrl === '/'
    ? <p role="status">Choisissez une vue dans la navigation.</p>
    : <p role="alert">Vue front introuvable.</p>;
  else if (!currentPermitted && currentView.access === 'protected') content = !authenticated
    ? <NativeAccessPanel audience="app" controller={access} />
    : <p role="status">{authorized ? 'Accès à cette vue refusé.' : 'Vérification des droits du front…'}</p>;
  else if (currentView.access === 'public-read') {
    const PublicComponent = currentView.component;
    content = <PublicComponent input={allLocation.input} location={allLocation} audience="app" active
      navigation={{open: navigate, visit}} />;
  } else content = null;
  const panelActive = !!(authorized && currentView?.access === 'protected' && allLocation
    && activePanelUrl === allLocation.url);
  const protectedPanels = <Workspace access={access} projection={authorized ? projection : null}
    views={workspaceViews} navigation={frontNavigation} client={client} contextId={contextId}
    surface="front" initialUrl={currentUrl} hostActive={panelActive} revocationVersion={revocationVersion}
    onLocationChange={url => {
      const requested = browserUrl(), previousPanelUrl = activePanelUrlRef.current;
      activePanelUrlRef.current = url;
      setActivePanelUrl(url);
      const location = resolveWorkspaceLocation(url, appViews, appViewIds, 'front');
      const shown = resolveWorkspaceLocation(requested, appViews, appViewIds, 'front');
      const shownView = shown && appViews.find(view => view.id === shown.viewId);
      if (location && shouldNavigateFromPanel(requested, previousPanelUrl, url,
        !!(shownView?.access === 'protected' && authorized && visibleIds.has(shownView.id)))) routeTo(location);
    }} renderShell={({controller, children}) => { controllerRef.current = controller; return children; }} />;
  return <WidgetHostProvider origin={access.origin} audience="app" contextId={contextId} access={access}
    operationClient={client} resolveOperationBinding={({moduleId,operationId,operationDigest}) => {
      const matches = httpBindings.filter(binding => binding.audience === 'app' && binding.auth.includes('session')
        && binding.moduleId === moduleId && binding.operationId === operationId && binding.contractDigest === operationDigest);
      const binding = matches.find(item => item.contributorModuleId === moduleId)
        ?? matches.sort((a,b) => `${a.contributorModuleId}:${a.id}`.localeCompare(`${b.contributorModuleId}:${b.id}`))[0];
      return binding ? `${binding.contributorModuleId}:${binding.id}` : null;
    }}><Theme brand={frontBrand} account={authenticated && state.session ? {displayName:state.session.displayName} : null}
    navigation={navigation} location={allLocation} navigate={navigate} renderSlot={renderSlot}
    onLogin={() => setShowLogin(true)} onLogout={() => { setProjection(null); void access.logout(); }}
    onRefresh={() => { setProjection(null); void access.refresh(); }}>
    {!contextId && <p role="alert">Le contexte front configuré est invalide.</p>}
    {showLogin && !authenticated && currentView?.access !== 'protected'
      && <NativeAccessPanel audience="app" controller={access} />}
    {projectionError && authenticated && <p role="alert">Impossible de vérifier les droits du front.
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></p>}
    {content}
    <div className={styles.flow} hidden={!panelActive} inert={!panelActive}>{protectedPanels}</div>
  </Theme></WidgetHostProvider>;
}
