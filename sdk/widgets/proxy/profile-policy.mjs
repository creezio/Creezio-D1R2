/** Static HTTP response policy for one compiled MCP Apps sandbox profile.
 * The publisher applies these headers to /profiles/<cspProfileId>/sandbox.html. */
const profileIdPattern = /^sha256-[a-f0-9]{64}$/;

export function exactOrigin(value, local = false) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' ||
      local && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

function declaredSources(value, name, local) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError('Invalid widget CSP sources.');
  const result = [];
  for (const source of value) {
    let valid = exactOrigin(source, local);
    if (name === 'connectDomains' && typeof source === 'string') {
      try {const url = new URL(source); valid ||= url.protocol === 'wss:' && url.origin === source;}
      catch { /* invalid remains false */ }
    }
    if (name === 'resourceDomains' && typeof source === 'string' &&
      /^https:\/\/\*\.[a-z0-9.-]+$/.test(source)) valid = true;
    if (!valid || /[;\s'"\\]/.test(source))
      throw new TypeError('Invalid widget CSP source.');
    if (!result.includes(source)) result.push(source);
  }
  return result;
}

export function sandboxProfileHeaders({cspProfileId, csp = {}, hostOrigins, local = false}) {
  if (!profileIdPattern.test(cspProfileId) || !csp || typeof csp !== 'object' || Array.isArray(csp))
    throw new TypeError('Invalid widget CSP profile.');
  if (!Array.isArray(hostOrigins) || !hostOrigins.length || hostOrigins.length > 16 ||
    hostOrigins.some(origin => !exactOrigin(origin, local)))
    throw new TypeError('Invalid widget host origins.');
  const resources = declaredSources(csp.resourceDomains, 'resourceDomains', local);
  const connects = declaredSources(csp.connectDomains, 'connectDomains', local);
  const frames = declaredSources(csp.frameDomains, 'frameDomains', local);
  const bases = declaredSources(csp.baseUriDomains, 'baseUriDomains', local);
  const sources = items => items.length ? items.join(' ') : "'none'";
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' ${resources.join(' ')}`.trim(),
    `style-src 'self' 'unsafe-inline' ${resources.join(' ')}`.trim(),
    `img-src 'self' data: blob: ${resources.join(' ')}`.trim(),
    `font-src 'self' data: ${resources.join(' ')}`.trim(),
    `media-src 'self' data: ${resources.join(' ')}`.trim(),
    `connect-src ${sources(connects)}`,
    `frame-src ${sources(frames)}`,
    `base-uri ${bases.length ? bases.join(' ') : "'self'"}`,
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    `frame-ancestors ${[...new Set(hostOrigins)].join(' ')}`,
  ].join('; ');
  return Object.freeze({
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
  });
}
