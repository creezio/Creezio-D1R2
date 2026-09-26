import { canonicalAccessOrigin, isAccessAudience, type AccessCoordinator, type AccessScope } from './types.ts';

export interface AccessLockProvider {
  request<T>(name: string, options: {mode: 'exclusive'}, task: () => Promise<T>): Promise<T>;
}
export interface AccessBroadcastPort {
  postMessage(value: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}
export interface AccessCoordinatorOptions {
  locks?: AccessLockProvider | null;
  broadcast?: ((name: string) => AccessBroadcastPort) | null;
}

// Coordination only, never credentials, sessions, rights or account data.
// These shared queues cover all controllers/coordinators in this document.
const queues = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();
function scopeKey(scope: AccessScope) {
  if (!scope || !canonicalAccessOrigin(scope.origin) || !isAccessAudience(scope.audience)) throw new Error('Invalid native access coordination scope.');
  return JSON.stringify([scope.origin, scope.audience]);
}
function notify(key: string) {
  for (const listener of [...(listeners.get(key) ?? [])]) {
    try { listener(); } catch { /* one observer cannot break the queue or other observers */ }
  }
}

/** Web Locks coordinate cooperating documents of the origin. Without them the
 * guarantee is explicitly document-only. Unload can release a lock; neither
 * this queue nor BroadcastChannel is a server-side mutation transaction.
 */
export function createAccessCoordinator(options: AccessCoordinatorOptions = {}): AccessCoordinator {
  const browser = typeof window !== 'undefined';
  const locks: AccessLockProvider | null = options.locks === undefined ? (browser && navigator.locks ? navigator.locks : null) : options.locks;
  const broadcast = options.broadcast === undefined
    ? (browser && typeof BroadcastChannel === 'function' ? (name: string) => new BroadcastChannel(name) : null) : options.broadcast;
  let channel: AccessBroadcastPort | null = null, subscriptions = 0;
  const receive = (event: MessageEvent) => {
    // Notifications invalidate local state only. No identity, token or rights
    // can be adopted from another document, even if it forges this message.
    const data: unknown = event.data;
    try {
      if (!data || typeof data !== 'object') return;
      const descriptors = Object.getOwnPropertyDescriptors(data);
      if (Reflect.ownKeys(descriptors).length !== 4
        || !['version', 'type', 'origin', 'audience'].every(key => descriptors[key] && 'value' in descriptors[key])) return;
      if (descriptors.version.value !== 1 || descriptors.type.value !== 'invalidate') return;
      const scope = {origin: descriptors.origin.value, audience: descriptors.audience.value};
      notify(scopeKey(scope));
    } catch { /* malformed messages never establish state */ }
  };
  const open = () => {
    if (!channel && broadcast) {
      try { channel = broadcast('creezio-native-access-v1'); channel.addEventListener('message', receive); }
      catch { channel = null; }
    }
    return channel;
  };
  const closeUnused = () => {
    if (!subscriptions && channel) {
      try { channel.removeEventListener('message', receive); channel.close(); } catch { /* optional notification transport */ }
      channel = null;
    }
  };
  return Object.freeze({mode: locks ? 'origin' as const : 'document' as const,
    async runExclusive<T>(scope: AccessScope, task: () => Promise<T>): Promise<T> {
      const key = scopeKey(scope), previous = queues.get(key) ?? Promise.resolve();
      const result = previous.then(() => locks
        ? locks.request(`creezio-native-access:${key}`, {mode: 'exclusive'}, task) : task());
      const settled = result.then(() => {}, () => {});
      queues.set(key, settled);
      void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
      return result;
    },
    subscribe(scope: AccessScope, listener: () => void) {
      const key = scopeKey(scope);
      if (typeof listener !== 'function') throw new Error('Invalid native access observer.');
      const observers = listeners.get(key) ?? new Set<() => void>();
      // Each subscription has its own identity even if the callback is reused.
      const observer = () => listener(); observers.add(observer); listeners.set(key, observers);
      subscriptions++; open();
      let active = true;
      return () => {
        if (!active) return; active = false;
        observers.delete(observer); if (!observers.size) listeners.delete(key);
        subscriptions--; closeUnused();
      };
    },
    invalidate(scope: AccessScope) {
      const key = scopeKey(scope);
      notify(key);
      try { open()?.postMessage({version: 1, type: 'invalidate', origin: scope.origin, audience: scope.audience}); }
      catch { /* focus/pageshow/visibility refresh remain independent */ }
      finally { closeUnused(); }
    },
  });
}
