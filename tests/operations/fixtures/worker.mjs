import { createOperationEngine } from '../../../core/operations/service.ts';
import { createOperationRegistry } from '../../../core/operations/registry.ts';
import * as validators from 'qualification:validators';
import { moduleId, permissions, dataCatalog, operationCatalog } from 'qualification:configuration';

// Internal qualification entry only; neither a product route nor a transport adapter.
const calls = {}, contexts = [];
const implementations = {
  async read_record(input, context) { return { output: await context.data.get('record', { key: { id: input.id } }) }; },
  create_record(input, context) {
    return { output: { id: input.id, title: input.title, revision: 0 }, plans: [context.data.planCreate('record',
      { values: { id: input.id, title: input.title, revision: 0 } })] };
  },
  rename_record(input, context) {
    return { output: { id: input.id, title: input.title, revision: input.record_version + 1 }, plans: [context.data.planPatch('record',
      { key: { id: input.id }, values: { title: input.title }, compare: { field: 'revision', expected: input.record_version } })] };
  },
  send_record(input) { return { output: { accepted: true }, outbox: [{ id: 'send', provider: 'synthetic-provider',
    payload: { recordId: input.id }, providerIdempotencyKey: input.request_id }] }; },
  approved_rename() { throw new Error('Approval-required fixture handler must remain unreachable.'); },
  invalid_output(input) { return { output: { id: input.id, title: 7, revision: 0 } }; },
  query_write_attempt(input, context) {
    return { output: { id: input.id, title: 'refused', revision: 0 }, plans: [context.data.planCreate('record',
      { values: { id: input.id, title: 'refused', revision: 0 } })] };
  },
};
const handlers = Object.fromEntries(Object.entries(implementations).map(([id, handler]) => [`${moduleId}:${id}`, async (input, context) => {
  calls[id] = (calls[id] ?? 0) + 1;
  contexts.push({ operationId: context.operationId, principalId: context.principalId, actorPrincipalId: context.actorPrincipalId });
  return handler(input, context);
}]));
const registry = createOperationRegistry({ catalog: operationCatalog, validators: { ...validators }, handlers });
export default { async fetch(request, env) {
  if (new URL(request.url).pathname !== '/qualification' || request.method !== 'POST') return new Response(null, { status: 404 });
  try {
    const { method, invocation } = await request.json();
    const engine = createOperationEngine({ db: env.DB, catalog: dataCatalog, registry, permissions });
    const result = method === 'status' ? await engine.status(invocation) : await engine.invoke(invocation);
    return Response.json({ ok: true, result, calls, context: contexts.at(-1) });
  } catch (error) {
    return Response.json({ ok: false, error: typeof error?.code === 'string' ? error.code : 'harness_error', calls });
  }
} };
