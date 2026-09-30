import '../local-environment.mjs';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { loadLocalConfiguration } from './config.mjs';
import { assertLocalStoragePaths } from './lock.mjs';
import {loadStorageInstallationIdentity} from './storage-installation.mjs';
import {resourceBindingNames} from '../../adapters/storage/resources.ts';

/** Miniflare's own authenticated proxy uses loopback TCP. No operator HTTP handler exists. */
async function openLocalStorageBindings(config,includeBucket,contextId='application') {
  const canonical = loadLocalConfiguration({root:config.root,origin:config.origin,
    sandboxOrigin:config.sandboxOrigin,operatorOrigin:config.operatorOrigin,
    sandboxBindHost:config.sandboxHost,
    ...(config.storageResources?.length?{storageResources:config.storageResources}:{}),
    storageAuthority:Boolean(config.storageInstallationId)});
  if(config.storageInstallationId!==canonical.storageInstallationId
    ||config.statePath!==canonical.statePath||config.persistenceRoot!==canonical.persistenceRoot)
    throw Object.assign(new Error('Local storage identity changed.'),{code:'local_path'});
  if(canonical.storageInstallationId
    &&loadStorageInstallationIdentity(canonical.root)!==canonical.storageInstallationId)
    throw Object.assign(new Error('Local storage identity changed.'),{code:'local_path'});
  let selected={database:canonical.bindings.database,databaseId:canonical.bindings.databaseId,
    bucket:canonical.bindings.bucket,bucketName:canonical.bindings.bucketName};
  if(contextId!=='application'){
    const resource=canonical.storageResources.find(item=>item.contextId===contextId);
    if(!canonical.storageInstallationId||!resource||resource.status!=='active')
      throw Object.assign(new Error('Local storage route unavailable.'),{code:'local_path'});
    const names=resourceBindingNames(resource.slot);
    selected={database:names.database,databaseId:resource.databaseId,
      bucket:names.bucket,bucketName:resource.bucketName};
  }
  await assertLocalStoragePaths(canonical);
  const instance = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 404 }); } };',
    compatibilityDate: canonical.compatibilityDate,
    d1Databases: {[selected.database]:selected.databaseId},
    ...(includeBucket?{r2Buckets:{[selected.bucket]:selected.bucketName}}:{}),
    defaultPersistRoot: canonical.persistenceRoot,
    unsafeLocalExplorer: false, unsafeTriggerHandlers: false,
    telemetry: { enabled: false }, logRequests: false, log: new Log(LogLevel.NONE) });
  try {
    const db = await instance.getD1Database(selected.database);
    const bucket=includeBucket?await instance.getR2Bucket(selected.bucket):undefined;
    let disposal;
    return Object.freeze({ db,...(includeBucket?{bucket}:{}),
      dispose() { return disposal ??= Promise.resolve().then(() => instance.dispose()); } });
  } catch {
    try { await instance.dispose(); }
    catch { throw Object.assign(new Error('Local database closure could not be confirmed.'), { code: 'local_cleanup_failed' }); }
    throw Object.assign(new Error('Local database could not be opened.'), { code: 'local_open_failed' });
  }
}
export async function openLocalAccessDatabase(config){return openLocalStorageBindings(config,false);}

/** T32 export opens the exact D1 and R2 bindings from one stopped local runtime. */
export async function openLocalStorage(config){return openLocalStorageBindings(config,true);}

/** Exact active pair selected by the operator; unknown or revoked contexts never fall back to DB. */
export async function openLocalStoragePair(config,contextId='application'){
  return openLocalStorageBindings(config,true,contextId);
}
