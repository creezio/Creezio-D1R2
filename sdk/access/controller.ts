import { createAccessClient } from './client.ts';
import { createAccessCoordinator } from './coordinator.ts';
import { accessFields, canonicalAccessOrigin, copyAccessCredentials, copyAccessSession, isAccessAudience, isAccessErrorCode,
  type AccessAudience, type AccessController, type AccessCoordinator, type AccessCredentials, type AccessErrorCode,
  type AccessMutationResult, type AccessSessionResult, type AccessSnapshot, type AccessTransport } from './types.ts';

function copiedRead(value: unknown, audience: AccessAudience): AccessSessionResult {
  try {
    const kind = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'kind')?.value : null;
    if (kind === 'anonymous' && accessFields(value, ['kind'])) return Object.freeze({kind: 'anonymous'});
    if (kind === 'authenticated') {
      const fields = accessFields(value, ['kind', 'session']), session = fields && copyAccessSession(fields.session, audience);
      if (session) return Object.freeze({kind: 'authenticated', session});
    }
    if (kind === 'unavailable') {
      const fields = accessFields(value, ['kind', 'error']);
      if (fields && isAccessErrorCode(fields.error)) return Object.freeze({kind: 'unavailable', error: fields.error});
    }
  } catch { /* custom transports cannot publish executable/unvalidated data */ }
  return Object.freeze({kind: 'unavailable', error: 'invalid_response'});
}
function copiedMutation(value: unknown): AccessMutationResult {
  if (accessFields(value, ['ok'])?.ok === true) return Object.freeze({ok: true});
  const fields = accessFields(value, ['ok', 'error']);
  return fields?.ok === false && isAccessErrorCode(fields.error) ? Object.freeze({ok: false, error: fields.error})
    : Object.freeze({ok: false, error: 'invalid_response'});
}

/** An identity observer, not an authorization cache. Nothing is persisted.
 * No request is started until refresh/login/logout is explicitly invoked.
 */
export function createAccessController(options: {
  audience: AccessAudience; transport: AccessTransport; coordinator: AccessCoordinator;
}): AccessController {
  const {audience, transport, coordinator} = options;
  const origin = canonicalAccessOrigin(transport.origin);
  if (!origin || !isAccessAudience(audience) || transport.audience !== audience
    || !['origin', 'document'].includes(coordinator.mode)) throw new Error('Invalid native access controller configuration.');
  const scope = Object.freeze({origin, audience}), mode = coordinator.mode;
  let snapshot: AccessSnapshot = Object.freeze({phase: 'loading', session: null, pending: null, error: null, coordination: mode});
  let disposed = false, generation = 0, readAbort: AbortController | null = null;
  let mutationPromise: Promise<void> | null = null;
  const observers = new Set<() => void>();
  function publish(next: Omit<AccessSnapshot, 'coordination'>) {
    if (disposed) return;
    snapshot = Object.freeze({...next, coordination: mode});
    for (const observer of [...observers]) { try { observer(); } catch { /* observers do not own the operation */ } }
  }
  function invalidateRead() { generation++; readAbort?.abort(); readAbort = null; }
  function adopt(result: AccessSessionResult, error: AccessErrorCode | null = null) {
    if (result.kind === 'authenticated') publish({phase: 'authenticated', session: result.session, pending: null, error});
    else if (result.kind === 'anonymous') publish({phase: 'anonymous', session: null, pending: null, error});
    else publish({phase: 'unavailable', session: null, pending: null, error: error ?? result.error});
  }
  async function read(signal?: AbortSignal): Promise<AccessSessionResult> {
    try { return copiedRead(await transport.readSession(signal ? {signal} : undefined), audience); }
    catch { return Object.freeze({kind: 'unavailable', error: 'unavailable'}); }
  }
  async function refresh(): Promise<void> {
    if (disposed) return;
    if (snapshot.pending) return mutationPromise ?? undefined;
    invalidateRead(); const current = generation, abort = new AbortController(); readAbort = abort;
    publish({phase: 'loading', session: null, pending: null, error: null});
    try {
      const result = await coordinator.runExclusive(scope, async () => {
        if (disposed || current !== generation) return null;
        return read(abort.signal);
      });
      if (!disposed && current === generation && result) adopt(result);
    } catch {
      if (!disposed && current === generation) adopt({kind: 'unavailable', error: 'unavailable'});
    } finally { if (readAbort === abort) readAbort = null; }
  }
  function mutate(operation: 'login' | 'logout', supplied?: AccessCredentials): Promise<void> {
    if (disposed) return Promise.resolve();
    if (snapshot.pending) return mutationPromise ?? Promise.resolve();
    let credentials = operation === 'login' ? copyAccessCredentials(supplied) : null;
    if (operation === 'login' && !credentials) {
      // Rejecting local input does not establish that the browser is anonymous.
      publish({phase: snapshot.phase, session: snapshot.session, pending: null, error: 'invalid_input'});
      return Promise.resolve();
    }
    invalidateRead(); const current = generation;
    publish({phase: 'loading', session: null, pending: operation, error: null});
    // Promise.resolve also captures a synchronously throwing custom coordinator.
    const pending = Promise.resolve().then(() => coordinator.runExclusive(scope, async () => {
      if (disposed) return; // queued but not emitted: no credential leaves this instance
      coordinator.invalidate(scope);
      let result: AccessMutationResult;
      try {
        // Copy was captured before awaiting a lock. Clear this reference as soon
        // as the transport has synchronously captured/serialized its arguments.
        const request = operation === 'login' ? transport.login(credentials!) : transport.logout();
        credentials = null;
        result = copiedMutation(await request);
      } catch { credentials = null; result = Object.freeze({ok: false, error: 'unavailable'}); }
      // Once a POST is emitted this reconciliation continues under the lock,
      // even after dispose. No AbortSignal is supplied to either step.
      const verified = await read();
      coordinator.invalidate(scope);
      if (!disposed && current === generation) adopt(verified, result.ok ? null : result.error);
    })).catch(() => {
      if (!disposed && current === generation) adopt({kind: 'unavailable', error: 'unavailable'});
    }).finally(() => {
      credentials = null;
      if (mutationPromise === pending) mutationPromise = null;
    });
    mutationPromise = pending;
    return pending;
  }
  const unsubscribe = coordinator.subscribe(scope, () => {
    if (disposed || snapshot.pending) return;
    // Never broadcast from a read or a received invalidation: no notification loop.
    void refresh();
  });
  return Object.freeze({origin, audience,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (typeof listener !== 'function') throw new Error('Invalid native access observer.');
      if (disposed) return () => {};
      observers.add(listener); return () => { observers.delete(listener); };
    },
    refresh,
    login: (credentials: AccessCredentials) => mutate('login', credentials),
    logout: () => mutate('logout'),
    dispose() {
      if (disposed) return;
      disposed = true; invalidateRead(); unsubscribe(); observers.clear();
      // Do not cancel an emitted mutation or release its coordination lock.
      snapshot = Object.freeze({phase: 'unavailable', session: null, pending: null, error: null, coordination: mode});
    },
  });
}

/** Call after mount, never during SSR. Host routes retain control of navigation. */
export function createBrowserAccessController(options: {audience: AccessAudience}): AccessController {
  if (typeof window === 'undefined') throw new Error('Native browser access requires a mounted document.');
  const origin = window.location.origin;
  const controller = createAccessController({audience: options.audience,
    transport: createAccessClient({origin, audience: options.audience}), coordinator: createAccessCoordinator()});
  // Cookie changes/revocation may occur without a broadcast. Returning to a
  // document clears the displayed identity while the same-origin GET verifies it.
  const resume = () => { if (document.visibilityState !== 'hidden') void controller.refresh(); };
  const visible = () => { if (document.visibilityState === 'visible') void controller.refresh(); };
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', visible);
  let disposed = false;
  return Object.freeze({...controller, dispose() {
    if (disposed) return; disposed = true;
    window.removeEventListener('focus', resume);
    window.removeEventListener('pageshow', resume);
    document.removeEventListener('visibilitychange', visible);
    controller.dispose(); // only reads are cancelled; an emitted POST keeps its lock
  }});
}
