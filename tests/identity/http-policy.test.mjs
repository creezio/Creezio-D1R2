import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessHttpError, HTTP_POLICY, resolveAccessHttpConfiguration, validateAccessHttpRequest,
  readAccessJson, readAccessCookie, serializeAccessCookie, clearAccessCookie } from '../../core/identity/http-policy.ts';
import { issueOpaqueToken, digestOpaqueToken } from '../../core/identity/tokens.ts';

const origin = 'https://example.invalid';
const config = () => resolveAccessHttpConfiguration({ CREEZIO_APP_ORIGIN: origin }, 'sites');
const local = () => resolveAccessHttpConfiguration({ CREEZIO_APP_ORIGIN: 'http://127.0.0.1:5173' }, 'local');
const headers = () => ({ origin, 'x-creezio-request': '1', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' });
const post = (options = {}) => new Request(`${origin}/api/access/app/login`, { method: 'POST', headers: headers(), body: '{}', ...options });
const error = (code, status) => value => value instanceof AccessHttpError && value.code === code && value.status === status
  && value.message === 'Native access request rejected.' && !('cause' in value);
const encode = text => new TextEncoder().encode(text);
function streamRequest(chunks, options = {}) {
  return post({ body: new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk); controller.close();
  } }), duplex: 'half', ...options });
}

test('HTTP configuration accepts only explicit canonical deployment origins and isolated local cookie names', () => {
  assert.deepEqual(HTTP_POLICY, { maxHeaderBytes: 8192, maxBodyBytes: 16384, bodyDeadlineMs: 10000 });
  for (const profile of ['sites', 'cloudflare', 'local']) {
    const value = resolveAccessHttpConfiguration({ CREEZIO_APP_ORIGIN: origin }, profile);
    assert.deepEqual(value, { origin, secureCookies: true, cookieNames: { admin: '__Host-creezio-admin', app: '__Host-creezio-app' }, networkIdentity: 'unavailable' });
    assert.ok(Object.isFrozen(value) && Object.isFrozen(value.cookieNames));
  }
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const configuredOrigin = `http://${hostname}:5173`;
    const value = resolveAccessHttpConfiguration({ CREEZIO_APP_ORIGIN: configuredOrigin }, 'local');
    assert.equal(value.origin, configuredOrigin); assert.equal(value.secureCookies, false);
    assert.deepEqual(value.cookieNames, { admin: 'creezio-local-admin', app: 'creezio-local-app' });
    for (const profile of ['sites', 'cloudflare']) assert.equal(resolveAccessHttpConfiguration({ CREEZIO_APP_ORIGIN: configuredOrigin }, profile), null);
  }
  const mutable = { CREEZIO_APP_ORIGIN: origin }, captured = resolveAccessHttpConfiguration(mutable, 'sites');
  mutable.CREEZIO_APP_ORIGIN = 'https://other.invalid'; assert.equal(captured.origin, origin);
});

test('origins never come from request metadata, inherited fields, accessors or noncanonical URLs', () => {
  const getter = {}; Object.defineProperty(getter, 'CREEZIO_APP_ORIGIN', { get() { assert.fail('Getter must not run'); } });
  for (const value of [null, {}, getter, Object.create({ CREEZIO_APP_ORIGIN: origin }), { headers: { host: 'example.invalid' } }])
    assert.equal(resolveAccessHttpConfiguration(value, 'sites'), null);
  for (const value of [origin + '/', origin + '/api', origin + '?x=1', origin + '#fragment', 'https://user:pass@example.invalid',
    'HTTPS://example.invalid', 'https://example.invalid:443', ` ${origin}`, `${origin} `, 'http://example.invalid',
    'http://127.0.0.2:5173', 'http://127.1:5173', 'http://localhost.example.invalid', 'http://2130706433',
    '//example.invalid', 'null', 'file:///tmp', 'javascript:alert(1)', origin + 'a'.repeat(2048)]) {
    assert.equal(resolveAccessHttpConfiguration({ CREEZIO_APP_ORIGIN: value }, 'local'), null, value);
  }
  assert.equal(resolveAccessHttpConfiguration({ CREEZIO_APP_ORIGIN: origin }, 'guessed-profile'), null);
});

test('origin and mutation gates are exact and reject cross-site or ambiguous header values', () => {
  assert.doesNotThrow(() => validateAccessHttpRequest(post(), config(), { mutation: true }));
  for (const supplied of [null, 'null', 'https://evil.invalid', `${origin}, ${origin}`, origin + '/']) {
    const value = headers(); if (supplied === null) delete value.origin; else value.origin = supplied;
    assert.throws(() => validateAccessHttpRequest(post({ headers: value }), config(), { mutation: true }), error('origin_denied', 403));
  }
  for (const supplied of [null, '0', '1, 1', '1,0']) {
    const value = headers(); if (supplied === null) delete value['x-creezio-request']; else value['x-creezio-request'] = supplied;
    assert.throws(() => validateAccessHttpRequest(post({ headers: value }), config(), { mutation: true }), error('request_header_required', 403));
  }
  for (const supplied of ['cross-site', 'same-site', 'cross-site, same-origin', 'unknown']) {
    assert.throws(() => validateAccessHttpRequest(post({ headers: { ...headers(), 'sec-fetch-site': supplied } }), config(), { mutation: true }), error('origin_denied', 403));
  }
  const alien = new Request('https://evil.invalid/api/access/app/login', { method: 'POST', headers: headers(), body: '{}' });
  assert.throws(() => validateAccessHttpRequest(alien, config(), { mutation: true }), error('origin_denied', 403));
});

test('GET may omit Origin but cannot cross origin, use query parameters, or borrow mutation methods', () => {
  const get = extra => new Request(`${origin}/api/access/app/session`, extra);
  assert.doesNotThrow(() => validateAccessHttpRequest(get(), config(), { mutation: false }));
  assert.doesNotThrow(() => validateAccessHttpRequest(get({ headers: { origin, 'sec-fetch-site': 'same-origin' } }), config(), { mutation: false }));
  for (const header of [{ origin: 'https://evil.invalid' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }])
    assert.throws(() => validateAccessHttpRequest(get({ headers: header }), config(), { mutation: false }), error('origin_denied', 403));
  assert.throws(() => validateAccessHttpRequest(new Request(`${origin}/api/access/app/session?audience=admin`), config(), { mutation: false }), error('query_not_allowed', 400));
  for (const method of ['HEAD', 'OPTIONS', 'DELETE']) assert.throws(() => validateAccessHttpRequest(get({ method }), config(), { mutation: false }), error('method_not_allowed', 405));
  assert.throws(() => validateAccessHttpRequest(get(), config(), { mutation: true }), error('method_not_allowed', 405));
});

test('body metadata is explicit and header budgets are based on aggregate UTF-8 bytes', () => {
  for (const contentType of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset="UTF-8"'])
    assert.doesNotThrow(() => validateAccessHttpRequest(post({ headers: { ...headers(), 'content-type': contentType } }), config(), { mutation: true }));
  for (const contentType of ['text/plain', 'application/json; charset=latin1', 'application/json, application/json', 'application/json; extra=true'])
    assert.throws(() => validateAccessHttpRequest(post({ headers: { ...headers(), 'content-type': contentType } }), config(), { mutation: true }), error('unsupported_media_type', 415));
  for (const encoding of ['gzip', 'identity']) assert.throws(() => validateAccessHttpRequest(post({ headers: { ...headers(), 'content-encoding': encoding } }), config(), { mutation: true }), error('unsupported_content_encoding', 415));
  for (const length of ['-1', '+2', '2, 2', '2.0', '01', 'invalid'])
    assert.throws(() => validateAccessHttpRequest(post({ headers: { ...headers(), 'content-length': length } }), config(), { mutation: true }), error('invalid_content_length', 400));
  assert.throws(() => validateAccessHttpRequest(post({ headers: { ...headers(), 'content-length': '16385' } }), config(), { mutation: true }), error('body_too_large', 413));
  for (const extra of [{ a: 'x'.repeat(8192) }, { a: 'x'.repeat(4500), b: 'x'.repeat(4500) }, { a: 'é'.repeat(4200) }])
    assert.throws(() => validateAccessHttpRequest(post({ headers: { ...headers(), ...extra } }), config(), { mutation: true }), error('headers_too_large', 431));
});

test('JSON reader counts actual bytes, handles split UTF-8 and keeps content-length a precheck only', async () => {
  const bytes = encode('{"name":"é🙂"}');
  assert.deepEqual(await readAccessJson(streamRequest([...bytes].map(byte => new Uint8Array([byte])))), { name: 'é🙂' });
  assert.deepEqual(await readAccessJson(post()), {});
  const exact = '"' + 'a'.repeat(16382) + '"';
  assert.equal((await readAccessJson(streamRequest([encode(exact)]))).length, 16382);
  await assert.rejects(readAccessJson(streamRequest([encode(exact), encode(' ')], { headers: { ...headers(), 'content-length': '1' } })), error('body_too_large', 413));
  await assert.rejects(readAccessJson(streamRequest([encode('"' + 'é'.repeat(8192) + '"')])), error('body_too_large', 413));
});

test('invalid UTF-8, malformed JSON and arbitrary producer failures never leak diagnostics', async () => {
  for (const chunks of [[new Uint8Array([0xc3])], [new Uint8Array([0xc3, 0x28])], [encode('{')], [encode('')],
    [new Uint8Array([0xef, 0xbb, 0xbf]), encode('{}')]]) {
    await assert.rejects(readAccessJson(streamRequest(chunks)), error('invalid_json', 400));
  }
  const diagnostic = 'synthetic-private-diagnostic';
  for (const thrown of [new Error(diagnostic), new AccessHttpError(diagnostic, 500)]) {
    const request = post({ body: new ReadableStream({ start(controller) { controller.error(thrown); } }), duplex: 'half' });
    await assert.rejects(readAccessJson(request), error('invalid_body', 400));
  }
  await assert.rejects(readAccessJson(streamRequest(['not-bytes'])), error('invalid_body', 400));
  const consumed = post(); await consumed.text(); await assert.rejects(readAccessJson(consumed), error('invalid_json', 400));
});

test('body deadline is fixed and does not wait for an indefinitely pending cancel callback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = 0;
  const request = post({ body: new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }), duplex: 'half' });
  const read = readAccessJson(request);
  t.mock.timers.tick(HTTP_POLICY.bodyDeadlineMs);
  await assert.rejects(read, error('body_timeout', 408)); assert.equal(cancelled, 1);
});

test('request abort cancels reception immediately, including an already aborted request', async () => {
  for (const prior of [false, true]) {
    const controller = new AbortController(); let cancelled = 0;
    const request = post({ signal: controller.signal, body: new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }), duplex: 'half' });
    if (prior) controller.abort();
    const read = readAccessJson(request); if (!prior) controller.abort();
    await assert.rejects(read, error('request_cancelled', 499)); assert.equal(cancelled, 1);
  }
});

test('an unbounded sequence of empty chunks is refused instead of starving the reception timer', async () => {
  let cancelled = false;
  const request = post({ body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array()); }, cancel() { cancelled = true; } }), duplex: 'half' });
  await assert.rejects(readAccessJson(request), error('invalid_body', 400)); assert.equal(cancelled, true);
});

test('cookie selection is exact, purpose-specific and never falls back to other audiences or bearer', async () => {
  const admin = (await issueOpaqueToken('session')).token, app = (await issueOpaqueToken('session')).token;
  const cookies = `other=value; __Host-creezio-admin=${admin}; __Host-creezio-app=${app}`;
  const request = new Request(origin, { headers: { cookie: cookies } });
  assert.equal(readAccessCookie(request, config(), 'admin'), admin); assert.equal(readAccessCookie(request, config(), 'app'), app);
  assert.equal(readAccessCookie(new Request(origin, { headers: { cookie: `__Host-creezio-admin=${admin}`, authorization: `Bearer ${app}` } }), config(), 'app'), null);
  assert.equal(readAccessCookie(request, local(), 'admin'), null);
  assert.equal(readAccessCookie(new Request(origin), config(), 'admin'), null);
  for (const value of ['', 'bad', app + '=', `"${app}"`, encodeURIComponent(app).replace('cz1s_', 'cz1s%5F'),
    (await issueOpaqueToken('api-token')).token, (await issueOpaqueToken('impersonation')).token, 'cz1s_' + 'A'.repeat(42) + 'B']) {
    assert.throws(() => readAccessCookie(new Request(origin, { headers: { cookie: `__Host-creezio-app=${value}` } }), config(), 'app'), error('invalid_cookie', 401));
  }
  for (const cookie of [`__Host-creezio-app=${app}; __Host-creezio-app=${app}`, `__Host-creezio-app; other=1`,
    `__Host-creezio-app=${app}, __Host-creezio-app=${app}`]) {
    assert.throws(() => readAccessCookie(new Request(origin, { headers: { cookie } }), config(), 'app'), error('invalid_cookie', 401));
  }
  assert.throws(() => readAccessCookie(new Request(origin, { headers: { cookie: `other=${'x'.repeat(8192)}` } }), config(), 'app'), error('headers_too_large', 431));
});

test('cookie serialization is injection-free and keeps local and HTTPS transport attributes separate', async () => {
  const token = (await issueOpaqueToken('session')).token, expiry = Date.UTC(2026, 8, 27, 12, 0, 0);
  for (const [configuration, audience] of [[config(), 'admin'], [config(), 'app'], [local(), 'admin'], [local(), 'app']]) {
    const serialized = serializeAccessCookie(configuration, audience, token, expiry);
    assert.equal(serialized, `${configuration.cookieNames[audience]}=${token}; Path=/; HttpOnly; SameSite=Strict${configuration.secureCookies ? '; Secure' : ''}; Expires=Sun, 27 Sep 2026 12:00:00 GMT`);
    assert.equal(serialized.includes('Domain='), false);
    const clearing = clearAccessCookie(configuration, audience);
    assert.ok(clearing.startsWith(`${configuration.cookieNames[audience]}=;`)); assert.ok(clearing.includes('Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'));
    assert.equal(clearing.includes(token), false);
    assert.ok(await digestOpaqueToken(readAccessCookie(new Request(origin, { headers: { cookie: serialized.split(';')[0] } }), configuration, audience), 'session'));
  }
  for (const supplied of [token + '; Domain=evil.invalid', token + '\r\nX-Leak: value', (await issueOpaqueToken('api-token')).token])
    assert.throws(() => serializeAccessCookie(config(), 'app', supplied, expiry), error('invalid_cookie', 503));
  for (const supplied of [NaN, Infinity, 0, -1, 8640000000000001]) assert.throws(() => serializeAccessCookie(config(), 'app', token, supplied), error('invalid_cookie', 503));
  assert.throws(() => serializeAccessCookie({ ...config(), cookieNames: { admin: 'injected; Domain=evil.invalid', app: '__Host-creezio-app' } }, 'admin', token, expiry), error('invalid_http_configuration', 503));
});
