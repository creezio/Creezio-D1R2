import type {AccessController} from '../access/types.ts';
import type {DeliveryConnection} from './types.ts';
import type {DeliveryResult, DeliveryTransport, DeliveryUpdateInspection,
  DeliveryUpdatePrepared, DeliveryUpdateStatus} from './transport.ts';

export interface DeliverySavedUpdate {
  readonly kind: 'update';
  readonly owner: string;
  readonly updateId: string;
  readonly planDigest: string;
  readonly started: boolean;
}
export interface DeliveryUpdatePersistence {
  read(): unknown;
  save(value: DeliverySavedUpdate | null): boolean;
}
export interface DeliveryUpdateSnapshot {
  readonly authorized: boolean;
  readonly rejectAvailable?: boolean;
  readonly identityVersion: number;
  readonly busy: boolean;
  readonly connection: DeliveryConnection;
  readonly inspection: DeliveryUpdateInspection | null;
  readonly prepared: DeliveryUpdatePrepared | null;
  readonly update: DeliveryUpdateStatus | null;
  readonly saved: DeliverySavedUpdate | null;
  readonly error: string | null;
}
export interface DeliveryUpdateController {
  getSnapshot(): DeliveryUpdateSnapshot;
  subscribe(listener: () => void): () => void;
  inspect(): Promise<DeliveryResult<DeliveryUpdateInspection>>;
  prepare(): Promise<DeliveryResult<DeliveryUpdatePrepared>>;
  start(): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  status(): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  reconcile(): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  retry(): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  reject(): Promise<DeliveryResult<DeliveryUpdateStatus>>;
  dispose(): void;
}
const fail = <T>(code: string): DeliveryResult<T> => ({ok: false, code});
class UpdateStateError extends Error {
  readonly code: string;
  constructor(code: string) {super(code); this.code = code;}
}
const id = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string'
  && /^sha256-[a-f0-9]{64}$/.test(value);
function saved(value: unknown): DeliverySavedUpdate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return item.kind === 'update' && id(item.owner) && id(item.updateId)
    && digest(item.planDigest) && typeof item.started === 'boolean'
    ? {kind: 'update', owner: item.owner, updateId: item.updateId,
      planDigest: item.planDigest, started: item.started} : null;
}
function principal(access: AccessController): string | null {
  const state = access.getSnapshot();
  return access.audience === 'admin' && state.phase === 'authenticated' && !state.pending
    && state.session?.audience === 'admin' ? state.session.principalId : null;
}

/** Persist the exact update identity before the first effectful start request. */
export function createDeliveryUpdateController(options: {access: AccessController;
  transport: DeliveryTransport; persistence: DeliveryUpdatePersistence}): DeliveryUpdateController {
  const {access, transport, persistence} = options;
  let disposed = false, owner = principal(access), identityVersion = 0, generation = 0;
  let busy = false, connection: DeliveryConnection = 'reconnecting';
  let inspection: DeliveryUpdateInspection | null = null, prepared: DeliveryUpdatePrepared | null = null;
  let update: DeliveryUpdateStatus | null = null, error: string | null = null;
  let pending = saved(persistence.read());
  if (pending?.owner !== owner) pending = null;
  const observers = new Set<() => void>();
  let snapshot: DeliveryUpdateSnapshot;
  function publish() {
    snapshot = Object.freeze({authorized: !disposed && owner !== null,
      rejectAvailable: typeof transport.rejectUpdate === 'function', identityVersion, busy,
      connection, inspection, prepared, update, saved: pending, error});
    for (const listener of [...observers]) { try {listener();} catch { /* subscriber isolation */ } }
  }
  publish();
  const unsubscribe = access.subscribe(() => {
    const next = principal(access);
    if (next === owner) return;
    owner = next; identityVersion++; generation++; busy = false; connection = 'reconnecting';
    inspection = null; prepared = null; update = null; error = null;
    pending = owner ? saved(persistence.read()) : null;
    if (pending?.owner !== owner) pending = null;
    publish();
  });
  async function execute<T>(action: () => Promise<DeliveryResult<T>>,
    apply: (value: T) => void): Promise<DeliveryResult<T>> {
    if (disposed || owner === null) return fail('unauthorized');
    if (busy) return fail('in_flight');
    const started = generation, actor = owner;
    busy = true; error = null; publish();
    let result: DeliveryResult<T>;
    try {result = await action();} catch {result = fail('unavailable');}
    if (disposed || generation !== started || owner !== actor) return fail('stale');
    busy = false;
    if (result.ok) {
      try {apply(result.value); connection = 'connected';}
      catch (cause) {
        const code = cause instanceof UpdateStateError ? cause.code : 'invalid_response';
        result = fail(code); error = code;
      }
    } else {
      error = result.code;
      if (result.code === 'unavailable' || result.code === 'outcome_unknown') connection = 'unavailable';
    }
    publish();
    return result;
  }
  function exactUpdate(value: DeliveryUpdateStatus, updateId: string, confirmed = false) {
    if (value.kind !== 'update' || value.updateId !== updateId || !digest(value.planDigest)
      || pending && pending.planDigest !== value.planDigest) throw new UpdateStateError('invalid_response');
    if (!pending && owner) {
      const recovered: DeliverySavedUpdate = {kind: 'update', owner, updateId,
        planDigest: value.planDigest, started: value.phase !== 'prepared'};
      if (!persistence.save(recovered)) throw new UpdateStateError('persistence_unavailable');
      pending = recovered;
    }
    if (confirmed && value.phase === 'prepared' && pending?.started) {
      const rearmed = {...pending, started: false};
      if (!persistence.save(rearmed)) throw new UpdateStateError('persistence_unavailable');
      pending = rearmed;
    }
    if (value.phase === 'prepared' && value.summary) prepared = {kind: 'update', updateId,
      planDigest: value.planDigest, summary: value.summary};
    if (value.phase === 'rejected' && inspection)
      inspection = {...inspection, activeUpdateId: null};
    update = value;
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {observers.add(listener); return () => observers.delete(listener);},
    inspect: () => execute(() => transport.inspectUpdate(), value => {
      if (value.kind !== 'update' || pending && value.activeUpdateId
        && pending.updateId !== value.activeUpdateId) throw new UpdateStateError('update_conflict');
      inspection = value;
    }),
    prepare: () => {
      if (inspection?.readiness !== 'ready' || inspection.activeUpdateId
        || pending && !['delivered','rejected'].includes(update?.phase ?? ''))
        return Promise.resolve(fail<DeliveryUpdatePrepared>('update_not_ready'));
      return execute(() => transport.prepareUpdate(), value => {
        if (!owner || value.kind !== 'update' || !id(value.updateId) || !digest(value.planDigest))
          throw new UpdateStateError('invalid_response');
        const next: DeliverySavedUpdate = {kind: 'update', owner, updateId: value.updateId,
          planDigest: value.planDigest, started: false};
        if (!persistence.save(next)) throw new UpdateStateError('persistence_unavailable');
        pending = next; prepared = value; update = null;
        inspection = inspection && {...inspection, activeUpdateId: value.updateId};
      });
    },
    start: () => {
      const current = pending;
      if (busy) return Promise.resolve(fail<DeliveryUpdateStatus>('in_flight'));
      if (inspection?.readiness !== 'ready' || !current || current.started || !prepared
        || prepared.updateId !== current.updateId || prepared.planDigest !== current.planDigest)
        return Promise.resolve(fail<DeliveryUpdateStatus>('update_not_ready'));
      const started = {...current, started: true};
      if (!persistence.save(started)) return Promise.resolve(fail<DeliveryUpdateStatus>('persistence_unavailable'));
      pending = started; publish();
      return execute(() => transport.startUpdate({updateId: current.updateId, planDigest: current.planDigest}),
        value => exactUpdate(value, current.updateId));
    },
    status: () => {
      const updateId = pending?.updateId ?? inspection?.activeUpdateId;
      return updateId ? execute(() => transport.statusUpdate(updateId),
        value => exactUpdate(value, updateId, true))
        : Promise.resolve(fail<DeliveryUpdateStatus>('not_found'));
    },
    reconcile: () => {
      const current = pending;
      return current?.started && update?.phase !== 'delivered' && update?.phase !== 'rejected'
        ? execute(() => transport.reconcileUpdate({updateId: current.updateId,
          planDigest: current.planDigest}), value => exactUpdate(value, current.updateId))
        : Promise.resolve(fail<DeliveryUpdateStatus>('update_not_ready'));
    },
    retry: () => {
      const current = pending;
      return current?.started && update?.phase === 'delivery-unknown'
        && update.retryEligible === true && !update.diagnostic?.apiCodes.includes(10021)
        ? execute(() => transport.retryUpdate({updateId: current.updateId,
          planDigest: current.planDigest}), value => exactUpdate(value, current.updateId))
        : Promise.resolve(fail<DeliveryUpdateStatus>('update_not_ready'));
    },
    reject: () => {
      const rejectUpdate = transport.rejectUpdate;
      if (typeof rejectUpdate !== 'function')
        return Promise.resolve(fail<DeliveryUpdateStatus>('service_unavailable'));
      const current = pending;
      return current?.started && update?.phase === 'delivery-unknown'
        && update.diagnostic?.apiCodes.includes(10021)
        ? execute(() => rejectUpdate.call(transport, {updateId: current.updateId,
          planDigest: current.planDigest}), value => {
            if (value.phase !== 'rejected' || value.registryStatus !== 'pending'
              || value.finalUrl !== null || value.retryEligible !== false)
              throw new UpdateStateError('invalid_response');
            exactUpdate(value, current.updateId);
          })
        : Promise.resolve(fail<DeliveryUpdateStatus>('update_not_ready'));
    },
    dispose() {if (disposed) return; disposed = true; generation++; unsubscribe(); observers.clear();},
  });
}
