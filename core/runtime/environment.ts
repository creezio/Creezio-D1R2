import { isRuntimeProfile, type RuntimeProfile } from '../../adapters/runtime-profiles.ts';
import { resolveBindings, type RuntimeBindings } from '../../adapters/storage/bindings.ts';

export interface RuntimeEnvironment {
  readonly profile: RuntimeProfile;
  readonly bindings: RuntimeBindings;
}

/** Keep credentials and host identity headers outside module contexts. Never infer a profile from a request. */
export function resolveRuntimeEnvironment(environment: unknown): RuntimeEnvironment | null {
  try {
    if (!environment || typeof environment !== 'object') return null;
    const profile = (environment as Record<string, unknown>).CREEZIO_RUNTIME_PROFILE;
    if (!isRuntimeProfile(profile)) return null;
    const bindings = resolveBindings(environment);
    return bindings ? Object.freeze({ profile, bindings }) : null;
  } catch {
    return null;
  }
}
