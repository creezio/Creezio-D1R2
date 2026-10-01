import { createDataAccess, bindHostReadGuards } from '../data/service.ts';
import { copyJson } from '../data/input.ts';
import { DataAccessError, type DataCredential, type DataLease, type DataPlan, type DataPort, type DataRecord,
  type JsonValue, type RuntimeDataCatalog, type PermissionDefinition } from '../data/types.ts';
import type { IdentityDatabase } from '../identity/d1-store.ts';
import type { AuthorizationAudience, AuthorizationActor } from '../authorization/types.ts';
import { createOperationStore } from './store.ts';
import { OperationStoreError, type OperationExecution, type OperationOutboxIntent } from './store-types.ts';
import type { OperationRegistry } from './registry.ts';
import { OperationError, OPERATION_LIMITS, type OperationContext, type OperationDataPort, type OperationHandlerResult, type RegisteredOperation, type OperationProviderAvailability } from './types.ts';
import { createNativeAccessOperationAdapter, validNativeAccessDeclaration, type NativeStorageRevocation } from './native-access.ts';
import type {StorageRouteIdentity} from '../storage-authority/target.ts';
import type {StorageMutationPort} from '../storage-authority/native-mutation.ts';
import {createNativeStorageOperationCommit} from '../storage-authority/native-operation.ts';
import type { SqlStatement } from '../data/authorization.ts';
import {captureHostInventory} from './host-inventory.ts';
import type {ModuleSettingsHostInventory} from '../../sdk/module-settings/types.ts';
import {createFileService, type FileBucket} from '../files/service.ts';
import {prepareFrozenLinks} from '../files/freeze-links.ts';
import {fileOwnerId, resolveFileCategory, type RuntimeFileCatalog} from '../files/catalog.ts';
import {FileError} from '../files/mapping.ts';
import type {OperationFilesPort} from '../../sdk/files/types.ts';
import {createProviderSecretsPort} from '../providers/secrets.ts';
import {createConnectorHost} from '../connectors/host.ts';
import type {ConnectorDescriptor} from '../../sdk/connectors/types.ts';
import {createSearchProjectionHost} from '../search/projection.ts';
import type {SearchProjectionSource} from '../../sdk/search/types.ts';
import {VaultError,type VaultKeyring} from '../vault/crypto.ts';
import type {VaultStorage} from '../vault/service.ts';
import {operationDigest} from './digest.ts';
import {createModuleQueryPort,queryTraversal,type QueryTraversal} from './intermodule.ts';
import {createWidgetOperationPort} from '../widgets/host.ts';
import {createOperationDiagnosticsPort} from './diagnostics.ts';
import type {OperationHttpBinding} from './http-types.ts';
import type {CompiledWidgetCatalog,WidgetValidatorMap} from '../../sdk/widgets/catalog.ts';
import type {WidgetApprovalService} from '../widgets/approval.ts';
import type {WebhookProofAuthority} from '../connectors/webhook-proof.ts';
import type {DeliveryMapping} from './delivery-types.ts';
import {createWorkspaceAuthorizationService,type WorkspaceAuthorizationCatalog} from '../workspace/authorization.ts';
import type {WorkspaceNavigationCatalogV1} from '../../sdk/workspace/navigation-catalog.ts';

export interface OperationRequest {
  readonly credential: DataCredential; readonly moduleId: string; readonly operationId: string;
  readonly contextId: string; readonly audience: AuthorizationAudience; readonly input: unknown; readonly signal?: AbortSignal;
  readonly approvalId?:string;
  readonly webhookProof?:object;
}
export interface OperationStatusRequest extends Omit<OperationRequest, 'input' | 'signal'> { readonly executionId: string }
export interface OperationLookupRequest extends Omit<OperationRequest, 'input' | 'signal'> { readonly requestKey: string }
export interface OperationDeliveryRequest {
  readonly credential:DataCredential;readonly moduleId:string;readonly deliveryId:string;
  readonly contextId:string;readonly audience:AuthorizationAudience;readonly executionId:string;
  readonly intentId:string;readonly signal?:AbortSignal;
}
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
    if (required.some(key => !Object.hasOwn(raw, key)) || Object.keys(raw).some(key => !required.includes(key) && (mode !== 'invoke' || !['signal','approvalId','webhookProof'].includes(key))))
      throw new Error();
    const signal = raw.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error();
    if(raw.webhookProof!==undefined&&(!raw.webhookProof||typeof raw.webhookProof!=='object'))throw new Error();
    const copied = copyJson(Object.fromEntries(required.map(key => [key, raw[key]])), OPERATION_LIMITS.inputBytes + 8192) as Record<string, JsonValue>;
    if (['moduleId', 'operationId', 'contextId', ...(mode === 'status' ? ['executionId'] : [])].some(key => typeof copied[key] !== 'string' || !copied[key])
      || !['admin', 'app'].includes(String(copied.audience))) throw new Error();
    if (mode === 'lookup' && (typeof copied.requestKey !== 'string' || !copied.requestKey
      || encoder.encode(copied.requestKey).length > 512)) throw new Error();
    if (mode === 'invoke') copyJson(copied.input, OPERATION_LIMITS.inputBytes);
    if (mode === 'invoke' && raw.approvalId !== undefined
      && (typeof raw.approvalId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.approvalId))) throw new Error();
    return Object.freeze({ ...copied, ...(signal ? { signal } : {}),
      ...(mode === 'invoke' && raw.approvalId ? {approvalId:raw.approvalId} : {}),
      ...(mode === 'invoke' && raw.webhookProof ? {webhookProof:raw.webhookProof} : {}) }) as unknown as OperationRequest | OperationStatusRequest | OperationLookupRequest;
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
  readonly authorityDb?:IdentityDatabase;readonly storageRoute?:StorageRouteIdentity;
  readonly storageMutation?:StorageMutationPort;
  readonly registry: OperationRegistry; readonly permissions: readonly PermissionDefinition[];
  readonly files?: {readonly catalog: RuntimeFileCatalog; readonly bucket: FileBucket};
  readonly providerSecrets?: {readonly storage:VaultStorage;readonly keyring:VaultKeyring;readonly providerId:string};
  readonly connectors?:readonly {readonly descriptor:ConnectorDescriptor;readonly keyring:VaultKeyring|null;
    readonly fetcher?:typeof fetch}[];
  readonly search?:readonly {readonly moduleId:string;readonly sources:readonly SearchProjectionSource[]}[];
  readonly deliveries?:readonly DeliveryMapping[];
  readonly webhooks?:Pick<WebhookProofAuthority,'consume'>;
  readonly providerAvailability?: (request: OperationRequest, providerId: string) => Promise<OperationProviderAvailability>;
  readonly runtimeInventory?: ModuleSettingsHostInventory;
  readonly workspaceCatalog?:WorkspaceAuthorizationCatalog;
  readonly workspaceNavigationCatalog?:WorkspaceNavigationCatalogV1;
  readonly approvals?:WidgetApprovalService;
  readonly httpBindings?:readonly OperationHttpBinding[];
  readonly widgets?:{readonly catalog:CompiledWidgetCatalog;readonly validators:WidgetValidatorMap} }) {
  const { registry } = options, catalog = copyJson(options.catalog, 4 * 1024 * 1024) as unknown as RuntimeDataCatalog;
  if (catalog.compositionDigest !== registry.compositionDigest) throw new OperationError('invalid_catalog');
  const hostInventory = captureHostInventory(options.runtimeInventory, registry.compositionDigest);
  const navigationCatalog=options.workspaceNavigationCatalog
    ?copyJson(options.workspaceNavigationCatalog,262_144) as unknown as WorkspaceNavigationCatalogV1:null;
  if(navigationCatalog&&(!options.workspaceCatalog||navigationCatalog.compositionDigest!==registry.compositionDigest
    ||options.workspaceCatalog.compositionDigest!==registry.compositionDigest
    ||!Array.isArray(navigationCatalog.entries)||navigationCatalog.entries.length>1000
    ||new Set(navigationCatalog.entries.map(entry=>entry.id)).size!==navigationCatalog.entries.length
    ||navigationCatalog.entries.some(entry=>!options.workspaceCatalog!.navigation.some(nav=>nav.id===entry.id
      &&nav.viewId===entry.viewId))))throw new OperationError('invalid_catalog');
  const navigationAuthorization=navigationCatalog
    ?createWorkspaceAuthorizationService(options.authorityDb??options.db,
      {catalog:options.workspaceCatalog!,permissions:options.permissions}):null;
  const data = createDataAccess(options.db, { catalog, permissions: options.permissions,
    authorityDb:options.authorityDb,storageRoute:options.storageRoute }), store = createOperationStore({ db: options.db, data });
  if((options.connectors?.length??0)>16)throw new OperationError('invalid_catalog');
  const connectors=(options.connectors??[]).map(item=>createConnectorHost({data,catalog,...item}));
  const search=(options.search??[]).map(item=>({moduleId:item.moduleId,
    host:createSearchProjectionHost({data,catalog,sources:item.sources})}));
  if(new Set(search.map(item=>item.moduleId)).size!==search.length)throw new OperationError('invalid_catalog');
  if(new Set(connectors.map(item=>`${item.descriptor.moduleId}\0${item.descriptor.id}`)).size!==connectors.length)
    throw new OperationError('invalid_catalog');
  const deliveries=options.deliveries??[];
  if(deliveries.length>16||new Set(deliveries.map(item=>`${item.moduleId}\0${item.id}`)).size!==deliveries.length)
    throw new OperationError('invalid_catalog');
  const nativeAccess = createNativeAccessOperationAdapter(options.authorityDb??options.db, options.permissions, catalog);
  const nativeStorage=options.storageMutation
    ?createNativeStorageOperationCommit(options.authorityDb??options.db,options.storageMutation):null;
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
  async function confirmedExecution(value:OperationExecution,operation:RegisteredOperation,lease:DataLease){
    const checked=checkedExecution(value,operation);
    if(!nativeStorage||operation.moduleId!=='creezio.access'
      ||operation.declaration.kind!=='command'||checked.state!=='succeeded')return checked;
    const outcome=await nativeStorage.recover(operation.declaration.id as NativeStorageRevocation['kind'],checked.id,
      ()=>store.read(lease,checked.id),result=>result.state==='succeeded');
    if(outcome.state!=='confirmed')throw new OperationError('unknown');
    return checkedExecution(outcome.value,operation);
  }
  async function invoke(supplied: OperationRequest, traversal?:QueryTraversal): Promise<{ readonly execution: OperationExecution; readonly replayed: boolean }> {
      const request = capture(supplied) as OperationRequest, operation = registry.resolve(request.moduleId, request.operationId), op = operation.declaration;
      let webhookGuards:Awaited<ReturnType<NonNullable<typeof options.webhooks>['consume']>>=null;
      if(op.actors.includes('signed-webhook')){
        if(!options.webhooks||!request.webhookProof
          ||!(webhookGuards=await options.webhooks.consume(request.webhookProof,request))
          ||webhookGuards.length<2||webhookGuards.length>4)
          throw new OperationError('forbidden');
      }else if(request.webhookProof)throw new OperationError('invalid_input');
      if (request.signal?.aborted) throw new OperationError('cancelled');
      if (operation.validateInput(request.input) !== true) throw new OperationError('invalid_input');
      // Unimplemented effects never silently execute as an ordinary mutation.
      if (op.approval.mode === 'required' && !options.approvals || op.effects.emits.length
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
          const connector=connectors.find(item=>item.descriptor.moduleId===operation.moduleId
            &&item.descriptor.id===providerId);
          const value = connector
            ? {providerId,state:await connector.availability(lease),modelIds:[]}
            : options.providerAvailability
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
        if (start.kind === 'existing') return Object.freeze({ execution: await confirmedExecution(start.execution, operation,lease), replayed: true });
        const controller = new AbortController(), issued = new Map<DataPlan, { write: boolean; compared: boolean;
          file?: boolean; secret?: boolean; connectorGuard?: boolean; webhookGuard?: boolean }>();
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
        const identity = data.describeLease(lease);
        const connector=connectors.find(item=>item.descriptor.moduleId===operation.moduleId
          &&op.effects.providers.includes(item.descriptor.id));
        const connectorCommand=!!connector&&op.kind==='command'&&op.effects.writes.length>0;
        const connectorState:{guards:readonly DataPlan[]|null;unknown:boolean;externalEffect:boolean}=
          {guards:null,unknown:false,externalEffect:false};
        let fileStatements:readonly SqlStatement[]|undefined;
        let fileClaimed=false;
        let remoteClaimed=false;
        const remoteSource=(remoteId:string)=>{
          const match=connectors.find(item=>item.descriptor.binaryDownloads?.some(policy=>
            policy.id===remoteId&&op.effects.calls.some(ref=>ref.kind==='operation'
              &&ref.moduleId===item.descriptor.moduleId
              &&ref.id===policy.proofOperationId)));
          if(!match)throw new OperationError('forbidden');
          const policy=match.descriptor.binaryDownloads!.find(item=>item.id===remoteId)!;
          const target=registry.resolve(match.descriptor.moduleId,policy.proofOperationId);
          if(!target.declaration.public||!target.declaration.audiences.includes(identity.audience))
            throw new OperationError('forbidden');
          const scope={lease,credential:request.credential,executionId:start.execution.id,
            contextId:identity.contextId,audience:identity.audience,
            actors:target.declaration.actors.filter((actor):actor is AuthorizationActor=>
              ['user','machine','delegated-user','impersonated-user'].includes(actor)),
            requiredPermissionIds:target.declaration.permissions.map(ref=>`${ref.moduleId}:${ref.id}`),
            signal:controller.signal,ensureActive:ensure};
          return {host:match,scope};
        };
        const registerConnectorGuards=(tokens:readonly DataPlan[])=>{
          ensure();
          if(!connectorCommand||connectorState.guards||!Array.isArray(tokens)||tokens.length!==2
            ||new Set(tokens).size!==2||tokens.some(token=>issued.has(token))
            ||issued.size+tokens.length>OPERATION_LIMITS.maxPlans)throw new OperationError('invalid_output');
          spend(tokens.length);
          for(const token of tokens){
            issued.set(token,{write:false,compared:false,connectorGuard:true});
          }
          connectorState.guards=Object.freeze([...tokens]);
        };
        const moduleConnectors=connectors.filter(item=>item.descriptor.moduleId===operation.moduleId
          &&op.effects.writes.some(ref=>ref.kind==='model'&&ref.moduleId===operation.moduleId
            &&ref.id===item.descriptor.vault.modelId));
        const secretConnector=moduleConnectors.length===1?moduleConnectors[0]:null;
        const secretKeyring=secretConnector?options.connectors?.find(item=>item.descriptor.moduleId===operation.moduleId
          &&item.descriptor.id===secretConnector.descriptor.id)?.keyring:null;
        const secretSource=operation.moduleId==='creezio.openai'&&options.providerSecrets
          ?options.providerSecrets
          :secretConnector&&secretKeyring
          ?{storage:secretConnector.descriptor.vault,keyring:secretKeyring,providerId:secretConnector.descriptor.id}
          :null;
        const context: OperationContext = Object.freeze({ moduleId: operation.moduleId, operationId: op.id,
          executionId: start.execution.id, contextId: identity.contextId, audience: identity.audience, principalId: identity.principalId,
          actorPrincipalId: identity.actorPrincipalId, signal: controller.signal, data: operationData,
          ...(op.effects.calls.length?{operations:createModuleQueryPort({source:operation,registry,
            traversal:traversal??queryTraversal(operation),ensureActive:ensure,spend:()=>spend(1),
            async invoke(child,next){
              const result=await invoke({credential:request.credential,moduleId:child.moduleId,
                operationId:child.operationId,input:child.input,contextId:identity.contextId,
                audience:identity.audience,signal:controller.signal},next);
              if(result.execution.state==='succeeded')return result.execution.output;
              if(result.execution.state==='unknown')throw new OperationError('unknown');
              const code=result.execution.errorCode;
              if(code&&['invalid_catalog','not_found','invalid_input','invalid_output','unsupported','approval_required',
                'unauthorized','forbidden','conflict','rate_limited','unavailable','unknown','cancelled','timeout'].includes(code))
                throw new OperationError(code as OperationError['code']);
              throw new OperationError('unavailable');
            }})}:{}),
          ...(providerAvailability ? {providerAvailability} : {}),
          ...(operation.moduleId==='creezio.analytics'
            &&(op.id==='collection.effective'||identity.audience==='admin'&&
              (op.kind==='query'&&op.id.startsWith('diagnostics.')
              ||['collection.policy','collection.effective','collection.configure',
                'refusals.list','refusals.preview','refusals.purge'].includes(op.id)))
            ?{diagnostics:createOperationDiagnosticsPort({db:options.db,
              authorityDb:options.authorityDb??options.db,data,lease,catalog,
              permissions:options.permissions,credential:request.credential,
              actors:op.actors.filter((actor):actor is AuthorizationActor=>
                ['user','machine','delegated-user','impersonated-user'].includes(actor)),
              requiredPermissionIds:op.permissions.map(ref=>`${ref.moduleId}:${ref.id}`),registry,
              httpBindings:options.httpBindings})}:{}),
          ...(secretSource && op.kind === 'command'
            && op.id.startsWith('config.key.') && secretSource.storage.moduleId === operation.moduleId
            && op.effects.writes.some(ref => ref.kind === 'model' && ref.moduleId === operation.moduleId
              && ref.id === secretSource.storage.modelId)
            ? {providerSecrets:createProviderSecretsPort({data,catalog,lease,...secretSource,
              register(token){
                ensure();if(issued.size >= OPERATION_LIMITS.maxPlans)throw new OperationError('invalid_input');
                spend(1);issued.set(token,{write:true,compared:false,secret:true});
              }})} : {}),
          ...(connector&&(op.kind==='query'||connectorCommand)&&operation.moduleId===connector.descriptor.moduleId
            &&op.effects.providers.includes(connector.descriptor.id)
            ? {connector:connector.port({lease,credential:request.credential,executionId:start.execution.id,
              contextId:identity.contextId,
              audience:identity.audience,actors:op.actors.filter((actor):actor is AuthorizationActor=>
                ['user','machine','delegated-user','impersonated-user'].includes(actor)),
              requiredPermissionIds:op.permissions.map(ref=>`${ref.moduleId}:${ref.id}`),signal:controller.signal,
              ensureActive:ensure,...(connectorCommand?{
                registerCommitGuards:registerConnectorGuards,
                markMutationAttempted(){connectorState.externalEffect=true;},
                markMutationUnknown(){connectorState.unknown=true;},
                markMutationSucceeded(){connectorState.externalEffect=true;}}:{})})}
            : {}),
          ...(search.find(item=>item.moduleId===operation.moduleId)
            ?{search:search.find(item=>item.moduleId===operation.moduleId)!.host.port({
              credential:request.credential,contextId:identity.contextId,
              audience:identity.audience,actors:op.actors.filter((actor):actor is AuthorizationActor=>
                ['user','machine','delegated-user','impersonated-user'].includes(actor)),
              ensureActive:ensure})}:{}),
          ...(options.files ? {files: Object.freeze({async stageRemote(categoryId,raw) {
            ensure();
            if(op.kind!=='command'||remoteClaimed||fileClaimed||[...issued.values()].some(item=>item.file)
              ||!raw||typeof raw!=='object'
              ||!op.effects.writes.some(ref=>ref.kind==='file'&&ref.moduleId===operation.moduleId&&ref.id===categoryId))
              throw new OperationError('forbidden');
            remoteClaimed=true;
            const captured=copyJson(raw,8192) as unknown as typeof raw;
            spend(1);
            const remote=remoteSource(captured.remoteId);
            const category=resolveFileCategory(catalog,options.files!.catalog,operation.moduleId,
              categoryId,identity.audience);
            if(!category.mimeTypes.includes(captured.expected?.contentType)
              ||!Number.isSafeInteger(captured.expected?.byteSize)
              ||captured.expected.byteSize<0||captured.expected.byteSize>category.maxBytes)
              throw new OperationError('invalid_input');
            const ownerId=await fileOwnerId(identity.principalId,identity.audience,category.ownerScope);
            const bytes=await remote.host.downloadBinary(remote.scope,captured);
            ensure();
            const service=createFileService({data,catalog,moduleId:operation.moduleId,category,
              bucket:options.files!.bucket,ownerId});
            const ref=await service.stage(lease,{ownerId,intentId:captured.intentId,
              generation:captured.generation,filename:captured.expected.filename,
              contentType:captured.expected.contentType,bytes});
            ensure();
            const guard=await remote.host.sourceGuard(remote.scope,captured);
            fileStatements=Object.freeze([{sql:`SELECT CASE WHEN (${guard.condition}) THEN 1
              ELSE json('creezio_file_source_conflict') END AS accepted`,bindings:[...guard.bindings]}]);
            return Object.freeze({ref,file:Object.freeze({...captured.expected})});
          },async prepareBatchPublication(categoryId,raw) {
            ensure();
            if(op.kind!=='command'||fileClaimed||remoteClaimed||[...issued.values()].some(item=>item.file)
              ||!raw||typeof raw!=='object'
              ||!op.effects.writes.some(ref=>ref.kind==='file'&&ref.moduleId===operation.moduleId&&ref.id===categoryId)
              ||!op.effects.reads.some(ref=>ref.kind==='model'&&ref.moduleId===operation.moduleId&&ref.id===raw.sourceModel)
              ||!op.effects.writes.some(ref=>ref.kind==='model'&&ref.moduleId===operation.moduleId&&ref.id===raw.destinationModel))
              throw new OperationError('forbidden');
            fileClaimed=true;
            const captured=copyJson(raw,60_000) as unknown as typeof raw;
            spend(1);
            const remote=remoteSource(captured.remoteId);
            const category=resolveFileCategory(catalog,options.files!.catalog,operation.moduleId,
              categoryId,identity.audience);
            const connectionGuard=await remote.host.sourceGuard(remote.scope,captured);
            const statements=await prepareFrozenLinks({data,catalog,lease,moduleId:operation.moduleId,
              category,bucket:options.files!.bucket,input:captured,publishStaged:true,connectionGuard});
            ensure();
            fileStatements=statements;
          },async freezeLinks(categoryId,raw) {
            ensure();
            if(op.kind!=='command'||fileClaimed||remoteClaimed||[...issued.values()].some(item=>item.file)
              ||!raw||typeof raw!=='object'
              ||!op.effects.writes.some(ref=>ref.kind==='file'&&ref.moduleId===operation.moduleId&&ref.id===categoryId)
              ||!op.effects.reads.some(ref=>ref.kind==='model'&&ref.moduleId===operation.moduleId&&ref.id===raw.sourceModel)
              ||!op.effects.writes.some(ref=>ref.kind==='model'&&ref.moduleId===operation.moduleId&&ref.id===raw.destinationModel))
              throw new OperationError('forbidden');
            fileClaimed=true;
            const captured=copyJson(raw,60_000) as unknown as typeof raw;
            spend(1);
            const category=resolveFileCategory(catalog,options.files!.catalog,operation.moduleId,
              categoryId,identity.audience);
            const statements=await prepareFrozenLinks({data,catalog,lease,moduleId:operation.moduleId,
              category,bucket:options.files!.bucket,input:captured});
            ensure();fileStatements=statements;
          },async preparePublication(categoryId, reference) {
            ensure();
            if (op.kind !== 'command' || fileClaimed || remoteClaimed
              || !op.effects.writes.some(ref => ref.moduleId === operation.moduleId && ref.kind === 'file' && ref.id === categoryId))
              throw new OperationError('forbidden');
            // Charge work before I/O, then recheck the plan budget after concurrent completions.
            spend(1);
            if (issued.size >= OPERATION_LIMITS.maxPlans) throw new OperationError('invalid_input');
            const category = resolveFileCategory(catalog, options.files!.catalog, operation.moduleId, categoryId, identity.audience);
            const service = createFileService({data, catalog, moduleId: operation.moduleId, category,
              bucket: options.files!.bucket, ownerId: await fileOwnerId(identity.principalId, identity.audience, category.ownerScope)});
            const result = await service.preparePublication(lease, reference), token=result.plan;
            ensure();
            if (issued.size >= OPERATION_LIMITS.maxPlans) throw new OperationError('invalid_input');
            issued.set(token, {write: true, compared: false, file: true});
            return result;
          }, async publicationProof(categoryId, reference) {
            return (await this.preparePublication(categoryId,reference)).plan;
          }} satisfies OperationFilesPort)} : {}),
          ...(operation.moduleId === 'creezio.modules-settings' && hostInventory ? {hostInventory} : {}),
          ...(operation.moduleId==='creezio.pages-navigation'&&navigationCatalog ? {workspaceNavigation:Object.freeze({
            async read(){
              ensure();
              const identity=data.describeLease(lease);
              let sessionId:string|null=null,epoch:number|null=null,visible:Set<string>|null=null;
              if(request.credential.kind==='session'){
                const checked=await navigationAuthorization!.read(request.credential.token,
                  identity.audience,identity.contextId);
                if(!checked.ok||checked.projection.principalId!==identity.principalId)
                  throw new OperationError('forbidden');
                sessionId=checked.projection.sessionId;epoch=checked.projection.epoch;
                visible=new Set(checked.projection.navigationIds);
              }
              ensure();
              const entries=navigationCatalog.entries.filter(entry=>entry.audiences.includes(identity.audience))
                .map(entry=>{
                  let available=visible===null||visible.has(entry.id);
                  if(available&&entry.permissionIds.length){
                    try{data.requirePermissions(lease,entry.permissionIds);}catch{available=false;}
                  }
                  return {...entry,available};
                });
              return Object.freeze({compositionDigest:navigationCatalog.compositionDigest,
                contextId:identity.contextId,audience:identity.audience,sessionId,epoch,
                entries:Object.freeze(entries)});
            }} )}:{}),
          ...(operation.moduleId === 'creezio.conversations' && options.widgets ? {widgets:createWidgetOperationPort({
            ...options.widgets,audience:identity.audience,
            authorize(widget){if(widget.permissions.length)data.requirePermissions(lease,widget.permissions);},
            authorizeRender(render){try{return registry.resolve(render.moduleId,render.operationId).contractDigest===render.operationDigest;}
              catch{return false;}},
            async readHistoricalRender(render){
              let source:DataLease|undefined;
              try {
                const current=registry.resolve(render.moduleId,render.operationId);
                if(current.declaration.kind!=='query')return null;
                source=await authorize({...request,moduleId:render.moduleId,operationId:render.operationId},current);
                const execution=await store.read(source,render.executionId);
                return execution?.state==='succeeded'&&execution.moduleId===render.moduleId
                  &&execution.operationId===render.operationId&&execution.operationVersion===render.operationDigest
                  &&current.validateOutput(execution.output)===true?{output:execution.output}:null;
              }catch{return null;}
              finally{if(source)data.dispose(source);}
            },
          })} : {}) });
        let attemptingCommit = false;
        let nativeStatements: readonly SqlStatement[] | undefined;
        let nativeRevocation:NativeStorageRevocation|undefined;
        let sourceReceipt:OperationExecution|undefined;
        let nativeCompared = false;
        try {
          const privateWebhookGuards=(webhookGuards??[]).map(guard=>{
            if(guard.moduleId!==operation.moduleId||!catalog.modules.some(module=>
              module.moduleId===guard.moduleId&&module.enabled&&module.models.some(model=>
                model.modelId===guard.modelId)))throw new OperationError('forbidden');
            const vaultGuard=connectors.some(item=>item.descriptor.moduleId===guard.moduleId
              &&item.descriptor.webhook?.operationId===op.id
              &&item.descriptor.vault.modelId===guard.modelId);
            const token=data.internalPort(lease,{moduleId:guard.moduleId,
              modelId:guard.modelId,fields:guard.fields,...(vaultGuard?{guardOnly:true}:{})}).planGet(guard.modelId,
              {key:guard.key,where:guard.where,required:true});
            issued.set(token,{write:false,compared:false,webhookGuard:true});
            return token;
          });
          const execution = Promise.resolve().then(async () => {
            ensure();
            if (operation.moduleId !== 'creezio.access') return operation.handler(input, context);
            const auditId=nativeStorage&&op.kind==='command'
              ?await nativeStorage.auditId(op.id as NativeStorageRevocation['kind'],start.execution.id):undefined;
            const prepared = await nativeAccess.execute(op.id, request.credential as Extract<typeof request.credential, {kind: 'session' | 'oauth'}>, input,auditId);
            nativeStatements = prepared.nativeStatements;
            nativeRevocation=prepared.storageRevocation;
            nativeCompared = prepared.compared === true;
            return {output: prepared.output};
          });
          // A late planner cannot commit anything: only this executor owns the opaque batch plans.
          const result = object(await Promise.race([execution, cancellation])) as unknown as OperationHandlerResult;
          ensure();
          if(connectorState.unknown)throw new OperationError('unknown');
          if (!Object.hasOwn(result, 'output') || Object.keys(result).some(key => !['output', 'plans', 'outbox'].includes(key))) throw new OperationError('invalid_output');
          const output = copyJson(result.output, OPERATION_LIMITS.outputBytes);
          if (operation.validateOutput(output) !== true) throw new OperationError('invalid_output');
          const suppliedPlans = result.plans ?? [], plans: DataPlan[] = [];
          if (!Array.isArray(suppliedPlans) || Object.getPrototypeOf(suppliedPlans) !== Array.prototype || suppliedPlans.length > OPERATION_LIMITS.maxPlans) throw new OperationError('invalid_output');
          const descriptors = Object.getOwnPropertyDescriptors(suppliedPlans);
          if (Reflect.ownKeys(descriptors).length !== suppliedPlans.length + 1) throw new OperationError('invalid_output');
          for (let i = 0; i < suppliedPlans.length; i++) {
            const descriptor = descriptors[String(i)], token = descriptor?.value;
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !issued.has(token)
              || issued.get(token)?.connectorGuard || issued.get(token)?.webhookGuard
              || plans.includes(token)) throw new OperationError('invalid_output');
            plans.push(token);
          }
          if(connectorCommand){
            if(!connectorState.guards||!plans.some(token=>issued.get(token)?.write))throw new OperationError('invalid_output');
            plans.unshift(...connectorState.guards);
          }
          if(privateWebhookGuards.length)plans.unshift(...privateWebhookGuards);
          const filePlans=[...issued].filter(([,metadata])=>metadata.file).map(([token])=>token);
          if (filePlans.length && (filePlans.some(token=>!plans.includes(token))
            || !plans.some(token=>issued.get(token)!.write && !issued.get(token)!.file))) throw new OperationError('invalid_output');
          if(fileStatements&&!plans.some(token=>issued.get(token)!.write))throw new OperationError('invalid_output');
          const secretPlans=[...issued].filter(([,metadata])=>metadata.secret).map(([token])=>token);
          if(secretPlans.length && (secretPlans.some(token=>!plans.includes(token))
            || !plans.some(token=>issued.get(token)!.write && !issued.get(token)!.secret)))throw new OperationError('invalid_output');
          if (op.concurrency.mode === 'object-version' && !nativeCompared
            && !plans.some(token => issued.get(token)!.compared)) throw new OperationError('conflict');
          const outbox = copyJson(result.outbox ?? [], 65_536) as unknown as readonly OperationOutboxIntent[];
          if (!Array.isArray(outbox) || outbox.length && (op.kind !== 'command'||connectorCommand)
            || outbox.some(intent => !op.effects.providers.includes(intent.provider))) throw new OperationError('invalid_output');
          ensure(); attemptingCommit = true;
          const sourceCommit=async()=>{
            ensure();
            sourceReceipt=await store.commit(lease,start.claim,{plans,output,outbox,
              ...(nativeStatements?{nativeStatements}:{}),...(approvalStatements?{approvalStatements}:{}),
              ...(fileStatements?{fileStatements}:{})});
            return sourceReceipt;
          };
          const commit=async()=>{
            if(!nativeStorage||!nativeRevocation)return sourceCommit();
            const outcome=await nativeStorage.commit({descriptor:nativeRevocation,executionId:start.execution.id,
              sourceCommit,
              // The exact source batch receipt remains valid when that batch revokes its own session/epoch.
              // Later requests have no cached receipt and must use fresh native authorization.
              readExecution:async()=>sourceReceipt??await store.read(lease,start.execution.id),
              succeeded:value=>value.state==='succeeded'});
            if(outcome.state!=='confirmed')throw new OperationError('unknown');
            return outcome.value;
          };
          const committed = await Promise.race([commit(), cancellation]);
          return Object.freeze({ execution: checkedExecution(committed, operation), replayed: false });
        } catch (error) {
          const code = errorCode(error);
          if (attemptingCommit) {
            // A lost acknowledgement does not authorize another commit or a new claim.
            // Reconcile only a terminal result actually observed before the deadline.
            try {
              const observed = await Promise.race([store.read(lease, start.execution.id), cancellation]);
              if (observed && ['succeeded', 'waiting', 'failed'].includes(observed.state))
                return Object.freeze({ execution: await confirmedExecution(observed, operation,lease), replayed: false });
            } catch { /* Unknown remains unknown; status can be requested with fresh authority. */ }
            throw new OperationError('unknown');
          }
          try {
            const observed = connectorState.unknown||connectorState.externalEffect
              ?await store.markUnknown(lease,start.claim,code)
              :await Promise.race([store.fail(lease,start.claim,code),cancellation]);
            return Object.freeze({ execution: checkedExecution(observed, operation), replayed: false });
          } catch {
            // If the acknowledgement or fresh authorization is lost, never report a confirmed rejection or replay the handler.
            throw new OperationError(connectorState.unknown||connectorState.externalEffect?'unknown':code);
          }
        }
      } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError(errorCode(error)); }
      finally { close(); data.dispose(lease); }
    }
  function deliveryRequest(supplied:OperationDeliveryRequest):OperationDeliveryRequest{
    const raw=object(supplied);
    const names=['credential','moduleId','deliveryId','contextId','audience','executionId','intentId'];
    if(names.some(name=>!Object.hasOwn(raw,name))||Object.keys(raw).some(name=>
      !names.includes(name)&&name!=='signal')||raw.signal!==undefined&&!(raw.signal instanceof AbortSignal))
      throw new OperationError('invalid_input');
    let captured:OperationDeliveryRequest;
    try{captured=copyJson(Object.fromEntries(names.map(name=>[name,raw[name]])),8192) as unknown as OperationDeliveryRequest;}
    catch{throw new OperationError('invalid_input');}
    for(const name of ['moduleId','deliveryId','contextId','executionId','intentId'] as const)
      if(typeof captured[name]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(captured[name]))
        throw new OperationError('invalid_input');
    if(!['admin','app'].includes(captured.audience))throw new OperationError('invalid_input');
    return Object.freeze({...captured,...(raw.signal?{signal:raw.signal as AbortSignal}:{})});
  }
  async function deliveryAction(supplied:OperationDeliveryRequest,send:boolean){
    const request=deliveryRequest(supplied);
    const mapping=deliveries.find(item=>item.moduleId===request.moduleId&&item.id===request.deliveryId);
    if(!mapping)throw new OperationError('unsupported');
    const source=registry.resolve(mapping.moduleId,mapping.commandId);
    if(source.declaration.kind!=='command')throw new OperationError('invalid_catalog');
    const operationRequest={credential:request.credential,moduleId:mapping.moduleId,
      operationId:mapping.commandId,contextId:request.contextId,audience:request.audience,
      executionId:request.executionId};
    const lease=await authorize(operationRequest,source);
    try{
      const execution=await store.read(lease,request.executionId);
      if(!execution)throw new OperationError('not_found');
      checkedExecution(execution,source);
      const prior=await store.readDelivery(lease,{executionId:request.executionId,outboxId:request.intentId});
      if(!prior)throw new OperationError('not_found');
      if(prior.provider!==mapping.connectorId||prior.providerIdempotencyKey!==request.intentId)
        throw new OperationError('conflict');
      if(!send||prior.state!=='queued')return Object.freeze({delivery:prior,replayed:true});
      if(!prior.payload||typeof prior.payload!=='object'||Array.isArray(prior.payload))
        throw new OperationError('invalid_output');
      if(request.signal?.aborted)throw new OperationError('cancelled');
      const acquired=await store.claimDelivery(lease,{executionId:request.executionId,
        outboxId:request.intentId,claimTtlMs:30_000});
      if(!acquired){
        const current=await store.readDelivery(lease,{executionId:request.executionId,outboxId:request.intentId});
        if(!current)throw new OperationError('not_found');
        return Object.freeze({delivery:current,replayed:true});
      }
      const {claim,delivery}=acquired;
      const payload=delivery.payload;
      const fields=payload as Record<string,JsonValue>,identity=data.describeLease(lease);
      const ownerPort=data.forModule(lease,mapping.moduleId);
      const permitted=new Set(mapping.modelIds),issued=new Set<DataPlan>();
      const allowed=(id:string)=>{if(!permitted.has(id))throw new OperationError('forbidden');
        if(request.signal?.aborted)throw new OperationError('cancelled');};
      const projectedData:OperationDataPort=Object.freeze({
        get(id,args){allowed(id);return ownerPort.get(id,args);},
        list(id,args){allowed(id);return ownerPort.list(id,args);},
        planGet(id,args){allowed(id);const token=ownerPort.planGet(id,args);issued.add(token);return token;},
        planList(id,args){allowed(id);const token=ownerPort.planList(id,args);issued.add(token);return token;},
        planCreate(id,args){allowed(id);const token=ownerPort.planCreate(id,args);issued.add(token);return token;},
        planPatch(id,args){allowed(id);const token=ownerPort.planPatch(id,args);issued.add(token);return token;},
        planDelete(id,args){allowed(id);const token=ownerPort.planDelete(id,args);issued.add(token);return token;},
      });
      const project=async(receipt:JsonValue)=>{
        if(mapping.validateReceipt(receipt)!==true)throw new OperationError('invalid_output');
        const input:Record<string,JsonValue>=Object.create(null);
        for(const [target,sourceField] of Object.entries(mapping.projectorInput)){
          const value=sourceField==='$intentId'?request.intentId:sourceField==='$receipt'?receipt:fields[sourceField];
          if(value===undefined)throw new OperationError('invalid_output');
          input[target]=value;
        }
        const result=await mapping.projector(input,{principalId:identity.principalId,data:projectedData,
          receivedAt:new Date().toISOString()});
        if(!Array.isArray(result)||result.length>12||new Set(result).size!==result.length
          ||result.some(token=>!issued.has(token)))throw new OperationError('invalid_output');
        return result;
      };
      const settle=async(kind:'accepted'|'rejected'|'unknown',providerMessageId?:string,
        guards:readonly DataPlan[]=[])=>{
        const receipt=copyJson({kind,...(providerMessageId?{[mapping.acceptance.receiptIdField]:providerMessageId}:{})},16_384);
        const plans=await project(receipt);
        if(guards.length+plans.length>16)throw new OperationError('invalid_output');
        return store.settleDelivery(lease,claim,{state:kind==='accepted'?'succeeded':kind==='rejected'?'failed':'unknown',receipt},
          [...guards,...plans]);
      };
      let uncertain=false,providerGuards:readonly DataPlan[]|null=null;
      let providerLease:DataLease|null=null;
      try{
        const prepareInput:Record<string,JsonValue>=Object.create(null);
        for(const [target,sourceField] of Object.entries(mapping.prepareInput)){
          const value=sourceField==='$intentId'?request.intentId:fields[sourceField];
          if(value===undefined)throw new OperationError('invalid_output');
          prepareInput[target]=value;
        }
        const prepared=await invoke({credential:request.credential,moduleId:mapping.moduleId,
          operationId:mapping.prepareId,contextId:request.contextId,audience:request.audience,
          input:prepareInput,signal:request.signal});
        if(prepared.execution.state!=='succeeded')throw new OperationError('unavailable');
        const output=prepared.execution.output;
        if(!output||typeof output!=='object'||Array.isArray(output))throw new OperationError('invalid_output');
        const ready=output as Record<string,JsonValue>;
        if(mapping.matchFields.some(field=>JSON.stringify(ready[field])!==JSON.stringify(fields[field]))
          ||ready.intentId!==request.intentId)throw new OperationError('conflict');
        const expectedConfigRevision=ready[mapping.configRevisionField];
        if(typeof expectedConfigRevision!=='number'||!Number.isSafeInteger(expectedConfigRevision)
          ||expectedConfigRevision<1)throw new OperationError('invalid_output');
        if(fields[mapping.configRevisionField]!==expectedConfigRevision)
          throw new OperationError('conflict');
        const envelope=ready[mapping.envelopeField];
        if(!envelope||typeof envelope!=='object'||Array.isArray(envelope))throw new OperationError('invalid_output');
        const outbound=envelope as Record<string,JsonValue>;
        const declared=outbound.attachments??[];
        if(!Array.isArray(declared)||declared.length>50)throw new OperationError('invalid_output');
        const binary: {filename:string;contentType:string;bytes:Uint8Array}[]=[];
        if(declared.length){
          if(!options.files||mapping.resourceId!=='email.send')throw new OperationError('invalid_catalog');
          const category=resolveFileCategory(catalog,options.files.catalog,mapping.moduleId,
            'attachments',identity.audience);
          const fileService=createFileService({data,catalog,moduleId:mapping.moduleId,category,
            bucket:options.files.bucket,
            ownerId:await fileOwnerId(identity.principalId,identity.audience,category.ownerScope)});
          let total=0;
          for(const item of declared){
            if(!item||typeof item!=='object'||Array.isArray(item))throw new OperationError('invalid_output');
            const entry=item as Record<string,JsonValue>;
            if(typeof entry.fileId!=='string'||typeof entry.intentId!=='string'
              ||typeof entry.generation!=='string'||typeof entry.digest!=='string'
              ||typeof entry.filename!=='string'||typeof entry.contentType!=='string'
              ||!Number.isSafeInteger(entry.byteSize))throw new OperationError('invalid_output');
            const file=await fileService.readPrivate(lease,{fileId:entry.fileId,
              intentId:entry.intentId,generation:entry.generation,digest:entry.digest});
            if(file.filename!==entry.filename||file.contentType!==entry.contentType
              ||file.byteSize!==entry.byteSize||(total+=file.byteSize)>10*1024*1024)
              throw new OperationError('conflict');
            binary.push({filename:file.filename,contentType:file.contentType,bytes:file.bytes});
          }
        }
        const {attachments:_references,...wireEnvelope}=outbound;
        const connector=connectors.find(item=>item.descriptor.moduleId===mapping.providerModuleId
          &&item.descriptor.id===mapping.connectorId);
        const readiness=registry.resolve(mapping.providerModuleId,mapping.readinessId);
        if(!connector||readiness.declaration.kind!=='query'||!connector.descriptor.resources.some(item=>
          item.id===mapping.resourceId&&item.method!=='GET'&&item.idempotencyHeader))
          throw new OperationError('invalid_catalog');
        const refresh=async()=>{
          const fresh=await authorize(operationRequest,source);
          try{const current=data.describeLease(fresh);
            if(current.principalId!==identity.principalId||current.actorPrincipalId!==identity.actorPrincipalId
              ||current.contextId!==identity.contextId||current.audience!==identity.audience)
              throw new OperationError('forbidden');}
          finally{data.dispose(fresh);}
        };
        await refresh();
        providerLease=await authorize({...operationRequest,moduleId:mapping.providerModuleId,
          operationId:mapping.readinessId},readiness);
        const providerIdentity=data.describeLease(providerLease);
        if(providerIdentity.principalId!==identity.principalId
          ||providerIdentity.actorPrincipalId!==identity.actorPrincipalId
          ||providerIdentity.contextId!==identity.contextId||providerIdentity.audience!==identity.audience)
          throw new OperationError('forbidden');
        const result=await connector.port({lease:providerLease,credential:request.credential,
          contextId:request.contextId,audience:request.audience,
          actors:readiness.declaration.actors.filter((actor):actor is AuthorizationActor=>
            ['user','machine','delegated-user','impersonated-user'].includes(actor)),
          requiredPermissionIds:readiness.declaration.permissions.map(ref=>`${ref.moduleId}:${ref.id}`),
          signal:request.signal??new AbortController().signal,executionId:request.intentId,
          expectedConfigRevision,
          ensureActive(){if(request.signal?.aborted)throw new OperationError('cancelled');},
          markMutationUnknown(){uncertain=true;},
          registerCommitGuards(tokens){if(providerGuards||tokens.length!==2||new Set(tokens).size!==2)
            throw new OperationError('invalid_output');providerGuards=tokens;},
        }).mutate({resource:mapping.resourceId,fields:wireEnvelope,attachments:binary});
        if(result.kind==='ok'){
          const body=result.body;
          const id=body&&typeof body==='object'&&!Array.isArray(body)
            ?(body as Record<string,JsonValue>)[mapping.acceptance.responseIdField]:null;
          if(typeof id!=='string'||!id||id.length>256||!providerGuards)throw new OperationError('unknown');
          await refresh();
          const guards=bindHostReadGuards(data,providerLease,lease,providerGuards);
          try{return Object.freeze({delivery:await settle('accepted',id,guards),replayed:false});}
          catch(error){
            const observed=await store.readDelivery(lease,{executionId:request.executionId,outboxId:request.intentId});
            if(observed?.state==='succeeded')return Object.freeze({delivery:observed,replayed:false});
            throw error;
          }
        }
        if(result.code==='outcome_unknown'||uncertain)throw new OperationError('unknown');
        return Object.freeze({delivery:await settle('rejected'),replayed:false});
      }catch{
        try{return Object.freeze({delivery:await settle('unknown'),replayed:false});}
        catch{
          const current=await store.readDelivery(lease,{executionId:request.executionId,outboxId:request.intentId});
          if(current?.state==='succeeded')return Object.freeze({delivery:current,replayed:false});
          throw new OperationError('unknown');
        }
      }finally{if(providerLease)data.dispose(providerLease);}
    }finally{data.dispose(lease);}
  }
  return Object.freeze({
    async invoke(supplied:OperationRequest){
      const result=await invoke(supplied);
      const mapping=deliveries.find(item=>item.moduleId===result.execution.moduleId
        &&item.commandId===result.execution.operationId);
      if(result.execution.state!=='waiting'||!mapping)return result;
      const request=capture(supplied) as OperationRequest;
      try{await deliveryAction({credential:request.credential,moduleId:mapping.moduleId,
        deliveryId:mapping.id,contextId:request.contextId,audience:request.audience,
        executionId:result.execution.id,intentId:result.execution.id,signal:request.signal},true);}
      catch{/* The committed intent remains inspectable and is never re-emitted by this catch. */}
      const source=registry.resolve(mapping.moduleId,mapping.commandId);
      const lease=await authorize({...request,executionId:result.execution.id},source);
      try{
        const current=await store.read(lease,result.execution.id);
        return Object.freeze({execution:current?checkedExecution(current,source):result.execution,
          replayed:result.replayed});
      }finally{data.dispose(lease);}
    },
    deliver(supplied:OperationDeliveryRequest){return deliveryAction(supplied,true);},
    deliveryStatus(supplied:OperationDeliveryRequest){return deliveryAction(supplied,false);},
    async status(supplied: OperationStatusRequest): Promise<OperationExecution | null> {
      const request = capture(supplied, 'status') as OperationStatusRequest, operation = registry.resolve(request.moduleId, request.operationId);
      const lease = await authorize(request, operation);
      try { const execution = await store.read(lease, request.executionId); return execution ? await confirmedExecution(execution, operation,lease) : null; }
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
        return execution ? await confirmedExecution(execution, operation,lease) : null;
      } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError(errorCode(error)); }
      finally { data.dispose(lease); }
    },
  });
}
