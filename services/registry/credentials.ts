/** Purpose-separated opaque credentials; persistent storage receives digests only. */
const purposes = {installation: 'cz1d_', owner: 'cz1o_', email: 'cz1e_', oauth: 'cz1g_'} as const;
type Purpose = keyof typeof purposes;
const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return `sha256:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export async function digestCredential(value: unknown, purpose: Purpose): Promise<string | null> {
  const prefix = purposes[purpose];
  if (typeof value !== 'string' || value.length !== prefix.length + 43 || !value.startsWith(prefix)) return null;
  const suffix = value.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(suffix)) return null;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(suffix.replaceAll('-', '+').replaceAll('_', '/') + '='), character => character.charCodeAt(0)); }
  catch { return null; }
  if (bytes.length !== 32 || base64url(bytes) !== suffix) return null;
  return digest(`creezio:registry:${purpose}:v1:${value}`);
}
export async function issueCredential(purpose: Purpose): Promise<{token: string; digest: string}> {
  const token = purposes[purpose] + base64url(crypto.getRandomValues(new Uint8Array(32)));
  return {token, digest: (await digestCredential(token, purpose))!};
}
