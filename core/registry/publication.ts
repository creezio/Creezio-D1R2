import type {
  RegistryArtifact, RegistryDeclarationRequest, RegistryDeclarationResult,
  RegistryPreflightRequest, RegistryPreflightResult
} from '../../sdk/registry/types.ts';
import { captureRegistryDeclaration, captureRegistryPreflight, RegistryClientError,
  type RegistryClient } from './client.ts';

const requestKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Only a verified delivery receipt may transition a prepared attempt to delivered. */
export interface VerifiedDelivery {
  readonly deploymentId: string;
  readonly url: string;
  readonly repositoryUrl?: string;
  readonly publishedSha?: string;
  readonly artifact: RegistryArtifact;
}
export interface PreparedPublication {
  readonly state: 'prepared';
  readonly requestKey: string;
  readonly request: RegistryPreflightRequest;
  readonly preflight: RegistryPreflightResult;
}
export interface DeliveredPublication extends Omit<PreparedPublication, 'state'> {
  readonly state: 'delivered';
  readonly declaration: RegistryDeclarationRequest;
}
export interface SynchronizedPublication extends Omit<PreparedPublication, 'state'> {
  readonly state: 'synchronized';
  readonly declaration: RegistryDeclarationRequest;
  readonly result: RegistryDeclarationResult;
}
export type PublicationRecord = PreparedPublication | DeliveredPublication | SynchronizedPublication;

/** Implementations must make claim atomic and persist each transition before resolving. */
export interface PublicationJournal {
  get(requestKey: string): Promise<PublicationRecord | null>;
  claim(record: PreparedPublication): Promise<PublicationRecord | null>;
  saveDelivered(record: DeliveredPublication): Promise<void>;
  saveSynchronized(record: SynchronizedPublication): Promise<void>;
}
export type PublicationOutcome =
  | Readonly<{ state: 'blocked'; reason: string }>
  | Readonly<{ state: 'requires_inspection'; record: PreparedPublication }>
  | Readonly<{ state: 'delivery_unknown'; record: PreparedPublication }>
  | Readonly<{ state: 'delivered_unjournaled'; record: PreparedPublication; declaration: RegistryDeclarationRequest }>
  | Readonly<{ state: 'declaration_pending'; record: DeliveredPublication; reason: string }>
  | Readonly<{ state: 'synchronized'; record: SynchronizedPublication }>;

function invalid(): never { throw new RegistryClientError('invalid_input'); }
function requestKey(value: unknown): string {
  if (typeof value !== 'string' || !requestKeyPattern.test(value)) return invalid();
  return value;
}
function sameArtifact(left: RegistryArtifact, right: RegistryArtifact): boolean {
  return left.sourceSha === right.sourceSha && left.artifactDigest === right.artifactDigest
    && left.coreVersion === right.coreVersion && left.contractVersion === right.contractVersion
    && left.compositionDigest === right.compositionDigest;
}
function sameRequest(left: RegistryPreflightRequest, right: RegistryPreflightRequest): boolean {
  return left.projectId === right.projectId && left.installationId === right.installationId
    && left.target === right.target && sameArtifact(left.artifact, right.artifact);
}
function captureRecord(value: PublicationRecord, key: string, allowLoopback: boolean,
  expected?: RegistryPreflightRequest): PublicationRecord {
  if (!value || typeof value !== 'object' || !['prepared', 'delivered', 'synchronized'].includes(value.state)
    || value.requestKey !== key) return invalid();
  const request = captureRegistryPreflight(value.request);
  if (expected && !sameRequest(request, expected)) return invalid();
  const preflight = value.preflight;
  if (!preflight || preflight.projectId !== request.projectId || preflight.installationId !== request.installationId
    || typeof preflight.preflightId !== 'string' || !requestKeyPattern.test(preflight.preflightId)
    || typeof preflight.expiresAt !== 'string' || !Number.isFinite(Date.parse(preflight.expiresAt))) return invalid();
  const prepared = Object.freeze({ state: 'prepared' as const, requestKey: key, request,
    preflight: Object.freeze({ ...preflight }) });
  if (value.state === 'prepared') return prepared;
  const declaration = captureRegistryDeclaration(value.declaration, allowLoopback);
  if (declaration.requestKey !== key || declaration.preflightId !== preflight.preflightId
    || declaration.projectId !== request.projectId || declaration.installationId !== request.installationId
    || !sameArtifact(declaration.artifact, request.artifact)) return invalid();
  const delivered = Object.freeze({ ...prepared, state: 'delivered' as const, declaration });
  if (value.state === 'delivered') return delivered;
  const result = value.result;
  if (!result || result.projectId !== request.projectId || result.installationId !== request.installationId
    || result.deploymentId !== declaration.deploymentId || typeof result.declaredAt !== 'string'
    || !Number.isFinite(Date.parse(result.declaredAt)) || typeof result.replayed !== 'boolean') return invalid();
  return Object.freeze({ ...delivered, state: 'synchronized' as const, result: Object.freeze({ ...result }) });
}
function receiptDeclaration(prepared: Pick<PreparedPublication, 'preflight' | 'request' | 'requestKey'>, receipt: VerifiedDelivery,
  allowLoopback: boolean): RegistryDeclarationRequest {
  const declaration = captureRegistryDeclaration({
    preflightId: prepared.preflight.preflightId, requestKey: prepared.requestKey,
    projectId: prepared.request.projectId, installationId: prepared.request.installationId,
    deploymentId: receipt.deploymentId, url: receipt.url, repositoryUrl: receipt.repositoryUrl,
    publishedSha: receipt.publishedSha, artifact: receipt.artifact
  }, allowLoopback);
  if (!sameArtifact(declaration.artifact, prepared.request.artifact)) return invalid();
  return declaration;
}
function reason(error: unknown): string {
  return error instanceof RegistryClientError ? error.code : 'unavailable';
}

export interface PublicationGate {
  publish(request: RegistryPreflightRequest, requestKey: string,
    deliverAndVerify: (preflight: RegistryPreflightResult, request: RegistryPreflightRequest) => Promise<VerifiedDelivery>): Promise<PublicationOutcome>;
  /** Manual recovery after inspecting a delivery whose callback or journal write failed. */
  confirmDelivered(requestKey: string, verifiedReceipt: VerifiedDelivery): Promise<PublicationOutcome>;
  /** A retry contacts only the registry; it never invokes the publisher. */
  reconcile(requestKey: string): Promise<PublicationOutcome>;
}
export interface PublicationGateOptions {
  readonly client: RegistryClient;
  readonly journal: PublicationJournal;
  readonly allowLoopbackDelivery?: boolean;
  readonly now?: () => number;
}

/** The only entrypoint that invokes a publisher in the official delivery path. */
export function createPublicationGate(options: PublicationGateOptions): PublicationGate {
  if (!options || typeof options !== 'object' || !options.client || !options.journal
    || typeof options.client.preflight !== 'function' || typeof options.client.declare !== 'function'
    || typeof options.journal.get !== 'function' || typeof options.journal.claim !== 'function'
    || typeof options.journal.saveDelivered !== 'function' || typeof options.journal.saveSynchronized !== 'function')
    throw new RegistryClientError('invalid_configuration');
  const { client, journal } = options, now = options.now ?? Date.now;
  const allowLoopback = options.allowLoopbackDelivery === true;

  async function reconcile(keyValue: string, expected?: RegistryPreflightRequest): Promise<PublicationOutcome> {
    const key = requestKey(keyValue);
    const stored = await journal.get(key);
    if (!stored) return invalid();
    const record = captureRecord(stored, key, allowLoopback, expected);
    if (record.state === 'prepared') return { state: 'requires_inspection', record };
    if (record.state === 'synchronized') return { state: 'synchronized', record };
    let result: RegistryDeclarationResult;
    try { result = await client.declare(record.declaration); }
    catch (error) { return { state: 'declaration_pending', record, reason: reason(error) }; }
    const synchronized: SynchronizedPublication = Object.freeze({ ...record, state: 'synchronized', result });
    try { await journal.saveSynchronized(synchronized); }
    catch { return { state: 'declaration_pending', record, reason: 'journal_unavailable' }; }
    return { state: 'synchronized', record: synchronized };
  }

  async function confirmDelivered(keyValue: string, receipt: VerifiedDelivery): Promise<PublicationOutcome> {
    const key = requestKey(keyValue), stored = await journal.get(key);
    if (!stored) return invalid();
    const record = captureRecord(stored, key, allowLoopback);
    if (record.state !== 'prepared') {
      const proposed = receiptDeclaration(record, receipt, allowLoopback);
      if (record.declaration.deploymentId !== proposed.deploymentId || record.declaration.url !== proposed.url
        || record.declaration.repositoryUrl !== proposed.repositoryUrl
        || record.declaration.publishedSha !== proposed.publishedSha) return invalid();
      return reconcile(key, record.request);
    }
    const declaration = receiptDeclaration(record, receipt, allowLoopback);
    const delivered: DeliveredPublication = Object.freeze({ ...record, state: 'delivered', declaration });
    try { await journal.saveDelivered(delivered); }
    catch { return { state: 'delivered_unjournaled', record, declaration }; }
    return reconcile(key, record.request);
  }

  async function publish(value: RegistryPreflightRequest, keyValue: string,
    deliverAndVerify: (preflight: RegistryPreflightResult, request: RegistryPreflightRequest) => Promise<VerifiedDelivery>): Promise<PublicationOutcome> {
    const request = captureRegistryPreflight(value), key = requestKey(keyValue);
    if (typeof deliverAndVerify !== 'function') return invalid();
    const prior = await journal.get(key);
    if (prior) {
      const record = captureRecord(prior, key, allowLoopback, request);
      return record.state === 'prepared' ? { state: 'requires_inspection', record } : reconcile(key, request);
    }
    let preflight: RegistryPreflightResult;
    try { preflight = await client.preflight(request); }
    catch (error) { return { state: 'blocked', reason: reason(error) }; }
    if (preflight.projectId !== request.projectId || preflight.installationId !== request.installationId
      || !Number.isFinite(Date.parse(preflight.expiresAt)) || Date.parse(preflight.expiresAt) <= now())
      return { state: 'blocked', reason: 'invalid_preflight' };
    const prepared: PreparedPublication = Object.freeze({ state: 'prepared', requestKey: key, request,
      preflight: Object.freeze({ ...preflight }) });
    let existing: PublicationRecord | null;
    try { existing = await journal.claim(prepared); }
    catch { return { state: 'blocked', reason: 'journal_unavailable' }; }
    if (existing) {
      const record = captureRecord(existing, key, allowLoopback, request);
      return record.state === 'prepared' ? { state: 'requires_inspection', record } : reconcile(key, request);
    }
    if (Date.parse(preflight.expiresAt) <= now()) return { state: 'blocked', reason: 'expired_preflight' };
    let receipt: VerifiedDelivery;
    try { receipt = await deliverAndVerify(preflight, request); }
    catch { return { state: 'delivery_unknown', record: prepared }; }
    // A publisher returning an invalid or different artifact must never be declared as this preflight.
    let declaration: RegistryDeclarationRequest;
    try { declaration = receiptDeclaration(prepared, receipt, allowLoopback); }
    catch { return { state: 'delivery_unknown', record: prepared }; }
    const delivered: DeliveredPublication = Object.freeze({ ...prepared, state: 'delivered', declaration });
    try { await journal.saveDelivered(delivered); }
    catch { return { state: 'delivered_unjournaled', record: prepared, declaration }; }
    return reconcile(key, request);
  }
  return Object.freeze({ publish, confirmDelivered, reconcile });
}
