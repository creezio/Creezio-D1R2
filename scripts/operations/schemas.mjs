import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { buildSync } from 'esbuild';
import { validateComposition, canonicalJson, contractIntegrity } from '../../sdk/contracts/validate.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const OPERATION_SCHEMA_LIMITS = Object.freeze({ schemas: 1024, schemaBytes: 4 * 1024 * 1024, generatedBytes: 8 * 1024 * 1024 });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const digest = value => `sha256-${createHash('sha256').update(value).digest('hex')}`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hex = value => Buffer.from(value, 'utf8').toString('hex');

export class OperationSchemaError extends Error {
  constructor(code, diagnostics = []) {
    super('Operation schemas cannot be compiled for the current composition.');
    this.name = 'OperationSchemaError'; this.code = code; this.diagnostics = diagnostics;
  }
}
const fail = (code, diagnostics) => { throw new OperationSchemaError(code, diagnostics); };

/** Build-time only. No module handler import, code evaluation from descriptors, network fetch or
 * filesystem mutation. The returned standalone ESM contains only static validators and their
 * bundled pure helpers; the AJV compiler and Node adapters are not deployed. */
export function compileOperationSchemas(input) {
  let composition, modules, lock;
  try {
    if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw 0;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== 3 || ['composition', 'modules', 'lock'].some(name => !Object.hasOwn(descriptors[name] ?? {}, 'value'))) throw 0;
    ({ composition, modules, lock } = Object.fromEntries(Object.entries(descriptors).map(([name, descriptor]) => [name, descriptor.value])));
  } catch { fail('operation.schemas-input'); }
  const validation = validateComposition(composition, { modules, lock });
  if (validation.errors.length) fail('operation.schemas-contract', validation.errors);
  const captured = JSON.parse(canonicalJson({ composition, modules, lock }));
  const selected = new Map(captured.composition.modules.map(module => [module.moduleId, module]));
  const ordered = [...captured.modules].sort((a, b) => compare(a.identity.id, b.identity.id));
  const schemaCount = ordered.reduce((count, module) => count + module.contracts.schemas.length, 0);
  const schemaDocuments = ordered.flatMap(module => [...module.contracts.schemas].sort((a, b) => compare(a.id, b.id))
    .map(schema => ({ moduleId: module.identity.id, schemaId: schema.id, schema: schema.schema })));
  const serialized = canonicalJson(schemaDocuments);
  if (schemaCount > OPERATION_SCHEMA_LIMITS.schemas || Buffer.byteLength(serialized) > OPERATION_SCHEMA_LIMITS.schemaBytes)
    fail('operation.schemas-limit');
  const ajv = addFormats(new Ajv2020({ strict: true, strictRequired: true, allErrors: false, ownProperties: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false, inlineRefs: false, loopRequired: 100, loopEnum: 100,
    code: { source: true, esm: true, optimize: 0 } }));
  const exports = Object.create(null), names = new Map();
  try {
    for (const entry of schemaDocuments) {
      const schema = entry.schema;
      // Asynchronous validators cannot be mistaken for a truthy successful boolean result.
      // Dynamic/external refs, recursive graphs and unsupported dialects are refused by T02.
      if (schema && typeof schema === 'object' && Object.hasOwn(schema, '$async')) fail('operation.schemas-async');
      const name = `validate_${hex(entry.moduleId)}_${hex(entry.schemaId)}`;
      const schemaId = `urn:creezio:operation-schema:${hex(entry.moduleId)}:${hex(entry.schemaId)}`;
      // Only root URNs are allowed by T02; local #/ pointers retain their meaning after this
      // host-controlled identifier replaces a publisher URN shared with a different module.
      const compiledSchema = schema && typeof schema === 'object' ? { ...schema, $id: schemaId } : schema;
      ajv.addSchema(compiledSchema, schemaId);
      const validator = ajv.getSchema(schemaId);
      if (!validator || validator.$async) fail('operation.schemas-async');
      exports[`raw_${name}`] = schemaId;
      names.set(`${entry.moduleId}:${entry.schemaId}`, name);
    }
  } catch (error) {
    if (error instanceof OperationSchemaError) throw error;
    // Compiler diagnostics must not echo defaults/examples or submitted data.
    fail('operation.schemas-compile');
  }
  let validatorsCode;
  try {
    let rawCode = standaloneCode(ajv, exports);
    for (const name of names.values()) {
      const declaration = `export const raw_${name} =`;
      if (!rawCode.includes(declaration)) fail('operation.schemas-bundle');
      rawCode = rawCode.replace(declaration, `const raw_${name} =`);
    }
    const standalone = rawCode + `\nconst diagnostics = errors => Object.freeze((Array.isArray(errors) ? errors : []).slice(0, 8).map(error => Object.freeze({
      keyword: String(error.keyword ?? 'validation').slice(0, 64),
      instancePath: String(error.instancePath ?? '').slice(0, 256),
      schemaPath: String(error.schemaPath ?? '').slice(0, 256)
    })));\n` + [...names.values()].map(name => `export function ${name}(data) {
      try {
        const ok = raw_${name}(data) === true;
        ${name}.errors = ok ? null : diagnostics(raw_${name}.errors);
        return ok;
      } catch { ${name}.errors = Object.freeze([Object.freeze({keyword:'validation',instancePath:'',schemaPath:''})]); return false; }
    }\n${name}.errors = null;\n`).join('');
    const result = buildSync({ absWorkingDir: repository, bundle: true, write: false, metafile: true,
      platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'none', sourcemap: false,
      logLevel: 'silent', stdin: { contents: standalone, resolveDir: repository, sourcefile: 'operation-validators.mjs', loader: 'js' } });
    // Only pinned pure AJV helpers are allowed. Never include its compiler, a module source,
    // Node shim or an unresolved runtime import in a production validator bundle.
    const allowed = /^(?:node_modules\/ajv\/dist\/runtime\/[^/]+\.js|node_modules\/ajv-formats\/dist\/formats\.js|node_modules\/fast-deep-equal\/index\.js|operation-validators\.mjs)$/;
    if (Object.keys(result.metafile.inputs).some(name => !allowed.test(name.replaceAll('\\', '/')))
      || Object.values(result.metafile.outputs).some(output => output.imports.length)) fail('operation.schemas-bundle');
    validatorsCode = result.outputFiles[0].text;
    if (Buffer.byteLength(validatorsCode) > OPERATION_SCHEMA_LIMITS.generatedBytes) fail('operation.schemas-limit');
  } catch (error) {
    if (error instanceof OperationSchemaError) throw error;
    fail('operation.schemas-bundle');
  }
  const inactive = validation.metrics.disabledContributions ?? [];
  const catalog = { schemaVersion: 1, compositionDigest: contractIntegrity(captured.composition), modules: ordered.map(module => {
    const moduleId = module.identity.id, selection = selected.get(moduleId);
    return { moduleId, version: module.identity.version, enabled: selection.enabled,
      schemas: [...module.contracts.schemas].sort((a, b) => compare(a.id, b.id)).map(schema => ({ schemaId: schema.id, validator: names.get(`${moduleId}:${schema.id}`) })),
      operations: module.contracts.operations.map((operation, index) => ({ operation,
        contractDigest: contractIntegrity({ moduleVersion: module.identity.version, operation,
          schemas: [...module.contracts.schemas].sort((a, b) => compare(a.id, b.id)) }),
        active: selection.enabled && !inactive.some(item => item.moduleId === moduleId
          && (item.path === `/contracts/operations/${index}` || `/contracts/operations/${index}`.startsWith(`${item.path}/`))),
        inputValidator: names.get(`${moduleId}:${operation.input.schemaId}`), outputValidator: names.get(`${moduleId}:${operation.output.schemaId}`),
        ...(operation.execution.progressSchema ? { progressValidator: names.get(`${moduleId}:${operation.execution.progressSchema.schemaId}`) } : {}),
      })).sort((a, b) => compare(a.operation.id, b.operation.id)) };
  }) };
  return freeze({ catalog, validatorsCode, schemasDigest: digest(serialized), validatorsDigest: digest(validatorsCode),
    metrics: { moduleCount: ordered.length, schemaCount, operationCount: ordered.reduce((n, module) => n + module.contracts.operations.length, 0),
      generatedBytes: Buffer.byteLength(validatorsCode) } });
}
