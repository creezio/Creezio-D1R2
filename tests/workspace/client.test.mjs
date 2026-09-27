import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationClient} from '../../sdk/operations/client.ts';

const origin = 'https://creezio.example';
const session = {id: 'session-1', principalId: 'person-1', displayName: 'Synthetic', audience: 'app',
  createdAtMs: 1, expiresAtMs: 100000};
const snapshot = (value = session) => ({phase: value ? 'authenticated' : 'anonymous', pending: null, session: value});
const access = () => {let state = snapshot(); return {origin, audience: 'app', getSnapshot: () => state, set(value) {state = value;}};};
const binding = (changes = {}) => ({id: 'patch-http', contributorModuleId: 'example.notes', moduleId: 'example.notes',
  operationId: 'patch', method: 'PATCH', path: '/api/notes/{noteId}', audience: 'app', auth: ['session'],
  parameters: [{name: 'noteId', in: 'path', inputField: 'noteId', required: true, codec: 'string'},
    {name: 'revision', in: 'query', inputField: 'revision', required: true, codec: 'integer'},
    {name: 'x-note-flag', in: 'header', inputField: 'flag', required: false, codec: 'boolean'}],
  inputSchemaId: 'input', outputSchemaId: 'output', context: 'required', kind: 'command',
  rateLimit: {requests: 10, windowSeconds: 60}, contractDigest: `sha256-${'b'.repeat(64)}`, ...changes});
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
const execution = (state = 'succeeded') => ({id: 'execution-1', state, output: {saved: true}, errorCode: null});
const error = code => ({error: {code}, requestId: 'request-1'});
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};

test('client fixes a declared same-origin session route, primitive mapping and mutation headers', async () => {
  const calls = [];
  const client = createOperationClient({origin, audience: 'app', access: access(), bindings: [binding()], fetcher: async (url, init) => {
    calls.push({url, init}); return json({execution: execution()});
  }});
  const result = await client.invoke({bindingId: 'example.notes:patch-http', contextId: 'workspace-a',
    input: {noteId: 'note.1', revision: 7, flag: true, title: 'Edited'}});
  assert.equal(result.kind, 'execution'); assert.equal(result.execution.state, 'succeeded');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${origin}/api/notes/note.1?revision=7`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {title: 'Edited'});
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.mode, 'same-origin');
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('x-creezio-context'), 'workspace-a'); assert.equal(headers.get('x-creezio-request'), '1');
  assert.equal(headers.get('x-note-flag'), 'true');
  for (const name of ['authorization', 'cookie', 'origin']) assert.equal(headers.has(name), false);
});

test('optional mapped fields never read inherited Object methods', async () => {
  const calls = [];
  const client = createOperationClient({origin, audience: 'app', access: access(), bindings: [binding({
    method: 'GET', path: '/api/notes', kind: 'query', parameters: [
      {name: 'label', in: 'query', inputField: 'toString', required: false, codec: 'string'}]
  })], fetcher: async url => {calls.push(url); return json({execution: execution()});}});
  for (const input of [{}, {toString: 'explicit'}]) {
    const result = await client.invoke({bindingId: 'example.notes:patch-http', contextId: 'workspace-a', input});
    assert.equal(result.kind, 'execution');
  }
  assert.deepEqual(calls, [`${origin}/api/notes`, `${origin}/api/notes?label=explicit`]);
});

test('client refuses undeclared bindings, audience mismatch, invalid mapped fields and anonymous sessions before fetch', async () => {
  let calls = 0; const observed = access();
  const client = createOperationClient({origin, audience: 'app', access: observed, bindings: [binding()], fetcher: async () => {
    calls++; return json({execution: execution()});
  }});
  assert.deepEqual(await client.invoke({bindingId: 'example.notes:missing', contextId: 'workspace-a', input: {}}),
    {kind: 'rejected', code: 'not_found', status: 0});
  for (const input of [{noteId: 'a', revision: '7'}, {noteId: 'a', revision: 1, flag: 'true'},
    {noteId: 'a', revision: 1, title: () => true}]) {
    assert.equal((await client.invoke({bindingId: 'example.notes:patch-http', contextId: 'workspace-a', input})).kind, 'rejected');
  }
  observed.set(snapshot(null));
  assert.equal((await client.invoke({bindingId: 'example.notes:patch-http', contextId: 'workspace-a', input: {noteId: 'a', revision: 1}})).code, 'unauthorized');
  assert.equal(calls, 0);
  for (const bad of [binding({audience: 'admin'}), binding({path: 'https://elsewhere.example/x'}),
    binding({auth: ['api-token']}), binding({parameters: [{name: 'Authorization', in: 'header', inputField: 'token', required: true, codec: 'string'}]})])
    assert.throws(() => createOperationClient({origin, audience: 'app', access: access(), bindings: [bad]}));
});

test('a binding selector is qualified by its contributing module', async () => {
  const calls = [];
  const client = createOperationClient({origin, audience: 'app', access: access(), bindings: [
    binding(), binding({contributorModuleId: 'example.other', path: '/api/other/{noteId}'})],
    fetcher: async url => {calls.push(url); return json({execution: execution()});}});
  const input = {noteId: 'one', revision: 1};
  assert.equal((await client.invoke({bindingId: 'example.notes:patch-http', contextId: 'workspace-a', input})).kind, 'execution');
  assert.equal((await client.invoke({bindingId: 'example.other:patch-http', contextId: 'workspace-a', input})).kind, 'execution');
  assert.deepEqual(calls, [`${origin}/api/notes/one?revision=1`, `${origin}/api/other/one?revision=1`]);
  assert.throws(() => createOperationClient({origin, audience: 'app', access: access(), bindings: [binding(), binding()]}));
});

test('client separates certain HTTP rejection, known execution and uncertain mutation result without retry', async () => {
  const replies = [json(error('invalid_input'), 400), json({execution: execution('failed')}),
    json({execution: {...execution('unknown'), errorCode: 'commit_uncertain'}}, 202),
    json(error('unknown'), 202), json(error('unsupported'), 501), json(error('capability_unavailable'), 501),
    json(error('service_unavailable'), 503),
    new Response('<html/>', {status: 200, headers: {'content-type': 'text/html'}})];
  let calls = 0;
  const client = createOperationClient({origin, audience: 'app', access: access(), bindings: [binding()], fetcher: async () => replies[calls++]});
  const request = {bindingId: 'example.notes:patch-http', contextId: 'workspace-a', input: {noteId: 'a', revision: 1}};
  assert.deepEqual(await client.invoke(request), {kind: 'rejected', code: 'invalid_input', status: 400});
  assert.equal((await client.invoke(request)).execution.state, 'failed');
  assert.deepEqual(await client.invoke(request), {kind: 'unknown', code: 'commit_uncertain', executionId: 'execution-1'});
  assert.deepEqual(await client.invoke(request), {kind: 'unknown', code: 'unknown'});
  assert.deepEqual(await client.invoke(request), {kind: 'rejected', code: 'unsupported', status: 501});
  assert.deepEqual(await client.invoke(request), {kind: 'rejected', code: 'capability_unavailable', status: 501});
  assert.deepEqual(await client.invoke(request), {kind: 'unknown', code: 'unavailable'});
  assert.deepEqual(await client.invoke(request), {kind: 'unknown', code: 'outcome_unknown'});
  assert.equal(calls, 8);
  const lost = createOperationClient({origin, audience: 'app', access: access(), bindings: [binding()], fetcher: async () => {
    throw new Error('network response lost');
  }});
  assert.deepEqual(await lost.invoke(request), {kind: 'unknown', code: 'outcome_unknown'});
});

test('client rejects an in-flight response when session or workspace projection changes', async () => {
  const waiting = deferred(), observed = access(); let current = true;
  const client = createOperationClient({origin, audience: 'app', access: observed, bindings: [binding()], fetcher: () => waiting.promise});
  const request = {bindingId: 'example.notes:patch-http', contextId: 'workspace-a', input: {noteId: 'a', revision: 1}, isCurrent: () => current};
  const pending = client.invoke(request);
  current = false; observed.set(snapshot({...session, id: 'session-2'}));
  waiting.resolve(json({execution: execution()}));
  assert.deepEqual(await pending, {kind: 'unknown', code: 'stale'});
});

test('status uses the reserved binding route and current native session without replaying a mutation', async () => {
  const calls = [];
  const client = createOperationClient({origin, audience: 'app', access: access(), bindings: [binding()], fetcher: async (url, init) => {
    calls.push({url, init}); return json({execution: execution()});
  }});
  const result = await client.status({bindingId: 'example.notes:patch-http', contextId: 'workspace-a', executionId: 'execution-1'});
  assert.equal(result.kind, 'execution'); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${origin}/api/operations/status/example.notes/patch-http/execution-1`);
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.body, undefined);
  assert.equal(new Headers(calls[0].init.headers).get('x-creezio-context'), 'workspace-a');
});

test('request-key reconciliation uses a read-only lookup with the same session and context', async () => {
  const calls = [];
  const client = createOperationClient({origin, audience: 'app', access: access(), bindings: [binding()], fetcher: async (url, init) => {
    calls.push({url, init}); return json({execution: execution('running')}, 202);
  }});
  const key = ' request-é-中\u0001 ';
  const result = await client.status({bindingId: 'example.notes:patch-http', contextId: 'workspace-a', requestKey: key});
  assert.equal(result.kind, 'execution');
  assert.equal(result.execution.state, 'running');
  assert.equal(result.execution.id, 'execution-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${origin}/api/operations/lookup/example.notes/patch-http`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.mode, 'same-origin');
  assert.equal(calls[0].init.cache, 'no-store');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('x-creezio-context'), 'workspace-a');
  const encodedKey = headers.get('x-creezio-request-key');
  assert.match(encodedKey, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(encodedKey, 'base64url').toString('utf8'), key);
  assert.equal(headers.has('x-creezio-request'), false);
  assert.equal(headers.has('authorization'), false);
});

test('lookup requires exactly one target and bounds the key in UTF-8 bytes before fetch', async () => {
  let calls = 0;
  const client = createOperationClient({origin, audience: 'app', access: access(), bindings: [binding()], fetcher: async () => {
    calls++; return json({execution: execution()});
  }});
  const base = {bindingId: 'example.notes:patch-http', contextId: 'workspace-a'};
  for (const target of [{}, {executionId: 'execution-1', requestKey: 'request-1'},
    {requestKey: ''}, {requestKey: 'x'.repeat(513)}, {requestKey: 'é'.repeat(257)},
    {requestKey: '\ud800'}, {executionId: 'bad/id'}]) {
    assert.deepEqual(await client.status({...base, ...target}), {kind: 'rejected', code: 'invalid_input', status: 0});
  }
  assert.deepEqual(await client.status({...base, contextId: 'bad context', requestKey: 'request-1'}),
    {kind: 'rejected', code: 'invalid_input', status: 0});
  assert.equal(calls, 0);
  assert.equal((await client.status({...base, requestKey: 'é'.repeat(256)})).kind, 'execution');
  assert.equal(calls, 1);
});

test('404 lookup is uncertain, while access refusals remain certain and stale replies are ignored', async () => {
  const observed = access(), replies = [json(error('not_found'), 404), json(error('forbidden'), 403)];
  const client = createOperationClient({origin, audience: 'app', access: observed, bindings: [binding()],
    fetcher: async () => replies.shift()});
  const request = {bindingId: 'example.notes:patch-http', contextId: 'workspace-a', requestKey: 'request-1'};
  assert.deepEqual(await client.status(request), {kind: 'unknown', code: 'execution_not_observed'});
  assert.deepEqual(await client.status(request), {kind: 'rejected', code: 'forbidden', status: 403});
  const waiting = deferred(); let current = true;
  const pendingClient = createOperationClient({origin, audience: 'app', access: observed, bindings: [binding()],
    fetcher: () => waiting.promise});
  const pending = pendingClient.status({...request, isCurrent: () => current});
  current = false; observed.set(snapshot({...session, id: 'session-2'}));
  waiting.resolve(json({execution: execution()}));
  assert.deepEqual(await pending, {kind: 'unknown', code: 'stale'});
});
