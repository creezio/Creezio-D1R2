import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateComposition, validateCompositionTransition } from '../../sdk/contracts/validate.mjs';
import { inspectJson } from '../../sdk/contracts/load.mjs';
import { accepted, refused, namedModule, dependsOn, compositionCase, lockFor } from './helpers.mjs';

/** Three independent publishers, one app: cart -> catalogue -> stock provider. */
function commerce() {
  const cart = namedModule('merchant.cart', 'merchant');
  const catalogue = namedModule('creezio.catalogue', 'creezio');
  const stock = namedModule('vendor.stock', 'vendor');
  dependsOn(cart, catalogue);
  dependsOn(catalogue, stock);
  return compositionCase([cart, catalogue, stock]);
}
const validate = value => validateComposition(value.composition, { modules: value.modules, lock: value.lock });
const refresh = value => { value.lock = lockFor(value.composition, value.modules); return value; };

test('valid selected descriptors can exceed the single-document node budget together', () => {
  const value=compositionCase(Array.from({length:12},(_,index)=>
    namedModule(`vendor.descriptor-${index+1}`,'vendor')));
  const measured=inspectJson(value.modules,{maxNodes:100000});
  accepted(measured);
  assert.ok(measured.metrics.nodes>20000&&measured.metrics.nodes<100000);
  accepted(validate(value));
});

test('descriptor inspection still refuses an excessive aggregate and never reads accessors', () => {
  const excess=compositionCase(Array.from({length:58},(_,index)=>
    namedModule(`vendor.descriptor-${index+1}`,'vendor')));
  const measured=inspectJson(excess.modules,{maxNodes:100000});
  refused(measured,'json.nodes');
  assert.ok(measured.metrics.bytes<2*1024*1024,'The node limit must be reached before the byte limit');
  refused(validate(excess),'composition.modules');

  const unsafe=compositionCase([namedModule('vendor.unsafe','vendor')]);
  let calls=0;
  Object.defineProperty(unsafe.modules[0],'contracts',{enumerable:true,configurable:true,
    get(){calls++;throw new Error('Descriptor accessor must not execute');}});
  refused(validate(unsafe),'composition.modules');
  assert.equal(calls,0);
});
function remove(value, id) {
  value.composition.modules = value.composition.modules.filter(item => item.moduleId !== id);
  value.modules = value.modules.filter(item => item.identity.id !== id);
  for (const audience of ['admin', 'app']) value.composition.exposure[audience].moduleIds = value.composition.exposure[audience].moduleIds.filter(item => item !== id);
}
function version(module, next) {
  module.identity.version = next;
  module.documentation.versionBinding.moduleVersion = next;
  module.packaging.validationBinding.moduleVersion = next;
}

test('composes a cart, catalogue and transitive provider from different publishers without rewriting them', () => {
  const value = commerce();
  const before = structuredClone(value);
  accepted(validate(value));
  assert.deepEqual(value, before);
  assert.equal(new Set(value.modules.map(module => module.identity.publisher)).size, 3);
  assert.equal(new Set(value.modules.map(module => module.identity.origin)).size, 3);
});

test('workspace-only and headless fronts consume the same module/backend contracts', () => {
  const value = commerce();
  accepted(validate(value));
  const backend = structuredClone(value.modules);
  value.composition.front = { kind: 'headless' };
  accepted(validate(refresh(value)));
  assert.deepEqual(value.modules, backend);
});

test('front theme resolves one enabled export and supports every active front slot',()=>{
  const module=namedModule('vendor.theme','vendor');
  module.contracts.ui.themes=[{id:'standard',component:structuredClone(module.contracts.ui.views[0].component),
    slots:['front.header']}];
  module.contracts.ui.slots.push({id:'header',slot:'front.header',
    view:{moduleId:module.identity.id,kind:'view',id:module.contracts.ui.views[0].id},
    permissions:[],surfaces:['front']});
  const value=compositionCase([module]);
  value.composition.front={kind:'theme',moduleId:module.identity.id,theme:'standard'};
  accepted(validate(refresh(value)));
  value.composition.front.theme='missing';
  refused(validate(refresh(value)),'composition.front');
  value.composition.front.theme='standard';
  module.contracts.ui.themes[0].slots=['front.footer'];
  refused(validate(refresh(value)),'composition.front-slot');
  module.contracts.ui.themes[0].slots=['front.header'];
  value.composition.modules[0].enabled=false;
  value.composition.exposure.app.moduleIds=[];value.composition.exposure.admin.moduleIds=[];
  refused(validate(refresh(value)),'composition.front');
});

const cases = [
  ['missing required catalogue', value => remove(value, 'creezio.catalogue'), /^dependency\.missing$/],
  ['disabled required catalogue', value => {
    value.composition.modules.find(item => item.moduleId === 'creezio.catalogue').enabled = false;
    for (const audience of ['admin', 'app']) value.composition.exposure[audience].moduleIds = value.composition.exposure[audience].moduleIds.filter(id => id !== 'creezio.catalogue');
  }, /^dependency\.(?:missing|disabled)$/],
  ['missing transitive stock provider', value => remove(value, 'vendor.stock'), 'dependency.missing'],
  ['catalogue update outside the cart version range', value => {
    version(value.modules[1], '2.0.0');
    value.composition.modules[1].versionRange = '*';
  }, 'dependency.version'],
  ['transitive dependency cycle', value => { dependsOn(value.modules[2], value.modules[0]); }, 'dependency.cycle'],
  ['a cross-module read secretly calling a command', value => {
    value.modules[0].contracts.operations.find(operation => operation.id === 'get').effects.calls[0].id = 'update';
  }, 'operation.effect'],
  ['provider no longer exporting the public contract consumed by its client', value => {
    value.modules[1].contracts.publicContracts = [];
  }, /^dependency\.contract|^ref\.private/],
  ['incompatible public contract despite compatible package version', value => {
    value.modules[1].contracts.publicContracts[0].version = '2.0.0';
  }, /^dependency\./],
  ['external access to a private provider operation', value => {
    const provider = value.modules[1];
    provider.contracts.operations.find(operation => operation.id === 'get').public = false;
    provider.contracts.publicContracts[0].operations = provider.contracts.publicContracts[0].operations.filter(operation => operation.id !== 'get');
  }, 'ref.private'],
  ['a duplicated module selection', value => { value.composition.modules.push(structuredClone(value.composition.modules[0])); }, /^duplicate\.|^composition\.duplicate/],
  ['two API routes differing only by the parameter name', value => {
    const a = value.modules[0].contracts.api.find(item => item.id === 'get-api');
    const b = value.modules[1].contracts.api.find(item => item.id === 'get-api');
    a.path = '/catalogue/{id}';
    b.path = '/catalogue/{record}';
    b.parameters[0].name = 'record';
  }, 'composition.collision'],
  ['two MCP tools with the same name in the same audience', value => {
    value.modules[1].contracts.mcp.tools[0].name = value.modules[0].contracts.mcp.tools[0].name;
  }, 'composition.collision'],
  ['host missing required R2 capability', value => {
    value.composition.host.capabilities = value.composition.host.capabilities.filter(capability => capability !== 'files.r2.shared');
  }, 'host.capability'],
  ['SDK outside every selected module compatibility range', value => { value.composition.sdk.version = '2.0.0'; }, 'dependency.compatibility'],
];
for (const [name, change, expected] of cases) test(`refuses ${name}`, () => {
  const value = commerce();
  accepted(validate(value));
  change(value);
  refused(validate(refresh(value)), expected);
});

test('an optional integration is explicit: absent or switched off is allowed, selected incompatibility is refused', () => {
  const cart = namedModule('merchant.cart', 'merchant');
  const catalogue = namedModule('creezio.catalogue', 'creezio');
  dependsOn(cart, catalogue, { optional: true, usesOperation: false });
  const absent = compositionCase([cart]);
  accepted(validate(absent));
  const installed = compositionCase([cart, catalogue]);
  accepted(validate(installed));
  installed.composition.modules[0].integrations[0].enabled = true;
  accepted(validate(refresh(installed)));
  version(catalogue, '2.0.0');
  installed.composition.modules[1].versionRange = '*';
  refused(validate(refresh(installed)), 'dependency.version');
  installed.composition.modules[0].integrations[0].enabled = false;
  accepted(validate(refresh(installed)));
});

test('only explicitly guarded optional contributions may reference an absent integration', () => {
  const cart = namedModule('merchant.cart', 'merchant');
  const catalogue = namedModule('creezio.catalogue', 'creezio');
  dependsOn(cart, catalogue, { optional: true, usesOperation: false });
  const lookup = structuredClone(cart.contracts.operations.find(operation => operation.id === 'get'));
  lookup.id = 'catalogue-preview';
  lookup.requiresModules = [catalogue.identity.id];
  lookup.effects.calls = [{ moduleId: catalogue.identity.id, kind: 'operation', id: 'get' }];
  cart.contracts.operations.push(lookup);
  const value = compositionCase([cart]);
  accepted(validate(value));
  delete lookup.requiresModules;
  refused(validate(refresh(value)), 'ref.missing');
  lookup.requiresModules = [catalogue.identity.id];
  const endpoint = structuredClone(cart.contracts.api.find(item => item.id === 'get-api'));
  endpoint.id = 'catalogue-preview-api';
  endpoint.path = '/catalogue-preview/{id}';
  endpoint.operation.id = lookup.id;
  cart.contracts.api.push(endpoint);
  refused(validate(refresh(value)), 'ref.missing');
  endpoint.requiresModules = [catalogue.identity.id];
  accepted(validate(refresh(value)));
  value.composition.modules[0].integrations[0].enabled = true;
  accepted(validate(refresh(value)));
  const present = compositionCase([cart, catalogue]);
  const off = validate(present);
  accepted(off);
  const lookupPath = `/contracts/operations/${cart.contracts.operations.indexOf(lookup)}`;
  assert.ok(off.metrics.disabledContributions.some(item => item.moduleId === cart.identity.id && item.path === lookupPath),
    'The provider being present must not activate an unselected optional integration');
  present.composition.modules[0].integrations[0].enabled = true;
  const on = validate(refresh(present));
  accepted(on);
  assert.ok(!on.metrics.disabledContributions.some(item => item.moduleId === cart.identity.id && item.path === lookupPath),
    'An explicitly selected compatible integration should expose its guarded contribution');
  present.composition.modules[0].integrations[0].enabled = false;
  delete endpoint.requiresModules;
  refused(validate(refresh(present)), 'ref.missing');
});

test('a selected module has exactly one source, not an implicit workspace/package fallback', () => {
  const value = commerce();
  value.composition.modules[0].source.name = '@merchant/cart';
  refused(validate(refresh(value)), 'schema.invalid');
});

test('optional integration choices are complete and cannot opt out of a required dependency', () => {
  const cart = namedModule('merchant.cart', 'merchant');
  const catalogue = namedModule('creezio.catalogue', 'creezio');
  dependsOn(cart, catalogue, { optional: true, usesOperation: false });
  const incomplete = compositionCase([cart]);
  incomplete.composition.modules[0].integrations = [];
  refused(validate(refresh(incomplete)), 'dependency.integration');
  const required = commerce();
  required.composition.modules[0].integrations = [{ moduleId: 'creezio.catalogue', enabled: false }];
  refused(validate(refresh(required)), 'dependency.integration');
});

test('mutual optional declarations become a dependency cycle only when both integrations are selected', () => {
  const cart = namedModule('merchant.cart', 'merchant');
  const catalogue = namedModule('creezio.catalogue', 'creezio');
  dependsOn(cart, catalogue, { optional: true, usesOperation: false });
  dependsOn(catalogue, cart, { optional: true, usesOperation: false });
  const value = compositionCase([cart, catalogue]);
  accepted(validate(value));
  value.composition.modules[0].integrations[0].enabled = true;
  accepted(validate(refresh(value)));
  value.composition.modules[1].integrations[0].enabled = true;
  refused(validate(refresh(value)), 'dependency.cycle');
});

test('an optional direct action can be inactive while its widget retains autonomous message and context actions', () => {
  const cart = namedModule('merchant.cart', 'merchant');
  const catalogue = namedModule('creezio.catalogue', 'creezio');
  dependsOn(cart, catalogue, { optional: true, usesOperation: false });
  const widget = cart.contracts.widgets.find(item => item.actions.some(action => action.mode === 'message'));
  const lookup = widget.actions.find(action => action.mode === 'direct' && action.target.kind === 'operation');
  lookup.target.operation.moduleId = catalogue.identity.id;
  lookup.requiresModules = [catalogue.identity.id];
  const widgetPath = `/contracts/widgets/${cart.contracts.widgets.indexOf(widget)}`;
  const actionPath = `${widgetPath}/actions/${widget.actions.indexOf(lookup)}`;
  for (const modules of [[cart], [cart, catalogue]]) {
    const value = compositionCase(modules);
    const result = validate(value);
    accepted(result);
    assert.ok(result.metrics.disabledContributions.some(item => item.moduleId === cart.identity.id && item.path === actionPath));
    assert.ok(!result.metrics.disabledContributions.some(item => item.moduleId === cart.identity.id && item.path === widgetPath));
    assert.ok(widget.actions.some(action => action.mode === 'message'));
    assert.ok(widget.actions.some(action => action.mode === 'context'));
  }
  const selected = compositionCase([cart, catalogue]);
  selected.composition.modules[0].integrations[0].enabled = true;
  const result = validate(refresh(selected));
  accepted(result);
  assert.ok(!result.metrics.disabledContributions.some(item => item.moduleId === cart.identity.id && item.path === actionPath));
  assert.equal(lookup.mode, 'direct');
});

test('an API targeting another publisher compares actual schema content, not identical local schema ids', () => {
  const value = commerce();
  const endpoint = value.modules[0].contracts.api.find(item => item.id === 'get-api');
  endpoint.operation.moduleId = value.modules[1].identity.id;
  accepted(validate(refresh(value)));
  const localInput = value.modules[0].contracts.schemas.find(item => item.id === endpoint.input.schemaId);
  localInput.schema.properties.id = { type: 'number' };
  refused(validate(refresh(value)), 'api.schema');
});

test('lock checks reject absent, stale and origin-substituted evidence', () => {
  const value = commerce();
  accepted(validate(value));
  refused(validateComposition(value.composition, { modules: value.modules }), 'lock.missing');
  for (const alter of [
    lock => { lock.compositionIntegrity = `sha256-${'f'.repeat(64)}`; },
    lock => { lock.modules[0].contractIntegrity = `sha256-${'e'.repeat(64)}`; },
    lock => { lock.modules[0].origin = 'https://example.invalid/another-publisher'; },
    lock => { lock.modules[0].source.revision = 'another-revision'; },
    lock => { lock.modules[0].dependencies = []; },
  ]) {
    const changed = structuredClone(value);
    alter(changed.lock);
    refused(validate(changed), /^lock\./);
  }
});

test('changing the consumer policy inside a lock does not replace the requested policy', () => {
  const value = commerce();
  value.lock.policy.integrity = `sha256-${'d'.repeat(64)}`;
  refused(validate(value), /^lock\./);
});

test('a compatible provider update can be checked without changing the cart declarations', () => {
  const before = commerce();
  const after = structuredClone(before);
  version(after.modules[1], '1.1.0');
  refresh(after);
  accepted(validateCompositionTransition(before.composition, after.composition, {
    before: { modules: before.modules, lock: before.lock }, after: { modules: after.modules, lock: after.lock },
  }));
  assert.deepEqual(before.modules[0], after.modules[0]);
});

test('removal, deactivation and major update cannot strand an installed cart dependency', () => {
  for (const change of [
    value => remove(value, 'creezio.catalogue'),
    value => {
      value.composition.modules[1].enabled = false;
      for (const audience of ['admin', 'app']) value.composition.exposure[audience].moduleIds = value.composition.exposure[audience].moduleIds.filter(id => id !== 'creezio.catalogue');
    },
    value => { version(value.modules[1], '2.0.0'); value.composition.modules[1].versionRange = '*'; },
  ]) {
    const before = commerce();
    const after = structuredClone(before);
    change(after); refresh(after);
    refused(validateCompositionTransition(before.composition, after.composition, {
      before: { modules: before.modules, lock: before.lock }, after: { modules: after.modules, lock: after.lock },
    }), /dependency\./);
  }
});

test('an otherwise self-consistent next composition cannot silently replace an installed origin', () => {
  const before = compositionCase([namedModule('merchant.cart', 'merchant')]);
  const after = structuredClone(before);
  after.modules[0].identity.origin = 'https://example.invalid/impostor/cart';
  after.composition.modules[0].origin = after.modules[0].identity.origin;
  refresh(after);
  accepted(validate(after));
  refused(validateCompositionTransition(before.composition, after.composition, {
    before: { modules: before.modules, lock: before.lock }, after: { modules: after.modules, lock: after.lock },
  }), /^transition\./);
});

test('an immutable package version cannot acquire different archive bytes while a local workspace remains editable', () => {
  for (const kind of ['package', 'workspace']) {
    const before = compositionCase([namedModule('vendor.stock', 'vendor')]);
    if (kind === 'package') before.composition.modules[0].source = { kind: 'package', name: '@vendor/stock' };
    refresh(before);
    const after = structuredClone(before);
    after.lock.modules[0].runtime.integrity = `sha256-${'a'.repeat(64)}`;
    accepted(validate(before));
    accepted(validate(after));
    const result = validateCompositionTransition(before.composition, after.composition, {
      before: { modules: before.modules, lock: before.lock }, after: { modules: after.modules, lock: after.lock },
    });
    if (kind === 'package') refused(result, /^transition\./);
    else accepted(result);
  }
});
