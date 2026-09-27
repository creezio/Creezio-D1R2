/** Compile only selected, active and audience-exposed canonical API declarations. */
export class HttpBindingError extends Error {
  constructor(code) { super(`Invalid HTTP binding (${code}).`); this.name = 'HttpBindingError'; this.code = code; }
}
const fail = code => { throw new HttpBindingError(code); };
const id = value => typeof value === 'string' && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
const inputField = value => typeof value === 'string' && value.length <= 128
  && (id(value) || /^[A-Za-z][A-Za-z0-9_]*$/.test(value)) && !['constructor', 'prototype', '__proto__'].includes(value);
const auth = new Set(['session', 'api-token', 'oauth', 'impersonation', 'anonymous', 'webhook-signature']);
const actorFor = {session: 'user', 'api-token': 'machine', oauth: 'delegated-user', impersonation: 'impersonated-user',
  anonymous: 'anonymous', 'webhook-signature': 'signed-webhook'};
const method = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const named = path => path.split('/').slice(1).map(segment => /^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment) ? null : segment);
const overlap = (left, right) => left.length === right.length && left.every((segment, index) => !segment || !right[index] || segment === right[index]);

export function compileHttpBindings({ composition, modules, operationCatalog, disabledContributions = [] }) {
  if (!composition || !Array.isArray(composition.modules) || !Array.isArray(modules) || !operationCatalog
    || operationCatalog.schemaVersion !== 1 || !Array.isArray(operationCatalog.modules)) fail('catalog');
  const descriptors = new Map(modules.map(module => [module.identity?.id, module]));
  const selected = new Map(composition.modules.map(item => [item.moduleId, item]));
  const operations = new Map(operationCatalog.modules.flatMap(module => module.operations.map(entry => [`${module.moduleId}:${entry.operation.id}`, entry])));
  const active = (moduleId, pointer) => !disabledContributions.some(item => item.moduleId === moduleId
    && (item.path === pointer || pointer.startsWith(`${item.path}/`)));
  const bindings = [], seenIds = new Set();
  for (const selection of composition.modules) {
    if (!selection.enabled) continue;
    const descriptor = descriptors.get(selection.moduleId);
    if (!descriptor || !Array.isArray(descriptor.contracts?.api)) fail('module');
    for (const [index, api] of descriptor.contracts.api.entries()) {
      if (!active(selection.moduleId, `/contracts/api/${index}`)) continue;
      if (!composition.exposure?.[api.audience]?.moduleIds?.includes(selection.moduleId)) continue;
      const key = `${selection.moduleId}:${api.id}`, owner = api.operation?.moduleId;
      const target = operations.get(`${owner}:${api.operation?.id}`), op = target?.operation;
      if (!id(api.id) || seenIds.has(key) || !target?.active || !selected.get(owner)?.enabled || !op) fail('operation');
      seenIds.add(key);
      if (!method.has(api.method) || !['admin', 'app'].includes(api.audience) || !op.audiences.includes(api.audience)
        || api.method === 'GET' && op.kind !== 'query' || !Array.isArray(api.auth) || !api.auth.length
        || api.auth.some(value => !auth.has(value) || !op.actors.includes(actorFor[value])) || !Array.isArray(api.parameters)
        || api.input?.schemaId !== op.input.schemaId || api.output?.schemaId !== op.output.schemaId) fail('contract');
      const path = api.path;
      if (typeof path !== 'string' || path.length > 512 || !/^\/(?:[A-Za-z0-9_.{}-]+\/)*[A-Za-z0-9_.{}-]*$/.test(path)
        || path.includes('//') || path.endsWith('/') || !path.startsWith('/api/') || path.startsWith('/api/access/')
        || path.startsWith('/api/operations/') || path.startsWith('/api/workspace/')
        || path === '/api/front' || path.startsWith('/api/front/') || path === '/api/files' || path.startsWith('/api/files/') || path === '/api/health') fail('path');
      const segments = named(path), pathNames = [...path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]);
      if (segments[1] === null || ['access','operations','workspace','front'].includes(segments[1])) fail('path');
      if (pathNames.length !== new Set(pathNames).size || path.split('/').slice(1).some(segment => /[{}]/.test(segment) && !/^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(segment))) fail('path');
      const fields = new Set(), locations = new Set();
      const inputSchema = descriptors.get(owner)?.contracts.schemas?.find(schema => schema.id === op.input.schemaId)?.schema;
      if (!inputSchema || inputSchema.type !== 'object' || !inputSchema.properties || typeof inputSchema.properties !== 'object') fail('schema');
      const compiledParameters = [];
      for (const parameter of api.parameters) {
        if (!id(parameter.name) || !inputField(parameter.inputField) || !['path', 'query', 'header'].includes(parameter.in)
          || typeof parameter.required !== 'boolean' || fields.has(parameter.inputField)
          || locations.has(`${parameter.in}:${parameter.name}`) || parameter.in === 'path' && (!pathNames.includes(parameter.name) || !parameter.required)
          || parameter.in === 'header' && !/^x-[a-z0-9-]+$/.test(parameter.name)) fail('parameters');
        fields.add(parameter.inputField); locations.add(`${parameter.in}:${parameter.name}`);
        const type = inputSchema.properties[parameter.inputField]?.type;
        if (!['string', 'integer', 'number', 'boolean'].includes(type)) fail('codec');
        compiledParameters.push(Object.freeze({ ...parameter, codec: type }));
      }
      if (pathNames.some(name => !api.parameters.some(parameter => parameter.in === 'path' && parameter.name === name))) fail('parameters');
      if (api.method === 'GET' && (!Array.isArray(inputSchema.required)
        || inputSchema.required.some(field => !fields.has(field)))) fail('input-mapping');
      if (!Number.isSafeInteger(api.rateLimit?.requests) || api.rateLimit.requests < 1 || api.rateLimit.requests > 1000
        || !Number.isSafeInteger(api.rateLimit?.windowSeconds) || api.rateLimit.windowSeconds < 1 || api.rateLimit.windowSeconds > 86400) fail('admission');
      if (bindings.some(binding => binding.method === api.method && overlap(named(binding.path), segments))) fail('collision');
      bindings.push(Object.freeze({ id: api.id, contributorModuleId: selection.moduleId, moduleId: owner,
        operationId: op.id, method: api.method, path, audience: api.audience, auth: Object.freeze([...api.auth]),
        parameters: Object.freeze(compiledParameters), inputSchemaId: api.input.schemaId,
        outputSchemaId: api.output.schemaId, context: op.context, kind: op.kind,
        rateLimit: Object.freeze({ requests: api.rateLimit.requests, windowSeconds: api.rateLimit.windowSeconds }),
        contractDigest: target.contractDigest }));
    }
  }
  return Object.freeze(bindings);
}
