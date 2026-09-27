import type { IdentityDatabase } from '../identity/d1-store.ts';
import { authorize as decide } from '../authorization/authorize.ts';
import { createDataAuthorization, freshDataGuard, type ResolvedDataAuthorization, type SqlStatement } from './authorization.ts';
import { compileDataCatalog, compileDataPlan, decodeRows, type CompiledDataPlan } from './plans.ts';
import { copyJson, keys, record, validId } from './input.ts';
import { DATA_LIMITS, DataAccessError, type DataAccess, type DataAction, type DataBatchResult, type DataCredential,
  type DataLease, type DataPlan, type DataPort, type DataRecord, type InternalDataPortOptions,
  type RuntimeDataCatalog, type AuthorizationTarget, type PermissionDefinition } from './types.ts';

interface LeaseState { readonly authorization: ResolvedDataAuthorization; readonly moduleId: string; closed: boolean }
interface PlanState { readonly lease: DataLease; readonly compiled: CompiledDataPlan; attempted: boolean }

/** Host-only bridge. It is intentionally absent from DataAccess/DataPort, and
 * cannot be obtained from a port given to a module handler. SQL is core code. */
export interface HostDataBatch {
  readonly before?: readonly SqlStatement[]; readonly plans?: readonly DataPlan[];
  readonly after?: readonly SqlStatement[]; readonly write: boolean;
}
export interface HostDataBatchResult {
  readonly before: readonly D1Result<Record<string, unknown>>[];
  readonly plans: readonly DataBatchResult[];
  readonly after: readonly D1Result<Record<string, unknown>>[];
}
export interface HostDataTransactionExecutor {
  execute(lease: DataLease, batch: HostDataBatch): Promise<HostDataBatchResult>;
}
const hostExecutors = new WeakMap<DataAccess, { readonly db: IdentityDatabase; readonly executor: HostDataTransactionExecutor }>();
export function createDataTransactionExecutor(data: DataAccess, db: IdentityDatabase): HostDataTransactionExecutor {
  const registered = hostExecutors.get(data);
  if (!registered || registered.db !== db) throw new DataAccessError('invalid_lease');
  return registered.executor;
}

/** Request-local internal service. The host injects a verified static catalogue;
 * module handlers receive only their own DataPort, never this factory, the DB,
 * an internal protected-field port or the authority to mint leases. */
export function createDataAccess(db: IdentityDatabase,
  options: { readonly catalog: RuntimeDataCatalog; readonly permissions: readonly PermissionDefinition[] }): DataAccess {
  const catalog = copyJson(options.catalog, 4 * 1024 * 1024) as unknown as RuntimeDataCatalog;
  const models = compileDataCatalog(catalog), authorization = createDataAuthorization(db, options.permissions);
  const enabledModules = new Set(catalog.modules.filter(module => module.enabled).map(module => module.moduleId));
  const leases = new WeakMap<DataLease, LeaseState>(), plans = new WeakMap<DataPlan, PlanState>();
  const getLease = (lease: DataLease) => {
    const state = lease && typeof lease === 'object' ? leases.get(lease) : undefined;
    if (!state || state.closed) throw new DataAccessError('invalid_lease');
    return state;
  };
  async function authorize(credential: DataCredential, target: AuthorizationTarget, owner: { readonly moduleId: string }): Promise<DataLease> {
    const captured = copyJson(owner); record(captured); keys(captured, ['moduleId']);
    if (!validId(captured.moduleId) || !enabledModules.has(captured.moduleId))
      throw new DataAccessError('forbidden');
    let resolved: ResolvedDataAuthorization;
    try { resolved = await authorization.resolve(credential, target); }
    catch (error) { if (error instanceof DataAccessError) throw error; throw new DataAccessError('storage_error'); }
    const lease: DataLease = Object.freeze({ kind: 'data-lease' });
    leases.set(lease, { authorization: resolved, moduleId: captured.moduleId, closed: false });
    return lease;
  }
  async function executeHost(lease: DataLease, inputs: readonly DataPlan[], write: boolean,
    before: readonly SqlStatement[] = [], after: readonly SqlStatement[] = [], host = false): Promise<HostDataBatchResult> {
    const state = getLease(lease);
    // Copy the container before awaiting. The plans themselves are opaque and immutable.
    if (!Array.isArray(inputs) || Object.getPrototypeOf(inputs) !== Array.prototype || !host && inputs.length < 1 || inputs.length > DATA_LIMITS.plans)
      throw new DataAccessError('invalid_plan');
    const descriptors = Object.getOwnPropertyDescriptors(inputs);
    if (Reflect.ownKeys(descriptors).length !== inputs.length + 1) throw new DataAccessError('invalid_plan');
    const captured: CompiledDataPlan[] = [], capturedStates: PlanState[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const descriptor = descriptors[String(i)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new DataAccessError('invalid_plan');
      const plan = descriptor.value && typeof descriptor.value === 'object' ? plans.get(descriptor.value) : undefined;
      if (!plan || plan.lease !== lease || plan.attempted || !write && plan.compiled.write || capturedStates.includes(plan)) throw new DataAccessError('invalid_plan');
      captured.push(plan.compiled); capturedStates.push(plan);
    }
    if (!host && write && !captured.some(plan => plan.write)) throw new DataAccessError('invalid_plan');
    // Capture core statements before I/O too. No caller-supplied object is read
    // again once the batch starts, including a callback's mutable bindings.
    const captureStatements = (values: readonly SqlStatement[]): readonly SqlStatement[] => {
      const copied = copyJson(values, 1_048_576);
      if (!Array.isArray(copied) || copied.length > DATA_LIMITS.statements) throw new DataAccessError('invalid_plan');
      return copied.map(value => {
        record(value); keys(value, ['sql', 'bindings']);
        if (typeof value.sql !== 'string' || !value.sql || value.sql.length > 100_000 || !Array.isArray(value.bindings)
          || value.bindings.length > DATA_LIMITS.bindings || value.bindings.some(binding => binding !== null && typeof binding !== 'string'
            && (typeof binding !== 'number' || !Number.isFinite(binding)))) throw new DataAccessError('invalid_plan');
        return value as unknown as SqlStatement;
      });
    };
    const prefix = captureStatements(before), suffix = captureStatements(after);
    const statements = [freshDataGuard(state.authorization), ...prefix, ...captured.flatMap(plan => plan.statements), ...suffix];
    if (statements.length > DATA_LIMITS.statements) throw new DataAccessError('invalid_plan');
    // No plan replay after a write attempt, including an unknown acknowledgement.
    // A multi-stage core operation may build a new plan under the same bounded
    // lease; every batch rechecks its guard, including after external I/O.
    if (write) for (const plan of capturedStates) plan.attempted = true;
    try {
      const prepared = statements.map(statement => db.prepare(statement.sql).bind(...statement.bindings));
      const results = await db.batch<Record<string, unknown>>(prepared);
      if (results.length !== statements.length || results.some(result => !result.success || !Array.isArray(result.results)))
        throw new DataAccessError('storage_error');
      let offset = 1 + prefix.length;
      const projected = captured.map(plan => {
        const result = results[offset + plan.resultIndex]; offset += plan.statements.length;
        if (!Number.isSafeInteger(result.meta.changes) || result.meta.changes < 0 || plan.write && result.meta.changes !== 1)
          throw new DataAccessError('storage_error');
        if (!plan.write && result.results.length > (plan.list ? plan.list.limit + 1 : 1)) throw new DataAccessError('storage_error');
        return Object.freeze({ rows: decodeRows(result.results, plan.fields), changes: result.meta.changes });
      });
      if (new TextEncoder().encode(JSON.stringify(projected)).length > DATA_LIMITS.resultBytes) throw new DataAccessError('storage_error');
      return Object.freeze({ before: Object.freeze(results.slice(1, 1 + prefix.length)), plans: Object.freeze(projected),
        after: Object.freeze(results.slice(offset)) });
    } catch { throw new DataAccessError('storage_error'); }
  }
  const execute = async (lease: DataLease, inputs: readonly DataPlan[], write: boolean) => (await executeHost(lease, inputs, write)).plans;
  function makePort(lease: DataLease, moduleId: string, internal?: InternalDataPortOptions): DataPort {
    const state = getLease(lease);
    if (!validId(moduleId) || moduleId !== state.moduleId) throw new DataAccessError('forbidden');
    function plan(modelId: string, action: DataAction, input: unknown, list = false): DataPlan {
      const fresh = getLease(lease);
      if (!validId(modelId) || internal && modelId !== internal.modelId) throw new DataAccessError('forbidden');
      const model = models.get(`${moduleId}:${modelId}`);
      if (!model) throw new DataAccessError('forbidden');
      if (action === 'delete' && [...models.values()].some(source => source.model.relations.some(relation =>
        relation.target.moduleId === moduleId && relation.target.kind === 'model' && relation.target.id === modelId
        && relation.onDelete !== 'restrict'))) throw new DataAccessError('unsupported');
      const compiled = compileDataPlan(model, fresh.authorization, action, input, list, internal);
      const token: DataPlan = Object.freeze({ kind: 'data-plan' });
      plans.set(token, { lease, compiled, attempted: false }); return token;
    }
    const planGet: DataPort['planGet'] = (id, input) => plan(id, 'read', input);
    const planList: DataPort['planList'] = (id, input) => plan(id, 'read', input, true);
    const planCreate: DataPort['planCreate'] = (id, input) => plan(id, 'create', input);
    const planPatch: DataPort['planPatch'] = (id, input) => plan(id, 'update', input);
    const planDelete: DataPort['planDelete'] = (id, input) => plan(id, 'delete', input);
    return Object.freeze({ planGet, planList, planCreate, planPatch, planDelete,
      get: async (id, input) => (await execute(lease, [planGet(id, input)], false))[0].rows[0] ?? null,
      list: async (id, input) => {
        const token = planList(id, input), compiled = plans.get(token)!.compiled;
        const rows = (await execute(lease, [token], false))[0].rows, limit = compiled.list!.limit;
        const items = Object.freeze(rows.slice(0, limit)), last = items.at(-1);
        const nextAfter = rows.length > limit && last ? Object.freeze(Object.fromEntries(compiled.list!.keyFields.map(key => [key, last[key]]))) as DataRecord : null;
        return Object.freeze({ items, nextAfter });
      },
      create: async (id, input) => Object.freeze({ changes: (await execute(lease, [planCreate(id, input)], true))[0].changes }),
      patch: async (id, input) => Object.freeze({ changes: (await execute(lease, [planPatch(id, input)], true))[0].changes }),
      delete: async (id, input) => Object.freeze({ changes: (await execute(lease, [planDelete(id, input)], true))[0].changes }),
    } satisfies DataPort);
  }
  const access: DataAccess = Object.freeze({ authorize, forModule: (lease, moduleId) => makePort(lease, moduleId),
    internalPort: (lease, input) => {
      const captured = copyJson(input); record(captured); keys(captured, ['moduleId','modelId','fields']);
      if (!validId(captured.moduleId) || !validId(captured.modelId) || !Array.isArray(captured.fields)
        || captured.fields.length > DATA_LIMITS.fields || captured.fields.some(field => !validId(field))
        || new Set(captured.fields).size !== captured.fields.length) throw new DataAccessError('invalid_input');
      const model = models.get(`${captured.moduleId}:${captured.modelId}`);
      if (!model || captured.fields.some(id => !model.model.fields.some(field => field.id === id && !field.computed)))
        throw new DataAccessError('invalid_input');
      return makePort(lease, captured.moduleId, captured as unknown as InternalDataPortOptions);
    },
    describeLease: lease => {
      const state = getLease(lease), a = state.authorization;
      return Object.freeze({ moduleId: state.moduleId, contextId: a.target.contextId, audience: a.target.audience,
        principalId: a.subjectPrincipalId, actorPrincipalId: a.actorPrincipalId,
        credentialKind: a.snapshot.credential.kind as DataCredential['kind'] });
    },
    requirePermissions: (lease, permissionIds) => {
      const state = getLease(lease), requested = copyJson(permissionIds);
      if (!Array.isArray(requested) || !requested.length || requested.length > 64
        || requested.some(id => typeof id !== 'string') || new Set(requested).size !== requested.length)
        throw new DataAccessError('invalid_input');
      const a = state.authorization;
      if (!decide(a.snapshot, {...a.target, requiredPermissionIds: [...new Set([
        ...a.target.requiredPermissionIds, ...requested as string[],
      ])]}, a.nowMs).allowed) throw new DataAccessError('forbidden');
    },
    readBatch: (lease, inputs) => execute(lease, inputs, false), commitBatch: (lease, inputs) => execute(lease, inputs, true),
    dispose: lease => { const state = leases.get(lease); if (state) state.closed = true; },
  } satisfies DataAccess);
  hostExecutors.set(access, { db, executor: Object.freeze({ execute: (lease: DataLease, batch: HostDataBatch) =>
    executeHost(lease, batch.plans ?? [], batch.write, batch.before ?? [], batch.after ?? [], true) }) });
  return access;
}
export { DataAccessError, DATA_LIMITS } from './types.ts';
