import './local-environment.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { loadLocalConfiguration, assertLocalBuiltConfiguration } from './local/config.mjs';
import { acquireLocalRuntimeLock } from './local/lock.mjs';

/** The parent retains its lock until the real child closes, including cancellation. */
export async function runLockedLocalRuntime(command, config, { spawnChild = spawn, acquireLock = acquireLocalRuntimeLock } = {}) {
  if (!['dev', 'start'].includes(command)) throw new Error('Expected a local runtime command.');
  const lock = await acquireLock(config, command);
  try {
    const preload = ['--import', pathToFileURL(path.join(config.root, 'scripts/local-environment.mjs')).href,
      '--import', pathToFileURL(path.join(config.root, 'scripts/local/runtime-child-lifecycle.mjs')).href];
    let args;
    if (command === 'start') {
      const configPath = path.join(config.root, 'dist/server/wrangler.json');
      assertLocalBuiltConfiguration(JSON.parse(await readFile(configPath, 'utf8')), config);
      args = [...preload,
        path.join(config.root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', configPath,
        '--local', '--persist-to', config.statePath, '--ip', config.host, '--port', String(config.port), '--inspector-port', '0'];
    } else args = [...preload,
      path.join(config.root, 'node_modules/vinext/dist/cli.js'), 'dev', '--host', config.host, '--port', String(config.port)];
    return await new Promise((resolve, reject) => {
      const child = spawnChild(process.execPath, args, { cwd: config.root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, CREEZIO_APP_ORIGIN: config.origin }, windowsHide: true });
      let failed, signalSent = false;
      const interrupt = () => {
        if (signalSent) return; signalSent = true;
        // Windows child.kill(SIGINT) can bypass async teardown. Use the private IPC channel.
        if (child.connected && typeof child.send === 'function') {
          try { child.send({ type: 'creezio-local-stop', version: 1 }, () => {}); } catch { /* Retain the lock until real close. */ }
        }
        // If delivery is unavailable, await close and retain the lock; never claim cancellation.
      };
      const onInt = interrupt, onTerm = interrupt;
      process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
      child.once('error', error => { failed = error; });
      child.once('close', (code, signal) => {
        process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
        if (failed) reject(new Error('Local runtime could not be launched.'));
        else resolve(code ?? (signal === 'SIGINT' ? 130 : 143));
      });
    });
  } finally { await lock.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build') {
    // Build does not open the application database. Preserve the existing build entry point.
    const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
    process.argv = [process.execPath, fileURLToPath(cli), command, ...args];
    await import(cli.href);
  } else if (['dev', 'start'].includes(command) && args.length === 0) {
    try { process.exitCode = await runLockedLocalRuntime(command, loadLocalConfiguration()); }
    catch { console.error('Local runtime unavailable: check its configuration and local storage lock.'); process.exitCode = 1; }
  } else { console.error('Expected dev, build or start. Local runtime commands accept no override arguments.'); process.exitCode = 1; }
}
