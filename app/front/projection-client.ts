import type { AccessSession } from '../../sdk/access/types.ts';
import type { FrontProjection } from '../../sdk/front/types.ts';

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const ids = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length <= 1000
  && value.every(item => typeof item === 'string' && item.length <= 256 && /^[a-z][a-z0-9._-]*:[a-z][a-z0-9._-]*$/.test(item))
  && new Set(value).size === value.length;

export class FrontAccessRefused extends Error {
  constructor() { super('front_projection_access_refused'); }
}

export function acceptFrontProjection(value: unknown,
  expected: {session: AccessSession; contextId: string; compositionDigest: string}): FrontProjection | null {
  if (!plain(value) || Object.keys(value).length !== 1 || !plain(value.projection)) return null;
  const p = value.projection;
  const fields = ['sessionId','principalId','audience','contextId','compositionDigest','epoch','viewIds','navigationIds','slotIds'];
  if (Object.keys(p).length !== fields.length || fields.some(field => !Object.hasOwn(p, field))
    || p.sessionId !== expected.session.id || p.principalId !== expected.session.principalId
    || p.audience !== 'app' || expected.session.audience !== 'app' || p.contextId !== expected.contextId
    || p.compositionDigest !== expected.compositionDigest || !Number.isSafeInteger(p.epoch) || (p.epoch as number) < 0
    || !ids(p.viewIds) || !ids(p.navigationIds) || !ids(p.slotIds)) return null;
  return Object.freeze({...p, viewIds: Object.freeze([...p.viewIds]),
    navigationIds: Object.freeze([...p.navigationIds]), slotIds: Object.freeze([...p.slotIds])}) as unknown as FrontProjection;
}

export async function readFrontProjection(options: {origin: string; session: AccessSession; contextId: string;
  compositionDigest: string; signal: AbortSignal}): Promise<FrontProjection> {
  const response = await fetch(`${options.origin}/api/front/projection`, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', mode: 'same-origin', signal: options.signal,
    headers: {accept: 'application/json', 'x-creezio-context': options.contextId},
  });
  if (response.status === 401 || response.status === 403) {
    void response.body?.cancel().catch(() => {});
    throw new FrontAccessRefused();
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
  const projection = acceptFrontProjection(JSON.parse(text + decoder.decode()), options);
  if (!projection) throw new Error('invalid_projection');
  return projection;
}
