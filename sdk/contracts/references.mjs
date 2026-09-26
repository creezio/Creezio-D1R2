export const pointer = (base, key) => `${base}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;

/** Visit already inspected JSON. Schemas can be excluded to avoid interpreting their example data as contracts. */
export function walk(value, visitor, location = '') {
  if(visitor(value, location)===false)return;
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, visitor, pointer(location, key));
}

/** Defaults and constraint literals are business data, even when they resemble references or paths. */
export function walkContracts(value, visitor, location='') {
  walk(value,(node,nodePath)=>/(?:\/default|\/constraints\/enum)$/.test(nodePath)?false:visitor(node,nodePath),location);
}

export function safePackagePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 &&
    !/[\\\u0000-\u001f\u007f:%?#]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

export function isContractRef(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.moduleId === 'string' && typeof value.kind === 'string' && typeof value.id === 'string';
}

export function contractIndex(module) {
  const c = module.contracts;
  return new Map(Object.entries({ model:c.models, file:c.files, permission:c.permissions, operation:c.operations,
    event:c.events, setting:c.settings, search:c.search, view:c.ui.views, widget:c.widgets,
    publicContract:c.publicContracts, schema:c.schemas }).map(([kind, entries]) => [kind, new Map(entries.map(entry => [entry.id, entry]))]));
}

export const refKey = ref => `${ref.moduleId}:${ref.kind}:${ref.id}`;

/** JSON Schema references are local JSON Pointers; recursive graphs require a future explicit bounded contract. */
export function checkSchemaReferences(schema, location, report) {
  const visited = new WeakSet(), active = new WeakSet();
  function resolve(ref) {
    if (ref === '#') return schema;
    if (!ref.startsWith('#/')) return undefined;
    let current = schema;
    for (const encoded of ref.slice(2).split('/')) {
      if (/~(?:[^01]|$)/.test(encoded)) return undefined;
      const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined;
      current = current[key];
    }
    return current;
  }
  function visit(node, nodePath, depth) {
    if (!node || typeof node !== 'object') return;
    if (depth > 64) { report('schema.ref-depth', nodePath, 'Schema reference depth exceeds its bound.'); return; }
    if (active.has(node)) { report('schema.ref-cycle', nodePath, 'Recursive schema references are not supported by this contract version.'); return; }
    if (visited.has(node)) return;
    active.add(node);
    if (Object.hasOwn(node, '$dynamicRef') || Object.hasOwn(node, '$recursiveRef')) report('schema.ref', nodePath, 'Dynamic schema references are not supported.');
    if (typeof node.$id === 'string' && (!node.$id.startsWith('urn:') || node !== schema)) report('schema.id', pointer(nodePath, '$id'), 'Only a root URN is accepted as an embedded schema identifier.');
    if (node.$schema && node.$schema !== 'https://json-schema.org/draft/2020-12/schema') report('schema.dialect', pointer(nodePath, '$schema'), 'Embedded schemas must use JSON Schema 2020-12.');
    if (Object.hasOwn(node, '$ref')) {
      if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#')) report('schema.ref-external', pointer(nodePath, '$ref'), 'Only local schema references are accepted; nothing is fetched.');
      else {
        const target = resolve(node.$ref);
        if (target === undefined || typeof target !== 'boolean' && (!target || typeof target !== 'object' || Array.isArray(target))) report('schema.ref-missing', pointer(nodePath, '$ref'), 'Schema reference does not identify a schema.');
        else visit(target, pointer(nodePath, '$ref'), depth + 1);
      }
    }
    // Visit schema positions, never literal property names or example/default payloads.
    for (const key of ['$defs','definitions','properties','patternProperties','dependentSchemas']) if (node[key] && typeof node[key] === 'object') for (const [name,child] of Object.entries(node[key])) visit(child,pointer(pointer(nodePath,key),name),depth+1);
    for (const key of ['items','additionalProperties','unevaluatedProperties','unevaluatedItems','contains','propertyNames','not','if','then','else']) visit(node[key],pointer(nodePath,key),depth+1);
    for (const key of ['allOf','anyOf','oneOf','prefixItems']) if (Array.isArray(node[key])) node[key].forEach((child,i)=>visit(child,pointer(pointer(nodePath,key),i),depth+1));
    active.delete(node); visited.add(node);
  }
  visit(schema, location, 0);
}

export function collectReferences(module, report) {
  const index = contractIndex(module), references = [];
  const dependencies = new Set(module.dependencies.map(item => item.moduleId));
  const ownId = module.identity.id;
  for (const [section, value] of Object.entries(module.contracts)) {
    if (section === 'schemas') continue;
    walkContracts(value, (node, location) => {
      if (isContractRef(node)) {
        references.push({ reference: node, path: location });
        if (node.moduleId === ownId && !index.get(node.kind)?.has(node.id)) report('ref.missing', location, 'Referenced module contract does not exist.');
        if (node.moduleId !== ownId && !dependencies.has(node.moduleId)) report('ref.dependency', location, 'An external contract requires a declared dependency.');
      }
      if (node && typeof node === 'object' && !Array.isArray(node) && typeof node.schemaId === 'string' && !index.get('schema').has(node.schemaId)) report('ref.missing', location, 'Referenced local JSON Schema does not exist.');
    }, `/contracts/${section}`);
  }
  return { index, references };
}
