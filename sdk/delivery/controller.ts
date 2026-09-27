import type {AccessController} from '../access/types.ts';
import type {DeliveryConnection, DeliveryViewInput} from './types.ts';
import type {DeliveryConfigureInput, DeliveryInspection, DeliveryPrepared, DeliveryResult,
  DeliverySecretSelection, DeliveryTransferStatus, DeliveryTransport} from './transport.ts';

export interface DeliverySavedTransfer {
  readonly owner: string;
  readonly transferId: string;
  readonly planDigest: string;
  readonly started: boolean;
}
export interface DeliveryPersistence {
  read(): unknown;
  save(value: DeliverySavedTransfer | null): boolean;
}
export interface DeliverySnapshot {
  readonly authorized: boolean;
  readonly identityVersion: number;
  readonly busy: boolean;
  readonly connection: DeliveryConnection;
  readonly inspection: DeliveryInspection | null;
  readonly prepared: DeliveryPrepared | null;
  readonly transfer: DeliveryTransferStatus | null;
  readonly saved: DeliverySavedTransfer | null;
  readonly error: string | null;
}
export interface DeliveryController {
  getSnapshot(): DeliverySnapshot;
  subscribe(listener: () => void): () => void;
  inspect(): Promise<DeliveryResult<DeliveryInspection>>;
  configure(input: DeliveryConfigureInput): Promise<DeliveryResult<DeliveryInspection>>;
  prepare(input: Readonly<{secretSelections: readonly DeliverySecretSelection[]}>): Promise<DeliveryResult<DeliveryPrepared>>;
  start(): Promise<DeliveryResult<DeliveryTransferStatus>>;
  status(): Promise<DeliveryResult<DeliveryTransferStatus>>;
  reconcile(): Promise<DeliveryResult<DeliveryTransferStatus>>;
  dispose(): void;
}

const fail = <T>(code: string): DeliveryResult<T> => ({ok: false, code});
class DeliveryStateError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const id = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string'
  && /^sha256-[a-f0-9]{64}$/.test(value);
function saved(value: unknown): DeliverySavedTransfer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  return id(item.owner) && id(item.transferId) && digest(item.planDigest)
    && typeof item.started === 'boolean'
    ? {owner: item.owner, transferId: item.transferId, planDigest: item.planDigest, started: item.started} : null;
}
function principal(access: AccessController): string | null {
  const state = access.getSnapshot();
  return access.audience === 'admin' && state.phase === 'authenticated' && !state.pending
    && state.session?.audience === 'admin' ? state.session.principalId : null;
}

/** A transfer identity is saved before start; an uncertain start is recovered by ID, never prepared again. */
export function createDeliveryController(options: {access: AccessController; transport: DeliveryTransport;
  persistence: DeliveryPersistence}): DeliveryController {
  const {access, transport, persistence} = options;
  let disposed = false, owner = principal(access), identityVersion = 0, generation = 0;
  let busy = false, connection: DeliveryConnection = 'reconnecting';
  let inspection: DeliveryInspection | null = null, prepared: DeliveryPrepared | null = null;
  let transfer: DeliveryTransferStatus | null = null, error: string | null = null;
  let pending = saved(persistence.read());
  if (pending?.owner !== owner) pending = null;
  const observers = new Set<() => void>();
  let snapshot: DeliverySnapshot;
  function publish() {
    snapshot = Object.freeze({authorized: !disposed && owner !== null, identityVersion, busy,
      connection, inspection, prepared, transfer, saved: pending, error});
    for (const listener of [...observers]) { try {listener();} catch { /* subscriber isolation */ } }
  }
  publish();
  const unsubscribe = access.subscribe(() => {
    const next = principal(access);
    if (next === owner) return;
    owner = next; identityVersion++; generation++; busy = false; connection = 'reconnecting';
    inspection = null; prepared = null; transfer = null; error = null;
    pending = owner ? saved(persistence.read()) : null;
    if (pending?.owner !== owner) pending = null;
    publish();
  });
  async function execute<T>(action: () => Promise<DeliveryResult<T>>, apply: (value: T) => void): Promise<DeliveryResult<T>> {
    if (disposed || owner === null) return fail('unauthorized');
    if (busy) return fail('in_flight');
    const started = generation, actor = owner;
    busy = true; error = null; publish();
    let result: DeliveryResult<T>;
    try { result = await action(); } catch { result = fail('unavailable'); }
    if (disposed || generation !== started || owner !== actor) return fail('stale');
    busy = false;
    if (result.ok) {
      try { apply(result.value); connection = 'connected'; }
      catch (cause) { const code = cause instanceof DeliveryStateError ? cause.code : 'invalid_response';
        result = fail(code); error = code; }
    } else { error = result.code; if (result.code === 'unavailable' || result.code === 'outcome_unknown') connection = 'unavailable'; }
    publish();
    return result;
  }
  function exactTransfer(status: DeliveryTransferStatus, transferId: string, confirmedStatus = false) {
    if (status.transferId !== transferId || !digest(status.planDigest)
      || pending && pending.planDigest !== status.planDigest) throw new DeliveryStateError('invalid_response');
    if (!pending && owner) {
      const recovered = {owner, transferId, planDigest: status.planDigest, started: status.phase !== 'prepared'};
      if (!persistence.save(recovered)) throw new DeliveryStateError('persistence_unavailable');
      pending = recovered;
    }
    if (confirmedStatus && status.phase === 'prepared' && pending?.started) {
      const rearmed = {...pending, started: false};
      if (!persistence.save(rearmed)) throw new DeliveryStateError('persistence_unavailable');
      pending = rearmed;
    }
    if (status.phase === 'prepared' && status.summary) {
      prepared = {transferId, planDigest: status.planDigest, summary: status.summary};
    }
    transfer = status;
  }
  function transferId() { return pending?.transferId ?? inspection?.activeTransferId ?? null; }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { observers.add(listener); return () => observers.delete(listener); },
    inspect: () => execute(() => transport.inspect(), value => { inspection = value;
      if (pending && value.activeTransferId && pending.transferId !== value.activeTransferId)
        throw new DeliveryStateError('transfer_conflict');
      if (value.hostProfile !== 'docker-local') { prepared = null; transfer = null; } }),
    configure: (input: DeliveryConfigureInput) => inspection?.hostProfile !== 'docker-local'
      ? Promise.resolve(fail<DeliveryInspection>('not_ready'))
      : (pending || inspection.activeTransferId) && (!inspection.target
        || input.target.accountId !== inspection.target.accountId
        || input.target.workerName !== inspection.target.workerName)
      ? Promise.resolve(fail<DeliveryInspection>('transfer_conflict')) : execute(() => transport.configure(input), value => {
      inspection = value; if (!pending && !value.activeTransferId) prepared = null;
    }),
    prepare: (input: Readonly<{secretSelections: readonly DeliverySecretSelection[]}>) => {
      if (inspection?.hostProfile !== 'docker-local' || inspection.configuration !== 'ready'
        || pending || inspection.activeTransferId) return Promise.resolve(fail<DeliveryPrepared>('not_ready'));
      return execute(() => transport.prepare(input), value => {
        if (!owner || !id(value.transferId) || !digest(value.planDigest)) throw new DeliveryStateError('invalid_response');
        const next = {owner, transferId: value.transferId, planDigest: value.planDigest, started: false};
        if (!persistence.save(next)) throw new DeliveryStateError('persistence_unavailable');
        pending = next; prepared = value;
        inspection = inspection && {...inspection, preparation: 'ready', activeTransferId: value.transferId};
      });
    },
    start: () => {
      const current = pending;
      if (busy) return Promise.resolve(fail<DeliveryTransferStatus>('in_flight'));
      if (inspection?.hostProfile !== 'docker-local' || !current || current.started || !prepared
        || prepared.transferId !== current.transferId || prepared.planDigest !== current.planDigest)
        return Promise.resolve(fail<DeliveryTransferStatus>('not_ready'));
      const started = {...current, started: true};
      if (!persistence.save(started)) return Promise.resolve(fail<DeliveryTransferStatus>('persistence_unavailable'));
      pending = started; publish();
      return execute(() => transport.start({transferId: current.transferId, planDigest: current.planDigest}),
        value => exactTransfer(value, current.transferId));
    },
    status: () => {
      const current = transferId();
      return current && inspection?.hostProfile === 'docker-local'
        ? execute(() => transport.status(current), value => exactTransfer(value, current, true))
        : Promise.resolve(fail<DeliveryTransferStatus>('not_found'));
    },
    reconcile: () => {
      const current = pending;
      return current && inspection?.hostProfile === 'docker-local'
        ? execute(() => transport.reconcile({transferId: current.transferId, planDigest: current.planDigest}),
          value => exactTransfer(value, current.transferId))
        : Promise.resolve(fail<DeliveryTransferStatus>('not_found'));
    },
    dispose() { if (disposed) return; disposed = true; generation++; unsubscribe(); observers.clear(); },
  });
}

export function deliveryViewInput(snapshot: DeliverySnapshot): DeliveryViewInput {
  return {profile: 'docker-local', connection: snapshot.connection,
    configuration: snapshot.inspection?.configuration ?? 'unknown',
    preparation: snapshot.inspection?.preparation ?? 'unknown',
    planReviewed: !!snapshot.prepared && !!snapshot.saved && !snapshot.saved.started
      && snapshot.prepared.transferId === snapshot.saved.transferId
      && snapshot.prepared.planDigest === snapshot.saved.planDigest,
    transfer: snapshot.transfer?.phase === 'prepared' ? null
      : snapshot.transfer ? {id: snapshot.transfer.transferId, phase: snapshot.transfer.phase}
      : snapshot.saved?.started ? {id: snapshot.saved.transferId, phase: 'starting'} : null};
}
