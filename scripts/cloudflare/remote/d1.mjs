/** Cloudflare D1 REST transport for the local T32 operator. Never imported by a Worker. */
import {SCHEMA_LIMITS} from '../../data/composition-schema.mjs';
const ACCOUNT = /^[a-f0-9]{32}$/;
const DATABASE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
// The central schema applies its guards, up to 1024 objects and receipt in one D1 batch.
const MAX_STATEMENTS = SCHEMA_LIMITS.objects + 8;
const MAX_PARAMETERS = 100;
const MAX_SQL_BYTES = 100_000;
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8_000_000;

export class RemoteD1Error extends Error {
  constructor(code, status = null) {
    super(`Remote D1 ${code}.`);
    this.name = 'RemoteD1Error';
    this.code = code;
    this.status = status;
  }
}
const fail = (code, status) => { throw new RemoteD1Error(code, status); };
const bytes = value => Buffer.byteLength(value, 'utf8');

function checkedStatement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.sql !== 'string' || !input.sql.trim() ||
      bytes(input.sql) > MAX_SQL_BYTES ||
      !Array.isArray(input.params) || input.params.length > MAX_PARAMETERS ||
      input.params.some(value => value !== null && typeof value !== 'string' &&
        !(typeof value === 'number' && Number.isFinite(value)))) fail('invalid_query');
  return {sql: input.sql, params: input.params};
}

async function boundedJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) fail('unavailable', response.status);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES || chunks.length >= 4096) fail('response_too_large', response.status);
      chunks.push(value);
    }
    if (signal.aborted) fail('unavailable', response.status);
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch (error) {
    if (error instanceof RemoteD1Error) throw error;
    fail('unavailable', response.status);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createRemoteD1Client({accountId, databaseId, token, fetcher = fetch}) {
  if (!ACCOUNT.test(accountId ?? '') || !DATABASE.test(databaseId ?? '') ||
      typeof token !== 'string' || token.length < 20 || /\s/.test(token) ||
      typeof fetcher !== 'function') fail('invalid_configuration');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;

  async function request(path, method, body) {
    const signal = AbortSignal.timeout(30_000);
    let response;
    try {
      response = await fetcher(base + path, {method, redirect: 'error', signal,
        headers: {authorization: `Bearer ${token}`, ...(body ? {'content-type': 'application/json'} : {})}, body});
    } catch { fail('unavailable'); }
    if (!response || typeof response.status !== 'number') fail('unavailable');
    const value = await boundedJson(response, signal);
    if (!response.ok || value?.success !== true) fail('refused', response.status);
    return value;
  }

  async function batch(inputs) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_STATEMENTS) fail('invalid_query');
    const statements = inputs.map(checkedStatement);
    const body = JSON.stringify({batch: statements});
    if (bytes(body) > MAX_BODY_BYTES) fail('invalid_query');
    const value = await request('/query', 'POST', body);
    if (!Array.isArray(value.result) || value.result.length !== statements.length ||
        value.result.some(item => item?.success !== true || !Array.isArray(item.results))) {
      fail('incomplete');
    }
    return value.result;
  }

  async function query(statement) { return (await batch([statement]))[0]; }
  async function metadata() {
    const value = await request('', 'GET');
    if (value.result?.uuid !== databaseId) fail('identity_mismatch');
    return value.result;
  }
  return Object.freeze({metadata, query, batch});
}
