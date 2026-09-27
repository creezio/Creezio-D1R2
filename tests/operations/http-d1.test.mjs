import test from 'node:test';
import assert from 'node:assert/strict';
import { compileHttpBindings } from '../../scripts/operations/http-bindings.mjs';
import { createDeclaredHttpDispatcher } from '../../core/operations/http.ts';
import { createOperationFixture } from './fixtures/identity.mjs';
import { createFixtureRegistry } from './fixtures/handlers.mjs';
import { moduleId, operationComposition, permissions } from './fixtures/operations.mjs';

const origin = 'https://creezio-http.example';
const ref = id => ({moduleId, kind: 'operation', id});
const route = (id, method, path, operationId, parameters, input, output, rateLimit = 30) => ({id, method, path,
  operation: ref(operationId), audience: 'admin', auth: ['session', 'api-token'], parameters,
  input: {schemaId: input}, output: {schemaId: output}, rateLimit: {requests: rateLimit, windowSeconds: 60}});
const pathId = [{name: 'id', in: 'path', inputField: 'id', required: true}];
const keyHeader = value => Buffer.from(value, 'utf8').toString('base64url');

test('declared HTTP routes use real Miniflare D1, native credentials and the T06 engine', {timeout: 60000}, async () => {
  const fixture = await createOperationFixture();
  try {
    const compiled = await createFixtureRegistry();
    const source = operationComposition();
    source.modules[0].contracts.api = [
      route('create-http', 'POST', '/api/records', 'create_record', [], 'create-input', 'record-output'),
      route('read-http', 'GET', '/api/records/{id}', 'read_record', pathId, 'read-input', 'record-output'),
      route('limited-http', 'GET', '/api/limited-records/{id}', 'read_record', pathId, 'read-input', 'record-output', 1),
    ];
    const bindings = compileHttpBindings({composition: source.composition, modules: source.modules,
      operationCatalog: compiled.compiled.catalog});
    const dispatcher = createDeclaredHttpDispatcher({registry: compiled.registry, dataCatalog: fixture.catalog,
      permissions, bindings, workspaceCatalog: {compositionDigest: compiled.compiled.catalog.compositionDigest,
        views: [], navigation: []}});
    const environment = {profile: 'sites', bindings: {DB: fixture.db}}, raw = {CREEZIO_APP_ORIGIN: origin};
    let sequence = 0;
    const send = async (path, {method = 'GET', credential = 'session', context = 'application', body, headers = {}} = {}) => {
      const auth = credential === 'machine'
        ? {authorization: `Bearer ${fixture.credentials.machine.token}`}
        : {cookie: `__Host-creezio-admin=${fixture.credentials.session.token}`};
      const request = new Request(`${origin}${path}`, {method, headers: {...auth, 'x-creezio-context': context,
        ...(method === 'GET' ? {} : {'content-type': 'application/json', 'x-creezio-request': '1', origin}), ...headers},
        ...(body === undefined ? {} : {body: JSON.stringify(body)})});
      const response = await dispatcher.dispatch(request, environment, raw, `request-${++sequence}`);
      assert.ok(response); assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(JSON.stringify(result).includes(fixture.credentials.session.token), false);
      return {status: response.status, result};
    };
    const body = {id: 'http-record', title: 'Created by HTTP', request_id: 'http-create-1'};
    const first = await send('/api/records', {method: 'POST', body});
    assert.equal(first.status, 200, JSON.stringify(first.result));
    assert.equal(first.result.execution.state, 'succeeded');
    assert.equal(first.result.execution.replayed, false);
    assert.equal((await fixture.record(body.id)).title, body.title);
    // Treat the successful POST response as lost: recovery uses only the key,
    // and never submits the mutation body or invokes its handler again.
    const lookupPath = `/api/operations/lookup/${moduleId}/create-http`;
    const lookup = await send(lookupPath, {headers: {'x-creezio-request-key': keyHeader(body.request_id)}});
    assert.equal(lookup.status, 200, JSON.stringify(lookup.result));
    assert.equal(lookup.result.execution.id, first.result.execution.id);
    assert.equal(lookup.result.execution.state, 'succeeded');
    assert.equal(compiled.calls.get('create_record'), 1);
    const otherPrincipal = await send(lookupPath, {credential: 'machine', headers: {'x-creezio-request-key': keyHeader(body.request_id)}});
    assert.equal(otherPrincipal.status, 404);
    const otherContext = await send(lookupPath, {context: 'other', headers: {'x-creezio-request-key': keyHeader(body.request_id)}});
    assert.equal(otherContext.status, 404);
    const missingKey = await send(lookupPath, {headers: {'x-creezio-request-key': keyHeader('not-observed')}});
    assert.equal(missingKey.status, 404, 'absence means no execution observed, never permission to replay');
    const foreignBinding = await send(`/api/operations/lookup/${moduleId}/missing`,
      {headers: {'x-creezio-request-key': keyHeader(body.request_id)}});
    assert.equal(foreignBinding.status, 404);
    const queryBinding = await send(`/api/operations/lookup/${moduleId}/read-http`,
      {headers: {'x-creezio-request-key': keyHeader(body.request_id)}});
    assert.equal(queryBinding.status, 501);
    const replay = await send('/api/records', {method: 'POST', body});
    assert.equal(replay.status, 200); assert.equal(replay.result.execution.replayed, true);
    assert.equal(replay.result.execution.id, first.result.execution.id);
    assert.equal(compiled.calls.get('create_record'), 1);
    const conflict = await send('/api/records', {method: 'POST', body: {...body, title: 'Different'}});
    assert.equal(conflict.status, 409); assert.equal(conflict.result.error.code, 'conflict');
    assert.equal(await fixture.countRecords(), 1);
    const statusPath = `/api/operations/status/${moduleId}/create-http/${first.result.execution.id}`;
    const status = await send(statusPath);
    assert.equal(status.status, 200); assert.equal(status.result.execution.state, 'succeeded');
    const workspace = await send('/api/workspace/admin/projection');
    assert.equal(workspace.status, 200, JSON.stringify(workspace.result));
    assert.equal(workspace.result.projection.sessionId, fixture.subjectSession.session.id);
    assert.equal(workspace.result.projection.contextId, 'application');
    assert.equal(workspace.result.projection.compositionDigest, compiled.compiled.catalog.compositionDigest);
    assert.deepEqual(workspace.result.projection.viewIds, []);
    const read = await send('/api/records/http-record', {credential: 'machine'});
    assert.equal(read.status, 200, JSON.stringify(read.result));
    assert.deepEqual(read.result.execution.output, {id: body.id, title: body.title, revision: 0});
    const wrongScope = await send('/api/records/http-record', {credential: 'machine', context: 'other'});
    assert.equal(wrongScope.status, 401);
    const limited = await send('/api/limited-records/http-record');
    assert.equal(limited.status, 200);
    const limitedStatus = await send(`/api/operations/status/${moduleId}/limited-http/${limited.result.execution.id}`);
    assert.equal(limitedStatus.status, 200);
    const throttled = await send('/api/limited-records/http-record');
    assert.equal(throttled.status, 429); assert.equal(throttled.result.error.code, 'rate_limited');
    await fixture.revoke('session');
    const revoked = await send(statusPath);
    assert.equal(revoked.status, 401);
    const revokedWorkspace = await send('/api/workspace/admin/projection');
    assert.equal(revokedWorkspace.status, 401);
    assert.equal((await fixture.record(body.id)).title, body.title);
  } finally { await fixture.dispose(); }
});
