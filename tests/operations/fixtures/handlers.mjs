import { compileOperationSchemas } from '../../../scripts/operations/schemas.mjs';
import { createOperationRegistry } from '../../../core/operations/registry.ts';
import { moduleId, operationComposition } from './operations.mjs';
import { contractIntegrity } from '../../../sdk/contracts/validate.mjs';

/** Actual standalone validators produced by the same build-time compiler as the application. */
export async function createFixtureRegistry({ before = async () => {}, overrides = {}, maxItems } = {}) {
  const composition = operationComposition();
  if (maxItems !== undefined) {
    for (const entry of composition.modules[0].contracts.operations) entry.execution.maxItems = maxItems;
    composition.lock.modules[0].contractIntegrity = contractIntegrity(composition.modules[0]);
  }
  const compiled = compileOperationSchemas(composition);
  const validators = { ...await import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`) };
  const calls = new Map(), contexts = [];
  const implementations = {
    async read_record(input, context) { return { output: await context.data.get('record', { key: { id: input.id } }) }; },
    create_record(input, context) {
      return { output: { id: input.id, title: input.title, revision: 0 }, plans: [context.data.planCreate('record',
        { values: { id: input.id, title: input.title, revision: 0 } })] };
    },
    async rename_record(input, context) {
      await context.data.get('record', { key: { id: input.id } });
      return { output: { id: input.id, title: input.title, revision: input.record_version + 1 }, plans: [context.data.planPatch('record',
        { key: { id: input.id }, values: { title: input.title }, compare: { field: 'revision', expected: input.record_version } })] };
    },
    send_record(input) { return { output: { accepted: true }, outbox: [{ id: 'send', provider: 'synthetic-provider',
      payload: { recordId: input.id }, providerIdempotencyKey: input.request_id }] }; },
    approved_rename() { throw new Error('An approval-required handler must not run before approval support exists.'); },
    invalid_output(input) { return { output: { id: input.id, title: 7, revision: 0, unexpected: 'synthetic invalid response' } }; },
    query_write_attempt(input, context) {
      const plan = context.data.planCreate('record', { values: { id: input.id, title: 'query must not write', revision: 0 } });
      return { output: { id: input.id, title: 'query must not write', revision: 0 }, plans: [plan] };
    },
    ...overrides,
  };
  const handlers = Object.fromEntries(Object.entries(implementations).map(([id, handler]) => [`${moduleId}:${id}`, async (input, context) => {
    calls.set(id, (calls.get(id) ?? 0) + 1);
    contexts.push({ operationId: context.operationId, executionId: context.executionId, principalId: context.principalId, actorPrincipalId: context.actorPrincipalId,
      contextId: context.contextId, audience: context.audience, keys: Object.keys(context.data).sort() });
    await before(id, input, context);
    return handler(input, context);
  }]));
  return { registry: createOperationRegistry({ catalog: compiled.catalog, validators, handlers }), compiled, calls, contexts };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
