/** Structural recognition only: it does not prove a database/bucket is reachable or authorize data access. */
type BindingMethod = (...args: never[]) => unknown;
export interface StructuralD1Binding {
  prepare: D1Database['prepare'];
  batch: D1Database['batch'];
}
export interface StructuralR2Binding {
  get: BindingMethod;
  head: BindingMethod;
  put: BindingMethod;
  delete: BindingMethod;
}
export interface RuntimeBindings {
  readonly DB: StructuralD1Binding;
  readonly BUCKET: StructuralR2Binding;
}

function hasMethods(value: unknown, names: readonly string[]): boolean {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  return names.every(name => typeof (value as Record<string, unknown>)[name] === 'function');
}

export function resolveBindings(environment: unknown): RuntimeBindings | null {
  try {
    if (!environment || typeof environment !== 'object') return null;
    const candidate = environment as Record<string, unknown>;
    if (!hasMethods(candidate.DB, ['prepare', 'batch']) || !hasMethods(candidate.BUCKET, ['get', 'head', 'put', 'delete'])) return null;
    return Object.freeze({ DB: candidate.DB as StructuralD1Binding, BUCKET: candidate.BUCKET as StructuralR2Binding });
  } catch {
    return null;
  }
}
