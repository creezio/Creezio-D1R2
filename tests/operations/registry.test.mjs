import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileOperationSchemas } from '../../scripts/operations/schemas.mjs';
import { createOperationRegistry } from '../../core/operations/registry.ts';
import { operationComposition, moduleId } from './fixtures/operations.mjs';

const compiled = compileOperationSchemas(operationComposition());
const validators = { ...await import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`) };
const handler = () => { throw new Error('A registry must never execute its handlers.'); };
function fixture() {
  const catalog = structuredClone(compiled.catalog);
  const handlers = Object.fromEntries(catalog.modules.flatMap(module => module.operations.filter(entry => entry.active)
    .map(entry => [`${module.moduleId}:${entry.operation.id}`, handler])));
  return { catalog, validators: { ...validators }, handlers };
}
const invalid = input => assert.throws(() => createOperationRegistry(input), { code: 'invalid_catalog' });

test('the registry captures policies and functions without executing package code', () => {
  const input = fixture(), registry = createOperationRegistry(input);
  input.catalog.modules[0].operations.find(entry => entry.operation.id === 'create_record').operation.permissions = [];
  input.handlers[`${moduleId}:create_record`] = () => ({ output: null });
  const operation = registry.resolve(moduleId, 'create_record');
  assert.equal(operation.handler, handler);
  assert.ok(operation.declaration.permissions.length > 0);
  assert.ok(Object.isFrozen(operation.declaration.permissions));
  assert.throws(() => { operation.declaration.permissions.length = 0; }, TypeError);
  assert.equal(operation.validateInput({ id: 'item', title: 'Title', request_id: 'request' }), true);
  assert.equal(operation.validateInput({ id: 'item', title: 42, request_id: 'request' }), false);
  for (const [owner, id] of [['missing.module', 'create_record'], [moduleId, 'missing'], [moduleId, 'create_record\n']])
    assert.throws(() => registry.resolve(owner, id), { code: 'not_found' });
});

test('missing handlers, unexpected handlers and schema-validator substitutions fail closed', () => {
  let input = fixture(); delete input.handlers[`${moduleId}:create_record`]; invalid(input);
  input = fixture(); input.handlers[`${moduleId}:surprise`] = handler; invalid(input);
  input = fixture(); delete input.validators[input.catalog.modules[0].schemas[0].validator]; invalid(input);
  input = fixture(); input.catalog.modules[0].operations[0].inputValidator = 'different'; invalid(input);
  input = fixture(); input.catalog.modules[0].operations[0].contractDigest = 'missing'; invalid(input);
});

test('inactive contributions cannot be resolved or supply a hidden handler', () => {
  const input = fixture();
  for (const entry of input.catalog.modules[0].operations) entry.active = false;
  invalid(input);
  input.handlers = {};
  const registry = createOperationRegistry(input);
  assert.throws(() => registry.resolve(moduleId, 'create_record'), { code: 'not_found' });
  input.catalog.modules[0].enabled = false;
  input.catalog.modules[0].operations[0].active = true;
  invalid(input);
});

test('accessors in catalogue and function collections are refused without invocation', () => {
  let called = 0;
  for (const field of ['catalog', 'handlers', 'validators']) {
    const input = fixture();
    Object.defineProperty(input[field], 'trap', { enumerable: true, get() { called++; return handler; } });
    invalid(input);
  }
  assert.equal(called, 0);
});

test('non-HTTP operations obey the host budget and mutation invariants too', () => {
  let input = fixture(); input.catalog.modules[0].operations[0].operation.execution.maxDurationMs = 30_001; invalid(input);
  input = fixture(); input.catalog.modules[0].operations[0].operation.execution.maxDurationMs = 0; invalid(input);
  input = fixture();
  const create = input.catalog.modules[0].operations.find(entry => entry.operation.id === 'create_record').operation;
  create.idempotency = { mode: 'none' }; invalid(input);
  input = fixture();
  input.catalog.modules[0].operations.find(entry => entry.operation.id === 'create_record').operation.kind = 'query'; invalid(input);
  input = fixture(); input.catalog.modules.push(structuredClone(input.catalog.modules[0])); invalid(input);
});
