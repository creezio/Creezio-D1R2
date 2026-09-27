import '../../scripts/local-environment.mjs';
import { createHash } from 'node:crypto';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { loadLocalConfiguration } from '../../scripts/local/config.mjs';
import { acquireLocalRuntimeLock, assertLocalStoragePaths } from '../../scripts/local/lock.mjs';
import { loadAccessInstallPlan, inspectAccessInstallation } from '../../scripts/data/install-access.mjs';

const mode = process.argv[2];
if (!['write', 'read'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node adapters/docker/storage-probe.mjs write|read');
  process.exitCode = 1;
} else {
  const config = loadLocalConfiguration();
  const key = 'qualification/t31/synthetic-object.txt';
  const payload = new TextEncoder().encode('Creezio T31 synthetic R2 persistence probe\n');
  let lease, runtime;
  try {
    lease = await acquireLocalRuntimeLock(config, 'inspect');
    await assertLocalStoragePaths(config);
    runtime = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
      script: 'export default { fetch() { return new Response(null, { status: 404 }); } };',
      compatibilityDate: config.compatibilityDate,
      d1Databases: { [config.bindings.database]: config.bindings.databaseId },
      r2Buckets: { [config.bindings.bucket]: config.bindings.bucketName },
      defaultPersistRoot: config.persistenceRoot,
      unsafeLocalExplorer: false, unsafeTriggerHandlers: false,
      telemetry: { enabled: false }, logRequests: false, log: new Log(LogLevel.NONE) });
    const db = await runtime.getD1Database(config.bindings.database);
    const bucket = await runtime.getR2Bucket(config.bindings.bucket);
    const access = await inspectAccessInstallation(db, loadAccessInstallPlan(config.root));
    if (access.state !== 'initialized') throw new Error(`Access state: ${access.state}`);
    if (mode === 'write') await bucket.put(key, payload);
    const object = await bucket.get(key);
    if (!object) throw new Error('Synthetic R2 object missing.');
    const body = new Uint8Array(await object.arrayBuffer());
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    if (digest(body) !== digest(payload)) throw new Error('Synthetic R2 object differs.');
    console.log(JSON.stringify({ ok: true, access: access.state, r2Key: key,
      bytes: body.byteLength, sha256: digest(body), mode }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error?.code ?? 'probe_failed', message: error?.message }));
    process.exitCode = 1;
  } finally {
    if (runtime) await runtime.dispose();
    if (lease) await lease.release();
  }
}
