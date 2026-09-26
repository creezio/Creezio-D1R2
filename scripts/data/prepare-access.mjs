import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateD1Schema } from './d1-schema.mjs';
import { validateModule } from '../../sdk/contracts/validate.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modulePath = 'extensions/native/access/module/';
function confinedFile(target, missing = false) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Data artifact escapes repository');
  for (let cursor = target; cursor !== path.dirname(root.replace(/[\\/]$/, '')); cursor = path.dirname(cursor)) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Linked data artifact path is not supported'); }
    catch (error) { if (error.code !== 'ENOENT' || !missing) throw error; }
    if (cursor === path.dirname(cursor)) break;
  }
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Data artifact must be a bounded regular file');
  } catch (error) { if (error.code !== 'ENOENT' || !missing) throw error; }
  return target;
}
/** Fixed repository sources only. Generates inert declarations; never opens or changes a database. */
export function prepareAccess({ check = true } = {}) {
  const modelBytes = readFileSync(confinedFile(path.join(root, modulePath, 'models.json')));
  const models = JSON.parse(modelBytes.toString('utf8'));
  const manifestPath = confinedFile(path.join(root, modulePath, 'manifest.json'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.identity.id !== 'creezio.access') throw new Error('Unexpected access module identity');
  manifest.contracts.models = models;
  manifest.identity.source.integrity = `sha256-${createHash('sha256').update(modelBytes).digest('hex')}`;
  const validation = validateModule(manifest);
  if (validation.errors.length) throw new Error(JSON.stringify(validation.errors));
  const generated = generateD1Schema('creezio.access', models);
  const artifacts = new Map([
    [manifestPath, JSON.stringify(manifest, null, 2) + '\n'],
    [path.join(root, 'data/schema/access.sql'), generated.sql],
  ]);
  for (const [target, expected] of artifacts) {
    confinedFile(target, !check);
    if (check) {
      if (readFileSync(target, 'utf8') !== expected) throw new Error(`Generated access artifact differs: ${path.relative(root, target)}; run npm run data:access and review its diff.`);
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, expected);
    }
  }
  return { moduleId: manifest.identity.id, models: models.length, statements: generated.statements.length,
    sqlBytes: Buffer.byteLength(generated.sql), checked: check, databaseChanged: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(argument => argument !== '--write')) throw new Error('Only explicit --write is supported');
  console.log(JSON.stringify(prepareAccess({ check: !process.argv.includes('--write') })));
}
