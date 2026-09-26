import { lstat, mkdir, open, readFile, unlink, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadLocalConfiguration } from './config.mjs';

export class LocalRuntimeLockError extends Error {
  constructor(code) { super(code === 'local_busy' ? 'Local storage is locked. Stop its official runtime first; an existing lock is never removed automatically.' : 'Local storage path or lock is unsafe.'); this.code = code; }
}

/** Check each local path component. Existing junctions/symlinks are never followed. */
export async function assertLocalStoragePaths(config, { createParent = false } = {}) {
  const rootStat = await lstat(config.root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new LocalRuntimeLockError('local_path');
  const actualRoot = await realpath(config.root);
  const equal = process.platform === 'win32' ? actualRoot.toLowerCase() === config.root.toLowerCase() : actualRoot === config.root;
  if (!equal) throw new LocalRuntimeLockError('local_path');
  for (const suffix of ['.wrangler', '.wrangler/state', '.wrangler/state/v3', '.wrangler/state/v3/d1', '.wrangler/state/v3/r2']) {
    const target = path.join(config.root, suffix);
    try {
      const stat = await lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LocalRuntimeLockError('local_path');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (suffix === '.wrangler' && createParent) {
        try { await mkdir(target); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
        const stat = await lstat(target);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LocalRuntimeLockError('local_path');
      }
    }
  }
  // The runtime opens files below these roots too: reject linked namespace/database entries.
  const pending = [config.d1Path, path.join(config.persistenceRoot, 'r2')];
  let inspected = 0;
  while (pending.length) {
    const target = pending.pop();
    let stat;
    try { stat = await lstat(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (++inspected > 10000 || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new LocalRuntimeLockError('local_path');
    if (stat.isDirectory()) {
      const entries = await readdir(target);
      if (entries.length + pending.length + inspected > 10000) throw new LocalRuntimeLockError('local_path');
      for (const name of entries) pending.push(path.join(target, name));
    }
  }
}

/** Cooperative exclusion for official dev/start/operator commands, not an OS database lock. */
export async function acquireLocalRuntimeLock(config, purpose) {
  if (!['dev', 'start', 'inspect', 'install'].includes(purpose)) throw new LocalRuntimeLockError('local_path');
  const canonical = loadLocalConfiguration({ root: config.root, origin: config.origin });
  await assertLocalStoragePaths(canonical, { createParent: true });
  const owner = Object.freeze({ version: 1, nonce: randomUUID(), pid: process.pid, purpose,
    statePath: canonical.statePath, createdAt: new Date().toISOString() });
  let handle;
  try { handle = await open(canonical.lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new LocalRuntimeLockError('local_busy'); throw new LocalRuntimeLockError('local_path'); }
  const bytes = JSON.stringify(owner) + '\n';
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch { await handle.close(); throw new LocalRuntimeLockError('local_path'); }
  let releasePromise;
  return Object.freeze({ owner, release() {
    return releasePromise ??= (async () => {
    try {
      const opened = await handle.stat(), current = await lstat(canonical.lockPath);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino
        || current.size > 4096 || await readFile(canonical.lockPath, 'utf8') !== bytes) throw new LocalRuntimeLockError('local_path');
      await handle.close();
      await unlink(canonical.lockPath);
    } catch (error) { await handle.close().catch(() => {}); throw error; }
    })();
  } });
}
