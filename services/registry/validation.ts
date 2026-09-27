import type {RegistryArtifact, RegistryDeclarationRequest, RegistryPreflightRequest} from './types.ts';

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export const id = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
export const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
export const sha = (value: unknown): value is string => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export const version = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(value);
export const exact = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> =>
  record(value) && Reflect.ownKeys(value).every(key => typeof key === 'string' && [...required, ...optional].includes(key))
  && required.every(key => own(value, key));
export function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !value.isWellFormed()) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.href === value; }
  catch { return false; }
}
export function email(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);
}
export function artifact(value: unknown): value is RegistryArtifact {
  return exact(value, ['sourceSha','artifactDigest','coreVersion','contractVersion','compositionDigest'])
    && sha(value.sourceSha) && digest(value.artifactDigest) && version(value.coreVersion)
    && version(value.contractVersion) && digest(value.compositionDigest);
}
export function preflight(value: unknown): value is RegistryPreflightRequest {
  return exact(value, ['projectId','installationId','target','artifact']) && id(value.projectId)
    && id(value.installationId) && (value.target === 'sites' || value.target === 'cloudflare') && artifact(value.artifact);
}
export function declaration(value: unknown): value is RegistryDeclarationRequest {
  return exact(value, ['preflightId','requestKey','projectId','installationId','deploymentId','url','artifact'],
    ['repositoryUrl','publishedSha']) && id(value.preflightId) && id(value.requestKey) && id(value.projectId)
    && id(value.installationId) && id(value.deploymentId) && httpsUrl(value.url)
    && (!own(value, 'repositoryUrl') || httpsUrl(value.repositoryUrl))
    && (!own(value, 'publishedSha') || sha(value.publishedSha)) && artifact(value.artifact);
}
export function project(value: unknown): value is {name: string; origin: string} {
  return exact(value, ['name','origin']) && typeof value.name === 'string' && value.name.isWellFormed()
    && value.name.trim().length > 0 && value.name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value.name)
    && httpsUrl(value.origin);
}
export function installation(value: unknown): value is {projectId: string; target: 'sites' | 'cloudflare'} {
  return exact(value, ['projectId','target']) && id(value.projectId)
    && (value.target === 'sites' || value.target === 'cloudflare');
}
