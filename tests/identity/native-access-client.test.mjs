import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createAccessClient } from '../../sdk/access/client.ts';

const test = (name, run) => nodeTest(name, { timeout: 5000 }, run);
const origin = 'https://creezio.example';
const credentials = () => ({ loginIdentifier: 'native-ui@example.invalid', password: 'Synthetic native UI qualification password' });
const session = (audience = 'admin') => ({ id: '8e5e7a53-10c6-48eb-9ccd-4d8079da0068', principalId: '2fd2384a-efc4-4b6e-965a-6e22f8a46c23',
  displayName: 'Synthetic native account', audience, createdAtMs: 1790467200000, expiresAtMs: 1790496000000 });
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});
const failure = (code, status) => json({ error: { code }, requestId: '22a19821-9556-4fc1-a1de-33a66e8f995e' }, status);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('native client requires an explicit canonical origin and audience before any network request', () => {
  let calls = 0; const fetcher = () => { calls++; assert.fail('Invalid configuration must not fetch'); };
  for (const value of [origin + '/', origin + '/api', origin + '?next=x', origin + '#fragment', 'https://user:password@creezio.example',
    'https://creezio.example:443', 'HTTPS://creezio.example', 'http://creezio.example', '//creezio.example', '', 'null']) {
    assert.throws(() => createAccessClient({ origin: value, audience: 'admin', fetcher }), { message: /./ });
  }
  for (const audience of [undefined, null, '', 'owner', 'ADMIN', '../admin'])
    assert.throws(() => createAccessClient({ origin, audience, fetcher }));
  for (const value of [origin, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
    const client = createAccessClient({ origin: value, audience: 'app', fetcher });
    assert.equal(client.origin, value); assert.equal(client.audience, 'app');
  }
  assert.equal(calls, 0);
});

test('native client fixes same-origin routes, cookie credentials, redirect policy and POST metadata for both audiences', async () => {
  for (const audience of ['admin', 'app']) {
    const calls = [];
    const client = createAccessClient({ origin, audience, fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return String(input).endsWith('/logout') ? json({ ok: true }) : json({ session: session(audience) });
    } });
    assert.equal((await client.readSession()).kind, 'authenticated');
    assert.deepEqual(await client.login(credentials()), { ok: true });
    assert.deepEqual(await client.logout(), { ok: true });
    assert.deepEqual(calls.map(value => value.url), ['session', 'login', 'logout'].map(name => `${origin}/api/access/${audience}/${name}`));
    for (const { init } of calls) {
      assert.equal(init.credentials, 'same-origin'); assert.equal(init.mode, 'same-origin');
      assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
      const headers = new Headers(init.headers);
      for (const forbidden of ['origin', 'cookie', 'authorization', 'oai-authenticated-user-id', 'x-forwarded-for']) assert.equal(headers.has(forbidden), false);
    }
    assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.body, undefined);
    for (const { init } of calls.slice(1)) {
      assert.equal(init.method, 'POST'); assert.equal(init.signal, undefined);
      assert.equal(new Headers(init.headers).get('x-creezio-request'), '1');
      assert.match(new Headers(init.headers).get('content-type'), /^application\/json/);
    }
    assert.deepEqual(JSON.parse(calls[1].init.body), credentials());
    assert.deepEqual(JSON.parse(calls[2].init.body), {});
  }
});

test('a native session is copied and frozen with no role inference or extra credential fields', async () => {
  const expected = session();
  const client = createAccessClient({ origin, audience: 'admin', fetcher: async () => json({ session: expected }) });
  const result = await client.readSession();
  assert.deepEqual(result, { kind: 'authenticated', session: expected });
  assert.ok(Object.isFrozen(result.session));
  assert.deepEqual(Object.keys(result.session).sort(), ['audience', 'createdAtMs', 'displayName', 'expiresAtMs', 'id', 'principalId']);
  expected.displayName = 'Changed outside SDK'; assert.equal(result.session.displayName, 'Synthetic native account');
  assert.throws(() => { result.session.principalId = 'changed'; }, TypeError);
});

test('native client rejects cross-audience, untyped and secret-bearing success projections', async () => {
  const invalid = [
    { session: session('app') }, { session: { ...session(), role: 'owner' } }, { session: { ...session(), token: 'Synthetic secret' } },
    { session: { ...session(), authVersion: 1 } }, { session: { ...session(), expiresAtMs: '1790496000000' } },
    { session: { ...session(), expiresAtMs: session().createdAtMs } }, { session: { ...session(), createdAtMs: -1 } },
    { session: { ...session(), expiresAtMs: Number.MAX_SAFE_INTEGER + 1 } }, { session: { ...session(), principalId: '' } },
    { session: { ...session(), audience: 'owner' } }, { session: null }, {}, [], { ok: true },
  ];
  for (const value of invalid) {
    const client = createAccessClient({ origin, audience: 'admin', fetcher: async () => json(value) });
    assert.deepEqual(await client.readSession(), { kind: 'unavailable', error: 'invalid_response' });
  }
});

test('native client refuses HTML, malformed JSON and unexpected successful HTTP statuses', async () => {
  const responses = [
    () => new Response('<html>Sign in to another service</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => new Response(null, { status: 204 }),
    () => json({ session: session() }, 201),
  ];
  for (const response of responses) {
    const client = createAccessClient({ origin, audience: 'admin', fetcher: async () => response() });
    assert.deepEqual(await client.readSession(), { kind: 'unavailable', error: 'invalid_response' });
  }
});

test('native response reading counts actual bytes, rejects invalid UTF-8 and never waits for a stalled cancellation', async () => {
  let cancelled = 0;
  const oversized = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16_385)); },
    cancel() { cancelled++; return new Promise(() => {}); },
  }), { headers: { 'content-type': 'application/json', 'content-length': '2' } });
  const client = createAccessClient({ origin, audience: 'admin', fetcher: async () => oversized });
  assert.deepEqual(await client.readSession(), { kind: 'unavailable', error: 'invalid_response' });
  assert.equal(cancelled, 1);
  for (const body of [new Uint8Array([0xc3, 0x28]), '\ufeff' + JSON.stringify({ session: session() })]) {
    const malformed = createAccessClient({ origin, audience: 'admin', fetcher: async () =>
      new Response(body, { headers: { 'content-type': 'application/json' } }) });
    assert.deepEqual(await malformed.readSession(), { kind: 'unavailable', error: 'invalid_response' });
  }
});

test('native client rejects a redirect or foreign-origin response even from a custom fetcher', async () => {
  for (const properties of [{ redirected: true }, { url: 'https://other.example/api/access/admin/session' }]) {
    const response = json({ session: session() });
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(response, key, { value });
    const client = createAccessClient({ origin, audience: 'admin', fetcher: async () => response });
    assert.deepEqual(await client.readSession(), { kind: 'unavailable', error: 'invalid_response' });
  }
});

test('native client keeps authentication refusal distinct from unavailable storage and maps only safe UI errors', async () => {
  const cases = [
    [401, 'invalid_credentials', 'invalid_credentials'], [400, 'invalid_input', 'invalid_input'],
    [403, 'origin_denied', 'request_rejected'], [429, 'rate_limited', 'rate_limited'], [503, 'storage_error', 'unavailable'],
  ];
  for (const [status, code, expected] of cases) {
    const client = createAccessClient({ origin, audience: 'admin', fetcher: async input =>
      failure(status === 401 && String(input).endsWith('/session') ? 'authentication_required' : code, status) });
    assert.deepEqual(await client.login(credentials()), { ok: false, error: expected });
    const result = await client.readSession();
    assert.deepEqual(result, status === 401 ? { kind: 'anonymous' } : { kind: 'unavailable', error: expected });
    assert.equal(JSON.stringify(result).includes('storage_error'), false);
  }
});

test('native login captures the allowed input before asynchronous transport and rejects injected audience', async () => {
  let calls = 0, captured; const pending = deferred();
  const client = createAccessClient({ origin, audience: 'admin', fetcher: async (input, init) => {
    calls++; captured = JSON.parse(init.body); await pending.promise; return json({ session: session() });
  } });
  const supplied = credentials(), original = { ...supplied }, request = client.login(supplied);
  supplied.password = 'Changed after dispatch'; supplied.loginIdentifier = 'attacker@example.invalid';
  pending.resolve(); assert.deepEqual(await request, { ok: true }); assert.deepEqual(captured, original);
  for (const input of [null, [], { ...credentials(), audience: 'app' }, { ...credentials(), token: 'not-accepted' },
    { ...credentials(), password: '' }, { ...credentials(), loginIdentifier: '' }]) {
    assert.deepEqual(await client.login(input), { ok: false, error: 'invalid_input' });
  }
  assert.equal(calls, 1);
});

test('native client does not execute input accessors or accept inherited login fields', async () => {
  let calls = 0, reads = 0;
  const client = createAccessClient({ origin, audience: 'admin', fetcher: async () => { calls++; return json({ session: session() }); } });
  const accessor = { loginIdentifier: credentials().loginIdentifier };
  Object.defineProperty(accessor, 'password', { enumerable: true, get() { reads++; return credentials().password; } });
  for (const input of [accessor, Object.create(credentials())])
    assert.deepEqual(await client.login(input), { ok: false, error: 'invalid_input' });
  assert.equal(calls, 0); assert.equal(reads, 0);
});

test('native read forwards cancellation without exposing a successful anonymous result', async () => {
  const abort = new AbortController(); let signal;
  const client = createAccessClient({ origin, audience: 'admin', fetcher: async (input, init) => {
    signal = init.signal;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Synthetic aborted read', 'AbortError')), { once: true }));
  } });
  const pending = client.readSession({ signal: abort.signal }); abort.abort();
  assert.equal(signal.aborted, true);
  assert.deepEqual(await pending, { kind: 'unavailable', error: 'unavailable' });
});

test('native mutations are never retried and neither network failure nor misleading success logs out the UI', async () => {
  let calls = 0;
  const client = createAccessClient({ origin, audience: 'admin', fetcher: async () => { calls++; throw new Error('Synthetic private transport detail'); } });
  assert.deepEqual(await client.login(credentials()), { ok: false, error: 'unavailable' });
  assert.deepEqual(await client.logout(), { ok: false, error: 'unavailable' });
  assert.equal(calls, 2);
  for (const body of [{ ok: false }, { ok: true, token: 'not-public' }, { session: session() }, null]) {
    const misleading = createAccessClient({ origin, audience: 'admin', fetcher: async () => json(body) });
    assert.deepEqual(await misleading.logout(), { ok: false, error: 'invalid_response' });
  }
});
