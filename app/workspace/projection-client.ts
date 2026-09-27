import type { WorkspaceAuthorizationProjection } from '../../core/workspace/authorization.ts';
import type { AccessSession } from '../../sdk/access/types.ts';

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const ids = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length <= 1000
  && value.every(item => typeof item === 'string' && item.length <= 256 && /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/.test(item))
  && new Set(value).size === value.length;

export class WorkspaceAccessRefused extends Error {
  constructor() { super('projection_access_refused'); }
}

/** A display projection is adopted only for the exact verified native session. */
export function acceptProjection(value: unknown, expected: {session: AccessSession; contextId: string; compositionDigest: string}): WorkspaceAuthorizationProjection | null {
  if (!plain(value) || Object.keys(value).length !== 1 || !plain(value.projection)) return null;
  const p = value.projection;
  const fields = ['sessionId','principalId','audience','contextId','compositionDigest','epoch','viewIds','navigationIds'];
  if (Object.keys(p).length !== fields.length || fields.some(field => !Object.hasOwn(p, field))
    || p.sessionId !== expected.session.id || p.principalId !== expected.session.principalId
    || p.audience !== expected.session.audience || p.contextId !== expected.contextId
    || p.compositionDigest !== expected.compositionDigest || !Number.isSafeInteger(p.epoch) || (p.epoch as number) < 0
    || !ids(p.viewIds) || !ids(p.navigationIds)) return null;
  return Object.freeze({...p, viewIds: Object.freeze([...p.viewIds]), navigationIds: Object.freeze([...p.navigationIds])}) as unknown as WorkspaceAuthorizationProjection;
}

export async function readProjection(options: {origin: string; session: AccessSession; contextId: string; compositionDigest: string; signal: AbortSignal}) {
  const response = await fetch(`${options.origin}/api/workspace/${options.session.audience}/projection`, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: options.signal,
    headers: {accept: 'application/json', 'x-creezio-context': options.contextId},
  });
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => {});
    throw new WorkspaceAccessRefused();
  }
  if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body)
    throw new Error('projection_unavailable');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
  let bytes = 0, text = '';
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 524288) { void reader.cancel().catch(() => {}); throw new Error('projection_too_large'); }
      text += decoder.decode(part.value, {stream: true});
    }
  } finally { reader.releaseLock(); }
  const projection = acceptProjection(JSON.parse(text + decoder.decode()), options);
  if (!projection) throw new Error('invalid_projection');
  return projection;
}
