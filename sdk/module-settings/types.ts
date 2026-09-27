import type {CompiledModuleInventoryV1, ModuleActionKind, ModuleChoiceV1, ModulePlanSummaryV1} from '../modules/types.ts';

export type ModuleIntent = ModuleChoiceV1;
/** Static, verified data injected only into the modules-settings operation context by the host. */
export interface ModuleSettingsHostInventory {
  readonly current: Readonly<{composition: Readonly<Record<string, unknown>>;
    lock: Readonly<Record<string, unknown>>; descriptors: readonly Readonly<Record<string, unknown>>[]}>;
  readonly inventory: CompiledModuleInventoryV1;
}
export type ModuleReadResult<T> = Readonly<{ok: true; value: T} | {ok: false; error: string}>;

export interface ModuleCatalogItem {
  readonly moduleId: string;
  readonly title: string;
  readonly description: string;
  readonly origin: string;
  readonly version: string;
  readonly candidateKey: string | null;
  readonly codePresent: boolean;
  readonly enabled: boolean;
  readonly configuration: 'ready' | 'missing' | 'unknown';
  readonly operational: 'ready' | 'unavailable' | 'unknown';
  readonly visibility: 'current' | 'available';
}
export interface ModuleDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly moduleId: string | null;
  readonly message: string;
}
export interface ModuleDependency {
  readonly moduleId: string;
  readonly required: boolean;
  readonly active: boolean;
  readonly versionRange: string;
  readonly via: readonly string[];
}
export interface ModuleCatalogPage {
  readonly items: readonly ModuleCatalogItem[];
  readonly nextAfterId: string | null;
  readonly compositionDigest: string;
  readonly lockDigest: string;
  readonly inventoryDigest: string;
  readonly revision: number;
}
export interface ModuleDetail {
  readonly module: ModuleCatalogItem;
  readonly dependsOn: readonly ModuleDependency[];
  readonly usedBy: readonly ModuleDependency[];
  readonly optionalIntegrations: readonly ModuleDependency[];
  readonly diagnostics: readonly ModuleDiagnostic[];
}
export interface ModulePlanAction {
  readonly kind: ModuleActionKind;
  readonly moduleId: string;
  readonly fromVersion: string | null;
  readonly toVersion: string | null;
  readonly audiences?: readonly ('admin' | 'app')[];
  readonly requiresPublication: boolean;
}
export interface ModulePlanPreview {
  readonly planDigest: string;
  readonly baseRevision: number;
  readonly baseCompositionDigest: string;
  readonly targetCompositionDigest: string;
  readonly targetLockDigest: string;
  readonly actions: readonly ModulePlanAction[];
  readonly diagnostics: readonly ModuleDiagnostic[];
  readonly disabledContributionCount: number;
  readonly requiresPublication: boolean;
}
export interface ModulePlanAcceptance {
  readonly planId: string;
  readonly revision: number;
  readonly status: 'accepted_pending_publication';
  readonly planDigest: string;
}
export interface ModuleAcceptedPlan {
  readonly id: string;
  readonly revision: number;
  readonly planDigest: string;
  readonly inventoryDigest: string;
  readonly baseCompositionDigest: string;
  readonly baseLockDigest: string;
  readonly targetCompositionDigest: string;
  readonly targetLockDigest: string;
  readonly summary: ModulePlanSummaryV1;
  readonly acceptedByPrincipalId: string;
  readonly acceptedAtMs: number;
  readonly requiresPublication: boolean;
}
export interface ModuleJournalEntry {
  readonly revision: number;
  readonly planId: string;
  readonly planDigest: string;
  readonly actorPrincipalId: string;
  readonly baseCompositionDigest: string;
  readonly targetCompositionDigest: string;
  readonly occurredAtMs: number;
  readonly eventKind: 'plan-accepted';
}
export interface ModulePlanRead {
  readonly plan: ModuleAcceptedPlan;
  readonly events: readonly ModuleJournalEntry[];
  readonly status: 'accepted_pending_publication' | 'effective';
}
export interface ModuleJournalPage {
  readonly items: readonly ModuleJournalEntry[];
  readonly nextAfterRevision: number | null;
}
export type ModuleAcceptOutcome = Readonly<{kind: 'accepted'; value: ModulePlanAcceptance}>
  | Readonly<{kind: 'rejected'; code: string}>
  | Readonly<{kind: 'unknown'; code: string; requestKey: string}>;
export interface ModuleSettingsPendingCommand {
  readonly requestKey: string;
  readonly owner: string;
  readonly code: string;
}
export interface ModuleSettingsPendingPersistence {
  read(): unknown;
  save(value: Readonly<{requestKey: string; owner: string}> | null): boolean;
}
export interface ModuleSettingsSnapshot {
  readonly authorized: boolean;
  readonly suspended: boolean;
  readonly identityVersion: number;
  readonly pendingCommand: ModuleSettingsPendingCommand | null;
}
export interface ModuleSettingsController {
  getSnapshot(): ModuleSettingsSnapshot;
  subscribe(listener: () => void): () => void;
  list(input: {limit: number; afterId?: string | null}): Promise<ModuleReadResult<ModuleCatalogPage>>;
  detail(moduleId: string): Promise<ModuleReadResult<ModuleDetail>>;
  preview(intent: ModuleIntent): Promise<ModuleReadResult<ModulePlanPreview>>;
  accept(input: {expectedRevision: number; expectedPlanDigest: string; intent: ModuleIntent}): Promise<ModuleAcceptOutcome>;
  read(planId: string): Promise<ModuleReadResult<ModulePlanRead>>;
  journal(input: {limit: number; afterRevision?: number | null}): Promise<ModuleReadResult<ModuleJournalPage>>;
  reconcilePending(): Promise<ModuleAcceptOutcome | null>;
  dispose(): void;
}
