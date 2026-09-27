import {createMcpHandler, METHOD_NOT_FOUND, ProtocolError, Server, type CallToolResult, type Tool} from '@modelcontextprotocol/server';
import type {AuthorizationAudience} from '../authorization/types.ts';
import type {OperationRegistry} from '../operations/registry.ts';
import type {createOperationEngine} from '../operations/service.ts';
import {OperationError} from '../operations/types.ts';
import type {WidgetApprovalService} from '../widgets/approval.ts';
import {createMcpCatalog} from './catalog.ts';
import type {McpCatalog, McpCredential, McpResourceBinding, McpToolBinding} from './types.ts';

type Engine = ReturnType<typeof createOperationEngine>;
export interface McpAuthenticatedRequest {
  readonly credential: McpCredential;
  readonly contextId: string;
}
export interface McpDiscoveryTarget {
  readonly audience: AuthorizationAudience;
  readonly contextId: string;
  readonly actors: readonly string[];
  readonly permissionIds: readonly string[];
}
export interface McpHttpOptions {
  /** Canonical deployed origin; never derive the protected resource from Host. */
  readonly origin: string;
  readonly resourceMetadataUrl: (audience: AuthorizationAudience) => string;
  /** Must verify bearer, revocation, resource, audience and context afresh. */
  readonly authenticate: (request: Request, audience: AuthorizationAudience, resource: string) => Promise<McpAuthenticatedRequest | null>;
  /** Native permission resolver, not an MCP-local role implementation. */
  readonly canDiscover: (identity: McpAuthenticatedRequest, target: McpDiscoveryTarget) => Promise<boolean>;
  /** Returns only contents read through the host's permission and operation guards. */
  readonly loadResource?: (resource: McpResourceBinding, identity: McpAuthenticatedRequest) => Promise<{text: string} | {blob: string}>;
  /** Existing host approval service; OAuth commands may request a native human decision. */
  readonly approvals?: Pick<WidgetApprovalService, 'request' | 'resolveApproved'>;
}

const encoder = new TextEncoder();
const MAX_BODY = 65_536;
const MAX_HEADERS = 16_384;
function reply(status: number, code: string, requestId: string, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-creezio-request-id', requestId);
  return new Response(JSON.stringify({error: {code}, requestId}), {status, headers});
}
function admittedHeaders(request: Request): boolean {
  let total = 0;
  for (const [name, value] of request.headers) {
    total += encoder.encode(name).length + encoder.encode(value).length + 4;
    if (total > MAX_HEADERS) return false;
  }
  return true;
}
function presentTool(binding: McpToolBinding): Tool {
  const securitySchemes = binding.auth.includes('oauth')
    ? [{type: 'oauth2', scopes: [...binding.permissions]}] : [];
  return {
    name: binding.name,
    description: `${binding.moduleId}:${binding.operationId}`,
    inputSchema: binding.inputSchema as Tool['inputSchema'],
    // MCP clients validate structuredContent against this wire schema. The
    // operation engine has already validated `input` against its own output schema.
    outputSchema: (binding.ui ? {
      type: 'object', additionalProperties: false,
      properties: {
        kind: {const: 'creezio.widget.render.v1'},
        invocationRequestId: {type: 'string'},
        instance: {type: 'object', additionalProperties: false, properties: {
          host: {const: 'external-mcp'}, instanceId: {type: 'string'}, instanceRevision: {const: 1},
          moduleId: {const: binding.ui.widget.moduleId}, widgetId: {const: binding.ui.widget.widgetId},
          widgetVersion: {const: binding.ui.widget.version}, audience: {const: binding.audience},
          resourceUri: {const: binding.ui.resourceUri}, resourceDigest: {const: binding.ui.widget.resourceDigest},
        }, required: ['host', 'instanceId', 'instanceRevision', 'moduleId', 'widgetId', 'widgetVersion',
          'audience', 'resourceUri', 'resourceDigest']},
        input: binding.outputSchema,
      }, required: ['kind', 'invocationRequestId', 'instance', 'input'],
    } : binding.outputSchema) as Tool['outputSchema'],
    annotations: {readOnlyHint: binding.annotations.readOnly, destructiveHint: binding.annotations.destructive,
      idempotentHint: binding.annotations.idempotent, openWorldHint: binding.annotations.openWorld},
    ...(securitySchemes.length ? {securitySchemes} : {}),
    ...(securitySchemes.length || binding.ui ? {_meta: {
      ...(securitySchemes.length ? {securitySchemes} : {}),
      ...(binding.ui ? {ui: {resourceUri: binding.ui.resourceUri, visibility: [...binding.ui.visibility]}} : {}),
    }} : {}),
  };
}
function toolFailure(code: string, challenge?: string): CallToolResult {
  return {content: [{type: 'text', text: code}], isError: true,
    ...(code === 'unauthorized' && challenge ? {_meta: {'mcp/www_authenticate': [challenge]}} : {})};
}
function executionResult(execution: Awaited<ReturnType<Engine['status']>>, replayed: boolean,
  reauthChallenge?: string, binding?: McpToolBinding, audience?: AuthorizationAudience): CallToolResult {
  if (!execution) return {content: [{type: 'text', text: 'Execution not found.'}], isError: true};
  const envelope = {executionId: execution.id, state: execution.state, output: execution.output,
    errorCode: execution.errorCode, replayed};
  if (execution.state === 'failed') return {content: [{type: 'text', text: JSON.stringify(envelope)}], isError: true,
    ...(execution.errorCode === 'unauthorized' && reauthChallenge
      ? {_meta: {'mcp/www_authenticate': [reauthChallenge]}} : {})};
  const structuredContent = execution.state === 'succeeded' && binding?.ui && audience
    ? {kind: 'creezio.widget.render.v1', invocationRequestId: crypto.randomUUID(),
      instance: {host: 'external-mcp', instanceId: crypto.randomUUID(), instanceRevision: 1,
        moduleId: binding.ui.widget.moduleId, widgetId: binding.ui.widget.widgetId,
        widgetVersion: binding.ui.widget.version, audience,
        resourceUri: binding.ui.resourceUri, resourceDigest: binding.ui.widget.resourceDigest},
      input: execution.output}
    : execution.output && typeof execution.output === 'object' && !Array.isArray(execution.output)
      ? execution.output as Record<string, unknown> : undefined;
  return {content: [{type: 'text', text: JSON.stringify(envelope)}], ...(structuredContent ? {structuredContent} : {})};
}

/** One stateless MCP exchange per request, routed by the host to an exact audience path. */
export function createMcpHttpTransport(catalog: McpCatalog, registry: OperationRegistry, engine: Engine, options: McpHttpOptions) {
  const index = createMcpCatalog(catalog, registry);
  const origin = new URL(options.origin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)
    || origin.pathname !== '/' || origin.search || origin.hash) throw new TypeError('Invalid MCP origin.');
  const resources = {admin: `${origin.origin}/mcp/admin`, app: `${origin.origin}/mcp/app`};
  const permitted = (identity: McpAuthenticatedRequest, audience: AuthorizationAudience,
    binding: Pick<McpToolBinding | McpResourceBinding, 'actors' | 'permissions' | 'context'>) =>
    options.canDiscover(identity, {audience, contextId: binding.context === 'application' ? 'application' : identity.contextId, actors: binding.actors,
      permissionIds: binding.permissions});
  return Object.freeze({
    async dispatch(request: Request, audience: AuthorizationAudience, requestId: string): Promise<Response> {
      if (audience !== 'admin' && audience !== 'app') return reply(404, 'not_found', requestId);
      const resource = resources[audience];
      if (request.url.split('?')[0] !== resource || new URL(request.url).search) return reply(404, 'not_found', requestId);
      if (!admittedHeaders(request)) return reply(431, 'headers_too_large', requestId);
      if (request.headers.get('origin') !== null && request.headers.get('origin') !== origin.origin)
        return reply(403, 'origin_denied', requestId);
      const host = request.headers.get('host');
      if (host !== null && host !== origin.host) return reply(403, 'host_denied', requestId);
      if (request.method !== 'POST') return reply(405, 'method_not_allowed', requestId, {allow: 'POST'});
      const challenge = `Bearer resource_metadata="${options.resourceMetadataUrl(audience)}"`;
      const reauthChallenge = `${challenge}, error="invalid_token", error_description="Access token is no longer valid"`;
      if (!request.headers.has('authorization')) return reply(401, 'authentication_required', requestId,
        {'www-authenticate': challenge});
      let identity: McpAuthenticatedRequest | null;
      try { identity = await options.authenticate(request, audience, resource); }
      catch { return reply(503, 'authentication_unavailable', requestId); }
      if (!identity || !['oauth', 'api-token'].includes(identity.credential?.kind)
        || typeof identity.credential.token !== 'string' || !identity.credential.token
        || identity.credential.kind === 'oauth' && identity.credential.resource !== resource
        || typeof identity.contextId !== 'string' || !identity.contextId)
        return reply(401, 'authentication_required', requestId, {'www-authenticate': challenge});
      const principal = identity;
      const hasWidgetUi = index.resources(audience).some(binding => binding.source.kind === 'compiled-widget');
      const server = new Server({name: `creezio-${audience}`, version: '1.0.0'},
        {capabilities: {tools: {listChanged: false}, resources: {listChanged: false},
          ...(hasWidgetUi ? {extensions: {'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app']}}} : {})}});
      server.setRequestHandler('tools/list', async () => {
        const visible = [];
        for (const binding of index.tools(audience)) {
          if (!binding.auth.includes(principal.credential.kind) || !await permitted(principal, audience, binding)) continue;
          visible.push(presentTool(binding));
        }
        return {tools: visible};
      });
      server.setRequestHandler('tools/call', async message => {
        const binding = index.tool(audience, message.params.name);
        if (!binding || !binding.auth.includes(principal.credential.kind)
          || !await permitted(principal, audience, binding)) throw new ProtocolError(METHOD_NOT_FOUND, 'Tool not found.');
        const rawApproval = (message.params as { _meta?: Record<string, unknown> })._meta?.['creezio/approvalId'];
        if (rawApproval !== undefined && (typeof rawApproval !== 'string'
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rawApproval))) return toolFailure('invalid_input');
        const contextId = binding.context === 'application' ? 'application' : principal.contextId;
        const input = message.params.arguments ?? {};
        try {
          const result = await engine.invoke({credential: principal.credential, moduleId: binding.moduleId,
            operationId: binding.operationId, audience, contextId,
            input, ...(rawApproval ? {approvalId: rawApproval} : {}), signal: request.signal});
          return executionResult(result.execution, result.replayed,
            principal.credential.kind === 'oauth' ? reauthChallenge : undefined, binding, audience);
        } catch (error) {
          if (error instanceof OperationError && error.code === 'approval_required'
            && principal.credential.kind === 'oauth' && rawApproval === undefined && options.approvals) {
            try {
              const approvalRequest = {credential: principal.credential,
                audience, contextId, moduleId: binding.moduleId, operationId: binding.operationId, input};
              const approved = await options.approvals.resolveApproved(approvalRequest);
              if (approved) {
                const resumed = await engine.invoke({credential: principal.credential,
                  moduleId: binding.moduleId, operationId: binding.operationId, audience, contextId,
                  input, approvalId: approved.approvalId, signal: request.signal});
                return executionResult(resumed.execution, resumed.replayed, reauthChallenge, binding, audience);
              }
              const grant = await options.approvals.request(approvalRequest);
              const url = new URL(`/approvals/${audience}/${encodeURIComponent(grant.approvalId)}`, origin.origin);
              url.searchParams.set('context', contextId);
              return {isError: true,
                content: [{type: 'text', text: `approval_required: Open ${url.href} in Creezio to decide, then retry the exact original arguments. The MCP host may include _meta["creezio/approvalId"] set to ${grant.approvalId}.`}],
                _meta: {'creezio/approval': {approvalId: grant.approvalId, url: url.href, state: 'pending'}}};
            } catch (approvalError) {
              return toolFailure(approvalError instanceof OperationError ? approvalError.code : 'unavailable');
            }
          }
          if (error instanceof OperationError) return toolFailure(error.code,
            principal.credential.kind === 'oauth' ? reauthChallenge : undefined);
          return {content: [{type: 'text', text: 'unavailable'}], isError: true};
        }
      });
      server.setRequestHandler('resources/list', async () => {
        const visible = [];
        for (const binding of index.resources(audience)) {
          if (binding.source.kind !== 'compiled-widget' && !options.loadResource) continue;
          if (!binding.actors.includes(principal.credential.kind === 'oauth' ? 'delegated-user' : 'machine')
            || !await permitted(principal, audience, binding)) continue;
          visible.push({uri: binding.uri, name: binding.id, mimeType: binding.mimeType});
        }
        return {resources: visible};
      });
      server.setRequestHandler('resources/read', async message => {
        const binding = index.resource(audience, message.params.uri);
        if (!binding || binding.source.kind !== 'compiled-widget' && !options.loadResource
          || !binding.actors.includes(principal.credential.kind === 'oauth' ? 'delegated-user' : 'machine')
          || !await permitted(principal, audience, binding)) throw new ProtocolError(METHOD_NOT_FOUND, 'Resource not found.');
        const result = binding.source.kind === 'compiled-widget'
          ? {text: binding.source.text, _meta: {ui: binding.source.uiMeta}}
          : await options.loadResource!(binding, principal);
        return {contents: [{uri: binding.uri, mimeType: binding.mimeType, ...result}]};
      });
      const handler = createMcpHandler(() => server, {maxRequestBodySize: MAX_BODY});
      const response = await handler.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store');
      headers.set('x-content-type-options', 'nosniff');
      headers.set('x-creezio-request-id', requestId);
      return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
    },
  });
}
