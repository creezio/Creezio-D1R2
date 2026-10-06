import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {registryRoot} from './build.mjs';
import {emailDeliveryConfiguration} from './configure.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = emailDeliveryConfiguration();
  const path = resolve(registryRoot, '.creezio/registry/email-delivery-wrangler.json');
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', {mode: 0o600});
  console.log(JSON.stringify({configuration: path, worker: config.name}));
}
