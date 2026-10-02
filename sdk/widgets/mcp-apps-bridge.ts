import {AppBridge, PostMessageTransport, type McpUiResourceCsp,
  type McpUiResourcePermissions} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {CallToolRequest, CallToolResult} from '@modelcontextprotocol/client';
import type {WidgetInstanceRef} from './types.ts';
import {normalizeWidgetOpenLink} from './host-open-link.ts';

const encoder = new TextEncoder();
const digestPattern = /^sha256-[a-f0-9]{64}$/;
const frameLeases = new WeakMap<HTMLIFrameElement, object>();
const missingTool = (code: string): CallToolResult => ({isError: true,
  content: [{type: 'text', text: code}]});

export interface McpAppsBridgeOptions {
  iframe: HTMLIFrameElement;
  sandboxOrigin: string;
  cspProfileId: string;
  html: string;
  resourceDigest: string;
  csp: McpUiResourceCsp;
  permissions: McpUiResourcePermissions;
  instance: WidgetInstanceRef;
  toolNames: readonly string[];
  toolInput?: Readonly<Record<string, unknown>>;
  toolResult?: CallToolResult;
  isCurrent: () => boolean;
  /** App-only tools are resolved by the compiled catalog and rechecked server-side. */
  callTool: (params: CallToolRequest['params']) => Promise<CallToolResult>;
  /** Accept a proposal into the composer; the user sends it separately. */
  proposeMessage?: (text: string) => Promise<boolean>;
  /** Replace the pending context for the next authorized turn. */
  replaceContext?: (content: unknown) => Promise<boolean>;
  /** Ask the authenticated host to confirm and open one external HTTPS link. */
  openLink?: (url: string, signal: AbortSignal) => Promise<boolean>;
}

export interface McpAppsBridge {
  readonly instanceId: string;
  sendToolResult(result: CallToolResult): Promise<void>;
  dispose(): Promise<void>;
}

function exactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' ||
      url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

async function matchesDigest(html: string, digest: string): Promise<boolean> {
  if (!digestPattern.test(digest) || !globalThis.crypto?.subtle) return false;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(html)));
  return `sha256-${Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')}` === digest;
}

/** Mount one verified resource. The caller owns instance/session guards and the iframe node. */
export async function createMcpAppsBridge(options: McpAppsBridgeOptions): Promise<McpAppsBridge> {
  const {iframe, sandboxOrigin, cspProfileId, html, resourceDigest, instance} = options;
  if (!exactOrigin(sandboxOrigin) || sandboxOrigin === location.origin ||
    !digestPattern.test(cspProfileId) || !instance.instanceId || !options.isCurrent() ||
    encoder.encode(html).byteLength > 1_048_576 || !await matchesDigest(html, resourceDigest))
    throw new TypeError('Invalid widget resource or sandbox configuration.');
  if (iframe.isConnected === false || !Array.isArray(options.toolNames) || options.toolNames.length > 1000)
    throw new TypeError('Invalid widget host.');
  const allowedTools = new Set(options.toolNames);
  let disposed = false;
  let initialized = false;
  let resourceSent = false;
  const lease = {};
  frameLeases.set(iframe, lease);
  const ownsFrame = () => frameLeases.get(iframe) === lease;
  const active = () => !disposed && ownsFrame() && options.isCurrent();
  const proxyUrl = new URL(`/profiles/${cspProfileId}/sandbox.html`, sandboxOrigin);
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.referrerPolicy = 'no-referrer';
  iframe.src = proxyUrl.href;
  const target = iframe.contentWindow;
  if (!target) throw new Error('Widget sandbox unavailable.');
  // SDK PostMessageTransport checks source. Capture phase also rejects a
  // navigated frame whose WindowProxy stayed the same but origin changed.
  const guard = (event: MessageEvent) => {
    if (event.source === target && event.origin !== sandboxOrigin) event.stopImmediatePropagation();
  };
  window.addEventListener('message', guard, {capture: true});
  const transport = new PostMessageTransport(target, target);
  const hostCapabilities = {
    sandbox: {csp: options.csp, permissions: options.permissions},
    serverTools: {},
    ...(options.openLink ? {openLinks: {}} : {}),
    ...(options.proposeMessage ? {message: {text: {}}} : {}),
    ...(options.replaceContext ? {updateModelContext: {text: {}}} : {}),
  };
  const bridge = new AppBridge(null, {name: 'Creezio', version: '1.0.0'}, hostCapabilities,
    {hostContext: {platform: 'web', locale: 'fr', displayMode: 'inline'}});
  let finishReady: (() => void) | null = null;
  let failReady: ((reason: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {finishReady = resolve; failReady = reject;});
  const timer = setTimeout(() => failReady?.(new Error('Widget initialization timed out.')), 15_000);
  bridge.onsandboxready = () => {
    if (!active() || resourceSent) return;
    resourceSent = true;
    void bridge.sendSandboxResourceReady({html, csp: options.csp, permissions: options.permissions})
      .catch(error => failReady?.(error instanceof Error ? error : new Error('Widget sandbox failed.')));
  };
  bridge.oninitialized = () => {
    if (!active()) return;
    initialized = true;
    const send = async () => {
      await bridge.sendToolInput({arguments: {...options.toolInput}});
      if (options.toolResult) await bridge.sendToolResult(options.toolResult);
      finishReady?.();
    };
    void send().catch(error => failReady?.(error instanceof Error ? error : new Error('Widget input failed.')));
  };
  bridge.oncalltool = async params => {
    if (!active() || !initialized || !allowedTools.has(params.name)) return missingTool('widget_tool_unavailable');
    try {
      const result = await options.callTool(params);
      // A linked image can arrive after the frame, session, or context was replaced.
      // Never deliver that result to a stale widget instance.
      return active() ? result : missingTool('widget_tool_unavailable');
    } catch { return missingTool('outcome_unknown'); }
  };
  bridge.onopenlink = async (params, extra) => {
    const url = normalizeWidgetOpenLink(params.url);
    if (!active() || !initialized || !options.openLink || !url) return {isError: true};
    try { return {isError: !await options.openLink(url, extra.mcpReq.signal) || !active()}; }
    catch { return {isError: true}; }
  };
  bridge.onmessage = async params => {
    if (!active() || !initialized || !options.proposeMessage || params.role !== 'user' ||
      params.content.length !== 1 || params.content[0]?.type !== 'text' ||
      typeof params.content[0].text !== 'string' || params.content[0].text.length > 16_000)
      return {isError: true};
    try { return {isError: !await options.proposeMessage(params.content[0].text)}; }
    catch { return {isError: true}; }
  };
  bridge.onupdatemodelcontext = async params => {
    if (!active() || !initialized || !options.replaceContext) throw new Error('widget_context_unavailable');
    if (!await options.replaceContext(params)) throw new Error('widget_context_rejected');
    return {};
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (initialized && ownsFrame()) {
      try { await bridge.teardownResource({}, {timeout: 1500}); } catch { /* renderer may already be gone */ }
    }
    clearTimeout(timer);
    window.removeEventListener('message', guard, {capture: true});
    await transport.close();
    if (ownsFrame()) {
      frameLeases.delete(iframe);
      iframe.removeAttribute('src');
    }
  };
  try {
    await bridge.connect(transport);
    await ready;
    if (!active()) throw new Error('Widget instance is no longer active.');
    return Object.freeze({instanceId: instance.instanceId,
      sendToolResult: async (result: CallToolResult) => {if (!active() || !initialized) throw new Error('Widget inactive.');
        await bridge.sendToolResult(result);}, dispose});
  } catch (error) {
    await dispose();
    throw error;
  } finally { clearTimeout(timer); }
}
