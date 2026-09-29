import type {createD1IdentityStore} from '../identity/d1-store.ts';
import {identityAdmissionKey} from '../identity/input.ts';
import type {AuthorizationAudience} from '../authorization/types.ts';

/** Shared per-category R2 admission for native HTTP and external MCP reads. */
export async function admitFileRequest(store:Pick<ReturnType<typeof createD1IdentityStore>,'consumeThrottle'>,
  moduleId:string,categoryId:string,audience:AuthorizationAudience,credentialToken:string):Promise<boolean> {
  const domain=`${moduleId}:${categoryId}:${audience}`;
  for(const [kind,key,limit] of [['global',domain,120],['credential',`${domain}:${credentialToken}`,30]] as const){
    const admitted=await store.consumeThrottle({key:await identityAdmissionKey(`files-${kind}`,key),
      limit,windowMs:60000});
    if(!admitted.allowed)return false;
  }
  return true;
}
