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

function fixture(withResource = false, withWidget = false) {
  const calls = [], rawTools = [], access = {allow: true, engine: 'success'};
  const engine = {async invoke(value) {
    calls.push(value);
    if (access.engine === 'throw-unauthorized') throw new OperationError('unauthorized');
    if (access.engine === 'throw-forbidden') throw new OperationError('forbidden');
    if (access.engine === 'failed-unauthorized') return {execution: {id: 'execution-1', state: 'failed',
      output: null, errorCode: 'unauthorized'}, replayed: false};
    return {execution: {id: 'execution-1', state: 'succeeded', output: {ok: true}, errorCode: null}, replayed: false};
  }};
  const widgetUri = `ui://creezio/example.one/widget/1.0.0/${digest}.html`;
  const widgetTool = {...tool('admin'), ui: {resourceUri: widgetUri, visibility: ['model', 'app'],
    widget: {moduleId: 'example.one', widgetId: 'widget', version: '1.0.0', resourceDigest: digest}}};
  const widgetResource = {id: 'widget', uri: widgetUri, mimeType: 'text/html;profile=mcp-app',
    contributorModuleId: 'example.one', audience: 'admin', permissions: ['example.one:read'],
    actors: ['delegated-user'], context: 'application', source: {kind: 'compiled-widget', digest,
      cspProfileId: `sha256-${'b'.repeat(64)}`, text: '<!doctype html><html></html>',
      uiMeta: {csp: {connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: []}, permissions: {}}}};
  const catalog = {tools: [withWidget ? widgetTool : tool('admin'), tool('app')],
    resources: withWidget ? [widgetResource] : withResource ? [{id: 'guide', uri: 'creezio://admin/guide',
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
const makeClient = (f, audience, modern, token = 'valid') => {
  const client = new Client({name: 'test-client', version: '1.0.0'}, modern
    ? {versionNegotiation: {mode: {pin: '2026-07-28'}}} : undefined);
  const wire = new StreamableHTTPClientTransport(new URL(`${origin}/mcp/${audience}`),
    {fetch: f.fetch, authProvider: {token: async () => token}});
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

test('MCP Apps tool and compiled resource preserve UI metadata, text fallback and live authorization', async () => {
  const f = fixture(false, true), {client, wire} = makeClient(f, 'admin', true);
  try {
    await client.connect(wire);
    assert.deepEqual(client.getServerCapabilities()?.extensions?.['io.modelcontextprotocol/ui']?.mimeTypes,
      ['text/html;profile=mcp-app']);
    const tool = (await client.listTools()).tools.find(item => item.name === 'admin_read');
    assert.ok(tool?._meta?.ui?.resourceUri.startsWith('ui://creezio/'));
    assert.deepEqual(tool?._meta?.ui?.visibility, ['model', 'app']);
    const result = await client.callTool({name: 'admin_read', arguments: {}});
    assert.equal(result.structuredContent?.kind, 'creezio.widget.render.v1');
    assert.equal(result.structuredContent?.instance.resourceUri, tool._meta.ui.resourceUri);
    assert.deepEqual(result.structuredContent?.input, {ok: true});
    assert.equal(result.content[0].type, 'text');
    const read = await client.readResource({uri: tool._meta.ui.resourceUri});
    assert.equal(read.contents[0].text, '<!doctype html><html></html>');
    assert.deepEqual(read.contents[0]._meta?.ui?.csp?.connectDomains, []);
    f.access.allow = false;
    await assert.rejects(() => client.readResource({uri: tool._meta.ui.resourceUri}));
  } finally { await client.close(); }
});

test('MCP approval pointer stays in request metadata outside operation arguments', async () => {
  const f = fixture(), {client, wire} = makeClient(f, 'admin', true);
  try {
    await client.connect(wire);
    await client.callTool({name: 'admin_read', arguments: {}, _meta: {'creezio/approvalId': 'approval-1'}});
    assert.equal(f.calls[0].approvalId, 'approval-1');
    assert.deepEqual(f.calls[0].input, {});
    const denied = await client.callTool({name: 'admin_read', arguments: {},
      _meta: {'creezio/approvalId': 'invalid/id'}});
    assert.equal(denied.isError, true);
    assert.equal(f.calls.length, 1);
  } finally { await client.close(); }
});

test('MCP OAuth approval exposes a native URL, deduplicates the grant and preserves exact retry input', async () => {
  const input = {id: 'record-1', title: 'Updated', record_version: 2, request_key: 'same-key'};
  const grantCalls = [], resolveCalls = [], invokes = [];
  let approved = false, expired = false, revoked = false, effects = 0;
  const declaration = {id: 'rename', kind: 'command', context: 'required', audiences: ['admin'],
    actors: ['delegated-user', 'machine'], permissions: [{moduleId: 'example.one', id: 'edit'}]};
  const binding = {...tool('admin'), name: 'admin_rename', operationId: 'rename',
    auth: ['oauth', 'api-token'], actors: ['delegated-user', 'machine'], context: 'required',
    permissions: ['example.one:edit'], annotations: {readOnly: false, destructive: true,
      idempotent: true, openWorld: false},
    inputSchema: {type: 'object', additionalProperties: false, properties: {
      id: {type: 'string'}, title: {type: 'string'}, record_version: {type: 'integer'},
      request_key: {type: 'string'}}, required: ['id', 'title', 'record_version', 'request_key']}};
  const transport = createMcpHttpTransport({tools: [binding], resources: []},
    {resolve: () => ({declaration, contractDigest: digest})},
    {async invoke(value) {
      invokes.push(value);
      if (!value.approvalId) throw new OperationError('approval_required');
      if (!approved || value.approvalId !== 'approval-1' || JSON.stringify(value.input) !== JSON.stringify(input))
        throw new OperationError('forbidden');
      effects++;
      return {execution: {id: 'execution-1', state: 'succeeded', output: {ok: true}, errorCode: null},
        replayed: false};
    }}, {origin, resourceMetadataUrl: audience => `${origin}/metadata/${audience}`,
      async authenticate(request, _audience, resource) {
        const bearer = request.headers.get('authorization');
        return bearer === 'Bearer valid' && !revoked ? {credential: {kind: 'oauth', token: 'valid', resource},
          contextId: 'tenant-a'} : bearer === 'Bearer machine'
          ? {credential: {kind: 'api-token', token: 'machine'}, contextId: 'tenant-a'} : null;
      },
      async canDiscover() {return true;},
      approvals: {async resolveApproved(value) {
        resolveCalls.push(value);
        assert.equal(value.credential.kind, 'oauth');
        return approved && !expired && JSON.stringify(value.input) === JSON.stringify(input)
          ? {approvalId: 'approval-1'} : null;
      }, async request(value) {
        grantCalls.push(value);
        assert.equal(value.credential.kind, 'oauth');
        if (approved || expired || JSON.stringify(value.input) !== JSON.stringify(input))
          throw new OperationError('conflict');
        return {approvalId: 'approval-1', state: 'pending', expiresAtMs: Date.now() + 60_000};
      }}});
  const fetch = (url, init) => transport.dispatch(new Request(url, init), 'admin', 'request-approval');
  const oauth = makeClient({fetch}, 'admin', true);
  try {
    await oauth.client.connect(oauth.wire);
    const first = await oauth.client.callTool({name: 'admin_rename', arguments: input});
    assert.equal(first.isError, true);
    assert.equal(first._meta?.['creezio/approval']?.approvalId, 'approval-1');
    assert.equal(first._meta?.['creezio/approval']?.url,
      `${origin}/approvals/admin/approval-1?context=tenant-a`);
    assert.match(first.content[0].text, /https:\/\/example\.invalid\/approvals\/admin\/approval-1/);
    assert.match(first.content[0].text, /_meta\["creezio\/approvalId"\] set to approval-1/);
    assert.equal(JSON.stringify(first).includes('Bearer valid'), false, 'OAuth bearer is absent from result');
    assert.equal(grantCalls.length, 1);
    assert.equal(effects, 0);
    const repeated = await oauth.client.callTool({name: 'admin_rename', arguments: input});
    assert.equal(repeated._meta?.['creezio/approval']?.approvalId, 'approval-1');
    assert.equal(grantCalls.length, 2);
    assert.equal(effects, 0);
    const pointer = {_meta: {'creezio/approvalId': 'approval-1'}};
    assert.equal((await oauth.client.callTool({name: 'admin_rename', arguments: input, ...pointer})).isError, true);
    assert.equal(effects, 0);
    approved = true;
    assert.equal((await oauth.client.callTool({name: 'admin_rename',
      arguments: {...input, title: 'Altered'}, ...pointer})).isError, true);
    assert.equal(effects, 0);
    const altered = await oauth.client.callTool({name: 'admin_rename',
      arguments: {...input, title: 'Altered'}});
    assert.equal(altered.isError, true);
    assert.equal(effects, 0);
    expired = true;
    assert.equal((await oauth.client.callTool({name: 'admin_rename', arguments: input})).isError, true);
    assert.equal(effects, 0);
    expired = false;
    revoked = true;
    await assert.rejects(oauth.client.callTool({name: 'admin_rename', arguments: input}));
    assert.equal(effects, 0);
    revoked = false;
    const final = await oauth.client.callTool({name: 'admin_rename', arguments: input});
    assert.equal(final.isError, undefined);
    assert.deepEqual(final.structuredContent, {ok: true});
    assert.equal(effects, 1);
    assert.deepEqual(invokes.at(-1).input, input);
    assert.equal(invokes.at(-1).approvalId, 'approval-1');
    assert.equal(grantCalls.length, 4, 'exact approved retry resolves without requesting another grant');
    assert.equal(resolveCalls.length, 5);
  } finally {await oauth.client.close();}
  const machine = makeClient({fetch}, 'admin', true, 'machine');
  try {
    await machine.client.connect(machine.wire);
    const denied = await machine.client.callTool({name: 'admin_rename', arguments: input});
    assert.equal(denied.isError, true);
    assert.equal(denied._meta?.['creezio/approval'], undefined);
    assert.equal(grantCalls.length, 4, 'API token cannot create human approval grant');
    assert.equal(effects, 1);
  } finally {await machine.client.close();}
});
