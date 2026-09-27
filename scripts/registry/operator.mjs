import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bootstrapRegistry} from '../../services/registry/bootstrap.ts';
import {createRegistryD1Operator} from './cloudflare-d1.mjs';

/** Explicit maintainer operation; no HTTP bootstrap endpoint and no app database. */
export async function registryOperator(mode, env = process.env) {
  const db = createRegistryD1Operator({accountId: env.CLOUDFLARE_ACCOUNT_ID,
    databaseId: env.CREEZIO_REGISTRY_DATABASE_ID, token: env.CLOUDFLARE_API_TOKEN});
  if (mode === 'inspect') {
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'registry_%' ORDER BY name").all();
    return {tables: tables.results.map(row => row.name)};
  }
  if (mode === 'initialize') {
    const existing = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
    if (existing.results.length) throw new Error('Initialization requires an empty dedicated registry D1.');
    const schema = await readFile(new URL('../../services/registry/schema.sql', import.meta.url), 'utf8');
    const statements = schema.split(';').map(value => value.trim()).filter(Boolean);
    await db.batch(statements.map(sql => db.prepare(sql)));
    return {initialized: true, statements: statements.length};
  }
  if (mode === 'bootstrap') {
    return bootstrapRegistry(db, {maintainerEmail: env.CREEZIO_REGISTRY_MAINTAINER_EMAIL,
      serviceId: env.CREEZIO_REGISTRY_WORKER_NAME});
  }
  throw new Error('Usage: registry operator inspect|initialize|bootstrap (bootstrap credential output is confidential).');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'bootstrap' && process.stdout.isTTY)
      throw new Error('Capture bootstrap output directly into a private credential store; terminal display is refused.');
    console.log(JSON.stringify(await registryOperator(process.argv[2])));
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
