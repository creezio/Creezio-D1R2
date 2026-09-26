/** Hosting differences are configuration; operations and storage binding names stay shared. */
export const RUNTIME_PROFILES = Object.freeze(['local', 'sites', 'cloudflare'] as const);
export type RuntimeProfile = typeof RUNTIME_PROFILES[number];

/** The composition calls the Miniflare development profile docker-local; T-03 can exercise it directly before Docker packaging. */
export const COMPOSITION_PROFILE_BY_RUNTIME = Object.freeze({ local:'docker-local', sites:'sites', cloudflare:'cloudflare' } as const);

export function isRuntimeProfile(value: unknown): value is RuntimeProfile {
  return typeof value === 'string' && RUNTIME_PROFILES.some(profile => profile === value);
}
