import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateModule } from '../../sdk/contracts/validate.mjs';
import { fixture, accepted, refused } from './helpers.mjs';

const query = module => module.contracts.operations.find(operation => operation.kind === 'query');
const command = module => module.contracts.operations.find(operation => operation.kind === 'command');
const action = (module, mode) => module.contracts.widgets.flatMap(widget => widget.actions).find(item => item.mode === mode);

test('accepts a complete inert module declaration with several widgets and three action modes', () => {
  const module = fixture();
  const before = structuredClone(module);
  assert.ok(module.contracts.widgets.length >= 2, 'Fixture must exercise multiple widget types');
  assert.ok(module.contracts.widgets.some(widget =>
    new Set(widget.actions.map(item => item.mode)).size === 3), 'Modes coexist within one widget');
  accepted(validateModule(module));
  assert.deepEqual(module, before, 'Validation must not rewrite the module declaration');
});

test('theme declarations use the ordinary runtime code reference and unique slot names',()=>{
  const module=fixture();
  const component=structuredClone(module.contracts.ui.views[0].component);
  module.contracts.ui.themes=[{id:'standard',component,slots:['front.header','front.footer']}];
  accepted(validateModule(module));
  module.contracts.ui.themes.push({...module.contracts.ui.themes[0]});
  refused(validateModule(module),'duplicate.id');
  module.contracts.ui.themes.pop();
  module.contracts.ui.themes[0].slots.push('front.header');
  refused(validateModule(module),'schema.invalid');
});

const cases = [
  ['duplicate operation identity', m => m.contracts.operations.push(structuredClone(query(m))), 'duplicate.id'],
  ['an API operation removed from the module', m => {
    const id = m.contracts.api[0].operation.id;
    m.contracts.operations = m.contracts.operations.filter(operation => operation.id !== id);
  }, 'ref.missing'],
  ['operation input referencing an absent schema', m => { query(m).input.schemaId = 'missing.input'; }, 'ref.missing'],
  ['primary key referencing an absent data field', m => { m.contracts.models[0].primaryKey = ['missing-field']; }, 'model.field'],
  ['a command without permissions', m => { command(m).permissions = []; }, 'operation.permissions'],
  ['a read operation declaring writes', m => {
    query(m).effects.writes = [{ moduleId: m.identity.id, kind: 'model', id: m.contracts.models[0].id }];
  }, /^operation\./],
  ['a mutation without idempotency', m => { command(m).idempotency = { mode: 'none' }; }, /^operation\./],
  ['an idempotency key absent from the input schema', m => { command(m).idempotency.keyField = 'unknown-key'; }, 'schema.field'],
  ['API input diverging from the operation input', m => { m.contracts.api[0].input = structuredClone(m.contracts.api[0].output); }, /^api\./],
  ['MCP input diverging from the operation input', m => { m.contracts.mcp.tools[0].input = structuredClone(m.contracts.mcp.tools[0].output); }, 'mcp.schema'],
  ['a direct widget action targeting a missing operation', m => {
    action(m, 'direct').target = { kind: 'operation', operation: { moduleId: m.identity.id, kind: 'operation', id: 'missing.action' } };
  }, 'ref.missing'],
  ['a direct widget action silently falling back to a chat message', m => { action(m, 'direct').fallback = 'copy-message'; }, 'widget.fallback'],
  ['context-only input acquiring a mutation target', m => {
    action(m, 'context').target.operation = { moduleId: m.identity.id, kind: 'operation', id: command(m).id };
  }, 'schema.invalid'],
  ['message mode removing voluntary sending', m => { action(m, 'message').target.voluntarySend = false; }, 'schema.invalid'],
  ['widget mode incorrectly moved to the whole widget', m => { m.contracts.widgets[0].mode = 'direct'; }, 'schema.invalid'],
  ['a missing installed PRD declaration', m => { delete m.documentation.installed.prd; }, 'schema.invalid'],
  ['a missing required validation suite', m => { delete m.validation.suites.widgets; }, 'schema.invalid'],
  ['a suite with no test sources', m => { m.validation.suites.backend.tests = []; }, 'schema.invalid'],
  ['a claimed dispense without a verifiable justification', m => { m.validation.suites.backend.mode = 'not-applicable'; }, 'schema.invalid'],
  ['a declared runtime entry absent from its runtime archive', m => {
    m.packaging.runtime.files = m.packaging.runtime.files.filter(path => path !== m.entrypoints.server.path);
  }, /^package\.|^path\.missing$/],
  ['an archive missing its referenced validation script', m => {
    m.packaging.validation.files = m.packaging.validation.files.filter(path => path !== m.validation.suites.backend.script);
  }, /^package\.|^path\.missing$/],
  ['a secret reference with a literal default credential', m => {
    const setting = m.contracts.settings[0];
    setting.visibility = 'secret-reference';
    setting.default = ['fictional', 'credential', 'never-publish'].join('-');
  }, /^setting\.|^secret\./],
  ['an embedded JSON Schema fetching a remote reference', m => {
    m.contracts.schemas[0].schema = { $ref: 'https://example.invalid/private-schema.json' };
  }, 'schema.ref-external'],
];

for (const [name, change, expected] of cases) test(`refuses ${name}`, () => {
  const module = fixture();
  accepted(validateModule(module));
  change(module);
  refused(validateModule(module), expected);
});

test('an admin-only operation cannot gain an app audience through API, MCP or a front view', () => {
  for (const surface of ['api', 'mcp', 'front']) {
    const module = fixture();
    accepted(validateModule(module));
    const operation = command(module);
    operation.audiences = ['admin'];
    if (surface === 'api') {
      const endpoint = module.contracts.api.find(item => item.operation.id === operation.id);
      assert.ok(endpoint); endpoint.audience = 'app';
    } else if (surface === 'mcp') {
      const tool = module.contracts.mcp.tools.find(item => item.operation.id === operation.id);
      assert.ok(tool); tool.audiences = ['app'];
    } else {
      const view = module.contracts.ui.views[0];
      view.surfaces = ['front'];
      view.operations = [{ moduleId: module.identity.id, kind: 'operation', id: operation.id }];
    }
    refused(validateModule(module), surface === 'front' ? /^ui\./ : new RegExp(`^${surface}\\.audience$`));
  }
});

test('package paths cannot escape, encode traversal, name a URL or target a Windows device', () => {
  for (const path of ['../outside.mjs', '/outside.mjs', 'C:\\outside.mjs', 'module/%2e%2e/outside.mjs',
    'https://example.invalid/source.mjs', 'module/CON.json', 'module/source.mjs:stream']) {
    const module = fixture();
    module.entrypoints.server.path = path;
    refused(validateModule(module), /^(?:path\.invalid|schema\.invalid)$/);
  }
});

test('malformed input produces diagnostics instead of exceptions or a successful empty module', () => {
  for (const value of [null, [], {}, true, 'module', 4]) refused(validateModule(value), 'schema.invalid');
});

test('embedded JSON Schemas close local references and reject unresolved, recursive or unknown constructs', () => {
  const module = fixture();
  const declaration = { id: 'supplemental', schema: { type: 'object', properties: { label: { $ref: '#/$defs/label' } },
    $defs: { label: { type: 'string' } }, additionalProperties: false } };
  module.contracts.schemas.push(declaration);
  accepted(validateModule(module));
  declaration.schema.properties.label.$ref = '#/$defs/missing';
  refused(validateModule(module), 'schema.ref-missing');
  declaration.schema.properties.label.$ref = '#/$defs/label';
  declaration.schema.$defs.label = { $ref: '#/$defs/label' };
  refused(validateModule(module), 'schema.ref-cycle');
  declaration.schema = { type: 'object', unrecognizedRuntimeHook: 'must-not-be-silently-ignored' };
  refused(validateModule(module), 'schema.invalid');
});

test('a literal JSON Schema property named $ref is data shape, not a remote schema reference', () => {
  const module = fixture();
  module.contracts.schemas.push({ id: 'literal-ref-property', schema: {
    type: 'object', properties: { $ref: { type: 'string' } }, required: ['$ref'], additionalProperties: false,
  } });
  accepted(validateModule(module));
});

test('a setting default containing reference-shaped business data is not interpreted as module wiring', () => {
  const module = fixture();
  const properties = Object.fromEntries(['moduleId', 'kind', 'id', 'path'].map(key => [key, { type: 'string' }]));
  module.contracts.schemas.push({ id: 'data-setting', schema: { type: 'object', properties,
    required: Object.keys(properties), additionalProperties: false } });
  module.contracts.settings[0].schema = { schemaId: 'data-setting' };
  module.contracts.settings[0].default = { moduleId: 'example.not-installed', kind: 'operation', id: 'plain-data', path: '../ordinary-value' };
  const before = structuredClone(module);
  accepted(validateModule(module));
  assert.deepEqual(module, before);
});

test('approval permission alone does not authorize reading protected records', () => {
  const module = fixture();
  module.contracts.permissions.find(permission => permission.id === 'read').actions = ['approve'];
  refused(validateModule(module), 'operation.permissions');
});

test('a public model port cannot be redirected to a permission with an existing identifier', () => {
  const module = fixture();
  module.contracts.publicContracts[0].models = [{ moduleId: module.identity.id, kind: 'permission', id: 'read' }];
  refused(validateModule(module), 'ref.kind');
});

test('a relation pairs the source context with the target context, not merely any two context-containing keys', () => {
  const module = fixture();
  const model = module.contracts.models[0];
  const relation = { id: 'related-task', fields: ['context_id', 'id'],
    target: { moduleId: module.identity.id, kind: 'model', id: model.id },
    targetFields: ['context_id', 'id'], onDelete: 'restrict' };
  model.relations.push(relation);
  accepted(validateModule(module));
  relation.targetFields = ['id', 'context_id'];
  refused(validateModule(module), 'model.relation-context');
});

test('file metadata belongs to the declaring module even when another model is available through a dependency', () => {
  const module = fixture();
  module.contracts.files[0].metadataModel.moduleId = module.dependencies[0].moduleId;
  refused(validateModule(module), 'ref.private');
});

test('idempotency and concurrency fields must be required, not merely declared as possible input properties', () => {
  for (const policy of ['idempotency', 'concurrency']) {
    const module = fixture();
    accepted(validateModule(module));
    const operation = command(module);
    const field = operation[policy][policy === 'idempotency' ? 'keyField' : 'versionField'];
    const input = module.contracts.schemas.find(item => item.id === operation.input.schemaId).schema;
    assert.ok(Object.hasOwn(input.properties, field));
    assert.ok(input.required.includes(field));
    input.required = input.required.filter(name => name !== field);
    refused(validateModule(module), 'schema.field-required');
  }
});
