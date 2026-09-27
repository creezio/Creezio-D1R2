'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserAccessController } from '../../../../sdk/access/controller.ts';
import { NativeAccessPanel } from '../../../../sdk/access/components.tsx';
import type { AccessAudience, AccessController } from '../../../../sdk/access/types.ts';
import { isConsentTransactionId, loadConsentPreview,
  type ConsentPreview, type ConsentPreviewResult } from '../../../../sdk/oauth/consent.ts';
import './consent.css';

interface ConsentCardProps { readonly preview: ConsentPreview; readonly nowMs: number }

/** The posted grant is a subset of the server-selected ceiling. */
export function ConsentCard({preview, nowMs}: ConsentCardProps) {
  const [selected, setSelected] = useState<readonly string[]>(preview.permissions.map(item => item.id));
  const pendingClock = nowMs === 0;
  const expired = pendingClock || nowMs >= preview.expiresAtMs;
  const permissionIds = new Set(preview.permissions.map(item => item.id));
  const selectedIds = selected.filter(id => permissionIds.has(id));
  const action = `/oauth/consent/${encodeURIComponent(preview.transactionId)}`;
  function toggle(id: string, checked: boolean) {
    setSelected(previous => checked ? [...previous.filter(item => item !== id), id]
      : previous.filter(item => item !== id));
  }

  return <main className="creezio-consent-card" aria-labelledby="creezio-consent-title">
    <div className="creezio-consent-brand"><span aria-hidden="true">c</span><strong>Creezio</strong></div>
    <p className="creezio-consent-eyebrow">Connexion d’une application</p>
    <h1 id="creezio-consent-title">Autoriser {preview.clientName} ?</h1>
    <p className="creezio-consent-subtitle">
      <strong>{preview.clientName}</strong> demande un accès à Creezio via MCP.
      La réponse sera envoyée à <strong>{preview.redirectHost}</strong>.
    </p>

    <dl className="creezio-consent-details">
      <div><dt>Compte vérifié</dt><dd>{preview.principal.displayName}</dd></div>
      <div><dt>Espace</dt><dd>{preview.audience === 'admin' ? 'Administration Creezio' : 'Application'}</dd></div>
      <div><dt>Contexte</dt><dd><code>{preview.contextId}</code></dd></div>
      <div><dt>Ressource</dt><dd className="creezio-consent-url">{preview.resource}</dd></div>
    </dl>

    <form method="post" action={action} className="creezio-consent-form">
      <input type="hidden" name="csrfToken" value={preview.csrfToken} />
      <section className="creezio-consent-permissions" aria-labelledby="creezio-consent-permissions-title">
        <h2 id="creezio-consent-permissions-title">Permissions demandées</h2>
        <p>Choisissez les droits à accorder à cette application dans ce contexte.</p>
        {preview.permissions.length === 0 && <p role="status">Aucune permission demandée n’est disponible pour ce compte.</p>}
        <ul>{preview.permissions.map(permission => <li key={permission.id}>
          <label><input type="checkbox" name="permissionIds" value={permission.id}
            checked={selectedIds.includes(permission.id)} disabled={expired}
            onChange={event => toggle(permission.id, event.currentTarget.checked)} />
            <span><strong>{permission.title}</strong><code>{permission.id}</code></span>
          </label>
        </li>)}</ul>
      </section>

      {preview.scopes.length > 0 && <details className="creezio-consent-scopes">
        <summary>Portées techniques demandées</summary>
        <ul>{preview.scopes.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul>
      </details>}
      {expired && !pendingClock && <p className="creezio-consent-error" role="alert">Cette demande a expiré. Recommencez depuis l’application.</p>}
      {!expired && selectedIds.length === 0 && <p className="creezio-consent-note">Aucune permission métier ne sera accordée.</p>}
      <div className="creezio-consent-actions">
        <button className="creezio-consent-deny" type="submit" name="decision" value="deny"
          disabled={expired}>Refuser</button>
        <button className="creezio-consent-approve" type="submit" name="decision" value="approve"
          disabled={expired}>Autoriser</button>
      </div>
    </form>
    <p className="creezio-consent-footer">Vous pouvez refuser cette demande sans modifier votre compte.</p>
  </main>;
}

function ConsentSignIn({audience, onAuthenticated}: {
  readonly audience: AccessAudience; readonly onAuthenticated: () => void;
}) {
  const [controller, setController] = useState<AccessController | null>(null);
  const notified = useRef<string | null>(null);
  useEffect(() => {
    const selected = createBrowserAccessController({audience});
    setController(selected);
    const unsubscribe = selected.subscribe(() => {
      const snapshot = selected.getSnapshot();
      const sessionId = snapshot.phase === 'authenticated' ? snapshot.session?.id ?? null : null;
      if (sessionId && notified.current !== sessionId) {
        notified.current = sessionId;
        onAuthenticated();
      }
      if (!sessionId) notified.current = null;
    });
    return () => { unsubscribe(); selected.dispose(); setController(null); };
  }, [audience, onAuthenticated]);
  return <main className="creezio-consent-card">
    <div className="creezio-consent-brand"><span aria-hidden="true">c</span><strong>Creezio</strong></div>
    <h1>Connectez-vous pour continuer</h1>
    <p>Confirmez votre compte Creezio avant de décider de l’accès demandé.</p>
    {controller && <NativeAccessPanel audience={audience} controller={controller} />}
  </main>;
}

/** A verified transaction determines the login audience and all grant choices. */
export function AccessOAuthConsentView({transactionId}: {readonly transactionId: string}) {
  const [result, setResult] = useState<ConsentPreviewResult | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const sequence = useRef(0);
  const inflight = useRef<{id: string; promise: Promise<void>} | null>(null);
  const queued = useRef(false);
  const reload = useCallback(() => {
    if (!isConsentTransactionId(transactionId)) { setResult({kind: 'unavailable'}); return; }
    // Preview rotates the server-side CSRF token. Serialize reads so a slower
    // older response cannot overwrite the token displayed by a newer one.
    if (inflight.current?.id === transactionId) { queued.current = true; setResult(null); return; }
    const current = ++sequence.current;
    setResult(null);
    const promise = loadConsentPreview(transactionId).then(next => {
      if (sequence.current === current && !queued.current) setResult(next);
    }).finally(() => {
      if (inflight.current?.promise === promise) inflight.current = null;
      if (sequence.current === current && queued.current) { queued.current = false; reload(); }
    });
    inflight.current = {id: transactionId, promise};
  }, [transactionId]);
  useEffect(() => {
    reload();
    const onResume = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('pageshow', onResume);
    document.addEventListener('visibilitychange', onResume);
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    setNowMs(Date.now());
    return () => {
      sequence.current++;
      queued.current = false;
      window.removeEventListener('pageshow', onResume);
      document.removeEventListener('visibilitychange', onResume);
      window.clearInterval(timer);
    };
  }, [reload]);

  if (result?.kind === 'ready') return <ConsentCard key={`${result.preview.transactionId}:${result.preview.principal.id}`}
    preview={result.preview} nowMs={nowMs} />;
  if (result?.kind === 'sign_in') return <ConsentSignIn audience={result.audience} onAuthenticated={reload} />;
  return <main className="creezio-consent-card" role={result ? 'alert' : 'status'}>
    <div className="creezio-consent-brand"><span aria-hidden="true">c</span><strong>Creezio</strong></div>
    <h1>{result?.kind === 'expired' ? 'Demande expirée' : result ? 'Demande indisponible' : 'Vérification de la demande…'}</h1>
    <p>{result?.kind === 'expired' ? 'Recommencez depuis l’application qui demande l’accès.'
      : result ? 'La demande ne peut pas être vérifiée pour le moment.'
        : 'Nous vérifions la demande et votre session Creezio.'}</p>
    {result?.kind === 'unavailable' && <button className="creezio-consent-approve" type="button" onClick={reload}>Réessayer</button>}
  </main>;
}
