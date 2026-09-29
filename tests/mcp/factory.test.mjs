import test from 'node:test';
import assert from 'node:assert/strict';
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createMcpHttpTransportFactory} from '../../core/mcp/http.ts';

const origin = 'https://example.invalid';
const digest = `sha256-${'a'.repeat(64)}`;
const declaration = {id: 'read', kind: 'query', context: 'application', audiences: ['admin'],
  actors: ['delegated-user'], permissions: [{moduleId: 'example.one', id: 'read'}]};

test('one static MCP catalog serves independent engines, credentials and live permissions', async () => {
  let resolutions = 0;
  const registry = {resolve() {
    resolutions++;
    return {declaration, contractDigest: digest};
  }};
  const catalog = {tools: [{name: 'admin_read', contributorModuleId: 'example.one', moduleId: 'example.one',
    operationId: 'read', audience: 'admin', auth: ['oauth'], actors: ['delegated-user'],
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    outputSchema: {type: 'object', properties: {source: {type: 'string'}}, required: ['source'],
      additionalProperties: false},
    annotations: {readOnly: true, destructive: false, idempotent: true, openWorld: false},
    context: 'application', permissions: ['example.one:read'], contractDigest: digest}], resources: []};
  const factory = createMcpHttpTransportFactory(catalog, registry);
  assert.equal(resolutions, 1, 'static declaration is resolved once for the factory');
  catalog.tools = []; // The validated static snapshot survives changes to the caller's source object.

  function clientFor(label) {
    const calls = [];
    const access = {allowed: true};
    const transport = factory({async invoke(input) {
      calls.push(input);
      return {execution: {id: `${label}-execution`, state: 'succeeded', output: {source: label},
        errorCode: null}, replayed: false};
    }}, {origin, resourceMetadataUrl: audience => `${origin}/metadata/${audience}`,
      async authenticate(request, _audience, resource) {
        return request.headers.get('authorization') === `Bearer ${label}`
          ? {credential: {kind: 'oauth', token: label, resource}, contextId: 'application'} : null;
      }, async canDiscover() {return access.allowed;}});
    const fetch = (url, init) => transport.dispatch(new Request(url, init), 'admin', `${label}-request`);
    const client = new Client({name: `${label}-client`, version: '1.0.0'},
      {versionNegotiation: {mode: {pin: '2026-07-28'}}});
    const wire = new StreamableHTTPClientTransport(new URL(`${origin}/mcp/admin`),
      {fetch, authProvider: {token: async () => label}});
    return {client, wire, transport, calls, access};
  }

  const first = clientFor('first'), second = clientFor('second');
  assert.equal(resolutions, 1, 'new request transports reuse the validated catalog');
  try {
    await first.client.connect(first.wire);
    await second.client.connect(second.wire);
    assert.deepEqual((await first.client.listTools()).tools.map(item => item.name), ['admin_read']);
    assert.deepEqual((await second.client.listTools()).tools.map(item => item.name), ['admin_read']);
    assert.deepEqual((await first.client.callTool({name: 'admin_read', arguments: {}})).structuredContent,
      {source: 'first'});
    assert.deepEqual((await second.client.callTool({name: 'admin_read', arguments: {}})).structuredContent,
      {source: 'second'});
    assert.equal(first.calls.length, 1);
    assert.equal(second.calls.length, 1);
    assert.equal(resolutions, 1, 'MCP requests do not rebuild the static index');
    assert.equal(first.calls[0].credential.token, 'first');
    assert.equal(second.calls[0].credential.token, 'second');

    first.access.allowed = false;
    assert.deepEqual((await first.client.listTools()).tools, []);
    assert.deepEqual((await second.client.listTools()).tools.map(item => item.name), ['admin_read']);
    const crossCredential = await second.transport.dispatch(new Request(`${origin}/mcp/admin`,
      {method: 'POST', headers: {authorization: 'Bearer first'}}), 'admin', 'cross-request');
    assert.equal(crossCredential.status, 401);
    assert.equal(second.calls.length, 1);
  } finally {
    await first.client.close();
    await second.client.close();
  }
});
