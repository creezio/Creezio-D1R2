import { isRuntimeProfile, type RuntimeProfile } from '../../adapters/runtime-profiles.ts';
import { resolveBindings, type RuntimeBindings } from '../../adapters/storage/bindings.ts';
import {createStorageResourceResolver,validateStorageRoutes,type StorageResource} from '../../adapters/storage/resources.ts';
import {createStorageAuthorityHost} from '../storage-authority/host.ts';

export interface RuntimeEnvironment {
  readonly profile: RuntimeProfile;
  readonly bindings: RuntimeBindings;
  readonly storage?: Readonly<{resolve:(authorizedContextId:string)=>StorageResource}>;
  readonly storageAuthority?:ReturnType<typeof createStorageAuthorityHost>;
}

/** Keep credentials and host identity headers outside module contexts. Never infer a profile from a request. */
export function resolveRuntimeEnvironment(environment: unknown): RuntimeEnvironment | null {
  try {
    if (!environment || typeof environment !== 'object') return null;
    const profile = (environment as Record<string, unknown>).CREEZIO_RUNTIME_PROFILE;
    if (!isRuntimeProfile(profile)) return null;
    const bindings = resolveBindings(environment);
    if(!bindings)return null;
    const raw=(environment as Record<string,unknown>).CREEZIO_STORAGE_ROUTES;
    if(raw===undefined)return Object.freeze({profile,bindings});
    if(typeof raw!=='string'||raw.length>4096) return null;
    const routes=validateStorageRoutes(JSON.parse(raw));
    const storage=createStorageResourceResolver(environment,profile,routes);
    return Object.freeze({profile,bindings,storage,
      ...(routes.schemaVersion===2?{storageAuthority:createStorageAuthorityHost(environment,profile,routes)}:{})});
  } catch {
    return null;
  }
}
