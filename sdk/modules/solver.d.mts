import type {CompiledModuleInventoryV1,ModuleChoiceV1,ModulePlanCurrentV1,ModulePlanV1} from './types.ts';

export const MODULE_PLAN_LIMITS: Readonly<{actions:32;choicesBytes:8192;summaryBytes:8192;dataPlanBytes:49152}>;
export function modulePlanDigest(value: unknown): string;
export function solveModulePlan(current: ModulePlanCurrentV1, choices: ModuleChoiceV1,
  inventory: CompiledModuleInventoryV1): ModulePlanV1;
export function verifyModulePlanForCommit(input: Readonly<{current:ModulePlanCurrentV1;
  choices:ModuleChoiceV1;inventory:CompiledModuleInventoryV1;expectedChoicesDigest:string;
  expectedSummaryDigest:string}>): ModulePlanV1 | null;
