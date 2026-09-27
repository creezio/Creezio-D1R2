'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createBrowserAccessController} from '../access/controller.ts';
import {NativeAccessPanel} from '../access/components.tsx';
import type {AccessAudience, AccessController, AccessSnapshot} from '../access/types.ts';
import {createWidgetApprovalClient, type WidgetApprovalPreview} from './approval-client.ts';

interface ApprovalCardProps {
  readonly preview: WidgetApprovalPreview;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly onDecide: (decision: 'approve' | 'reject') => void;
  readonly onReload: () => void;
}

/** Native decision surface. The widget iframe never receives the nonce or a decision capability. */
export function NativeWidgetApprovalCard({preview,nowMs,busy,onDecide,onReload}: ApprovalCardProps) {
  const expired = nowMs === 0 || nowMs >= preview.expiresAtMs;
  const pending = preview.state === 'pending' && !expired;
  const stateText = preview.state === 'approved' ? 'Demande approuvée.' :
    preview.state === 'rejected' ? 'Demande refusée.' :
    preview.state === 'consumed' ? 'Confirmation déjà utilisée.' :
    preview.state === 'expired' || expired ? 'Demande expirée.' : 'Votre décision est nécessaire.';
  return <main className="mx-auto mt-10 max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    aria-labelledby="widget-approval-title" data-widget-approval-state={preview.state}>
    <p className="text-sm font-semibold text-sky-800">Creezio · Confirmation native</p>
    <h1 id="widget-approval-title" className="mt-2 text-2xl font-semibold text-slate-950">
      {preview.operation.title}</h1>
    <p className="mt-2 text-sm text-slate-700">Vérifiez l’opération et ses valeurs avant de décider.</p>
    <dl className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
      <div className="grid grid-cols-3 gap-2 p-3"><dt>Module</dt><dd className="col-span-2 break-words">
        {preview.operation.moduleId}</dd></div>
      <div className="grid grid-cols-3 gap-2 p-3"><dt>Contexte</dt><dd className="col-span-2 break-words">
        {preview.contextId}</dd></div>
      {Object.entries(preview.fields).map(([name,value]) => <div className="grid grid-cols-3 gap-2 p-3" key={name}>
        <dt className="break-words">{name}</dt><dd className="col-span-2 break-words">{JSON.stringify(value)}</dd>
      </div>)}
    </dl>
    <p className="mt-4 text-sm font-medium text-slate-800" role="status">{stateText}</p>
    {pending && <div className="mt-5 flex gap-3">
      <button type="button" className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        disabled={busy} onClick={() => onDecide('reject')}>Refuser</button>
      <button type="button" className="rounded-md bg-sky-700 px-4 py-2 text-sm text-white"
        disabled={busy} onClick={() => onDecide('approve')}>Approuver</button>
    </div>}
    <button type="button" className="mt-4 text-sm text-sky-700 underline" disabled={busy}
      onClick={onReload}>Actualiser l’état</button>
    <p className="mt-5 text-xs text-slate-600">Cette page confirme uniquement la demande.
      Revenez au client qui l’a initiée pour reprendre l’opération avec sa clé d’origine.</p>
  </main>;
}

export function NativeWidgetApprovalView({audience,approvalId,contextId}: {
  readonly audience: AccessAudience; readonly approvalId: string; readonly contextId: string;
}) {
  const [controller,setController] = useState<AccessController | null>(null);
  const [snapshot,setSnapshot] = useState<AccessSnapshot | null>(null);
  const [preview,setPreview] = useState<WidgetApprovalPreview | null>(null);
  const [readState,setReadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [notice,setNotice] = useState('');
  const [nowMs,setNowMs] = useState(0);
  const [busy,setBusy] = useState(false);
  const decisionInFlight = useRef(false);
  const readInFlight = useRef<Promise<void> | null>(null);
  const readQueued = useRef(false);
  const generation = useRef(0);
  const latestReload = useRef<() => void>(() => {});
  const authenticated = useRef(false);
  authenticated.current = controller?.audience === audience && snapshot?.phase === 'authenticated'
    && snapshot.session?.audience === audience;
  useEffect(() => {
    const selected = createBrowserAccessController({audience});
    setController(selected);
    setSnapshot(selected.getSnapshot());
    const unsubscribe = selected.subscribe(() => setSnapshot(selected.getSnapshot()));
    void selected.refresh();
    return () => {unsubscribe(); selected.dispose(); generation.current++;};
  }, [audience]);
  const client = useMemo(() => controller?.audience === audience ? createWidgetApprovalClient({origin:controller.origin,
    audience,contextId,access:controller}) : null, [controller,audience,contextId]);
  const reload = useCallback(() => {
    if (!client || decisionInFlight.current) {readQueued.current = true; return;}
    if (readInFlight.current) {readQueued.current = true; return;}
    const current = ++generation.current;
    setReadState('loading'); setPreview(null);
    const promise = client.read(approvalId).then(result => {
      if (generation.current !== current) return;
      if (result.kind === 'ok') {setPreview(result.value); setReadState('ready'); setNotice('');}
      else {setReadState('unavailable'); setNotice('La demande ne peut pas être vérifiée.');}
    }).finally(() => {
      if (readInFlight.current === promise) readInFlight.current = null;
      if (readQueued.current && !decisionInFlight.current) {
        readQueued.current = false;
        if (authenticated.current) latestReload.current();
      }
    });
    readInFlight.current = promise;
  }, [client,approvalId]);
  latestReload.current = reload;
  useEffect(() => {
    if (authenticated.current) reload();
    else {generation.current++;readQueued.current=false;setPreview(null);setReadState('loading');}
  }, [snapshot,reload,audience]);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()),1_000);
    setNowMs(Date.now());
    return () => window.clearInterval(timer);
  }, []);
  const decide = async (decision: 'approve' | 'reject') => {
    if (!client || !preview || preview.state !== 'pending' || !snapshot?.session ||
      snapshot.session.id !== preview.sessionId || nowMs >= preview.expiresAtMs ||
      decisionInFlight.current || readInFlight.current) return;
    decisionInFlight.current = true; setBusy(true);
    try {
      const result = await client.decide(preview,decision);
      setNotice(result.kind === 'unknown' ? 'Décision incertaine. Vérifiez l’état actuel.' :
        result.kind === 'rejected' ? 'Décision refusée. Vérifiez la demande.' : 'Décision enregistrée.');
    } finally {
      decisionInFlight.current = false; setBusy(false); reload();
    }
  };
  if (!controller || controller.audience !== audience || !snapshot || snapshot.phase === 'loading'
    || snapshot.phase === 'authenticated' && snapshot.session?.audience !== audience)
    return <main className="mx-auto mt-10 max-w-xl p-6"
    role="status">Vérification de votre session Creezio…</main>;
  if (snapshot.phase === 'anonymous') return <main className="mx-auto mt-10 max-w-xl p-6">
    <h1 className="text-2xl font-semibold">Connectez-vous pour confirmer</h1>
    <p className="my-3">La demande sera relue après connexion avec votre compte Creezio.</p>
    <NativeAccessPanel audience={audience} controller={controller} />
  </main>;
  if (snapshot.phase === 'unavailable') return <main className="mx-auto mt-10 max-w-xl p-6" role="alert">
    <h1>Session indisponible</h1><button type="button" onClick={() => void controller.refresh()}>Réessayer</button>
  </main>;
  return <>
    {notice && <p className="mx-auto mt-4 max-w-xl text-sm" role="status">{notice}</p>}
    {readState === 'ready' && preview ? <NativeWidgetApprovalCard preview={preview} nowMs={nowMs}
      busy={busy} onDecide={decision => void decide(decision)} onReload={reload} /> :
      <main className="mx-auto mt-10 max-w-xl p-6" role={readState === 'unavailable' ? 'alert' : 'status'}>
        <h1>{readState === 'unavailable' ? 'Demande indisponible' : 'Vérification de la demande…'}</h1>
        {readState === 'unavailable' && <button type="button" onClick={reload}>Réessayer</button>}
      </main>}
  </>;
}
