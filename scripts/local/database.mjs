import '../local-environment.mjs';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { loadLocalConfiguration } from './config.mjs';
import { assertLocalStoragePaths } from './lock.mjs';

/** Miniflare's own authenticated proxy uses loopback TCP. No operator HTTP handler exists. */
async function openLocalStorageBindings(config,includeBucket) {
  const canonical = loadLocalConfiguration({ root: config.root, origin: config.origin });
  await assertLocalStoragePaths(canonical);
  const instance = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
    script: 'export default { fetch() { return new Response(null, { status: 404 }); } };',
    compatibilityDate: canonical.compatibilityDate,
    d1Databases: { [canonical.bindings.database]: canonical.bindings.databaseId },
    ...(includeBucket?{r2Buckets:{[canonical.bindings.bucket]:canonical.bindings.bucketName}}:{}),
    defaultPersistRoot: canonical.persistenceRoot,
    unsafeLocalExplorer: false, unsafeTriggerHandlers: false,
    telemetry: { enabled: false }, logRequests: false, log: new Log(LogLevel.NONE) });
  try {
    const db = await instance.getD1Database(canonical.bindings.database);
    const bucket=includeBucket?await instance.getR2Bucket(canonical.bindings.bucket):undefined;
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
