'use client';

import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {views, navigation, httpBindings, compositionDigest} from '../../.creezio/generated/client';
import {createBrowserAccessController} from '../../sdk/access/controller';
import {NativeAccessPanel} from '../../sdk/access/components';
import type {AccessAudience, AccessController} from '../../sdk/access/types';
import {createOperationClient} from '../../sdk/operations/client';
import {Workspace} from '../../sdk/workspace/components';
import type {WorkspaceProjection} from '../../sdk/workspace/types';
import {readProjection, WorkspaceAccessRefused} from './projection-client';
import {CreezioShell} from '../../admin/workspace/workspace-shell';

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
  return <>
    {!authenticated && <section className="workspace-host-access"><NativeAccessPanel audience={access.audience} controller={access} /></section>}
    {!contextId ? <p role="alert">Le contexte demandé est invalide.</p> : error ? <div role="alert">Impossible de vérifier l’accès aux vues.
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></div> : null}
    <div hidden={!authenticated} inert={!authenticated}>
    <Workspace access={access} projection={projection} views={views} navigation={navigation} client={client} contextId={contextId}
      revocationVersion={revocationVersion}
      homeViewId={navigation.find(item => item.viewId.endsWith(':dashboard') || item.viewId.endsWith(':home'))?.viewId}
      renderShell={shell => <CreezioShell {...shell} account={state.session ? {displayName: state.session.displayName} : null}
        onRefreshAccess={() => {setProjection(null);void access.refresh();}}
        onLogout={() => {setProjection(null);void access.logout();}} />}
      initialUrl={initialUrl} onLocationChange={url => {
        const current = new URL(window.location.href); current.searchParams.set('context', contextId); current.searchParams.set('view', url);
        window.history.replaceState(null, '', current);
      }} />
    </div>
  </>;
}
