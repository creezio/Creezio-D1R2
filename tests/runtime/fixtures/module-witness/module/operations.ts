/** Non-sensitive metadata only. No identity, database, secrets or provider is consulted. */
export function read_status() {
  return Response.json({ module: 'example.witness', version: '1.0.0', status: 'ready' });
}
/** The T03 dispatch must refuse before reaching this sentinel. */
export function read_protected() {
  throw new Error('Protected witness handler must not execute before native authentication exists.');
}
