import type {OperationClient, OperationClientResult} from '../operations/client.ts';
import type {ModuleIntent, ModuleReadResult, ModuleCatalogPage, ModuleCatalogItem, ModuleDetail,
  ModuleDiagnostic, ModuleDependency, ModulePlanAction, ModulePlanPreview, ModulePlanAcceptance,
  ModuleAcceptedPlan, ModuleJournalEntry, ModulePlanRead, ModuleJournalPage, ModuleAcceptOutcome} from './types.ts';

export const MODULE_SETTINGS_BINDINGS = Object.freeze({
  catalogList: 'creezio.modules-settings:catalog.list',
  catalogDetail: 'creezio.modules-settings:catalog.detail',
  plansPreview: 'creezio.modules-settings:plans.preview',
  plansAccept: 'creezio.modules-settings:plans.accept',
  plansRead: 'creezio.modules-settings:plans.read',
  journalList: 'creezio.modules-settings:journal.list',
});
const id = (value: unknown): value is string => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown, max = 2048): value is string => typeof value === 'string'
  && value.length <= max * 2 && value.isWellFormed() && [...value].length <= max;
const row = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const array = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;
const nonempty = (value: unknown): value is string => text(value) && value.length > 0;
const catalogTitle = (value: unknown): value is string => text(value, 4000) && value.length > 0;
const fail = <T>(error: string): ModuleReadResult<T> => ({ok: false, error});
const ok = <T>(value: T): ModuleReadResult<T> => ({ok: true, value});

function diagnostic(value: unknown): value is ModuleDiagnostic {
  return row(value) && id(value.code) && ['error','warning','info'].includes(String(value.severity))
    && (value.moduleId === null || id(value.moduleId)) && text(value.message, 4096)
    && value.message.length > 0;
}
function item(value: unknown): value is ModuleCatalogItem {
  return row(value) && id(value.moduleId) && catalogTitle(value.title) && text(value.description, 4096)
    && nonempty(value.origin) && text(value.version, 128) && value.version.length > 0
    && (value.candidateKey === null || id(value.candidateKey))
    && typeof value.codePresent === 'boolean' && typeof value.enabled === 'boolean'
    && ['ready','missing','unknown'].includes(String(value.configuration))
    && ['ready','unavailable','unknown'].includes(String(value.operational))
    && ['current','available'].includes(String(value.visibility));
}
function dependency(value: unknown): value is ModuleDependency {
  return row(value) && id(value.moduleId) && typeof value.required === 'boolean'
    && typeof value.active === 'boolean' && text(value.versionRange, 128) && value.versionRange.length > 0
    && array(value.via, 256) && value.via.every(id);
}
function planAction(value: unknown): value is ModulePlanAction {
  return row(value) && ['add','update','enable','disable','remove','configure','integration'].includes(String(value.kind))
    && id(value.moduleId) && (value.fromVersion === null || nonempty(value.fromVersion))
    && (value.toVersion === null || nonempty(value.toVersion))
    && (value.audiences === undefined || array(value.audiences, 2)
      && value.audiences.every(audience => audience === 'admin' || audience === 'app')
      && new Set(value.audiences).size === value.audiences.length)
    && (!['add','enable'].includes(String(value.kind)) || Array.isArray(value.audiences))
    && (['add','enable'].includes(String(value.kind)) || value.audiences === undefined)
    && typeof value.requiresPublication === 'boolean';
}
function catalogPage(value: unknown): value is ModuleCatalogPage {
  return row(value) && array(value.items, 51) && value.items.every(item)
    && (value.nextAfterId === null || id(value.nextAfterId)) && digest(value.compositionDigest)
    && digest(value.lockDigest) && digest(value.inventoryDigest) && integer(value.revision);
}
function detail(value: unknown): value is ModuleDetail {
  return row(value) && item(value.module) && array(value.dependsOn, 256) && value.dependsOn.every(dependency)
    && array(value.usedBy, 256) && value.usedBy.every(dependency)
    && array(value.optionalIntegrations, 256) && value.optionalIntegrations.every(dependency)
    && array(value.diagnostics, 128) && value.diagnostics.every(diagnostic);
}
function preview(value: unknown): value is ModulePlanPreview {
  return row(value) && digest(value.planDigest) && integer(value.baseRevision)
    && digest(value.baseCompositionDigest) && digest(value.targetCompositionDigest)
    && digest(value.targetLockDigest) && array(value.actions, 256) && value.actions.every(planAction)
    && array(value.diagnostics, 128) && value.diagnostics.every(diagnostic)
    && integer(value.disabledContributionCount)
    && typeof value.requiresPublication === 'boolean';
}
function acceptance(value: unknown): value is ModulePlanAcceptance {
  return row(value) && id(value.planId) && integer(value.revision) && value.revision > 0
    && value.status === 'accepted_pending_publication' && digest(value.planDigest);
}
function summary(value: unknown): boolean {
  return row(value) && ['ready','blocked'].includes(String(value.status))
    && array(value.changes, 32) && value.changes.every(change => row(change) && id(change.moduleId) && id(change.action))
    && array(value.dependencyOrder, 1000) && value.dependencyOrder.every(id)
    && integer(value.disabledContributionCount) && integer(value.diagnosticCount)
    && typeof value.detailsPaged === 'boolean';
}
function acceptedPlan(value: unknown): value is ModuleAcceptedPlan {
  return row(value) && id(value.id) && integer(value.revision) && value.revision > 0
    && digest(value.planDigest) && digest(value.inventoryDigest) && digest(value.baseCompositionDigest)
    && digest(value.baseLockDigest) && digest(value.targetCompositionDigest) && digest(value.targetLockDigest)
    && summary(value.summary) && id(value.acceptedByPrincipalId) && integer(value.acceptedAtMs)
    && typeof value.requiresPublication === 'boolean';
}
function journalEntry(value: unknown): value is ModuleJournalEntry {
  return row(value) && integer(value.revision) && value.revision > 0 && id(value.planId)
    && digest(value.planDigest) && id(value.actorPrincipalId)
    && digest(value.baseCompositionDigest) && digest(value.targetCompositionDigest)
    && integer(value.occurredAtMs) && value.eventKind === 'plan-accepted';
}
function planRead(value: unknown): value is ModulePlanRead {
  return row(value) && acceptedPlan(value.plan) && array(value.events, 50)
    && value.events.every(journalEntry) && ['accepted_pending_publication','effective'].includes(String(value.status));
}
function journalPage(value: unknown): value is ModuleJournalPage {
  return row(value) && array(value.items, 51) && value.items.every(journalEntry)
    && (value.nextAfterRevision === null || integer(value.nextAfterRevision));
}
function readResult<T>(result: OperationClientResult, valid: (value: unknown) => value is T): ModuleReadResult<T> {
  if (result.kind === 'rejected') return fail(result.code);
  if (result.kind === 'unknown') return fail(result.code);
  if (result.execution.state !== 'succeeded') return fail(result.execution.errorCode ?? 'unavailable');
  return valid(result.execution.output) ? ok(result.execution.output) : fail('invalid_response');
}
function commandResult(result: OperationClientResult, requestKey: string): ModuleAcceptOutcome {
  if (result.kind === 'unknown') return {kind: 'unknown', code: result.code, requestKey};
  if (result.kind === 'rejected') return {kind: 'rejected', code: result.code};
  if (result.execution.state === 'unknown' || result.execution.state === 'running'
    || result.execution.state === 'waiting') return {kind: 'unknown', code: result.execution.errorCode ?? 'outcome_unknown', requestKey};
  if (result.execution.state !== 'succeeded') return {kind: 'rejected', code: result.execution.errorCode ?? 'unavailable'};
  return acceptance(result.execution.output) ? {kind: 'accepted', value: result.execution.output}
    : {kind: 'unknown', code: 'invalid_response', requestKey};
}

/** Typed projection over the declared T06 HTTP bindings, never a generic invoke endpoint. */
export function createModuleSettingsClient(operations: OperationClient) {
  if (!operations || operations.audience !== 'admin') throw new TypeError('Admin operation client required.');
  const invoke = (bindingId: string, input: Readonly<Record<string, unknown>>, isCurrent?: () => boolean) =>
    operations.invoke({bindingId, contextId: 'application', input, isCurrent});
  return Object.freeze({
    list: async (input: {limit: number; afterId?: string | null}, isCurrent?: () => boolean) =>
      readResult(await invoke(MODULE_SETTINGS_BINDINGS.catalogList,
        {limit: input.limit, ...(input.afterId ? {afterId: input.afterId} : {})}, isCurrent), catalogPage),
    detail: async (moduleId: string, isCurrent?: () => boolean) =>
      readResult(await invoke(MODULE_SETTINGS_BINDINGS.catalogDetail, {moduleId}, isCurrent), detail),
    preview: async (intent: ModuleIntent, isCurrent?: () => boolean) =>
      readResult(await invoke(MODULE_SETTINGS_BINDINGS.plansPreview, {intent}, isCurrent), preview),
    accept: async (input: {requestKey: string; expectedRevision: number; expectedPlanDigest: string; intent: ModuleIntent},
      isCurrent?: () => boolean): Promise<ModuleAcceptOutcome> =>
      commandResult(await invoke(MODULE_SETTINGS_BINDINGS.plansAccept, input, isCurrent), input.requestKey),
    read: async (planId: string, isCurrent?: () => boolean) =>
      readResult(await invoke(MODULE_SETTINGS_BINDINGS.plansRead, {planId}, isCurrent), planRead),
    journal: async (input: {limit: number; afterRevision?: number | null}, isCurrent?: () => boolean) =>
      readResult(await invoke(MODULE_SETTINGS_BINDINGS.journalList,
        {limit: input.limit, ...(input.afterRevision === undefined || input.afterRevision === null
          ? {} : {afterRevision: input.afterRevision})}, isCurrent), journalPage),
    lookupAccept: async (requestKey: string, isCurrent?: () => boolean): Promise<ModuleAcceptOutcome> =>
      commandResult(await operations.status({bindingId: MODULE_SETTINGS_BINDINGS.plansAccept,
        contextId: 'application', requestKey, isCurrent}), requestKey),
  });
}
export type ModuleSettingsClient = ReturnType<typeof createModuleSettingsClient>;
