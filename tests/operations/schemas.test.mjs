import '../../scripts/local-environment.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { compileOperationSchemas, OPERATION_SCHEMA_LIMITS } from '../../scripts/operations/schemas.mjs';
import {loadRuntimeComposition} from '../../scripts/build/compose-runtime.mjs';
import { contractIntegrity } from '../../sdk/contracts/validate.mjs';

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
function fixture() {
  return { composition: read('../../configuration/composition.witness.json'), lock: read('../../configuration/composition.witness.lock.json'),
    modules: [read('../runtime/fixtures/module-witness/module/manifest.json')] };
}
function locked(input) {
  input.lock.compositionIntegrity = contractIntegrity(input.composition);
  for (const descriptor of input.modules) input.lock.modules.find(item => item.moduleId === descriptor.identity.id).contractIntegrity = contractIntegrity(descriptor);
  return input;
}
const loadValidators = compiled => import(`data:text/javascript;base64,${Buffer.from(compiled.validatorsCode).toString('base64')}`);
function addSchema(input, id, schema) { input.modules[0].contracts.schemas.push({ id, schema }); return locked(input); }
const validatorName = (compiled, id, moduleId = 'example.witness') => compiled.catalog.modules.find(item => item.moduleId === moduleId).schemas.find(item => item.schemaId === id).validator;

test('connectors profile compiles below the unchanged generated validator limit', () => {
  const loaded=loadRuntimeComposition({compositionPath:'configuration/composition.connectors.json'});
  const compiled=compileOperationSchemas({composition:loaded.composition,lock:loaded.lock,
    modules:loaded.located.map(item=>item.descriptor)});
  assert.equal(OPERATION_SCHEMA_LIMITS.generatedBytes,8*1024*1024);
  assert.equal(compiled.metrics.moduleCount,18);
  assert.equal(compiled.metrics.schemaCount,loaded.located.reduce((count,item)=>
    count+item.descriptor.contracts.schemas.length,0));
  assert.equal(compiled.metrics.operationCount,loaded.located.reduce((count,item)=>
    count+item.descriptor.contracts.operations.length,0));
  assert.ok(compiled.metrics.generatedBytes>7*1024*1024);
  assert.ok(compiled.metrics.generatedBytes<OPERATION_SCHEMA_LIMITS.generatedBytes);
});

test('compiler validates the locked composition and preserves immutable operation policy without loading handlers', async () => {
  const input = fixture(), compiled = compileOperationSchemas(input);
  const entry = compiled.catalog.modules[0].operations.find(item => item.operation.id === 'status');
  assert.deepEqual(entry.operation, input.modules[0].contracts.operations.find(item => item.id === 'status'));
  assert.equal(entry.active, true); assert.ok(Object.isFrozen(entry.operation.effects.reads));
  const validators = await loadValidators(compiled);
  assert.equal(validators[entry.inputValidator]({}), true);
  assert.equal(validators[entry.inputValidator]({ extra: true }), false);
  assert.equal(validators[entry.outputValidator]({ module: 'example.witness', version: '1.0.0', status: 'ready' }), true);
  assert.equal(validators[entry.outputValidator]({ status: 'ready' }), false);
  assert.ok(Object.keys(validators).every(name => name.startsWith('validate_')));
  input.modules[0].contracts.operations[0].title = 'mutated after compilation';
  assert.notEqual(entry.operation.title, 'mutated after compilation');
  assert.throws(() => compileOperationSchemas(input), { code: 'operation.schemas-contract' });
});

test('validation does not coerce values, install defaults or strip additional properties', async () => {
  const compiled = compileOperationSchemas(addSchema(fixture(), 'strict-values', {
    type: 'object', properties: { count: { type: 'integer' }, optional: { type: 'string', default: 'declared only' } },
    required: ['count'], additionalProperties: false,
  }));
  const validate = (await loadValidators(compiled))[validatorName(compiled, 'strict-values')];
  const valid = Object.freeze({ count: 2 }); assert.equal(validate(valid), true); assert.deepEqual(valid, { count: 2 });
  const coercible = { count: '2' }; assert.equal(validate(coercible), false); assert.deepEqual(coercible, { count: '2' });
  const extra = { count: 2, extra: 'preserved' }; assert.equal(validate(extra), false); assert.equal(extra.extra, 'preserved');
});

test('operation contract fingerprints change with policy, module version or schema, not declaration order', () => {
  const input = fixture(), base = compileOperationSchemas(input);
  const first = base.catalog.modules[0].operations.find(item => item.operation.id === 'status').contractDigest;
  input.modules[0].contracts.schemas.reverse();
  assert.equal(compileOperationSchemas(locked(input)).catalog.modules[0].operations.find(item => item.operation.id === 'status').contractDigest, first);
  input.modules[0].contracts.schemas.find(item => item.id === 'status-output').schema.description = 'An inspected contract revision';
  const revised = compileOperationSchemas(locked(input)).catalog.modules[0].operations.find(item => item.operation.id === 'status').contractDigest;
  assert.notEqual(revised, first);
  input.modules[0].contracts.operations.find(item => item.id === 'status').execution.maxItems = 2;
  const policyChanged = compileOperationSchemas(locked(input)).catalog.modules[0].operations.find(item => item.operation.id === 'status').contractDigest;
  assert.notEqual(policyChanged, revised);
  input.modules[0].identity.version = '1.0.1'; input.lock.modules[0].version = '1.0.1';
  input.modules[0].documentation.versionBinding.moduleVersion = '1.0.1';
  input.modules[0].packaging.validationBinding.moduleVersion = '1.0.1';
  assert.notEqual(compileOperationSchemas(locked(input)).catalog.modules[0].operations.find(item => item.operation.id === 'status').contractDigest, policyChanged);
});

test('local pointers, escaped property names, Unicode, structural equality and formats use actual AJV validators', async () => {
  const input = fixture();
  addSchema(input, 'rich-values', {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:publisher:shared-schema',
    type: 'object', $defs: { 'a/b': { type: 'string', minLength: 1, maxLength: 2 } },
    properties: { label: { $ref: '#/$defs/a~1b' }, day: { type: 'string', format: 'date' },
      stamp: { type: 'string', format: 'date-time' }, ids: { type: 'array', items: { type: 'object', additionalProperties: { type: 'integer' } }, uniqueItems: true },
      '$ref': { type: 'string', const: 'literal property, not a schema reference' } },
    required: ['label', 'day', 'stamp', 'ids', '$ref'], additionalProperties: false,
  });
  const compiled = compileOperationSchemas(input), validate = (await loadValidators(compiled))[validatorName(compiled, 'rich-values')];
  const value = { label: '😀', day: '2024-02-29', stamp: '2024-02-29T12:00:00Z', ids: [{ a: 1 }, { a: 2 }], '$ref': 'literal property, not a schema reference' };
  assert.equal(validate(value), true);
  assert.equal(validate({ ...value, day: '2023-02-29' }), false);
  assert.equal(validate({ ...value, label: 'abc' }), false);
  assert.equal(validate({ ...value, ids: [{ a: 1, b: 2 }, { b: 2, a: 1 }] }), false);
  assert.equal(validate({ ...value, stamp: 'not-a-date' }), false);
});

test('diagnostics contain only bounded paths and keywords, never values, schema bodies or params', async () => {
  const input = fixture(), forbiddenValue = 'synthetic-sensitive-value-that-must-not-be-echoed';
  addSchema(input, 'many-alternatives', { anyOf: Array.from({ length: 20 }, (_, index) => ({ const: `allowed-${index}` })) });
  const compiled = compileOperationSchemas(input), validate = (await loadValidators(compiled))[validatorName(compiled, 'many-alternatives')];
  assert.equal(validate(forbiddenValue), false); assert.ok(validate.errors.length <= 8);
  assert.ok(Object.isFrozen(validate.errors)); assert.ok(Object.isFrozen(validate.errors[0]));
  assert.deepEqual(Object.keys(validate.errors[0]), ['keyword', 'instancePath', 'schemaPath']);
  assert.equal(JSON.stringify(validate.errors).includes(forbiddenValue), false);
  assert.equal(validate('allowed-2'), true); assert.equal(validate.errors, null);
});

test('even unused and disabled schemas are compiled; external, recursive, async and unsupported dialects fail explicitly', () => {
  const cases = [
    { $ref: 'https://example.invalid/never-fetch.json' },
    { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' },
    { $ref: '#' },
    { $dynamicRef: '#x' },
    { type: 'string', format: 'unknown-format' },
    { $async: true, type: 'string' },
  ];
  for (const schema of cases) {
    const input = fixture(); input.composition.modules[0].enabled = false;
    input.composition.exposure.admin.moduleIds = []; input.composition.exposure.app.moduleIds = [];
    addSchema(input, 'unused', schema);
    assert.throws(() => compileOperationSchemas(input), error => ['operation.schemas-contract', 'operation.schemas-async'].includes(error.code));
  }
});

test('operation guards and disabled module declarations stay visible without activation', () => {
  const input = fixture(), module = input.modules[0];
  module.dependencies.push({ moduleId: 'example.optional', origin: 'https://example.invalid/optional', versionRange: '^1.0.0', optional: true,
    contracts: [], whenAbsent: 'disable-contributions', whenIncompatible: 'block', autoInstall: false });
  input.composition.modules[0].integrations.push({ moduleId: 'example.optional', enabled: false });
  module.contracts.operations.push({ ...structuredClone(module.contracts.operations[0]), id: 'optional-read', requiresModules: ['example.optional'] });
  let compiled = compileOperationSchemas(locked(input));
  assert.equal(compiled.catalog.modules[0].operations.find(item => item.operation.id === 'optional-read').active, false);
  assert.equal(compiled.catalog.modules[0].operations.find(item => item.operation.id === 'status').active, true);
  input.composition.modules[0].enabled = false; input.composition.exposure.admin.moduleIds = []; input.composition.exposure.app.moduleIds = [];
  compiled = compileOperationSchemas(locked(input));
  assert.equal(compiled.catalog.modules[0].enabled, false); assert.ok(compiled.catalog.modules[0].operations.every(item => !item.active));
  assert.equal(compiled.metrics.schemaCount, 2);
});

test('publisher URNs are namespaced by module; declaration order does not change validator bytes', async () => {
  const input = fixture(); addSchema(input, 'shared-urn', { $id: 'urn:publisher:shared', type: 'integer' });
  const other = JSON.parse(JSON.stringify(input.modules[0]).replaceAll('example.witness', 'example.other'));
  other.contracts.schemas.find(item => item.id === 'shared-urn').schema.type = 'string';
  other.contracts.ui.views[0].route = '/other-witness';
  input.modules.push(other);
  input.composition.modules.push({ ...structuredClone(input.composition.modules[0]), moduleId: other.identity.id });
  input.composition.exposure.app.moduleIds.push(other.identity.id);
  input.lock.modules.push({ ...structuredClone(input.lock.modules[0]), moduleId: other.identity.id });
  const first = compileOperationSchemas(locked(input));
  input.modules.reverse(); input.modules.forEach(module => module.contracts.schemas.reverse());
  const second = compileOperationSchemas(locked(input));
  assert.equal(first.validatorsCode, second.validatorsCode); assert.equal(first.schemasDigest, second.schemasDigest);
  const validators = await loadValidators(first);
  assert.equal(validators[validatorName(first, 'shared-urn')](123), true);
  assert.equal(validators[validatorName(first, 'shared-urn', 'example.other')](123), false);
});

test('empty locked composition emits an empty static validator module and forged getter inputs are not read', async () => {
  const input = fixture(); input.composition.modules = []; input.lock.modules = []; input.modules = [];
  input.composition.exposure.admin.moduleIds = []; input.composition.exposure.app.moduleIds = [];
  const compiled = compileOperationSchemas(locked(input)); assert.deepEqual(Object.keys(await loadValidators(compiled)), []);
  assert.deepEqual(compiled.catalog.modules, []);
  let called = false;
  assert.throws(() => compileOperationSchemas({ get composition() { called = true; return input.composition; }, lock: input.lock, modules: [] }), { code: 'operation.schemas-input' });
  assert.equal(called, false);
});

test('generated validators execute in real workerd without Node or dynamic code evaluation', async () => {
  const input = fixture();
  addSchema(input, 'worker-io', { type: 'object', properties: { word: { type: 'string', minLength: 2 }, date: { type: 'string', format: 'date' } },
    required: ['word', 'date'], additionalProperties: false });
  const compiled = compileOperationSchemas(input), name = validatorName(compiled, 'worker-io');
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true, compatibilityDate: '2026-05-15',
    script: `${compiled.validatorsCode}\nexport default { async fetch(request) { const data = await request.json();
      const ok = ${name}(data); return Response.json({ok, errors:${name}.errors, original:data}); }};` });
  try {
    const good = { word: 'é😀', date: '2024-02-29' };
    const valid = await (await mf.dispatchFetch('http://localhost/', { method: 'POST', body: JSON.stringify(good) })).json();
    assert.equal(valid.ok, true); assert.deepEqual(valid.original, good); assert.equal(valid.errors, null);
    const invalid = await (await mf.dispatchFetch('http://localhost/', { method: 'POST', body: JSON.stringify({ ...good, date: '2023-02-29' }) })).json();
    assert.equal(invalid.ok, false); assert.equal(invalid.errors[0].keyword, 'format');
  } finally { await mf.dispose(); }
});
