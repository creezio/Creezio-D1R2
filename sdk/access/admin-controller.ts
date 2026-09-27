import type {AccessController} from './types.ts';
import {createAccessAdminClient} from './admin-client.ts';
import type {AccessAdminAuditCursor, AccessAdminCommandOutcome, AccessAdminController,
  AccessAdminDeltaInput, AccessAdminPendingCommand, AccessAdminPendingPersistence, AccessAdminReadResult,
  AccessAdminPermission, AccessAdminPolicyRead, AccessAdminSnapshot} from './admin-types.ts';
import type {OperationClient, OperationClientResult} from '../operations/client.ts';

const binding = Object.freeze({delta: 'creezio.access:policy.apply-delta',
  status: 'creezio.access:principals.set-human-status',
  revokeAll: 'creezio.access:principals.revoke-sessions',
  revoke: 'creezio.access:sessions.revoke'});
const unavailable = <T>(error: string): AccessAdminReadResult<T> => Object.freeze({ok: false, error});
const unknown = (requestKey: string, code: string): AccessAdminCommandOutcome =>
  Object.freeze({kind: 'unknown', requestKey, code});
const sessionIdentity = (access: AccessController) => {
  const current = access.getSnapshot();
  return current.phase === 'authenticated' && current.pending === null
    && current.session && current.session.audience === 'admin'
    ? JSON.stringify([current.session.principalId, current.session.id]) : null;
};
function validOutput(bindingId: string, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const id = (part: unknown) => typeof part === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(part);
  const positive = (part: unknown) => Number.isSafeInteger(part) && Number(part) > 0;
  if (bindingId === binding.delta) return positive(row.epoch) && id(row.auditId)
    && Number.isSafeInteger(row.changedCount) && Number(row.changedCount) >= 0 && Number(row.changedCount) <= 32;
  if (bindingId === binding.status) return id(row.principalId) && ['active', 'disabled'].includes(String(row.status))
    && positive(row.authVersion);
  if (bindingId === binding.revokeAll) return id(row.principalId) && positive(row.authVersion);
  if (bindingId === binding.revoke) return id(row.sessionId) && row.revoked === true;
  return false;
}

/** One shared browser controller for all three original Access panels. It uses T06 only. */
export function createAccessAdminController(options: {client: OperationClient; access: AccessController;
  persistence?: AccessAdminPendingPersistence}): AccessAdminController {
  if (!options?.client || !options?.access || options.client.audience !== 'admin'
    || options.access.audience !== 'admin' || options.client.origin !== options.access.origin)
    throw new TypeError('Invalid Access admin controller configuration.');
  const client = createAccessAdminClient(options.client), access = options.access;
  const persistence = options.persistence;
  const observers = new Set<() => void>();
  let disposed = false, generation = 0, identity = sessionIdentity(access);
  let lastVerifiedIdentity = identity, identityVersion = 0;
  let invalidation: string | null = null;
  const validPending = (value: unknown): value is {bindingId: string; requestKey: string} => !!value
    && typeof value === 'object' && !Array.isArray(value)
    && (Object.values(binding) as string[]).includes((value as {bindingId: string}).bindingId)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test((value as {requestKey: string}).requestKey);
  function restorePending(): AccessAdminPendingCommand | null {
    if (!persistence || identity === null) return null;
    try {
      const value = persistence.read();
      return validPending(value) ? Object.freeze({...value, code: 'reconciliation_required'}) : null;
    } catch {return null;}
  }
  function savePending(value: AccessAdminPendingCommand | null): boolean {
    if (!persistence) return false;
    try {return persistence.save(value ? {bindingId: value.bindingId, requestKey: value.requestKey} : null) === true;}
    catch {return false;}
  }
  let pending: AccessAdminPendingCommand | null = restorePending();
  let mutation: Promise<AccessAdminCommandOutcome> | null = null;
  let currentSnapshot: AccessAdminSnapshot = Object.freeze({authorized: identity !== null,
    suspended: false, identityVersion, pendingCommand: identity !== null ? pending : null});
  const publish = () => {
    const authorized = !disposed && identity !== null;
    const state = access.getSnapshot();
    const suspended = !disposed && !authorized && lastVerifiedIdentity !== null && state.pending === null
      && (state.phase === 'loading' || state.phase === 'unavailable');
    const visible = authorized ? pending : null;
    if (currentSnapshot.authorized === authorized && currentSnapshot.suspended === suspended
      && currentSnapshot.identityVersion === identityVersion && currentSnapshot.pendingCommand === visible) return;
    currentSnapshot = Object.freeze({authorized, suspended, identityVersion, pendingCommand: visible});
    for (const observer of [...observers]) {try {observer();} catch { /* observers cannot interrupt operations */ }}
  };
  const unsubscribe = access.subscribe(() => {
    const state = access.getSnapshot();
    const next = sessionIdentity(access);
    if (next !== identity) {
      identity = next; generation++;
    }
    if (state.pending !== null || state.phase === 'anonymous') {
      const marker = state.pending === null ? 'anonymous' : `pending:${state.pending}`;
      if (marker !== invalidation) identityVersion++;
      invalidation = marker; lastVerifiedIdentity = null; pending = null;
    } else {
      invalidation = null;
      if (next !== null && next !== lastVerifiedIdentity) {
        // A changed identity gets a new qualified panel; never read a stale panel
        // while its workspace projection is still unavailable.
        lastVerifiedIdentity = next; identityVersion++; pending = null;
      }
    }
    publish();
  });
  async function read<T>(action: () => Promise<AccessAdminReadResult<T>>): Promise<AccessAdminReadResult<T>> {
    if (disposed || identity === null) return unavailable('unauthorized');
    const started = generation;
    try {
      const result = await action();
      return !disposed && identity !== null && started === generation ? result : unavailable('stale');
    } catch {return unavailable('unavailable');}
  }
  async function collectPolicy(): Promise<AccessAdminReadResult<AccessAdminPolicyRead>> {
    const graph = await client.readPolicy();
    if (!graph.ok) return graph;
    const started = generation, permissions: AccessAdminPermission[] = [];
    let afterId: string | null = null, digest: string | null = null;
    for (let pageNumber = 0; pageNumber < 200; pageNumber++) {
      if (disposed || identity === null || generation !== started) return unavailable('stale');
      const result = await client.listPermissions({limit: 50, afterId});
      if (!result.ok) return result;
      const page = result.value;
      if (digest !== null && page.catalogDigest !== digest) return unavailable('invalid_response');
      digest = page.catalogDigest;
      for (const item of page.items) {
        if (afterId !== null && item.id <= afterId) return unavailable('invalid_response');
        afterId = item.id; permissions.push(item);
      }
      if (page.nextAfterId === null)
        return Object.freeze({ok: true, value: Object.freeze({...graph.value,
          permissions: Object.freeze(permissions)})});
      if (!page.items.length || page.nextAfterId !== afterId) return unavailable('invalid_response');
    }
    return unavailable('invalid_response');
  }
  function interpret(result: OperationClientResult, requestKey: string, bindingId: string): AccessAdminCommandOutcome {
    if (result.kind === 'rejected') return Object.freeze({kind: 'rejected', requestKey, code: result.code});
    if (result.kind === 'unknown') return unknown(requestKey, result.code);
    if (result.execution.state === 'succeeded') return validOutput(bindingId, result.execution.output)
      ? Object.freeze({kind: 'succeeded', requestKey, output: result.execution.output})
      : unknown(requestKey, 'invalid_response');
    if (result.execution.state === 'failed') return Object.freeze({kind: 'failed', requestKey,
      code: result.execution.errorCode ?? 'failed'});
    return unknown(requestKey, result.execution.errorCode ?? result.execution.state);
  }
  async function lookupCurrent(): Promise<AccessAdminCommandOutcome | null> {
    if (!pending || disposed) return null;
    if (identity === null) return unknown(pending.requestKey, 'unauthorized');
    const current = pending;
    let result: OperationClientResult;
    try {result = await client.status(current.bindingId, current.requestKey);}
    catch {return unknown(current.requestKey, 'unavailable');}
    if (pending !== current) return null;
    // A refused or unavailable lookup says nothing about whether the earlier POST committed.
    const outcome = result.kind === 'rejected' ? unknown(current.requestKey, result.code)
      : interpret(result, current.requestKey, current.bindingId);
    if (outcome.kind !== 'unknown') {
      if (!savePending(null)) return unknown(current.requestKey, 'persistence_unavailable');
      pending = null; publish();
    }
    else if (outcome.code !== current.code) {pending = Object.freeze({...current, code: outcome.code}); publish();}
    return outcome;
  }
  function perform(bindingId: string, action: (requestKey: string) => Promise<OperationClientResult>):
    Promise<AccessAdminCommandOutcome> {
    if (disposed || identity === null) return Promise.resolve(Object.freeze({kind: 'rejected', requestKey: '', code: 'unauthorized'}));
    if (mutation) return Promise.resolve(unknown(pending?.requestKey ?? '', 'in_flight'));
    if (pending) return Promise.resolve(unknown(pending.requestKey, pending.code));
    const requestKey = crypto.randomUUID();
    const nextPending = Object.freeze({bindingId, requestKey, code: 'in_flight'});
    if (!savePending(nextPending)) return Promise.resolve(Object.freeze({kind: 'rejected', requestKey,
      code: 'persistence_unavailable'}));
    pending = nextPending; publish();
    const active = Promise.resolve().then(() => action(requestKey)).then(result => {
      const outcome = interpret(result, requestKey, bindingId);
      if (pending?.requestKey === requestKey) {
        if (outcome.kind === 'unknown') pending = Object.freeze({bindingId, requestKey, code: outcome.code});
        else if (savePending(null)) pending = null;
        else {pending = Object.freeze({bindingId, requestKey, code: 'persistence_unavailable'});
          publish(); return unknown(requestKey, 'persistence_unavailable');}
        publish();
      }
      return outcome;
    }, () => {
      if (pending?.requestKey === requestKey) {pending = Object.freeze({bindingId, requestKey, code: 'outcome_unknown'}); publish();}
      return unknown(requestKey, 'outcome_unknown');
    }).finally(() => {if (mutation === active) mutation = null;});
    mutation = active;
    return active;
  }
  return Object.freeze({
    getSnapshot: () => currentSnapshot,
    subscribe(listener: () => void) {
      if (typeof listener !== 'function') throw new TypeError('Invalid Access admin observer.');
      if (disposed) return () => {};
      observers.add(listener); return () => {observers.delete(listener);};
    },
    readPolicy: () => read(collectPolicy),
    listPrincipals: (input: {kind: 'human' | 'service' | 'all'; limit: number; afterId: string | null}) =>
      read(() => client.listPrincipals(input)),
    listSessions: (input: {principalId: string; limit: number; afterId: string | null}) =>
      read(() => client.listSessions(input)),
    listAudit: (input: {limit: number; before: AccessAdminAuditCursor | null}) =>
      read(() => client.listAudit(input)),
    readAuditDetail: (input: {auditId: string; limit: number; afterIndex: number | null}) =>
      read(() => client.readAuditDetail(input)),
    applyDelta: (input: {expectedEpoch: number; changes: readonly AccessAdminDeltaInput[]}) =>
      perform(binding.delta, key => client.applyDelta(input, key)),
    setHumanStatus: (input: {principalId: string; expectedAuthVersion: number; status: 'active' | 'disabled'}) =>
      perform(binding.status, key => client.setHumanStatus(input, key)),
    revokeAllSessions: (input: {principalId: string; expectedAuthVersion: number}) =>
      perform(binding.revokeAll, key => client.revokeAllSessions(input, key)),
    revokeSession: (input: {sessionId: string}) => perform(binding.revoke, key => client.revokeSession(input, key)),
    async reconcilePending() {
      if (mutation) await mutation;
      return lookupCurrent();
    },
    dispose() {
      if (disposed) return;
      disposed = true; identity = null; lastVerifiedIdentity = null; identityVersion++;
      generation++; unsubscribe(); publish(); observers.clear();
      // A POST already emitted by T06 is not cancelled or replayed here.
      pending = null;
    },
  });
}
