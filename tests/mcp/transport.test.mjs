import test from 'node:test';
import assert from 'node:assert/strict';
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import {OperationError} from '../../core/operations/types.ts';

const origin = 'https://example.invalid';
const digest = `sha256-${'a'.repeat(64)}`;
const operation = {id: 'read', kind: 'query', context: 'application', audiences: ['admin', 'app'],
  actors: ['delegated-user'],
  permissions: [{moduleId: 'example.one', id: 'read'}]};
const tool = audience => ({name: `${audience}_read`, contributorModuleId: 'example.one', moduleId: 'example.one',
  operationId: 'read', audience, auth: ['oauth'], actors: ['delegated-user'],
  inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  outputSchema: {type: 'object', properties: {ok: {type: 'boolean'}}, required: ['ok'], additionalProperties: false},
  annotations: {readOnly: true, destructive: false, idempotent: true, openWorld: false},
  context: 'application', permissions: ['example.one:read'], contractDigest: digest});
const registry = {resolve() {return {declaration: operation, contractDigest: digest};}};

function fixture(withResource = false) {
  const calls = [], rawTools = [], access = {allow: true, engine: 'success'};
  const engine = {async invoke(value) {
    calls.push(value);
    if (access.engine === 'throw-unauthorized') throw new OperationError('unauthorized');
    if (access.engine === 'throw-forbidden') throw new OperationError('forbidden');
    if (access.engine === 'failed-unauthorized') return {execution: {id: 'execution-1', state: 'failed',
      output: null, errorCode: 'unauthorized'}, replayed: false};
    return {execution: {id: 'execution-1', state: 'succeeded', output: {ok: true}, errorCode: null}, replayed: false};
  }};
  const catalog = {tools: [tool('admin'), tool('app')], resources: withResource ? [{id: 'guide', uri: 'creezio://admin/guide',
    mimeType: 'text/plain', contributorModuleId: 'example.one', audience: 'admin',
    permissions: ['example.one:read'], actors: ['delegated-user'], context: 'application',
    source: {kind: 'asset', path: 'plugin/guide.txt'}}] : []};
  const transport = createMcpHttpTransport(catalog, registry, engine, {
    origin, resourceMetadataUrl: audience => `${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
    async authenticate(request, audience, resource) {
      if (request.headers.get('authorization') !== 'Bearer valid') return null;
      return {credential: {kind: 'oauth', token: 'valid', resource}, contextId: audience === 'admin' ? 'application' : 'tenant-a'};
    },
    async canDiscover(_identity, target) {
      assert.deepEqual(target.permissionIds, ['example.one:read']);
      assert.deepEqual(target.actors, ['delegated-user']);
      return access.allow;
    },
    ...(withResource ? {async loadResource(binding) {
      assert.equal(binding.source.path, 'plugin/guide.txt');
      return {text: 'Guide text'};
    }} : {}),
  });
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    const listing = request.method === 'POST' && (await request.clone().text()).includes('tools/list');
    const response = await transport.dispatch(request, new URL(request.url).pathname.endsWith('/admin') ? 'admin' : 'app', 'request-1');
    if (listing && response.status === 200) {
      const wire = await response.clone().text();
      const messages = response.headers.get('content-type')?.includes('text/event-stream')
        ? wire.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
        : [JSON.parse(wire)];
      for (const message of messages) if (message.result?.tools) rawTools.push(...message.result.tools);
    }
    return response;
  };
  return {calls, rawTools, access, transport, fetch};
}
const makeClient = (f, audience, modern) => {
  const client = new Client({name: 'test-client', version: '1.0.0'}, modern
    ? {versionNegotiation: {mode: {pin: '2026-07-28'}}} : undefined);
  const wire = new StreamableHTTPClientTransport(new URL(`${origin}/mcp/${audience}`),
    {fetch: f.fetch, authProvider: {token: async () => 'valid'}});
  return {client, wire};
};

for (const modern of [true, false]) test(`MCP ${modern ? '2026' : '2025'} SDK client lists and calls only its audience`, async () => {
  const f = fixture(), {client, wire} = makeClient(f, 'admin', modern);
  try {
    await client.connect(wire);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ['admin_read']);
    assert.deepEqual(listed.tools[0]._meta?.securitySchemes, [{type: 'oauth2', scopes: ['example.one:read']}]);
    assert.deepEqual(f.rawTools[0].securitySchemes, [{type: 'oauth2', scopes: ['example.one:read']}]);
    const result = await client.callTool({name: 'admin_read', arguments: {}});
    assert.deepEqual(result.structuredContent, {ok: true});
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].audience, 'admin');
    assert.equal(f.calls[0].credential.kind, 'oauth');
  } finally { await client.close(); }
});

test('MCP requires bearer, denies foreign Origin and filters live permission before list and call', async () => {
  const f = fixture();
  const unauth = await f.transport.dispatch(new Request(`${origin}/mcp/app`, {method: 'POST'}), 'app', 'r1');
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /oauth-protected-resource/);
  const foreign = await f.transport.dispatch(new Request(`${origin}/mcp/app`, {method: 'POST',
    headers: {authorization: 'Bearer valid', origin: 'https://foreign.invalid'}}), 'app', 'r2');
  assert.equal(foreign.status, 403);
  f.access.allow = false;
  const {client, wire} = makeClient(f, 'app', true);
  try {
    await client.connect(wire);
    assert.deepEqual((await client.listTools()).tools, []);
    await assert.rejects(() => client.callTool({name: 'app_read', arguments: {}}));
    assert.equal(f.calls.length, 0);
  } finally { await client.close(); }
});

test('MCP tool reauth challenge covers a revoked OAuth token after request authentication', async () => {
  const f = fixture(), {client, wire} = makeClient(f, 'admin', true);
  try {
    await client.connect(wire);
    const expected = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/admin", `
      + 'error="invalid_token", error_description="Access token is no longer valid"';
    for (const mode of ['throw-unauthorized', 'failed-unauthorized']) {
      f.access.engine = mode;
      const result = await client.callTool({name: 'admin_read', arguments: {}});
      assert.equal(result.isError, true);
      assert.deepEqual(result._meta?.['mcp/www_authenticate'], [expected]);
    }
    f.access.engine = 'throw-forbidden';
    const forbidden = await client.callTool({name: 'admin_read', arguments: {}});
    assert.equal(forbidden.isError, true);
    assert.equal(forbidden._meta?.['mcp/www_authenticate'], undefined);
  } finally { await client.close(); }
});

test('MCP resource list and read obey audience and fresh permission', async () => {
  const f = fixture(true), {client, wire} = makeClient(f, 'admin', true);
  try {
    await client.connect(wire);
    assert.deepEqual((await client.listResources()).resources.map(item => item.uri), ['creezio://admin/guide']);
    const read = await client.readResource({uri: 'creezio://admin/guide'});
    assert.equal(read.contents[0].text, 'Guide text');
    f.access.allow = false;
    assert.deepEqual((await client.listResources()).resources, []);
    await assert.rejects(() => client.readResource({uri: 'creezio://admin/guide'}));
  } finally { await client.close(); }
  const app = makeClient(f, 'app', true);
  try { await app.client.connect(app.wire); assert.deepEqual((await app.client.listResources()).resources, []); }
  finally { await app.client.close(); }
});
