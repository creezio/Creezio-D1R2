import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describeD1Schema } from './d1-schema.mjs';
import { RUNTIME_STORAGE_MODULE_ID, RUNTIME_MODELS, RUNTIME_TABLES } from './runtime-models.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const maximumBytes = 8 * 1024 * 1024;
export class RuntimeSchemaArtifactError extends Error {
  constructor(code) { super('The approved technical runtime SQL artifact could not be prepared.'); this.name = 'RuntimeSchemaArtifactError'; this.code = code; }
}
const fail = code => { throw new RuntimeSchemaArtifactError(code); };
function captureOptions(options) {
  try {
    if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw 0;
    const descriptors = Object.getOwnPropertyDescriptors(options);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !['root', 'check'].includes(key)
      || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) throw 0;
    const root = descriptors.root?.value ?? repository, check = descriptors.check?.value ?? true;
    if (typeof root !== 'string' || !root || typeof check !== 'boolean') throw 0;
    return { root: path.resolve(root), check };
  } catch { fail('runtime.schema-input'); }
}
function artifactPath(root, check) {
  const target = path.join(root, 'data/schema/runtime.sql');
  try {
    if (!lstatSync(root).isDirectory()) throw 0;
    for (let cursor = target;; cursor = path.dirname(cursor)) {
      try { if (lstatSync(cursor).isSymbolicLink()) throw 0; }
      catch (error) { if (error?.code !== 'ENOENT' || check) throw error; }
      if (cursor === path.dirname(cursor)) break;
    }
    try { const stat = lstatSync(target); if (!stat.isFile() || stat.size > maximumBytes) throw 0; }
    catch (error) { if (error?.code !== 'ENOENT' || check) throw error; }
    return target;
  } catch { fail('runtime.schema-path'); }
}

/** Fixed host models only; root changes the artifact destination, never the model source.
 * This operator/build utility creates no connection, applies no SQL and never imports a module. */
export function prepareRuntimeSchema(options = {}) {
  const { root, check } = captureOptions(options), target = artifactPath(root, check);
  const generated = describeD1Schema(RUNTIME_STORAGE_MODULE_ID, RUNTIME_MODELS);
  if (Object.keys(generated.tables).length !== Object.keys(RUNTIME_TABLES).length
    || Object.entries(RUNTIME_TABLES).some(([id, table]) => generated.tables[id] !== table)) fail('runtime.schema-map');
  let current;
  try { current = readFileSync(target, 'utf8'); }
  catch (error) { if (error?.code !== 'ENOENT' || check) throw error; }
  if (check && current !== generated.sql) fail('runtime.schema-mismatch');
  const changed = !check && current !== generated.sql;
  if (changed) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, generated.sql); }
  return Object.freeze({ moduleId: RUNTIME_STORAGE_MODULE_ID, models: RUNTIME_MODELS.length,
    statements: generated.statements.length, sqlBytes: Buffer.byteLength(generated.sql),
    sqlDigest: `sha256-${createHash('sha256').update(generated.sql).digest('hex')}`,
    checked: check, artifactChanged: changed, databaseChanged: false });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(argument => argument !== '--write')) fail('runtime.schema-input');
  console.log(JSON.stringify(prepareRuntimeSchema({ check: !process.argv.includes('--write') })));
}
