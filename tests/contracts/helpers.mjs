import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Each test receives fresh JSON data; fixtures are declarations, not runtime modules. */
export function fixture(name = 'valid-module') {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

export function accepted(result) {
  assert.ok(Array.isArray(result.errors), 'The validator must return an error collection');
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors, null, 2));
}

export function refused(result, expected) {
  assert.ok(Array.isArray(result.errors), 'The validator must return an error collection');
  assert.ok(result.errors.length > 0, 'The invalid declaration was accepted');
  assert.ok(result.errors.some(error => typeof expected === 'string'
    ? error.code === expected : expected.test(error.code)),
  `Expected ${expected}; received ${JSON.stringify(result.errors, null, 2)}`);
}

/** Contract v1 canonical JSON: sorted object keys, ordered arrays, JSON primitives. */
export function integrity(value) {
  function canonical(item) {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item && typeof item === 'object') return `{${Object.keys(item).sort()
      .map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
    return JSON.stringify(item);
  }
  return `sha256-${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

/** Reuses the descriptor shape while giving each publisher independent routes and identities. */
export function namedModule(id, publisher) {
  const module = fixture();
  const previousId = module.identity.id;
  function replace(value) {
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value === previousId ? id : value;
  }
  const result = replace(module);
  result.identity.publisher = publisher;
  result.identity.origin = `https://example.invalid/${publisher}/${id}`;
  result.dependencies = [];
  for (const endpoint of result.contracts.api) endpoint.path = `/${id}${endpoint.path}`;
  for (const view of result.contracts.ui.views) view.route = `/${id}${view.route}`;
  for (const tool of result.contracts.mcp.tools) tool.name = `${id}_${tool.name}`;
  for (const resource of result.contracts.mcp.resources) resource.uri = resource.uri.replace('ui://tasks/', `ui://${id}/`);
  return result;
}

export function dependsOn(consumer, provider, { optional = false, usesOperation = true } = {}) {
  const dependency = structuredClone(fixture().dependencies[0]);
  Object.assign(dependency, { moduleId: provider.identity.id, origin: provider.identity.origin,
    versionRange: '^1.0.0', optional, whenAbsent: optional ? 'disable-contributions' : 'block',
    contracts: [{ id: provider.contracts.publicContracts[0].id, versionRange: '^1.0.0' }] });
  consumer.dependencies.push(dependency);
  if (usesOperation) consumer.contracts.operations.find(operation => operation.id === 'get').effects.calls.push({
    moduleId: provider.identity.id, kind: 'operation', id: 'get',
  });
  return dependency;
}

/** Builds declaration-only locks. No archive exists and no artifact execution is implied. */
export function compositionCase(modules) {
  const composition = fixture('valid-composition');
  composition.modules = modules.map((module, index) => ({ moduleId: module.identity.id, origin: module.identity.origin,
    versionRange: '^1.0.0', source: index === 0
      ? { kind: 'workspace', path: `application/extensions/${module.identity.id}` }
      : { kind: 'package', name: `@${module.identity.publisher}/${module.identity.id}` },
    enabled: true, configuration: [],
    integrations: module.dependencies.filter(dependency => dependency.optional)
      .map(dependency => ({ moduleId: dependency.moduleId, enabled: false })) }));
  for (const audience of ['admin', 'app']) composition.exposure[audience].moduleIds = modules.map(module => module.identity.id);
  return { composition, modules, lock: lockFor(composition, modules) };
}

export function lockFor(composition, modules) {
  const lock = fixture('valid-composition-lock');
  lock.applicationId = composition.application.id;
  lock.sdkVersion = composition.sdk.version;
  lock.coreVersion = composition.sdk.coreVersion;
  lock.policy = structuredClone(composition.sdk.policy);
  lock.compositionIntegrity = integrity(composition);
  const template = structuredClone(lock.modules[0]);
  lock.modules = composition.modules.map(selection => {
    const module = modules.find(item => item.identity.id === selection.moduleId);
    assert.ok(module, 'A selected module must have a descriptor to build the positive lock');
    return { ...structuredClone(template), moduleId: module.identity.id, origin: module.identity.origin,
      version: module.identity.version, source: structuredClone(module.identity.source), contractIntegrity: integrity(module),
      runtime: { integrity: template.runtime.integrity,
        location: { kind: 'local', path: `artifacts/${module.identity.id}-runtime.tgz` } },
      validation: { integrity: template.validation.integrity,
        location: { kind: 'local', path: `artifacts/${module.identity.id}-validation.tgz` } },
      dependencies: module.dependencies.filter(dependency => composition.modules.some(item => item.moduleId === dependency.moduleId))
        .map(dependency => ({ moduleId: dependency.moduleId,
          version: modules.find(item => item.identity.id === dependency.moduleId).identity.version })) };
  });
  return lock;
}
