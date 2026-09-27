import type {AccessController} from '../access/types.ts';
import {createModuleSettingsClient, type ModuleSettingsClient} from './client.ts';
import type {ModuleSettingsController, ModuleSettingsPendingCommand, ModuleSettingsPendingPersistence,
  ModuleSettingsSnapshot, ModuleReadResult, ModuleIntent, ModulePlanPreview, ModuleCatalogPage,
  ModuleDetail, ModulePlanRead, ModuleJournalPage, ModuleAcceptOutcome} from './types.ts';
import type {OperationClient} from '../operations/client.ts';

const requestKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identityOf = (access: AccessController): string | null => {
  const state = access.getSnapshot();
  return state.phase === 'authenticated' && state.pending === null && state.session?.audience === 'admin'
    ? JSON.stringify([state.session.principalId, state.session.id]) : null;
};
const failed = <T>(error: string): ModuleReadResult<T> => Object.freeze({ok: false, error});
const unknown = (requestKey: string, code: string): ModuleAcceptOutcome =>
  Object.freeze({kind: 'unknown', requestKey, code});

/** The request key is saved before any POST. An uncertain result is reconciled by status, never replayed. */
export function createModuleSettingsController(options: {operations: OperationClient; access: AccessController;
  persistence: ModuleSettingsPendingPersistence}): ModuleSettingsController {
  if (!options?.operations || !options.access || !options.persistence || options.operations.audience !== 'admin'
    || options.access.audience !== 'admin' || options.operations.origin !== options.access.origin)
    throw new TypeError('Invalid module settings controller configuration.');
  const access = options.access, client: ModuleSettingsClient = createModuleSettingsClient(options.operations);
  const persistence = options.persistence, observers = new Set<() => void>();
  let disposed = false, generation = 0, identity = identityOf(access), verifiedIdentity = identity;
  let identityVersion = 0, invalidation: string | null = null;
  function save(value: ModuleSettingsPendingCommand | null): boolean {
    try { return persistence.save(value ? {requestKey: value.requestKey, owner: value.owner} : null) === true; }
    catch { return false; }
  }
  function restore(owner: string | null): ModuleSettingsPendingCommand | null {
    if (owner === null) return null;
    try {
      const value: unknown = persistence.read();
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const row = value as Record<string, unknown>;
      return row.owner === owner && typeof row.requestKey === 'string' && requestKeyPattern.test(row.requestKey)
        ? Object.freeze({requestKey: row.requestKey, owner, code: 'reconciliation_required'}) : null;
    } catch { return null; }
  }
  let pending = restore(identity);
  let mutation: Promise<ModuleAcceptOutcome> | null = null;
  let snapshot: ModuleSettingsSnapshot = Object.freeze({authorized: identity !== null, suspended: false,
    identityVersion, pendingCommand: pending});
  function publish() {
    const state = access.getSnapshot(), authorized = !disposed && identity !== null;
    const suspended = !disposed && !authorized && verifiedIdentity !== null && state.pending === null
      && (state.phase === 'loading' || state.phase === 'unavailable');
    const visible = authorized ? pending : null;
    if (snapshot.authorized === authorized && snapshot.suspended === suspended
      && snapshot.identityVersion === identityVersion && snapshot.pendingCommand === visible) return;
    snapshot = Object.freeze({authorized, suspended, identityVersion, pendingCommand: visible});
    for (const observer of [...observers]) { try { observer(); } catch { /* subscriber isolation */ } }
  }
  const unsubscribe = access.subscribe(() => {
    const state = access.getSnapshot(), next = identityOf(access);
    if (next !== identity) { identity = next; generation++; }
    if (state.pending !== null || state.phase === 'anonymous') {
      const marker = state.pending === null ? 'anonymous' : `pending:${state.pending}`;
      if (marker !== invalidation) identityVersion++;
      invalidation = marker; verifiedIdentity = null; pending = null;
      save(null);
    } else {
      invalidation = null;
      if (next !== null && next !== verifiedIdentity) {
        verifiedIdentity = next; identityVersion++; pending = restore(next);
      }
    }
    publish();
  });
  async function read<T>(action: (isCurrent: () => boolean) => Promise<ModuleReadResult<T>>): Promise<ModuleReadResult<T>> {
    if (disposed || identity === null) return failed('unauthorized');
    const started = generation, owner = identity;
    const isCurrent = () => !disposed && generation === started && identity === owner;
    try { const result = await action(isCurrent); return isCurrent() ? result : failed('stale'); }
    catch { return failed('unavailable'); }
  }
  async function reconcile(): Promise<ModuleAcceptOutcome | null> {
    if (mutation) await mutation;
    const command = pending;
    if (!command || disposed) return null;
    if (identity !== command.owner) return unknown(command.requestKey, 'unauthorized');
    const started = generation;
    let result: ModuleAcceptOutcome;
    try { result = await client.lookupAccept(command.requestKey,
      () => !disposed && generation === started && identity === command.owner); }
    catch { result = unknown(command.requestKey, 'unavailable'); }
    if (pending !== command || disposed || generation !== started) return null;
    // A failed lookup does not prove the POST failed.
    if (result.kind === 'rejected') result = unknown(command.requestKey, result.code);
    if (result.kind === 'unknown') pending = Object.freeze({...command, code: result.code});
    else if (save(null)) pending = null;
    else { pending = Object.freeze({...command, code: 'persistence_unavailable'});
      result = unknown(command.requestKey, 'persistence_unavailable'); }
    publish(); return result;
  }
  function accept(input: {expectedRevision: number; expectedPlanDigest: string; intent: ModuleIntent}):
    Promise<ModuleAcceptOutcome> {
    if (disposed || identity === null) return Promise.resolve({kind: 'rejected', code: 'unauthorized'});
    if (mutation) return Promise.resolve(unknown(pending?.requestKey ?? '', 'in_flight'));
    if (pending) return Promise.resolve(unknown(pending.requestKey, pending.code));
    const requestKey = crypto.randomUUID(), owner = identity;
    const command: ModuleSettingsPendingCommand = Object.freeze({requestKey, owner, code: 'in_flight'});
    if (!save(command)) return Promise.resolve({kind: 'rejected', code: 'persistence_unavailable'});
    pending = command; publish();
    const started = generation;
    const active = Promise.resolve().then(() => client.accept({...input, requestKey},
      () => !disposed && generation === started && identity === owner)).catch(() => unknown(requestKey, 'outcome_unknown'))
      .then(result => {
        if (pending?.requestKey !== requestKey || disposed || generation !== started) return unknown(requestKey, 'stale');
        if (result.kind === 'unknown') pending = Object.freeze({...command, code: result.code});
        else if (save(null)) pending = null;
        else {pending = Object.freeze({...command, code: 'persistence_unavailable'});
          publish(); return unknown(requestKey, 'persistence_unavailable');}
        publish(); return result;
      }).finally(() => {if (mutation === active) mutation = null;});
    mutation = active;
    return active;
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (typeof listener !== 'function') throw new TypeError('Invalid module settings observer.');
      if (disposed) return () => {};
      observers.add(listener); return () => {observers.delete(listener);};
    },
    list: (input: {limit: number; afterId?: string | null}): Promise<ModuleReadResult<ModuleCatalogPage>> =>
      read(isCurrent => client.list(input, isCurrent)),
    detail: (moduleId: string): Promise<ModuleReadResult<ModuleDetail>> =>
      read(isCurrent => client.detail(moduleId, isCurrent)),
    preview: (intent: ModuleIntent): Promise<ModuleReadResult<ModulePlanPreview>> =>
      read(isCurrent => client.preview(intent, isCurrent)),
    accept,
    read: (planId: string): Promise<ModuleReadResult<ModulePlanRead>> =>
      read(isCurrent => client.read(planId, isCurrent)),
    journal: (input: {limit: number; afterRevision?: number | null}): Promise<ModuleReadResult<ModuleJournalPage>> =>
      read(isCurrent => client.journal(input, isCurrent)),
    reconcilePending: reconcile,
    dispose() {
      if (disposed) return;
      disposed = true; identity = null; verifiedIdentity = null; generation++; identityVersion++;
      unsubscribe(); publish(); observers.clear(); pending = null;
    },
  });
}
