import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {registryRoot} from './build.mjs';

/** No credential is written to the Wrangler configuration. */
export function registryConfiguration(env = process.env) {
  const account = env.CLOUDFLARE_ACCOUNT_ID, database = env.CREEZIO_REGISTRY_DATABASE_ID;
  const name = env.CREEZIO_REGISTRY_WORKER_NAME, origin = env.CREEZIO_REGISTRY_ORIGIN;
  let url;
  try { url = new URL(origin); } catch { throw new Error('Missing canonical registry origin.'); }
  if (!/^[a-f0-9]{32}$/.test(account ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(database ?? '')
    || !/^[a-z][a-z0-9-]{1,62}$/.test(name ?? '') || url.protocol !== 'https:'
    || url.origin !== origin || url.username || url.password)
    throw new Error('Invalid explicit registry deployment configuration.');
  return {name, account_id: account, main: resolve(registryRoot, '.quality/registry/worker.mjs'),
    compatibility_date: '2026-05-15', workers_dev: true, preview_urls: false, no_bundle: true,
    vars: {REGISTRY_ORIGIN: origin},
    d1_databases: [{binding: 'DB', database_name: name, database_id: database}],
    observability: {enabled: false}};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = registryConfiguration();
  const path = resolve(registryRoot, '.creezio/registry/wrangler.json');
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({configuration: path, worker: config.name, origin: config.vars.REGISTRY_ORIGIN}));
}
