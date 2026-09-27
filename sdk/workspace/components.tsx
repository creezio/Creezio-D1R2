'use client';

import {createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {WorkspaceController} from './controller.ts';
import {createWorkspaceController, viewKey} from './controller.ts';
import type {WorkspaceNavigation, WorkspaceNavigationItem, WorkspaceProps, WorkspaceViewProps} from './types.ts';

export interface WorkspaceRenderProps {
  readonly controller: WorkspaceController;
  readonly snapshot: ReturnType<WorkspaceController['getSnapshot']>;
  readonly authorized: boolean;
  readonly items: readonly WorkspaceNavigationItem[];
  readonly children: ReactNode;
}

const ActivityContext = createContext(true);
const PortalHostContext = createContext<HTMLElement | null>(null);
export const useWorkspaceActivity = () => useContext(ActivityContext);
export const useWorkspacePortalHost = () => useContext(PortalHostContext);

/** Portals remain descendants of the retained pane's hidden/inert boundary. */
export function WorkspacePortal({children}: {children: ReactNode}) {
  const host = useContext(PortalHostContext);
  const active = useWorkspaceActivity();
  return host ? createPortal(<div className="creezio-workspace-portal" hidden={!active} inert={!active}>
    {children}
  </div>, host) : null;
}

/** Retained subviews follow the parent pane activity, including React portals. */
export function RetainedSubViews({active, views}: {active: string;
  views: readonly {id: string; content: ReactNode}[]}) {
  const parentActive = useWorkspaceActivity();
  const [visited, setVisited] = useState<readonly string[]>([active]);
  useEffect(() => { if (!visited.includes(active)) setVisited(previous => [...previous, active]); }, [active, visited]);
  return <>{views.filter(view => view.id === active || visited.includes(view.id)).map(view => {
    const live = parentActive && view.id === active;
    return <ActivityContext.Provider key={view.id} value={live}>
      <section className="creezio-workspace-subview" data-subview={view.id} hidden={!live} inert={!live}>
        {view.content}
      </section>
    </ActivityContext.Provider>;
  })}</>;
}

function Pane({controller, tab, active, authorized, views, contextId, audience, client, access}: {
  controller: WorkspaceController;
  tab: ReturnType<WorkspaceController['getSnapshot']>['tabs'][number];
  active: boolean; authorized: boolean; views: WorkspaceProps['views']; contextId: string;
  audience: WorkspaceViewProps['audience']; client: WorkspaceProps['client']; access: WorkspaceProps['access'];
}) {
  const view = views.find(item => viewKey(item) === tab.location.viewId);
  const element = view?.component;
  const panel = useRef<HTMLElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const scroll = useRef({top: tab.panelState?.scrollTop ?? 0, left: tab.panelState?.scrollLeft ?? 0});
  const firstActivation = useRef(true);
  const lastFocus = useRef<HTMLElement | null>(null);
  const wasActive = useRef(active);
  const activity = useRef({active, generation: 0, mounted: true});
  useLayoutEffect(() => {
    if (activity.current.active !== active) {
      activity.current.active = active;
      activity.current.generation++;
    }
  }, [active]);
  useEffect(() => {
    activity.current.mounted = true;
    return () => { activity.current.mounted = false; activity.current.generation++; };
  }, []);
  const guardedClient = useMemo(() => Object.freeze({...client,
    invoke(request: Parameters<typeof client.invoke>[0]) {
      const generation = activity.current.generation;
      return client.invoke({...request, isCurrent: () => activity.current.mounted
        && activity.current.active && activity.current.generation === generation
        && (request.isCurrent?.() ?? true)});
    },
    status(request: Parameters<typeof client.status>[0]) {
      const generation = activity.current.generation;
      return client.status({...request, isCurrent: () => activity.current.mounted
        && activity.current.active && activity.current.generation === generation
        && (request.isCurrent?.() ?? true)});
    },
  }), [client]);
  useLayoutEffect(() => {
    if (wasActive.current && !active && panel.current) {
      if (document.activeElement instanceof HTMLElement && panel.current.contains(document.activeElement))
        lastFocus.current = document.activeElement;
    } else if ((!wasActive.current || firstActivation.current) && active && panel.current) {
      panel.current.scrollTo(scroll.current.left, scroll.current.top);
      firstActivation.current = false;
      const focus = lastFocus.current;
      if (focus?.isConnected && panel.current.contains(focus)
        && (document.activeElement === document.body
          || document.activeElement?.closest('.creezio-workspace-pane[hidden]'))) focus.focus();
    }
    wasActive.current = active;
  }, [active]);
  // The navigation object is stable for this pane. Its commands still check
  // the live projection at the point of use.
  const navigation: WorkspaceNavigation = useMemo(() => Object.freeze({
    open: (...args: Parameters<WorkspaceController['open']>) => activity.current.active && controller.open(...args),
    visit: (...args: Parameters<WorkspaceController['visit']>) => activity.current.active && controller.visit(...args),
    back: () => activity.current.active && controller.back(),
    forward: () => activity.current.active && controller.forward(),
    readPanelState: () => controller.readPanelStateFor(tab.id),
    savePanelState: (state: Parameters<WorkspaceController['savePanelStateFor']>[1]) => activity.current.active && controller.savePanelStateFor(tab.id,state),
  }),[controller,tab.id]);
  if (!element) return null;
  const View = element;
  return <ActivityContext.Provider value={active}><PortalHostContext.Provider value={portalHost}>
    <section ref={panel} className="creezio-workspace-pane" role="tabpanel"
      id={`creezio-panel-${tab.id}`} aria-labelledby={`creezio-tab-${tab.id}`}
      data-pane-id={tab.id} data-view-id={tab.location.viewId}
      onScroll={event => {
        if (!active) return;
        scroll.current = {top:event.currentTarget.scrollTop,left:event.currentTarget.scrollLeft};
        const state = controller.readPanelStateFor(tab.id) ?? {};
        controller.savePanelStateFor(tab.id,{...state,scrollTop:Math.round(scroll.current.top),scrollLeft:Math.round(scroll.current.left)});
      }}
      onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocus.current = event.target; }}
      hidden={!active} inert={!active}>
      <View panelId={tab.id} location={tab.location} input={tab.location.input} contextId={contextId} audience={audience}
        access={access} authorized={authorized}
        active={active} navigation={navigation} client={guardedClient} />
      <div ref={setPortalHost} className="creezio-workspace-portal-host" />
    </section>
  </PortalHostContext.Provider></ActivityContext.Provider>;
}

/** Host-owned access and authorization projections are the only visibility source. */
export function Workspace(props: WorkspaceProps & {
  renderShell?: (state: WorkspaceRenderProps) => ReactNode;
  revocationVersion?: number;
}) {
  const {access, projection, views, contextId} = props;
  const locationCallback = useRef(props.onLocationChange);
  locationCallback.current = props.onLocationChange;
  const controller = useMemo(() => createWorkspaceController({access, views, contextId,
    surface: props.surface,
    storage: (() => { try { return props.persist !== false && typeof window !== 'undefined' ? window.sessionStorage : undefined; } catch { return undefined; } })(),
    homeViewId: props.homeViewId, onLocationChange: url => locationCallback.current?.(url)}),
    [access, views, contextId, props.homeViewId, props.surface, props.persist]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [accessState, setAccessState] = useState(access.getSnapshot);
  const lastRevocation = useRef(props.revocationVersion);
  useLayoutEffect(() => {
    if (lastRevocation.current !== props.revocationVersion) {
      lastRevocation.current = props.revocationVersion;
      controller.revokeProjection();
    }
  },[controller,props.revocationVersion]);
  useEffect(() => access.subscribe(() => setAccessState(access.getSnapshot())), [access]);
  useEffect(() => { controller.setProjection(projection); }, [controller, projection]);
  const initialVisit = useRef<{controller: WorkspaceController; sessionId: string} | null>(null);
  useEffect(() => {
    if (!projection || !props.initialUrl) return;
    if (initialVisit.current?.controller === controller && initialVisit.current.sessionId === projection.sessionId) return;
    if (controller.visit(props.initialUrl)) initialVisit.current = {controller, sessionId: projection.sessionId};
  }, [controller, projection, props.initialUrl]);
  useEffect(() => () => controller.dispose(), [controller]);
  const authorized = !!(accessState.phase === 'authenticated' && accessState.pending === null
    && accessState.session && projection && projection.sessionId === accessState.session.id
    && projection.principalId === accessState.session.principalId
    && projection.audience === access.audience && projection.contextId === contextId
    && controller.isCurrentProjection(projection) && props.hostActive !== false);
  const permittedViews = new Set(authorized ? projection?.viewIds ?? [] : []);
  const items = props.navigation.filter(item => authorized && projection?.navigationIds.includes(item.id)
    && permittedViews.has(item.viewId) && views.some(view => viewKey(view) === item.viewId
      && view.surfaces.includes(props.surface ?? 'workspace') && view.audiences.includes(access.audience)))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const children = <div className="creezio-workspace-panels" data-audience={access.audience}>
    {!authorized && <p className="creezio-workspace-suspended" role="status">Vérification de l’accès au workspace…</p>}
    {authorized && snapshot.tabs.length === 0 && <p role="status">Choisissez une vue dans la navigation.</p>}
    {snapshot.tabs.map(tab => {
      const view = views.find(item => viewKey(item) === tab.location.viewId);
      return view && (!authorized || permittedViews.has(tab.location.viewId))
        && (tab.id === snapshot.activeTabId || view.panel.retention === 'preserve')
        ? <Pane key={tab.id} controller={controller} tab={tab} active={authorized && tab.id === snapshot.activeTabId}
            authorized={authorized && permittedViews.has(tab.location.viewId)}
            views={views} contextId={contextId} audience={access.audience} client={props.client} access={access} /> : null;
    })}
  </div>;
  return props.renderShell ? props.renderShell({controller, snapshot, authorized, items, children}) : children;
}
