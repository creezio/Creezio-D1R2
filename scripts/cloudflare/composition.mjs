import {loadRuntimeComposition} from '../build/compose-runtime.mjs';
import {compileCompositionSchema,schemaDigest} from '../data/composition-schema.mjs';
import {canonicalJson,contractIntegrity,validateComposition} from '../../sdk/contracts/validate.mjs';

/** Explicit host projection: same app, module bytes, rights, data and UI. No installation or lock refresh. */
export function projectCloudflareComposition(options){
  const loaded=loadRuntimeComposition(options);
  if(loaded.composition.host.profile!=='docker-local')throw new Error('Publication source must be the local profile.');
  const source=JSON.parse(canonicalJson(loaded.composition));
  const composition={...source,host:{...source.host,profile:'cloudflare'}};
  const lock={...JSON.parse(canonicalJson(loaded.lock)),compositionIntegrity:contractIntegrity(composition)};
  const modules=loaded.located.map(item=>item.descriptor);
  const validation=validateComposition(composition,{modules,lock});
  if(validation.errors.length)throw new Error('Selected modules are incompatible with the Cloudflare profile.');
  const sourcePlan=compileCompositionSchema({composition:source,lock:loaded.lock,modules});
  const targetPlan=compileCompositionSchema({composition,lock,modules});
  if(sourcePlan.modelDigest!==targetPlan.modelDigest||sourcePlan.sqlDigest!==targetPlan.sqlDigest
    ||canonicalJson(sourcePlan.objects)!==canonicalJson(targetPlan.objects))throw new Error('Host projection changes application data.');
  return Object.freeze({composition,lock,sourcePlan,targetPlan,compatibilityDigest:schemaDigest({
    sourceComposition:sourcePlan.compositionDigest,targetComposition:targetPlan.compositionDigest,
    modelDigest:sourcePlan.modelDigest,sqlDigest:sourcePlan.sqlDigest,modules:loaded.lock.modules})});
}
