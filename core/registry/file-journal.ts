import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DeliveredPublication, PreparedPublication, PublicationJournal,
  PublicationRecord, SynchronizedPublication } from './publication.ts';

const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_BYTES = 16_384;

export class PublicationJournalError extends Error {
  readonly code: 'invalid_path' | 'invalid_state' | 'busy' | 'unavailable';
  constructor(code: 'invalid_path' | 'invalid_state' | 'busy' | 'unavailable') {
    super(`Publication journal failed (${code}).`);
    this.name = 'PublicationJournalError'; this.code = code;
  }
}
function keyPath(directory: string, key: string): string {
  if (!keyPattern.test(key)) throw new PublicationJournalError('invalid_state');
  const hash = createHash('sha256').update(key).digest('hex');
  const target = path.join(directory, `publication-${hash}.json`);
  if (path.dirname(target) !== directory) throw new PublicationJournalError('invalid_path');
  return target;
}
async function inspectDirectory(directory: string): Promise<void> {
  try {
    const stat = await lstat(directory), actual = await realpath(directory);
    const same = process.platform === 'win32' ? actual.toLowerCase() === directory.toLowerCase() : actual === directory;
    if (!stat.isDirectory() || stat.isSymbolicLink() || !same) throw new Error();
  } catch { throw new PublicationJournalError('invalid_path'); }
}
async function readRecord(file: string): Promise<PublicationRecord | null> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new PublicationJournalError('invalid_state');
    const bytes = await readFile(file);
    if (bytes.byteLength > MAX_BYTES) throw new PublicationJournalError('invalid_state');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as PublicationRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof PublicationJournalError) throw error;
    throw new PublicationJournalError('invalid_state');
  }
}
/** The renamed directory entry must also reach stable storage where the OS supports it. */
async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Node on Windows does not expose a reliable directory flush. File sync and
    // atomic rename still protect process crashes; power-loss durability is not claimed there.
    if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EINVAL', 'EISDIR'].includes(code ?? '')) return;
    throw new PublicationJournalError('unavailable');
  } finally { await handle?.close().catch(() => {}); }
}
async function writeRecord(file: string, record: PublicationRecord): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(record) + '\n');
  if (bytes.byteLength > MAX_BYTES) throw new PublicationJournalError('invalid_state');
  const temp = `${file}.tmp`;
  let handle, created = false;
  try {
    handle = await open(temp, 'wx', 0o600); created = true;
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
    await rename(temp, file);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) await unlink(temp).catch(() => {});
    // A temporary file left by a process crash is never removed automatically.
    throw error instanceof PublicationJournalError ? error : new PublicationJournalError('unavailable');
  }
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Read-only inspection for an operator deciding what to do with a residual lock.
 * It deliberately never removes a lock or a partial temporary file. */
export async function inspectFilePublicationJournal(directory: string, key: string): Promise<Readonly<{
  state: PublicationRecord['state'] | null;
  lockPresent: boolean;
  lockOwnerPid: number | null;
  lockModifiedAt: string | null;
  temporaryPresent: boolean;
}>> {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory)
    throw new PublicationJournalError('invalid_path');
  await inspectDirectory(directory);
  const file = keyPath(directory, key), record = await readRecord(file);
  async function inspectSuffix(suffix: string): Promise<{present: boolean; pid: number | null; modifiedAt: string | null}> {
    const target = `${file}${suffix}`;
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > (suffix === '.lock' ? 4096 : MAX_BYTES))
        throw new PublicationJournalError('invalid_state');
      let pid: number | null = null;
      if (suffix === '.lock') {
        const marker = await readFile(target, 'utf8');
        const match = /^([1-9][0-9]*):[0-9a-f-]{36}\n$/.exec(marker);
        if (match && Number.isSafeInteger(Number(match[1]))) pid = Number(match[1]);
      }
      return {present: true, pid, modifiedAt: stat.mtime.toISOString()};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {present: false, pid: null, modifiedAt: null};
      if (error instanceof PublicationJournalError) throw error;
      throw new PublicationJournalError('invalid_state');
    }
  }
  const lock = await inspectSuffix('.lock'), temporary = await inspectSuffix('.tmp');
  if (record && !['prepared', 'delivered', 'synchronized'].includes(record.state))
    throw new PublicationJournalError('invalid_state');
  return Object.freeze({ state: record?.state ?? null, lockPresent: lock.present,
    lockOwnerPid: lock.pid, lockModifiedAt: lock.modifiedAt, temporaryPresent: temporary.present });
}

/** Node-only, durable journal. The caller chooses an existing private state directory. */
export function createFilePublicationJournal(directoryValue: string): PublicationJournal {
  if (typeof directoryValue !== 'string' || !path.isAbsolute(directoryValue)
    || path.resolve(directoryValue) !== directoryValue) throw new PublicationJournalError('invalid_path');
  const directory = directoryValue;
  async function get(key: string): Promise<PublicationRecord | null> {
    await inspectDirectory(directory);
    return readRecord(keyPath(directory, key));
  }
  async function locked<T>(key: string, action: (file: string) => Promise<T>): Promise<T> {
    await inspectDirectory(directory);
    const file = keyPath(directory, key), lock = `${file}.lock`, marker = `${process.pid}:${randomUUID()}\n`;
    let handle;
    try { handle = await open(lock, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new PublicationJournalError('busy');
      throw new PublicationJournalError('unavailable');
    }
    try {
      await handle.writeFile(marker); await handle.sync();
      return await action(file);
    } finally {
      try {
        const current = await lstat(lock), held = await handle.stat();
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== held.dev || current.ino !== held.ino
          || current.size !== new TextEncoder().encode(marker).byteLength || await readFile(lock, 'utf8') !== marker)
          throw new PublicationJournalError('invalid_path');
        await handle.close(); await unlink(lock);
      } catch (error) {
        await handle.close().catch(() => {});
        throw error instanceof PublicationJournalError ? error : new PublicationJournalError('unavailable');
      }
    }
  }
  return Object.freeze({ get,
    claim(record: PreparedPublication): Promise<PublicationRecord | null> {
      return locked(record.requestKey, async file => {
        const existing = await readRecord(file);
        if (existing) return existing;
        await writeRecord(file, record);
        return null;
      });
    },
    saveDelivered(record: DeliveredPublication): Promise<void> {
      return locked(record.requestKey, async file => {
        const existing = await readRecord(file);
        if (!existing || existing.state !== 'prepared' || !same(existing.request, record.request)
          || !same(existing.preflight, record.preflight)) throw new PublicationJournalError('invalid_state');
        await writeRecord(file, record);
      });
    },
    saveSynchronized(record: SynchronizedPublication): Promise<void> {
      return locked(record.requestKey, async file => {
        const existing = await readRecord(file);
        if (!existing || existing.state !== 'delivered' || !same(existing.request, record.request)
          || !same(existing.preflight, record.preflight) || !same(existing.declaration, record.declaration))
          throw new PublicationJournalError('invalid_state');
        await writeRecord(file, record);
      });
    }
  });
}
