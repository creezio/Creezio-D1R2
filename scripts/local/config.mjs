import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, lstatSync } from 'node:fs';

export const LOCAL_REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const LOCAL_BINDINGS = Object.freeze({ database: 'DB', bucket: 'BUCKET',
  databaseId: '00000000-0000-4000-8000-000000000000', databaseName: 'creezio-local', bucketName: 'creezio-local' });
export const LOCAL_COMPATIBILITY_DATE = '2026-05-15';

/** Local tools have one target. There is no remote/account/database override. */
export function loadLocalConfiguration({ root = LOCAL_REPOSITORY_ROOT,
  origin = process.env.CREEZIO_APP_ORIGIN ?? 'http://127.0.0.1:5173',
  sandboxOrigin = process.env.CREEZIO_WIDGET_SANDBOX_ORIGIN ?? 'http://127.0.0.1:5175',
  operatorOrigin = process.env.CREEZIO_LOCAL_DELIVERY_ORIGIN ?? 'http://127.0.0.1:5176',
  sandboxBindHost = process.env.CREEZIO_WIDGET_SANDBOX_BIND_HOST ?? '127.0.0.1' } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || /[\u0000-\u001f\u007f]/u.test(root) || typeof origin !== 'string') throw new Error('Invalid local configuration.');
  let url;
  try { url = new URL(origin); } catch { throw new Error('Invalid local origin.'); }
  if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Local origin must be canonical HTTP on 127.0.0.1.');
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Local port must be between 1024 and 65535.');
  let sandboxUrl;
  try { sandboxUrl = new URL(sandboxOrigin); } catch { throw new Error('Invalid widget sandbox origin.'); }
  if (sandboxUrl.origin !== sandboxOrigin || sandboxUrl.protocol !== 'http:' ||
    sandboxUrl.hostname !== '127.0.0.1' || sandboxUrl.origin === origin ||
    !Number.isInteger(Number(sandboxUrl.port)) || Number(sandboxUrl.port) < 1024 ||
    Number(sandboxUrl.port) > 65535 || !['127.0.0.1', '0.0.0.0'].includes(sandboxBindHost))
    throw new Error('Widget sandbox needs a distinct canonical loopback origin and local bind host.');
  const operatorUrl = new URL(operatorOrigin);
  if (operatorUrl.origin !== operatorOrigin || operatorUrl.protocol !== 'http:'
    || operatorUrl.hostname !== '127.0.0.1' || [origin,sandboxOrigin].includes(operatorOrigin)
    || Number(operatorUrl.port) < 1024 || Number(operatorUrl.port) > 65535 || !operatorUrl.port)
    throw new Error('Delivery operator needs a distinct canonical loopback origin.');
  const canonicalRoot = path.resolve(root), statePath = path.join(canonicalRoot, '.wrangler', 'state');
  const hostingPath = path.join(canonicalRoot, '.openai', 'hosting.json');
  for (const target of [canonicalRoot, path.dirname(hostingPath), hostingPath]) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (target === hostingPath ? !stat.isFile() || stat.size > 4096 : !stat.isDirectory())) throw new Error('Unsafe local hosting configuration.');
  }
  const hosting = JSON.parse(readFileSync(hostingPath, 'utf8'));
  if (!hosting || hosting.d1 !== LOCAL_BINDINGS.database || hosting.r2 !== LOCAL_BINDINGS.bucket) throw new Error('Local bindings differ from the hosting contract.');
  return Object.freeze({ root: canonicalRoot, origin, host: '127.0.0.1', port,
    operatorOrigin, operatorPort: Number(operatorUrl.port),
    sandboxOrigin, sandboxHost: sandboxBindHost, sandboxPort: Number(sandboxUrl.port),
    statePath, persistenceRoot: path.join(statePath, 'v3'), d1Path: path.join(statePath, 'v3', 'd1'),
    lockPath: path.join(canonicalRoot, '.wrangler', 'creezio-local.lock'),
    bindings: LOCAL_BINDINGS, compatibilityDate: LOCAL_COMPATIBILITY_DATE });
}

export function localWorkerConfiguration(config) {
  return { name: 'creezio', main: 'worker.ts', compatibility_date: config.compatibilityDate,
    compatibility_flags: ['nodejs_compat'],
    vars: { CREEZIO_RUNTIME_PROFILE: 'local', CREEZIO_APP_ORIGIN: config.origin,
      CREEZIO_LOCAL_DELIVERY_ORIGIN: config.operatorOrigin,
      CREEZIO_WIDGET_SANDBOX_ORIGIN: config.sandboxOrigin },
    d1_databases: [{ binding: config.bindings.database, database_name: config.bindings.databaseName, database_id: config.bindings.databaseId }],
    r2_buckets: [{ binding: config.bindings.bucket, bucket_name: config.bindings.bucketName }] };
}

/** Validate the existing build before opening its storage; never silently retarget a build. */
export function assertLocalBuiltConfiguration(value, config) {
  const expected = localWorkerConfiguration(config);
  const sameBindings = (actual, wanted) => Array.isArray(actual) && actual.length === wanted.length
    && actual.every((binding, i) => binding && Object.keys(binding).length === Object.keys(wanted[i]).length
      && Object.keys(wanted[i]).every(key => binding[key] === wanted[i][key]));
  if (!value || value.vars?.CREEZIO_RUNTIME_PROFILE !== 'local' || value.vars?.CREEZIO_APP_ORIGIN !== config.origin
    || value.vars?.CREEZIO_WIDGET_SANDBOX_ORIGIN !== config.sandboxOrigin
    || value.vars?.CREEZIO_LOCAL_DELIVERY_ORIGIN !== config.operatorOrigin
    || value.compatibility_date !== expected.compatibility_date
    || !sameBindings(value.d1_databases, expected.d1_databases)
    || !sameBindings(value.r2_buckets, expected.r2_buckets)) {
    throw new Error('Local build configuration differs. Rebuild for the selected local origin before starting.');
  }
}
