import {OperationError, type OperationContext, type OperationHandlerResult,
  type JsonValue} from '../../../../sdk/operations/handler.ts';
// The runtime already bundles semver for the T02 solver; this projection uses its validated versions.
// @ts-expect-error semver has no local declaration in this workspace.
import semver from 'semver';
import {modulePlanDigest, solveModulePlan, verifyModulePlanForCommit} from '../../../../sdk/modules/solver.mjs';
import type {CompiledModuleCandidateV1, ModuleChoiceV1, ModulePlanV1} from '../../../../sdk/modules/types.ts';
import type {ModuleSettingsHostInventory, ModuleCatalogItem, ModuleCatalogPage, ModuleDetail,
  ModuleDiagnostic, ModuleDependency, ModulePlanPreview, ModulePlanAction, ModulePlanAcceptance,
  ModuleAcceptedPlan, ModuleJournalEntry, ModulePlanRead, ModuleJournalPage} from '../../../../sdk/module-settings/types.ts';

type Row = Readonly<Record<string, unknown>>;
type DataRecord = Readonly<Record<string, JsonValue>>;
type Context = OperationContext & {readonly hostInventory?: ModuleSettingsHostInventory};
const id = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const requestKey = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const row = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const readString = (value: unknown): string => typeof value === 'string' ? value : '';
const array = (value: unknown): readonly Row[] => Array.isArray(value) ? value.filter(row) : [];
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
function inputRow(input: JsonValue): Row {
  if (!row(input)) throw new OperationError('invalid_input');
  return input;
}
function host(context: OperationContext): ModuleSettingsHostInventory {
  const value = (context as Context).hostInventory;
  if (!value || !row(value.current?.composition) || !row(value.current?.lock)
    || !Array.isArray(value.current?.descriptors) || !value.inventory) throw new OperationError('unavailable');
  return value;
}
function actualDigest(value: Readonly<Record<string, unknown>>): string {
  return modulePlanDigest(value) as string;
}
async function head(context: OperationContext): Promise<{revision: number; targetCompositionDigest: string | null;
  targetLockDigest: string | null}> {
  const record = await context.data.get('head', {key: {id: 'application'}});
  if (!record) return {revision: 0, targetCompositionDigest: null, targetLockDigest: null};
  if (!integer(record.revision) || record.revision < 1 || !digest(record.target_composition_digest)
    || !digest(record.target_lock_digest)) throw new OperationError('unavailable');
  return {revision: record.revision, targetCompositionDigest: record.target_composition_digest,
    targetLockDigest: record.target_lock_digest};
}
function settled(state: Awaited<ReturnType<typeof head>>, inventory: ModuleSettingsHostInventory): void {
  if (state.revision && (state.targetCompositionDigest !== actualDigest(inventory.current.composition)
    || state.targetLockDigest !== actualDigest(inventory.current.lock))) throw new OperationError('conflict');
}
function current(inventory: ModuleSettingsHostInventory, revision: number) {
  return {...inventory.current, revision};
}
function descriptorMap(inventory: ModuleSettingsHostInventory): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const descriptor of inventory.current.descriptors) {
    const identity = row(descriptor.identity) ? descriptor.identity : null;
    if (identity && id(identity.id)) map.set(identity.id, descriptor);
  }
  for (const candidate of inventory.inventory.candidates) if (!map.has(candidate.moduleId))
    map.set(candidate.moduleId, candidate.descriptor);
  return map;
}
function selections(inventory: ModuleSettingsHostInventory): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const selection of array(inventory.current.composition.modules)) if (id(selection.moduleId))
    map.set(selection.moduleId, selection);
  return map;
}
function candidateById(inventory: ModuleSettingsHostInventory): Map<string, CompiledModuleCandidateV1> {
  const map = new Map<string, CompiledModuleCandidateV1>();
  const selected = selections(inventory);
  for (const candidate of inventory.inventory.candidates) {
    const previous = map.get(candidate.moduleId), currentOrigin = selected.get(candidate.moduleId)?.origin;
    const preferred = candidate.origin === currentOrigin, oldPreferred = previous?.origin === currentOrigin;
    if (!previous || preferred && !oldPreferred || preferred === oldPreferred
      && (semver.gt(candidate.version, previous.version) || candidate.version === previous.version
        && candidate.candidateKey < previous.candidateKey)) map.set(candidate.moduleId, candidate);
  }
  return map;
}
function sameAsCurrent(candidate: CompiledModuleCandidateV1, selection: Row,
  lock: Readonly<Record<string, unknown>>): boolean {
  const node = array(lock.modules).find(item => item.moduleId === candidate.moduleId);
  const proposed = candidate.lockNode;
  return !!node && row(selection.source) && row(node.source) && row(proposed.source)
    && row(node.runtime) && row(proposed.runtime)
    && row(node.validation) && row(proposed.validation)
    && selection.origin === candidate.origin && node.origin === candidate.origin
    && node.version === candidate.version
    && modulePlanDigest(selection.source) === modulePlanDigest(candidate.source)
    && modulePlanDigest(node.source) === modulePlanDigest(proposed.source)
    && node.contractIntegrity === proposed.contractIntegrity
    && node.runtime.integrity === proposed.runtime.integrity
    && node.validation.integrity === proposed.validation.integrity;
}
function catalogItem(moduleId: string, descriptor: Row | undefined, selection: Row | undefined,
  candidate: CompiledModuleCandidateV1 | undefined, selected: Map<string, Row>): ModuleCatalogItem {
  const identity = descriptor && row(descriptor.identity) ? descriptor.identity : {};
  const enabled = selection?.enabled === true;
  const settings = row(descriptor?.contracts) ? array(descriptor.contracts.settings) : [];
  const configured = new Set(array(selection?.configuration).map(item => row(item.setting) ? item.setting.id : null));
  const unresolved = settings.filter(setting => setting.required === true
    && !Object.hasOwn(setting, 'default') && !configured.has(setting.id));
  // A provider-backed setting may be supplied by the module at runtime. This static inventory
  // cannot prove that state, while a required ordinary composition setting is genuinely absent.
  const missingConfiguration = unresolved.some(setting => !id(setting.provider));
  const configuration = !selection ? 'unknown' : missingConfiguration ? 'missing'
    : unresolved.length ? 'unknown' : 'ready';
  const requiredDependenciesReady = array(descriptor?.dependencies).filter(dep => dep.optional !== true)
    .every(dep => selected.get(readString(dep.moduleId))?.enabled === true);
  return Object.freeze({moduleId, title: readString(identity.title) || moduleId,
    description: readString(descriptor?.description), origin: readString(identity.origin) || candidate?.origin || '',
    version: readString(identity.version) || candidate?.version || '',
    candidateKey: candidate?.candidateKey ?? null, codePresent: !!selection,
    enabled, configuration, operational: !enabled || configuration === 'missing' || !requiredDependenciesReady
      ? 'unavailable' : 'unknown',
    visibility: selection ? 'current' : 'available'});
}
function items(inventory: ModuleSettingsHostInventory): ModuleCatalogItem[] {
  const descriptors = descriptorMap(inventory), selected = selections(inventory), candidates = candidateById(inventory);
  return [...new Set([...selected.keys(), ...candidates.keys()])].sort()
    .map(moduleId => {
      const selection = selected.get(moduleId), candidate = candidates.get(moduleId);
      const proposed = selection && candidate && sameAsCurrent(candidate, selection, inventory.current.lock)
        ? undefined : candidate;
      return catalogItem(moduleId, descriptors.get(moduleId), selection, proposed, selected);
    });
}
function boundedPage(input: Row, cursor: 'afterId' | 'afterRevision') {
  if (!integer(input.limit) || input.limit < 1 || input.limit > 50) throw new OperationError('invalid_input');
  const after = input[cursor];
  if (after !== undefined && after !== null && (cursor === 'afterId' ? !id(after) : !integer(after)))
    throw new OperationError('invalid_input');
  return {limit: input.limit, after};
}
export async function catalogList(input: JsonValue, context: OperationContext): Promise<OperationHandlerResult> {
  const options = boundedPage(inputRow(input), 'afterId'), inventory = host(context), state = await head(context);
  const all = items(inventory).filter(item => options.after === undefined || options.after === null
    || item.moduleId > options.after);
  const page = all.slice(0, options.limit), nextAfterId = all.length > page.length ? page.at(-1)?.moduleId ?? null : null;
  const output: ModuleCatalogPage = {items: page, nextAfterId,
    compositionDigest: actualDigest(inventory.current.composition), lockDigest: actualDigest(inventory.current.lock),
    inventoryDigest: inventory.inventory.digest, revision: state.revision};
  return {output};
}
function dependencies(descriptor: Row | undefined, owner: Row | undefined,
  selected: Map<string, Row>): ModuleDependency[] {
  const integrations = new Map(array(owner?.integrations).filter(item => id(item.moduleId))
    .map(item => [item.moduleId as string, item.enabled === true]));
  return array(descriptor?.dependencies).filter(dep => id(dep.moduleId)).map(dep => ({
    moduleId: dep.moduleId as string, required: dep.optional !== true,
    active: owner?.enabled === true && selected.get(dep.moduleId as string)?.enabled === true
      && (dep.optional !== true || integrations.get(dep.moduleId as string) === true),
    versionRange: readString(dep.versionRange),
    via: []}));
}
function dependencyGraph(start: string, descriptors: Map<string, Row>, selected: Map<string, Row>,
  reverse = false): ModuleDependency[] {
  const edges = new Map([...descriptors].map(([owner, descriptor]) =>
    [owner, dependencies(descriptor, selected.get(owner), selected)]));
  const inbound = new Map<string, {owner: string; edge: ModuleDependency}[]>();
  if (reverse) for (const [owner, list] of edges) for (const edge of list) {
    const group = inbound.get(edge.moduleId) ?? [];
    group.push({owner, edge}); inbound.set(edge.moduleId, group);
  }
  const result: ModuleDependency[] = [];
  const queue: {path: string[]; required: boolean; active: boolean}[] =
    [{path: [start], required: true, active: true}];
  while (queue.length) {
    const node = queue.shift()!, at = node.path.at(-1)!;
    const next = reverse ? (inbound.get(at) ?? []).map(item => ({...item.edge, moduleId: item.owner}))
      : edges.get(at) ?? [];
    for (const edge of next) {
      const required = node.required && edge.required, active = node.active && edge.active;
      const cycle = node.path.includes(edge.moduleId);
      if (cycle && active) throw new OperationError('unsupported');
      result.push({...edge, required, active, via: node.path.slice(1)});
      if (result.length > 256) throw new OperationError('unsupported');
      if (!cycle) queue.push({path: [...node.path, edge.moduleId], required, active});
    }
  }
  return result;
}
export async function catalogDetail(input: JsonValue, context: OperationContext): Promise<OperationHandlerResult> {
  const moduleId = inputRow(input).moduleId;
  if (!id(moduleId)) throw new OperationError('invalid_input');
  const inventory = host(context), selected = selections(inventory), candidates = candidateById(inventory), descriptors = descriptorMap(inventory);
  const item = items(inventory).find(candidate => candidate.moduleId === moduleId);
  if (!item) throw new OperationError('not_found');
  const outbound = dependencyGraph(moduleId, descriptors, selected);
  const output: ModuleDetail = {module: item, dependsOn: outbound.filter(dep => dep.required),
    optionalIntegrations: outbound.filter(dep => !dep.required),
    usedBy: dependencyGraph(moduleId, descriptors, selected, true),
    diagnostics: []};
  return {output};
}
function intentOf(input: Row): ModuleChoiceV1 {
  if (!row(input.intent)) throw new OperationError('invalid_input');
  return input.intent as unknown as ModuleChoiceV1;
}
function evaluate(intent: ModuleChoiceV1, inventory: ModuleSettingsHostInventory, revision: number): ModulePlanV1 {
  return solveModulePlan(current(inventory, revision), intent, inventory.inventory) as ModulePlanV1;
}
function planDigest(plan: ModulePlanV1): string {
  return modulePlanDigest({base: plan.base, inventoryDigest: plan.inventoryDigest,
    choicesDigest: plan.choicesDigest, summaryDigest: plan.summaryDigest,
    targetCompositionDigest: plan.nextCompositionDigest, targetLockDigest: plan.nextLockDigest}) as string;
}
function diagnostics(plan: ModulePlanV1): ModuleDiagnostic[] {
  return plan.diagnostics.map(item => ({code: item.code, severity: 'error', moduleId: null,
    message: item.message}));
}
function actions(plan: ModulePlanV1, inventory: ModuleSettingsHostInventory,
  intent: ModuleChoiceV1): ModulePlanAction[] {
  if (!plan.next) return [];
  const currentVersions = new Map(array(inventory.current.lock.modules).filter(item => id(item.moduleId))
    .map(item => [item.moduleId as string, readString(item.version)]));
  const targetVersions = new Map(array(plan.next?.lock.modules).filter(item => id(item.moduleId))
    .map(item => [item.moduleId as string, readString(item.version)]));
  const explicit = intent.actions.map(action => ({moduleId: action.moduleId, kind: action.kind,
    ...(['add','enable'].includes(action.kind) ? {audiences: action.audiences ?? []} : {})}));
  const explicitIds = new Set(explicit.map(action => action.moduleId));
  const automatic = plan.next ? array(plan.next.composition.modules).filter(item => id(item.moduleId)
    && !currentVersions.has(item.moduleId) && !explicitIds.has(item.moduleId))
    .map(item => ({moduleId: item.moduleId as string, kind: 'add' as const,
      audiences: [] as ('admin' | 'app')[]})) : [];
  const complete = [...explicit, ...automatic];
  if (complete.length > 256) throw new OperationError('unsupported');
  const requiresPublication = plan.nextCompositionDigest !== plan.base.compositionDigest
    || plan.nextLockDigest !== plan.base.lockDigest;
  return complete.map(change => ({kind: change.kind,
    moduleId: change.moduleId, fromVersion: currentVersions.get(change.moduleId) || null,
    toVersion: targetVersions.get(change.moduleId) || null,
    ...('audiences' in change ? {audiences: change.audiences} : {}),
    requiresPublication}));
}
function projection(plan: ModulePlanV1, inventory: ModuleSettingsHostInventory,
  intent: ModuleChoiceV1): ModulePlanPreview {
  const requiresPublication = !!plan.next && (plan.nextCompositionDigest !== plan.base.compositionDigest
    || plan.nextLockDigest !== plan.base.lockDigest);
  return {planDigest: planDigest(plan), baseRevision: plan.base.revision,
    baseCompositionDigest: plan.base.compositionDigest,
    targetCompositionDigest: plan.nextCompositionDigest ?? plan.base.compositionDigest,
    targetLockDigest: plan.nextLockDigest ?? plan.base.lockDigest,
    actions: actions(plan, inventory, intent), diagnostics: diagnostics(plan),
    disabledContributionCount: plan.summary.disabledContributionCount, requiresPublication};
}
export async function plansPreview(input: JsonValue, context: OperationContext): Promise<OperationHandlerResult> {
  const inventory = host(context), state = await head(context); settled(state, inventory);
  const intent = intentOf(inputRow(input)), plan = evaluate(intent, inventory, state.revision);
  return {output: projection(plan, inventory, intent)};
}
export async function plansAccept(input: JsonValue, context: OperationContext): Promise<OperationHandlerResult> {
  const request = inputRow(input), inventory = host(context), state = await head(context);
  if (!requestKey(request.requestKey) || !integer(request.expectedRevision) || !digest(request.expectedPlanDigest))
    throw new OperationError('invalid_input');
  if (request.expectedRevision !== state.revision) throw new OperationError('conflict');
  settled(state, inventory);
  const intent = intentOf(request), preliminary = evaluate(intent, inventory, state.revision);
  if (!preliminary.next || !preliminary.choicesDigest || preliminary.summary.status !== 'ready')
    throw new OperationError('conflict');
  const plan = verifyModulePlanForCommit({current: current(inventory, state.revision), choices: intent,
    inventory: inventory.inventory, expectedChoicesDigest: preliminary.choicesDigest,
    expectedSummaryDigest: preliminary.summaryDigest}) as ModulePlanV1 | null;
  if (!plan || planDigest(plan) !== request.expectedPlanDigest) throw new OperationError('conflict');
  if (plan.nextCompositionDigest === plan.base.compositionDigest
    && plan.nextLockDigest === plan.base.lockDigest) throw new OperationError('invalid_input');
  actions(plan, inventory, intent);
  const choicesJson = JSON.stringify(intent), summaryJson = JSON.stringify(plan.summary);
  if (bytes(choicesJson) > 8192 || bytes(summaryJson) > 8192
    || !plan.nextCompositionDigest || !plan.nextLockDigest || state.revision >= Number.MAX_SAFE_INTEGER)
    throw new OperationError('invalid_input');
  const acceptedAtMs = Date.now(), revision = state.revision + 1, planId = crypto.randomUUID(), digestValue = planDigest(plan);
  const headValues: DataRecord = {id: 'application', revision, accepted_plan_id: planId,
    accepted_plan_digest: digestValue, target_composition_digest: plan.nextCompositionDigest,
    target_lock_digest: plan.nextLockDigest, accepted_at_ms: acceptedAtMs};
  const planValues: DataRecord = {id: planId, revision, plan_digest: digestValue,
    inventory_digest: plan.inventoryDigest, base_composition_digest: plan.base.compositionDigest,
    base_lock_digest: plan.base.lockDigest, target_composition_digest: plan.nextCompositionDigest,
    target_lock_digest: plan.nextLockDigest, choices_json: choicesJson, summary_json: summaryJson,
    summary_digest: plan.summaryDigest, accepted_by_principal_id: context.principalId,
    accepted_at_ms: acceptedAtMs, requires_publication: true};
  const journalValues: DataRecord = {revision, plan_id: planId, plan_digest: digestValue,
    actor_principal_id: context.actorPrincipalId, base_composition_digest: plan.base.compositionDigest,
    target_composition_digest: plan.nextCompositionDigest, occurred_at_ms: acceptedAtMs,
    event_kind: 'plan-accepted'};
  if (bytes(JSON.stringify({values: planValues})) > 48 * 1024) throw new OperationError('invalid_input');
  const headPlan = state.revision === 0 ? context.data.planCreate('head', {values: headValues})
    : context.data.planPatch('head', {key: {id: 'application'},
      values: {accepted_plan_id: planId, accepted_plan_digest: digestValue,
        target_composition_digest: plan.nextCompositionDigest, target_lock_digest: plan.nextLockDigest,
        accepted_at_ms: acceptedAtMs}, compare: {field: 'revision', expected: state.revision},
      where: {target_composition_digest: plan.base.compositionDigest,
        target_lock_digest: plan.base.lockDigest}});
  const output: ModulePlanAcceptance = {planId, revision, status: 'accepted_pending_publication',
    planDigest: digestValue};
  return {output, plans: [headPlan, context.data.planCreate('plans', {values: planValues}),
    context.data.planCreate('journal', {values: journalValues})]};
}
function acceptedPlan(record: DataRecord): ModuleAcceptedPlan {
  try {
    if (typeof record.summary_json !== 'string' || bytes(record.summary_json) > 8192
      || typeof record.choices_json !== 'string' || bytes(record.choices_json) > 8192)
      throw new Error('Invalid stored plan bounds.');
    const summary = JSON.parse(record.summary_json), choices = JSON.parse(record.choices_json);
    if (!row(summary) || !id(record.id) || !integer(record.revision) || !digest(record.plan_digest)
      || !digest(record.inventory_digest) || !digest(record.base_composition_digest)
      || !digest(record.base_lock_digest) || !digest(record.target_composition_digest)
      || !digest(record.target_lock_digest) || !id(record.accepted_by_principal_id)
      || !integer(record.accepted_at_ms) || typeof record.requires_publication !== 'boolean'
      || !row(choices) || !row(choices.base) || !integer(choices.base.revision)
      || choices.base.revision + 1 !== record.revision
      || choices.base.compositionDigest !== record.base_composition_digest
      || choices.base.lockDigest !== record.base_lock_digest
      || choices.base.inventoryDigest !== record.inventory_digest
      || !digest(record.summary_digest) || modulePlanDigest(summary) !== record.summary_digest
      || modulePlanDigest({base: choices.base, inventoryDigest: record.inventory_digest,
        choicesDigest: modulePlanDigest(choices), summaryDigest: record.summary_digest,
        targetCompositionDigest: record.target_composition_digest,
        targetLockDigest: record.target_lock_digest}) !== record.plan_digest)
      throw new Error('Invalid stored plan.');
    return {id: record.id, revision: record.revision, planDigest: record.plan_digest,
      inventoryDigest: record.inventory_digest, baseCompositionDigest: record.base_composition_digest,
      baseLockDigest: record.base_lock_digest, targetCompositionDigest: record.target_composition_digest,
      targetLockDigest: record.target_lock_digest, summary: summary as unknown as ModuleAcceptedPlan['summary'],
      acceptedByPrincipalId: record.accepted_by_principal_id, acceptedAtMs: record.accepted_at_ms,
      requiresPublication: record.requires_publication};
  } catch { throw new OperationError('unavailable'); }
}
function journalEntry(record: DataRecord): ModuleJournalEntry {
  if (!integer(record.revision) || !id(record.plan_id) || !digest(record.plan_digest)
    || !id(record.actor_principal_id) || !digest(record.base_composition_digest)
    || !digest(record.target_composition_digest) || !integer(record.occurred_at_ms)
    || record.event_kind !== 'plan-accepted') throw new OperationError('unavailable');
  return {revision: record.revision, planId: record.plan_id, planDigest: record.plan_digest,
    actorPrincipalId: record.actor_principal_id, baseCompositionDigest: record.base_composition_digest,
    targetCompositionDigest: record.target_composition_digest, occurredAtMs: record.occurred_at_ms,
    eventKind: 'plan-accepted'};
}
export async function plansRead(input: JsonValue, context: OperationContext): Promise<OperationHandlerResult> {
  const planId = inputRow(input).planId;
  if (!id(planId)) throw new OperationError('invalid_input');
  const stored = await context.data.get('plans', {key: {id: planId}});
  if (!stored) throw new OperationError('not_found');
  const plan = acceptedPlan(stored), entry = await context.data.get('journal', {key: {revision: plan.revision}});
  if (!entry) throw new OperationError('unavailable');
  if (entry.plan_id !== plan.id || entry.plan_digest !== plan.planDigest
    || entry.target_composition_digest !== plan.targetCompositionDigest)
    throw new OperationError('unavailable');
  const inventory = host(context);
  const effective = plan.targetCompositionDigest === actualDigest(inventory.current.composition)
    && plan.targetLockDigest === actualDigest(inventory.current.lock);
  const output: ModulePlanRead = {plan, events: [journalEntry(entry)],
    status: effective ? 'effective' : 'accepted_pending_publication'};
  return {output};
}
export async function journalList(input: JsonValue, context: OperationContext): Promise<OperationHandlerResult> {
  const options = boundedPage(inputRow(input), 'afterRevision');
  const page = await context.data.list('journal', {limit: options.limit,
    ...(options.after === undefined || options.after === null ? {} : {after: {revision: options.after as number}})});
  const output: ModuleJournalPage = {items: page.items.map(journalEntry),
    nextAfterRevision: page.nextAfter && integer(page.nextAfter.revision) ? page.nextAfter.revision : null};
  return {output};
}
