// Qualification worker only. No public route or product import references this file.
const TABLE = 'creezio_t03_qualification';

async function record(env) {
  const row = await env.DB.prepare(`SELECT value FROM ${TABLE} WHERE id = ?`).bind('roundtrip').first();
  const object = await env.BUCKET.get('qualification/t03/roundtrip.txt');
  return { database: row?.value ?? null, object: object ? await object.text() : null };
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/roundtrip' && request.method === 'POST') {
      const value = 'Creezio T03 — synthetic persistent fixture';
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
      await env.DB.prepare(`INSERT INTO ${TABLE} (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`)
        .bind('roundtrip', value).run();
      await env.BUCKET.put('qualification/t03/roundtrip.txt', value, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
      return Response.json(await record(env));
    }
    if (path === '/record' && request.method === 'GET') return Response.json(await record(env));
    return new Response('Qualification route unavailable', { status: 404 });
  },
};
