export interface ContractDiagnostic { readonly code: string; readonly path: string; readonly message: string }
export interface ContractValidation { readonly errors: readonly ContractDiagnostic[]; readonly metrics: Readonly<Record<string, unknown>> }
export function validateModule(module: unknown): ContractValidation;
export function validateArtifactReceipt(receipt: unknown): ContractValidation;
export function validateComposition(composition: unknown, options?: {modules?: readonly unknown[]; lock?: unknown}): ContractValidation;
export function validateCompositionTransition(before: unknown, after: unknown,
  options?: {before?: {modules?: readonly unknown[]; lock?: unknown}; after?: {modules?: readonly unknown[]; lock?: unknown}}): ContractValidation;
export function contractIntegrity(value: unknown): `sha256-${string}`;
export function canonicalJson(value: unknown): string;
