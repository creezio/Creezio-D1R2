import {email, exact, id} from './validation.ts';

interface EmailDeliveryEnvironment {
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
}

const deliveryUrl = 'https://registry-email-delivery.invalid/verification';
const resendUrl = 'https://api.resend.com/emails';
const failure = (status: number) => new Response(null, {status, headers: {'cache-control': 'no-store'}});

async function boundedJson(response: Request | Response, limit: number): Promise<unknown> {
  if (!response.body) throw new Error('missing_body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (let count = 0; count <= limit; count++) {
      const chunk = await reader.read();
      if (chunk.done) {
        const joined = new Uint8Array(bytes); let offset = 0;
        for (const value of chunks) {joined.set(value, offset); offset += value.byteLength;}
        return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(joined));
      }
      if (!(chunk.value instanceof Uint8Array) || (bytes += chunk.value.byteLength) > limit)
        throw new Error('oversized_body');
      chunks.push(chunk.value);
    }
    throw new Error('oversized_body');
  } finally {
    try {void reader.cancel().catch(() => {});} catch { /* Nothing is retried. */ }
  }
}

/** Service-bound only: deployment config creates no public URL for this Worker. */
export default {async fetch(request: Request, env: EmailDeliveryEnvironment): Promise<Response> {
  if (request.url !== deliveryUrl || request.method !== 'POST') return failure(404);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return failure(400);
  if (!env.RESEND_API_KEY || !email(env.EMAIL_FROM)) return failure(503);
  let payload: unknown;
  try {payload = await boundedJson(request, 1024);} catch {return failure(400);}
  if (!exact(payload, ['to', 'code', 'challengeId']) || !email(payload.to)
    || typeof payload.code !== 'string' || !/^[0-9]{8}$/.test(payload.code)
    || !id(payload.challengeId)) return failure(400);
  const controller = new AbortController();
  let rejectDeadline: () => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = () => reject(new Error('deadline'));
  });
  void deadline.catch(() => {});
  const timer = setTimeout(() => {controller.abort(); rejectDeadline();}, 8_000);
  try {
    const response = await Promise.race([fetch(resendUrl, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: {'authorization': `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json',
        'idempotency-key': `registry-verification/${payload.challengeId}`},
      body: JSON.stringify({from: env.EMAIL_FROM, to: [payload.to],
        subject: 'Code de vérification Creezio',
        text: `Votre code de vérification Creezio : ${payload.code}\n\nCe code expire dans 10 minutes.\n\nIdentifiant de demande : ${payload.challengeId}`}),
    }), deadline]);
    if (response.status !== 200 && response.status !== 201) return failure(503);
    const receipt = await Promise.race([boundedJson(response, 1024), deadline]);
    if (!exact(receipt, ['id']) || typeof receipt.id !== 'string' || !id(receipt.id)) return failure(503);
    return new Response(null, {status: 204, headers: {'cache-control': 'no-store'}});
  } catch {return failure(503);}
  finally {clearTimeout(timer); controller.abort();}
}};
