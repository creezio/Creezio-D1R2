import {createStorageResourceResolver,validateStorageRoutes,type StorageRoutes}
  from '../../adapters/storage/resources.ts';
import type {StructuralR2Binding} from '../../adapters/storage/bindings.ts';
import type {RuntimeProfile} from '../../adapters/runtime-profiles.ts';
import type {IdentityDatabase} from '../identity/d1-store.ts';
import {createStorageMutationPort,type StorageMutationTarget} from './native-mutation.ts';
import type {StorageRouteIdentity} from './target.ts';

export interface StorageAuthoritySelection {
  readonly db:IdentityDatabase;readonly bucket:StructuralR2Binding;readonly authorityDb:IdentityDatabase;
  readonly storageRoute?:StorageRouteIdentity;
}

/** Trusted host composition only. The context must already have native admission. */
export function createStorageAuthorityHost(environment:unknown,profile:RuntimeProfile,routes:unknown){
  const resolver=createStorageResourceResolver(environment,profile,routes);
  const manifest:StorageRoutes|null=routes===undefined?null:validateStorageRoutes(routes);
  if(manifest?.schemaVersion===1)throw new Error('Storage authority requires a physical installation identity.');
  const primary=resolver.resolve('application');
  const authorityDb=primary.DB as IdentityDatabase;
  const inventory:StorageMutationTarget[]=manifest?.schemaVersion===2
    ?manifest.routes.filter(route=>route.status==='active').map(route=>{
      const binding=resolver.resolve(route.contextId);
      return Object.freeze({identity:Object.freeze({installationId:manifest.storageInstallationId,
        contextId:route.contextId,slot:route.slot}),db:binding.DB as IdentityDatabase});
    }):[];
  const targets=Object.freeze(inventory);
  const storageMutation=targets.length?createStorageMutationPort(authorityDb,targets):null;
  return Object.freeze({authorityDb,inventory:targets,storageMutation,
    forContext(authorizedContextId:string):StorageAuthoritySelection{
      const resource=resolver.resolve(authorizedContextId);
      const route=targets.find(item=>item.identity.contextId===authorizedContextId)?.identity;
      if(resource.slot!==0&&!route)throw new Error('Storage authority route unavailable.');
      return Object.freeze({db:resource.DB,bucket:resource.BUCKET,authorityDb,
        ...(route?{storageRoute:route}:{})});
    }});
}
