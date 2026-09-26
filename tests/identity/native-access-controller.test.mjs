import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createAccessController, createBrowserAccessController } from '../../sdk/access/controller.ts';
import { createAccessCoordinator } from '../../sdk/access/coordinator.ts';

const test = (name, run) => nodeTest(name, { timeout: 5000 }, run);
const origin = 'https://creezio.example';
const credentials = () => ({ loginIdentifier: 'native-ui@example.invalid', password: 'Synthetic native UI qualification password' });
const session = (id = 'session-one', audience = 'admin') => ({ id, principalId: 'principal-one', displayName: 'Synthetic account', audience,
  createdAtMs: 1790467200000, expiresAtMs: 1790496000000 });
const authenticated = (id, audience) => ({ kind: 'authenticated', session: session(id, audience) });
const anonymous = () => ({ kind: 'anonymous' });
const unavailable = () => ({ kind: 'unavailable', error: 'unavailable' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(predicate) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Expected controlled asynchronous step did not occur');
}
function coordinator({ serial = true, mode = 'origin' } = {}) {
  const listeners = new Map(), tails = new Map(), events = [];
  const key = scope => `${scope.origin}|${scope.audience}`;
  return {
    mode, events,
    runExclusive(scope, task) {
      const name = key(scope), previous = serial ? tails.get(name) ?? Promise.resolve() : Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        events.push(['acquired', name]);
        try { return await task(); } finally { events.push(['released', name]); }
      });
      tails.set(name, next); return next;
    },
    subscribe(scope, listener) {
      const name = key(scope), subscribed = listeners.get(name) ?? new Set();
      subscribed.add(listener); listeners.set(name, subscribed);
      return () => subscribed.delete(listener);
    },
    invalidate(scope) {
      events.push(['invalidate', key(scope)]);
      for (const listener of listeners.get(key(scope)) ?? []) listener();
    },
    listenerCount() { return [...listeners.values()].reduce((sum, group) => sum + group.size, 0); },
  };
}
function transport({ audience = 'admin', read, login, logout } = {}) {
  const calls = [];
  return {
    origin, audience, calls,
    async readSession(options) { calls.push({ method: 'read', options }); return read ? await read(options) : anonymous(); },
    async login(input) { calls.push({ method: 'login', input }); return login ? await login(input) : { ok: true }; },
    async logout() { calls.push({ method: 'logout' }); return logout ? await logout() : { ok: true }; },
  };
}
const methods = value => value.calls.map(call => call.method);

test('native access controller starts without network work or inferred identity and exposes stable frozen snapshots', () => {
  const channel = coordinator({ mode: 'document' }), http = transport();
  const controller = createAccessController({ audience: 'admin', transport: http, coordinator: channel });
  assert.deepEqual(controller.getSnapshot(), { phase: 'loading', session: null, pending: null, error: null, coordination: 'document' });
  assert.equal(controller.getSnapshot(), controller.getSnapshot()); assert.ok(Object.isFrozen(controller.getSnapshot()));
  assert.equal(controller.audience, 'admin'); assert.equal(controller.origin, origin); assert.deepEqual(http.calls, []);
  assert.equal(channel.listenerCount(), 1); controller.dispose(); assert.equal(channel.listenerCount(), 0);
  assert.throws(() => createAccessController({ audience: 'app', transport: http, coordinator: channel }));
});

test('native refresh copies a verified session and clears it on refusal or unavailable verification', async () => {
  let result = authenticated('verified'), notifications = 0;
  const http = transport({ read: async () => result }), controller = createAccessController({ audience: 'admin', transport: http, coordinator: coordinator() });
  const unsubscribe = controller.subscribe(() => { notifications++; });
  await controller.refresh();
  const verified = controller.getSnapshot(); assert.equal(verified.phase, 'authenticated'); assert.deepEqual(verified.session, result.session);
  assert.ok(Object.isFrozen(verified.session)); result.session.displayName = 'Changed outside controller';
  assert.equal(verified.session.displayName, 'Synthetic account');
  result = unavailable(); await controller.refresh();
  assert.equal(controller.getSnapshot().phase, 'unavailable'); assert.equal(controller.getSnapshot().session, null);
  result = anonymous(); await controller.refresh();
  assert.equal(controller.getSnapshot().phase, 'anonymous'); assert.equal(controller.getSnapshot().session, null);
  assert.ok(notifications >= 3); unsubscribe(); const previous = notifications;
  await controller.refresh(); assert.equal(notifications, previous); controller.dispose();
});

test('custom transport cannot install a wrong audience, owner role, credential field or arbitrary error in controller state', async () => {
  const values = [
    authenticated('wrong-audience', 'app'), { kind: 'authenticated', session: { ...session(), role: 'owner' } },
    { kind: 'authenticated', session: { ...session(), token: 'Synthetic secret' } }, { kind: 'anonymous', session: session() },
    { kind: 'unavailable', error: '<script>Synthetic server diagnostic</script>' }, null, {},
  ];
  for (const value of values) {
    const controller = createAccessController({ audience: 'admin', transport: transport({ read: async () => value }), coordinator: coordinator() });
    await controller.refresh(); const current = controller.getSnapshot();
    assert.equal(current.phase, 'unavailable'); assert.equal(current.session, null); assert.equal(current.error, 'invalid_response');
    controller.dispose();
  }
});

test('a cancelled stale read cannot reinstall an identity after a more recent refusal', async () => {
  const first = deferred(), second = deferred(); let index = 0;
  // A deliberately nonserial injected coordinator lets the cancelled transport
  // finish late, independently exercising the controller generation boundary.
  const http = transport({ read: () => [first, second][index++].promise });
  const controller = createAccessController({ audience: 'admin', transport: http, coordinator: coordinator({ serial: false }) });
  const oldRead = controller.refresh(); await until(() => http.calls.length === 1);
  const currentRead = controller.refresh(); await until(() => http.calls.length === 2);
  assert.equal(http.calls[0].options.signal.aborted, true);
  second.resolve(anonymous()); await currentRead; first.resolve(authenticated('obsolete')); await oldRead;
  assert.equal(controller.getSnapshot().phase, 'anonymous'); assert.equal(controller.getSnapshot().session, null); controller.dispose();
});

test('login captures inputs, blocks duplicate submissions and adopts only the subsequent cookie-based GET', async () => {
  const post = deferred(), reread = deferred(), channel = coordinator();
  const http = transport({ login: () => post.promise, read: () => reread.promise });
  const controller = createAccessController({ audience: 'admin', transport: http, coordinator: channel });
  const input = credentials(), expected = { ...input }, action = controller.login(input);
  input.password = 'Changed after invocation'; input.loginIdentifier = 'changed@example.invalid';
  await until(() => http.calls.length === 1);
  assert.deepEqual(http.calls[0].input, expected); assert.equal(controller.getSnapshot().pending, 'login');
  const duplicateLogin = controller.login(credentials()), duplicateLogout = controller.logout();
  assert.deepEqual(methods(http), ['login']);
  post.resolve({ ok: true }); await until(() => http.calls.length === 2);
  assert.equal(controller.getSnapshot().session, null); assert.equal(controller.getSnapshot().pending, 'login');
  assert.equal(channel.events.filter(event => event[0] === 'released').length, 0);
  reread.resolve(authenticated('actual-cookie')); await Promise.all([action, duplicateLogin, duplicateLogout]);
  assert.deepEqual(methods(http), ['login', 'read']); assert.equal(controller.getSnapshot().session.id, 'actual-cookie');
  assert.equal(controller.getSnapshot().pending, null); assert.equal(controller.getSnapshot().error, null);
  assert.equal(channel.events.filter(event => event[0] === 'released').length, 1); controller.dispose();
});

test('post-mutation refusal or unavailable GET never confirms the identity implied by a successful login', async () => {
  for (const result of [anonymous(), unavailable()]) {
    const http = transport({ read: async () => result });
    const controller = createAccessController({ audience: 'admin', transport: http, coordinator: coordinator() });
    await controller.login(credentials());
    assert.deepEqual(methods(http), ['login', 'read']); assert.equal(controller.getSnapshot().session, null);
    assert.equal(controller.getSnapshot().phase, result.kind); controller.dispose();
  }
});

test('failed login and logout still reconcile the real cookie without retrying or losing the mutation error', async () => {
  for (const method of ['login', 'logout']) {
    const http = transport({ read: async () => authenticated('still-present'), [method]: async () => ({ ok: false, error: 'unavailable' }) });
    const controller = createAccessController({ audience: 'admin', transport: http, coordinator: coordinator() });
    await (method === 'login' ? controller.login(credentials()) : controller.logout());
    assert.deepEqual(methods(http), [method, 'read']);
    assert.equal(controller.getSnapshot().phase, 'authenticated'); assert.equal(controller.getSnapshot().session.id, 'still-present');
    assert.equal(controller.getSnapshot().error, 'unavailable'); assert.equal(controller.getSnapshot().pending, null); controller.dispose();
  }
});

test('disposal during an emitted mutation preserves its lock through reconciliation but publishes no later state', async () => {
  const post = deferred(), reread = deferred(), channel = coordinator(); let notifications = 0;
  const http = transport({ logout: () => post.promise, read: () => reread.promise });
  const controller = createAccessController({ audience: 'admin', transport: http, coordinator: channel });
  controller.subscribe(() => { notifications++; }); const action = controller.logout();
  await until(() => http.calls.length === 1); controller.dispose(); const before = notifications;
  assert.equal(channel.listenerCount(), 0);
  post.resolve({ ok: true }); await until(() => http.calls.length === 2);
  assert.equal(channel.events.filter(event => event[0] === 'released').length, 0);
  reread.resolve(anonymous()); await action;
  assert.equal(notifications, before); assert.deepEqual(methods(http), ['logout', 'read']);
  await controller.refresh(); await controller.login(credentials()); await controller.logout();
  assert.deepEqual(methods(http), ['logout', 'read']);
  assert.equal(channel.events.filter(event => event[0] === 'released').length, 1);
});

test('disposal before lock acquisition sends no queued mutation or secret to transport', async () => {
  const held = deferred(), channel = coordinator(), scope = { origin, audience: 'admin' };
  const blocker = channel.runExclusive(scope, () => held.promise);
  const http = transport(), controller = createAccessController({ audience: 'admin', transport: http, coordinator: channel });
  const action = controller.login(credentials()); controller.dispose(); held.resolve(); await blocker; await action;
  assert.deepEqual(http.calls, []);
});

test('two controllers serialize an audience through POST and fresh GET while the other audience remains independent', async () => {
  const heldLogin = deferred(), heldRead = deferred(), channel = coordinator();
  const firstHttp = transport({ login: () => heldLogin.promise, read: () => heldRead.promise });
  const secondHttp = transport(), appHttp = transport({ audience: 'app' });
  const first = createAccessController({ audience: 'admin', transport: firstHttp, coordinator: channel });
  const second = createAccessController({ audience: 'admin', transport: secondHttp, coordinator: channel });
  const app = createAccessController({ audience: 'app', transport: appHttp, coordinator: channel });
  const firstAction = first.login(credentials()); await until(() => firstHttp.calls.length === 1);
  const secondAction = second.logout(); await app.logout();
  assert.deepEqual(methods(appHttp), ['logout', 'read']); assert.deepEqual(secondHttp.calls, []);
  heldLogin.resolve({ ok: true }); await until(() => firstHttp.calls.length === 2);
  assert.deepEqual(secondHttp.calls, []); heldRead.resolve(authenticated('first-login'));
  await firstAction; await secondAction;
  assert.equal(secondHttp.calls.filter(call => call.method === 'logout').length, 1);
  assert.ok(methods(secondHttp).indexOf('read') > methods(secondHttp).indexOf('logout'));
  first.dispose(); second.dispose(); app.dispose();
});

test('coordinator notifications invalidate old identity and cannot install any message payload', async () => {
  const pending = deferred(), channel = coordinator(); let reads = 0;
  const http = transport({ read: () => ++reads === 1 ? authenticated('old') : pending.promise });
  const controller = createAccessController({ audience: 'admin', transport: http, coordinator: channel });
  await controller.refresh(); assert.equal(controller.getSnapshot().phase, 'authenticated');
  channel.invalidate({ origin, audience: 'app' }); assert.equal(controller.getSnapshot().phase, 'authenticated');
  channel.invalidate({ origin, audience: 'admin' }, authenticated('forged-message'));
  assert.equal(controller.getSnapshot().session, null);
  await until(() => reads === 2); pending.resolve(anonymous());
  await until(() => controller.getSnapshot().phase === 'anonymous');
  assert.equal(reads, 2); controller.dispose();
});

test('document-only coordination really serializes separate coordinator instances without claiming origin exclusion', async () => {
  const first = createAccessCoordinator({ locks: null, broadcast: null }), second = createAccessCoordinator({ locks: null, broadcast: null });
  assert.equal(first.mode, 'document'); assert.equal(second.mode, 'document');
  const pending = deferred(), order = [], scope = { origin, audience: 'admin' };
  const a = first.runExclusive(scope, async () => { order.push('a-start'); await pending.promise; order.push('a-end'); });
  await until(() => order.length === 1);
  const b = second.runExclusive(scope, async () => { order.push('b'); });
  const c = second.runExclusive({ origin, audience: 'app' }, async () => { order.push('app'); });
  await c; assert.deepEqual(order, ['a-start', 'app']); pending.resolve(); await a; await b;
  assert.deepEqual(order, ['a-start', 'app', 'a-end', 'b']);
});

test('origin coordinator keeps the Web Lock until the real task settles, never steals it, and propagates failure once', async () => {
  const task = deferred(), calls = []; let release = false;
  const locks = { async request(name, options, callback) {
    calls.push({ name, options }); try { return await callback({ name, mode: 'exclusive' }); } finally { release = true; }
  } };
  const channel = createAccessCoordinator({ locks, broadcast: null }); assert.equal(channel.mode, 'origin');
  const error = new Error('Synthetic task failure');
  const run = channel.runExclusive({ origin, audience: 'admin' }, () => task.promise);
  const rejected = assert.rejects(run, value => value === error);
  await until(() => calls.length === 1); assert.equal(release, false);
  assert.equal(calls[0].options.mode, 'exclusive'); assert.notEqual(calls[0].options.steal, true);
  task.reject(error); await rejected; assert.equal(release, true); assert.equal(calls.length, 1);
});

test('broadcast coordination carries invalidations only, rejects executable messages and closes its unused port', () => {
  let receiver, closes = 0, opened = 0, notifications = 0, getters = 0;
  const posted = [], port = {
    postMessage(value) { posted.push(value); },
    addEventListener(type, listener) { assert.equal(type, 'message'); receiver = listener; },
    removeEventListener(type, listener) { assert.equal(type, 'message'); assert.equal(listener, receiver); },
    close() { closes++; },
  };
  const channel = createAccessCoordinator({ locks: null, broadcast: () => { opened++; return port; } });
  const scope = { origin, audience: 'admin' }, unsubscribe = channel.subscribe(scope, () => { notifications++; });
  assert.equal(channel.mode, 'document'); assert.equal(opened, 1);
  channel.invalidate(scope); assert.equal(notifications, 1);
  assert.deepEqual(posted, [{ version: 1, type: 'invalidate', origin, audience: 'admin' }]);
  receiver({ data: { ...posted[0] } }); assert.equal(notifications, 2);
  assert.equal(posted.length, 1, 'Receiving an invalidation must not rebroadcast it');
  const accessor = { version: 1, type: 'invalidate', origin };
  Object.defineProperty(accessor, 'audience', { enumerable: true, get() { getters++; return 'admin'; } });
  for (const data of [null, {}, accessor, { ...posted[0], session: session('forged') },
    { ...posted[0], audience: 'app' }, { ...posted[0], origin: 'https://other.example' },
    { ...posted[0], type: 'authenticated' }, { ...posted[0], version: 2 }]) receiver({ data });
  assert.equal(notifications, 2); assert.equal(getters, 0);
  unsubscribe(); unsubscribe(); assert.equal(closes, 1);
  receiver({ data: { ...posted[0] } }); assert.equal(notifications, 2);
});

test('browser factory wires foreground lifecycle events to read-only refresh and removes every listener on disposal', async () => {
  // Synthetic EventTargets prove wiring and cleanup only: no DOM, cookie jar,
  // bfcache or actual browser qualification is claimed by this fixture.
  class ObservedTarget extends EventTarget {
    listeners = new Map();
    addEventListener(type, listener, options) {
      const group = this.listeners.get(type) ?? new Set(); group.add(listener); this.listeners.set(type, group);
      super.addEventListener(type, listener, options);
    }
    removeEventListener(type, listener, options) {
      this.listeners.get(type)?.delete(listener); super.removeEventListener(type, listener, options);
    }
    count() { return [...this.listeners.values()].reduce((sum, group) => sum + group.size, 0); }
  }
  const windowTarget = new ObservedTarget(), documentTarget = new ObservedTarget();
  windowTarget.location = { origin }; documentTarget.visibilityState = 'visible';
  const calls = [], saved = new Map(), replacements = {
    window: windowTarget, document: documentTarget, navigator: {}, BroadcastChannel: undefined,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ error: { code: 'authentication_required' }, requestId: 'synthetic-foreground-read' }),
        { status: 401, headers: { 'content-type': 'application/json' } });
    },
  };
  let controller;
  try {
    for (const [name, value] of Object.entries(replacements)) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
    controller = createBrowserAccessController({ audience: 'app' });
    assert.equal(calls.length, 0); assert.equal(windowTarget.count(), 2); assert.equal(documentTarget.count(), 1);
    for (const type of ['focus', 'pageshow']) {
      const count = calls.length; windowTarget.dispatchEvent(new Event(type));
      await until(() => calls.length === count + 1 && controller.getSnapshot().phase === 'anonymous');
    }
    documentTarget.visibilityState = 'hidden'; documentTarget.dispatchEvent(new Event('visibilitychange'));
    windowTarget.dispatchEvent(new Event('pageshow')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    documentTarget.visibilityState = 'visible'; documentTarget.dispatchEvent(new Event('visibilitychange'));
    await until(() => calls.length === 3 && controller.getSnapshot().phase === 'anonymous');
    for (const call of calls) {
      assert.equal(call.url, `${origin}/api/access/app/session`); assert.equal(call.options.method, 'GET');
    }
    controller.dispose(); controller.dispose();
    assert.equal(windowTarget.count(), 0); assert.equal(documentTarget.count(), 0);
    windowTarget.dispatchEvent(new Event('focus')); windowTarget.dispatchEvent(new Event('pageshow'));
    documentTarget.dispatchEvent(new Event('visibilitychange')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 3);
  } finally {
    controller?.dispose();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});
