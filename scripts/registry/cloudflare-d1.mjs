/** Operator-only Cloudflare control-plane adapter. Never imported by either Worker. */
export function createRegistryD1Operator({accountId, databaseId, token, fetcher = fetch}) {
  if (!/^[a-f0-9]{32}$/.test(accountId ?? '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(databaseId ?? '')
    || typeof token !== 'string' || token.length < 20 || /\s/.test(token)) throw new Error('Invalid operator configuration.');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const statements = new WeakMap();
  async function batch(input) {
    if (!Array.isArray(input) || !input.length || input.length > 50) throw new Error('Invalid operator batch.');
    const items = input.map(item => {const value = statements.get(item); if (!value) throw new Error('Foreign statement.'); return value;});
    const signal = AbortSignal.timeout(15_000);
    let response, value;
    try {
      response = await fetcher(endpoint, {method: 'POST', redirect: 'error', signal,
        headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({batch: items})});
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const parts = []; let size = 0, chunks = 0;
      const cancel = () => {void reader.cancel().catch(() => {});};
      signal.addEventListener('abort', cancel, {once: true});
      try {
        for (;;) {const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength; if (size > 1_048_576 || ++chunks > 4096) throw new Error(); parts.push(item.value);}
        if (signal.aborted) throw new Error();
        value = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } finally {signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock();}
    } catch {throw new Error('Cloudflare D1 result unavailable; inspect the database before retrying a mutation.');}
    if (!response.ok || value?.success !== true || !Array.isArray(value.result)
      || value.result.length !== items.length || value.result.some(item => item?.success !== true))
      throw new Error('Cloudflare D1 request refused or incomplete; inspect before retrying.');
    return value.result;
  }
  function prepare(sql, params = []) {
    if (typeof sql !== 'string' || !sql.trim() || sql.length > 100_000) throw new Error('Invalid SQL.');
    const statement = Object.freeze({
      bind(...values) {
        if (values.some(value => value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))))
          throw new Error('Invalid SQL parameter.');
        return prepare(sql, values);
      },
      async run() {return (await batch([statement]))[0];},
      async all() {return (await batch([statement]))[0];},
      async first(column) {const row = (await batch([statement]))[0].results?.[0] ?? null; return column === undefined ? row : row?.[column] ?? null;}
    });
    statements.set(statement, {sql, params}); return statement;
  }
  return Object.freeze({prepare, batch});
}
