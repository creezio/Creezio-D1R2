/** Internal MCP Apps link boundary. No URL from a widget becomes a host navigation without confirmation. */
export function normalizeWidgetOpenLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 9 || value.length > 2048 ||
    !/^https:\/\/[^/?#\\\s]+/iu.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  const authority = value.slice(8).split(/[/?#]/u, 1)[0];
  if (!authority || authority.includes('@')) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password &&
      url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

export interface HostOpenLinkPrompt { readonly id: string; readonly url: string }
export interface HostOpenLinkGate {
  request(url: string, signal?: AbortSignal): Promise<boolean>;
  accept(id: string): boolean;
  cancel(id: string): void;
  dispose(): void;
}

export function createHostOpenLinkGate(options: {
  isCurrent: () => boolean;
  show: (prompt: HostOpenLinkPrompt | null) => void;
  timeoutMs?: number;
  nextId?: () => string;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
}): HostOpenLinkGate {
  let disposed = false;
  let pending: (HostOpenLinkPrompt & {resolve: (accepted: boolean) => void;
    timer: ReturnType<typeof setTimeout>; signal?: AbortSignal; abort?: () => void}) | null = null;
  const schedule = options.schedule ?? setTimeout;
  const unschedule = options.unschedule ?? clearTimeout;
  const settle = (id: string, accepted: boolean): boolean => {
    const item = pending;
    if (!item || item.id !== id) return false;
    pending = null;
    unschedule(item.timer);
    if (item.signal && item.abort) item.signal.removeEventListener('abort', item.abort);
    options.show(null);
    const allowed = accepted && !disposed && options.isCurrent();
    item.resolve(allowed);
    return allowed;
  };
  return {
    request: async (url, signal) => {
      const normalized = normalizeWidgetOpenLink(url);
      if (disposed || pending || !options.isCurrent() || !normalized || signal?.aborted) return false;
      return new Promise<boolean>(resolve => {
        const id = (options.nextId ?? (() => crypto.randomUUID()))();
        const timer = schedule(() => settle(id, false), options.timeoutMs ?? 60_000);
        const abort = () => settle(id, false);
        pending = {id, url: normalized, resolve, timer, signal, abort};
        signal?.addEventListener('abort', abort, {once: true});
        options.show({id, url: normalized});
        if (signal?.aborted) abort();
      });
    },
    accept: id => settle(id, true),
    cancel: id => {settle(id, false);},
    dispose: () => {disposed = true; if (pending) settle(pending.id, false);},
  };
}
