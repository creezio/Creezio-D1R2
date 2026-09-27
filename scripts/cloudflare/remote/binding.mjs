/** D1 binding facade for the existing central schema installer; no schema rules live here. */
export function createRemoteD1Binding(client) {
  if (!client || typeof client.query !== 'function' || typeof client.batch !== 'function')
    throw new Error('Invalid remote D1 client.');
  const values = new WeakMap();
  function prepare(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new Error('Invalid remote D1 statement.');
    function statement(params) {
      const current = Object.freeze({
        bind(...next) { return statement(next); },
        run() { return client.query({sql, params}); },
        all() { return client.query({sql, params}); },
        async first(column) {
          const row = (await client.query({sql, params})).results?.[0] ?? null;
          return column === undefined ? row : row?.[column] ?? null;
        }
      });
      values.set(current, {sql, params});
      return current;
    }
    return statement([]);
  }
  async function batch(statements) {
    if (!Array.isArray(statements) || statements.some(item => !values.has(item)))
      throw new Error('Foreign remote D1 statement.');
    return client.batch(statements.map(item => values.get(item)));
  }
  return Object.freeze({prepare, batch});
}
