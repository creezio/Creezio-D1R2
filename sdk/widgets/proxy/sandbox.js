/* MCP Apps double-iframe relay, adapted from ext-apps/examples/basic-host.
 * MIT license: https://github.com/modelcontextprotocol/ext-apps/blob/main/LICENSE
 * Published on a different origin from the Creezio host. */
(() => {
  'use strict';
  const config = globalThis.__CREEZIO_WIDGET_SANDBOX_CONFIG__;
  const validOrigin = value => {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return url.origin === value && (url.protocol === 'https:' ||
        url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    } catch { return false; }
  };
  const hosts = new Set(Array.isArray(config?.hostOrigins) ? config.hostOrigins.filter(validOrigin) : []);
  const profileMatch = /^\/profiles\/(sha256-[a-f0-9]{64})\/sandbox\.html$/.exec(location.pathname);
  const profile = profileMatch && config?.profiles && Object.getPrototypeOf(config.profiles) === Object.prototype
    ? config.profiles[profileMatch[1]] : null;
  if (!hosts.size || !profile || window.parent === window) return;
  const parent = window.parent;
  const encode = new TextEncoder();
  const maxBytes = 1_048_576;
  const validMessage = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0') return false;
    if (typeof value.method !== 'string' && !Object.hasOwn(value, 'id')) return false;
    if (typeof value.method === 'string' && value.method.startsWith('ui/notifications/sandbox-')) return false;
    try { return encode.encode(JSON.stringify(value)).byteLength <= maxBytes; } catch { return false; }
  };
  const canonical = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    try { return JSON.stringify(value); } catch { return null; }
  };
  let inner = null;
  let readyHostOrigin = null;
  let released = false;
  const ready = {jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {}};
  const announceReady = () => {
    if (released || inner) return;
    for (const origin of hosts) parent.postMessage(ready, origin);
  };
  const readyRetry = setInterval(announceReady, 500);
  const readyDeadline = setTimeout(() => clearInterval(readyRetry), 15_000);

  window.addEventListener('message', event => {
    if (released) return;
    if (event.source === parent && hosts.has(event.origin)) {
      const message = event.data;
      if (!readyHostOrigin) readyHostOrigin = event.origin;
      if (event.origin !== readyHostOrigin || !message || message.jsonrpc !== '2.0') return;
      if (message.method === 'ui/notifications/sandbox-resource-ready') {
        if (inner || typeof message.params?.html !== 'string' ||
          encode.encode(message.params.html).byteLength > maxBytes ||
          canonical(message.params.csp ?? {}) !== canonical(profile.csp ?? {}) ||
          canonical(message.params.permissions ?? {}) !== canonical(profile.permissions ?? {})) return;
        const iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        const allowed = [];
        for (const feature of ['camera', 'microphone', 'geolocation', 'clipboardWrite']) {
          if (profile.permissions?.[feature]) allowed.push(feature === 'clipboardWrite' ? 'clipboard-write' : feature);
        }
        if (allowed.length) iframe.setAttribute('allow', allowed.join('; '));
        iframe.setAttribute('title', 'Widget interactif Creezio');
        iframe.style.cssText = 'display:block;width:100%;height:100%;border:0';
        document.body.replaceChildren(iframe);
        inner = iframe;
        clearInterval(readyRetry);
        clearTimeout(readyDeadline);
        iframe.srcdoc = message.params.html;
        return;
      }
      if (inner?.contentWindow && validMessage(message)) inner.contentWindow.postMessage(message, location.origin);
      return;
    }
    if (inner && event.source === inner.contentWindow && readyHostOrigin && validMessage(event.data)) {
      parent.postMessage(event.data, readyHostOrigin);
    }
  });
  window.addEventListener('pagehide', () => {
    released = true;
    clearInterval(readyRetry);
    clearTimeout(readyDeadline);
    inner?.remove();
    inner = null;
  });
  announceReady();
})();
