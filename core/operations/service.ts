import { createDataAccess } from '../data/service.ts';
import { copyJson } from '../data/input.ts';
import { DataAccessError, type DataCredential, type DataLease, type DataPlan, type DataPort, type DataRecord,
  type JsonValue, type RuntimeDataCatalog, type PermissionDefinition } from '../data/types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import type { AuthorizationAudience, AuthorizationActor } from '../authorization/types.ts';
import { createOperationStore } from './store.ts';
import { OperationStoreError, type OperationExecution, type OperationOutboxIntent } from './store-types.ts';
import type { OperationRegistry } from './registry.ts';
import { OperationError, OPERATION_LIMITS, type OperationContext, type OperationDataPort, type OperationHandlerResult, type RegisteredOperation, type OperationProviderAvailability } from './types.ts';
import { createNativeAccessOperationAdapter, validNativeAccessDeclaration } from './native-access.ts';
import type { SqlStatement } from '../data/authorization.ts';
import {captureHostInventory} from './host-inventory.ts';
import type {ModuleSettingsHostInventory} from '../../sdk/module-settings/types.ts';
import {createFileService, type FileBucket} from '../files/service.ts';
import {fileOwnerId, resolveFileCategory, type RuntimeFileCatalog} from '../files/catalog.ts';
import {FileError} from '../files/mapping.ts';
import type {OperationFilesPort} from '../../sdk/files/types.ts';
import {createProviderSecretsPort} from '../providers/secrets.ts';
import {VaultError,type VaultKeyring} from '../vault/crypto.ts';
import type {VaultStorage} from '../vault/service.ts';
import {operationDigest} from './digest.ts';
import {createWidgetOperationPort} from '../widgets/host.ts';
import type {CompiledWidgetCatalog,WidgetValidatorMap} from '../../sdk/widgets/catalog.ts';
import type {WidgetApprovalService} from '../widgets/approval.ts';

export interface OperationRequest {
  readonly credential: DataCredential; readonly moduleId: string; readonly operationId: string;
  readonly contextId: string; readonly audience: AuthorizationAudience; readonly input: unknown; readonly signal?: AbortSignal;
  readonly approvalId?:string;
}
export interface OperationStatusRequest extends Omit<OperationRequest, 'input' | 'signal'> { readonly executionId: string }
export interface OperationLookupRequest extends Omit<OperationRequest, 'input' | 'signal'> { readonly requestKey: string }
const encoder = new TextEncoder();
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new OperationError('invalid_input');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new OperationError('invalid_input');
    result[key] = descriptor.value;
  }
  return result;
}
function capture(request: unknown, mode: 'invoke' | 'status' | 'lookup' = 'invoke'): OperationRequest | OperationStatusRequest | OperationLookupRequest {
  try {
    const raw = object(request), required = ['credential', 'moduleId', 'operationId', 'contextId', 'audience',
      mode === 'status' ? 'executionId' : mode === 'lookup' ? 'requestKey' : 'input'];
    if (required.some(key => !Object.hasOwn(raw, key)) || Object.keys(raw).some(key => !required.includes(key) && (mode !== 'invoke' || !['signal','approvalId'].includes(key))))
      throw new Error();
    const signal = raw.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error();
    const copied = copyJson(Object.fromEntries(required.map(key => [key, raw[key]])), OPERATION_LIMITS.inputBytes + 8192) as Record<string, JsonValue>;
    if (['moduleId', 'operationId', 'contextId', ...(mode === 'status' ? ['executionId'] : [])].some(key => typeof copied[key] !== 'string' || !copied[key])
      || !['admin', 'app'].includes(String(copied.audience))) throw new Error();
    if (mode === 'lookup' && (typeof copied.requestKey !== 'string' || !copied.requestKey
      || encoder.encode(copied.requestKey).length > 512)) throw new Error();
    if (mode === 'invoke') copyJson(copied.input, OPERATION_LIMITS.inputBytes);
    if (mode === 'invoke' && raw.approvalId !== undefined
      && (typeof raw.approvalId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.approvalId))) throw new Error();
    return Object.freeze({ ...copied, ...(signal ? { signal } : {}),
      ...(mode === 'invoke' && raw.approvalId ? {approvalId:raw.approvalId} : {}) }) as unknown as OperationRequest | OperationStatusRequest | OperationLookupRequest;
  } catch { throw new OperationError('invalid_input'); }
}
function errorCode(error: unknown): OperationError['code'] {
  if (error instanceof OperationError) return error.code;
  if (error instanceof DataAccessError) return ['unauthorized', 'forbidden'].includes(error.code) ? error.code as 'unauthorized' | 'forbidden'
    : error.code === 'unsupported' ? 'unsupported' : 'unavailable';
  if (error instanceof OperationStoreError) return error.code === 'conflict' ? 'conflict' : 'unavailable';
  if (error instanceof FileError) return ['not_found', 'conflict', 'invalid_input', 'unsupported'].includes(error.code)
    ? error.code as 'not_found' | 'conflict' | 'invalid_input' | 'unsupported' : 'unavailable';
  if (error instanceof VaultError) return ['invalid_input', 'conflict', 'forbidden', 'unavailable'].includes(error.code)
    ? error.code as 'invalid_input' | 'conflict' | 'forbidden' | 'unavailable' : 'unavailable';
  return 'unavailable';
}

/** Internal common executor. API/MCP adapters supply native credentials; a channel never grants rights. */
export function createOperationEngine(options: { readonly db: IdentityDatabase; readonly catalog: RuntimeDataCatalog;
  readonly registry: OperationRegistry; readonly permissions: readonly PermissionDefinition[];
  readonly files?: {readonly catalog: RuntimeFileCatalog; readonly bucket: FileBucket};
  readonly providerSecrets?: {readonly storage:VaultStorage;readonly keyring:VaultKeyring;readonly providerId:string};
  readonly providerAvailability?: (request: OperationRequest, providerId: string) => Promise<OperationProviderAvailability>;
  readonly runtimeInventory?: ModuleSettingsHostInventory;
  readonly approvals?:WidgetApprovalService;
  readonly widgets?:{readonly catalog:CompiledWidgetCatalog;readonly validators:WidgetValidatorMap} }) {
  const { registry } = options, catalog = copyJson(options.catalog, 4 * 1024 * 1024) as unknown as RuntimeDataCatalog;
  if (catalog.compositionDigest !== registry.compositionDigest) throw new OperationError('invalid_catalog');
  const hostInventory = captureHostInventory(options.runtimeInventory, registry.compositionDigest);
  const data = createDataAccess(options.db, { catalog, permissions: options.permissions }), store = createOperationStore({ db: options.db, data });
  const nativeAccess = createNativeAccessOperationAdapter(options.db, options.permissions, catalog);
  async function authorize(request: OperationRequest | OperationStatusRequest | OperationLookupRequest, operation: RegisteredOperation): Promise<DataLease> {
    const declaration = operation.declaration;
    if (operation.moduleId === 'creezio.access' && (!validNativeAccessDeclaration(declaration)
      || !['session', 'oauth'].includes(request.credential.kind))) throw new OperationError('forbidden');
    if (!declaration.audiences.includes(request.audience) || declaration.context === 'application' && request.contextId !== 'application') throw new OperationError('forbidden');
    const actors = declaration.actors.filter((actor): actor is AuthorizationActor => ['user', 'machine', 'delegated-user', 'impersonated-user'].includes(actor));
    if (!actors.length) throw new OperationError('unsupported');
    try {
      return await data.authorize(request.credential, { contextId: request.contextId, audience: request.audience, actors,
        requiredPermissionIds: declaration.permissions.map(ref => `${ref.moduleId}:${ref.id}`), purpose: 'operation' }, { moduleId: operation.moduleId });
    } catch (error) { throw new OperationError(errorCode(error)); }
  }
  function checkedExecution(value: OperationExecution, operation: RegisteredOperation): OperationExecution {
    if (value.operationId !== operation.declaration.id || value.moduleId !== operation.moduleId || value.operationVersion !== operation.contractDigest)
      throw new OperationError('conflict');
    if (['waiting', 'succeeded'].includes(value.state) && operation.validateOutput(value.output) !== true) throw new OperationError('invalid_output');
    return value;
  }
  return Object.freeze({
    async invoke(supplied: OperationRequest): Promise<{ readonly execution: OperationExecution; readonly replayed: boolean }> {
      const request = capture(supplied) as OperationRequest, operation = registry.resolve(request.moduleId, request.operationId), op = operation.declaration;
      if (request.signal?.aborted) throw new OperationError('cancelled');
      if (operation.validateInput(request.input) !== true) throw new OperationError('invalid_input');
      // Unimplemented effects never silently execute as an ordinary mutation.
      if (op.approval.mode === 'required' && !options.approvals || op.effects.calls.length || op.effects.emits.length
        || op.effects.reads.concat(op.effects.writes).some(ref => ref.moduleId !== operation.moduleId || !['model','file'].includes(ref.kind))
        || op.effects.reads.some(ref => ref.kind === 'file')
        || op.effects.writes.some(ref => ref.kind === 'file') && !options.files) throw new OperationError('unsupported');
      const lease = await authorize(request, operation);
      let close: () => void = () => {};
      try {
        // This snapshot is only a preflight; the delivery bridge checks live configuration again.
        let providerAvailability: OperationProviderAvailability | undefined;
        if (op.effects.providers.length) {
          if (op.effects.providers.length !== 1) throw new OperationError('unsupported');
          const providerId = op.effects.providers[0];
          const value = options.providerAvailability
            ? await options.providerAvailability(request, providerId)
            : {providerId, state: 'missing' as const, modelIds: []};
          const snapshot = copyJson(value, 16_384) as unknown as OperationProviderAvailability;
          if (snapshot.providerId !== providerId || !['ready','missing','invalid','unavailable'].includes(snapshot.state)
            || !Array.isArray(snapshot.modelIds) || snapshot.modelIds.length > 128
            || snapshot.modelIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))
            || new Set(snapshot.modelIds).size !== snapshot.modelIds.length) throw new OperationError('invalid_catalog');
          providerAvailability = Object.freeze({...snapshot, modelIds:Object.freeze([...snapshot.modelIds])});
        }
        const input = request.input as JsonValue;
        let idempotencyKey: string;
        if (op.idempotency.mode === 'required') {
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('invalid_input');
          const value = (input as DataRecord)[op.idempotency.keyField];
          if (typeof value !== 'string' || !value.length || encoder.encode(value).length > 512) throw new OperationError('invalid_input');
          idempotencyKey = value;
        } else idempotencyKey = crypto.randomUUID();
        const keyHash = await operationDigest(idempotencyKey), inputHash = await operationDigest(input);
        let approvalStatements:readonly SqlStatement[]|undefined;
        if(op.approval.mode==='required') {
          const existing=await store.lookup(lease,{operationId:op.id,keyHash});
          if(existing) {
            if(existing.inputHash!==inputHash)throw new OperationError('conflict');
            return Object.freeze({execution:checkedExecution(existing,operation),replayed:true});
          }
          if(!request.approvalId)throw new OperationError('approval_required');
          const versionField=op.concurrency.versionField;
          const objectVersion=versionField&&input&&typeof input==='object'&&!Array.isArray(input)
            ?(input as DataRecord)[versionField]:undefined;
          if(typeof objectVersion!=='string'&&typeof objectVersion!=='number')throw new OperationError('invalid_input');
          approvalStatements=await options.approvals!.prepareConsumption({approvalId:request.approvalId,
            credential:request.credential,operation,identity:data.describeLease(lease),inputHash,keyHash,objectVersion});
        } else if(request.approvalId)throw new OperationError('invalid_input');
        if (request.signal?.aborted) throw new OperationError('cancelled');
        const start = await store.start(lease, { operationId: op.id, operationVersion: operation.contractDigest, keyHash, inputHash,
          claimTtlMs: Math.min(OPERATION_LIMITS.maxDurationMs, Math.max(1000, op.execution.maxDurationMs + 5000)),
          retentionMs: op.idempotency.mode === 'required' ? op.idempotency.retentionSeconds * 1000 : 86400_000 });
        if (start.kind === 'existing') return Object.freeze({ execution: checkedExecution(start.execution, operation), replayed: true });
        const controller = new AbortController(), issued = new Map<DataPlan, { write: boolean; compared: boolean; file?: boolean; secret?: boolean }>();
        let active = true, usedItems = 0, failure: OperationError | undefined;
        const ensure = () => { if (!active || controller.signal.aborted) throw failure ?? new OperationError('cancelled'); };
        const spend = (amount: number) => { ensure(); if (!Number.isSafeInteger(amount) || amount < 1 || (usedItems += amount) > op.execution.maxItems) throw new OperationError('invalid_input'); };
        const can = (modelId: string, write: boolean) => (write ? op.effects.writes : op.effects.reads).some(ref => ref.id === modelId && ref.kind === 'model' && ref.moduleId === operation.moduleId);
        const port = (modelId: string, write: boolean): DataPort => {
          ensure();
          if (write && op.kind !== 'command' || !can(modelId, write)) throw new OperationError('forbidden');
          const model = catalog.modules.find(m => m.moduleId === operation.moduleId)?.models.find(m => m.modelId === modelId)?.model;
          if (!model) throw new OperationError('forbidden');
          // A module receives the same public field boundary as every other data consumer.
          return data.forModule(lease, operation.moduleId);
        };
        const plan = (method: 'planGet' | 'planList' | 'planCreate' | 'planPatch' | 'planDelete', modelId: string, suppliedInput: unknown): DataPlan => {
          const args = copyJson(suppliedInput) as Record<string, JsonValue>, write = ['planCreate', 'planPatch', 'planDelete'].includes(method);
          if (issued.size >= OPERATION_LIMITS.maxPlans) throw new OperationError('invalid_input');
          const p = port(modelId, write); spend(method === 'planList' ? Number(args.limit) : 1);
          let compared = false;
          if (op.concurrency.mode === 'object-version' && ['planPatch', 'planDelete'].includes(method)) {
            const compare = args.compare as Record<string, JsonValue> | undefined;
            const version = input && typeof input === 'object' && !Array.isArray(input) ? (input as DataRecord)[op.concurrency.versionField!] : undefined;
            if (!compare || typeof compare !== 'object' || !Number.isSafeInteger(version) || compare.expected !== version) throw new OperationError('conflict');
            compared = true;
          }
          const token = (p[method] as (id: string, input: unknown) => DataPlan)(modelId, args);
          issued.set(token, { write, compared }); return token;
        };
        const operationData: OperationDataPort = Object.freeze({
          get: async (modelId, args) => { const p = port(modelId, false); spend(1); return p.get(modelId, args); },
          list: async (modelId, args) => { const copied = copyJson(args) as unknown as Parameters<DataPort['list']>[1]; const p = port(modelId, false); spend(copied.limit); return p.list(modelId, copied); },
          planGet: (id, args) => plan('planGet', id, args), planList: (id, args) => plan('planList', id, args),
          planCreate: (id, args) => plan('planCreate', id, args), planPatch: (id, args) => plan('planPatch', id, args), planDelete: (id, args) => plan('planDelete', id, args),
        });
        let rejectCancellation: (error: OperationError) => void = () => {};
        const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
        const cancel = (code: 'cancelled' | 'timeout') => { if (failure) return; failure = new OperationError(code); controller.abort(); rejectCancellation(failure); };
        const onAbort = () => cancel('cancelled');
        if (request.signal?.aborted) onAbort(); else request.signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => cancel('timeout'), op.execution.maxDurationMs);
        close = () => { active = false; clearTimeout(timer); request.signal?.removeEventListener('abort', onAbort); };
        const identity = data.describeLease(lease), context: OperationContext = Object.freeze({ moduleId: operation.moduleId, operationId: op.id,
          executionId: start.execution.id, contextId: identity.contextId, audience: identity.audience, principalId: identity.principalId,
          actorPrincipalId: identity.actorPrincipalId, signal: controller.signal, data: operationData,
          ...(providerAvailability ? {providerAvailability} : {}),
          ...(options.providerSecrets && operation.moduleId === 'creezio.openai' && op.kind === 'command'
            && op.id.startsWith('config.key.') && options.providerSecrets.storage.moduleId === operation.moduleId
            && op.effects.writes.some(ref => ref.kind === 'model' && ref.moduleId === operation.moduleId
              && ref.id === options.providerSecrets!.storage.modelId)
            ? {providerSecrets:createProviderSecretsPort({data,catalog,lease,...options.providerSecrets,
              register(token){
                ensure();if(issued.size >= OPERATION_LIMITS.maxPlans)throw new OperationError('invalid_input');
                spend(1);issued.set(token,{write:true,compared:false,secret:true});
              }})} : {}),
          ...(options.files ? {files: Object.freeze({async preparePublication(categoryId, reference) {
            ensure();
            if (op.kind !== 'command' || !op.effects.writes.some(ref => ref.moduleId === operation.moduleId && ref.kind === 'file' && ref.id === categoryId))
              throw new OperationError('forbidden');
            // Charge work before I/O, then recheck the plan budget after concurrent completions.
            spend(1);
            if (issued.size >= OPERATION_LIMITS.maxPlans) throw new OperationError('invalid_input');
            const category = resolveFileCategory(catalog, options.files!.catalog, operation.moduleId, categoryId, identity.audience);
            const service = createFileService({data, catalog, moduleId: operation.moduleId, category,
              bucket: options.files!.bucket, ownerId: await fileOwnerId(identity.principalId, identity.audience)});
            const result = await service.preparePublication(lease, reference), token=result.plan;
            ensure();
            if (issued.size >= OPERATION_LIMITS.maxPlans) throw new OperationError('invalid_input');
            issued.set(token, {write: true, compared: false, file: true});
            return result;
          }, async publicationProof(categoryId, reference) {
            return (await this.preparePublication(categoryId,reference)).plan;
          }} satisfies OperationFilesPort)} : {}),
          ...(operation.moduleId === 'creezio.modules-settings' && hostInventory ? {hostInventory} : {}),
          ...(operation.moduleId === 'creezio.conversations' && options.widgets ? {widgets:createWidgetOperationPort({
            ...options.widgets,audience:identity.audience,
            authorize(widget){if(widget.permissions.length)data.requirePermissions(lease,widget.permissions);},
            authorizeRender(render){try{return registry.resolve(render.moduleId,render.operationId).contractDigest===render.operationDigest;}
              catch{return false;}},
          })} : {}) });
        let attemptingCommit = false;
        let nativeStatements: readonly SqlStatement[] | undefined;
        let nativeCompared = false;
        try {
          const execution = Promise.resolve().then(async () => {
            ensure();
            if (operation.moduleId !== 'creezio.access') return operation.handler(input, context);
            const prepared = await nativeAccess.execute(op.id, request.credential as Extract<typeof request.credential, {kind: 'session' | 'oauth'}>, input);
            nativeStatements = prepared.nativeStatements;
            nativeCompared = prepared.compared === true;
            return {output: prepared.output};
          });
          // A late planner cannot commit anything: only this executor owns the opaque batch plans.
          const result = object(await Promise.race([execution, cancellation])) as unknown as OperationHandlerResult;
          ensure();
          if (!Object.hasOwn(result, 'output') || Object.keys(result).some(key => !['output', 'plans', 'outbox'].includes(key))) throw new OperationError('invalid_output');
          const output = copyJson(result.output, OPERATION_LIMITS.outputBytes);
          if (operation.validateOutput(output) !== true) throw new OperationError('invalid_output');
          const suppliedPlans = result.plans ?? [], plans: DataPlan[] = [];
          if (!Array.isArray(suppliedPlans) || Object.getPrototypeOf(suppliedPlans) !== Array.prototype || suppliedPlans.length > OPERATION_LIMITS.maxPlans) throw new OperationError('invalid_output');
          const descriptors = Object.getOwnPropertyDescriptors(suppliedPlans);
          if (Reflect.ownKeys(descriptors).length !== suppliedPlans.length + 1) throw new OperationError('invalid_output');
          for (let i = 0; i < suppliedPlans.length; i++) {
            const descriptor = descriptors[String(i)], token = descriptor?.value;
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !issued.has(token) || plans.includes(token)) throw new OperationError('invalid_output');
            plans.push(token);
          }
          const filePlans=[...issued].filter(([,metadata])=>metadata.file).map(([token])=>token);
          if (filePlans.length && (filePlans.some(token=>!plans.includes(token))
            || !plans.some(token=>issued.get(token)!.write && !issued.get(token)!.file))) throw new OperationError('invalid_output');
          const secretPlans=[...issued].filter(([,metadata])=>metadata.secret).map(([token])=>token);
          if(secretPlans.length && (secretPlans.some(token=>!plans.includes(token))
            || !plans.some(token=>issued.get(token)!.write && !issued.get(token)!.secret)))throw new OperationError('invalid_output');
          if (op.concurrency.mode === 'object-version' && !nativeCompared
            && !plans.some(token => issued.get(token)!.compared)) throw new OperationError('conflict');
          const outbox = copyJson(result.outbox ?? [], 65_536) as unknown as readonly OperationOutboxIntent[];
          if (!Array.isArray(outbox) || outbox.length && op.kind !== 'command'
            || outbox.some(intent => !op.effects.providers.includes(intent.provider))) throw new OperationError('invalid_output');
          ensure(); attemptingCommit = true;
          const committed = await Promise.race([store.commit(lease, start.claim, { plans, output, outbox,
            ...(nativeStatements ? {nativeStatements} : {}),
            ...(approvalStatements ? {approvalStatements} : {}) }), cancellation]);
          return Object.freeze({ execution: checkedExecution(committed, operation), replayed: false });
        } catch (error) {
          const code = errorCode(error);
          if (attemptingCommit) {
            // A lost acknowledgement does not authorize another commit or a new claim.
            // Reconcile only a terminal result actually observed before the deadline.
            try {
              const observed = await Promise.race([store.read(lease, start.execution.id), cancellation]);
              if (observed && ['succeeded', 'waiting', 'failed'].includes(observed.state))
                return Object.freeze({ execution: checkedExecution(observed, operation), replayed: false });
            } catch { /* Unknown remains unknown; status can be requested with fresh authority. */ }
            throw new OperationError('unknown');
          }
          try {
            const observed = await Promise.race([store.fail(lease, start.claim, code), cancellation]);
            return Object.freeze({ execution: checkedExecution(observed, operation), replayed: false });
          } catch {
            // If the acknowledgement or fresh authorization is lost, never report a confirmed rejection or replay the handler.
            throw new OperationError(code);
          }
        }
      } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError(errorCode(error)); }
      finally { close(); data.dispose(lease); }
    },
    async status(supplied: OperationStatusRequest): Promise<OperationExecution | null> {
      const request = capture(supplied, 'status') as OperationStatusRequest, operation = registry.resolve(request.moduleId, request.operationId);
      const lease = await authorize(request, operation);
      try { const execution = await store.read(lease, request.executionId); return execution ? checkedExecution(execution, operation) : null; }
      catch (error) { if (error instanceof OperationError) throw error; throw new OperationError(errorCode(error)); }
      finally { data.dispose(lease); }
    },
    async lookup(supplied: OperationLookupRequest): Promise<OperationExecution | null> {
      const request = capture(supplied, 'lookup') as OperationLookupRequest;
      const operation = registry.resolve(request.moduleId, request.operationId);
      if (operation.declaration.idempotency.mode !== 'required') throw new OperationError('unsupported');
      const lease = await authorize(request, operation);
      try {
        const execution = await store.lookup(lease, {operationId: operation.declaration.id, keyHash: await operationDigest(request.requestKey)});
        return execution ? checkedExecution(execution, operation) : null;
      } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError(errorCode(error)); }
      finally { data.dispose(lease); }
    },
  });
}
