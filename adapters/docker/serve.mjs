import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createLocalProxy} from './proxy.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const proxy = await createLocalProxy();
const child = spawn(process.execPath, ['scripts/run-framework.mjs', 'dev'], {cwd: root, stdio: 'inherit'});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
try {
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve(status ?? (signal ? 143 : 1)));
  });
  process.exitCode = code;
} finally {
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
  await proxy.close();
}
