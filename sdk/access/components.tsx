'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createBrowserAccessController } from './controller.ts';
import type { AccessAudience, AccessController, AccessCredentials, AccessErrorCode, AccessSnapshot } from './types.ts';

const errorMessages: Readonly<Record<AccessErrorCode, string>> = Object.freeze({
  invalid_input: 'Vérifiez votre identifiant et votre mot de passe.',
  invalid_credentials: 'L’identifiant ou le mot de passe est incorrect.',
  rate_limited: 'Trop de tentatives. Patientez avant de réessayer.',
  request_rejected: 'La demande a été refusée. Actualisez la page avant de réessayer.',
  unavailable: 'Le service est indisponible. Réessayez dans un moment.',
  invalid_response: 'La réponse du service n’a pas pu être vérifiée. Réessayez dans un moment.',
});

function errorMessage(error: AccessErrorCode): string {
  // A custom host cannot turn an unexpected transport diagnostic into UI text.
  return Object.hasOwn(errorMessages, error) ? errorMessages[error] : errorMessages.unavailable;
}

export interface LoginFormProps {
  readonly audience: AccessAudience;
  readonly disabled?: boolean;
  readonly error?: AccessErrorCode | null;
  readonly onSubmit: (credentials: AccessCredentials) => Promise<void>;
}

/** Presentation only: no endpoint, routing, persistence or identity inference. */
export function LoginForm(props: LoginFormProps) {
  // Changing audience discards the old DOM fields and any pending form-local state.
  return <LoginFields key={props.audience} {...props} />;
}

function LoginFields({ audience, disabled = false, error = null, onSubmit }: LoginFormProps) {
  const id = useId();
  const identifier = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<AccessErrorCode | null>(null);
  const visibleError = localError ?? error;
  const invalid = visibleError === 'invalid_input' || visibleError === 'invalid_credentials';
  const busy = disabled || submitting;

  useEffect(() => {
    mounted.current = true;
    const field = password.current;
    return () => {
      mounted.current = false;
      if (field) field.value = '';
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || locked.current || !identifier.current || !password.current) return;
    locked.current = true;
    const field = password.current;
    const credentials = { loginIdentifier: identifier.current.value, password: field.value };
    // The DOM does not retain the password while a request is pending. The
    // transport necessarily holds its request briefly; no memory erasure is claimed.
    field.value = '';
    setLocalError(null);
    setSubmitting(true);
    try { await onSubmit(credentials); }
    catch { if (mounted.current) setLocalError('unavailable'); }
    finally {
      credentials.password = '';
      field.value = '';
      locked.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return <form className="creezio-access-form" data-access-audience={audience} aria-busy={busy}
    onSubmit={event => { void submit(event); }}>
    <fieldset disabled={busy}>
      <legend className="creezio-access-sr-only">Connexion {audience === 'admin' ? 'à l’espace Creezio' : 'à l’application'}</legend>
      <div className="creezio-access-field">
        <label htmlFor={`${id}-identifier`}>Identifiant</label>
        <input ref={identifier} id={`${id}-identifier`} name="loginIdentifier" type="text" required
          autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={512}
          aria-invalid={invalid || undefined} aria-describedby={visibleError ? `${id}-error` : undefined} />
      </div>
      <div className="creezio-access-field">
        <label htmlFor={`${id}-password`}>Mot de passe</label>
        <input ref={password} id={`${id}-password`} name="password" type="password" required
          autoComplete="current-password" maxLength={1024}
          aria-invalid={invalid || undefined} aria-describedby={visibleError ? `${id}-error` : undefined} />
      </div>
      {visibleError && <p id={`${id}-error`} className="creezio-access-error" role="alert">{errorMessage(visibleError)}</p>}
      <button className="creezio-access-primary" type="submit" disabled={busy}>
        {submitting ? 'Connexion…' : 'Se connecter'}
      </button>
    </fieldset>
    <p className="creezio-access-sr-only" role="status" aria-live="polite">{submitting ? 'Connexion en cours…' : ''}</p>
  </form>;
}

const loading: AccessSnapshot = Object.freeze({ phase: 'loading', session: null, pending: null,
  error: null, coordination: 'document' });
const unavailable: AccessSnapshot = Object.freeze({ ...loading, phase: 'unavailable', error: 'unavailable' });
type Binding = { audience: AccessAudience; supplied: AccessController | undefined;
  controller: AccessController | null; snapshot: AccessSnapshot };

export interface NativeAccessPanelProps {
  readonly audience: AccessAudience;
  /** Optional host-owned controller. The component never disposes it. */
  readonly controller?: AccessController;
}

/** Reusable native entry. The host supplies a fixed audience and owns navigation. */
export function NativeAccessPanel({ audience, controller: supplied }: NativeAccessPanelProps) {
  const id = useId();
  const [binding, setBinding] = useState<Binding | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let controller: AccessController | null = null;
    let unsubscribe: (() => void) | undefined;
    function publish(snapshot: AccessSnapshot) {
      if (active) setBinding({ audience, supplied, controller, snapshot });
    }
    try {
      // Created per effect setup, so StrictMode cleanup cannot leave a disposed
      // owned controller in use. Nothing browser-specific runs during SSR.
      controller = supplied ?? createBrowserAccessController({ audience });
      if (controller.audience !== audience) throw new Error('Audience mismatch');
      const selected = controller;
      unsubscribe = selected.subscribe(() => publish(selected.getSnapshot()));
      publish(selected.getSnapshot());
      void selected.refresh().catch(() => publish(unavailable));
    } catch { publish(unavailable); }
    return () => {
      active = false;
      unsubscribe?.();
      if (!supplied) controller?.dispose();
    };
  }, [audience, supplied, attempt]);

  // A prop transition cannot flash the previous audience's verified identity.
  const current = binding?.audience === audience && binding.supplied === supplied ? binding : null;
  const snapshot = current?.snapshot ?? loading;
  const busy = snapshot.pending !== null || snapshot.phase === 'loading';
  const showForm = snapshot.phase === 'anonymous' || snapshot.pending === 'login';
  const session = snapshot.phase === 'authenticated' ? snapshot.session : null;
  const title = audience === 'admin' ? 'Accéder à Creezio' : 'Accéder à l’application';

  async function login(credentials: AccessCredentials) {
    if (!current?.controller || busy) return;
    await current.controller.login(credentials);
  }
  async function logout() {
    if (!current?.controller || busy) return;
    try { await current.controller.logout(); }
    catch {
      setBinding(previous => previous === current ? { ...previous, snapshot: unavailable } : previous);
    }
  }

  return <section className="creezio-access-panel" data-access-audience={audience} aria-labelledby={`${id}-title`}>
    <div className="creezio-access-heading">
      <span className="creezio-access-symbol" aria-hidden="true">C</span>
      <div><p className="creezio-access-eyebrow">{audience === 'admin' ? 'Espace Creezio' : 'Espace application'}</p>
        <h2 id={`${id}-title`}>{title}</h2></div>
    </div>
    <p className="creezio-access-status" role="status" aria-live="polite" aria-atomic="true">
      {snapshot.pending === 'login' ? 'Connexion en cours…' : snapshot.pending === 'logout' ? 'Déconnexion en cours…'
        : snapshot.phase === 'loading' ? 'Vérification de votre session…'
          : snapshot.phase === 'anonymous' ? 'Connectez-vous avec votre compte.'
            : snapshot.phase === 'authenticated' ? 'Votre session est vérifiée.'
              : 'Votre session ne peut pas être vérifiée pour le moment.'}
    </p>
    {showForm && <LoginForm key={audience} audience={audience} disabled={busy}
      error={snapshot.error} onSubmit={login} />}
    {!showForm && snapshot.error && <p className="creezio-access-error" role="alert">{errorMessage(snapshot.error)}</p>}
    {session && <div className="creezio-access-identity">
      <p className="creezio-access-name">{session.displayName}</p>
      <p>Vos autorisations sont vérifiées pour chaque action.</p>
      <button className="creezio-access-secondary" type="button" disabled={busy} onClick={() => { void logout(); }}>Se déconnecter</button>
    </div>}
    {snapshot.phase !== 'anonymous' && <button className="creezio-access-secondary" type="button" disabled={busy}
      onClick={() => { setAttempt(value => value + 1); }}>Vérifier à nouveau</button>}
    {current && snapshot.coordination === 'document' && <p className="creezio-access-notice">
      La coordination entre onglets n’est pas disponible. Utilisez un seul onglet pour vous connecter ou vous déconnecter.
    </p>}
  </section>;
}
